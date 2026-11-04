/* Learned relative connection profiles. Fixed transforms allow fair model comparisons. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SigHeatClusters = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const K = 3, MIN_ROWS = 60, MAX_ROWS = 50000, MAX_ITERATIONS = 80;
  const DENOMINATOR = Math.log1p(60000), MIN_SEPARATION_SQUARED = 0.015 ** 2;
  const FEATURES = ["log_rtt", "log_jitter", "failure_fraction"];
  const LABELS = ["Beban relatif rendah", "Beban relatif sedang", "Beban relatif tinggi"];
  const QUALITIES = ["good", "fair", "poor"];
  const finite = (n, lo, hi) => typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi;
  function parseContext(value) {
    if (typeof value !== "string" || value.length > 2048) return null;
    try {
      const context = JSON.parse(value);
      if (!Array.isArray(context) || context.length !== 4 || JSON.stringify(context) !== value ||
          typeof context[0] !== "string" || (context[0] !== "" && !/^[A-Za-z0-9_-]{1,48}$/.test(context[0])) ||
          !["browser", "termux", "demo"].includes(context[1]) || typeof context[2] !== "string" ||
          !finite(context[3], 2, 60)) return null;
      const url = new URL(context[2]);
      if (url.protocol !== "wss:" || !url.hostname || url.username || url.password || url.search || url.hash || url.href !== context[2]) return null;
      return context;
    } catch (_) { return null; }
  }
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const squared = (a, b) => a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0);
  const severity = (center) => center.reduce((a, b) => a + b, 0);
  function transform(row) {
    if (!row || typeof row !== "object" || Array.isArray(row) || row.probe_ok !== true ||
        !finite(row.latency_ms, 0, 60000) || !finite(row.latency_std_ms, 0, 60000) ||
        !finite(row.success_pct, 0, 100) || row.success_pct === 0) return null;
    return [Math.log1p(row.latency_ms) / DENOMINATOR,
      Math.log1p(row.latency_std_ms) / DENOMINATOR, (100 - row.success_pct) / 100];
  }
  function nearest(centers, vector) {
    let index = 0, distance = squared(centers[0], vector);
    for (let i = 1; i < centers.length; i++) {
      const d = squared(centers[i], vector);
      if (d < distance) { index = i; distance = d; }
    }
    return { index, distance };
  }
  function fingerprint(model) {
    const values = [model.centroids, model.counts, model.provenance, model.trained_rows];
    if (model.context_key !== undefined) values.push(model.context_key);
    const text = JSON.stringify(values);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
    return "kmeans-" + hash.toString(16).padStart(8, "0");
  }
  function validateModel(model) {
    if (!model || typeof model !== "object" || Array.isArray(model) || model.format !== "sigheat-kmeans-v1" ||
        model.schema_version !== 1 || model.k !== K || model.algorithm !== "kmeans" ||
        model.transform !== "log1p_ms_div_log60001_and_failure_fraction" ||
        JSON.stringify(model.features) !== JSON.stringify(FEATURES) ||
        !["synthetic", "measured"].includes(model.provenance) ||
        !Number.isSafeInteger(model.trained_rows) || model.trained_rows < MIN_ROWS || model.trained_rows > MAX_ROWS ||
        !Number.isSafeInteger(model.ignored_rows) || model.ignored_rows < 0 || model.ignored_rows > MAX_ROWS ||
        !finite(model.inertia, 0, MAX_ROWS * 3) ||
        !Array.isArray(model.centroids) || model.centroids.length !== K ||
        !model.centroids.every((c) => Array.isArray(c) && c.length === FEATURES.length && c.every((v) => finite(v, 0, 1))) ||
        !Array.isArray(model.counts) || model.counts.length !== K ||
        !model.counts.every((n) => Number.isSafeInteger(n) && n >= Math.max(5, Math.floor(model.trained_rows * 0.05))) ||
        model.counts.reduce((a, b) => a + b, 0) !== model.trained_rows) return false;
    if (model.context_key !== undefined) {
      const context = parseContext(model.context_key);
      if (!context || (context[1] === "demo") !== (model.provenance === "synthetic")) return false;
    }
    for (let i = 0; i < K; i++) {
      if (i && severity(model.centroids[i]) < severity(model.centroids[i - 1])) return false;
      for (let j = i + 1; j < K; j++) if (squared(model.centroids[i], model.centroids[j]) < MIN_SEPARATION_SQUARED) return false;
    }
    return typeof model.model_id === "string" && model.model_id === fingerprint(model);
  }
  function lloyd(vectors, first) {
    const centers = [vectors[first].slice()];
    while (centers.length < K) {
      let chosen = 0, farthest = -1;
      vectors.forEach((v, i) => {
        const d = nearest(centers, v).distance;
        if (d > farthest) { chosen = i; farthest = d; }
      });
      if (farthest < MIN_SEPARATION_SQUARED) return null;
      centers.push(vectors[chosen].slice());
    }
    let counts;
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      const sums = Array.from({ length: K }, () => [0, 0, 0]);
      counts = Array(K).fill(0);
      for (const v of vectors) {
        const { index } = nearest(centers, v); counts[index]++;
        v.forEach((value, j) => { sums[index][j] += value; });
      }
      if (counts.some((n) => !n)) return null;
      let shift = 0;
      for (let i = 0; i < K; i++) {
        const next = sums[i].map((v) => v / counts[i]);
        shift += squared(centers[i], next); centers[i] = next;
      }
      if (shift < 1e-14) break;
    }
    counts = Array(K).fill(0); let inertia = 0;
    for (const v of vectors) { const match = nearest(centers, v); counts[match.index]++; inertia += match.distance; }
    if (counts.some((n) => n < Math.max(5, Math.floor(vectors.length * 0.05)))) return null;
    for (let i = 0; i < K; i++) for (let j = i + 1; j < K; j++)
      if (squared(centers[i], centers[j]) < MIN_SEPARATION_SQUARED) return null;
    const order = centers.map((c, i) => ({ c, count: counts[i], old: i })).sort((a, b) => severity(a.c) - severity(b.c) || a.old - b.old);
    return { centroids: order.map((o) => o.c), counts: order.map((o) => o.count), inertia };
  }
  function train(rows, options = {}) {
    if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error("Opsi konteks klaster tidak valid.");
    const context = options.contextKey === undefined ? null : parseContext(options.contextKey);
    if (options.contextKey !== undefined && !context) throw new Error("Konteks klaster tidak valid atau tidak kanonis.");
    if (!Array.isArray(rows) || rows.length < MIN_ROWS || rows.length > MAX_ROWS)
      throw new Error(`K-Means memerlukan ${MIN_ROWS}–${MAX_ROWS} baris telemetri.`);
    let provenance = null;
    const vectors = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || typeof row !== "object" || Array.isArray(row) || !["browser", "termux", "demo"].includes(row.source))
        throw new Error(`Baris klaster ${i + 1}: sumber tidak valid.`);
      if (context && row.source !== context[1]) throw new Error(`Baris klaster ${i + 1}: sumber berbeda dari konteks model.`);
      const kind = row.source === "demo" ? "synthetic" : "measured";
      if (row.mode != null && row.mode !== (kind === "synthetic" ? "contoh-lokal" : "pengukuran-perangkat"))
        throw new Error(`Baris klaster ${i + 1}: mode dan sumber berbeda.`);
      if (provenance && kind !== provenance) throw new Error("Data sintetis dan pengukuran tidak boleh dicampur saat melatih klaster.");
      provenance = kind;
      if (typeof row.probe_ok !== "boolean" ||
          (row.latency_ms != null && !finite(row.latency_ms, 0, 60000)) ||
          (row.latency_std_ms != null && !finite(row.latency_std_ms, 0, 60000)) ||
          !finite(row.success_pct, 0, 100) || row.probe_ok !== (row.latency_ms != null) ||
          (row.probe_ok && row.success_pct === 0))
        throw new Error(`Baris klaster ${i + 1}: nilai RTT, jitter, atau keberhasilan tidak valid.`);
      const v = transform(row); if (v) vectors.push(v);
    }
    if (vectors.length < MIN_ROWS) throw new Error(`Klaster memerlukan ${MIN_ROWS} probe lengkap; tersedia ${vectors.length}. Timeout dan jitter hilang tidak diisi nol.`);
    const distinct = new Set(vectors.map((v) => JSON.stringify(v)));
    if (distinct.size < K) throw new Error("Data belum cukup bervariasi untuk tiga klaster.");
    let best = null;
    for (const fraction of [0, 0.13, 0.31, 0.5, 0.71, 0.89]) {
      const result = lloyd(vectors, Math.min(vectors.length - 1, Math.floor(vectors.length * fraction)));
      if (result && (!best || result.inertia < best.inertia)) best = result;
    }
    if (!best) throw new Error("Tiga klaster belum terpisah dan terisi cukup. Model sebelumnya dipertahankan.");
    const model = { format: "sigheat-kmeans-v1", schema_version: 1, algorithm: "kmeans", k: K,
      transform: "log1p_ms_div_log60001_and_failure_fraction", features: FEATURES.slice(),
      ...best, trained_rows: vectors.length, ignored_rows: rows.length - vectors.length, provenance,
      label_rule: "Urutkan pusat klaster menurut jumlah tiga fitur: beban relatif rendah/sedang/tinggi. Ini penamaan arah, bukan batas ms atau label kebenaran." };
    if (context) model.context_key = options.contextKey;
    model.model_id = fingerprint(model);
    if (!validateModel(model)) throw new Error("Model klaster hasil pelatihan tidak valid.");
    return model;
  }
  function classify(model, row) {
    const empty = { quality: "unknown", label: "Belum terklasifikasi", cluster_index: null,
      model_id: validateModel(model) ? model.model_id : null,
      provenance: validateModel(model) ? model.provenance : null };
    if (!validateModel(model)) return { ...empty, reason: "Model klaster tidak valid." };
    if (row?.probe_ok === false) return { ...empty, label: "Probe timeout", reason: "RTT probe gagal tidak diketahui; tidak diklasifikasikan sebagai nol." };
    const v = transform(row);
    if (!v) return { ...empty, reason: "RTT, jitter, dan keberhasilan probe belum lengkap." };
    const { index } = nearest(model.centroids, v);
    return { quality: QUALITIES[index], label: LABELS[index], cluster_index: index,
      model_id: model.model_id, provenance: model.provenance,
      reason: model.provenance === "synthetic" ? "Pusat klaster bawaan dari data sintetis; belum tervalidasi pada jaringan ini." : "Profil relatif terhadap pusat klaster yang dipelajari dari pengukuran." };
  }
  function distance(model, row) {
    if (!validateModel(model)) return null;
    const v = transform(row); return v ? nearest(model.centroids, v).distance : null;
  }
  function score(model, rows) {
    if (!validateModel(model) || !Array.isArray(rows) || rows.length > MAX_ROWS)
      return { n: 0, mean_squared_distance: null };
    let n = 0, total = 0;
    for (const row of rows) { const d = distance(model, row); if (d !== null) { n++; total += d; } }
    return { n, mean_squared_distance: n ? total / n : null };
  }
  function generateDemoRows(count = 480, seed = 240601) {
    if (!Number.isInteger(count) || count < 1 || count > MAX_ROWS || !Number.isSafeInteger(seed)) throw new Error("Jumlah atau seed data klaster tidak valid.");
    let state = seed >>> 0;
    const random = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
    const rows = [], profiles = [[55, 4, 99], [230, 35, 94], [950, 220, 72]];
    for (let i = 0; i < count; i++) {
      const profile = profiles[Math.floor(i / 40) % profiles.length], noise = random() - 0.5;
      const rtt = Math.max(0, profile[0] * (1 + 0.22 * Math.sin(i / 11) + 0.12 * noise));
      const jitter = Math.max(0, profile[1] * (1 + 0.3 * Math.cos(i / 7) + 0.1 * noise));
      rows.push({ schema_version: 2, mode: "contoh-lokal", project_id: "demo-clusters", source: "demo",
        device_id: "hp-demo", boot_id: "clusters-seed-" + (seed >>> 0), sequence: i + 1,
        sent_at_ms: Date.UTC(2026, 0, 1) + i * 5000, interval_s: 5, latency_type: "mqtt_app_rtt",
        broker_endpoint: "wss://example.invalid/mqtt", probe_ok: true, probe_count: 10,
        latency_ms: Number(rtt.toFixed(3)), latency_mean_ms: Number(rtt.toFixed(3)), latency_std_ms: Number(jitter.toFixed(3)),
        success_pct: Number(Math.min(100, Math.max(1, profile[2] + 2 * noise)).toFixed(3)),
        accel_rms: 0.2, accel_available: true, accel_mode: "linear", gyro_rms_rad_s: 0.08, gyro_available: true,
        rotation_total_rad: 0.1, accel_samples: 50, gyro_samples: 50, sensor_window_ms: 5000, gyro_covered_ms: 5000,
        latitude: null, longitude: null, accuracy_m: null, location_at_ms: null, sensor_errors: [] });
    }
    return rows;
  }
  // BEGIN GENERATED DEFAULT: regenerate with node scripts/build-cluster-default.cjs.
  const DEFAULT_MODEL = {"format":"sigheat-kmeans-v1","schema_version":1,"algorithm":"kmeans","k":3,"transform":"log1p_ms_div_log60001_and_failure_fraction","features":["log_rtt","log_jitter","failure_fraction"],"centroids":[[0.36521535823157497,0.14481459221916615,0.009806187500000004],[0.49309396609603373,0.3232193522899291,0.06064462499999997],[0.6223778315974544,0.48871621571085394,0.27909912499999995]],"counts":[160,160,160],"inertia":0.2814171546004103,"trained_rows":480,"ignored_rows":0,"provenance":"synthetic","label_rule":"Urutkan pusat klaster menurut jumlah tiga fitur: beban relatif rendah/sedang/tinggi. Ini penamaan arah, bukan batas ms atau label kebenaran.","model_id":"kmeans-686e686b"};
  // END GENERATED DEFAULT
  function defaultModel() { return DEFAULT_MODEL ? clone(DEFAULT_MODEL) : null; }
  return { K, MIN_ROWS, MAX_ROWS, FEATURES: FEATURES.slice(), LABELS: LABELS.slice(), train, classify,
    validateModel, defaultModel, generateDemoRows, distance, score };
});
