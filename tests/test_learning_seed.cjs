"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const M = require("../assets/ml.js");
const L = require("../assets/learning.js");
const { buildSeed } = require("../scripts/build-learning-seed.cjs");

function measuredFixture() {
  return M.generateDemoRows(180).map((row) => ({ ...row, source: "browser", mode: "pengukuran-perangkat",
    project_id: "test-project", device_id: "hp-test", boot_id: "test-boot", broker_endpoint: "wss://test.example/mqtt" }));
}

test("team seed refuses to present a bootstrap-only backup as trained group model", () => {
  const manager = L.create();
  for (const row of measuredFixture().slice(0, 10)) manager.ingest(row);
  assert.throws(() => buildSeed(manager.exportState()), /belum memiliki model/);
  assert.equal(require("../assets/learning-seed.js"), null);
});

test("team seed compiles a validated context-bound measured model and strips unrelated input", () => {
  const rows = measuredFixture(), manager = L.create();
  for (const row of rows) manager.ingest(row);
  const backup = manager.exportState();
  backup.profiles[0].model = M.trainContexts(rows).model;
  backup.private_password = "DO-NOT-EMBED";
  backup.profiles[0].gps = {latitude: -7, longitude: 110};
  const built = buildSeed(backup);
  assert.equal(built.measuredRidge, 1);
  assert(!built.source.includes("DO-NOT-EMBED"));
  assert(!built.source.includes('"gps"'));
  const context = {module: {exports: {}}};
  vm.runInNewContext(built.source, context);
  const restored = L.create({seed: JSON.parse(JSON.stringify(context.module.exports))});
  assert.equal(restored.inspect(rows.at(-1)).modelProvenance, "measured");
  assert.equal(restored.forecast(rows.at(-1)).status, "waiting");
});

test("team seed rejects a corrupt model without generating executable output", () => {
  const rows = measuredFixture(), manager = L.create();
  for (const row of rows) manager.ingest(row);
  const backup = manager.exportState();
  backup.profiles[0].model = M.trainContexts(rows).model;
  backup.profiles[0].model.coefficients[0] = null;
  assert.throws(() => buildSeed(backup), /ditolak|tidak cocok/);
});
