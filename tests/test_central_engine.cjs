"use strict";

const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { CentralEngine, promotionDecision } = require("../server/engine.cjs");
const M = require("../assets/ml.js"), K = require("../assets/clusters.js");

// Deterministic SOFTWARE TEST fixtures. Renaming source exercises measured
// routing; these are never shipped as field observations or real model evidence.
const START = Date.UTC(2026, 10, 6), BROKER = "wss://example.invalid/mqtt";
function fixture(n = 240, overrides = {}) {
  return M.generateDemoRows(n).map((r, i) => ({ ...r, project_id: "test", device_id: "hp-a", boot_id: "test-boot-a",
    source: "browser", mode: "pengukuran-perangkat", sent_at_ms: START + i * 5000,
    latency_ms: 100 + i * 3, latency_mean_ms: 100 + i * 3, latency_std_ms: 2 + i / 30, ...overrides }));
}
function setup(options = {}) {
  let clock = START;
  const engine = new CentralEngine({ projectId: "test", brokerEndpoint: BROKER, now: () => clock, ...options });
  const push = (row, at = row.sent_at_ms + 10) => { clock = at; return engine.ingest(`sigheat/test/edge/${row.device_id}/telemetry`, row, at); };
  const feed = (rows) => rows.forEach((r) => assert.equal(push(r).accepted, true));
  return { engine, push, feed, clock: (at) => { clock = at; } };
}
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sigheat-central-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, "private.sqlite");
}

test("central engine accepts several devices once and keeps Ridge context separate", (t) => {
  const x = setup(); t.after(() => x.engine.close());
  const a = fixture(20), b = a.map((r) => ({ ...r, device_id: "hp-b", sent_at_ms: r.sent_at_ms + 100 }));
  for (let i = 0; i < a.length; i++) { x.feed([a[i], b[i]]); }
  const s = x.engine.snapshot();
  assert.equal(s.contexts.length, 2); assert.equal(s.quality_contexts.length, 1);
  assert.deepEqual(s.contexts.map((p) => p.total_accepted), [20, 20]);
  assert.equal(x.push(a.at(-1)).reason, "duplicate");
  assert.equal(x.push({ ...a.at(-1), latency_ms: 6000 }).reason, "duplicate");
  assert.equal(x.engine.measurements().length, 40);
  assert.equal(x.engine.snapshot().stats.duplicates, 2);
  const changed = { ...a.at(-1), source: "termux", interval_s: 10, boot_id: "other", sequence: 1, sent_at_ms: a.at(-1).sent_at_ms + 1000 };
  x.feed([changed]);
  assert.equal(x.engine.snapshot().contexts.length, 3);
  assert.equal(x.engine.snapshot().quality_contexts.length, 2);
});

test("demo, malformed, wrong topic identity and wrong context cannot become central real data", (t) => {
  const x = setup(); t.after(() => x.engine.close()); const row = fixture(1)[0];
  assert.equal(x.push({ ...row, source: "demo" }).reason, "demo_excluded");
  assert.equal(x.push({ ...row, project_id: "elsewhere" }).reason, "project_mismatch");
  assert.equal(x.push({ ...row, broker_endpoint: "wss://other.invalid/mqtt" }).reason, "broker_mismatch");
  assert.equal(x.push({ ...row, mode: "unexpected" }).reason, "mode_invalid");
  assert.equal(x.engine.ingest("sigheat/test/edge/hp-b/telemetry", row, row.sent_at_ms + 10).reason, "telemetry_invalid");
  assert.equal(x.engine.ingest("sigheat/test/edge/hp-a/telemetry", "{broken", row.sent_at_ms + 10).reason, "json_invalid");
  assert.equal(x.engine.ingest("sigheat/test/edge/hp-a/telemetry", "x".repeat(33000), row.sent_at_ms + 10).reason, "payload_too_large");
  assert.equal(x.engine.measurements().length, 0); assert.equal(x.engine.snapshot().stats.accepted, 0);
  assert.equal(x.engine.rejections().length, 7);
});

