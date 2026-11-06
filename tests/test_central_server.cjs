'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),http=require('node:http');
const mqtt=require('mqtt');
const {Aedes}=require('aedes');
const {readConfig}=require('../server/config.cjs');
const {startCentral}=require('../server/index.cjs');
const {run}=require('../scripts/central-admin.cjs');
const {toCSV}=require('../server/http.cjs');
const M=require('../assets/ml.js'),Client=require('../assets/central-client.js');
const ROOT=path.resolve(__dirname,'..');
function temporary(t){const d=fs.mkdtempSync(path.join(os.tmpdir(),'sig-server-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;}
function config(dir,other={}){return readConfig({SIGHEAT_DATA_DIR:dir,SIGHEAT_PORT:'0',SIGHEAT_PROJECT_ID:'test',SIGHEAT_BROKER_ENDPOINT:'wss://example.invalid/mqtt',...other},ROOT);}
async function until(check){for(let i=0;i<400;i++){if(check())return;await new Promise(r=>setTimeout(r,10));}throw new Error('Timed out waiting for local test condition');}
function fakeRows(n){const start=Date.UTC(2026,10,6);return M.generateDemoRows(n).map((r,i)=>({...r,project_id:'test',device_id:'test-phone',source:'browser',mode:'pengukuran-perangkat',boot_id:'testboot',sent_at_ms:start+i*5000,latency_ms:100+i*2,latency_mean_ms:100+i*2,latitude:null,longitude:null,accuracy_m:null,location_at_ms:null}));}

test('central config rejects exposed unauthenticated API and credential URLs',()=>{
  assert.throws(()=>config('/tmp/test',{SIGHEAT_HOST:'0.0.0.0'}),/READ_TOKEN/);
  assert.throws(()=>config('/tmp/test',{SIGHEAT_BROKER_ENDPOINT:'wss://user:secret@example.com/mqtt'}),/BROKER_ENDPOINT/);
  assert.throws(()=>config('/tmp/test',{SIGHEAT_ALLOWED_ORIGINS:'*'}),/ORIGINS/);
  assert.throws(()=>config('/tmp/test',{SIGHEAT_DATA_DIR:'assets/private'}),/DATA_DIR/);
  assert.throws(()=>config('/tmp/test',{SIGHEAT_PUBLIC_URL:'https://central.example.com'}),/READ_TOKEN/);
});

test('read API authenticates, denies private files/origins/rebinding and serves atomic model bytes',async t=>{
  const dir=temporary(t),token='read-test-token-12345678901234567890';
  const a=await startCentral(config(dir,{SIGHEAT_READ_TOKEN:token,SIGHEAT_ALLOWED_ORIGINS:'https://faadd.github.io'}),{connectMqtt:false});t.after(()=>a.close());
  const base='http://127.0.0.1:'+a.server.address().port,headers={Authorization:'Bearer '+token};
  assert.equal((await fetch(base+'/api/status')).status,401);
  assert.equal((await fetch(base+'/api/status',{headers:{...headers,Origin:'https://evil.invalid'}})).status,403);
  const allowed=await fetch(base+'/api/status',{headers:{...headers,Origin:'https://faadd.github.io'}});
  assert.equal(allowed.status,200);assert.equal(allowed.headers.get('access-control-allow-origin'),'https://faadd.github.io');
  assert.equal((await fetch(base+'/api/status',{method:'POST',headers})).status,405);
  for(const file of ['/.env.central','/private-data/sigheat.sqlite','/server/config.cjs','/package.json','/data/demo-synthetic.csv','/assets/../../.env.central'])assert.equal((await fetch(base+file)).status,404,file);
  assert.equal((await fetch(base+'/api/models/releases/missing.json',{headers})).status,404);
  assert.equal((await fetch(base+'/api/history?from=invalid',{headers})).status,400);
  const manifest=await(await fetch(base+'/api/models/latest.json',{headers})).json();
  const model=await(await fetch(base+'/api/models/'+manifest.artifact,{headers})).text();
  assert.equal(Buffer.byteLength(model),manifest.bytes);assert.equal(require('crypto').createHash('sha256').update(model).digest('hex'),manifest.sha256);
  assert.ok((await(await fetch(base+'/assets/central-config.js')).text()).includes("mode: 'central'"));
  const rebinding=await new Promise((resolve,reject)=>{const req=http.get(base+'/api/status',{headers:{Host:'attacker.invalid:'+a.server.address().port,Origin:'http://attacker.invalid:'+a.server.address().port}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});
  assert.equal(rebinding,403);
  const exported=await(await fetch(base+'/api/export?format=json',{headers})).json();
  assert.equal(exported.schema,'sigheat-audit-export-v1');assert.ok(Array.isArray(exported.history.publicationEvents));
  assert.equal(JSON.stringify(exported).includes(token),false);
});

test('local MQTT collector trains without dashboard, two clients agree, hot backup and restart preserve evidence',async t=>{
  const dir=temporary(t),broker=await Aedes.createBroker(),tcp=net.createServer(broker.handle);
  await new Promise(r=>tcp.listen(0,'127.0.0.1',r));
  const mqttUrl='mqtt://127.0.0.1:'+tcp.address().port;
  const cfg=config(dir,{SIGHEAT_MQTT_URL:mqttUrl});
  const rows=fakeRows(150);let now=rows[0].sent_at_ms+10;
  let a=await startCentral(cfg,{now:()=>now});
  const publisher=mqtt.connect(mqttUrl,{reconnectPeriod:0});
  t.after(async()=>{await new Promise(r=>publisher.end(true,{},r));await a.close();await new Promise(r=>broker.close(r));await new Promise(r=>tcp.close(r));});
  await until(()=>a.broker.subscribed&&publisher.connected);
  // These deterministic fixtures exercise transport and learning; not field measurements.
  for(let i=0;i<rows.length;i++){
    now=rows[i].sent_at_ms+10;
    await new Promise((resolve,reject)=>publisher.publish('sigheat/test/edge/test-phone/telemetry',JSON.stringify(rows[i]),{qos:1},e=>e?reject(e):resolve()));
    await until(()=>a.engine.snapshot().stats.accepted===i+1);
  }
  const status=a.getStatus(),before=a.engine.history();
  assert.equal(status.stats.accepted,150);assert.ok(before.candidates.some(c=>c.algorithm==='ridge'));assert.ok(before.blocks.length>=5);
  assert.ok(before.predictions.filter(p=>p.status==='valid').every(p=>p.created_at_ms<p.target_at_ms));
  const base='http://127.0.0.1:'+a.server.address().port;
  const one=Client.create({manifestURL:base+'/api/models/latest.json'}),two=Client.create({manifestURL:base+'/api/models/latest.json'});
  await Promise.all([one.sync(),two.sync()]);
  assert.equal(one.status().version,two.status().version);assert.equal(one.status().error,null);
  const snapshot=path.join(dir,'hot-backup.sqlite');
  await run(['backup','--output',snapshot],cfg);assert.ok(fs.statSync(snapshot).size>0);
  await assert.rejects(run(['restore','--input',snapshot],cfg),/Hentikan/);
  await a.close();a=await startCentral(cfg,{now:()=>now});await until(()=>a.broker.subscribed);
  assert.deepEqual(a.engine.history().blocks,before.blocks);
  const accepted=a.engine.snapshot().stats.accepted;
  await new Promise((resolve,reject)=>publisher.publish('sigheat/test/edge/test-phone/telemetry',JSON.stringify(rows.at(-1)),{qos:1},e=>e?reject(e):resolve()));
  await until(()=>a.engine.snapshot().stats.duplicates===1);
  assert.equal(a.engine.snapshot().stats.accepted,accepted);
  await a.close();await run(['restore','--input',snapshot],cfg);
  a=await startCentral(cfg,{now:()=>now,connectMqtt:false});assert.equal(a.engine.snapshot().stats.accepted,150);
});

test('CSV exports keep missing values empty and neutralize spreadsheet formulas',()=>{
  const csv=toCSV([{actual_ms:null,mae_ms:0,label:'=malicious()',metadata:{n:24}}]);
  assert.ok(csv.includes('"","0","\'=malicious()"'));assert.ok(csv.includes('""n"":24'));
});
