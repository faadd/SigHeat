"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Core = require("../assets/core.js");
const uiSource = fs.readFileSync(path.join(__dirname, "../assets/ml-ui.js"), "utf8");

function harness(engineOverride = null) {
  let now = 1793700000000;
  const nodes = new Map(), jobs = [], downloads = [], calls = {train: [], forecast: []};
  class Node {
    constructor(tag = "div") { this.tagName = tag; this.children = []; this.handlers = {}; this.value = ""; this.disabled = false; this.hidden = false; this.textContent = ""; this.dataset = {}; }
    replaceChildren(...children) { this.children = children; }
    append(...children) { this.children.push(...children); }
    addEventListener(event, fn) { this.handlers[event] = fn; }
    click() { if (this.tagName === "a") downloads.push({url: this.href, filename: this.download}); else if (!this.disabled) this.handlers.click?.(); }
    remove() {}
    set innerHTML(_) { throw new Error("Unsafe HTML sink"); }
  }
  const get = (id) => { if (!nodes.has(id)) nodes.set(id, new Node()); return nodes.get(id); };
  const document = {body: Object.assign(new Node(), {dataset: {page: "dashboard"}}), getElementById: get, createElement: (tag) => new Node(tag)};
  const groupKey = (row) => [row.project_id, row.device_id, row.boot_id, row.source, row.broker_endpoint, row.interval_s, row.accel_mode].join("|");
  const row = (sequence, extra = {}) => ({project_id: "project", device_id: "hp-a", boot_id: "boot-one", sequence, source: "browser", broker_endpoint: "wss://example.invalid/mqtt", interval_s: 5, accel_mode: "linear", sent_at_ms: now - (4 - sequence) * 5000, latency_ms: 40 + sequence, probe_ok: true, success_pct: 100, ...extra});
  const metric = {mae_ms: 2, rmse_ms: 3, n: 2};
  const stubEngine = {
    MIN_ROWS: 4, groupKey,
    generateDemoRows() { return [1,2,3,4].map((sequence) => row(sequence, {source: "demo", project_id: "demo-ml"})); },
    train(rows) {
      calls.train.push(rows);
      const provenance = rows[0].source === "demo" ? "synthetic" : "measured";
      return {model: {group_key: groupKey(rows[0]), provenance}, report: {provenance, selected_predictor: "persistence", alpha: 10, examples: {train: 2, validation: 1, test: 1}, validation: {ridge: metric, persistence: metric, moving_average: metric}, test: {ridge: metric, persistence: metric, moving_average: metric}}};
    },
    forecast(model, rows) { calls.forecast.push({model, rows}); return {status: "ready", prediction_ms: 620, ml_prediction_ms: 590, method: "persistence", horizon_s: 5}; },
  };
  const engine = engineOverride || stubEngine;
  const blobs = new Map();
  const URLStub = {createObjectURL(blob) { const id = "blob:" + blobs.size; blobs.set(id, blob); return id; }, revokeObjectURL() {}};
  const window = {document, SigHeatML: engine, SigHeatCore: Core};
  vm.runInNewContext(uiSource, {window, document, Date: {now: () => now}, URL: URLStub, Blob, console, setTimeout(fn) {jobs.push(fn); return jobs.length;}});
  return {get, row, calls, downloads, blobs, panel: window.SigHeatMLPanel, engine,
    click(id) {get(id).click();},
    runJobs() {while (jobs.length) jobs.shift()();},
    setNow(value) {now = value;},
    update(extra = {}) {window.SigHeatMLPanel.updateSelection({selected: "hp-a", connected: true, staleDeviceIds: [], ...extra});},
  };
}

function collect(h, extra = {}, count = 4) {
  for (let i = 1; i <= count; i++) h.panel.ingest(h.row(i, extra));
  h.update();
}

test("ML panel trains only on explicit action and shows a baseline as the chosen predictor", () => {
  const h = harness(); collect(h);
  assert.equal(h.calls.train.length, 0);
  assert.equal(h.get("ml-train").disabled, false);
  h.click("ml-train");
  assert.equal(h.get("ml-train").disabled, true);
  h.runJobs();
  assert.equal(h.calls.train.length, 1);
  assert.match(h.get("ml-prediction").textContent, /620/);
  assert.match(h.get("ml-prediction-note").textContent, /baseline/);
  assert.match(h.get("ml-ridge").textContent, /590/);
  assert.match(h.get("ml-selection-note").textContent, /belum melewati/);
  assert.match(h.get("ml-warning").textContent, /berbasis aturan/);
});

