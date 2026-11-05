"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const C = require("../assets/core.js");
const project = path.resolve(__dirname, "..");
const html = () => fs.readFileSync(path.join(project, "dashboard.html"), "utf8");
const app = () => fs.readFileSync(path.join(project, "assets/app.js"), "utf8");
const now = Date.now();
const sample = (extra = {}) => ({schema_version: 2, latency_type: "mqtt_app_rtt", device_id: "hp-a", boot_id: "boot-a", sequence: 1, sent_at_ms: now - 5000, source: "browser", broker_endpoint: "wss://example.test/mqtt", interval_s: 5, latency_ms: 40, latency_mean_ms: 40, latency_std_ms: 3, success_pct: 100, probe_count: 3, probe_ok: true, accel_rms: .02, accel_mode: "linear", gyro_rms_rad_s: .1, rotation_total_rad: .02, accel_available: true, gyro_available: true, accel_samples: 10, gyro_samples: 10, latitude: -7.05, longitude: 110.44, accuracy_m: 8, location_at_ms: now - 5000, sensor_errors: [], connection_quality: "good", ...extra});

function harness(options = {}) {
  class Node {
    constructor(tag = "div") {
      this.tagName = tag; this.children = []; this.handlers = {}; this.attributes = {}; this.style = {}; this.dataset = {}; this.options = [{}];
      this.value = ""; this.disabled = false; this.hidden = false; this.textContent = ""; this.clientWidth = 800; this.clientHeight = 400;
      const classes = new Set();
      this.classList = {toggle(value, enabled) {if (enabled) classes.add(value); else classes.delete(value);}, add(value) {classes.add(value);}, remove(value) {classes.delete(value);}, contains(value) {return classes.has(value);}};
    }
    append(...nodes) {this.children.push(...nodes); nodes.forEach((n) => {n.parentNode = this;});}
    appendChild(node) {this.append(node); return node;}
    replaceChildren(...nodes) {this.textContent = ""; this.children = []; this.append(...nodes);}
    addEventListener(type, fn) {this.handlers[type] = fn;}
    setAttribute(key, value) {this.attributes[key] = String(value);}
    getAttribute(key) {return this.attributes[key];}
    remove() {if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((n) => n !== this);}
    showModal() {this.open = true;} close() {this.open = false;} focus() {}
    set innerHTML(_) {throw new Error("Unsafe HTML sink");}
  }
  const nodes = new Map(), clients = [], maps = [], tileLayers = [], heatLayers = [], markerGroups = [];
  const get = (id) => {if (!nodes.has(id)) nodes.set(id, new Node()); return nodes.get(id);};
  const document = {body: Object.assign(new Node(), {dataset: {page: "dashboard"}}), getElementById: get, createElement: (tag) => new Node(tag), createElementNS: (_, tag) => new Node(tag), createTextNode: (text) => ({textContent: text}), querySelectorAll: () => [], querySelector: get};
  class Message {constructor(payloadString) {this.payloadString = payloadString;}}
  class Client {
    constructor() {this.connected = false; clients.push(this);}
    connect(settings) {this.settings = settings;} isConnected() {return this.connected;} disconnect() {this.connected = false;}
    subscribe(_topic, settings) {settings.onSuccess({grantedQos: [1]});} send() {}
  }
  const L = {
    map() {
      const map = {removed: false, layers: [], setView() {return this;}, fitBounds(bounds, settings) {this.bounds = bounds; this.fitOptions = settings; return this;},
        invalidateSize() {}, remove() {this.removed = true; this.layers.forEach((layer) => {layer.removed = true;});},
        removeLayer(layer) {layer.removed = true; this.layers = this.layers.filter((value) => value !== layer); return this;},
        addLayer(layer) {this.layers.push(layer); return this;}, on() {return this;}, off() {return this;}};
      maps.push(map); return map;
    },
    layerGroup() {
      const group = {items: [], addTo(map) {this.map = map; map.addLayer(this); return this;}, clearLayers() {this.items = [];}};
      markerGroups.push(group); return group;
    },
    tileLayer(url, settings) {
      const layer = {url, settings, handlers: {}, addTo(map) {this.map = map; map.addLayer(this); return this;}, on(name, fn) {this.handlers[name] = fn; return this;},
        remove() {this.map.removeLayer(this); return this;}};
      tileLayers.push(layer); return layer;
    },
    circleMarker(location, settings) {
      return {location, settings, addTo(group) {group.items.push(this); return this;}, bindPopup(content) {this.popup = content; return this;}, on() {return this;}};
    },
    control: {scale() {return {addTo() {}};}},
  };
  let quality = "poor", callbacks = {};
  const panel = {classify(row) {const q = row.probe_ok ? quality : "unknown"; return {quality: q, model_id: "current-" + quality, label: q};}, configure(value) {callbacks = value;}, reset() {}, ingest() {}, updateSelection() {}};
  const H = require("../assets/heatmap.js");
  const heatAPI = {create(_L, settings = {}) {
    const layer = {samples: [], calls: [], addTo(map) {this.map = map; map.addLayer(this); return this;}, setSamples(samples) {this.samples = samples; this.calls.push(samples); settings.onRender?.({coveredCells: samples.length ? 100 : 0, zoomTooWide: false}); return this;}, remove() {this.map?.removeLayer(this); return this;}};
    heatLayers.push(layer); return layer;
  }};
  const window = {SigHeatCore: {...C, quality() {throw new Error("Heatmap used a legacy threshold");}}, SigHeatMLPanel: options.withPanel === false ? undefined : panel,
    SigHeatHeatmap: H, SigHeatHeat: H, SigHeatHeatLayer: options.withHeatLayer === false ? undefined : heatAPI, L: options.withLeaflet === false ? undefined : L,
    Paho: {Client, Message}, isSecureContext: true, addEventListener() {}};
  vm.runInNewContext(app(), {window, document, L, URL, Date, Number, console, navigator: {}, setInterval() {return 1;}, setTimeout() {return 1;}, clearTimeout() {}});
  get("broker-url").value = "wss://example.test/mqtt"; get("project-id").value = "integration";
  get("connection-form").handlers.submit({preventDefault() {}});
  const client = clients[0]; client.connected = true; client.settings.onSuccess();
  return {get, maps, tileLayers, heatLayers, markerGroups, click(id) {get(id).handlers.click();},
    receive(payload) {client.onMessageArrived({retained: false, destinationName: C.topic("integration", payload.device_id, "telemetry"), payloadString: JSON.stringify(payload)});},
    changeQuality(value) {quality = value; callbacks.onChange();},
    failTiles(n = 3) {const layer = tileLayers.at(-1); for (let i = 0; i < n; i++) layer.handlers.tileerror?.();},
  };
}

