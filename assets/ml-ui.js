/* Dashboard-only ML workflow. Telemetry enters here after protocol validation. */
(function (root) {
  "use strict";
  const document = root.document;
  if (!document || document.body.dataset.page !== "dashboard") return;
  const M = root.SigHeatML;
  const C = root.SigHeatCore;
  const $ = (id) => document.getElementById(id);
  if (!$("ml-train")) return;
  const names = { ridge: "Regresi Ridge (ML)", persistence: "RTT terakhir (baseline)", moving_average: "Rerata window (baseline)" };
  const MAX_ROWS = 3000;
  const MAX_GROUPS = 100;
  const groups = new Map();
  const models = new Map();
  const reports = new Map();
  let selected = "", selectedMapDevice = null, connected = false, synthetic = false;
  let busy = false, generation = 0, message = "Model belum dilatih.", callbacks = {};
  let staleDeviceIds = new Set();
  const finite = (x) => typeof x === "number" && Number.isFinite(x);
  const ms = (x) => finite(x) ? x.toLocaleString("id-ID", { maximumFractionDigits: 1 }) + " ms" : "–";
  function text(id, value) { const n = $(id); if (n) n.textContent = value; }
  function node(tag, value) {
    const n = document.createElement(tag);
    if (value !== undefined) n.textContent = value;
    return n;
  }
  function current() { return groups.get(selected) || []; }
  function latestGroups() {
    const latest = new Map();
    for (const [key, rows] of groups) {
      const last = rows[rows.length - 1];
      const old = latest.get(last.device_id);
      if (!old || old.last.sent_at_ms <= last.sent_at_ms) latest.set(last.device_id, { key, last });
    }
    return [...latest.values()];
  }
  function addRow(row) {
    if (!M) return;
    const key = M.groupKey(row);
    if (!groups.has(key)) {
      if (groups.size >= MAX_GROUPS) {
        const oldest = groups.keys().next().value;
        groups.delete(oldest); models.delete(oldest); reports.delete(oldest);
      }
      groups.set(key, []);
    }
    const rows = groups.get(key);
    const previous = rows[rows.length - 1];
    if (previous && (row.sequence <= previous.sequence || row.sent_at_ms <= previous.sent_at_ms)) return;
    rows.push({ ...row });
    if (rows.length > MAX_ROWS) rows.splice(0, rows.length - MAX_ROWS);
    if (!selected || (previous && selected === key)) selected = key;
  }
  function renderDevices() {
    const select = $("ml-device");
    const options = latestGroups();
    if (!options.some((item) => item.key === selected)) {
      const oldDevice = current().at(-1)?.device_id;
      selected = (options.find((item) => item.last.device_id === oldDevice) || options[0])?.key || "";
    }
    select.replaceChildren();
    if (!options.length) {
      const option = node("option", "Belum ada perangkat"); option.value = ""; select.append(option);
    } else {
      for (const item of options) {
        const label = `${item.last.device_id} · ${item.last.source === "demo" ? "sintetis" : item.last.source} · ${item.last.interval_s} dtk`;
        const option = node("option", label); option.value = item.key; select.append(option);
      }
    }
    select.value = selected;
    select.disabled = busy || options.length === 0;
  }
  function renderEvaluation(report) {
    const tbody = $("ml-results"); tbody.replaceChildren();
    if (!report) {
      const row = node("tr"), cell = node("td", "Belum ada hasil evaluasi."); cell.colSpan = 4;
      row.append(cell); tbody.append(row);
      text("ml-split", "Urutan waktu: 60% pelatihan, 20% validasi, 20% pengujian. Enam input RTT dan target berada dalam split yang sama.");
      text("ml-selection-note", "Ridge dipilih jika MAE validasinya sedikitnya 5% lebih rendah dari baseline terbaik. Jika belum, aplikasi memakai baseline dan tetap menampilkan hasil ML.");
      return;
    }
    for (const method of ["ridge", "persistence", "moving_average"]) {
      const row = node("tr");
      if (method === report.selected_predictor) row.className = "ml-selected";
      row.append(node("td", names[method] + (method === report.selected_predictor ? " · dipilih" : "")),
        node("td", ms(report.validation[method].mae_ms)), node("td", ms(report.test[method].mae_ms)), node("td", ms(report.test[method].rmse_ms)));
      tbody.append(row);
    }
    text("ml-split", `Contoh berlabel valid: ${report.examples.train} latihan · ${report.examples.validation} validasi · ${report.examples.test} uji. Regularisasi α = ${report.alpha}.`);
    text("ml-selection-note", report.selected_predictor === "ridge"
      ? "Ridge melewati syarat perbaikan 5% terhadap baseline terbaik pada validasi. Angka uji di atas adalah evaluasi terpisah; belum menjamin performa pada sesi baru."
      : "ML belum melewati syarat perbaikan 5% pada validasi. Prediksi utama memakai baseline terbaik; prediksi Ridge tetap tersedia untuk perbandingan.");
  }
  function render() {
    if (!M) {
      text("ml-status", "Modul ML tidak tersedia. Periksa berkas assets/ml.js.");
      $("ml-demo").disabled = true;
      return;
    }
    renderDevices();
    const rows = current(), last = rows.at(-1), model = models.get(selected), report = reports.get(selected);
    text("ml-provenance", synthetic ? "SIMULASI · DATA SINTETIS" : rows.length ? "PENGUKURAN PERANGKAT" : "BELUM ADA DATA");
    $("ml-provenance").className = "chip " + (synthetic ? "amber" : rows.length ? "" : "grey");
    $("ml-leave-demo").hidden = !synthetic;
    $("ml-demo").disabled = busy;
    $("ml-train").disabled = busy || rows.length < M.MIN_ROWS;
    $("ml-train").textContent = busy ? "Melatih…" : model ? "Latih ulang & evaluasi" : "Latih & evaluasi";
    $("ml-export-data").disabled = !rows.length || busy;
    $("ml-export-model").disabled = !model || busy;
    $("ml-export-report").disabled = !report || busy;
    const count = rows.length.toLocaleString("id-ID");
    text("ml-data-note", rows.length
      ? `${count} sampel tersimpan untuk sesi ini (maks. ${MAX_ROWS.toLocaleString("id-ID")}). Minimum ${M.MIN_ROWS}; timeout, lompatan urutan, dan jeda waktu dapat mengurangi contoh berlabel. ${synthetic ? "Semua nilai dibuat untuk demonstrasi." : "Sesi, sumber, broker, mode sensor, dan interval dipisahkan."}`
      : `Kumpulkan sedikitnya ${M.MIN_ROWS} sampel pada interval tetap. Pada interval 5 detik, ini sekitar 10 menit. Pilih perangkat di sini atau pada peta.`);
    text("ml-status", message);
    text("ml-observed-label", synthetic ? "RTT terakhir sintetis" : "RTT terakhir terukur");
    text("ml-observed", last ? ms(last.latency_ms) : "–");
    text("ml-observed-note", !last ? "Probe aplikasi MQTT" : synthetic ? "Nilai sintetis terakhir" : last.probe_ok ? "Probe terakhir berhasil" : "Probe timeout; tidak diubah menjadi nol");
    text("ml-prediction", "–"); text("ml-ridge", "–");
    text("ml-ridge-note", "Dibandingkan dengan dua baseline");
    text("ml-prediction-note", model ? "Menunggu data terbaru" : "Model belum dilatih");
    $("ml-warning").hidden = true;
    const stale = !synthetic && (!connected || !last || staleDeviceIds.has(last.device_id) || Date.now() - last.sent_at_ms > Math.max(30000, last.interval_s * 3000));
    if (model && last && !stale) {
      const result = M.forecast(model, rows);
      if (result.status === "ready") {
        text("ml-prediction", ms(result.prediction_ms));
        text("ml-ridge", ms(result.ml_prediction_ms));
        text("ml-ridge-note", synthetic ? "Model dilatih dari data sintetis" : "Model dilatih dari sesi perangkat ini");
        text("ml-prediction-note", `${names[result.method] || result.method} · sampel berikutnya, interval nominal ${result.horizon_s} dtk`);
        if (result.prediction_ms > 500) {
          text("ml-warning", "Peringatan berbasis aturan: prediksi RTT > 500 ms. Ambang proyek ini bukan model deteksi anomali dan bukan kepastian koneksi buruk.");
          $("ml-warning").hidden = false;
        }
      } else text("ml-prediction-note", result.reason || "Window belum memenuhi syarat prediksi.");
    } else if (model && stale) text("ml-prediction-note", "Prediksi dijeda: perangkat terputus atau data sudah tidak aktif.");
    renderEvaluation(report);
  }
  function reset() {
    generation++; groups.clear(); models.clear(); reports.clear();
    selected = ""; selectedMapDevice = null; connected = false; synthetic = false; busy = false;
    staleDeviceIds = new Set(); message = "Model belum dilatih."; render();
  }
  function download(data, filename, type) {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = node("a"); a.href = url; a.download = filename;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportData() {
    const rows = current(); if (!rows.length) return;
    const columns = ["mode", "project_id", "schema_version", "device_id", "boot_id", "sequence", "source", "broker_endpoint", "sent_at_ms", "received_at_ms", "interval_s", "latency_type", "probe_ok", "probe_count", "latency_ms", "latency_mean_ms", "latency_std_ms", "success_pct", "accel_rms", "accel_mode", "accel_available", "gyro_rms_rad_s", "gyro_available", "rotation_total_rad", "sensor_window_ms"];
    const csv = [columns.join(","), ...rows.map((row) => columns.map((column) => C.csvCell(column === "mode" ? synthetic ? "contoh-lokal" : "pengukuran-perangkat" : row[column])).join(","))].join("\r\n");
    download("\ufeff" + csv, `sigheat-ml-${synthetic ? "SINTETIS" : "PERANGKAT"}-${rows[0].device_id}.csv`, "text/csv;charset=utf-8");
  }
  $("ml-device").addEventListener("change", () => { selected = $("ml-device").value; message = models.has(selected) ? "Model sesi perangkat dimuat." : "Model belum dilatih untuk sesi ini."; render(); });
  $("ml-train").addEventListener("click", () => {
    if (!M || busy || current().length < M.MIN_ROWS) return;
    const rows = current().map((row) => ({ ...row })), key = selected, task = ++generation;
    busy = true; message = "Melatih model dan menghitung galat pada data validasi serta uji…"; render();
    setTimeout(() => {
      if (task !== generation) return;
      try {
        const result = M.train(rows);
        if (task !== generation) return;
        models.set(key, result.model); reports.set(key, result.report);
        message = synthetic ? "Latihan selesai pada data sintetis. Hasil ini hanya untuk demonstrasi alur ML." : "Latihan selesai. Evaluasi di bawah berasal dari sesi ini; uji kembali pada sesi baru untuk menilai generalisasi.";
      } catch (error) { message = "Belum dapat melatih: " + String(error.message || error); }
      busy = false; render();
    }, 30);
  });
  $("ml-demo").addEventListener("click", () => {
    if (!M || busy) return;
    callbacks.onDemo?.();
    reset(); synthetic = true;
    for (const row of M.generateDemoRows()) addRow(row);
    message = "Data sintetis siap. Klik Latih & evaluasi untuk menjalankan regresi dan pembanding. Tidak ada pesan MQTT yang dikirim.";
    render();
  });
  $("ml-leave-demo").addEventListener("click", () => reset());
  $("ml-export-data").addEventListener("click", exportData);
  $("ml-export-model").addEventListener("click", () => {
    const model = models.get(selected); if (model) download(JSON.stringify(model, null, 2) + "\n", `sigheat-model-${model.provenance}.json`, "application/json");
  });
  $("ml-export-report").addEventListener("click", () => {
    const report = reports.get(selected); if (report) download(JSON.stringify(report, null, 2) + "\n", `sigheat-evaluation-${report.provenance}.json`, "application/json");
  });
  root.SigHeatMLPanel = {
    reset,
    configure(value) { callbacks = value || {}; },
    ingest(row) {
      if (!M || row.source === "demo") return;
      if (synthetic) reset();
      addRow(row);
    },
    updateSelection(info) {
      connected = !!info.connected;
      staleDeviceIds = new Set(info.staleDeviceIds || []);
      if (!synthetic && info.selected && info.selected !== selectedMapDevice) {
        const found = latestGroups().find((item) => item.last.device_id === info.selected);
        if (found) selected = found.key;
      }
      selectedMapDevice = info.selected;
      render();
    },
  };
  render();
})(window);
