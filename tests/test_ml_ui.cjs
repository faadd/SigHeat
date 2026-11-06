"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Core = require("../assets/core.js");
const Learning = require("../assets/learning.js");
const source = fs.readFileSync(path.join(__dirname, "../assets/ml-ui.js"), "utf8");

function memoryStorage() {
  const map = new Map();
  return {getItem: (k) => map.get(k) || null, setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k), map};
}
function harness({real = false, storage = memoryStorage(), seed = null, centralConfig = undefined} = {}) {
  let now = Date.now();
  const nodes = new Map(), jobs = [], downloads = [], instances = [], blobs = new Map();
  class Node {
    constructor(tag = "div") { this.tagName = tag; this.children = []; this.handlers = {}; this.value = ""; this.disabled = false; this.hidden = false; this.textContent = ""; this.dataset = {}; }
    append(...children) { this.children.push(...children); }
    addEventListener(event, fn) { this.handlers[event] = fn; }
    click() { if (this.tagName === "a") downloads.push({url: this.href, filename: this.download}); else if (!this.disabled) this.handlers.click?.(); }
    remove() {} focus() {}
    set innerHTML(_) { throw new Error("Unsafe HTML sink"); }
  }
  const get = (id) => { if (!nodes.has(id)) nodes.set(id, new Node()); return nodes.get(id); };
  const document = {body: Object.assign(new Node(), {dataset: {page: "dashboard"}}), getElementById: get, createElement: (tag) => new Node(tag)};
  const row = (sequence, extra = {}) => ({schema_version: 2, latency_type: "mqtt_app_rtt", project_id: "project", device_id: "hp-a", boot_id: "boot-one", sequence, source: "browser", broker_endpoint: "wss://example.invalid/mqtt", interval_s: 5, accel_mode: "linear", accel_rms: 1, gyro_rms_rad_s: .1, sent_at_ms: now - (6 - sequence) * 5000, latency_ms: 40 + sequence, latency_std_ms: 2, probe_ok: true, success_pct: 100, ...extra});
  const engine = {create(options) {
    if (real) { const instance = Learning.create(options); instances.push({options, instance}); return instance; }
    const call = {options, rows: [], ingests: 0, maintains: 0, persists: 0, clears: 0, imports: 0};
    instances.push(call);
    return {
      ingest(value) { call.ingests++; call.rows.push(value); return {accepted: true, needsMaintenance: call.rows.length >= 4}; },
      maintain() { call.maintains++; return {changed: true, trained: 1}; },
      persist() { call.persists++; return true; },
      forecast() { return call.rows.length >= 6 ? {status: "ready", prediction_ms: 620, method: "ridge", horizon_s: 5} : {status: "waiting", reason: "Menunggu enam pengukuran berurutan"}; },
      classify(value) { return {quality: value.probe_ok ? "poor" : "unknown", label: value.probe_ok ? "Beban relatif tinggi" : "Tidak terklasifikasi", model_id: "test-current", provenance: "synthetic"}; },
      inspect() { return {sampleCount: call.rows.length, storageAvailable: !!options.storage, modelId: "default", modelProvenance: "synthetic"}; },
      exportRows() { return call.rows; }, exportState() { return {format: "valid", rows: call.rows.filter((r) => r.source !== "demo")}; },
      importState(value) { call.imports++; if (value.format !== "valid") return {ok: false, reason: "Format tidak valid"}; call.rows = value.rows || []; return {ok: true}; },
      clearLearning() { call.clears++; call.rows = []; },
    };
  }};
  const window = {document, SigHeatLearning: engine, SigHeatCore: Core, localStorage: storage, SigHeatLearningSeed: seed, SigHeatCentralConfig: centralConfig, addEventListener() {}};
  class Clock extends Date { static now() { return now; } }
  vm.runInNewContext(source, {window, document, Date: Clock, URL: {createObjectURL(blob) { const id = "blob:" + blobs.size; blobs.set(id, blob); return id; }, revokeObjectURL() {}}, Blob, console, setTimeout(fn) {jobs.push(fn); return jobs.length;}});
  return {get, row, instances, jobs, storage, downloads, blobs, panel: window.SigHeatMLPanel,
    click(id) { get(id).click(); }, runJobs() { while (jobs.length) jobs.shift()(); }, setNow(value) { now = value; },
    update(extra = {}) { window.SigHeatMLPanel.updateSelection({selected: "hp-a", connected: true, staleDeviceIds: [], ...extra}); },
    import(value, size = 1) { const target = get("ml-import-backup"); target.files = [{size, text: async () => JSON.stringify(value)}]; return target.handlers.change({target}); },
  };
}
function collect(h, extra = {}, count = 6) { for (let i = 1; i <= count; i++) h.panel.ingest(h.row(i, extra)); h.update({demo: extra.source === "demo"}); }

