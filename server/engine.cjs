"use strict";

const crypto = require("node:crypto");
const C = require("../assets/core.js"), M = require("../assets/ml.js"), K = require("../assets/clusters.js");
const DEFAULT = require("../assets/default-model.js");
const { Store } = require("./store.cjs");

const CODE_VERSION = "5.0.0";
const POLICY = Object.freeze({ version: "central-policy-v1", ridge_min_rows: 120, cluster_min_rows: 90,
  retry_rows: 60, evaluate_n: 24, block_n: 24, margin: 0.05, buffer_rows: 1200 });
const METHODS = ["active", "frozen", "persistence", "moving_average"];
const clone = (v) => structuredClone(v);
const hash = (v) => crypto.createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex");
const qualityKey = (r) => JSON.stringify([r.project_id, r.source, r.broker_endpoint, r.interval_s]);
const methodValue = (f, method) => method === "persistence" ? f.persistence_ms : method === "moving_average" ? f.moving_average_ms : f.ml_prediction_ms;
const identity = (key) => {
  const p = JSON.parse(key), ridge = p.length === 6;
  return { project_id: p[0], device_id: ridge ? p[1] : null, source: p[ridge ? 2 : 1],
    broker_endpoint: p[ridge ? 3 : 2], interval_s: p[ridge ? 4 : 3], ...(ridge ? { accel_mode: p[5] } : {}) };
};
const compact = (r) => Object.fromEntries(["schema_version", "latency_type", "mode", "project_id", "device_id", "source",
  "boot_id", "sequence", "sent_at_ms", "received_at_ms", "broker_endpoint", "interval_s", "accel_mode", "latency_ms",
  "latency_std_ms", "success_pct", "probe_ok", "accel_rms", "gyro_rms_rad_s", "accel_available", "gyro_available", "measurement_id"]
  .map((key) => [key, r[key]]));

function promotionDecision(candidate, best, margin = POLICY.margin) {
  if (![candidate, best, margin].every(Number.isFinite) || candidate < 0 || best < 0 || margin < 0 || margin >= 1)
    throw new Error("Galat atau margin promosi tidak valid.");
  const threshold = (1 - margin) * best;
  return { promoted: candidate < best && candidate <= threshold, threshold,
    improvement_pct: best === 0 ? null : (best - candidate) / best * 100,
    reason: best === 0 ? "Pembanding memiliki galat nol; kandidat tidak dapat memperbaikinya secara ketat."
      : candidate >= best ? "Galat kandidat tidak lebih kecil daripada pembanding terbaik."
        : candidate > threshold ? `Perbaikan belum mencapai margin ${margin * 100}%.`
          : `Kandidat memenuhi perbaikan minimal ${margin * 100}% pada target yang sama.` };
}

function validPolicy(input) {
  const p = { ...POLICY, ...input };
  for (const [key, min, max] of [["ridge_min_rows", 120, 50000], ["cluster_min_rows", 60, 50000],
    ["retry_rows", 1, 50000], ["evaluate_n", 1, 10000], ["block_n", 1, 10000], ["buffer_rows", 120, 50000]])
    if (!Number.isSafeInteger(p[key]) || p[key] < min || p[key] > max) throw new Error(`Kebijakan ${key} tidak valid.`);
  if (p.buffer_rows < Math.max(p.ridge_min_rows, p.cluster_min_rows) || !Number.isFinite(p.margin) || p.margin < 0 || p.margin >= 1)
    throw new Error("Buffer atau margin pembelajaran tidak valid.");
  p.version = "central-policy-" + hash({ ...p, version: null }).slice(0, 12);
  return p;
}

function matchRecord(record, filters = {}) {
  for (const [option, field] of [["project", "project_id"], ["project_id", "project_id"], ["device", "device_id"],
    ["device_id", "device_id"], ["source", "source"], ["broker", "broker_endpoint"], ["broker_endpoint", "broker_endpoint"],
    ["interval", "interval_s"], ["interval_s", "interval_s"], ["context", "context_key"], ["context_key", "context_key"]]) {
    if (filters[option] !== undefined && filters[option] !== "" && String(record[field]) !== String(filters[option])) return false;
  }
  const model = filters.model || filters.model_id;
  if (model && ![record.model_id, record.incumbent_model_id, record.candidate_model_id, ...(record.model_ids || [])].includes(model)) return false;
  const status = filters.status || (record.algorithm && record.required ? filters.candidate_status : null);
  if (status && record.status !== status) return false;
  const at = record.target_at_ms ?? record.end_ms ?? record.completed_at_ms ?? record.created_at_ms ?? record.at_ms ?? record.sent_at_ms;
  const from = filters.from ?? filters.start_ms, through = filters.to ?? filters.end_ms;
  if (from !== undefined && from !== "" && at < Number(from)) return false;
  if (through !== undefined && through !== "" && at > Number(through)) return false;
  return true;
}

