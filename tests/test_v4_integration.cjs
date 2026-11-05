"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const C = require("../assets/core.js");
const project = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(project, "dashboard.html"), "utf8");
const app = fs.readFileSync(path.join(project, "assets/app.js"), "utf8");
const now = Date.now();
const sample = (extra = {}) => ({schema_version: 2, latency_type: "mqtt_app_rtt", device_id: "hp-a", boot_id: "boot-a", sequence: 1, sent_at_ms: now - 5000, source: "browser", broker_endpoint: "wss://example.test/mqtt", interval_s: 5, latency_ms: 40, latency_mean_ms: 40, latency_std_ms: 3, success_pct: 100, probe_count: 3, probe_ok: true, accel_rms: .02, accel_mode: "linear", gyro_rms_rad_s: .1, rotation_total_rad: .02, accel_available: true, gyro_available: true, accel_samples: 10, gyro_samples: 10, latitude: -7.05, longitude: 110.44, accuracy_m: 8, location_at_ms: now - 5000, sensor_errors: [], connection_quality: "good", ...extra});
const flatten = (node) => String(node.textContent || "") + (node.children || []).map(flatten).join("");
function dashboardHarness(withPanel = true) {
  class Node {
    constructor(tag = "div") {this.tagName = tag; this.children = []; this.handlers = {}; this.attributes = {}; this.style = {}; this.dataset = {}; this.options = [{}]; this.value = ""; this.disabled = false; this.textContent = ""; this.clientWidth = 800; this.clientHeight = 400; this.classList = {toggle() {}, add() {}, remove() {}};}
    append(...items) { this.children.push(...items); } replaceChildren(...items) { this.textContent = ""; this.children = items; }
    addEventListener(type, fn) { this.handlers[type] = fn; } setAttribute(key, value) { this.attributes[key] = value; } showModal() { this.open = true; } close() { this.open = false; }
    set innerHTML(_) { throw new Error("Unsafe HTML sink"); }
  }
  const nodes = new Map(), clients = [], seen = [], selections = [];
  let quality = "poor", callbacks = {};
  const get = (id) => { if (!nodes.has(id)) nodes.set(id, new Node()); return nodes.get(id); };
  const document = {body: Object.assign(new Node(), {dataset: {page: "dashboard"}}), getElementById: get, createElement: (tag) => new Node(tag), createElementNS: (_, tag) => new Node(tag), createTextNode: (text) => ({textContent: text}), querySelectorAll: () => [], querySelector: get};
  class Message {constructor(payloadString) {this.payloadString = payloadString;}}
  class Client {
    constructor() {this.connected = false; this.sent = []; clients.push(this);}
    connect(options) {this.options = options;} isConnected() {return this.connected;} disconnect() {this.connected = false;}
    subscribe(topic, options) {options.onSuccess({grantedQos: [1]});} send(message) {this.sent.push(message);}
  }
  const panel = {classify(row) { const q = row.probe_ok ? quality : "unknown"; return {quality: q, model_id: "current-" + quality, label: q}; }, configure(value) {callbacks = value;}, reset() {}, ingest(row) {seen.push(row);}, updateSelection(value) {selections.push(value);}};
  const window = {SigHeatCore: {...C, quality() {throw new Error("Dashboard used a legacy threshold");}}, SigHeatMLPanel: withPanel ? panel : undefined, Paho: {Client, Message}, isSecureContext: true, addEventListener() {}};
  vm.runInNewContext(app, {window, document, URL, Date, Number, console, navigator: {}, setInterval() {return 1;}, setTimeout() {return 1;}, clearTimeout() {}});
  get("broker-url").value = "wss://example.test/mqtt"; get("project-id").value = "integration";
  get("connection-form").handlers.submit({preventDefault() {}});
  const client = clients[0]; client.connected = true; client.options.onSuccess();
  const receive = (payload) => client.onMessageArrived({retained: false, destinationName: C.topic("integration", payload.device_id, "telemetry"), payloadString: JSON.stringify(payload)});
  return {get, seen, selections, receive, changeQuality(q) {quality = q; callbacks.onChange();}, buttons(cls) {const found = []; const visit = (n) => {if (n.className?.split(" ").includes(cls)) found.push(n); (n.children || []).forEach(visit);}; visit(get("signal-map")); return found;}};
}