test("default models initialize automatically; only due ingests schedule one background maintenance", () => {
  const seed = {format: "team-seed"}, h = harness({seed});
  assert.equal(h.instances.length, 2);
  assert.equal(h.instances[0].options.seed, seed);
  assert.equal(h.instances[1].options.seed, undefined);
  assert.equal(h.jobs.length, 0);
  assert.equal(h.instances[0].maintains, 0);
  assert.match(h.get("ml-status").textContent, /Model awal sintetis dimuat otomatis/);
  collect(h);
  assert.equal(h.instances[0].maintains, 0);
  assert.match(h.get("ml-prediction").textContent, /620/);
  assert.match(h.get("ml-quality").textContent, /relatif tinggi/);
  assert.match(h.get("ml-warning").textContent, /bukan kepastian gangguan/);
  h.runJobs();
  assert.equal(h.instances[0].maintains, 1);
});

test("offline, stale and old measurements suppress forecasts while preserving measured data and evidence", () => {
  const h = harness(); collect(h);
  h.update({connected: false});
  assert.equal(h.get("ml-prediction").textContent, "–");
  assert.match(h.get("ml-observed").textContent, /46/);
  assert.match(h.get("ml-evaluation").textContent, /default/);
  h.update({staleDeviceIds: ["hp-a"]}); assert.equal(h.get("ml-prediction").textContent, "–");
  h.setNow(h.row(6).sent_at_ms + 60000); h.update();
  assert.match(h.get("ml-prediction-note").textContent, /dijeda/);
});

test("demo uses a separate memory manager; reset and switching preserve real learning", () => {
  const h = harness(); collect(h); h.runJobs();
  const live = h.instances[0]; h.panel.reset();
  assert.equal(live.clears, 0); assert.equal(live.rows.length, 6);
  collect(h, {source: "demo"}); h.runJobs();
  assert.equal(live.ingests, 6); assert.equal(live.rows.length, 6);
  assert.equal(h.instances[2].options.storage, null);
  assert.equal(h.instances[2].rows.length, 6);
  assert.match(h.get("ml-provenance").textContent, /SIMULASI/);
  assert.match(h.get("ml-storage-note").textContent, /Demo hanya di memori/);
  h.panel.reset(); assert.equal(live.clears, 0);
});

test("learning clear requires visible confirmation and cancel preserves state", () => {
  const h = harness(); collect(h);
  h.click("ml-clear"); assert.equal(h.get("ml-clear-confirm").hidden, false); assert.equal(h.instances[0].clears, 0);
  h.click("ml-clear-cancel"); assert.equal(h.get("ml-clear-confirm").hidden, true); assert.equal(h.instances[0].rows.length, 6);
  h.click("ml-clear"); h.click("ml-clear-yes");
  assert.equal(h.instances[0].clears, 1); assert.equal(h.get("ml-clear-confirm").hidden, true);
  assert.equal(h.get("ml-prediction").textContent, "–");
});

