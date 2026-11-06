'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const Client = require('../assets/central-client.js'), Charts = require('../assets/central-ui.js');
const M = require('../assets/ml.js'), K = require('../assets/clusters.js'), DEFAULT = require('../assets/default-model.js');
const clone = o => JSON.parse(JSON.stringify(o));
const key = JSON.stringify(['test','hp-a','browser','wss://example.invalid/mqtt',5,'linear']);
const qkey = JSON.stringify(['test','browser','wss://example.invalid/mqtt',5]);
function model(revision=1,method='ridge') { return {schema:'sigheat-central-models-v1',revision,generated_at_ms:1700000000000+revision,project_id:'test',frozen_clusters:K.defaultModel(),profiles:[{context_key:key,model:clone(DEFAULT),method}],clusters:[{context_key:qkey,model:K.defaultModel()}],frozen_ridge:clone(DEFAULT)}; }
function release(bundle,version='pub1') { const body=JSON.stringify(bundle), sha256=crypto.createHash('sha256').update(body).digest('hex');return {body,manifest:{schema:'sigheat-model-manifest-v1',version,artifact:'releases/'+version+'.json',sha256,bytes:Buffer.byteLength(body)}}; }
function server(initial) { let current=initial,fail=false;return {set(r){current=r;},fail(v=true){fail=v;},async fetch(url){if(fail)throw new Error('offline');return {ok:true,status:200,headers:{get(){return null;}},text:async()=>url.endsWith('latest.json')?JSON.stringify(current.manifest):current.body};}}; }
function memory(){const values=new Map();return {values,getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};}
function rows(){return M.generateDemoRows(10).map((r,i)=>({...r,mode:'pengukuran-perangkat',project_id:'test',device_id:'hp-a',source:'browser',broker_endpoint:'wss://example.invalid/mqtt',boot_id:'test-boot',sequence:i+1}));}

test('two clients adopt the same complete verified package and infer exactly like shared engine',async()=>{
 const s=server(release(model())), opts={manifestURL:'https://central.invalid/api/models/latest.json',fetch:s.fetch,crypto:crypto.webcrypto};
 const a=Client.create(opts),b=Client.create(opts);await Promise.all([a.ready,b.ready]);await Promise.all([a.sync(),b.sync()]);
 assert.equal(a.status().version,b.status().version);assert.equal(a.status().revision,1);
 const input=rows().slice(0,6);for(const row of input){a.ingest(row);b.ingest(row);}const row=input.at(-1),expected=M.forecastContext(DEFAULT,input);
 assert.equal(a.forecast(row).prediction_ms,expected.prediction_ms);assert.equal(a.forecast(row).prediction_ms,b.forecast(row).prediction_ms);
 assert.deepEqual(a.classify(row),K.classify(K.defaultModel(),row));assert.equal(a.ingest(row).accepted,false);
 s.set(release(model(2,'moving_average'),'pub2'));await a.sync();assert.equal(a.forecast(row).method,'moving_average');assert.equal(a.forecast(row).prediction_ms,expected.moving_average_ms);assert.equal(b.status().revision,1);await b.sync();assert.equal(b.status().revision,2);
});

test('invalid checksum/schema/features/context and partial updates retain previous atomic model',async()=>{
 const storage=memory(),s=server(release(model())),c=Client.create({manifestURL:'https://central.invalid/api/models/latest.json',fetch:s.fetch,storage,crypto:crypto.webcrypto});await c.ready;await c.sync();
 const before=c.bundle();const corrupt=release(model(2),'bad-hash');corrupt.body+=' ';s.set(corrupt);assert.equal(await c.sync(),false);assert.deepEqual(c.bundle(),before);
 for(const modify of [b=>b.schema='unknown',b=>b.frozen_ridge.features[0]='wrong',b=>b.profiles[0].context_key=JSON.stringify(['test','hp-a','browser','wss://example.invalid/mqtt',5,'invalid']),b=>b.clusters[0].model.centroids[0][0]=Infinity,b=>b.profiles.push(clone(b.profiles[0]))]){
  const b=model(2);modify(b);s.set(release(b,'invalid'));assert.equal(await c.sync(),false);assert.deepEqual(c.bundle(),before);
 }
 assert.equal(c.status().source,'cache');assert.match(c.status().error,/gagal/);assert.equal(storage.values.size,1);
});

