#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const Learning = require("../assets/learning.js");

function buildSeed(input) {
  const manager = Learning.create({ storage: null });
  const result = manager.importState(input);
  if (!result.ok) throw new Error(result.reason);
  const state = manager.exportState();
  const measuredRidge = state.profiles.filter((p) => p.model.provenance === "measured").length;
  const measuredClusters = state.qualityProfiles.filter((p) => p.model.provenance === "measured").length;
  if (!measuredRidge && !measuredClusters)
    throw new Error("Cadangan belum memiliki model dari pengukuran yang aktif. Biarkan pembelajaran otomatis dan evaluasi berjalan, lalu ekspor lagi. Model awal sintetis tidak disebut hasil latihan kelompok.");
  // Only canonical exported fields are embedded; input extras such as GPS or
  // credentials are deliberately not copied into the public browser asset.
  const source = "/* Generated team learning seed. Context-bound models; no GPS or credentials. */\n" +
    "(function(root,factory){const seed=factory();if(typeof module===\"object\"&&module.exports)module.exports=seed;else root.SigHeatLearningSeed=seed;})(typeof globalThis!==\"undefined\"?globalThis:this,function(){return " +
    JSON.stringify(state, null, 2) + ";});\n";
  return { source, measuredRidge, measuredClusters };
}

function main(args = process.argv.slice(2)) {
  let input, output = path.join(__dirname, "..", "assets", "learning-seed.js");
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--help" || args[i] === "-h") {
      console.log("node scripts/build-learning-seed.cjs --input sigheat-pembelajaran.json [--output assets/learning-seed.js]\nMengemas model aktif hasil pengukuran sebagai bawaan dashboard. Cadangan lokal browser yang valid tetap lebih diutamakan.");
      return;
    }
    if (!["--input", "--output"].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith("--"))
      throw new Error("Argumen tidak valid. Gunakan --help.");
    if (args[i] === "--input") input = args[++i];
    else output = args[++i];
  }
  if (!input) throw new Error("Wajib --input cadangan JSON dari dashboard.");
  if (fs.statSync(input).size > 8 * 1024 * 1024) throw new Error("Cadangan maksimal 8 MiB.");
  const built = buildSeed(fs.readFileSync(input, "utf8"));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, built.source);
  console.log(JSON.stringify({ output: path.resolve(output), measured_ridge: built.measuredRidge,
    measured_clusters: built.measuredClusters, note: "Commit aset ini agar dashboard memuat model kelompok. Konteks proyek, perangkat, broker, sumber, dan interval harus cocok. Metadata provenance bukan autentikasi asal data." }, null, 2));
}

if (require.main === module) {
  try { main(); } catch (error) { console.error("Gagal membuat model bawaan:", error.message); process.exitCode = 1; }
}
module.exports = { buildSeed, main };