test("backup import validates errors and byte limit; reset cancels pending asynchronous file reads", async () => {
  const h = harness(); collect(h);
  await h.import({format: "invalid"}); assert.equal(h.instances[0].rows.length, 6); assert.match(h.get("ml-action-status").textContent, /tidak dipulihkan/);
  await h.import({format: "valid"}, 8 * 1024 * 1024 + 1); assert.equal(h.instances[0].imports, 1); assert.match(h.get("ml-action-status").textContent, /8 MiB/);
  await h.import({format: "valid", rows: []}); assert.equal(h.instances[0].rows.length, 0); assert.match(h.get("ml-action-status").textContent, /dipulihkan/);
  let resolveRead; const target = h.get("ml-import-backup"); target.files = [{size: 10, text: () => new Promise((resolve) => {resolveRead = resolve;})}];
  const pending = target.handlers.change({target}); h.panel.reset(); resolveRead('{"format":"valid"}'); await pending;
  assert.equal(h.instances[0].imports, 2);
});

test("CSV retains identity and timeout null, excludes coordinates, and backup excludes demo", async () => {
  const h = harness(); collect(h);
  h.panel.ingest(h.row(7, {latency_ms: null, probe_ok: false, latitude: -7, longitude: 110})); h.update();
  assert.equal(h.get("ml-quality").textContent, "Tidak terklasifikasi");
  assert.match(h.get("ml-observed-note").textContent, /timeout/);
  h.click("ml-export-data");
  const csv = await h.blobs.get(h.downloads[0].url).text(), lines = csv.trim().split(/\r?\n/), cols = lines[0].replace(/^\ufeff/, "").split(","), last = lines.at(-1).split(",").map((s) => s.replace(/^"|"$/g, ""));
  assert.match(csv, /boot_id,sequence,source/); assert.doesNotMatch(lines[0], /latitude|longitude/);
  assert.equal(last[cols.indexOf("latency_ms")], ""); assert.equal(last[cols.indexOf("probe_ok")], "false");
  collect(h, {source: "demo"}); h.click("ml-export-backup");
  const backup = JSON.parse(await h.blobs.get(h.downloads[1].url).text()); assert.ok(backup.rows.every((r) => r.source !== "demo"));
});

test("device labels remain literal text and multiple contexts have an explicit comparability warning", () => {
  const h = harness(), id = "<img src=x onerror=alert(1)>"; collect(h, {device_id: id}); h.update({selected: id, contextCount: 2});
  assert.match(h.get("ml-device-label").textContent, /<img/);
  assert.match(h.get("ml-context-note").textContent, /tidak langsung sebanding/);
});

test("actual learning engine predicts after six measurements and restores history without inventing live data", () => {
  const h = harness({real: true});
  collect(h, {}, 5); assert.equal(h.get("ml-prediction").textContent, "–");
  h.panel.ingest(h.row(6)); h.update(); assert.notEqual(h.get("ml-prediction").textContent, "–");
  h.runJobs(); assert.ok(h.storage.map.size > 0);
  const restored = harness({real: true, storage: h.storage}); restored.update({row: h.row(6)});
  assert.equal(restored.get("ml-prediction").textContent, "–");
  restored.panel.ingest(h.row(7)); restored.update({row: h.row(7)});
  assert.notEqual(restored.get("ml-prediction").textContent, "–");
  const previous = restored.instances[0].instance.inspect(h.row(7)).sampleCount;
  restored.panel.ingest(h.row(7)); restored.panel.ingest(h.row(1));
  assert.equal(restored.instances[0].instance.inspect(h.row(7)).sampleCount, previous);
});

 test("central configuration fails closed when central scripts are unavailable instead of training locally", () => {
  const h = harness({centralConfig: {}}); collect(h); h.runJobs();
  assert.equal(h.instances[0].ingests, 0); assert.equal(h.instances[0].maintains, 0);
  assert.match(h.get("ml-status").textContent, /Modul pusat belum tersedia/);
  assert.equal(h.get("ml-import-backup").disabled, true);
});