test("forecasts are saved before targets and reported MAE is recomputable from identical targets", (t) => {
  const x = setup(); t.after(() => x.engine.close()); const rows = fixture(160);
  x.feed(rows.slice(0, 6));
  const pending = x.engine.history().predictions[0];
  assert.equal(pending.status, "pending"); assert.equal(pending.actual_ms, null);
  assert.equal(pending.target_sequence, 7); assert.equal(pending.created_at_ms, rows[5].sent_at_ms + 10);
  const frozen = x.engine.modelBundle().frozen_ridge;
  assert.equal(pending.frozen_ms, M.forecastContext(frozen, rows.slice(0, 6)).prediction_ms);
  x.feed(rows.slice(6, 120));
  const completedBefore = x.engine.history().predictions.filter((r) => r.status === "valid");
  const blocksBefore = x.engine.history().blocks;
  x.feed(rows.slice(120));
  const h = x.engine.history(), byId = new Map(h.predictions.map((r) => [r.id, r])), seen = new Set();
  assert.deepEqual(h.predictions.filter((r) => completedBefore.some((a) => a.id === r.id)), completedBefore);
  assert.deepEqual(h.blocks.slice(0, blocksBefore.length), blocksBefore);
  for (const block of h.blocks) {
    assert.equal(block.n, 24);
    for (const id of block.prediction_ids) { assert.equal(seen.has(id), false); seen.add(id); }
    for (const method of ["active", "frozen", "persistence", "moving_average"]) {
      const mae = block.prediction_ids.reduce((s, id) => s + Math.abs(byId.get(id).actual_ms - byId.get(id)[method + "_ms"]), 0) / block.n;
      assert.equal(block.mae_ms[method], mae);
    }
  }
  assert.ok(h.blocks.some((b) => b.mixed_versions));
  for (const r of h.predictions.filter((r) => r.status === "valid")) {
    assert.ok(r.created_at_ms < r.target_at_ms); assert.ok(r.created_at_ms < r.target_received_at_ms);
    assert.equal(r.input_measurement_ids.length, 6);
  }
  assert.deepEqual(x.engine.modelBundle().frozen_ridge, frozen);
});

test("candidate parameters freeze while 24 new targets decide promotion", (t) => {
  const x = setup(); t.after(() => x.engine.close()); const rows = fixture(145);
  x.feed(rows.slice(0, 120));
  const initial = x.engine.history().candidates.find((c) => c.algorithm === "ridge");
  assert.equal(initial.n, 0); assert.equal(initial.report.rows.total, 120);
  assert.deepEqual(initial.model, M.trainContexts(rows.slice(0, 120)).model);
  x.feed(rows.slice(120, 143));
  const evaluated = x.engine.history().candidates.find((c) => c.id === initial.id);
  assert.equal(evaluated.n, 23); assert.equal(evaluated.status, "evaluating");
  assert.deepEqual(evaluated.model, initial.model);
  x.feed(rows.slice(143, 144));
  const decision = x.engine.history().candidates.find((c) => c.id === initial.id);
  assert.equal(decision.n, 24); assert.equal(decision.status, "promoted");
  assert.equal(decision.target_ids.length, 24);
  assert.equal(decision.prediction_ids.length, 24);
  assert.ok(decision.target_ids.every((id) => !decision.training_measurement_ids.includes(id)));
  assert.equal(x.engine.snapshot().contexts[0].model_id, decision.model_id);
  assert.ok(decision.mae_ms.candidate <= decision.threshold);
});

test("margin includes exactly 5 percent and strict improvement excludes a zero reference", () => {
  assert.equal(promotionDecision(19, 20).promoted, true);
  assert.equal(promotionDecision(19.01, 20).promoted, false);
  assert.equal(promotionDecision(21, 20).promoted, false);
  assert.equal(promotionDecision(0, 0).promoted, false);
  assert.equal(promotionDecision(0, 0).improvement_pct, null);
  assert.equal(promotionDecision(0, 20).improvement_pct, 100);
  assert.throws(() => promotionDecision(NaN, 20));
});

test("rejection and selection of perfect persistence are archived as a baseline method change", (t) => {
  const x = setup(); t.after(() => x.engine.close());
  x.feed(fixture(150, { latency_ms: 100, latency_mean_ms: 100, latency_std_ms: 1 }));
  const h = x.engine.history(), c = h.candidates.find((r) => r.algorithm === "ridge");
  assert.equal(c.status, "rejected"); assert.equal(c.mae_ms.persistence, 0);
  assert.equal(x.engine.snapshot().contexts[0].method, "persistence");
  assert.ok(h.events.some((e) => e.type === "method_changed" && e.method === "persistence"));
  assert.ok(h.candidates.some((r) => r.algorithm === "kmeans" && r.status === "training_failed"));
  assert.equal(x.engine.snapshot().contexts[0].forecast.prediction_ms, 100);
});

