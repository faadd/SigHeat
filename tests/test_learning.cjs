"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const M = require("../assets/ml.js"), K = require("../assets/clusters.js"), L = require("../assets/learning.js");
// Deterministic TEST fixtures exercise measured routing; they are not field data.
function rows(n = 240, options = {}) {
  return M.generateDemoRows(n).map((r, i) => ({ ...r, source: "browser", mode: "pengukuran-perangkat", project_id: "test", device_id: "hp-a",
    latency_ms: options.constant ? 100 : 100 + i * 3, latency_std_ms: options.constant ? 1 : 2 + i / 30, ...options.overrides }));
}
function feed(manager, data, maintain = true) {
  for (const row of data) { const result = manager.ingest(row); assert.equal(result.accepted, true); if (maintain && result.needsMaintenance) manager.maintain(); }
}
function memory() {
  const data = new Map();
  return { getItem: (k) => data.get(k) || null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k), data };
}
test("bootstrap numerical model is loaded without fitting and predicts after six samples", () => {
  const old = M.trainContexts; let fits = 0;
  M.trainContexts = (...args) => { fits++; return old(...args); };
  try {
    const manager = L.create({ storage: null }), data = rows(7);
    assert.equal(manager.inspect(null).modelProvenance, "synthetic");
    feed(manager, data.slice(0, 5)); assert.notEqual(manager.forecast(data[4]).status, "ready");
    feed(manager, data.slice(5, 6));
    assert.equal(manager.forecast(data[5]).status, "ready");
    assert.match(manager.forecast(data[5]).warning, /sintetis/);
    assert.equal(fits, 0);
  } finally { M.trainContexts = old; }
});
test("candidate is frozen and only 24 subsequent labels can promote it", () => {
  const manager = L.create({ storage: null }), data = rows(150);
  feed(manager, data.slice(0, 120));
  assert.equal(manager.inspect(data[119]).forecastCandidate.n, 0);
  const frozen = manager.exportState().profiles[0].candidate.model;
  feed(manager, data.slice(120, 143));
  assert.equal(manager.inspect(data[142]).forecastCandidate.n, 23);
  assert.deepEqual(manager.exportState().profiles[0].candidate.model, frozen);
  assert.equal(manager.inspect(data[142]).modelProvenance, "synthetic");
  feed(manager, data.slice(143, 144));
  const result = manager.inspect(data[143]);
  assert.equal(result.forecastCandidate, null);
  assert.equal(result.lastForecastEvaluation.n, 24);
  assert.equal(result.lastForecastEvaluation.after_ms, data[119].sent_at_ms);
  assert.equal(result.lastForecastEvaluation.through_ms, data[143].sent_at_ms);
  assert.equal(result.lastForecastEvaluation.promoted, true);
  assert.equal(result.modelProvenance, "measured");
});
test("perfect persistence remains a baseline and is not called a learned Ridge improvement", () => {
  const manager = L.create({ storage: null }), data = rows(150, { constant: true });
  feed(manager, data);
  assert.equal(manager.inspect(data.at(-1)).lastForecastEvaluation.promoted, false);
  assert.equal(manager.forecast(data.at(-1)).method, "persistence");
  assert.equal(manager.forecast(data.at(-1)).prediction_ms, 100);
});
test("duplicate, timeout and restart cannot become false future targets", () => {
  const manager = L.create({ storage: null }), data = rows(140);
  feed(manager, data.slice(0, 120));
  assert.equal(manager.ingest(data[119]).accepted, false);
  const failure = { ...data[120], probe_ok: false, latency_ms: null, success_pct: 80 };
  assert.equal(manager.ingest(failure).accepted, true);
  assert.equal(manager.inspect(failure).forecastCandidate.n, 0);
  assert.notEqual(manager.forecast(failure).status, "ready");
  const reboot = data.slice(121).map((r, i) => ({ ...r, boot_id: "second-boot", sequence: i + 1 }));
  feed(manager, reboot.slice(0, 5));
  assert.notEqual(manager.forecast(reboot[4]).status, "ready");
  assert.equal(manager.inspect(reboot[4]).forecastCandidate.n, 0);
  feed(manager, reboot.slice(5, 6));
  assert.equal(manager.forecast(reboot[5]).status, "ready");
  assert.equal(manager.inspect(reboot[5]).forecastCandidate.n, 0);
  feed(manager, reboot.slice(6, 7));
  assert.equal(manager.inspect(reboot[6]).forecastCandidate.n, 1);
});
test("models and data survive reload but cached observations are not fresh telemetry", () => {
  const store = memory(), manager = L.create({ storage: store }), data = rows(170);
  feed(manager, data.slice(0, 150)); assert.equal(manager.persist(), true);
  const saved = manager.inspect(data[149]);
  const restored = L.create({ storage: store });
  assert.equal(restored.inspect(data[149]).sampleCount, 150);
  assert.equal(restored.inspect(data[149]).modelId, saved.modelId);
  assert.deepEqual(restored.inspect(data[149]).lastForecastEvaluation.mae_ms, saved.lastForecastEvaluation.mae_ms);
  assert.equal(restored.inspect(data[149]).initializationSource, "cache");
  assert.notEqual(restored.forecast(data[149]).status, "ready");
  assert.equal(restored.ingest(data[149]).accepted, false);
  feed(restored, data.slice(150, 151)); assert.equal(restored.forecast(data[150]).status, "ready");
  const reboot = data.slice(151, 157).map((r, i) => ({ ...r, boot_id: "boot-next", sequence: i + 1 }));
  feed(restored, reboot.slice(0, 1)); assert.notEqual(restored.forecast(reboot[0]).status, "ready");
  feed(restored, reboot.slice(1)); assert.equal(restored.forecast(reboot.at(-1)).status, "ready");
  assert.equal(restored.inspect(reboot.at(-1)).modelId, saved.modelId);
});
test("pending comparison resets on reload and never reuses previous evaluation counts", () => {
  const store = memory(), manager = L.create({ storage: store }), data = rows(150);
  feed(manager, data.slice(0, 130)); assert.equal(manager.inspect(data[129]).forecastCandidate.n, 10);
  manager.persist();
  const restored = L.create({ storage: store });
  assert.equal(restored.inspect(data[129]).forecastCandidate.n, 0);
  feed(restored, data.slice(130, 131));
  assert.equal(restored.inspect(data[130]).forecastCandidate.n, 0);
  feed(restored, data.slice(131, 132));
  assert.equal(restored.inspect(data[131]).forecastCandidate.n, 1);
});
test("different devices keep Ridge separate but share the same learned cluster context", () => {
  const manager = L.create({ storage: null });
  const a = rows(95), b = a.map((r) => ({ ...r, device_id: "hp-b", sent_at_ms: r.sent_at_ms + 100 }));
  for (let i = 0; i < a.length; i++) { feed(manager, [a[i]]); feed(manager, [b[i]]); }
  assert.equal(manager.inspect(a.at(-1)).sampleCount, 95);
  assert.equal(manager.inspect(b.at(-1)).sampleCount, 95);
  assert.equal(manager.inspect(a.at(-1)).clusterModelId, manager.inspect(b.at(-1)).clusterModelId);
  assert.equal(manager.exportState().profiles.length, 2);
  assert.equal(manager.exportState().qualityProfiles.length, 1);
  assert.equal(manager.exportState().qualityProfiles[0].rows.length, 190);
});
test("synthetic rows are never persisted or mixed into live models or context eviction", () => {
  const store = memory(), manager = L.create({ storage: store }), real = rows(7);
  feed(manager, real); const before = manager.exportState();
  for (let n = 0; n < 15; n++) feed(manager, M.generateDemoRows(6).map((r) => ({ ...r, project_id: "demo-" + n })));
  assert.equal(manager.exportState().profiles.length, 1);
  assert.deepEqual(manager.exportState().profiles, before.profiles);
  assert.deepEqual(manager.exportState().qualityProfiles, before.qualityProfiles);
  manager.persist();
  assert.ok(JSON.parse(store.getItem(L.STORAGE_KEY)).profiles.every((p) => JSON.parse(p.key)[2] !== "demo"));
  assert.equal(manager.inspect(real.at(-1)).sampleCount, 7);
});
test("stored state excludes coordinates, credentials and arbitrary payload fields", () => {
  const store = memory(), manager = L.create({ storage: store });
  const data = rows(7).map((r) => ({ ...r, latitude: -7.1, longitude: 110.5, password: "test-secret", arbitrary: "private-note" }));
  feed(manager, data); manager.persist();
  const encoded = store.getItem(L.STORAGE_KEY);
  for (const secret of ["latitude", "longitude", "test-secret", "private-note"]) assert.equal(encoded.includes(secret), false);
  assert.equal(manager.exportRows(data.at(-1))[0].latitude, undefined);
});
test("broken, noncanonical and malformed backups are rejected atomically", () => {
  const manager = L.create({ storage: null }), data = rows(125); feed(manager, data);
  const original = manager.exportState();
  assert.equal(manager.importState("{broken").ok, false);
  const bad = structuredClone(original); bad.profiles[0].rows[0][3] = "10";
  assert.equal(manager.importState(bad).ok, false);
  const wrongKey = structuredClone(original); const key = JSON.parse(wrongKey.qualityProfiles[0].key); key[2] = "wss://example.invalid:443/mqtt";
  wrongKey.qualityProfiles[0].key = JSON.stringify(key);
  assert.equal(manager.importState(wrongKey).ok, false);
  const model = structuredClone(original); model.profiles[0].model.coefficients = [1];
  assert.equal(manager.importState(model).ok, false);
  assert.deepEqual(manager.exportState(), original);
  const store = memory(); store.setItem(L.STORAGE_KEY, "broken");
  const recovered = L.create({ storage: store }); assert.match(recovered.inspect(null).storageMessage, /rusak/);
});
test("quota and unavailable storage fall back visibly without stopping prediction", () => {
  const blocked = { getItem() { throw Error("blocked"); }, setItem() { throw Error("full"); }, removeItem() { throw Error("blocked"); } };
  const manager = L.create({ storage: blocked }), data = rows(7);
  feed(manager, data); assert.equal(manager.persist(), false);
  assert.match(manager.inspect(data.at(-1)).storageMessage, /gagal|penuh/);
  assert.equal(manager.forecast(data.at(-1)).status, "ready");
});
test("cache cannot evaluate a candidate on observations already used to train that candidate", () => {
  const manager = L.create({ storage: null }), data = rows(960);
  feed(manager, data.slice(0, 120));
  const original = manager.exportState(), future = M.trainContexts(data).model;
  const candidate = structuredClone(original); candidate.profiles[0].candidate.model = future;
  assert.equal(manager.importState(candidate).ok, false);
  const active = structuredClone(original); active.profiles[0].model = future;
  assert.equal(manager.importState(active).ok, false);
  const earlyCutoff = structuredClone(original); earlyCutoff.profiles[0].candidate.cutoff_ms = data[118].sent_at_ms;
  assert.equal(manager.importState(earlyCutoff).ok, false);
  assert.deepEqual(manager.exportState(), original);
});
test("team seed loads only when valid browser cache is absent", () => {
  const initial = L.create({ storage: null }), data = rows(150); feed(initial, data);
  const seed = initial.exportState();
  const seeded = L.create({ storage: null, seed });
  assert.equal(seeded.inspect(data.at(-1)).initializationSource, "seed");
  assert.equal(seeded.inspect(data.at(-1)).sampleCount, 150);
  const store = memory(); const smaller = L.create({ storage: store }); feed(smaller, data.slice(0, 7)); smaller.persist();
  const cached = L.create({ storage: store, seed });
  assert.equal(cached.inspect(data[6]).initializationSource, "cache");
  assert.equal(cached.inspect(data[6]).sampleCount, 7);
  const invalid = L.create({ storage: null, seed: { invalid: true } });
  assert.equal(invalid.inspect(null).initializationSource, "bootstrap");
});
test("shared clustering candidate is evaluated on later profiles in the same fixed metric", () => {
  const store = memory(), manager = L.create({ storage: store });
  const profiles = [[100, 8, 98], [460, 70, 92], [1900, 440, 70]];
  const data = rows(130).map((r, i) => ({ ...r, project_id: "cluster-test",
    // Interleave three distinct TEST distributions, shifted from bootstrap centers.
    latency_ms: profiles[i % 3][0] + i % 7, latency_std_ms: profiles[i % 3][1] + i % 5, success_pct: profiles[i % 3][2] }));
  feed(manager, data.slice(0, 90));
  const pending = manager.inspect(data[89]).clusterCandidate;
  assert.equal(pending.n, 0); feed(manager, data.slice(90, 113));
  assert.equal(manager.inspect(data[112]).clusterCandidate.n, 23);
  feed(manager, data.slice(113, 114));
  const evaluated = manager.inspect(data[113]).lastClusterEvaluation;
  assert.equal(evaluated.n, 24);
  assert.equal(evaluated.promoted, true);
  assert.ok(Number.isFinite(evaluated.candidate_mean_squared_distance));
  assert.match(evaluated.note, /bukan akurasi/);
  manager.persist();
  const restored = L.create({ storage: store });
  assert.equal(restored.inspect(data[113]).lastClusterEvaluation.candidate_mean_squared_distance, evaluated.candidate_mean_squared_distance);
});
test("cluster cache rejects measured candidate and champion transferred from another context", () => {
  const a = L.create(), b = L.create();
  const sample = rows(90).map((r, i) => ({ ...r, latency_ms: [80, 350, 1500][i % 3] + i % 7,
    latency_std_ms: [5, 50, 300][i % 3] + i % 5, success_pct: [99, 90, 70][i % 3] }));
  feed(a, sample); feed(b, sample.map((r) => ({ ...r, project_id: "another-project", latency_ms: r.latency_ms + 300 })));
  const original = a.exportState(), foreign = b.exportState().qualityProfiles[0].candidate.model;
  assert.notEqual(foreign.context_key, original.qualityProfiles[0].key);
  const badCandidate = structuredClone(original); badCandidate.qualityProfiles[0].candidate.model = foreign;
  assert.equal(a.importState(badCandidate).ok, false);
  const badChampion = structuredClone(original); badChampion.qualityProfiles[0].model = foreign;
  assert.equal(a.importState(badChampion).ok, false);
  assert.deepEqual(a.exportState(), original);
  assert.equal(L.create().importState(original).ok, true);
});
