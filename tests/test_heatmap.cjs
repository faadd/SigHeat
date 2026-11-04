"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const H = require("../assets/heatmap.js");
const row = (quality, latitude = -6.99, longitude = 110.42, extra = {}) => ({latitude, longitude, accuracy_m: 5,
  probe_ok: true, ml_classification: {quality}, ...extra});
const rgba = (raster, x, y) => [...raster.data.slice((y * raster.width + x) * 4, (y * raster.width + x) * 4 + 4)];

test("heatmap browser module loads locally and exposes the stated viridis legend anchors", () => {
  const context = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../assets/heatmap.js"), "utf8"), context);
  assert.equal(context.SigHeatHeatmap.RADIUS_METERS, 35);
  assert.deepEqual(H.colorAt(0), [68, 1, 84]);
  assert.deepEqual(H.colorAt(0.5), [33, 145, 140]);
  assert.deepEqual(H.colorAt(1), [253, 231, 37]);
  assert.equal(H.hexAt(0), "#440154");
  assert.equal(H.hexAt(0.5), "#21918c");
  assert.equal(H.hexAt(1), "#fde725");
  assert.equal(H.colorAt(NaN), null);
});

test("surface values use current learned classes; old wire thresholds and unknown probes never become low load", () => {
  const data = [row("poor", -6.99, 110.42, {latency_ms: 10}), row("unknown", -6.9901),
    row("good", -6.9902, 110.42, {probe_ok: false}),
    {...row("good", -6.9903), ml_classification: null, connection_quality: "good"}];
  const prepared = H.prepareSamples(data);
  assert.equal(prepared.knownCount, 1); assert.equal(prepared.unknownCount, 3);
  assert.equal(prepared.samples.length, 1); assert.equal(prepared.samples[0].value, 1);
  const updated = H.prepareSamples(data.slice(0, 1), {classify: () => ({quality: "fair"})});
  assert.equal(updated.samples[0].value, 0.5);
});

test("fixed geographic bins average their observed class and do not amplify repeatedly sampled locations", () => {
  const low = row("good"), high = row("poor", -6.99, 110.421);
  const base = H.prepareSamples([low, high]), repeated = H.prepareSamples([...Array(80).fill(low), high]);
  assert.equal(base.binCount, 2); assert.equal(repeated.binCount, 2);
  assert.deepEqual(base.samples.map(({count, ...s}) => s), repeated.samples.map(({count, ...s}) => s));
  assert.equal(repeated.samples[0].count, 80);
  const varied = H.prepareSamples([low, row("poor")]);
  assert.equal(varied.binCount, 1); assert.equal(varied.samples[0].value, 0.5);
});

test("location uncertainty and missing metadata are accounted for explicitly", () => {
  const prepared = H.prepareSamples([row("good"), row("fair", -6.9901, 110.42, {accuracy_m: 36}),
    row("poor", -6.9902, 110.42, {accuracy_m: null}), row("good", -6.9903, 110.42, {accuracy_m: -1}),
    row("fair", 90), row("fair", -6.9, Infinity)]);
  assert.equal(prepared.inputCount, 6); assert.equal(prepared.locatedCount, 4);
  assert.equal(prepared.uncertainCount, 2); assert.equal(prepared.invalidCount, 2);
  assert.equal(prepared.unknownAccuracyCount, 1); assert.equal(prepared.knownCount, 2);
  assert.equal(prepared.samples.length, 2);
  assert.equal(H.prepareSamples([row("fair", -6.99, 110.42, {accuracy_m: 35})]).knownCount, 1);
});

test("relative categories from different learned contexts are never merged into a surface", () => {
  const prepared = H.prepareSamples([row("good", -6.99, 110.42, {source: "browser"}),
    row("poor", -6.991, 110.42, {source: "termux"})], {scope: (r) => r.source});
  assert.equal(prepared.mixedContexts, true); assert.equal(prepared.scopeCount, 2);
  assert.equal(prepared.samples.length, 0); assert.match(prepared.reason, /Konteks/);
});