class CentralEngine {
  constructor({ dbPath = ":memory:", projectId, brokerEndpoint, now = Date.now, policy } = {}) {
    if (!C.validId(projectId) || !C.endpoint(brokerEndpoint)) throw new Error("Project ID atau broker pusat tidak valid.");
    if (typeof now !== "function" || !M.validateContextModel(DEFAULT) || !K.validateModel(K.defaultModel())) throw new Error("Engine/model awal tidak tersedia.");
    this.now = now;
    this.projectId = projectId;
    this.brokerEndpoint = C.endpoint(brokerEndpoint);
    this.policy = validPolicy(policy);
    this.store = new Store(dbPath);
    try {
      const saved = this.store.getState();
      if (saved && (saved.schema !== "sigheat-central-state-v1" || saved.project_id !== projectId || saved.broker_endpoint !== this.brokerEndpoint))
        throw new Error("Database dimiliki proyek/broker atau schema berbeda. Gunakan database terpisah.");
      this.state = saved || { schema: "sigheat-central-state-v1", code_version: CODE_VERSION,
        project_id: projectId, broker_endpoint: this.brokerEndpoint, revision: 1, generated_at_ms: now(),
        policy: this.policy, frozen_ridge: clone(DEFAULT), frozen_clusters: K.defaultModel(), profiles: {}, quality_profiles: {},
        stats: { received: 0, accepted: 0, invalid: 0, duplicates: 0, out_of_order: 0, late: 0, timeouts: 0,
          valid_targets: 0, excluded_predictions: 0, unknown_profiles: 0 } };
      if (!M.validateContextModel(this.state.frozen_ridge) || !K.validateModel(this.state.frozen_clusters))
        throw new Error("Model pembanding beku dalam database rusak.");
      for (const p of Object.values(this.state.profiles)) {
        if (!M.validateContextModel(p.model) || (p.model.scope === "context" && p.model.context_key !== p.key) ||
            (p.candidate && !M.validateContextModel(p.candidate.model))) throw new Error("Model Ridge tersimpan tidak valid.");
      }
      for (const q of Object.values(this.state.quality_profiles)) {
        if (!K.validateModel(q.model) || (q.model.context_key && q.model.context_key !== q.key) ||
            (q.candidate && !K.validateModel(q.candidate.model))) throw new Error("Model K-Means tersimpan tidak valid.");
      }
      this.store.transaction(() => {
        if (!saved) {
          this.archiveModel(this.state.frozen_ridge, null, now(), "bootstrap");
          this.archiveModel(this.state.frozen_clusters, null, now(), "bootstrap");
        }
        this.event(saved ? "service_restarted" : "service_started", null, { reason: saved
          ? "State dan evaluasi dipulihkan persis; target lama tidak dinilai ulang." : "Database pembelajaran pusat dibuat." });
        if (saved && JSON.stringify(saved.policy) !== JSON.stringify(this.policy)) {
          this.event("policy_changed", null, { previous: saved.policy, policy: this.policy });
          for (const p of Object.values(this.state.profiles)) {
            if (p.block.length) this.event("incomplete_block_cancelled", p.key, {
              reason: "Konfigurasi blok berubah; prediksi individual tetap diarsipkan.", prediction_ids: p.block.map((r) => r.id) });
            p.block = [];
          }
        }
        this.state.policy = this.policy;
        this.store.saveState(this.state);
      });
    } catch (error) { this.store.close(); throw error; }
  }

  event(type, contextKey, extra = {}, at = this.now()) {
    const record = { id: crypto.randomUUID(), type, at_ms: at, context_key: contextKey,
      ...(contextKey ? identity(contextKey) : { project_id: this.projectId }), ...extra };
    this.store.insert("events", record);
    return record;
  }

  archiveModel(model, key, at, reason) {
    if (this.store.get("models", model.model_id)) return;
    this.store.insert("models", { id: model.model_id, model_id: model.model_id, context_key: key,
      ...(key ? identity(key) : { project_id: this.projectId }), created_at_ms: at, provenance: model.provenance,
      reason, sha256: hash(model), model: clone(model), code_version: CODE_VERSION });
  }

  changed(at) { this.state.revision++; this.state.generated_at_ms = at; }

  profile(row) {
    const key = M.contextKey(row);
    if (!this.state.profiles[key]) {
      this.state.profiles[key] = { key, rows: [], total_accepted: 0, last_attempt: 0, boots: {},
        model: clone(this.state.frozen_ridge), method: "ridge", candidate: null, pending: null, block: [],
        trained_at_ms: null, promoted_at_ms: null, last_evaluation: null, last_training: null, revision: this.state.revision + 1 };
      this.changed(row.received_at_ms);
      this.event("context_created", key, { model_id: this.state.frozen_ridge.model_id, method: "ridge", revision: this.state.revision }, row.received_at_ms);
    }
    return this.state.profiles[key];
  }