test('cache survives offline reopen; official rollback publication can reference older model revision',async()=>{
 const storage=memory(),s=server(release(model(2),'new')),opts={manifestURL:'https://central.invalid/api/models/latest.json',fetch:s.fetch,storage,crypto:crypto.webcrypto};
 const c=Client.create(opts);await c.ready;await c.sync();s.fail();const reopened=Client.create(opts);await reopened.ready;assert.equal(reopened.status().source,'cache');assert.equal(reopened.status().stale,true);await reopened.sync();assert.equal(reopened.bundle().revision,2);
 s.fail(false);s.set(release(model(1),'rollback-3'));assert.equal(await reopened.sync(),true);assert.equal(reopened.status().version,'rollback-3');assert.equal(reopened.bundle().revision,1);
});

test('manifest cannot send read token to another origin or traverse paths',()=>{
 const m=release(model()).manifest;for(const artifact of ['https://evil.invalid/a.json','../secrets.json','releases/../x.json','//evil/x.json','releases/a.json?token=x'])assert.equal(Client.validateManifest({...m,artifact}),false);
 assert.throws(()=>Client.safeURL('https://user:password@service.invalid'));assert.equal(Client.context(JSON.stringify(['test','hp','demo','wss://example.invalid/mqtt',5,'linear'])),null);
});

test('inference waits for six consecutive real rows, preserves timeout null and never trains',()=>{
 const c=Client.create({crypto:crypto.webcrypto});const input=rows();for(const r of input.slice(0,5))c.ingest(r);assert.notEqual(c.forecast(input[4]).status,'ready');c.ingest(input[5]);assert.equal(c.forecast(input[5]).status,'ready');
 const timeout={...input[6],probe_ok:false,latency_ms:null};c.ingest(timeout);assert.notEqual(c.forecast(timeout).status,'ready');assert.equal(c.classify(timeout).quality,'unknown');assert.equal(c.ingest({...input[7],source:'demo'}).accepted,false);assert.equal(c.maintain,undefined);assert.equal(c.exportRows(timeout).at(-1).latency_ms,null);
});

test('exported predictions reproduce same-target MAE including zero and gaps are not scored as zero',()=>{
 const predictions=[{id:'a',context_key:key,status:'valid',actual_ms:10,active_ms:12,frozen_ms:20,persistence_ms:9,moving_average_ms:8,target_at_ms:100,model_id:'m1'},{id:'b',context_key:key,status:'valid',actual_ms:0,active_ms:4,frozen_ms:10,persistence_ms:0,moving_average_ms:2,target_at_ms:200,model_id:'m2'},{id:'timeout',context_key:key,status:'excluded',actual_ms:null,active_ms:0,frozen_ms:0,persistence_ms:0,moving_average_ms:0,target_at_ms:300}];
 assert.deepEqual(Charts.recomputeMAE(predictions),{n:2,mae_ms:{active:3,frozen:10,persistence:.5,moving_average:2}});
 const hist={predictions,blocks:[{id:'block',context_key:key,start_ms:100,end_ms:200,n:24,model_ids:['m1','m2'],mixed_versions:true}],candidates:[{context_key:qkey,algorithm:'kmeans',status:'rejected',created_at_ms:150}]};
 const f=Charts.filterHistory(hist,{context:key,from:100,through:200});assert.equal(f.predictions.length,2);assert.equal(f.candidates.length,1);assert.equal(f.blocks.length,1);assert.equal(Charts.filterHistory(hist,{context:key,from:150}).blocks.length,0);
 const csv=Charts.exportCSV(hist,{timezone:'Asia/Jakarta',window:6});assert.match(csv,/actual_ms,active_ms/);assert.match(csv,/Asia\/Jakarta/);assert.match(csv,/mixed_versions/);assert.match(csv,/"timeout"/);assert.doesNotMatch(csv,/NaN|undefined/);
 assert.equal(Charts.filterHistory(hist,{context:key,model:'m2'}).blocks.length,1);
});

 test('CSV audit selection includes every referenced target when a mixed-model block crosses a model filter',()=>{
  const history={predictions:[{id:'p1',context_key:key,model_id:'m1',target_at_ms:100,status:'valid'},{id:'p2',context_key:key,model_id:'m2',target_at_ms:200,status:'valid'}],blocks:[{id:'b1',context_key:key,model_ids:['m1','m2'],prediction_ids:['p1','p2'],start_ms:100,end_ms:200,n:2}],candidates:[],events:[]};
  const selected=Charts.exportSelection(history,{context:key,model:'m2'});
  assert.equal(selected.blocks.length,1);assert.equal(selected.predictions.length,2);assert.equal(selected.predictions[0].dependency_only,true);assert.equal(selected.predictions[1].dependency_only,undefined);
  const csv=Charts.exportCSV(selected);assert.match(csv,/dependency_only/);assert.match(csv,/"p1"/);assert.match(csv,/"p2"/);
});
