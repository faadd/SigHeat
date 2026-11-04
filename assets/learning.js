/* Automatic candidate training, forward evaluation, and bounded local learning state. */
(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(require("./ml.js"), require("./clusters.js"), require("./default-model.js"));
  else root.SigHeatLearning = factory(root.SigHeatML, root.SigHeatClusters, root.SigHeatDefaultModel);
})(typeof globalThis !== "undefined" ? globalThis : this, function (M, K, DEFAULT) {
  "use strict";
  const STORAGE_KEY = "sigheat.learning.v4", MAX_CONTEXTS = 12, MAX_ROWS = 1200, MAX_BYTES = 8 * 1024 * 1024;
  const FORECAST_MIN = 120, CLUSTER_MIN = 90, RETRAIN_EVERY = 60, EVALUATE_N = 24;
  const METHODS = ["ridge", "persistence", "moving_average"];
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const finite = (x, min = 0, max = Number.MAX_SAFE_INTEGER) => typeof x === "number" && Number.isFinite(x) && x >= min && x <= max;
  const integer = (x, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(x) && x >= min && x <= max;
  const qualityKey = (r) => JSON.stringify([r.project_id || "", r.source, M.prepareRows([r])[0].broker_endpoint, r.interval_s]);
  const sameNext = (a, b) => a && b.boot_id === a.boot_id && b.sequence === a.sequence + 1 &&
    b.sent_at_ms - a.sent_at_ms >= b.interval_s * 500 && b.sent_at_ms - a.sent_at_ms <= b.interval_s * 2500;
  const compact = (r) => ({ schema_version: 2, latency_type: "mqtt_app_rtt", mode: r.source === "demo" ? "contoh-lokal" : "pengukuran-perangkat",
    project_id: r.project_id || "", device_id: r.device_id, boot_id: r.boot_id, sequence: r.sequence, source: r.source,
    broker_endpoint: r.broker_endpoint, interval_s: r.interval_s, accel_mode: r.accel_mode, sent_at_ms: r.sent_at_ms,
    latency_ms: r.latency_ms, latency_std_ms: r.latency_std_ms, success_pct: r.success_pct, probe_ok: r.probe_ok,
    accel_rms: r.accel_rms, gyro_rms_rad_s: r.gyro_rms_rad_s,
    accel_available: r.accel_rms != null, gyro_available: r.gyro_rms_rad_s != null });
  const encode = (r) => [r.boot_id, r.sequence, r.sent_at_ms, r.latency_ms, r.latency_std_ms, r.success_pct, r.accel_rms, r.gyro_rms_rad_s, r.probe_ok];
  function decode(key, values) {
    if (!Array.isArray(values) || values.length !== 9) throw new Error("Baris cache tidak valid.");
    const [project_id, device_id, source, broker_endpoint, interval_s, accel_mode] = JSON.parse(key);
    const [boot_id, sequence, sent_at_ms, latency_ms, latency_std_ms, success_pct, accel_rms, gyro_rms_rad_s, probe_ok] = values;
    return compact(M.prepareRows([{ project_id, device_id, source, broker_endpoint, interval_s, accel_mode,
      boot_id, sequence, sent_at_ms, latency_ms, latency_std_ms, success_pct, accel_rms, gyro_rms_rad_s, probe_ok }])[0]);
  }
  function classifyRow(key, values) {
    if (!Array.isArray(values) || values.length !== 4) throw new Error("Baris klaster cache tidak valid.");
    const [project_id, source, broker_endpoint, interval_s] = JSON.parse(key);
    const [latency_ms, latency_std_ms, success_pct, probe_ok] = values;
    const sample = M.prepareRows([{ project_id, source, broker_endpoint, interval_s, device_id: "cache", boot_id: "cache",
      sequence: 1, sent_at_ms: 1, accel_mode: "unavailable", accel_rms: null, gyro_rms_rad_s: null,
      latency_ms, latency_std_ms, success_pct, probe_ok }])[0];
    return { source: sample.source, mode: sample.source === "demo" ? "contoh-lokal" : "pengukuran-perangkat", latency_ms, latency_std_ms, success_pct, probe_ok };
  }
  function methodValue(forecast, method) {
    return method === "persistence" ? forecast.persistence_ms : method === "moving_average" ? forecast.moving_average_ms : forecast.ml_prediction_ms;
  }
  function savedForecastEvaluation(value, model, method) {
    if (value == null) return null;
    const keys = ["candidate", "incumbent", "ridge", "persistence", "moving_average"];
    if (!value || value.n !== EVALUATE_N || !value.mae_ms || !keys.every((key) => finite(value.mae_ms[key], 0, 60000)) ||
        typeof value.promoted !== "boolean" || value.method !== method || value.model_id !== model.model_id ||
        typeof value.candidate_model_id !== "string" || !/^ridge-context-[a-f0-9]{8}$/.test(value.candidate_model_id) ||
        !finite(value.after_ms, 1) || !finite(value.through_ms, value.after_ms + 1)) throw new Error("Metrik evaluasi RTT tidak valid.");
    return { n: EVALUATE_N, mae_ms: Object.fromEntries(keys.map((key) => [key, value.mae_ms[key]])), promoted: value.promoted,
      method, model_id: model.model_id, candidate_model_id: value.candidate_model_id, after_ms: value.after_ms, through_ms: value.through_ms,
      note: "Evaluasi forward tersimpan; tidak dihitung ulang sebagai bukti baru setelah pemuatan." };
  }
  function savedClusterEvaluation(value, model) {
    if (value == null) return null;
    if (!value || value.n !== EVALUATE_N || typeof value.promoted !== "boolean" || value.model_id !== model.model_id ||
        !finite(value.candidate_mean_squared_distance, 0, 3) || !finite(value.incumbent_mean_squared_distance, 0, 3)) throw new Error("Metrik klaster tidak valid.");
    return { n: EVALUATE_N, candidate_mean_squared_distance: value.candidate_mean_squared_distance,
      incumbent_mean_squared_distance: value.incumbent_mean_squared_distance, promoted: value.promoted, model_id: model.model_id,
      note: "Galat kuantisasi tersimpan pada ruang fitur tetap; bukan akurasi label kualitas." };
  }
  function savedTrainingReport(model) {
    const r = model?.report;
    if (!r || !r.rows || !r.examples || !["train", "validation", "test"].every((key) => integer(r.rows[key], 1, M.MAX_ROWS) && integer(r.examples[key], 1, M.MAX_ROWS)) || !integer(r.rows.total, 1, M.MAX_ROWS)) return null;
    return { alpha: model.alpha, provenance: model.provenance, features: model.features.slice(), rows: { total: r.rows.total,
      train: r.rows.train, validation: r.rows.validation, test: r.rows.test }, examples: { train: r.examples.train, validation: r.examples.validation, test: r.examples.test },
      validation: clone(model.validation), test: clone(model.test), note: "Evaluasi historis dari model tersimpan; bukan bukti baru setelah pemuatan." };
  }
  function publicForecast(profile) {
    if (!profile || !profile.live) return { status: "waiting", reason: "Menunggu telemetri baru; model tersimpan sudah siap." };
    const result = M.forecastContext(profile.model, profile.rows.slice(-M.WINDOW));
    if (result.status !== "ready") return result;
    return { ...result, method: profile.method, prediction_ms: methodValue(result, profile.method),
      warning: profile.method === "ridge" ? result.warning : "Baseline dipilih dari perbandingan pada pengukuran berikutnya karena lebih baik daripada model aktif." };
  }
  function create(options = {}) {
    if (!M || !K || !M.validateContextModel(DEFAULT) || !K.validateModel(K.defaultModel())) throw new Error("Aset model awal tidak lengkap atau tidak valid.");
    let profiles = new Map(), qualityProfiles = new Map(), dirty = false, initializationSource = "bootstrap";
    const storage = options.storage || null;
    let storageAvailable = !!storage, storageMessage = storage ? "Model dan riwayat disimpan di browser ini." : "Penyimpanan lokal tidak tersedia; pembelajaran hanya di memori.";
    function bounded(map, synthetic) {
      const sameKind = [...map.values()].filter((p) => (p.rows[0]?.source === "demo") === synthetic);
      if (sameKind.length >= MAX_CONTEXTS) map.delete(sameKind[0].key);
    }
    function freshProfile(key) {
      return { key, rows: [], totalAccepted: 0, lastAttempt: 0, model: clone(DEFAULT), method: "ridge", candidate: null,
        pending: null, live: false, lastForecastEvaluation: null, trainingReport: null, trainingMessage: "Model awal dimuat otomatis." };
    }
    function freshQuality(key) {
      return { key, rows: [], totalAccepted: 0, lastAttempt: 0, model: K.defaultModel(), candidate: null,
        lastClusterEvaluation: null, trainingMessage: "Klaster awal dimuat otomatis." };
    }
    function due(p, minimum) { return !p.candidate && p.rows.length >= minimum && p.totalAccepted - p.lastAttempt >= RETRAIN_EVERY; }
    function pendingForecast(p) {
      const f = M.forecastContext(p.model, p.rows.slice(-M.WINDOW));
      const c = p.candidate && M.forecastContext(p.candidate.model, p.rows.slice(-M.WINDOW));
      p.pending = f.status === "ready" && c?.status === "ready" ? {
        boot_id: f.based_on_boot_id, sequence: f.based_on_sequence, sent_at_ms: f.based_on_ms,
        incumbent: methodValue(f, p.method), ridge: f.ml_prediction_ms, candidate: c.ml_prediction_ms,
        persistence: f.persistence_ms, moving_average: f.moving_average_ms,
      } : null;
    }
    function evaluateForecast(p, row) {
      const c = p.candidate, prediction = p.pending;
      if (!c || !prediction || !sameNext(prediction, row) || !row.probe_ok || row.sent_at_ms <= c.cutoff_ms) return;
      c.n++;
      for (const key of ["candidate", "incumbent", "ridge", "persistence", "moving_average"]) c.errors[key] += Math.abs(row.latency_ms - prediction[key]);
      if (c.n < EVALUATE_N) return;
      const mae = Object.fromEntries(Object.entries(c.errors).map(([key, value]) => [key, value / c.n]));
      const best = Math.min(mae.incumbent, mae.persistence, mae.moving_average);
      const promoted = mae.candidate < best && mae.candidate <= 0.95 * best;
      if (promoted) { p.model = c.model; p.method = "ridge"; }
      else {
        const baseline = mae.persistence <= mae.moving_average ? "persistence" : "moving_average";
        if (mae[baseline] < mae.incumbent && mae[baseline] <= 0.95 * mae.incumbent) p.method = baseline;
        else if (mae.ridge < Math.min(mae.persistence, mae.moving_average, mae.incumbent) && mae.ridge <= 0.95 * mae.incumbent) p.method = "ridge";
      }
      p.lastForecastEvaluation = { n: c.n, mae_ms: mae, promoted, method: p.method, model_id: p.model.model_id,
        candidate_model_id: c.model.model_id, after_ms: c.cutoff_ms, through_ms: row.sent_at_ms,
        note: "Perbandingan forward pada target yang tiba setelah kandidat dibekukan; bukan test independen selamanya." };
      p.trainingMessage = promoted ? "Model Ridge diperbarui setelah lolos evaluasi pengukuran berikutnya." : "Model lama dipertahankan; metode prediksi dipilih menurut evaluasi berikutnya.";
      p.candidate = null; p.pending = null; dirty = true;
    }
    function evaluateQuality(p, row) {
      if (!p.candidate) return;
      const a = K.distance(p.candidate.model, row), b = K.distance(p.model, row);
      if (a == null || b == null) return;
      const c = p.candidate;
      c.n++; c.candidateError += a; c.incumbentError += b;
      if (c.n < EVALUATE_N) return;
      const candidateError = c.candidateError / c.n, incumbentError = c.incumbentError / c.n;
      const promoted = candidateError < incumbentError && candidateError <= incumbentError * 0.95;
      if (promoted) p.model = c.model;
      p.lastClusterEvaluation = { n: c.n, candidate_mean_squared_distance: candidateError, incumbent_mean_squared_distance: incumbentError,
        promoted, model_id: p.model.model_id, note: "Galat kuantisasi pada ruang fitur tetap; bukan akurasi label kualitas." };
      p.trainingMessage = promoted ? "Pusat klaster diperbarui dari pengukuran baru." : "Klaster lama dipertahankan setelah perbandingan.";
      p.candidate = null; dirty = true;
    }
    function ingest(input) {
      let row;
      try { row = compact(M.prepareRows([input])[0]); } catch (error) { return { accepted: false, reason: error.message, needsMaintenance: false }; }
      const key = M.contextKey(row), qkey = qualityKey(row);
      let p = profiles.get(key), q = qualityProfiles.get(qkey);
      if (p) {
        const last = p.rows.at(-1);
        if (last && row.sent_at_ms <= last.sent_at_ms) return { accepted: false, reason: "Telemetri lama atau duplikat diabaikan.", needsMaintenance: false };
        const bootLast = p.rows.findLast ? p.rows.findLast((r) => r.boot_id === row.boot_id) : p.rows.slice().reverse().find((r) => r.boot_id === row.boot_id);
        if (bootLast && row.sequence <= bootLast.sequence) return { accepted: false, reason: "Sequence lama atau duplikat diabaikan.", needsMaintenance: false };
      } else { bounded(profiles, row.source === "demo"); p = freshProfile(key); profiles.set(key, p); }
      if (!q) { bounded(qualityProfiles, row.source === "demo"); q = freshQuality(qkey); qualityProfiles.set(qkey, q); }
      evaluateForecast(p, row); evaluateQuality(q, row);
      p.rows.push(row); p.rows = p.rows.slice(-MAX_ROWS); p.totalAccepted++; p.live = true;
      q.rows.push({ source: row.source, mode: row.mode, latency_ms: row.latency_ms, latency_std_ms: row.latency_std_ms,
        success_pct: row.success_pct, probe_ok: row.probe_ok });
      q.rows = q.rows.slice(-MAX_ROWS); q.totalAccepted++;
      pendingForecast(p); dirty = row.source !== "demo" || dirty;
      return { accepted: true, needsMaintenance: due(p, FORECAST_MIN) || due(q, CLUSTER_MIN) };
    }
    function maintain() {
      let trained = 0;
      for (const p of profiles.values()) if (due(p, FORECAST_MIN)) {
        p.lastAttempt = p.totalAccepted;
        try {
          const result = M.trainContexts(p.rows);
          p.candidate = { model: result.model, cutoff_ms: p.rows.at(-1).sent_at_ms, n: 0,
            errors: { candidate: 0, incumbent: 0, ridge: 0, persistence: 0, moving_average: 0 } };
          p.trainingReport = result.report; p.trainingMessage = "Kandidat Ridge sedang dinilai pada 24 target berikutnya.";
          pendingForecast(p); trained++;
        } catch (error) { p.trainingMessage = "Belum memperbarui Ridge: " + error.message; }
      }
      for (const p of qualityProfiles.values()) if (due(p, CLUSTER_MIN)) {
        p.lastAttempt = p.totalAccepted;
        try {
          p.candidate = { model: K.train(p.rows, { contextKey: p.key }), n: 0, candidateError: 0, incumbentError: 0 };
          p.trainingMessage = "Kandidat klaster sedang dinilai pada 24 profil berikutnya."; trained++;
        } catch (error) { p.trainingMessage = "Belum memperbarui klaster: " + error.message; }
      }
      if (trained) dirty = true;
      return { changed: trained > 0, trained };
    }
    function getProfile(row) { try { return row && profiles.get(M.contextKey(M.prepareRows([row])[0])); } catch (_) { return undefined; } }
    function getQuality(row) { try { return row && qualityProfiles.get(qualityKey(row)); } catch (_) { return undefined; } }
    function forecast(row) {
      const p = getProfile(row);
      if (!p || !p.live) return { status: "waiting", reason: "Model awal siap; menunggu enam pengukuran awal." };
      const last = p.rows.at(-1);
      if (!row || last.boot_id !== row.boot_id || last.sequence !== row.sequence || last.sent_at_ms !== row.sent_at_ms)
        return { status: "waiting", reason: "Prediksi hanya tersedia untuk telemetri terbaru perangkat ini." };
      return publicForecast(p);
    }
    function classify(row) { return K.classify(getQuality(row)?.model || K.defaultModel(), row); }
    function inspect(row) {
      const p = getProfile(row), q = getQuality(row);
      return { contextKey: p?.key || null, sampleCount: p?.rows.length || 0, totalAccepted: p?.totalAccepted || 0,
        modelProvenance: p?.model.provenance || "synthetic", modelId: p?.model.model_id || DEFAULT.model_id, method: p?.method || "ridge",
        forecastCandidate: p?.candidate ? { n: p.candidate.n, required: EVALUATE_N } : null,
        clusterCandidate: q?.candidate ? { n: q.candidate.n, required: EVALUATE_N } : null,
        clusterModelId: q?.model.model_id || K.defaultModel().model_id, clusterProvenance: q?.model.provenance || "synthetic",
        lastForecastEvaluation: p?.lastForecastEvaluation || null, lastClusterEvaluation: q?.lastClusterEvaluation || null,
        trainingReport: p?.trainingReport || null, trainingMessage: p?.trainingMessage || "Model awal dimuat otomatis; belum tervalidasi lapangan.",
        clusterMessage: q?.trainingMessage || "Klaster awal sintetis; kategori bersifat relatif.", storageMessage, storageAvailable, initializationSource };
    }
    function exportRows(row) { return clone(getProfile(row)?.rows || []); }
    function exportState() {
      return { format: "sigheat-learning-state-v1", version: 1,
        profiles: [...profiles.values()].filter((p) => p.rows[0]?.source !== "demo").map((p) => ({ key: p.key,
          rows: p.rows.map(encode), totalAccepted: p.totalAccepted, lastAttempt: p.lastAttempt, model: clone(p.model), method: p.method,
          candidate: p.candidate ? { model: clone(p.candidate.model), cutoff_ms: p.candidate.cutoff_ms } : null,
          lastForecastEvaluation: p.lastForecastEvaluation ? clone(p.lastForecastEvaluation) : null })),
        qualityProfiles: [...qualityProfiles.values()].filter((p) => p.rows[0]?.source !== "demo").map((p) => ({ key: p.key,
          rows: p.rows.map((r) => [r.latency_ms, r.latency_std_ms, r.success_pct, r.probe_ok]), totalAccepted: p.totalAccepted,
          lastAttempt: p.lastAttempt, model: clone(p.model), candidate: p.candidate ? { model: clone(p.candidate.model) } : null,
          lastClusterEvaluation: p.lastClusterEvaluation ? clone(p.lastClusterEvaluation) : null })),
        note: "Hanya fitur pengukuran; tanpa lokasi/kredensial. Bukti evaluasi kandidat diulang setelah pemuatan. Label source bukan bukti autentikasi perangkat." };
    }
    function importState(input) {
      try {
        const text = typeof input === "string" ? input : JSON.stringify(input);
        if (typeof text !== "string" || text.length > MAX_BYTES) throw new Error("Cadangan terlalu besar (maksimal 8 MiB).");
        const state = JSON.parse(text);
        if (!state || state.format !== "sigheat-learning-state-v1" || state.version !== 1 ||
            !Array.isArray(state.profiles) || state.profiles.length > MAX_CONTEXTS || !Array.isArray(state.qualityProfiles) || state.qualityProfiles.length > MAX_CONTEXTS)
          throw new Error("Format cadangan pembelajaran tidak didukung.");
        const nextProfiles = new Map(), nextQuality = new Map();
        for (const value of state.profiles) {
          if (!value || typeof value.key !== "string" || value.key.length > 2048 || nextProfiles.has(value.key) ||
              !Array.isArray(value.rows) || !value.rows.length || value.rows.length > MAX_ROWS || !METHODS.includes(value.method)) throw new Error("Konteks cadangan tidak valid.");
          const rows = M.prepareContextRows(value.rows.map((v) => decode(value.key, v)));
          if (rows[0].source === "demo" || M.contextKey(rows[0]) !== value.key || !integer(value.totalAccepted, rows.length, 1e9) || !integer(value.lastAttempt, 0, value.totalAccepted)) throw new Error("Identitas/asalan data cadangan tidak valid.");
          const lastSavedMs = rows.at(-1).sent_at_ms;
          const validFor = (model) => M.validateContextModel(model) && (model.scope === "bootstrap" || model.context_key === value.key && model.provenance === "measured" && model.evaluated_through_ms <= lastSavedMs);
          if (!validFor(value.model)) throw new Error("Model cadangan tidak cocok dengan konteks.");
          const p = freshProfile(value.key);
          Object.assign(p, { rows, totalAccepted: value.totalAccepted, lastAttempt: value.lastAttempt, model: value.model, method: value.method,
            live: false, trainingMessage: "Model tersimpan dipulihkan; menunggu telemetri baru." });
          p.lastForecastEvaluation = savedForecastEvaluation(value.lastForecastEvaluation, p.model, p.method);
          if (p.lastForecastEvaluation && p.lastForecastEvaluation.through_ms > lastSavedMs) throw new Error("Bukti evaluasi melampaui riwayat tersimpan.");
          p.trainingReport = savedTrainingReport(value.candidate?.model || p.model);
          if (value.candidate) {
            if (!validFor(value.candidate.model) || value.candidate.model.scope !== "context" || !finite(value.candidate.cutoff_ms, value.candidate.model.evaluated_through_ms, lastSavedMs)) throw new Error("Kandidat cadangan tidak valid.");
            p.candidate = { model: value.candidate.model, cutoff_ms: rows.at(-1).sent_at_ms, n: 0,
              errors: { candidate: 0, incumbent: 0, ridge: 0, persistence: 0, moving_average: 0 } };
          }
          nextProfiles.set(value.key, p);
        }
        for (const value of state.qualityProfiles) {
          if (!value || typeof value.key !== "string" || value.key.length > 2048 || nextQuality.has(value.key) || !Array.isArray(value.rows) || !value.rows.length || value.rows.length > MAX_ROWS) throw new Error("Konteks klaster tidak valid.");
          const rows = value.rows.map((v) => classifyRow(value.key, v));
          const context = JSON.parse(value.key);
          if (!Array.isArray(context) || context.length !== 4 || !["browser", "termux"].includes(context[1]) ||
              JSON.stringify([context[0], context[1], M.prepareRows([{ project_id: context[0], source: context[1], broker_endpoint: context[2], interval_s: context[3],
                device_id: "cache", boot_id: "cache", sequence: 1, sent_at_ms: 1, probe_ok: false, latency_ms: null, latency_std_ms: null,
                success_pct: 0, accel_mode: "unavailable", accel_rms: null, gyro_rms_rad_s: null }])[0].broker_endpoint, context[3]]) !== value.key ||
              !integer(value.totalAccepted, rows.length, 1e9) || !integer(value.lastAttempt, 0, value.totalAccepted)) throw new Error("Klaster cadangan tidak valid.");
          const validFor = (model) => K.validateModel(model) && (model.provenance === "measured" ? model.context_key === value.key : model.model_id === K.defaultModel().model_id && model.context_key == null);
          if (!validFor(value.model)) throw new Error("Model klaster tidak cocok dengan konteks cadangan.");
          const p = freshQuality(value.key);
          Object.assign(p, { rows, totalAccepted: value.totalAccepted, lastAttempt: value.lastAttempt, model: value.model,
            trainingMessage: "Pusat klaster tersimpan dipulihkan." });
          p.lastClusterEvaluation = savedClusterEvaluation(value.lastClusterEvaluation, p.model);
          if (value.candidate) {
            if (!validFor(value.candidate.model) || value.candidate.model.provenance !== "measured") throw new Error("Kandidat klaster tidak valid.");
            p.candidate = { model: value.candidate.model, n: 0, candidateError: 0, incumbentError: 0 };
          }
          nextQuality.set(value.key, p);
        }
        profiles = nextProfiles; qualityProfiles = nextQuality; dirty = true;
        return { ok: true, reason: "Model dan riwayat dipulihkan. Evaluasi kandidat dimulai ulang pada data baru." };
      } catch (error) { return { ok: false, reason: "Cadangan ditolak: " + error.message }; }
    }
    function persist() {
      if (!storage) return false;
      if (!dirty) return true;
      try {
        const text = JSON.stringify(exportState());
        if (text.length > MAX_BYTES) throw new Error("ukuran melebihi batas");
        storage.setItem(STORAGE_KEY, text); dirty = false; storageAvailable = true;
        storageMessage = "Model dan riwayat tersimpan di browser ini."; return true;
      } catch (_) { storageAvailable = false; storageMessage = "Penyimpanan browser gagal/penuh. Model tetap berjalan di memori; unduh cadangan sebelum menutup halaman."; return false; }
    }
    function clearLearning() {
      profiles.clear(); qualityProfiles.clear(); dirty = false; initializationSource = "bootstrap";
      if (storage) try { storage.removeItem(STORAGE_KEY); storageAvailable = true; storageMessage = "Pembelajaran lokal dihapus; model awal kembali aktif."; }
      catch (_) { storageAvailable = false; storageMessage = "Memori direset, tetapi cache browser tidak dapat dihapus."; }
    }
    let restored = false;
    if (storage) {
      try {
        const saved = storage.getItem(STORAGE_KEY);
        if (saved) {
          const result = importState(saved);
          if (!result.ok) storageMessage = "Cache rusak/tidak cocok diabaikan. " + result.reason;
          else { storageMessage = "Model dan riwayat dipulihkan dari browser ini."; restored = true; initializationSource = "cache"; }
        }
      } catch (_) { storageAvailable = false; storageMessage = "Penyimpanan browser diblokir; pembelajaran berjalan di memori."; }
    }
    if (!restored && options.seed) {
      const result = importState(options.seed);
      if (result.ok) {
        initializationSource = "seed";
        storageMessage = "Model awal kelompok dimuat dari paket." + (storageAvailable ? " Perubahan berikutnya disimpan di browser." : " Penyimpanan lokal tidak tersedia; unduh cadangan sebelum menutup.");
      } else storageMessage += " Model awal kelompok ditolak: " + result.reason;
    }
    return { ingest, maintain, forecast, classify, inspect, exportRows, exportState, importState, persist, clearLearning };
  }
  return { create, STORAGE_KEY, MAX_CONTEXTS, MAX_ROWS, FORECAST_MIN, CLUSTER_MIN, RETRAIN_EVERY, EVALUATE_N, qualityKey };
});