  qualityProfile(row) {
    const key = qualityKey(row);
    if (!this.state.quality_profiles[key]) {
      this.state.quality_profiles[key] = { key, rows: [], total_accepted: 0, last_attempt: 0,
        model: clone(this.state.frozen_clusters), candidate: null, counts: [0, 0, 0], unknown: 0,
        trained_at_ms: null, promoted_at_ms: null, last_evaluation: null, last_training: null, revision: this.state.revision + 1 };
      this.changed(row.received_at_ms);
    }
    return this.state.quality_profiles[key];
  }

  reject(reason, at, details = {}) {
    const entry = { id: crypto.randomUUID(), at_ms: at, reason, project_id: this.projectId, ...details };
    this.store.rejection(entry);
    this.state.stats[reason === "duplicate" ? "duplicates" : reason === "out_of_order" || reason === "retired_boot" ? "out_of_order" : "invalid"]++;
    return { accepted: false, reason, revision: this.state.revision };
  }

  ingest(topic, payload, receivedAt = this.now()) {
    if (!Number.isSafeInteger(receivedAt) || receivedAt < 1) throw new Error("Waktu penerimaan tidak valid.");
    const before = clone(this.state);
    try {
      return this.store.transaction(() => {
        this.state.stats.received++;
        const result = this.process(topic, payload, receivedAt);
        this.store.saveState(this.state);
        return result;
      });
    } catch (error) { this.state = before; throw error; }
  }

  process(topic, payload, receivedAt) {
    const parsed = C.parseTopic(topic, this.projectId);
    if (!parsed || parsed.kind !== "telemetry") return this.reject("topic_invalid", receivedAt);
    let raw;
    try {
      const text = typeof payload === "string" || Buffer.isBuffer(payload) ? String(payload) : JSON.stringify(payload);
      if (Buffer.byteLength(text) > 32768) return this.reject("payload_too_large", receivedAt);
      raw = JSON.parse(text);
    } catch (_) { return this.reject("json_invalid", receivedAt); }
    if (raw?.source === "demo" || raw?.mode === "contoh-lokal") return this.reject("demo_excluded", receivedAt, { device_id: parsed.deviceId });
    if (raw?.mode != null && raw.mode !== "pengukuran-perangkat") return this.reject("mode_invalid", receivedAt, { device_id: parsed.deviceId });
    if (raw?.project_id != null && raw.project_id !== this.projectId) return this.reject("project_mismatch", receivedAt, { device_id: parsed.deviceId });
    const value = C.validateTelemetry(raw, parsed.deviceId, receivedAt);
    if (!value) return this.reject("telemetry_invalid", receivedAt, { device_id: parsed.deviceId });
    if (value.broker_endpoint !== this.brokerEndpoint) return this.reject("broker_mismatch", receivedAt, { device_id: parsed.deviceId });
    const row = { ...value, mode: "pengukuran-perangkat", project_id: this.projectId };
    const key = M.contextKey(row), qkey = qualityKey(row);
    const id = hash([key, row.boot_id, row.sequence]);
    if (this.store.hasMeasurement(id)) return this.reject("duplicate", receivedAt, { device_id: row.device_id, context_key: key, measurement_id: id });
    const p = this.profile(row), q = this.qualityProfile(row), last = p.rows.at(-1);
    const boot = p.boots[row.boot_id];
    const reason = boot?.retired ? "retired_boot" : (last && row.sent_at_ms <= last.sent_at_ms) ||
      (boot && row.sequence <= boot.sequence) ? "out_of_order" : null;
    const timely = receivedAt - row.sent_at_ms <= row.interval_s * 2500;
    const measurement = { ...row, id, measurement_id: id, context_key: key, quality_context_key: qkey,
      status: reason ? "excluded" : "accepted", reason: reason || (timely ? null : "late_delivery"),
      live_eligible: !reason && timely };
    this.store.measurement(measurement);
    if (reason) return this.reject(reason, receivedAt, { device_id: row.device_id, context_key: key, measurement_id: id });
    if (!timely) this.state.stats.late++;
    row.measurement_id = id;
    if (last && last.boot_id !== row.boot_id) p.boots[last.boot_id].retired = true;
    p.boots[row.boot_id] = { sequence: row.sequence, retired: false };
    this.resolvePrediction(p, row, timely);
    this.resolveQuality(q, row, timely);
    p.rows.push(compact(row)); p.rows = p.rows.slice(-this.policy.buffer_rows); p.total_accepted++;
    q.rows.push(compact(row)); q.rows = q.rows.slice(-this.policy.buffer_rows); q.total_accepted++;
    this.state.stats.accepted++;
    if (!row.probe_ok) this.state.stats.timeouts++;
    const classification = K.classify(q.model, row);
    if (classification.cluster_index === null) { q.unknown++; this.state.stats.unknown_profiles++; }
    else q.counts[classification.cluster_index]++;
    this.maintainRidge(p, receivedAt);
    this.maintainQuality(q, receivedAt);
    // Fitting and database work take time. Never backdate a forecast to the
    // receipt time of its input when computation finishes later.
    this.createPrediction(p, Math.max(receivedAt, this.now()), timely);
    return { accepted: true, measurement_id: id, context_key: key, quality_context_key: qkey,
      reason: timely ? null : "late_delivery", revision: this.state.revision,
      model_id: p.model.model_id, method: p.method, cluster_model_id: q.model.model_id };
  }

