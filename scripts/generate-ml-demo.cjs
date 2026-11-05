#!/usr/bin/env node
"use strict";
const fs = require("node:fs"), path = require("node:path"), ML = require("../assets/ml.js");
const columns = ["schema_version", "mode", "project_id", "device_id", "boot_id", "sequence", "source", "latency_type", "broker_endpoint", "sent_at_ms", "interval_s", "latency_ms", "latency_mean_ms", "latency_std_ms", "success_pct", "probe_count", "probe_ok", "accel_rms", "accel_available", "accel_mode", "gyro_rms_rad_s", "gyro_available", "rotation_total_rad", "accel_samples", "gyro_samples", "sensor_window_ms", "gyro_covered_ms", "latitude", "longitude", "accuracy_m", "location_at_ms"];
function csv(rows) {
  const cell = (v) => v == null ? "" : /[",\r\n]/.test(String(v)) ? '"' + String(v).replaceAll('"', '""') + '"' : String(v);
  return [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
}
function main(argv = process.argv.slice(2)) {
  if (argv.length && !(argv.length === 2 && argv[0] === "--output")) throw new Error("Gunakan node scripts/generate-ml-demo.cjs [--output folder].");
  const output = argv[1] || path.join(__dirname, "..", "data"), rows = ML.generateDemoRows();
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, "demo-synthetic.csv"), csv(rows));
  fs.writeFileSync(path.join(output, "demo-synthetic.json"), JSON.stringify({ format: "sigheat-dataset-v1", provenance: "synthetic", seed: 240601,
    description: "Proses autoregresif buatan untuk menguji pipeline. Bukan pengukuran nyata dan bukan bukti akurasi lapangan.", rows }, null, 2) + "\n");
  console.log(`480 baris SINTETIS disimpan di ${path.resolve(output)}. Tidak berasal dari HP atau broker.`);
}
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { csv, main };
