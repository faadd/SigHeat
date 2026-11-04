#!/usr/bin/env node
"use strict";
const fs = require("node:fs"), path = require("node:path"), ML = require("../assets/ml.js");
const root = path.resolve(__dirname, "..");
const { model } = ML.trainBootstrap(ML.generateDemoRows(960, 240601));
const json = JSON.stringify(model, null, 2);
fs.mkdirSync(path.join(root, "models"), { recursive: true });
fs.writeFileSync(path.join(root, "models", "default-rtt.json"), json + "\n");
fs.writeFileSync(path.join(root, "assets", "default-model.js"),
  '/* Generated offline by scripts/build-default-model.cjs. SYNTHETIC bootstrap, not field validation. */\n' +
  '(function(root, factory) { const model = factory(); if (typeof module === "object" && module.exports) module.exports = model; else root.SigHeatDefaultModel = model; })(typeof globalThis !== "undefined" ? globalThis : this, function() { return ' + json + '; });\n');
console.log(JSON.stringify({ model_id: model.model_id, provenance: model.provenance, rows: model.report.rows,
  note: "Numerical model written offline. Browser startup only loads it; no training is run at load." }, null, 2));