  resolvePrediction(p, row, timely) {
    const prediction = p.pending;
    p.pending = null;
    if (!prediction) return;
    prediction.target_at_ms = row.sent_at_ms;
    prediction.target_received_at_ms = row.received_at_ms;
    prediction.target_measurement_id = row.measurement_id;
    prediction.actual_ms = row.latency_ms;
    const dt = row.sent_at_ms - prediction.input_end_ms;
    const reason = row.boot_id !== prediction.target_boot_id ? "reboot" : row.sequence !== prediction.target_sequence ? "sequence_gap"
      : dt < row.interval_s * 500 || dt > row.interval_s * 2500 ? "time_gap" : !row.probe_ok ? "timeout"
        : !timely ? "late_target" : row.sent_at_ms <= prediction.created_at_ms || row.received_at_ms <= prediction.created_at_ms ? "target_not_after_prediction" : null;
    prediction.status = reason ? "excluded" : "valid";
    prediction.reason = reason;
    if (reason) { this.state.stats.excluded_predictions++; this.store.update("predictions", prediction); return; }
    prediction.errors_ms = {};
    for (const method of [...METHODS, "ridge", ...(prediction.candidate_ms != null ? ["candidate"] : [])])
      prediction.errors_ms[method] = Math.abs(row.latency_ms - prediction[method + "_ms"]);
    this.store.update("predictions", prediction);
    this.state.stats.valid_targets++;
    p.block.push({ id: prediction.id, target_at_ms: row.sent_at_ms, errors_ms: prediction.errors_ms,
      model_id: prediction.model_id, method: prediction.method, revision: prediction.revision });
    if (p.block.length === this.policy.block_n) {
      const ids = [...new Set(p.block.map((r) => r.model_id))], methods = [...new Set(p.block.map((r) => r.method))], revisions = [...new Set(p.block.map((r) => r.revision))];
      const block = { id: crypto.randomUUID(), context_key: p.key, ...identity(p.key), start_ms: p.block[0].target_at_ms,
        end_ms: p.block.at(-1).target_at_ms, created_at_ms: row.received_at_ms, n: p.block.length,
        prediction_ids: p.block.map((r) => r.id), model_ids: ids, methods, revisions,
        mixed_versions: ids.length > 1 || methods.length > 1 || revisions.length > 1,
        mae_ms: Object.fromEntries(METHODS.map((m) => [m, p.block.reduce((s, r) => s + r.errors_ms[m], 0) / p.block.length])),
        frozen_model_id: this.state.frozen_ridge.model_id, unit: "ms", window: M.WINDOW,
        policy_version: this.policy.version,
        note: "Blok target valid tidak tumpang tindih; seluruh metode memakai target yang sama. MAE tidak mencakup timeout." };
      this.store.insert("blocks", block); p.block = [];
    }
    const c = p.candidate;
    if (!c || prediction.candidate_id !== c.id || row.sent_at_ms <= c.cutoff_ms || row.received_at_ms <= c.created_at_ms) return;
    c.n++; c.target_ids.push(row.measurement_id); c.prediction_ids.push(prediction.id);
    for (const name of ["candidate", "incumbent", "ridge", "persistence", "moving_average"])
      c.error_sums[name] += prediction.errors_ms[name === "incumbent" ? "active" : name];
    if (c.n < c.required) { this.store.update("candidates", c); return; }
    c.mae_ms = Object.fromEntries(Object.entries(c.error_sums).map(([k, value]) => [k, value / c.n]));
    const best = Math.min(c.mae_ms.incumbent, c.mae_ms.persistence, c.mae_ms.moving_average);
    Object.assign(c, promotionDecision(c.mae_ms.candidate, best, c.policy.margin));
    c.best_ms = best; c.completed_at_ms = row.received_at_ms; c.through_ms = row.sent_at_ms;
    c.status = c.promoted ? "promoted" : "rejected";
    const oldMethod = p.method;
    if (c.promoted) {
      p.model = clone(c.model); p.method = "ridge"; p.trained_at_ms = c.trained_at_ms; p.promoted_at_ms = row.received_at_ms;
    } else {
      const baseline = c.mae_ms.persistence <= c.mae_ms.moving_average ? "persistence" : "moving_average";
      if (promotionDecision(c.mae_ms[baseline], c.mae_ms.incumbent, c.policy.margin).promoted) p.method = baseline;
      else if (c.mae_ms.ridge < Math.min(c.mae_ms.incumbent, c.mae_ms.persistence, c.mae_ms.moving_average) &&
          promotionDecision(c.mae_ms.ridge, c.mae_ms.incumbent, c.policy.margin).promoted) p.method = "ridge";
    }
    if (c.promoted || oldMethod !== p.method) { this.changed(row.received_at_ms); p.revision = this.state.revision; }
    c.active_method_after = p.method; c.active_model_id_after = p.model.model_id;
    this.store.update("candidates", c);
    this.event(c.promoted ? "ridge_promoted" : "ridge_rejected", p.key, { candidate_id: c.id, model_id: p.model.model_id,
      candidate_model_id: c.model_id, method: p.method, reason: c.reason, revision: this.state.revision }, row.received_at_ms);
    if (oldMethod !== p.method) this.event("method_changed", p.key, { previous_method: oldMethod, method: p.method,
      model_id: p.model.model_id, reason: "Metode dipilih dari evaluasi pada target yang sama.", revision: this.state.revision }, row.received_at_ms);
    p.last_evaluation = clone(c); p.last_training = { id: c.id, status: c.status, reason: c.reason, at_ms: c.completed_at_ms }; p.candidate = null;
  }

