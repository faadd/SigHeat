"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const C = require("../assets/clusters.js");
const copy = (value) => JSON.parse(JSON.stringify(value));
function profiles(scale = 1) {
  const rows = [];
  for (const [rtt, jitter, success] of [[45, 1, 100], [75, 6, 98], [110, 20, 94]]) {
    for (let i = 0; i < 30; i++) rows.push({ source: "browser", mode: "pengukuran-perangkat", probe_ok: true,
      latency_ms: (rtt + (i % 5)) * scale, latency_std_ms: jitter * scale, success_pct: success });
  }
  return rows;
}

test("default clustering model is pre-trained, deterministic, and explicitly synthetic", () => {
  const saved = JSON.parse(fs.readFileSync(path.join(__dirname, "../models/default-clusters.json"), "utf8"));
  const defaultModel = C.defaultModel();
  assert.deepEqual(defaultModel, saved);
  assert.deepEqual(defaultModel, C.train(C.generateDemoRows()));
  assert.equal(C.validateModel(defaultModel), true);
  assert.equal(defaultModel.provenance, "synthetic");
  assert.deepEqual(defaultModel.counts, [160, 160, 160]);
  assert.deepEqual(C.generateDemoRows(), C.generateDemoRows());
  assert.match(C.classify(defaultModel, C.generateDemoRows()[0]).reason, /sintetis/);
});

test("default models are isolated clones and browser initialization does not call training", () => {
  const a = C.defaultModel(); a.centroids[0][0] = 1;
  assert.notDeepEqual(a, C.defaultModel());
  const source = fs.readFileSync(path.join(__dirname, "../assets/clusters.js"), "utf8");
  const context = { console, URL, Date, Math, JSON, Number, Set };
  vm.runInNewContext(source, context);
  context.SigHeatClusters.train = () => { throw Error("startup must not train"); };
  assert.equal(context.SigHeatClusters.validateModel(context.SigHeatClusters.defaultModel()), true);
});

test("centroids learn three relative groups even when all RTT values are below old 150ms threshold", () => {
  const rows = profiles(), model = C.train(rows);
  assert.ok(rows.every((row) => row.latency_ms < 150));
  assert.deepEqual([0, 30, 60].map((i) => C.classify(model, rows[i]).quality), ["good", "fair", "poor"]);
  assert.deepEqual([0, 30, 60].map((i) => C.classify(model, rows[i]).label),
    ["Beban relatif rendah", "Beban relatif sedang", "Beban relatif tinggi"]);
  assert.equal(model.provenance, "measured");
});

test("moving training population moves assignments rather than preserving fixed RTT categories", () => {
  const low = C.train(profiles()), high = C.train(profiles(6));
  const sample = profiles()[65];
  assert.equal(C.classify(low, sample).quality, "poor");
  assert.equal(C.classify(high, sample).quality, "good");
  assert.notDeepEqual(low.centroids, high.centroids);
});

test("constant and nearly identical telemetry cannot fabricate three quality levels", () => {
  const constant = Array.from({ length: 90 }, () => ({ source: "browser", probe_ok: true, latency_ms: 80, latency_std_ms: 2, success_pct: 100 }));
  assert.throws(() => C.train(constant), /bervariasi/);
  const narrow = constant.map((row, i) => ({ ...row, latency_ms: 80 + i * 0.00001 }));
  assert.throws(() => C.train(narrow), /belum terpisah/);
  const tinyMinority = [...profiles().slice(0, 60), ...profiles().slice(60, 62)];
  assert.throws(() => C.train(tinyMinority), /belum terpisah/);
});

test("timeout and missing jitter remain unknown and are excluded from fitting/scoring", () => {
  const model = C.defaultModel(), row = C.generateDemoRows()[0];
  const failed = { ...row, latency_ms: null, probe_ok: false };
  assert.equal(C.classify(model, failed).quality, "unknown");
  assert.equal(C.classify(model, failed).label, "Probe timeout");
  assert.equal(C.distance(model, failed), null);
  const missing = { ...row, latency_std_ms: null };
  assert.equal(C.classify(model, missing).quality, "unknown");
  assert.equal(C.distance(model, missing), null);
  assert.equal(C.score(model, [row, failed, missing]).n, 1);
  const rows = C.generateDemoRows(); rows[0] = failed; rows[1] = missing;
  const trained = C.train(rows);
  assert.equal(trained.ignored_rows, 2);
  assert.equal(trained.trained_rows, 478);
  assert.throws(() => C.train(Array.from({ length: 60 }, () => failed)), /probe lengkap/);
});

