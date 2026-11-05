/* Local normalized heat surface. Colors describe learned ordinal profiles, never sample density. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SigHeatHeatmap = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const RADIUS_METERS = 35, BIN_METERS = 2, MAX_ROWS = 50000, MAX_LATITUDE = 85.05112878;
  const METERS_PER_DEGREE = 111319.49079327358;
  const QUALITY_VALUES = Object.freeze({good: 0, fair: 0.5, poor: 1});
  // Five samples of the perceptually ordered, color-vision-friendly viridis ramp.
  const STOPS = Object.freeze([[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]]);
  const finite = (n, lo = -Infinity, hi = Infinity) => typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi;
  function colorAt(value) {
    if (!finite(value)) return null;
    const position = Math.max(0, Math.min(1, value)) * (STOPS.length - 1);
    const i = Math.min(STOPS.length - 2, Math.floor(position)), t = position - i;
    return STOPS[i].map((v, channel) => Math.round(v + t * (STOPS[i + 1][channel] - v)));
  }
  function hexAt(value) {
    const c = colorAt(value);
    return c ? "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("") : null;
  }
  /*
   * Call with the CURRENT learned classifier. The wire connection_quality field is never read.
   * One fixed geographic 2m bin contributes one mean value, regardless of its sample count.
   * The bin center is deterministic, so repeats do not move its position or increase opacity.
   * Scopes are checked before interpolation: relative groups from different models cannot mix.
   */
  function prepareSamples(rows, options = {}) {
    if (!Array.isArray(rows) || rows.length > MAX_ROWS) throw new Error("Titik heatmap tidak valid atau terlalu banyak.");
    const binMeters = options.binMeters ?? BIN_METERS;
    const maxAccuracyMeters = options.maxAccuracyMeters ?? RADIUS_METERS;
    if (!finite(binMeters, 0.5, 25) || !finite(maxAccuracyMeters, 0, 100000)) throw new Error("Opsi skala heatmap tidak valid.");
    const classify = options.classify || ((row) => row.ml_classification);
    const scope = options.scope || (() => "");
    if (typeof classify !== "function" || typeof scope !== "function") throw new Error("Classifier/konteks heatmap tidak valid.");
    const bins = new Map(), scopes = new Set();
    const result = {samples: [], inputCount: rows.length, locatedCount: 0, knownCount: 0, unknownCount: 0,
      uncertainCount: 0, unknownAccuracyCount: 0, invalidCount: 0, binCount: 0, scopeCount: 0,
      mixedContexts: false, binMeters, radiusMeters: RADIUS_METERS, reason: ""};
    for (const row of rows) {
      if (!row || !finite(row.latitude, -MAX_LATITUDE, MAX_LATITUDE) || !finite(row.longitude, -180, 180)) {
        result.invalidCount++; continue;
      }
      result.locatedCount++;
      if (row.accuracy_m != null && (!finite(row.accuracy_m, 0, 100000) || row.accuracy_m > maxAccuracyMeters)) {
        result.uncertainCount++; continue;
      }
      let classification, context;
      try { classification = classify(row); context = scope(row); } catch (_) { result.unknownCount++; continue; }
      const quality = typeof classification === "string" ? classification : classification?.quality;
      const value = QUALITY_VALUES[quality];
      if (!finite(value, 0, 1) || row.probe_ok === false) { result.unknownCount++; continue; }
      if (typeof context !== "string") { result.invalidCount++; continue; }
      if (row.accuracy_m == null) result.unknownAccuracyCount++;
      result.knownCount++; scopes.add(context);
      const y = Math.floor((row.latitude + 90) * METERS_PER_DEGREE / binMeters);
      const latitude = (y + 0.5) * binMeters / METERS_PER_DEGREE - 90;
      const longitudeMeters = METERS_PER_DEGREE * Math.cos(latitude * Math.PI / 180);
      const x = Math.floor((row.longitude + 180) * longitudeMeters / binMeters), key = `${y}:${x}`;
      let bin = bins.get(key);
      if (!bin) {
        bin = {latitude, longitude: (x + 0.5) * binMeters / longitudeMeters - 180, total: 0, count: 0};
        bins.set(key, bin);
      }
      bin.total += value; bin.count++;
    }
    result.scopeCount = scopes.size; result.mixedContexts = scopes.size > 1;
    if (result.mixedContexts) {
      result.reason = "Konteks model berbeda; pilih satu sumber dan interval sebelum menampilkan heatmap.";
      return result;
    }
    result.samples = [...bins.values()].map((b) => ({latitude: Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, b.latitude)),
      longitude: Math.max(-180, Math.min(180, b.longitude)), value: b.total / b.count, count: b.count}));
    result.binCount = result.samples.length;
    if (!result.binCount) result.reason = "Belum ada pengamatan berlokasi dengan kategori ML dan akurasi lokasi yang sesuai.";
    return result;
  }
  function bounds(sample, width, height, scaleX, scaleY, radius) {
    // Raster-cell centers are sampled in CSS pixels; support is zero at/beyond radius.
    return {x0: Math.max(0, Math.ceil((sample.x - radius) / scaleX - 0.5)),
      x1: Math.min(width - 1, Math.floor((sample.x + radius) / scaleX - 0.5)),
      y0: Math.max(0, Math.ceil((sample.y - radius) / scaleY - 0.5)),
      y1: Math.min(height - 1, Math.floor((sample.y + radius) / scaleY - 0.5))};
  }
  /*
   * Project geographic bins with Leaflet latLngToContainerPoint, then call buildRaster.
   * radiusPx = 35 / groundMetersPerCssPixel. Never clamp the geographic radius by zoom.
   * Draw returned ImageData on a scratch canvas of width/height, then scale that canvas
   * to viewportWidth/viewportHeight. No network, plugin, API key, or paid service is used.
   * Values are normalized kernel means; alpha uses the strongest kernel, not count.
   */
  function buildRaster(samples, viewportWidth, viewportHeight, options = {}) {
    if (!Array.isArray(samples) || samples.length > MAX_ROWS || !finite(viewportWidth, 1, 16384) || !finite(viewportHeight, 1, 16384))
      throw new Error("Ukuran/koordinat kanvas heatmap tidak valid.");
    const radiusPx = options.radiusPx, requestedStep = options.pixelStep ?? 4;
    const maxCells = options.maxCells ?? 500000, maxOperations = options.maxOperations ?? 6000000;
    if (!finite(radiusPx, 0.01, 1e7) || !finite(requestedStep, 1, 128) || !finite(maxCells, 1, 1000000) || !finite(maxOperations, MAX_ROWS, 20000000))
      throw new Error("Opsi raster heatmap tidak valid.");
    const locations = new Map();
    for (const p of samples) {
      if (!p || !finite(p.x) || !finite(p.y) || !finite(p.value, 0, 1) ||
          p.x + radiusPx <= 0 || p.y + radiusPx <= 0 || p.x - radiusPx >= viewportWidth || p.y - radiusPx >= viewportHeight) continue;
      const key = `${p.x}:${p.y}`, location = locations.get(key);
      if (location) { location.total += p.value; location.count++; }
      else locations.set(key, {x: p.x, y: p.y, total: p.value, count: 1});
    }
    const points = [...locations.values()].map((p) => ({x: p.x, y: p.y, value: p.total / p.count}));
    let step = Math.max(requestedStep, Math.sqrt(viewportWidth * viewportHeight / maxCells)), width, height, scaleX, scaleY, estimate;
    // Bound both memory and kernel work. Increasing raster step never changes the support radius.
    for (;;) {
      width = Math.max(1, Math.ceil(viewportWidth / step)); height = Math.max(1, Math.ceil(viewportHeight / step));
      scaleX = viewportWidth / width; scaleY = viewportHeight / height;
      estimate = 0;
      for (const p of points) {
        const b = bounds(p, width, height, scaleX, scaleY, radiusPx);
        estimate += Math.max(0, b.x1 - b.x0 + 1) * Math.max(0, b.y1 - b.y0 + 1);
      }
      if (width * height <= maxCells && estimate <= maxOperations) break;
      step *= Math.max(1.05, Math.sqrt(Math.max(width * height / maxCells, estimate / maxOperations)) * 1.02);
    }
    const size = width * height, sums = new Float64Array(size), weights = new Float64Array(size), strongest = new Float32Array(size);
    const data = new Uint8ClampedArray(size * 4), scores = new Float32Array(size); scores.fill(NaN);
    const radiusSquared = radiusPx * radiusPx;
    let operations = 0;
    for (const p of points) {
      const b = bounds(p, width, height, scaleX, scaleY, radiusPx);
      for (let y = b.y0; y <= b.y1; y++) {
        const dy = (y + 0.5) * scaleY - p.y;
        for (let x = b.x0; x <= b.x1; x++) {
          operations++;
          const dx = (x + 0.5) * scaleX - p.x, distance = (dx * dx + dy * dy) / radiusSquared;
          if (distance >= 1) continue;
          const kernel = (1 - distance) ** 2, i = y * width + x;
          sums[i] += kernel * p.value; weights[i] += kernel; strongest[i] = Math.max(strongest[i], kernel);
        }
      }
    }
    let coveredCells = 0;
    for (let i = 0; i < size; i++) {
      if (!weights[i]) continue;
      const value = Math.max(0, Math.min(1, sums[i] / weights[i])), rgb = colorAt(value);
      scores[i] = value; data.set(rgb, i * 4);
      data[i * 4 + 3] = Math.round(220 * Math.sqrt(strongest[i]));
      if (data[i * 4 + 3]) coveredCells++;
    }
    return {data, scores, width, height, scaleX, scaleY, viewportWidth, viewportHeight, radiusPx,
      pixelStep: Math.max(scaleX, scaleY), sampleCount: points.length, coveredCells, operations};
  }
  return {RADIUS_METERS, BIN_METERS, MAX_ROWS, QUALITY_VALUES, colorAt, hexAt, prepareSamples, buildRaster};
});