  resolveQuality(q, row, timely) {
    const c = q.candidate;
    // Both clocks must pass the freeze boundary. Cross-device delayed observations
    // can enter the training archive, but can never become future test evidence.
    if (!c || !timely || row.sent_at_ms <= c.cutoff_ms || row.received_at_ms <= c.created_at_ms) return;
    const candidate = K.distance(c.model, row), incumbent = K.distance(q.model, row);
    if (candidate == null || incumbent == null) return;
    c.n++; c.target_ids.push(row.measurement_id);
    c.distances.push({ measurement_id: row.measurement_id, at_ms: row.sent_at_ms,
      candidate_squared_distance: candidate, incumbent_squared_distance: incumbent });
    c.error_sums.candidate += candidate; c.error_sums.incumbent += incumbent;
    if (c.n < c.required) { this.store.update("candidates", c); return; }
    c.candidate_mean_squared_distance = c.error_sums.candidate / c.n;
    c.incumbent_mean_squared_distance = c.error_sums.incumbent / c.n;
    Object.assign(c, promotionDecision(c.candidate_mean_squared_distance, c.incumbent_mean_squared_distance, c.policy.margin));
    c.completed_at_ms = row.received_at_ms; c.through_ms = row.sent_at_ms; c.status = c.promoted ? "promoted" : "rejected";
    c.note = "Jarak kuadrat rata-rata pada transformasi fitur tetap; bukan akurasi label dan bukan MAE.";
    if (c.promoted) {
      q.model = clone(c.model); q.trained_at_ms = c.trained_at_ms; q.promoted_at_ms = row.received_at_ms;
      q.counts = [0, 0, 0]; q.unknown = 0;
      this.changed(row.received_at_ms); q.revision = this.state.revision;
    }
    c.active_model_id_after = q.model.model_id;
    this.store.update("candidates", c);
    this.event(c.promoted ? "kmeans_promoted" : "kmeans_rejected", q.key, { candidate_id: c.id, model_id: q.model.model_id,
      candidate_model_id: c.model_id, reason: c.reason, revision: this.state.revision }, row.received_at_ms);
    q.last_evaluation = clone(c); q.last_training = { id: c.id, status: c.status, reason: c.reason, at_ms: c.completed_at_ms }; q.candidate = null;
  }

  trainingRecord(p, algorithm, now) {
    return { id: crypto.randomUUID(), algorithm, context_key: p.key, ...identity(p.key),
      quality_context_key: algorithm === "kmeans" ? p.key : qualityKey(p.rows.at(-1)),
      created_at_ms: now, trained_at_ms: null, completed_at_ms: null,
      cutoff_ms: Math.max(now, ...p.rows.map((r) => r.sent_at_ms)), status: "evaluating", n: 0,
      required: this.policy.evaluate_n, policy: clone(this.policy), code_version: CODE_VERSION,
      training_measurement_ids: p.rows.map((r) => r.measurement_id), training_rows: p.rows.length,
      training_start_ms: Math.min(...p.rows.map((r) => r.sent_at_ms)), training_end_ms: Math.max(...p.rows.map((r) => r.sent_at_ms)),
      target_ids: [], prediction_ids: [], incumbent_model_id: p.model.model_id, incumbent_method: p.method || "kmeans",
      model_id: null, model: null, report: null, mae_ms: null, threshold: null, improvement_pct: null, reason: null,
      error_sums: algorithm === "ridge" ? { candidate: 0, incumbent: 0, ridge: 0, persistence: 0, moving_average: 0 }
        : { candidate: 0, incumbent: 0 }, ...(algorithm === "kmeans" ? { distances: [] } : {}) };
  }