test("timeouts, gaps, late data and reboot stay visible and cannot create a zero error target", (t) => {
  const x = setup(); t.after(() => x.engine.close()); const rows = fixture(50);
  x.feed(rows.slice(0, 6));
  x.feed([{ ...rows[6], probe_ok: false, latency_ms: null }]);
  let first = x.engine.history().predictions[0];
  assert.equal(first.status, "excluded"); assert.equal(first.reason, "timeout");
  assert.equal(first.actual_ms, null); assert.equal(first.errors_ms, null);
  x.feed(rows.slice(7, 13));
  x.feed([rows[14]]);
  assert.ok(x.engine.history().predictions.some((p) => p.reason === "sequence_gap"));
  x.feed(rows.slice(15, 21));
  x.push(rows[21], rows[21].sent_at_ms + 20000);
  assert.ok(x.engine.history().predictions.some((p) => p.reason === "late_target"));
  assert.equal(x.engine.snapshot().stats.late, 1);
  assert.equal(x.push(rows[13], rows[22].sent_at_ms + 10).reason, "out_of_order");
  x.feed(rows.slice(22, 28));
  const reboot = rows.slice(28, 35).map((r, i) => ({ ...r, boot_id: "boot-2", sequence: i + 1 }));
  x.feed(reboot.slice(0, 6));
  assert.ok(x.engine.history().predictions.some((p) => p.reason === "reboot"));
  const fresh = x.engine.history().predictions.at(-1);
  assert.equal(fresh.target_boot_id, "boot-2"); assert.equal(fresh.target_sequence, 7);
  assert.equal(x.push({ ...rows[35], sequence: 90 }).reason, "retired_boot");
  assert.equal(x.engine.snapshot().stats.timeouts, 1);
});

test("cross-device clustering checks the measurement and receiver freeze cutoff", (t) => {
  const x = setup(); t.after(() => x.engine.close());
  const profiles = [[100, 8, 98], [460, 70, 92], [1900, 440, 70]];
  const rows = fixture(120).map((r, i) => ({ ...r, latency_ms: profiles[i % 3][0] + i % 7,
    latency_std_ms: profiles[i % 3][1] + i % 5, success_pct: profiles[i % 3][2] }));
  x.feed(rows.slice(0, 90));
  const candidate = x.engine.history().candidates.find((c) => c.algorithm === "kmeans");
  assert.equal(candidate.n, 0);
  const old = { ...rows[89], device_id: "hp-b", boot_id: "boot-b", sequence: 1, sent_at_ms: candidate.cutoff_ms - 1000 };
  assert.equal(x.push(old, candidate.created_at_ms + 10).accepted, true);
  assert.equal(x.engine.history().candidates.find((c) => c.id === candidate.id).n, 0);
  x.feed(rows.slice(90, 114));
  const c = x.engine.history().candidates.find((r) => r.id === candidate.id);
  assert.equal(c.n, 24); assert.equal(c.status, "promoted");
  assert.equal(c.target_ids.length, 24);
  assert.equal(c.candidate_mean_squared_distance, c.distances.reduce((s, d) => s + d.candidate_squared_distance, 0) / 24);
  assert.equal(c.incumbent_mean_squared_distance, c.distances.reduce((s, d) => s + d.incumbent_squared_distance, 0) / 24);
  assert.equal(c.report.transform, K.defaultModel().transform);
});

test("durable pending predictions and candidate counters survive restart without replaying old targets", (t) => {
  const file = temp(t), rows = fixture(150);
  let x = setup({ dbPath: file });
  x.feed(rows.slice(0, 130));
  const initial = x.engine.history().candidates.find((c) => c.algorithm === "ridge");
  assert.equal(initial.n, 10);
  const predictionBefore = x.engine.history().predictions.at(-1);
  x.engine.close();
  x = setup({ dbPath: file }); t.after(() => x.engine.close());
  assert.equal(x.engine.history().candidates.find((c) => c.id === initial.id).n, 10);
  assert.deepEqual(x.engine.history().predictions.at(-1), predictionBefore);
  assert.equal(x.push(rows[129]).reason, "duplicate");
  assert.equal(x.engine.history().candidates.find((c) => c.id === initial.id).n, 10);
  x.feed(rows.slice(130, 144));
  assert.equal(x.engine.history().candidates.find((c) => c.id === initial.id).n, 24);
  assert.equal(x.engine.snapshot().stats.accepted, 144);
  assert.ok(x.engine.history().events.some((e) => e.type === "service_restarted"));
  const continuous = setup(); t.after(() => continuous.engine.close()); continuous.feed(rows.slice(0, 144));
  assert.deepEqual(x.engine.history().candidates.find((c) => c.id === initial.id).mae_ms,
    continuous.engine.history().candidates.find((c) => c.algorithm === "ridge").mae_ms);
});

