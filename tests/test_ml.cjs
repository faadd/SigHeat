"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), { spawnSync } = require("node:child_process");
const ML = require("../assets/ml.js");
const { parseCSV } = require("../scripts/train-ml.cjs");
const { csv } = require("../scripts/generate-ml-demo.cjs");
const clone = (o) => JSON.parse(JSON.stringify(o));
function measured(count = 240) {
  return ML.generateDemoRows(count).map((r) => ({ ...r, source: "browser", mode: "pengukuran-perangkat", project_id: "uji-kelas" }));
}

test("deterministic synthetic fixture is labeled and never presented as measured", () => {
  assert.deepEqual(ML.generateDemoRows(), ML.generateDemoRows());
  const result = ML.train(ML.generateDemoRows());
  assert.equal(result.report.provenance, "synthetic");
  assert.equal(result.report.selected_predictor, "ridge");
  assert.equal(ML.validateModel(result.model), true);
  assert.match(ML.forecast(result.model, ML.generateDemoRows()).warning, /SIMULASI/);
});

test("supervised target is next raw RTT, not current rolling mean or future inputs", () => {
  const rows = measured(7).map((r, i) => ({ ...r, latency_ms: 100 + i, latency_mean_ms: 9999 }));
  const [example] = ML.buildExamples(rows);
  assert.equal(example.y, 106);
  assert.deepEqual(example.x.slice(0, 6), [105, 104, 103, 102, 101, 100]);
  assert.equal(example.target_sequence, 7);
  assert.equal(example.input_end_ms, rows[5].sent_at_ms);
  assert.equal(example.target_ms, rows[6].sent_at_ms);
});

test("chronological raw splits purge every window crossing a split boundary", () => {
  const { report } = ML.train(measured(120));
  assert.deepEqual(report.rows, { total: 120, train: 72, validation: 24, test: 24 });
  assert.deepEqual(report.examples, { train: 66, validation: 18, test: 18 });
  const s = report.split_boundaries;
  assert.ok(s.train.last_target_ms < s.validation.first_input_ms);
  assert.ok(s.validation.last_target_ms < s.test.first_input_ms);
  for (const r of Object.values(s)) {
    assert.ok(r.first_target_ms > r.first_input_ms);
    assert.ok(r.first_input_ms >= r.raw_start_ms);
    assert.ok(r.last_target_ms <= r.raw_end_ms);
  }
});

test("held-out test values do not choose alpha, predictor, weights, or scaling", () => {
  const rows = measured(), changed = clone(rows);
  for (const row of changed.slice(Math.floor(rows.length * 0.8))) {
    row.latency_ms += 15000;
    row.accel_rms = 700;
    row.gyro_rms_rad_s = 600;
  }
  const a = ML.train(rows), b = ML.train(changed);
  for (const key of ["centers", "scales", "coefficients", "alpha", "selected_predictor", "validation"])
    assert.deepEqual(a.model[key], b.model[key]);
  assert.notDeepEqual(a.report.test, b.report.test);
});

test("validation values do not leak into feature normalization", () => {
  const rows = measured(), changed = clone(rows);
  for (const row of changed.slice(Math.floor(rows.length * 0.6))) row.accel_rms = 700;
  assert.deepEqual(ML.train(rows).model.centers, ML.train(changed).model.centers);
  assert.deepEqual(ML.train(rows).model.scales, ML.train(changed).model.scales);
});

test("constant RTT keeps persistence, never pretends ridge improved", () => {
  const rows = measured().map((r) => ({ ...r, latency_ms: 123.4, accel_rms: 0.3, gyro_rms_rad_s: 0.1, latency_std_ms: 0 }));
  const { model, report } = ML.train(rows);
  assert.equal(model.selected_predictor, "persistence");
  assert.equal(ML.validateModel(model), true);
  assert.ok(model.scales.every((v) => v > 1e-9));
  assert.equal(report.test.persistence.mae_ms, 0);
  assert.equal(ML.forecast(model, rows).prediction_ms, 123.4);
});

test("missing optional sensors use indicators and remain trainable", () => {
  const rows = measured().map((r) => ({ ...r, accel_rms: null, accel_available: false, accel_mode: "unavailable", gyro_rms_rad_s: null, gyro_available: false, latency_std_ms: null }));
  const example = ML.buildExamples(rows)[0];
  assert.deepEqual(example.x.slice(-3), [1, 1, 1]);
  const { model } = ML.train(rows);
  assert.equal(ML.validateModel(model), true);
  assert.equal(ML.forecast(model, rows).status, "ready");
});

test("timeout is censored, never relabeled RTT zero or joined over", () => {
  const rows = measured(20);
  rows[9] = { ...rows[9], probe_ok: false, latency_ms: null };
  const examples = ML.buildExamples(rows);
  assert.ok(examples.length > 0);
  assert.ok(examples.every((e) => e.target_sequence < 10 || e.target_sequence > 16));
  const { model } = ML.train(measured());
  const latest = measured(); latest.at(-1).probe_ok = false; latest.at(-1).latency_ms = null;
  assert.equal(ML.forecast(model, latest).status, "unavailable");
});