  maintainRidge(p, now) {
    if (p.candidate || p.rows.length < this.policy.ridge_min_rows || p.total_accepted - p.last_attempt < this.policy.retry_rows) return;
    p.last_attempt = p.total_accepted;
    const c = this.trainingRecord(p, "ridge", now);
    try {
      const result = M.trainContexts(p.rows), frozenAt = Math.max(now, this.now());
      c.training_started_at_ms = now; c.created_at_ms = frozenAt; c.cutoff_ms = Math.max(c.cutoff_ms, frozenAt);
      c.model = result.model; c.model_id = result.model.model_id; c.report = result.report; c.trained_at_ms = frozenAt;
      this.archiveModel(c.model, p.key, frozenAt, "candidate_training");
      p.candidate = c;
    } catch (error) { c.status = "training_failed"; c.completed_at_ms = now; c.reason = String(error.message).slice(0, 300); }
    this.store.insert("candidates", c); p.last_training = { id: c.id, status: c.status, reason: c.reason, at_ms: now };
    this.event(c.status === "training_failed" ? "ridge_training_failed" : "ridge_trained", p.key,
      { candidate_id: c.id, model_id: c.model_id, reason: c.reason, training_rows: c.training_rows, policy_version: this.policy.version }, now);
  }

  maintainQuality(q, now) {
    if (q.candidate || q.rows.length < this.policy.cluster_min_rows || q.total_accepted - q.last_attempt < this.policy.retry_rows) return;
    q.last_attempt = q.total_accepted;
    const c = this.trainingRecord(q, "kmeans", now);
    try {
      c.model = K.train(q.rows, { contextKey: q.key });
      const frozenAt = Math.max(now, this.now());
      c.training_started_at_ms = now; c.created_at_ms = frozenAt; c.cutoff_ms = Math.max(c.cutoff_ms, frozenAt);
      c.model_id = c.model.model_id; c.trained_at_ms = frozenAt;
      c.report = { trained_rows: c.model.trained_rows, ignored_rows: c.model.ignored_rows,
        counts: clone(c.model.counts), inertia: c.model.inertia, transform: c.model.transform, features: clone(c.model.features) };
      this.archiveModel(c.model, q.key, frozenAt, "candidate_training"); q.candidate = c;
    } catch (error) { c.status = "training_failed"; c.completed_at_ms = now; c.reason = String(error.message).slice(0, 300); }
    this.store.insert("candidates", c); q.last_training = { id: c.id, status: c.status, reason: c.reason, at_ms: now };
    this.event(c.status === "training_failed" ? "kmeans_training_failed" : "kmeans_trained", q.key,
      { candidate_id: c.id, model_id: c.model_id, reason: c.reason, training_rows: c.training_rows, policy_version: this.policy.version }, now);
  }

  createPrediction(p, now, timely) {
    if (!timely) return;
    const rows = p.rows.slice(-M.WINDOW), f = M.forecastContext(p.model, rows), frozen = M.forecastContext(this.state.frozen_ridge, rows);
    if (f.status !== "ready" || frozen.status !== "ready") return;
    const c = p.candidate && M.forecastContext(p.candidate.model, rows);
    const candidateReady = c?.status === "ready";
    const prediction = { id: crypto.randomUUID(), context_key: p.key, ...identity(p.key), created_at_ms: now,
      input_end_ms: f.based_on_ms, input_measurement_ids: rows.map((r) => r.measurement_id),
      target_boot_id: f.based_on_boot_id, target_sequence: f.based_on_sequence + 1,
      expected_target_ms: f.forecast_for_ms, target_at_ms: null, target_received_at_ms: null, target_measurement_id: null,
      actual_ms: null, active_ms: methodValue(f, p.method), frozen_ms: frozen.ml_prediction_ms,
      persistence_ms: f.persistence_ms, moving_average_ms: f.moving_average_ms, ridge_ms: f.ml_prediction_ms,
      candidate_ms: candidateReady ? c.ml_prediction_ms : null, candidate_id: candidateReady ? p.candidate.id : null,
      candidate_model_id: candidateReady ? p.candidate.model_id : null, model_id: p.model.model_id,
      frozen_model_id: this.state.frozen_ridge.model_id, revision: p.revision, method: p.method,
      status: "pending", reason: null, errors_ms: null, unit: "ms", window: M.WINDOW, policy_version: this.policy.version };
    this.store.insert("predictions", prediction); p.pending = prediction;
  }