test("fixed transform lets candidate and champion quantization errors share the same metric", () => {
  const model = C.train(profiles()), row = profiles()[12];
  const vector = [Math.log1p(row.latency_ms) / Math.log1p(60000), Math.log1p(row.latency_std_ms) / Math.log1p(60000), (100 - row.success_pct) / 100];
  const expected = Math.min(...model.centroids.map((center) => center.reduce((sum, v, i) => sum + (v - vector[i]) ** 2, 0)));
  assert.equal(C.distance(model, row), expected);
  assert.deepEqual(C.score(model, [row, row]), { n: 2, mean_squared_distance: expected });
  assert.deepEqual(C.score(model, []), { n: 0, mean_squared_distance: null });
});

test("invalid input and mixing synthetic with measured records are rejected", () => {
  const rows = profiles();
  for (const bad of [NaN, Infinity, "45", -1, 60001]) {
    const changed = copy(rows); changed[0].latency_ms = bad;
    assert.throws(() => C.train(changed), /tidak valid/);
  }
  const mixed = copy(rows); mixed[0].source = "demo"; mixed[0].mode = "contoh-lokal";
  assert.throws(() => C.train(mixed), /tidak boleh dicampur/);
  const wrong = copy(rows); wrong[0].mode = "contoh-lokal";
  assert.throws(() => C.train(wrong), /mode dan sumber/);
  assert.throws(() => C.train(rows.slice(0, 59)), /memerlukan/);
});

test("stored models reject dimension, value, identity, count, provenance and format corruption", () => {
  for (const mutate of [
    (m) => { m.centroids[0][0] = NaN; },
    (m) => { m.centroids[0].push(0); },
    (m) => { m.centroids.pop(); },
    (m) => { m.counts[0] = 1; },
    (m) => { m.model_id = "kmeans-wrong"; },
    (m) => { m.features.reverse(); },
    (m) => { m.provenance = "measured"; },
    (m) => { m.schema_version = 2; },
    (m) => { m.transform = "arbitrary-scaler"; },
    (m) => { m.centroids.reverse(); },
  ]) {
    const model = C.defaultModel(); mutate(model);
    assert.equal(C.validateModel(model), false);
    assert.equal(C.classify(model, profiles()[0]).quality, "unknown");
    assert.equal(C.distance(model, profiles()[0]), null);
  }
});

test("optional canonical context binds learned model identity without changing default model", () => {
  const rows = profiles(), key = JSON.stringify(["project-a", "browser", "wss://example.test/mqtt", 5]);
  const bound = C.train(rows, { contextKey: key }), generic = C.train(rows);
  assert.equal(C.validateModel(bound), true);
  assert.equal(bound.context_key, key);
  assert.equal(generic.context_key, undefined);
  assert.notEqual(bound.model_id, generic.model_id);
  assert.deepEqual(bound.centroids, generic.centroids);
  assert.deepEqual(C.score(bound, rows), C.score(generic, rows));
  const tampered = copy(bound);
  tampered.context_key = JSON.stringify(["project-b", "browser", "wss://example.test/mqtt", 5]);
  assert.equal(C.validateModel(tampered), false);
  const omitted = copy(bound); delete omitted.context_key;
  assert.equal(C.validateModel(omitted), false);
  const defaultJSON = JSON.parse(fs.readFileSync(path.join(__dirname, "../models/default-clusters.json"), "utf8"));
  assert.deepEqual(C.defaultModel(), defaultJSON);
});

test("context validation rejects malformed, noncanonical, credential-bearing and wrong-source keys", () => {
  const rows = profiles();
  for (const key of [null, "bad", '["project-a", "browser", "wss://example.test/mqtt", 5]',
    JSON.stringify(["invalid project", "browser", "wss://example.test/mqtt", 5]),
    JSON.stringify(["project-a", "browser", "ws://example.test/mqtt", 5]),
    JSON.stringify(["project-a", "browser", "wss://user:pass@example.test/mqtt", 5]),
    JSON.stringify(["project-a", "browser", "wss://example.test/mqtt?secret=1", 5]),
    JSON.stringify(["project-a", "browser", "wss://EXAMPLE.test/mqtt", 5]),
    JSON.stringify(["project-a", "browser", "wss://example.test/mqtt", 61]),
    JSON.stringify(["project-a", "termux", "wss://example.test/mqtt", 5])])
    assert.throws(() => C.train(rows, { contextKey: key }), /konteks|Konteks/);
});
