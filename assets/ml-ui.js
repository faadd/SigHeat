/* Automatic local learning. Only validated telemetry enters the manager. */
(function (root) {
  "use strict";
  const document = root.document;
  if (!document || document.body.dataset.page !== "dashboard") return;
  const $ = (id) => document.getElementById(id);
  if (!$("ml-prediction")) return;
  const C = root.SigHeatCore, L = root.SigHeatLearning;
  const names = {ridge: "Regresi Ridge", persistence: "RTT terakhir (baseline)", moving_average: "Rerata enam RTT (baseline)"};
  const text = (id, value) => { if ($(id)) $(id).textContent = value; };
  const finite = (n) => typeof n === "number" && Number.isFinite(n);
  const ms = (n) => finite(n) ? n.toLocaleString("id-ID", {maximumFractionDigits: 1}) + " ms" : "–";
  let callbacks = {}, currentRow = null, selected = null, connected = false, isDemo = false, staleIds = new Set(), contexts = 0;
  let live, demo, startupError = "", actionToken = 0;
  const latest = new Map(), queued = new Set();
  let saveQueued = false;
  let storage = null;
  try { storage = root.localStorage || null; } catch (_) { startupError = "Penyimpanan browser tidak dapat diakses; pembelajaran hanya berada di memori."; }
  try {
    if (L) { live = L.create({storage, seed: root.SigHeatLearningSeed}); demo = L.create({storage: null}); }
    else startupError = "Modul pembelajaran tidak tersedia. Periksa assets/learning.js dan model awal.";
  } catch (error) { startupError = "Model awal gagal dimuat: " + String(error.message || error); }
  const managerFor = (row) => row?.source === "demo" ? demo : live;
  const emptyClass = () => ({quality: "unknown", label: "Tidak terklasifikasi", reason: "Model belum tersedia."});
  function classify(row) {
    try { return managerFor(row)?.classify(row) || emptyClass(); }
    catch (_) { return emptyClass(); }
  }
  function inspect(row) {
    try { return managerFor(row)?.inspect(row) || {}; } catch (_) { return {}; }
  }
  function render() {
    const row = currentRow, manager = managerFor(row), info = inspect(row), quality = row ? classify(row) : emptyClass();
    const synthetic = row?.source === "demo" || isDemo;
    const learned = info.modelProvenance === "measured";
    text("ml-provenance", synthetic ? "SIMULASI · TERPISAH" : learned ? "MODEL DARI PENGUKURAN" : "MODEL AWAL SINTETIS");
    $("ml-provenance").className = "chip " + (synthetic || !learned ? "amber" : "");
    text("ml-device-label", row ? `Perangkat ${row.device_id} · ${row.source === "demo" ? "contoh lokal" : row.source} · interval ${row.interval_s} dtk` : "Pilih perangkat pada peta atau tabel.");
    text("ml-observed-label", synthetic ? "RTT terakhir sintetis" : "RTT terakhir terukur");
    text("ml-observed", ms(row?.latency_ms));
    text("ml-observed-note", !row ? "Probe aplikasi MQTT" : !row.probe_ok ? "Probe timeout; RTT tidak diketahui" : synthetic ? "Contoh buatan, bukan pengukuran" : "Hasil probe terakhir, bukan prediksi");
    text("ml-quality", row ? quality.label : "Belum ada data");
    text("ml-quality-note", row ? `${quality.provenance === "measured" ? "Model adaptif" : "Model awal sintetis"} · ${quality.reason || "KMeans dari profil RTT, jitter, dan keberhasilan probe"}` : "KMeans mempelajari kelompok relatif");
    text("ml-prediction", "–");
    const stale = !synthetic && (!connected || !row || staleIds.has(row.device_id) || Date.now() - row.sent_at_ms > Math.max(30000, (row.interval_s || 5) * 3000));
    let predictionNote = !row ? "Hubungkan HP; model awal tersedia otomatis" : "Menunggu enam pengukuran berurutan";
    if (row && manager && !stale) {
      try {
        const f = manager.forecast(row);
        if (f.status === "ready") {
          text("ml-prediction", ms(f.prediction_ms));
          predictionNote = `${names[f.method] || f.method || "Ridge"} · sampel berikutnya, interval nominal ${f.horizon_s} dtk`;
        } else predictionNote = f.reason || "Riwayat terbaru belum cukup untuk prediksi.";
      } catch (_) { predictionNote = "Prediksi belum tersedia. Pengukuran tetap ditampilkan."; }
    } else if (row && stale) predictionNote = "Prediksi dijeda: perangkat terputus atau data sudah tidak aktif.";
    text("ml-prediction-note", predictionNote);
    const pending = info.forecastCandidate || info.clusterCandidate;
    text("ml-status", startupError || (synthetic ? "Contoh lokal memakai pembelajaran terpisah; model pengukuran nyata tidak diubah." : pending ? "Kandidat model sedang dibandingkan pada pengukuran baru. Model aktif tetap dipakai." : learned ? "Model adaptif aktif. Data baru dipelajari otomatis tanpa tombol training." : "Model awal sintetis dimuat otomatis; belum tervalidasi pada jaringan ini."));
    text("ml-data-note", row ? `${info.sampleCount || 0} sampel konteks perangkat tersimpan. Riwayat dibatasi; model dan data baru diproses otomatis. Jendela RTT tidak menyeberangi reboot atau jeda.` : "Hubungkan perangkat. Pembelajaran dimulai otomatis ketika data valid cukup; tidak ada tombol training.");
    const progress = [];
    if (info.forecastCandidate) progress.push(`Kandidat Ridge: ${info.forecastCandidate.n}/${info.forecastCandidate.required} target baru`);
    if (info.clusterCandidate) progress.push(`Kandidat KMeans: ${info.clusterCandidate.n}/${info.clusterCandidate.required} pengamatan baru`);
    text("ml-candidate-note", progress.length ? progress.join(" · ") : "Belum ada kandidat menunggu evaluasi. Kandidat hanya menggantikan model aktif jika melewati pemeriksaan perbaikan.");
    text("ml-context-note", contexts > 1 ? "Ada beberapa konteks model pada tampilan ini. Kelas relatif lintas sumber/broker/interval tidak langsung sebanding; grid gabungan dinonaktifkan." : "Kedua HP pada konteks yang sama memakai model KMeans bersama. Prediksi bukan hasil ukur atau kekuatan sinyal radio.");
    const storageInfo = inspect(null);
    text("ml-storage-note", synthetic ? "Demo hanya di memori. Cadangan dan pemulihan di bawah berlaku untuk pembelajaran nyata." : startupError || storageInfo.storageMessage || (storageInfo.storageAvailable ? "Pembelajaran tersimpan pada browser ini. Unduh cadangan untuk memindahkannya." : "Penyimpanan lokal tidak tersedia; pembelajaran hanya berada di memori. Unduh cadangan sebelum menutup tab."));
    $("ml-warning").hidden = !row || quality.quality !== "poor";
    if (row && quality.quality === "poor") text("ml-warning", "KMeans menempatkan pengamatan ini pada kelompok beban relatif tinggi. Ini hasil pengelompokan data, bukan kepastian gangguan atau lokasi tanpa sinyal.");
    const evidence = {model_rtt: info.modelId || null, sumber_model_rtt: info.modelProvenance || "synthetic", model_kelompok: info.clusterModelId || null, sumber_model_kelompok: info.clusterProvenance || "synthetic", evaluasi_rtt_baru: info.lastForecastEvaluation || null, evaluasi_kelompok_baru: info.lastClusterEvaluation || null, validasi_kandidat: info.trainingReport || null};
    text("ml-evaluation", JSON.stringify(evidence, null, 2));
    $("ml-export-data").disabled = !row || !manager || !(info.sampleCount > 0);
    $("ml-export-backup").disabled = !live;
    $("ml-import-backup").disabled = !live;
    $("ml-clear").disabled = !live;
  }
  function schedule(manager, maintain) {
    if (!manager) return;
    if (maintain && !queued.has(manager)) {
      queued.add(manager);
      setTimeout(() => {
        queued.delete(manager);
        try { manager.maintain(); if (manager === live) manager.persist(); }
        catch (error) { text("ml-action-status", "Pembaruan model ditunda: " + String(error.message || error)); }
        render(); callbacks.onChange?.();
      }, 0);
    }
    if (manager === live && !saveQueued) {
      saveQueued = true;
      setTimeout(() => { saveQueued = false; live?.persist(); render(); }, 250);
    }
  }
  function download(content, filename, type) {
    const url = URL.createObjectURL(new Blob([content], {type}));
    const a = document.createElement("a"); a.href = url; a.download = filename;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportRows() {
    if (!currentRow) return;
    const rows = managerFor(currentRow)?.exportRows(currentRow) || [];
    if (!rows.length) return;
    const columns = ["mode", "project_id", "schema_version", "device_id", "boot_id", "sequence", "source", "broker_endpoint", "sent_at_ms", "interval_s", "latency_type", "probe_ok", "probe_count", "latency_ms", "latency_mean_ms", "latency_std_ms", "success_pct", "accel_rms", "accel_mode", "accel_available", "gyro_rms_rad_s", "gyro_available", "rotation_total_rad", "sensor_window_ms"];
    const csv = [columns.join(","), ...rows.map((row) => columns.map((c) => C.csvCell(c === "mode" ? row.source === "demo" ? "contoh-lokal" : "pengukuran-perangkat" : row[c])).join(","))].join("\r\n");
    download("\ufeff" + csv, `sigheat-${currentRow.source === "demo" ? "SINTETIS" : "PERANGKAT"}-${currentRow.device_id}.csv`, "text/csv;charset=utf-8");
  }
  $("ml-export-data").addEventListener("click", exportRows);
  $("ml-export-backup").addEventListener("click", () => {
    if (!live) return;
    download(JSON.stringify(live.exportState(), null, 2) + "\n", "sigheat-pembelajaran.json", "application/json");
    text("ml-action-status", "Cadangan pembelajaran nyata diunduh. Data demo tidak disertakan.");
  });
  $("ml-import-backup").addEventListener("change", async (event) => {
    const file = event.target.files?.[0], token = ++actionToken;
    if (!file || !live) return;
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error("Berkas maksimal 8 MiB.");
      const parsed = JSON.parse(await file.text());
      if (token !== actionToken) return;
      const result = live.importState(parsed);
      if (!result?.ok) throw new Error(result?.reason || "Format cadangan tidak valid.");
      live.persist();
      text("ml-action-status", "Cadangan dipulihkan. Tunggu pengukuran baru untuk mengaktifkan prediksi langsung.");
      render(); callbacks.onChange?.();
    } catch (error) { if (token === actionToken) text("ml-action-status", "Cadangan tidak dipulihkan: " + String(error.message || error)); }
    event.target.value = "";
  });
  $("ml-clear").addEventListener("click", () => { $("ml-clear-confirm").hidden = false; $("ml-clear-cancel").focus?.(); });
  $("ml-clear-cancel").addEventListener("click", () => { $("ml-clear-confirm").hidden = true; $("ml-clear").focus?.(); });
  $("ml-clear-yes").addEventListener("click", () => {
    actionToken++;
    live?.clearLearning();
    $("ml-clear-confirm").hidden = true;
    text("ml-action-status", "Pembelajaran nyata tersimpan dihapus. Model awal tetap tersedia.");
    render(); callbacks.onChange?.(); $("ml-clear").focus?.();
  });
  root.addEventListener?.("pagehide", () => live?.persist());
  root.SigHeatMLPanel = {
    configure(value) { callbacks = value || {}; },
    classify,
    reset() {
      actionToken++;
      currentRow = null; selected = null; connected = false; isDemo = false; contexts = 0; staleIds = new Set(); latest.clear();
      $("ml-clear-confirm").hidden = true;
      live?.persist();
      if (L) demo = L.create({storage: null});
      render();
    },
    ingest(row) {
      const manager = managerFor(row); if (!manager) return;
      const result = manager.ingest(row);
      if (result?.accepted) {
        latest.set(row.device_id, row);
        if (selected === row.device_id) currentRow = row;
        schedule(manager, result.needsMaintenance);
      }
      return result;
    },
    updateSelection(info) {
      selected = info.selected || null; connected = !!info.connected; isDemo = !!info.demo;
      staleIds = new Set(info.staleDeviceIds || []); contexts = info.contextCount || 0;
      currentRow = info.row || (selected ? latest.get(selected) || null : null);
      render();
    },
  };
  render();
})(window);