test("missing sequences and irregular timestamps break windows", () => {
  const rows = measured(20);
  for (const r of rows.slice(10)) { r.sequence++; r.sent_at_ms += 60000; }
  const examples = ML.buildExamples(rows);
  assert.ok(examples.every((e) => e.target_sequence <= 10 || e.target_sequence >= 18));
  const tooFast = measured(7); tooFast[6].sent_at_ms = tooFast[5].sent_at_ms + 1000;
  assert.equal(ML.buildExamples(tooFast).length, 0);
});

test("invalid numbers, strings, mixed streams, duplicate samples are rejected", () => {
  for (const value of ["10", NaN, Infinity, -1, 60001]) {
    const rows = measured(7); rows[0].latency_ms = value;
    assert.throws(() => ML.prepareRows(rows), /latency_ms/);
  }
  for (const field of ["project_id", "device_id", "boot_id", "source", "broker_endpoint", "interval_s", "accel_mode"]) {
    const rows = measured(7);
    const replacement = { project_id: "other", device_id: "hp-b", boot_id: "reboot", source: "termux", broker_endpoint: "wss://other.invalid/mqtt", interval_s: 6, accel_mode: "gravity_removed" };
    rows[6][field] = replacement[field];
    assert.throws(() => ML.prepareRows(rows), /mencampur/);
  }
  const dup = measured(7); dup[6] = clone(dup[5]);
  assert.throws(() => ML.prepareRows(dup), /Urutan/);
});

test("not enough usable examples gives a clear error instead of fake model", () => {
  assert.throws(() => ML.train(measured(119)), /minimal 120/);
  const rows = measured(120).map((r) => ({ ...r, probe_ok: false, latency_ms: null, success_pct: 0 }));
  assert.throws(() => ML.train(rows), /Contoh valid/);
});

test("forecast checks stream compatibility, window warmup, and latest telemetry", () => {
  const rows = measured(), { model } = ML.train(rows);
  assert.equal(ML.forecast(model, rows.slice(-5)).status, "warming_up");
  const other = rows.map((r) => ({ ...r, boot_id: "different-boot" }));
  assert.equal(ML.forecast(model, other).status, "incompatible");
  const answer = ML.forecast(model, rows);
  assert.equal(answer.based_on_ms, rows.at(-1).sent_at_ms);
  assert.equal(answer.forecast_for_ms, rows.at(-1).sent_at_ms + 5000);
  assert.equal(answer.horizon_s, 5);
  assert.ok(Number.isFinite(answer.prediction_ms));
});

test("untrusted imported models reject wrong dimensions, malformed groups, NaN, and provenance spoofing", () => {
  const { model } = ML.train(measured());
  for (const mutate of [
    (m) => m.coefficients.push(1), (m) => m.scales[0] = 0,
    (m) => m.coefficients[0] = Infinity, (m) => m.features.reverse(),
    (m) => m.group_key = "[]", (m) => m.provenance = "synthetic",
    (m) => m.test.ridge.mae_ms = -1, (m) => m.horizon_s = 100,
  ]) {
    const changed = clone(model); mutate(changed);
    assert.equal(ML.validateModel(changed), false);
    assert.equal(ML.forecast(changed, measured()).status, "invalid_model");
  }
});

test("CSV serialization round-trips typed numeric and boolean fields", () => {
  const rows = ML.generateDemoRows();
  const parsed = parseCSV(csv(rows));
  assert.equal(parsed.length, rows.length);
  assert.equal(parsed[0].probe_ok, true);
  assert.equal(parsed[0].latitude, null);
  assert.equal(typeof parsed[0].latency_ms, "number");
  assert.deepEqual(ML.train(parsed).report, ML.train(rows).report);
});

test("CSV parser rejects NaN, duplicate headers, bad quotes, old export schema", () => {
  assert.throws(() => parseCSV("latency_ms\n1\n"), /Kolom CSV/);
  assert.throws(() => parseCSV("a,a\n1,2\n"), /Header/);
  assert.throws(() => parseCSV('"a\n1'), /Kutipan/);
  assert.throws(() => parseCSV(csv(ML.generateDemoRows(7)).replace(",1767225600000,", ",NaN,")), /bukan angka/);
});

test("CLI defaults to rejecting synthetic data and writes reproducible model/report when enabled", () => {
  const directory = fs.mkdtempSync(path.join(__dirname, "tmp-ml-"));
  try {
    const input = path.join(directory, "rows.csv"), output = path.join(directory, "model");
    fs.writeFileSync(input, csv(ML.generateDemoRows()));
    const script = path.join(__dirname, "..", "scripts", "train-ml.cjs");
    const rejected = spawnSync(process.execPath, [script, "--input", input, "--output", output], { encoding: "utf8" });
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /allow-synthetic/);
    assert.equal(fs.existsSync(output), false);
    const trained = spawnSync(process.execPath, [script, "--input", input, "--output", output, "--allow-synthetic"], { encoding: "utf8" });
    assert.equal(trained.status, 0, trained.stderr);
    const model = JSON.parse(fs.readFileSync(path.join(output, "model.json"), "utf8"));
    assert.equal(ML.validateModel(model), true);
    assert.deepEqual(model.report, JSON.parse(fs.readFileSync(path.join(output, "report.json"), "utf8")));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