  snapshot() {
    const now = this.now();
    const contexts = Object.values(this.state.profiles).map((p) => {
      const last = p.rows.at(-1), stale = !last ||
        Math.max(now - last.received_at_ms, now - last.sent_at_ms) > Math.max(30000, last.interval_s * 3000);
      const f = p.pending && !stale ? { status: "ready", prediction_ms: p.pending.active_ms, method: p.pending.method,
        model_id: p.pending.model_id, provenance: p.model.provenance, horizon_s: last.interval_s,
        based_on_ms: p.pending.input_end_ms, based_on_boot_id: p.pending.target_boot_id,
        based_on_sequence: p.pending.target_sequence - 1, forecast_for_ms: p.pending.expected_target_ms,
        prediction_id: p.pending.id, created_at_ms: p.pending.created_at_ms }
        : { status: stale ? "stale" : "warming_up", reason: stale ? "Perangkat belum mengirim data terkini." : "Menunggu enam RTT valid berurutan." };
      return { key: p.key, context_key: p.key, ...identity(p.key), rows: p.rows.length, total_accepted: p.total_accepted,
        model_id: p.model.model_id, provenance: p.model.provenance, method: p.method, revision: p.revision,
        stale, latest: last ? clone(last) : null, forecast: f,
        candidate: p.candidate ? { id: p.candidate.id, model_id: p.candidate.model_id, n: p.candidate.n, required: p.candidate.required,
          status: p.candidate.status, trained_at_ms: p.candidate.trained_at_ms } : null,
        last_evaluation: p.last_evaluation ? this.evaluationSummary(p.last_evaluation) : null, last_training: p.last_training,
        incomplete_block_n: p.block.length, trained_at_ms: p.trained_at_ms, promoted_at_ms: p.promoted_at_ms };
    });
    const quality_contexts = Object.values(this.state.quality_profiles).map((q) => ({ key: q.key, context_key: q.key, ...identity(q.key),
      rows: q.rows.length, total_accepted: q.total_accepted, model_id: q.model.model_id, provenance: q.model.provenance,
      revision: q.revision, counts: clone(q.counts), unknown: q.unknown,
      counts_note: "Keanggotaan dihitung saat sampel tiba sejak aktivasi model K-Means ini; bukan label kebenaran.",
      candidate: q.candidate ? { id: q.candidate.id, model_id: q.candidate.model_id, n: q.candidate.n, required: q.candidate.required,
        status: q.candidate.status, trained_at_ms: q.candidate.trained_at_ms } : null,
      last_evaluation: q.last_evaluation ? this.evaluationSummary(q.last_evaluation) : null, last_training: q.last_training,
      trained_at_ms: q.trained_at_ms, promoted_at_ms: q.promoted_at_ms }));
    return { schema: "sigheat-central-status-v1", code_version: CODE_VERSION, project_id: this.projectId,
      broker_endpoint: this.brokerEndpoint, at_ms: now, revision: this.state.revision, generated_at_ms: this.state.generated_at_ms,
      policy: clone(this.policy), stats: clone(this.state.stats), contexts, quality_contexts,
      active_devices: new Set(contexts.filter((p) => !p.stale).map((p) => p.device_id)).size,
      frozen_model_id: this.state.frozen_ridge.model_id,
      retention: "Raw pengukuran dan audit tidak dihapus otomatis. Buffer training dibatasi per konteks; cadangkan database secara berkala." };
  }

  evaluationSummary(c) {
    const out = clone(c);
    for (const key of ["model", "report", "error_sums", "training_measurement_ids", "prediction_ids", "target_ids", "distances"]) delete out[key];
    return out;
  }

  history(filters = {}) {
    let sharedQualityContext = null, contextKeys = null;
    const selected = filters.context_key || filters.context;
    if (selected) {
      try {
        const key = JSON.parse(selected);
        if (Array.isArray(key) && key.length === 6) {
          sharedQualityContext = JSON.stringify([key[0], key[2], key[3], key[4]]);
          contextKeys = [selected, sharedQualityContext];
        }
      } catch (_) { /* A nonmatching context simply produces an empty result. */ }
    }
    const result = Object.fromEntries(["predictions", "blocks", "candidates", "events", "models"].map((table) => [table,
      this.store.select(table, filters, ["candidates", "events", "models"].includes(table) ? { contextKeys, sharedQualityContext } : {})]));
    result.clusterEvaluations = this.store.select("candidates", { ...filters, algorithm: "kmeans", statuses: ["promoted", "rejected"] }, { contextKeys, sharedQualityContext });
    const candidates = result.candidates.records;
    const total_counts = Object.fromEntries(Object.entries(result).map(([name, page]) => [name, page.total]));
    const returned_counts = Object.fromEntries(Object.entries(result).map(([name, page]) => [name, page.records.length]));
    const truncated_types = Object.entries(result).filter(([, page]) => page.truncated).map(([name]) => name);
    return { schema: "sigheat-central-history-v1", generated_at_ms: this.now(), project_id: this.projectId,
      units: { rtt: "ms", mae: "ms", cluster_distance: "squared_distance_fixed_transform" },
      window: M.WINDOW, block_n: this.policy.block_n, policy: clone(this.policy), filters: clone(filters),
      total_counts, returned_counts, truncated: truncated_types.length > 0, truncated_types,
      shared_quality_context: sharedQualityContext,
      predictions: result.predictions.records, blocks: result.blocks.records, candidates,
      events: result.events.records, models: result.models.records, clusterEvaluations: result.clusterEvaluations.records };
  }

