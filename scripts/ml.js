/* SigHeat one-step MQTT RTT forecasting. No network access or external ML runtime. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SigHeatML = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const WINDOW = 6, MIN_ROWS = 120, MAX_ROWS = 50000;
  const ALPHAS = [0.1, 1, 10, 100];
  const FEATURES = ["rtt_lag_0", "rtt_lag_1", "rtt_lag_2", "rtt_lag_3", "rtt_lag_4", "rtt_lag_5",
    "rtt_mean_6", "rtt_std_6", "rtt_slope_6", "success_pct", "latency_std_ms",
    "accel_rms", "gyro_rms_rad_s", "accel_missing", "gyro_missing", "jitter_missing"];
  const finite = (n, min = -Infinity, max = Infinity) => typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
  const optional = (n, min, max) => n == null || finite(n, min, max);
  const id = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,48}$/.test(v);
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const std = (xs, m = mean(xs)) => Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
  const clip = (n) => Math.max(0, Math.min(60000, n));
  function endpoint(value) {
    try {
      const url = new URL(value);
      return url.protocol === "wss:" && url.hostname && !url.username && !url.password && !url.search && !url.hash ? url.href : null;
    } catch (_) { return null; }
  }
  function groupKey(row) {
    return JSON.stringify([row.project_id || "", row.device_id, row.boot_id, row.source,
      endpoint(row.broker_endpoint), row.interval_s, row.accel_mode]);
  }
  function prepareRows(input) {
    if (!Array.isArray(input) || !input.length || input.length > MAX_ROWS)
      throw new Error(`Dataset harus berisi 1–${MAX_ROWS} baris.`);
    const rows = input.map((r, i) => {
      const bad = (field) => { throw new Error(`Baris ${i + 1}: ${field} tidak valid.`); };
      if (!r || typeof r !== "object" || Array.isArray(r)) bad("objek telemetri");
      for (const field of ["device_id", "boot_id"]) if (!id(r[field])) bad(field);
      if (r.project_id != null && r.project_id !== "" && !id(r.project_id)) bad("project_id");
      if (!["browser", "termux", "demo"].includes(r.source)) bad("source");
      if (r.latency_type != null && r.latency_type !== "mqtt_app_rtt") bad("latency_type");
      if (r.schema_version != null && r.schema_version !== 2) bad("schema_version");
      if (r.mode != null && r.mode !== (r.source === "demo" ? "contoh-lokal" : "pengukuran-perangkat")) bad("mode/source");
      if (!endpoint(r.broker_endpoint)) bad("broker_endpoint");
      if (!Number.isSafeInteger(r.sequence) || r.sequence < 1) bad("sequence");
      if (!finite(r.sent_at_ms, 1, Number.MAX_SAFE_INTEGER)) bad("sent_at_ms");
      if (!finite(r.interval_s, 2, 60)) bad("interval_s");
      if (typeof r.probe_ok !== "boolean" || r.probe_ok !== (r.latency_ms != null)) bad("probe_ok/latency_ms");
      if (!optional(r.latency_ms, 0, 60000)) bad("latency_ms");
      if (!finite(r.success_pct, 0, 100) || (r.probe_ok && r.success_pct === 0)) bad("success_pct");
      if (!optional(r.latency_std_ms, 0, 60000)) bad("latency_std_ms");
      if (!optional(r.accel_rms, 0, 1000)) bad("accel_rms");
      if (!optional(r.gyro_rms_rad_s, 0, 1000)) bad("gyro_rms_rad_s");
      if (!["linear", "gravity_removed", "unavailable"].includes(r.accel_mode)) bad("accel_mode");
      if ((r.accel_mode === "unavailable") !== (r.accel_rms == null)) bad("accel_mode/accel_rms");
      for (const [flag, field] of [["accel_available", "accel_rms"], ["gyro_available", "gyro_rms_rad_s"]])
        if (r[flag] != null && (typeof r[flag] !== "boolean" || r[flag] !== (r[field] != null))) bad(flag);
      return { ...r, project_id: r.project_id || "", broker_endpoint: endpoint(r.broker_endpoint),
        latency_std_ms: r.latency_std_ms ?? null, accel_rms: r.accel_rms ?? null, gyro_rms_rad_s: r.gyro_rms_rad_s ?? null };
    });
    const key = groupKey(rows[0]);
    for (let i = 0; i < rows.length; i++) {
      if (groupKey(rows[i]) !== key) throw new Error("Dataset mencampur proyek, perangkat, sesi boot, sumber, broker, interval, atau mode sensor. Pilih satu aliran.");
      if (i && (rows[i].sent_at_ms <= rows[i - 1].sent_at_ms || rows[i].sequence <= rows[i - 1].sequence))
        throw new Error("Urutan waktu/sequence harus naik; duplikat dan urutan mundur ditolak.");
    }
    return rows;
  }
  function adjacent(a, b) {
    const dt = b.sent_at_ms - a.sent_at_ms;
    return a.boot_id === b.boot_id && b.sequence === a.sequence + 1 && dt >= a.interval_s * 500 && dt <= a.interval_s * 2500;
  }
  function validWindow(rows) {
    return rows.every((r, i) => r.probe_ok && finite(r.latency_ms, 0, 60000) && (!i || adjacent(rows[i - 1], r)));
  }
  function features(window) {
    const rtts = window.map((r) => r.latency_ms), current = window[window.length - 1], m = mean(rtts);
    return [...rtts.slice().reverse(), m, std(rtts, m), (rtts[WINDOW - 1] - rtts[0]) / (WINDOW - 1),
      current.success_pct, current.latency_std_ms ?? 0, current.accel_rms ?? 0, current.gyro_rms_rad_s ?? 0,
      current.accel_rms == null ? 1 : 0, current.gyro_rms_rad_s == null ? 1 : 0, current.latency_std_ms == null ? 1 : 0];
  }
  function examples(rows) {
    const out = [];
    for (let i = WINDOW; i < rows.length; i++) {
      const window = rows.slice(i - WINDOW, i), target = rows[i];
      if (!validWindow([...window, target])) continue;
      out.push({ x: features(window), y: target.latency_ms,
        persistence: window[WINDOW - 1].latency_ms, moving_average: mean(window.map((r) => r.latency_ms)),
        input_start_ms: window[0].sent_at_ms, input_end_ms: window[WINDOW - 1].sent_at_ms,
        target_ms: target.sent_at_ms, target_sequence: target.sequence });
    }
    return out;
  }
  function solve(matrix, rhs) {
    const a = matrix.map((row, i) => [...row, rhs[i]]), n = rhs.length;
    for (let k = 0; k < n; k++) {
      let pivot = k;
      for (let j = k + 1; j < n; j++) if (Math.abs(a[j][k]) > Math.abs(a[pivot][k])) pivot = j;
      [a[k], a[pivot]] = [a[pivot], a[k]];
      if (Math.abs(a[k][k]) < 1e-12) throw new Error("Sistem regresi tidak stabil; kumpulkan data lebih bervariasi.");
      for (let j = k + 1; j < n; j++) {
        const factor = a[j][k] / a[k][k];
        for (let c = k; c <= n; c++) a[j][c] -= factor * a[k][c];
      }
    }
    const x = Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      let sum = a[i][n];
      for (let j = i + 1; j < n; j++) sum -= a[i][j] * x[j];
      x[i] = sum / a[i][i];
    }
    if (!x.every((v) => finite(v))) throw new Error("Koefisien model tidak valid.");
    return x;
  }
  function fit(data, alpha) {
    const p = FEATURES.length, centers = [], scales = [];
    for (let j = 0; j < p; j++) {
      const column = data.map((d) => d.x[j]);
      centers.push(mean(column));
      const scale = std(column, centers[j]);
      scales.push(scale < 1e-9 ? 1 : scale);
    }
    const intercept = mean(data.map((d) => d.y));
    const matrix = Array.from({ length: p }, () => Array(p).fill(0)), rhs = Array(p).fill(0);
    for (const row of data) {
      const z = row.x.map((v, j) => (v - centers[j]) / scales[j]);
      for (let j = 0; j < p; j++) {
        rhs[j] += z[j] * (row.y - intercept);
        for (let k = 0; k < p; k++) matrix[j][k] += z[j] * z[k];
      }
    }
    for (let j = 0; j < p; j++) matrix[j][j] += alpha;
    return { centers, scales, coefficients: solve(matrix, rhs), intercept, alpha };
  }
  function predict(fitted, x) {
    return clip(fitted.intercept + fitted.coefficients.reduce((sum, w, j) => sum + w * (x[j] - fitted.centers[j]) / fitted.scales[j], 0));
  }
  function metric(actual, predicted) {
    const errors = actual.map((y, i) => predicted[i] - y);
    return { n: errors.length, mae_ms: mean(errors.map(Math.abs)), rmse_ms: Math.sqrt(mean(errors.map((e) => e * e))) };
  }
  function evaluate(fitted, data) {
    const ys = data.map((d) => d.y);
    return { ridge: metric(ys, data.map((d) => predict(fitted, d.x))),
      persistence: metric(ys, data.map((d) => d.persistence)), moving_average: metric(ys, data.map((d) => d.moving_average)) };
  }
  function range(rows, data) {
    return { raw_start_ms: rows[0].sent_at_ms, raw_end_ms: rows[rows.length - 1].sent_at_ms,
      first_input_ms: data[0].input_start_ms, first_target_ms: data[0].target_ms,
      last_input_ms: data[data.length - 1].input_end_ms, last_target_ms: data[data.length - 1].target_ms };
  }
  function train(input) {
    const rows = prepareRows(input);
    if (rows.length < MIN_ROWS) throw new Error(`Perlu minimal ${MIN_ROWS} telemetri dalam satu aliran; tersedia ${rows.length}.`);
    const a = Math.floor(rows.length * 0.6), b = Math.floor(rows.length * 0.8);
    const raw = { train: rows.slice(0, a), validation: rows.slice(a, b), test: rows.slice(b) };
    const parts = Object.fromEntries(Object.entries(raw).map(([key, rs]) => [key, examples(rs)]));
    for (const [key, data] of Object.entries(parts))
      if (data.length < (key === "train" ? 24 : 8)) throw new Error(`Contoh valid bagian ${key} terlalu sedikit (${data.length}). Rekam lebih banyak probe berurutan tanpa timeout atau jeda.`);
    const candidates = ALPHAS.map((alpha) => {
      const fitted = fit(parts.train, alpha);
      return { fitted, validation: evaluate(fitted, parts.validation) };
    });
    candidates.sort((a, b) => a.validation.ridge.mae_ms - b.validation.ridge.mae_ms || a.fitted.alpha - b.fitted.alpha);
    const chosen = candidates[0], val = chosen.validation;
    const bestBaseline = val.persistence.mae_ms <= val.moving_average.mae_ms ? "persistence" : "moving_average";
    const selected = val.ridge.mae_ms < val[bestBaseline].mae_ms && val.ridge.mae_ms <= 0.95 * val[bestBaseline].mae_ms ? "ridge" : bestBaseline;
    const report = { schema_version: 1, algorithm: "standardized_ridge_autoregression", target: "next_successful_immediate_mqtt_app_rtt_ms",
      horizon_s: rows[0].interval_s, group_key: groupKey(rows[0]), provenance: rows[0].source === "demo" ? "synthetic" : "measured",
      rows: { total: rows.length, train: raw.train.length, validation: raw.validation.length, test: raw.test.length },
      examples: Object.fromEntries(Object.entries(parts).map(([key, data]) => [key, data.length])),
      excluded_windows: Object.fromEntries(Object.entries(parts).map(([key, data]) => [key, Math.max(0, raw[key].length - WINDOW) - data.length])),
      split_boundaries: Object.fromEntries(Object.entries(parts).map(([key, data]) => [key, range(raw[key], data)])),
      features: FEATURES.slice(), alpha: chosen.fitted.alpha,
      alpha_validation_mae: candidates.map((c) => ({ alpha: c.fitted.alpha, mae_ms: c.validation.ridge.mae_ms })),
      validation: val, test: evaluate(chosen.fitted, parts.test), selected_predictor: selected,
      selection_rule: "Gunakan ridge hanya jika MAE validasi minimal 5% lebih rendah daripada kedua baseline; test tidak memilih model.",
      note: "Target adalah telemetri berikutnya yang langsung berurutan dan berhasil, bukan janji waktu tepat atau prediksi timeout. Model tetap dilatih pada 60% awal; 20% akhir hanya untuk evaluasi. Data sintetis tidak membuktikan kinerja jaringan nyata." };
    const model = { format: "sigheat-ridge-v1", schema_version: 1, window: WINDOW, features: FEATURES.slice(),
      ...chosen.fitted, group_key: report.group_key, horizon_s: report.horizon_s, provenance: report.provenance,
      selected_predictor: selected, trained_through_ms: raw.train[raw.train.length - 1].sent_at_ms,
      evaluated_through_ms: rows[rows.length - 1].sent_at_ms,
      validation: report.validation, test: report.test, report };
    if (!validateModel(model)) throw new Error("Model hasil pelatihan tidak lolos pemeriksaan numerik.");
    return { model, report };
  }
  function validateMetric(m) {
    return m && Number.isSafeInteger(m.n) && m.n >= 1 && m.n <= MAX_ROWS && finite(m.mae_ms, 0, 60000) && finite(m.rmse_ms, 0, 60000);
  }
  function validateModel(m) {
    if (!m || typeof m !== "object" || Array.isArray(m) || m.format !== "sigheat-ridge-v1" || m.schema_version !== 1 || m.window !== WINDOW) return false;
    if (!Array.isArray(m.features) || JSON.stringify(m.features) !== JSON.stringify(FEATURES)) return false;
    for (const key of ["centers", "scales", "coefficients"])
      if (!Array.isArray(m[key]) || m[key].length !== FEATURES.length || !m[key].every((v) => finite(v, key === "scales" ? 1e-12 : -1e12, 1e12))) return false;
    if (!finite(m.intercept, 0, 60000) || !ALPHAS.includes(m.alpha) || !finite(m.horizon_s, 2, 60)) return false;
    if (!["ridge", "persistence", "moving_average"].includes(m.selected_predictor) || !["synthetic", "measured"].includes(m.provenance)) return false;
    if (!finite(m.trained_through_ms, 1, Number.MAX_SAFE_INTEGER) || !finite(m.evaluated_through_ms, m.trained_through_ms, Number.MAX_SAFE_INTEGER)) return false;
    if (typeof m.group_key !== "string" || m.group_key.length > 2048) return false;
    let group;
    try { group = JSON.parse(m.group_key); } catch (_) { return false; }
    if (!Array.isArray(group) || group.length !== 7 || !(group[0] === "" || id(group[0])) || !id(group[1]) || !id(group[2]) || !["browser", "termux", "demo"].includes(group[3]) || !endpoint(group[4]) || group[5] !== m.horizon_s || !["linear", "gravity_removed", "unavailable"].includes(group[6]) || (group[3] === "demo") !== (m.provenance === "synthetic")) return false;
    for (const split of ["validation", "test"]) for (const method of ["ridge", "persistence", "moving_average"])
      if (!validateMetric(m[split]?.[method])) return false;
    return true;
  }
  function forecast(model, input) {
    if (!validateModel(model)) return { status: "invalid_model", reason: "Model tidak valid atau format tidak didukung." };
    let rows;
    try { rows = prepareRows(input); } catch (error) { return { status: "invalid_data", reason: error.message }; }
    if (groupKey(rows[rows.length - 1]) !== model.group_key) return { status: "incompatible", reason: "Model berasal dari aliran berbeda. Latih ulang untuk perangkat, sesi, broker, interval, dan mode sensor ini." };
    if (rows.length < WINDOW) return { status: "warming_up", reason: `Perlu ${WINDOW} telemetri terakhir yang berurutan.` };
    const window = rows.slice(-WINDOW);
    if (!validWindow(window)) return { status: "unavailable", reason: "Riwayat terbaru berisi timeout, sampel hilang, atau interval tidak teratur. Tunggu enam probe berurutan." };
    const last = window[WINDOW - 1], values = window.map((r) => r.latency_ms);
    const estimates = { ridge: predict(model, features(window)), persistence: last.latency_ms, moving_average: mean(values) };
    if (!finite(estimates.ridge, 0, 60000)) return { status: "invalid_model", reason: "Hasil perhitungan model tidak terbatas." };
    return { status: "ready", prediction_ms: estimates[model.selected_predictor], ml_prediction_ms: estimates.ridge,
      persistence_ms: estimates.persistence, moving_average_ms: estimates.moving_average,
      method: model.selected_predictor, horizon_s: model.horizon_s, based_on_ms: last.sent_at_ms,
      forecast_for_ms: last.sent_at_ms + model.horizon_s * 1000,
      warning: model.provenance === "synthetic" ? "SIMULASI: hasil dari data sintetis, bukan bukti akurasi lapangan."
        : model.selected_predictor !== "ridge" ? "Baseline dipakai karena ML belum memberi peningkatan MAE validasi minimal 5%." : "Estimasi RTT berikutnya; bukan pengukuran, kepastian, atau prediksi putus jaringan." };
  }
  function generateDemoRows(count = 480, seed = 240601) {
    if (!Number.isInteger(count) || count < 1 || count > MAX_ROWS || !Number.isSafeInteger(seed)) throw new Error("Jumlah/seed demo tidak valid.");
    let state = seed >>> 0;
    const random = () => { state = (1664525 * state + 1013904223) >>> 0; return state / 4294967296; };
    const rows = [], start = Date.UTC(2026, 0, 1);
    let last = 150, previous = 148;
    for (let i = 0; i < count; i++) {
      const accel = 0.2 + 0.12 * Math.sin(i / 13), gyro = 0.08 + 0.025 * Math.cos(i / 17);
      // A deliberately learnable synthetic process, not a physical Wi-Fi model.
      const rtt = clip(25 + 1.45 * last - 0.62 * previous + 16 * Math.sin(i / 19) + 12 * accel + (random() - 0.5) * 8);
      previous = last; last = rtt;
      const recent = [...rows.slice(-9).map((r) => r.latency_ms), rtt], avg = mean(recent);
      rows.push({ schema_version: 2, mode: "contoh-lokal", project_id: "demo-ml", device_id: "hp-demo", boot_id: "demo-seeded-" + (seed >>> 0),
        sequence: i + 1, source: "demo", latency_type: "mqtt_app_rtt", broker_endpoint: "wss://example.invalid/mqtt",
        sent_at_ms: start + i * 5000, interval_s: 5, latency_ms: Number(rtt.toFixed(3)),
        latency_mean_ms: Number(avg.toFixed(3)), latency_std_ms: Number(std(recent, avg).toFixed(3)),
        success_pct: 100, probe_ok: true, probe_count: Math.min(10, i + 1),
        accel_rms: Number(accel.toFixed(5)), accel_available: true, accel_mode: "linear",
        gyro_rms_rad_s: Number(gyro.toFixed(5)), gyro_available: true, rotation_total_rad: 0.1,
        accel_samples: 50, gyro_samples: 50, sensor_window_ms: 5000, gyro_covered_ms: 5000,
        latitude: null, longitude: null, accuracy_m: null, location_at_ms: null, sensor_errors: [] });
    }
    return rows;
  }
  // A persisted context intentionally excludes boot_id. Every feature window still
  // checks boot identity, consecutive sequence, and elapsed time through adjacent().
  function contextKey(row) {
    return JSON.stringify([row.project_id || "", row.device_id, row.source,
      endpoint(row.broker_endpoint), row.interval_s, row.accel_mode]);
  }
  function prepareContextRows(input) {
    if (!Array.isArray(input) || !input.length || input.length > MAX_ROWS)
      throw new Error(`Dataset konteks harus berisi 1–${MAX_ROWS} baris.`);
    const rows = input.map((row) => prepareRows([row])[0]);
    const key = contextKey(rows[0]), sequences = new Map();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (contextKey(row) !== key) throw new Error("Dataset mencampur konteks perangkat, sumber, broker, interval, atau mode sensor.");
      if (i && row.sent_at_ms <= rows[i - 1].sent_at_ms) throw new Error("Waktu harus meningkat; data mundur atau duplikat ditolak.");
      if (sequences.has(row.boot_id) && row.sequence <= sequences.get(row.boot_id)) throw new Error("Sequence duplikat atau mundur pada sesi boot yang sama.");
      sequences.set(row.boot_id, row.sequence);
    }
    return rows;
  }
  function fingerprint(value) {
    let hash = 2166136261;
    for (const char of JSON.stringify(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }
  function contextFingerprint(model) {
    return fingerprint([model.format, model.schema_version, model.scope, model.context_key,
      model.window, model.features, model.centers, model.scales, model.coefficients,
      model.intercept, model.alpha, model.horizon_s, model.training_interval_s,
      model.provenance, model.applicability || null, model.trained_through_ms,
      model.evaluated_through_ms, model.validation, model.test]);
  }
  function trainContexts(input) {
    const rows = prepareContextRows(input);
    if (rows.length < MIN_ROWS) throw new Error(`Perlu minimal ${MIN_ROWS} baris konteks; tersedia ${rows.length}.`);
    const a = Math.floor(rows.length * 0.6), b = Math.floor(rows.length * 0.8);
    const raw = { train: rows.slice(0, a), validation: rows.slice(a, b), test: rows.slice(b) };
    const parts = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, examples(value)]));
    for (const [key, data] of Object.entries(parts))
      if (data.length < (key === "train" ? 24 : 8)) throw new Error(`Pasangan valid ${key} belum cukup (${data.length}); tunggu data berurutan.`);
    const candidates = ALPHAS.map((alpha) => {
      const fitted = fit(parts.train, alpha);
      return { fitted, validation: evaluate(fitted, parts.validation) };
    }).sort((a, b) => a.validation.ridge.mae_ms - b.validation.ridge.mae_ms || a.fitted.alpha - b.fitted.alpha);
    const chosen = candidates[0], provenance = rows[0].source === "demo" ? "synthetic" : "measured";
    const report = {
      algorithm: "standardized_ridge_autoregression", context_key: contextKey(rows[0]), provenance,
      target: "next_successful_immediate_mqtt_app_rtt_ms", horizon_s: rows[0].interval_s,
      rows: { total: rows.length, train: raw.train.length, validation: raw.validation.length, test: raw.test.length },
      examples: Object.fromEntries(Object.entries(parts).map(([key, values]) => [key, values.length])),
      excluded_windows: Object.fromEntries(Object.entries(parts).map(([key, values]) => [key, raw[key].length - WINDOW - values.length])),
      split_boundaries: Object.fromEntries(Object.entries(parts).map(([key, values]) => [key, range(raw[key], values)])),
      features: FEATURES.slice(), alpha: chosen.fitted.alpha,
      validation: chosen.validation, test: evaluate(chosen.fitted, parts.test),
      note: "Validasi kronologis memilih alpha. Ini evaluasi historis, bukan bukti performa masa depan. Kandidat adaptif harus dinilai lagi pada target yang datang setelah kandidat dibekukan. Statistik koneksi yang sudah diringkas perangkat dapat memuat observasi sebelumnya; tidak memakai masa depan.",
    };
    const model = {
      format: "sigheat-ridge-context-v1", schema_version: 1, scope: "context", context_key: report.context_key,
      window: WINDOW, features: FEATURES.slice(), ...chosen.fitted, provenance,
      horizon_s: rows[0].interval_s, training_interval_s: rows[0].interval_s,
      trained_through_ms: raw.train.at(-1).sent_at_ms, evaluated_through_ms: rows.at(-1).sent_at_ms,
      validation: report.validation, test: report.test, report,
    };
    model.model_id = "ridge-context-" + contextFingerprint(model);
    if (!validateContextModel(model)) throw new Error("Model konteks tidak lolos validasi numerik.");
    return { model, report };
  }
  function trainBootstrap(input) {
    const rows = prepareContextRows(input);
    if (rows.some((row) => row.source !== "demo")) throw new Error("Pembentuk bootstrap ini hanya menerima dataset sintetis yang ditandai demo.");
    const result = trainContexts(rows), model = {
      ...result.model, scope: "bootstrap", context_key: null,
      applicability: { sources: ["browser", "termux", "demo"], interval_min_s: 2, interval_max_s: 60,
        accel_modes: ["linear", "gravity_removed", "unavailable"] },
      source_note: "Model awal dilatih offline pada data sintetis dengan interval " + rows[0].interval_s + " detik. Transfer ke perangkat, mode sensor, dan interval lain bersifat eksperimental dan belum tervalidasi lapangan.",
    };
    model.model_id = "ridge-bootstrap-" + contextFingerprint(model);
    if (!validateContextModel(model)) throw new Error("Model bootstrap tidak valid.");
    return { model, report: result.report };
  }
  function validateContextModel(model) {
    if (!model || typeof model !== "object" || Array.isArray(model) || model.format !== "sigheat-ridge-context-v1" || model.schema_version !== 1 || model.window !== WINDOW) return false;
    if (!Array.isArray(model.features) || JSON.stringify(model.features) !== JSON.stringify(FEATURES)) return false;
    for (const key of ["centers", "scales", "coefficients"])
      if (!Array.isArray(model[key]) || model[key].length !== FEATURES.length || !model[key].every((value) => finite(value, key === "scales" ? 1e-12 : -1e12, 1e12))) return false;
    if (!finite(model.intercept, 0, 60000) || !ALPHAS.includes(model.alpha) || !finite(model.horizon_s, 2, 60) || model.training_interval_s !== model.horizon_s) return false;
    if (!["synthetic", "measured"].includes(model.provenance) || !finite(model.trained_through_ms, 1, Number.MAX_SAFE_INTEGER) || !finite(model.evaluated_through_ms, model.trained_through_ms, Number.MAX_SAFE_INTEGER)) return false;
    if (typeof model.model_id !== "string" || !["context", "bootstrap"].includes(model.scope)) return false;
    try {
      if (model.model_id !== "ridge-" + model.scope + "-" + contextFingerprint(model)) return false;
    } catch (_) { return false; }
    for (const split of ["validation", "test"]) for (const method of ["ridge", "persistence", "moving_average"])
      if (!validateMetric(model[split]?.[method])) return false;
    if (model.scope === "bootstrap") {
      const a = model.applicability;
      return model.context_key === null && model.provenance === "synthetic" && a &&
        JSON.stringify(a.sources) === JSON.stringify(["browser", "termux", "demo"]) &&
        a.interval_min_s === 2 && a.interval_max_s === 60 &&
        JSON.stringify(a.accel_modes) === JSON.stringify(["linear", "gravity_removed", "unavailable"]);
    }
    if (model.scope !== "context" || typeof model.context_key !== "string" || model.context_key.length > 2048) return false;
    let context; try { context = JSON.parse(model.context_key); } catch (_) { return false; }
    return Array.isArray(context) && context.length === 6 && (context[0] === "" || id(context[0])) && id(context[1]) &&
      ["browser", "termux", "demo"].includes(context[2]) && endpoint(context[3]) === context[3] && context[4] === model.horizon_s &&
      ["linear", "gravity_removed", "unavailable"].includes(context[5]) && (context[2] === "demo") === (model.provenance === "synthetic");
  }
  function forecastContext(model, input) {
    if (!validateContextModel(model)) return { status: "invalid_model", reason: "Model konteks tidak valid." };
    let rows; try { rows = prepareContextRows(input); } catch (error) { return { status: "invalid_data", reason: error.message }; }
    const last = rows.at(-1);
    if (model.scope === "context" && contextKey(last) !== model.context_key) return { status: "incompatible", reason: "Model tidak cocok dengan konteks perangkat ini." };
    if (rows.length < WINDOW) return { status: "warming_up", reason: `Menunggu ${WINDOW} pengukuran awal yang berurutan.` };
    const window = rows.slice(-WINDOW);
    if (!validWindow(window)) return { status: "unavailable", reason: "Menunggu enam RTT valid setelah pergantian sesi, timeout, atau jeda." };
    const ridge = predict(model, features(window));
    if (!finite(ridge, 0, 60000)) return { status: "invalid_model", reason: "Perhitungan model tidak terbatas." };
    return {
      status: "ready", prediction_ms: ridge, ml_prediction_ms: ridge,
      persistence_ms: last.latency_ms, moving_average_ms: mean(window.map((row) => row.latency_ms)),
      method: "ridge", horizon_s: last.interval_s, provenance: model.provenance, model_id: model.model_id,
      based_on_ms: last.sent_at_ms, based_on_boot_id: last.boot_id, based_on_sequence: last.sequence,
      forecast_for_ms: last.sent_at_ms + last.interval_s * 1000,
      warning: model.scope === "bootstrap" ? "Model awal sintetis; transfer ke pengukuran nyata belum tervalidasi. Interval latih " + model.training_interval_s + " detik."
        : "Perkiraan sampel berikutnya pada konteks yang sama; bukan kepastian atau prediksi timeout.",
    };
  }
  return { WINDOW, MIN_ROWS, MAX_ROWS, FEATURES: FEATURES.slice(), groupKey, prepareRows, train, forecast, validateModel, generateDemoRows,
    buildExamples: (rows) => examples(prepareRows(rows)), contextKey, prepareContextRows, trainContexts, trainBootstrap,
    validateContextModel, forecastContext, buildContextExamples: (rows) => examples(prepareContextRows(rows)) };
});
