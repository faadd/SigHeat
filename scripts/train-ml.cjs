#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const ML = require("../assets/ml.js");
const NUMERIC = new Set(["schema_version", "sequence", "sent_at_ms", "interval_s", "latency_ms", "latency_mean_ms", "latency_std_ms", "success_pct", "probe_count", "accel_rms", "gyro_rms_rad_s", "rotation_total_rad", "accel_samples", "gyro_samples", "sensor_window_ms", "gyro_covered_ms", "latitude", "longitude", "accuracy_m", "location_at_ms", "received_at_ms"]);
const BOOLEAN = new Set(["probe_ok", "accel_available", "gyro_available"]);
function parseCSV(text) {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > 20 * 1024 * 1024) throw new Error("CSV maksimal 20 MiB.");
  text = text.replace(/^\uFEFF/, "");
  const table = []; let row = [], field = "", quoted = false, endedQuote = false;
  const pushField = () => { row.push(field); field = ""; endedQuote = false; };
  const pushRow = () => { pushField(); if (row.some((v) => v !== "")) table.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; endedQuote = true; }
      else field += c;
    } else if (c === '"') {
      if (field !== "" || endedQuote) throw new Error("Format kutipan CSV tidak valid.");
      quoted = true;
    } else if (c === ",") pushField();
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; pushRow(); }
    else { if (endedQuote) throw new Error("Karakter sesudah kutipan CSV tidak valid."); field += c; }
  }
  if (quoted) throw new Error("Kutipan CSV belum ditutup.");
  if (field !== "" || row.length || endedQuote) pushRow();
  if (table.length < 2) throw new Error("CSV memerlukan header dan data.");
  const header = table.shift();
  if (new Set(header).size !== header.length || header.some((v) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(v))) throw new Error("Header CSV duplikat atau tidak valid.");
  const required = ["device_id", "boot_id", "sequence", "source", "broker_endpoint", "sent_at_ms", "interval_s", "latency_ms", "probe_ok", "success_pct", "accel_mode"];
  if (required.some((key) => !header.includes(key))) throw new Error("Kolom CSV belum lengkap. Gunakan Ekspor dataset ML, bukan ekspor versi lama; perlu " + required.join(", ") + ".");
  return table.map((cells, i) => {
    if (cells.length !== header.length) throw new Error(`Baris CSV ${i + 2}: jumlah kolom berbeda dari header.`);
    const item = Object.create(null);
    header.forEach((key, j) => {
      const value = cells[j];
      if (NUMERIC.has(key)) {
        if (value === "") item[key] = null;
        else {
          if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value))) throw new Error(`Baris CSV ${i + 2}: ${key} bukan angka valid.`);
          item[key] = Number(value);
        }
      } else if (BOOLEAN.has(key)) {
        if (!/^(true|false)$/i.test(value)) throw new Error(`Baris CSV ${i + 2}: ${key} harus true atau false.`);
        item[key] = value.toLowerCase() === "true";
      } else item[key] = value;
    });
    return item;
  });
}
function main(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === "--allow-synthetic") args.allowSynthetic = true;
    else if (key === "--context") args.context = true;
    else if (key === "--help" || key === "-h") {
      console.log("node scripts/train-ml.cjs --input dataset.csv|dataset.json --output models/session [--context] [--allow-synthetic]\nTanpa --context: satu aliran termasuk boot. Dengan --context: beberapa boot dalam proyek/perangkat/sumber/broker/interval/mode sensor yang sama; jendela tidak melintasi boot. Minimal 120 telemetri. Data sintetis memerlukan --allow-synthetic.");
      return;
    } else if (["--input", "--output"].includes(key) && argv[i + 1] && !argv[i + 1].startsWith("--")) args[key.slice(2)] = argv[++i];
    else throw new Error(`Argumen tidak dikenal/tidak lengkap: ${key}. Gunakan --help.`);
  }
  if (!args.input || !args.output) throw new Error("Wajib --input dan --output. Gunakan --help.");
  if (fs.statSync(args.input).size > 20 * 1024 * 1024) throw new Error("Dataset maksimal 20 MiB.");
  const text = fs.readFileSync(args.input, "utf8");
  let rows;
  if (path.extname(args.input).toLowerCase() === ".json") {
    const parsed = JSON.parse(text);
    rows = Array.isArray(parsed) ? parsed : parsed.rows;
  } else rows = parseCSV(text);
  rows = args.context ? ML.prepareContextRows(rows) : ML.prepareRows(rows);
  if (rows[0].source === "demo" && !args.allowSynthetic) throw new Error("Data contoh/sintetis ditolak secara default. Tambahkan --allow-synthetic hanya untuk demonstrasi.");
  const result = args.context ? ML.trainContexts(rows) : ML.train(rows);
  fs.mkdirSync(args.output, { recursive: true });
  fs.writeFileSync(path.join(args.output, "model.json"), JSON.stringify(result.model, null, 2) + "\n");
  fs.writeFileSync(path.join(args.output, "report.json"), JSON.stringify(result.report, null, 2) + "\n");
  console.log(JSON.stringify({ provenance: result.report.provenance, model_format: result.model.format,
    selected_predictor: result.report.selected_predictor,
    examples: result.report.examples, test: result.report.test,
    output: path.resolve(args.output), note: result.report.note }, null, 2));
}
if (require.main === module) {
  try { main(); } catch (error) { console.error("Gagal melatih:", error.message); process.exitCode = 1; }
}
module.exports = { parseCSV, main };