  measurements(filters = {}) { return this.store.select("measurements", filters).records; }
  rejections() { return this.store.all("rejections"); }

  modelBundle() {
    return { schema: "sigheat-central-models-v1", revision: this.state.revision, generated_at_ms: this.state.generated_at_ms,
      code_version: CODE_VERSION, project_id: this.projectId, policy: clone(this.policy),
      profiles: Object.values(this.state.profiles).map((p) => ({ context_key: p.key, model: clone(p.model), method: p.method,
        trained_at_ms: p.trained_at_ms, promoted_at_ms: p.promoted_at_ms, revision: p.revision })),
      clusters: Object.values(this.state.quality_profiles).map((q) => ({ context_key: q.key, model: clone(q.model),
        trained_at_ms: q.trained_at_ms, promoted_at_ms: q.promoted_at_ms, revision: q.revision })),
      frozen_ridge: clone(this.state.frozen_ridge), frozen_clusters: clone(this.state.frozen_clusters) };
  }

  rollbackModels(bundle, reason = "Rollback operator ke parameter model tersimpan.") {
    if (!bundle || bundle.schema !== "sigheat-central-models-v1" || bundle.project_id !== this.projectId ||
        !Array.isArray(bundle.profiles) || !Array.isArray(bundle.clusters)) throw new Error("Paket rollback tidak valid.");
    for (const p of bundle.profiles) {
      if (!this.state.profiles[p.context_key] || !M.validateContextModel(p.model) || !["ridge", "persistence", "moving_average"].includes(p.method) ||
          (p.model.scope === "context" && p.model.context_key !== p.context_key)) throw new Error("Konteks/model Ridge rollback tidak cocok.");
    }
    for (const q of bundle.clusters) {
      if (!this.state.quality_profiles[q.context_key] || !K.validateModel(q.model) ||
          (q.model.context_key && q.model.context_key !== q.context_key)) throw new Error("Konteks/model K-Means rollback tidak cocok.");
    }
    const before = clone(this.state), now = this.now();
    try {
      this.store.transaction(() => {
        this.changed(now);
        for (const p of Object.values(this.state.profiles)) {
          if (p.pending) { p.pending.status = "excluded"; p.pending.reason = "operator_rollback"; this.store.update("predictions", p.pending); p.pending = null; this.state.stats.excluded_predictions++; }
          if (p.candidate) { p.candidate.status = "cancelled"; p.candidate.completed_at_ms = now; p.candidate.reason = "Evaluasi dibatalkan oleh rollback operator."; this.store.update("candidates", p.candidate); p.candidate = null; }
        }
        for (const q of Object.values(this.state.quality_profiles)) {
          if (q.candidate) { q.candidate.status = "cancelled"; q.candidate.completed_at_ms = now; q.candidate.reason = "Evaluasi dibatalkan oleh rollback operator."; this.store.update("candidates", q.candidate); q.candidate = null; }
        }
        for (const item of bundle.profiles) {
          const p = this.state.profiles[item.context_key];
          p.model = clone(item.model); p.method = item.method; p.revision = this.state.revision;
          p.trained_at_ms = item.trained_at_ms ?? null; p.promoted_at_ms = now;
          this.archiveModel(p.model, p.key, now, "rollback");
        }
        for (const item of bundle.clusters) {
          const q = this.state.quality_profiles[item.context_key];
          q.model = clone(item.model); q.revision = this.state.revision; q.trained_at_ms = item.trained_at_ms ?? null;
          q.promoted_at_ms = now; q.counts = [0, 0, 0]; q.unknown = 0; this.archiveModel(q.model, q.key, now, "rollback");
        }
        this.event("operator_rollback", null, { reason: String(reason).slice(0, 300), revision: this.state.revision,
          restored_revision: bundle.revision, restored_models: [...bundle.profiles, ...bundle.clusters].map((p) => p.model.model_id) }, now);
        this.store.saveState(this.state);
      });
    } catch (error) { this.state = before; throw error; }
    return this.modelBundle();
  }

  async backup(destination) { return this.store.backup(destination); }
  close() { this.store.close(); }
}

module.exports = { CentralEngine, POLICY, CODE_VERSION, promotionDecision, matchRecord };