test("Mode Heatmap follows Peta jalan, loads local dependencies, and has an explanatory legend", () => {
  const source = html();
  const ids = [...source.matchAll(/<button\b[^>]*\bid="(map-[^"]+)"[^>]*>/g)].map((match) => match[1]);
  assert.equal(ids[ids.indexOf("map-roads") + 1], "map-heatmap");
  assert.match(source, /id="map-heatmap"[^>]*>\s*Mode Heatmap\s*<\/button/);
  const ordered = ["assets/vendor/leaflet.js", "assets/heatmap.js", "assets/heatmap-layer.js", "assets/app.js"].map((name) => source.indexOf(name));
  assert.ok(ordered.every((offset, i) => offset >= 0 && (!i || offset > ordered[i - 1])));
  assert.match(source, /id="heatmap-legend"/); assert.match(source, /id="map-standard-legend"/);
  assert.match(source, /[Uu]ngu/); assert.match(source, /[Kk]uning/); assert.match(source, /35\s*m/);
  assert.doesNotMatch(source, /https?:\/\/[^"']*(?:maps\.google|mapbox|maptiler)/i);
});

test("heatmap follows the current learned classifier, not wire quality or raw RTT", () => {
  const h = harness(); h.receive(sample()); h.click("map-heatmap");
  assert.equal(h.heatLayers.length, 1);
  assert.ok(h.heatLayers.at(-1).samples.length > 0);
  assert.ok(h.heatLayers.at(-1).samples.every((row) => row.value === 1)); // A 40ms RTT can still be learned high.
  assert.equal(h.get("heatmap-legend").hidden, false);
  assert.equal(h.get("map-standard-legend").hidden, true);
  assert.equal(h.get("map-heatmap").getAttribute("aria-pressed"), "true");
  h.changeQuality("good");
  assert.ok(h.heatLayers.at(-1).samples.every((row) => row.value === 0));
  h.click("map-roads");
  assert.equal(h.maps[0].removed, true);
  assert.equal(h.heatLayers[0].removed, true);
  assert.equal(h.get("heatmap-legend").hidden, true);
  assert.equal(h.get("map-standard-legend").hidden, false);
  h.click("map-points");
  assert.ok(h.maps.every((map) => map.removed));
});

test("heatmap excludes timeouts, missing locations, and locations less precise than the support radius", () => {
  const h = harness();
  h.receive(sample({probe_ok: false, latency_ms: null, latency_mean_ms: null, latency_std_ms: null, success_pct: 0}));
  h.receive(sample({device_id: "hp-b", latitude: null, longitude: null, accuracy_m: null, location_at_ms: null}));
  h.receive(sample({device_id: "hp-c", accuracy_m: 200}));
  h.click("map-heatmap");
  assert.equal(h.heatLayers.at(-1).samples.length, 0);
  assert.match(h.get("heatmap-status").textContent, /belum|tidak|akurasi/i);
});

test("mixed classifier contexts cannot silently be blended and an active map is cleaned up", () => {
  const h = harness(); h.receive(sample()); h.click("map-heatmap");
  h.receive(sample({device_id: "hp-b", interval_s: 10}));
  assert.equal(h.get("map-heatmap").disabled, true);
  assert.equal(h.maps[0].removed, true);
  assert.equal(h.get("map-heatmap").getAttribute("aria-pressed"), "false");
  const count = h.heatLayers.length; h.click("map-heatmap"); assert.equal(h.heatLayers.length, count);
});

test("selecting one source restores a comparable heatmap without mixing the other runtime", () => {
  const h = harness(); h.receive(sample()); h.receive(sample({device_id: "hp-b", source: "termux", longitude: 110.442}));
  assert.equal(h.get("map-heatmap").disabled, true);
  h.get("source-filter").handlers.change({target: {value: "browser"}});
  assert.equal(h.get("map-heatmap").disabled, false);
  h.click("map-heatmap");
  assert.equal(h.heatLayers.at(-1).samples.length, 1);
  assert.ok(Math.abs(h.heatLayers.at(-1).samples[0].longitude - 110.44) < 0.0001);
});

test("missing ML model never produces a false heatmap from a good wire label", () => {
  const h = harness({withPanel: false}); h.receive(sample()); h.click("map-heatmap");
  assert.equal(h.heatLayers.at(-1).samples.length, 0);
  assert.match(h.get("heatmap-status").textContent, /belum terklasifikasi/);
  assert.equal(h.markerGroups.at(-1).items[0].settings.fillColor, "#7c8b7d");
});

test("failed public road tiles leave the locally computed heatmap available", () => {
  const h = harness(); h.receive(sample()); h.click("map-heatmap"); h.failTiles();
  assert.equal(h.maps[0].removed, false);
  assert.equal(h.tileLayers[0].removed, true);
  assert.equal(h.heatLayers[0].removed, undefined);
  assert.equal(h.get("map-heatmap").getAttribute("aria-pressed"), "true");
  assert.match(h.get("map-view-note").textContent + h.get("heatmap-status").textContent, /tanpa peta|gagal|tidak tersedia/i);
  assert.equal(h.tileLayers[0].url, "https://tile.openstreetmap.org/{z}/{x}/{y}.png");
  assert.match(h.tileLayers[0].settings.attribution, /OpenStreetMap/);
});

test("empty map and unavailable heatmap dependency remain usable with an explicit status", () => {
  const empty = harness(); empty.click("map-heatmap");
  assert.equal(empty.heatLayers.at(-1).samples.length, 0);
  assert.match(empty.get("heatmap-status").textContent, /belum|lokasi/i);
  const missing = harness({withHeatLayer: false}); missing.receive(sample()); missing.click("map-heatmap");
  assert.equal(missing.heatLayers.length, 0);
  assert.match(missing.get("toast").textContent + missing.get("heatmap-status").textContent, /belum|tidak|gagal/i);
});

function layerHarness(noCanvas = false) {
  const frames = new Map(), canvases = [], reports = [], handlers = new Map();
  let nextFrame = 0;
  const pane = {children: [], appendChild(canvas) {this.children.push(canvas); canvas.parent = this;}};
  const root = {SigHeatHeatmap: require("../assets/heatmap.js"), requestAnimationFrame(fn) {frames.set(++nextFrame, fn); return nextFrame;}, cancelAnimationFrame(id) {frames.delete(id);}};
  const L = {
    Layer: {extend(methods) {
      class Layer {
        constructor() {this.initialize();}
        addTo(map) {this.onAdd(map); for (const [name, fn] of Object.entries(this.getEvents())) handlers.set(name, fn.bind(this)); return this;}
        remove() {this.onRemove(); handlers.clear(); return this;}
      }
      Object.assign(Layer.prototype, methods); return Layer;
    }},
    DomUtil: {
      create(tag, cls) {
        const context = {createImageData(width, height) {return {data: new Uint8ClampedArray(width * height * 4), width, height};}, putImageData(image) {this.lastImage = image;}};
        const canvas = {tag, className: cls, style: {}, attributes: {}, setAttribute(k, v) {this.attributes[k] = v;}, getContext() {return noCanvas ? null : context;},
          remove() {this.parent.children = this.parent.children.filter((n) => n !== this);}, context};
        canvases.push(canvas); return canvas;
      },
      setPosition(canvas, position) {canvas.position = position;},
    },
  };
  const map = {metersPerPixel: 1, offset: {x: 0, y: 0}, size: {x: 80, y: 80}, getPane() {return pane;}, getSize() {return this.size;},
    containerPointToLayerPoint() {return {...this.offset};}, containerPointToLatLng(p) {return p;}, distance() {return this.metersPerPixel;},
    latLngToContainerPoint(p) {return {x: p[1], y: p[0]};}};
  vm.runInNewContext(fs.readFileSync(path.join(project, "assets/heatmap-layer.js"), "utf8"), root);
  const layer = root.SigHeatHeatLayer.create(L, {onRender(result) {reports.push(result);}});
  return {layer, map, frames, canvases, reports, pane, fire(name) {handlers.get(name)?.();}, flush() {const work = [...frames.values()]; frames.clear(); work.forEach((fn) => fn());}};
}

test("Leaflet adapter redraws actual normalized pixels for live changes and cleans its queued canvas", () => {
  const h = layerHarness();
  h.layer.setSamples([{latitude: 40, longitude: 40, value: 0}]).addTo(h.map);
  assert.equal(h.frames.size, 1); h.flush();
  const canvas = h.canvases[0], first = canvas.context.lastImage;
  assert.equal(canvas.style.pointerEvents, "none"); assert.equal(canvas.attributes["aria-hidden"], "true");
  assert.ok(h.reports.at(-1).coveredCells > 0);
  const center = 4 * (20 * first.width + 20);
  assert.deepEqual([...first.data.slice(center, center + 3)], [68, 1, 84]);
  h.layer.setSamples([{latitude: 40, longitude: 40, value: 1}]);
  h.layer.setSamples([{latitude: 40, longitude: 40, value: 1}]);
  assert.equal(h.frames.size, 1); h.flush();
  assert.deepEqual([...canvas.context.lastImage.data.slice(center, center + 3)], [253, 231, 37]);
  h.map.offset = {x: 13, y: -7}; h.fire("moveend"); h.flush();
  assert.equal(canvas.position.x, 13); assert.equal(canvas.position.y, -7);
  h.fire("resize"); assert.equal(h.frames.size, 1);
  h.layer.remove(); assert.equal(h.frames.size, 0); assert.equal(h.pane.children.length, 0);
  h.fire("moveend"); assert.equal(h.frames.size, 0);
});

test("Leaflet adapter clears stale color when zoom is too wide or Canvas fails", () => {
  const h = layerHarness(); h.layer.setSamples([{latitude: 40, longitude: 40, value: 1}]).addTo(h.map); h.flush();
  h.map.metersPerPixel = 20; h.fire("zoomend"); h.flush();
  assert.equal(h.reports.at(-1).zoomTooWide, true); assert.equal(h.reports.at(-1).coveredCells, 0);
  assert.equal(h.canvases[0].width, 1); assert.equal(h.canvases[0].height, 1);
  h.map.metersPerPixel = 1; h.fire("resize"); h.flush(); assert.ok(h.reports.at(-1).coveredCells > 0);
  const unavailable = layerHarness(true); unavailable.layer.addTo(unavailable.map); unavailable.flush();
  assert.match(unavailable.reports.at(-1).error, /Canvas 2D/);
  assert.equal(unavailable.reports.at(-1).coveredCells, 0);
});