test("compact kernels form a bounded surface and leave unsampled areas transparent", () => {
  const raster = H.buildRaster([{x: 20.5, y: 20.5, value: 1}], 41, 41, {radiusPx: 10, pixelStep: 1});
  assert.deepEqual(rgba(raster, 20, 20), [253, 231, 37, 220]);
  assert(rgba(raster, 28, 20)[3] > 0);
  assert.equal(rgba(raster, 30, 20)[3], 0); // Exactly at the support radius.
  assert.equal(rgba(raster, 28, 28)[3], 0); // Within its bounding square but outside circle.
  assert(Number.isNaN(raster.scores[30 * raster.width + 20]));
  assert.equal(raster.scores[20 * raster.width + 20], 1);
});

test("normalized interpolation blends low/high as medium while density cannot make a low point high", () => {
  const samples = [{x: 14.5, y: 20.5, value: 0}, {x: 26.5, y: 20.5, value: 1}];
  const normal = H.buildRaster(samples, 41, 41, {radiusPx: 15, pixelStep: 1});
  assert(Math.abs(normal.scores[20 * normal.width + 20] - 0.5) < 1e-6);
  assert.deepEqual(rgba(normal, 20, 20).slice(0, 3), H.colorAt(0.5));
  const repeated = H.buildRaster([...Array(100).fill(samples[0]), samples[1]], 41, 41, {radiusPx: 15, pixelStep: 1});
  assert.equal(repeated.sampleCount, 2);
  assert.deepEqual(repeated.data, normal.data);
  const lowOnly = H.buildRaster(Array.from({length: 30}, (_, i) => ({x: 10 + i * 0.1, y: 10, value: 0})), 30, 30, {radiusPx: 10, pixelStep: 1});
  for (let i = 0; i < lowOnly.scores.length; i++) if (Number.isFinite(lowOnly.scores[i])) assert.equal(lowOnly.scores[i], 0);
});

test("opacity indicates proximity to observation, independently of repeated observations", () => {
  const one = H.buildRaster([{x: 10.5, y: 10.5, value: 0}], 25, 25, {radiusPx: 10, pixelStep: 1});
  const two = H.buildRaster([{x: 10.5, y: 10.5, value: 0}, {x: 10.5, y: 10.5, value: 1}], 25, 25, {radiusPx: 10, pixelStep: 1});
  for (let i = 3; i < one.data.length; i += 4) assert.equal(one.data[i], two.data[i]);
  assert.equal(two.scores[10 * two.width + 10], 0.5);
});

test("viewport clipping preserves partial kernels and rejects invalid projected points", () => {
  const raster = H.buildRaster([{x: -2, y: 10, value: 0.5}, {x: 1000, y: 1000, value: 1},
    {x: NaN, y: 5, value: 1}, {x: 5, y: 5, value: null}, {x: 5, y: 5, value: 2}], 25, 25, {radiusPx: 10, pixelStep: 1});
  assert.equal(raster.sampleCount, 1); assert(raster.coveredCells > 0);
  assert.equal(rgba(raster, 20, 20)[3], 0);
});

test("empty and entirely unknown datasets cannot fabricate heat", () => {
  assert.equal(H.prepareSamples([row("unknown")]).samples.length, 0);
  const raster = H.buildRaster([], 400, 300, {radiusPx: 50});
  assert.equal(raster.coveredCells, 0); assert(raster.data.every((n) => n === 0));
  assert(raster.scores.every(Number.isNaN));
});

test("raster memory and kernel work remain bounded without changing the geographic support radius", () => {
  const samples = Array.from({length: 250}, (_, i) => ({x: i * 20, y: (i % 20) * 100, value: (i % 3) / 2}));
  const raster = H.buildRaster(samples, 8000, 4000, {radiusPx: 100000, maxCells: 200, maxOperations: 50000});
  assert(raster.width * raster.height <= 200);
  assert(raster.operations <= 50000);
  assert.equal(raster.radiusPx, 100000);
  assert.equal(raster.scaleX * raster.width, 8000);
  assert.equal(raster.scaleY * raster.height, 4000);
  for (const score of raster.scores) assert(score >= 0 && score <= 1);
  assert.throws(() => H.buildRaster([], 0, 20, {radiusPx: 10}), /Ukuran/);
  assert.throws(() => H.buildRaster([], 20, 20, {radiusPx: Infinity}), /Opsi/);
  assert.throws(() => H.buildRaster([], 20, 20, {radiusPx: 10, maxCells: 0}), /Opsi/);
  assert.throws(() => H.prepareSamples([], {binMeters: 0}), /Opsi/);
});