test("device, reboot, and interval changes do not merge training examples", () => {
  const h = harness(); collect(h);
  collect(h, {device_id: "hp-b"});
  h.click("ml-train"); h.runJobs();
  assert.deepEqual([...new Set(h.calls.train[0].map((r) => r.device_id))], ["hp-a"]);
  h.panel.ingest(h.row(1, {boot_id: "boot-two", sent_at_ms: 1793700005000})); h.update();
  assert.equal(h.get("ml-train").disabled, true);
  assert.equal(h.get("ml-export-model").disabled, true);
  assert.match(h.get("ml-data-note").textContent, /^1 sampel/);
  h.panel.ingest(h.row(2, {boot_id: "boot-two", interval_s: 10, sent_at_ms: 1793700015000})); h.update();
  assert.match(h.get("ml-data-note").textContent, /^1 sampel/);
});

test("disconnected, offline, or old device data suppresses predictions but preserves evaluation", () => {
  const h = harness(); collect(h); h.click("ml-train"); h.runJobs();
  h.update({connected: false});
  assert.equal(h.get("ml-prediction").textContent, "–");
  assert.equal(h.get("ml-results").children.length, 3);
  h.update({staleDeviceIds: ["hp-a"]});
  assert.equal(h.get("ml-prediction").textContent, "–");
  h.setNow(1793700100000); h.update();
  assert.match(h.get("ml-prediction-note").textContent, /dijeda/);
});

test("synthetic demo explicitly disconnects and clears measured history; live ingestion clears demo", () => {
  const h = harness(); collect(h); let disconnected = 0;
  h.panel.configure({onDemo() {disconnected++; h.panel.reset();}});
  h.click("ml-demo");
  assert.equal(disconnected, 1);
  assert.match(h.get("ml-provenance").textContent, /SINTETIS/);
  assert.equal(h.calls.train.length, 0);
  h.click("ml-train"); h.runJobs();
  assert.ok(h.calls.train[0].every((row) => row.source === "demo"));
  h.panel.ingest(h.row(1)); h.update();
  assert.equal(h.get("ml-provenance").textContent, "PENGUKURAN PERANGKAT");
  assert.equal(h.get("ml-export-model").disabled, true);
  assert.match(h.get("ml-data-note").textContent, /^1 sampel/);
});

test("late training callback cannot restore a model after reset", () => {
  const h = harness(); collect(h); h.click("ml-train"); h.panel.reset(); h.runJobs();
  assert.equal(h.calls.train.length, 0);
  assert.equal(h.get("ml-export-model").disabled, true);
});

test("ML CSV preserves boot/sequence/interval and null timeout without exporting coordinates", async () => {
  const h = harness(); collect(h);
  h.panel.ingest(h.row(5, {latency_ms: null, probe_ok: false, latitude: -7, longitude: 110, sent_at_ms: 1793700005000})); h.update();
  h.click("ml-export-data");
  assert.equal(h.downloads.length, 1);
  const csv = await h.blobs.get(h.downloads[0].url).text();
  assert.match(csv, /boot_id,sequence,source/);
  assert.match(csv, /interval_s/);
  assert.doesNotMatch(csv.split("\n")[0], /latitude|longitude/);
  const lines = csv.trim().split(/\r?\n/), cols = lines[0].replace(/^\ufeff/, "").split(","), last = lines.at(-1).split(",").map((value) => value.replace(/^"|"$/g, ""));
  assert.equal(last[cols.indexOf("latency_ms")], "");
  assert.equal(last[cols.indexOf("probe_ok")], "false");
});

test("repeated and out-of-order samples cannot inflate dataset; labels use text nodes", () => {
  const h = harness(); const id = "<img src=x onerror=alert(1)>";
  h.panel.ingest(h.row(1, {device_id: id}));
  h.panel.ingest(h.row(1, {device_id: id}));
  h.panel.ingest(h.row(0, {device_id: id}));
  h.update({selected: id});
  assert.match(h.get("ml-data-note").textContent, /^1 sampel/);
  assert.match(h.get("ml-device").children[0].textContent, /<img/);
});


test("real Ridge engine completes browser panel synthetic training and exports a reusable model", async () => {
  const ML = require("../assets/ml.js");
  const h = harness(ML);
  h.click("ml-demo"); h.click("ml-train"); h.runJobs();
  assert.match(h.get("ml-status").textContent, /Latihan selesai pada data sintetis/);
  assert.notEqual(h.get("ml-prediction").textContent, "–");
  assert.equal(h.get("ml-results").children.length, 3);
  h.click("ml-export-model");
  const model = JSON.parse(await h.blobs.get(h.downloads[0].url).text());
  assert.equal(ML.validateModel(model), true);
  assert.equal(model.provenance, "synthetic");
  const result = ML.forecast(model, ML.generateDemoRows());
  assert.equal(result.status, "ready");
  assert.match(h.get("ml-prediction-note").textContent, /interval nominal 5 dtk/);
});
