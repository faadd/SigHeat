"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const M = require("../assets/ml.js");
const copy = (value) => JSON.parse(JSON.stringify(value));
function live(count = 480) {
  return M.generateDemoRows(count).map((row) => ({ ...row, mode: "pengukuran-perangkat", source: "browser",
    project_id: "project-real", device_id: "hp-a", boot_id: "boot-a", broker_endpoint: "wss://broker.example/mqtt" }));
}
test("persistent contexts exclude boot but keep device/runtime/broker/cadence/sensor mode", () => {
  const row = live(1)[0];
  assert.equal(M.contextKey(row), M.contextKey({ ...row, boot_id: "boot-b" }));
  for (const change of [{device_id:"hp-b"},{source:"termux"},{interval_s:10},{accel_mode:"gravity_removed"},{broker_endpoint:"wss://other.example/mqtt"}])
    assert.notEqual(M.contextKey(row), M.contextKey({...row,...change}));
});
test("cross-boot training keeps all sessions but never constructs windows across reboots", () => {
  const rows=live();
  for (let i=100;i<rows.length;i++) { rows[i].boot_id="boot-b"; rows[i].sequence=i-99; }
  const xs=M.buildContextExamples(rows);
  assert.equal(xs.length, rows.length-12);
  assert(!xs.some((x)=>x.input_start_ms<rows[100].sent_at_ms && x.target_ms>=rows[100].sent_at_ms));
  const result=M.trainContexts(rows);
  assert(M.validateContextModel(result.model));
  assert.equal(result.model.provenance,"measured");
  assert.equal(M.forecastContext(result.model,rows.slice(-6)).status,"ready");
});
test("held-out scoped test data cannot select alpha or affect coefficients",()=>{
  const rows=live(), changed=copy(rows);
  for(let i=384;i<changed.length;i++) changed[i].latency_ms=5000+i;
  const a=M.trainContexts(rows).model,b=M.trainContexts(changed).model;
  assert.deepEqual(a.coefficients,b.coefficients);assert.deepEqual(a.centers,b.centers);
  assert.equal(a.alpha,b.alpha);assert.notDeepEqual(a.test,b.test);
});
test("context model explicitly rejects transfer to another device and boot warmup remains real",()=>{
  const rows=live(), model=M.trainContexts(rows).model;
  const other=rows.slice(-6).map((r)=>({...r,device_id:"hp-b"}));
  assert.equal(M.forecastContext(model,other).status,"incompatible");
  const boot=rows.slice(-6).map((r,i)=>i>=3?{...r,boot_id:"new-boot",sequence:i-2}:r);
  assert.equal(M.forecastContext(model,boot).status,"unavailable");
});
test("bootstrap is a trained numeric artifact with explicit experimental transfer provenance",()=>{
  const model=require("../assets/default-model.js");
  assert(M.validateContextModel(model));assert.equal(model.scope,"bootstrap");
  assert.equal(model.provenance,"synthetic");assert.equal(model.context_key,null);
  const result=M.forecastContext(model,live(6));
  assert.equal(result.status,"ready");assert.equal(result.method,"ridge");
  assert.match(result.warning,/sintetis/);
  assert.equal(M.forecastContext(model,live(5)).status,"warming_up");
});
test("scoped data and model validation rejects duplicate rows, mixed contexts, and malformed bootstrap",()=>{
  const rows=live(), model=require("../assets/default-model.js");
  assert.throws(()=>M.prepareContextRows([rows[0],rows[0]]),/meningkat/);
  assert.throws(()=>M.prepareContextRows([rows[0],{...rows[1],source:"termux"}]),/mencampur/);
  assert.throws(()=>M.trainBootstrap(rows),/sintetis/);
  for(const changed of [{...model,provenance:"measured"},{...model,context_key:"[]"},{...model,scales:[1]},
    {...model,applicability:{...model.applicability,interval_max_s:600}}]) assert.equal(M.validateContextModel(changed),false);
  const altered=copy(model);altered.coefficients[0]+=1;
  assert.equal(M.validateContextModel(altered),false);
  assert.equal(M.validateContextModel({...model,scope:"context",context_key:M.contextKey(rows[0]),provenance:"measured"}),false);
});
test("CLI --context supports multiple boots while legacy mode and synthetic guard remain strict",()=>{
  const fs=require("node:fs"),path=require("node:path"),{spawnSync}=require("node:child_process");
  const dir=fs.mkdtempSync(path.join(__dirname,".ridge-scope-"));
  try {
    const rows=live();for(let i=240;i<rows.length;i++){rows[i].boot_id="boot-b";rows[i].sequence=i-239;}
    const input=path.join(dir,"rows.json"),output=path.join(dir,"model");fs.writeFileSync(input,JSON.stringify(rows));
    const script=path.join(__dirname,"../scripts/train-ml.cjs");
    const args=[script,"--input",input,"--output",output];
    const old=spawnSync(process.execPath,args,{encoding:"utf8"});assert.equal(old.status,1);assert.match(old.stderr,/mencampur/);
    const scoped=spawnSync(process.execPath,[...args,"--context"],{encoding:"utf8"});assert.equal(scoped.status,0,scoped.stderr);
    const model=JSON.parse(fs.readFileSync(path.join(output,"model.json"),"utf8"));
    assert(M.validateContextModel(model));assert.equal(model.scope,"context");
    fs.writeFileSync(input,JSON.stringify(M.generateDemoRows(240)));
    const rejected=spawnSync(process.execPath,[...args,"--context"],{encoding:"utf8"});assert.equal(rejected.status,1);assert.match(rejected.stderr,/sintetis/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test("scoped training normalization uses train data only and rejects timeouts as numeric targets",()=>{
  const rows=live(), changed=copy(rows);
  for(let i=288;i<384;i++) changed[i].accel_rms=999;
  const a=M.trainContexts(rows).model,b=M.trainContexts(changed).model;
  assert.deepEqual(a.centers,b.centers);assert.deepEqual(a.scales,b.scales);
  rows[50].probe_ok=false;rows[50].latency_ms=null;
  assert(!M.buildContextExamples(rows).some((x)=>x.target_sequence===51));
});