test("dashboard has one main learning summary, no prediction/training tab, and ordered static model scripts", () => {
  assert.doesNotMatch(html, /data-view=["']ml["']|id=["']view-ml["']|id=["']ml-train["']/);
  assert.ok(html.indexOf('id="view-map"') < html.indexOf('id="learning-heading"'));
  assert.match(html, /<details[^>]+id="learning-details"/);
  const scripts = ["core", "ml", "default-model", "clusters", "learning", "learning-seed", "ml-ui", "app"].map((id) => html.indexOf(`assets/${id}.js`));
  assert.ok(scripts.every((position, i) => position >= 0 && (!i || position > scripts[i - 1])));
  assert.doesNotMatch(app, /C\.quality\s*\(|connection_quality/);
  assert.match(html, /KMeans/); assert.match(html, /bukan standar jaringan/);
});

test("learned grid uses current sample classes, reports unknown/ties/model IDs, and separates interval contexts", () => {
  const rows = [sample(), sample({sequence: 2})];
  const options = {classify: () => ({quality: "poor", model_id: "current-learned"}), scope: (r) => JSON.stringify([r.source, r.broker_endpoint, r.interval_s])};
  let cells = C.aggregateGrid(rows, 25, options);
  assert.equal(cells[0].latency_mean_ms, 40); assert.equal(cells[0].quality, "poor");
  assert.deepEqual(cells[0].quality_counts, {good: 0, fair: 0, poor: 2, unknown: 0});
  assert.deepEqual(cells[0].quality_model_ids, ["current-learned"]);
  cells = C.aggregateGrid(rows, 25, {...options, classify: (r) => ({quality: r.sequence === 1 ? "good" : "poor"})});
  assert.equal(cells[0].quality, "unknown");
  cells = C.aggregateGrid([rows[0], {...rows[1], interval_s: 10}], 25, options); assert.equal(cells.length, 2);
});

test("dashboard ignores wire threshold labels and reclassifies historical points, metrics, tables, chart and grid together", () => {
  const h = dashboardHarness(); h.receive(sample()); h.receive(sample({sequence: 2, sent_at_ms: now}));
  assert.equal(flatten(h.get("metric-weak")), "2sampel");
  assert.match(flatten(h.get("device-table")), /Beban relatif tinggi/);
  assert.match(h.get("detail-signal").textContent, /Beban relatif tinggi/);
  assert.ok(h.buttons("fallback-point").every((p) => p.style.background === "#bb6051" && p.title.includes("current-poor")));
  assert.equal(h.get("detail-chart").children[0].attributes.stroke, "#bb6051");
  assert.equal(h.seen.length, 2); assert.equal(h.seen[0].project_id, "integration");
  h.get("map-grid").handlers.click();
  assert.equal(h.buttons("measured-cell")[0].style.background, "#bb6051");
  assert.match(h.buttons("measured-cell")[0].title, /tinggi 2.*model current-poor/);
  h.changeQuality("good");
  assert.equal(flatten(h.get("metric-weak")), "0sampel");
  assert.match(flatten(h.get("device-table")), /Beban relatif rendah/);
  assert.equal(h.get("detail-chart").children[0].attributes.stroke, "#28765a");
  assert.equal(h.buttons("measured-cell")[0].style.background, "#28765a");
  assert.match(h.buttons("measured-cell")[0].title, /rendah 2.*model current-good/);
  h.get("map-points").handlers.click(); assert.ok(h.buttons("fallback-point").every((p) => p.title.includes("current-good")));
});

test("missing model and observed timeout stay unknown without fixed threshold fallback", () => {
  const noModel = dashboardHarness(false); noModel.receive(sample());
  assert.match(flatten(noModel.get("device-table")), /Tidak terklasifikasi/);
  assert.equal(flatten(noModel.get("metric-weak")), "0sampel");
  noModel.get("map-grid").handlers.click(); assert.match(noModel.buttons("measured-cell")[0].title, /tidak terklasifikasi 1/);
  const h = dashboardHarness(); h.receive(sample({probe_ok: false, latency_ms: null, latency_mean_ms: null, latency_std_ms: null, success_pct: 0}));
  assert.match(flatten(h.get("device-table")), /Tidak terklasifikasi/); assert.match(h.get("detail-signal").textContent, /Probe timeout/);
  assert.equal(flatten(h.get("metric-weak")), "0sampel");
});

test("different intervals cannot silently share a relative-quality grid and ordinary demo only feeds synthetic rows", () => {
  const h = dashboardHarness(); h.receive(sample()); h.receive(sample({device_id: "hp-b", interval_s: 10}));
  assert.equal(h.get("map-grid").disabled, true); assert.match(h.get("source-filter-note").textContent, /tidak langsung sebanding/);
  h.get("map-grid").handlers.click(); assert.equal(h.buttons("measured-cell").length, 0);
  assert.equal(h.selections.at(-1).contextCount, 2);
  h.get("mode-action").handlers.click(); h.get("mode-action").handlers.click();
  const demo = h.seen.filter((row) => row.source === "demo"); assert.equal(demo.length, 12);
  for (const id of ["hp-a", "hp-b"]) {const rows = demo.filter((r) => r.device_id === id); assert.equal(rows[1].sent_at_ms - rows[0].sent_at_ms, rows[0].interval_s * 1000);}
});