test("raw archive persists beyond training buffer and database has only one active writer", (t) => {
  const file = temp(t), x = setup({ dbPath: file, policy: { buffer_rows: 120 } }); t.after(() => x.engine.close());
  assert.throws(() => setup({ dbPath: file }), /satu penulis|layanan pusat lain/);
  x.feed(fixture(300));
  assert.equal(x.engine.snapshot().contexts[0].rows, 120);
  assert.equal(x.engine.snapshot().contexts[0].total_accepted, 300);
  assert.equal(x.engine.measurements().length, 300);
  assert.ok(x.engine.history().candidates.length > 4);
  assert.throws(() => new CentralEngine({ dbPath: file, projectId: "other", brokerEndpoint: BROKER }), /satu penulis|layanan pusat lain/);
});

test("parameter bundle excludes private raw data and arbitrary payload secrets", (t) => {
  const x = setup(); t.after(() => x.engine.close()); const rows = fixture(10).map((r) => ({ ...r,
    latitude: -7.25, longitude: 110.5, accuracy_m: 5, location_at_ms: r.sent_at_ms,
    password: "secret-test-password", note: "private-test-note" }));
  x.feed(rows);
  assert.equal(x.engine.measurements()[0].latitude, -7.25);
  for (const artifact of [x.engine.modelBundle(), x.engine.history(), x.engine.snapshot(), x.engine.measurements()]) {
    assert.equal(JSON.stringify(artifact).includes("secret-test-password"), false);
    assert.equal(JSON.stringify(artifact).includes("private-test-note"), false);
  }
  for (const artifact of [x.engine.modelBundle(), x.engine.history(), x.engine.snapshot()]) {
    assert.equal(JSON.stringify(artifact).includes('"latitude"'), false);
    assert.equal(JSON.stringify(artifact).includes('"longitude"'), false);
  }
  const old = x.engine.modelBundle(); old.profiles[0].model.coefficients[0] = 500;
  assert.notEqual(x.engine.modelBundle().profiles[0].model.coefficients[0], 500);
});

test("rollback creates a new revision without changing already-scored evidence or the frozen baseline", (t) => {
  const x = setup(); t.after(() => x.engine.close()); const rows = fixture(190);
  x.feed(rows.slice(0, 20)); const bootstrap = x.engine.modelBundle();
  x.feed(rows.slice(20, 190));
  const validBefore = x.engine.history().predictions.filter((r) => r.status === "valid"), before = x.engine.modelBundle();
  const after = x.engine.rollbackModels(bootstrap, "Software test rollback");
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.profiles[0].model.model_id, bootstrap.profiles[0].model.model_id);
  assert.deepEqual(after.frozen_ridge, bootstrap.frozen_ridge);
  assert.deepEqual(x.engine.history().predictions.filter((r) => r.status === "valid"), validBefore);
  assert.ok(x.engine.history().candidates.some((r) => r.status === "cancelled"));
  assert.equal(x.engine.measurements().length, 190);
  const bad = structuredClone(bootstrap); bad.profiles[0].model.coefficients = [1];
  assert.throws(() => x.engine.rollbackModels(bad));
  assert.deepEqual(x.engine.modelBundle(), after);
});

test("consistent SQLite backup restores audit data and model state", async (t) => {
  const file = temp(t), backupFile = file + ".backup", x = setup({ dbPath: file }); t.after(() => x.engine.close());
  x.feed(fixture(130));
  await x.engine.backup(backupFile);
  const restored = setup({ dbPath: backupFile }); t.after(() => restored.engine.close());
  assert.deepEqual(restored.engine.modelBundle(), x.engine.modelBundle());
  assert.deepEqual(restored.engine.history().predictions, x.engine.history().predictions);
  assert.equal(restored.engine.measurements().length, 130);
});

