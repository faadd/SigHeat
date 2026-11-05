#!/usr/bin/env node
"use strict";
const fs = require("node:fs"), path = require("node:path");
const Clusters = require("../assets/clusters.js");
const root = path.join(__dirname, "..");
const model = Clusters.train(Clusters.generateDemoRows());
const source = path.join(root, "assets/clusters.js"), text = fs.readFileSync(source, "utf8");
const marker = /  \/\/ BEGIN GENERATED DEFAULT:[\s\S]*?  \/\/ END GENERATED DEFAULT/;
if (!marker.test(text)) throw new Error("Penanda default klaster tidak ditemukan.");
fs.writeFileSync(source, text.replace(marker,
  "  // BEGIN GENERATED DEFAULT: regenerate with node scripts/build-cluster-default.cjs.\n  const DEFAULT_MODEL = " + JSON.stringify(model) + ";\n  // END GENERATED DEFAULT"));
fs.mkdirSync(path.join(root, "models"), { recursive: true });
fs.writeFileSync(path.join(root, "models/default-clusters.json"), JSON.stringify(model, null, 2) + "\n");
console.log(JSON.stringify({ model_id: model.model_id, provenance: model.provenance, rows: model.trained_rows,
  cluster_counts: model.counts, inertia: model.inertia, note: "Model bawaan ini SINTETIS. Bukan hasil pengukuran jaringan kelompok." }, null, 2));
