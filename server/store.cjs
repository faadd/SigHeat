"use strict";

const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { DatabaseSync, backup } = require("node:sqlite");
const SELF_STARTED_AT = Math.round(Date.now() - process.uptime() * 1000);

function processIdentity(pid) {
  if (process.platform === "linux") {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      // The command field is parenthesized and may itself contain spaces.
      const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
      const boot = fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
      if (/^\d+$/.test(fields[19] || "") && boot) return `linux:${boot}:${fields[19]}`;
    } catch (_) { /* Restricted /proc: use the conservative portable fallback. */ }
  }
  // Portable fallback distinguishes a lock from this process from a previous
  // process with the same PID. Unknown other live owners are never evicted.
  return pid === process.pid ? `self:${SELF_STARTED_AT}` : null;
}

// The database is private server state. JSON records keep the audit schema
// inspectable while indexed columns support ordered exports and filtering.
class Store {
  constructor(filename) {
    this.filename = filename;
    this.lock = null;
    if (filename !== ":memory:") {
      fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true, mode: 0o700 });
      this.lockPath = path.resolve(filename) + ".writer.lock";
      this.lock = JSON.stringify({ pid: process.pid, identity: processIdentity(process.pid), nonce: crypto.randomUUID() });
      this.acquireLock();
    }
    try {
      this.db = new DatabaseSync(filename);
      this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS measurements (
          id TEXT PRIMARY KEY, context_key TEXT NOT NULL, at_ms INTEGER NOT NULL,
          received_at_ms INTEGER NOT NULL, status TEXT NOT NULL, reason TEXT,
          body TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS measurement_context_time ON measurements(context_key,at_ms);
        CREATE TABLE IF NOT EXISTS rejections (
          id TEXT PRIMARY KEY, at_ms INTEGER NOT NULL, reason TEXT NOT NULL, body TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS predictions (
          id TEXT PRIMARY KEY, context_key TEXT NOT NULL, at_ms INTEGER NOT NULL,
          status TEXT NOT NULL, body TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS prediction_context_time ON predictions(context_key,at_ms);
        CREATE TABLE IF NOT EXISTS blocks (
          id TEXT PRIMARY KEY, context_key TEXT NOT NULL, at_ms INTEGER NOT NULL, body TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS block_context_time ON blocks(context_key,at_ms);
        CREATE TABLE IF NOT EXISTS candidates (
          id TEXT PRIMARY KEY, context_key TEXT NOT NULL, at_ms INTEGER NOT NULL,
          status TEXT NOT NULL, body TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS candidate_context_time ON candidates(context_key,at_ms);
        CREATE TABLE IF NOT EXISTS models (
          id TEXT PRIMARY KEY, context_key TEXT, at_ms INTEGER NOT NULL, body TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY, context_key TEXT, at_ms INTEGER NOT NULL, body TEXT NOT NULL
        );
        PRAGMA user_version=1;
      `);
      if (filename !== ":memory:") fs.chmodSync(filename, 0o600);
    } catch (error) { this.releaseLock(); throw error; }
  }

  acquireLock() {
    for (let attempt = 0; attempt < 2; attempt++) {
      try { fs.writeFileSync(this.lockPath, this.lock, { flag: "wx", mode: 0o600 }); return; }
      catch (error) {
        if (error.code !== "EEXIST") throw error;
        let previous;
        try { previous = JSON.parse(fs.readFileSync(this.lockPath, "utf8")); }
        catch (_) { throw new Error("Lock database tidak dapat dibaca. Pastikan layanan lain berhenti sebelum memulihkan lock."); }
        if (!Number.isSafeInteger(previous.pid) || previous.pid < 1) throw new Error("Lock database tidak valid.");
        try { process.kill(previous.pid, 0); }
        catch (check) {
          if (check.code === "ESRCH") { fs.unlinkSync(this.lockPath); continue; }
          throw new Error("Pemilik lock database tidak dapat diperiksa.");
        }
        const actualIdentity = processIdentity(previous.pid);
        if (typeof previous.identity === "string" && actualIdentity &&
            previous.identity.split(":")[0] === actualIdentity.split(":")[0] && previous.identity !== actualIdentity) {
          fs.unlinkSync(this.lockPath); continue;
        }
        throw new Error("Database sudah digunakan layanan pusat lain. Hanya satu penulis diizinkan.");
      }
    }
    throw new Error("Gagal mengambil lock database.");
  }

  releaseLock() {
    if (!this.lock) return;
    try { if (fs.readFileSync(this.lockPath, "utf8") === this.lock) fs.unlinkSync(this.lockPath); } catch (_) { /* Already removed. */ }
    this.lock = null;
  }

  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = fn(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  getState() { const row = this.db.prepare("SELECT value FROM metadata WHERE key='engine_state'").get(); return row ? JSON.parse(row.value) : null; }
  saveState(state) { this.db.prepare("INSERT INTO metadata(key,value) VALUES('engine_state',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(state)); }
  hasMeasurement(id) { return !!this.db.prepare("SELECT 1 FROM measurements WHERE id=?").get(id); }
  measurement(value) {
    this.db.prepare("INSERT INTO measurements(id,context_key,at_ms,received_at_ms,status,reason,body) VALUES(?,?,?,?,?,?,?)")
      .run(value.id, value.context_key, value.sent_at_ms, value.received_at_ms, value.status, value.reason || null, JSON.stringify(value));
  }
  rejection(value) { this.db.prepare("INSERT INTO rejections(id,at_ms,reason,body) VALUES(?,?,?,?)").run(value.id, value.at_ms, value.reason, JSON.stringify(value)); }
  insert(table, value) {
    if (!["predictions", "blocks", "candidates", "models", "events"].includes(table)) throw new Error("Tabel audit tidak valid.");
    const withStatus = table === "predictions" || table === "candidates";
    this.db.prepare(`INSERT INTO ${table}(id,context_key,at_ms,${withStatus ? "status," : ""}body) VALUES(?,?,?,${withStatus ? "?," : ""}?)`)
      .run(value.id, value.context_key ?? null, value.created_at_ms ?? value.at_ms ?? value.end_ms, ...(withStatus ? [value.status] : []), JSON.stringify(value));
  }
  update(table, value) {
    if (!["predictions", "candidates"].includes(table)) throw new Error("Arsip hanya dapat diperbarui saat hasilnya tiba.");
    const current = this.get(table, value.id);
    if (!current || (table === "predictions" && current.status !== "pending") ||
        (table === "candidates" && current.status !== "evaluating")) throw new Error("Hasil audit yang sudah selesai tidak dapat ditimpa.");
    this.db.prepare(`UPDATE ${table} SET status=?,body=? WHERE id=?`).run(value.status, JSON.stringify(value), value.id);
  }
  get(table, id) {
    if (!["predictions", "blocks", "candidates", "models", "events"].includes(table)) throw new Error("Tabel audit tidak valid.");
    const row = this.db.prepare(`SELECT body FROM ${table} WHERE id=?`).get(id);
    return row ? JSON.parse(row.body) : null;
  }
  all(table) {
    if (!["measurements", "rejections", "predictions", "blocks", "candidates", "models", "events"].includes(table)) throw new Error("Tabel audit tidak valid.");
    return this.db.prepare(`SELECT body FROM ${table} ORDER BY at_ms,rowid`).all().map((r) => JSON.parse(r.body));
  }
  select(table, filters = {}, { contextKeys, sharedQualityContext } = {}) {
    if (!["measurements", "rejections", "predictions", "blocks", "candidates", "models", "events"].includes(table)) throw new Error("Tabel audit tidak valid.");
    const where = [], args = [];
    const mappings = [["project", "project_id"], ["project_id", "project_id"], ["device", "device_id"], ["device_id", "device_id"],
      ["source", "source"], ["broker", "broker_endpoint"], ["broker_endpoint", "broker_endpoint"], ["interval", "interval_s"], ["interval_s", "interval_s"], ["algorithm", "algorithm"]];
    for (const [option, field] of mappings) {
      const value = filters[option];
      if (value === undefined || value === "") continue;
      const clause = `CAST(json_extract(body,'$.${field}') AS TEXT)=?`;
      if (field === "device_id" && sharedQualityContext) {
        where.push(`(${clause} OR context_key=?)`); args.push(String(value), sharedQualityContext);
      } else { where.push(clause); args.push(String(value)); }
    }
    if (contextKeys?.length) {
      where.push(`context_key IN (${contextKeys.map(() => "?").join(",")})`); args.push(...contextKeys);
    } else {
      for (const key of ["context", "context_key"]) if (filters[key] !== undefined && filters[key] !== "") {
        where.push("context_key=?"); args.push(String(filters[key]));
      }
    }
    const model = filters.model || filters.model_id;
    if (model) {
      where.push("(json_extract(body,'$.model_id')=? OR json_extract(body,'$.incumbent_model_id')=? OR json_extract(body,'$.candidate_model_id')=? OR EXISTS(SELECT 1 FROM json_each(json_extract(body,'$.model_ids')) WHERE value=?))");
      args.push(String(model), String(model), String(model), String(model));
    }
    const status = filters.status || (table === "candidates" ? filters.candidate_status : null);
    if (status) { where.push("json_extract(body,'$.status')=?"); args.push(String(status)); }
    if (Array.isArray(filters.statuses) && filters.statuses.length) {
      where.push(`json_extract(body,'$.status') IN (${filters.statuses.map(() => "?").join(",")})`); args.push(...filters.statuses.map(String));
    }
    const time = "COALESCE(json_extract(body,'$.target_at_ms'),json_extract(body,'$.end_ms'),json_extract(body,'$.completed_at_ms'),json_extract(body,'$.created_at_ms'),json_extract(body,'$.at_ms'),json_extract(body,'$.sent_at_ms'))";
    for (const [value, operator] of [[filters.from ?? filters.start_ms, ">="], [filters.to ?? filters.end_ms, "<="]]) {
      if (value === undefined || value === "") continue;
      if (!Number.isFinite(Number(value))) throw new Error("Batas waktu filter tidak valid.");
      where.push(`${time}${operator}?`); args.push(Number(value));
    }
    let limit = filters.limit === undefined || filters.limit === null || filters.limit === "" ? null : Number(filters.limit);
    if (limit !== null && (!Number.isSafeInteger(limit) || limit < 1 || limit > 100000)) throw new Error("Batas jumlah riwayat tidak valid.");
    const condition = where.length ? " WHERE " + where.join(" AND ") : "";
    const total = Number(this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}${condition}`).get(...args).n);
    const records = this.db.prepare(`SELECT body FROM ${table}${condition} ORDER BY at_ms ${limit ? "DESC" : "ASC"},rowid ${limit ? "DESC" : "ASC"}${limit ? " LIMIT ?" : ""}`)
      .all(...args, ...(limit ? [limit] : [])).map((r) => JSON.parse(r.body));
    if (limit) records.reverse();
    return { records, total, truncated: total > records.length };
  }
  async backup(destination) {
    if (path.resolve(destination) === path.resolve(this.filename)) throw new Error("Tujuan backup harus berbeda dari database aktif.");
    fs.mkdirSync(path.dirname(path.resolve(destination)), { recursive: true, mode: 0o700 });
    await backup(this.db, destination);
    fs.chmodSync(destination, 0o600);
    return destination;
  }
  close() { if (this.db) { this.db.close(); this.db = null; } this.releaseLock(); }
}

module.exports = { Store, processIdentity };