test("history filters preserve exact contexts and no silently capped export", (t) => {
  const x = setup(); t.after(() => x.engine.close()); const a = fixture(35), b = fixture(35, { device_id: "hp-b" });
  for (let i = 0; i < a.length; i++) x.feed([a[i], b[i]]);
  const key = M.contextKey(a[0]);
  const data = x.engine.history({ context_key: key, from: a[10].sent_at_ms, to: a[30].sent_at_ms });
  assert.ok(data.predictions.length > 0);
  assert.ok(data.predictions.every((r) => r.context_key === key && r.target_at_ms >= a[10].sent_at_ms && r.target_at_ms <= a[30].sent_at_ms));
  assert.equal(x.engine.measurements({ device_id: "hp-b" }).length, 35);
});

test("stale measurement delivery does not make a powered-off device look active", (t) => {
  const x = setup(); t.after(() => x.engine.close()); const row = fixture(1)[0];
  assert.equal(x.push(row, row.sent_at_ms + 60000).accepted, true);
  const status = x.engine.snapshot();
  assert.equal(status.active_devices, 0); assert.equal(status.contexts[0].stale, true);
  assert.equal(status.contexts[0].forecast.status, "stale");
});

test("computation timestamps are not backdated and old queued targets are excluded", (t) => {
  const x = setup(); t.after(() => x.engine.close()); const rows = fixture(8);
  x.feed(rows.slice(0, 5));
  // Simulate a blocked event loop: the next target was already measured while
  // computation for the prior input was still running.
  x.clock(rows[6].sent_at_ms + 100);
  x.engine.ingest("sigheat/test/edge/hp-a/telemetry", rows[5], rows[5].sent_at_ms + 10);
  const saved = x.engine.history().predictions[0];
  assert.equal(saved.created_at_ms, rows[6].sent_at_ms + 100);
  x.push(rows[6], rows[6].sent_at_ms + 200);
  assert.equal(x.engine.history().predictions[0].reason, "target_not_after_prediction");
  assert.equal(x.engine.snapshot().stats.valid_targets, 0);
});

test("public artifact parameters can be restored by explicit central rollback", (t) => {
  const { sanitizeBundle } = require("../server/artifacts.cjs");
  const x = setup(); t.after(() => x.engine.close()); const rows = fixture(150);
  x.feed(rows.slice(0, 10)); const published = sanitizeBundle(x.engine.modelBundle());
  x.feed(rows.slice(10));
  const result = x.engine.rollbackModels(published, "Test compatibility with the sanitized public package");
  assert.equal(result.profiles[0].model.model_id, published.profiles[0].model.model_id);
  assert.equal(result.project_id, "test");
});

test("restart reclaims a stale lock when the operating system reused its PID", (t) => {
  const file = temp(t);
  const { processIdentity } = require("../server/store.cjs");
  fs.writeFileSync(file + ".writer.lock", JSON.stringify({ pid: process.pid,
    identity: processIdentity(process.pid) + "-old-instance", nonce: "fixture-crashed-process" }));
  const x = setup({ dbPath: file }); t.after(() => x.engine.close());
  assert.equal(x.engine.snapshot().stats.accepted, 0);
  assert.throws(() => setup({ dbPath: file }), /satu penulis|layanan pusat lain/);
});

test("limited API history returns latest matching records and explicitly reports truncation", (t) => {
  const x = setup(); t.after(() => x.engine.close()); const rows = fixture(220); x.feed(rows);
  const key = M.contextKey(rows[0]), all = x.engine.history({ context_key: key, device_id: "hp-a" });
  const short = x.engine.history({ context_key: key, device_id: "hp-a", limit: 2 });
  assert.equal(short.predictions.length, 2); assert.equal(short.total_counts.predictions, all.predictions.length);
  assert.equal(short.truncated, true); assert.ok(short.truncated_types.includes("predictions"));
  assert.deepEqual(short.predictions, all.predictions.slice(-2));
  assert.deepEqual(short.blocks, all.blocks.slice(-2));
  assert.ok(all.candidates.some((c) => c.algorithm === "ridge"));
  assert.ok(all.candidates.some((c) => c.algorithm === "kmeans"));
  assert.ok(all.clusterEvaluations.length > 0);
  assert.equal(short.total_counts.clusterEvaluations, all.clusterEvaluations.length);
  assert.ok(all.predictions.every((p) => p.context_key === key));
  assert.ok(all.shared_quality_context !== key);
  assert.equal(x.engine.history().truncated, false);
  const rejected = x.engine.history({ context_key: key, candidate_status: "rejected" });
  assert.ok(rejected.predictions.length > 0, "candidate status filter must not erase prediction history");
  assert.ok(rejected.candidates.every((c) => c.status === "rejected"));
});
