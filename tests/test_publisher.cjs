'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {ArtifactStore,sanitizeBundle,hash}=require('../server/artifacts.cjs');
const {Publisher}=require('../server/publisher.cjs');
const {buildPublic}=require('../scripts/build-public.cjs');
const DEFAULT=require('../models/default-rtt.json');
const K=require('../assets/clusters.js');
const key=JSON.stringify(['ABC','hp-a','browser','wss://broker.example/mqtt',5,'linear']);
const qkey=JSON.stringify(['ABC','browser','wss://broker.example/mqtt',5]);
const bundle=(method='ridge')=>({schema:'sigheat-central-models-v1',revision:1,generated_at_ms:100000,profiles:[{context_key:key,model:DEFAULT,method}],clusters:[{context_key:qkey,model:K.defaultModel()}],frozen_ridge:DEFAULT});
function dir(t){const d=fs.mkdtempSync(path.join(os.tmpdir(),'sigheat-publish-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;}
function githubMock() {
  const commits=new Map(),trees=new Map(),files=new Map(),calls=[];let head='a'.repeat(40),counter=0,failPatch=0,failDispatch=0,dispatches=0,patches=0,pages=null;
  const sha=()=> (++counter).toString(16).padStart(40,'0');
  function response(status,value){return new Response(status===204?null:JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});}
  const fetch=async(url,options={})=>{
    const u=new URL(url),method=options.method||'GET';calls.push({url,method,headers:options.headers,body:options.body});
    if(u.hostname==='demo.github.io') {
      assert.equal(options.headers?.Authorization,undefined);
      if(!pages)return response(404,{});
      if(u.pathname.endsWith('/models/latest.json'))return response(200,pages.manifest);
      if(u.pathname.endsWith('/models/'+pages.manifest.artifact))return new Response(pages.bytes,{status:200});
      return response(404,{});
    }
    assert.equal(u.origin,'https://api.github.com');assert.equal(options.headers.Authorization,'Bearer private-token');
    const route=u.pathname.replace('/repos/owner/repo',''),body=options.body?JSON.parse(options.body):null;
    if(route==='/git/ref/heads/main')return response(200,{object:{sha:head}});
    if(route.startsWith('/contents/')){const file=decodeURIComponent(route.slice('/contents/'.length));return files.has(file)?response(200,{type:'file',encoding:'base64',content:Buffer.from(files.get(file)).toString('base64')}):response(404,{});}
    if(method==='GET'&&route.startsWith('/git/commits/'))return response(200,{tree:{sha:'b'.repeat(40)}});
    if(method==='POST'&&route==='/git/trees'){const s=sha();trees.set(s,body.tree);return response(201,{sha:s});}
    if(method==='POST'&&route==='/git/commits'){const s=sha();commits.set(s,body);return response(201,{sha:s});}
    if(method==='PATCH'&&route==='/git/refs/heads/main'){
      assert.equal(body.force,false);patches++;
      if(failPatch-- >0){head='c'.repeat(40);return response(422,{message:'conflict private-token'});}
      const commit=commits.get(body.sha);assert.equal(commit.parents[0],head);for(const f of trees.get(commit.tree))files.set(f.path,f.content);head=body.sha;return response(200,{object:{sha:head}});
    }
    if(method==='POST'&&route==='/actions/workflows/pages.yml/dispatches'){dispatches++;if(failDispatch-- >0)return response(503,{message:'private-token must not leak'});assert.equal(body.ref,'main');assert.ok(body.inputs.model_version);return response(204,null);}
    throw Error('Unexpected mock request '+method+' '+url);
  };
  return {fetch,calls,files,set failPatch(n){failPatch=n;},set failDispatch(n){failDispatch=n;},set pages(x){pages=x;},get patches(){return patches;},get dispatches(){return dispatches;}};
}
test('artifact allowlist strips raw telemetry and secrets, validates context and integrity, preserves frozen model',t=>{
  const d=dir(t),store=new ArtifactStore({directory:d,now:()=>123456});const raw=bundle();raw.rows=[{latitude:1,password:'secret'}];raw.profiles[0].token='secret';raw.frozen_ridge={...DEFAULT,token:'secret',report:{rows:['secret']}};
  const a=store.activate(raw),text=a.bytes.toString();assert.ok(!text.includes('secret'));assert.ok(!text.includes('latitude'));assert.ok(!text.includes('report'));
  assert.equal(a.manifest.sha256,hash(a.bytes));assert.equal(a.manifest.bytes,a.bytes.length);assert.equal(a.manifest.artifact,'releases/'+a.manifest.version+'.json');
  assert.equal(store.activate({...raw,generated_at_ms:999999,revision:99}).changed,false);
  assert.deepEqual(store.current().bytes,a.bytes);assert.equal(store.read('../publisher.json'),null);
  const wrong=bundle();wrong.profiles[0].context_key=JSON.stringify(['ABC','hp-a','demo','wss://broker.example/mqtt',5,'linear']);assert.throws(()=>sanitizeBundle(wrong));
  wrong.profiles[0].context_key=key;wrong.profiles[0].model={...DEFAULT,coefficients:[NaN,...DEFAULT.coefficients.slice(1)]};assert.throws(()=>sanitizeBundle(wrong));
});
test('rollback creates new publication identity pointing to immutable older model bytes',t=>{
  const store=new ArtifactStore({directory:dir(t),now:()=>123456});const a=store.activate(bundle()),b=store.activate(bundle('moving_average'));
  assert.notEqual(a.manifest.version,b.manifest.version);const r=store.rollback(a.manifest.version,'uji');
  assert.notEqual(r.manifest.version,a.manifest.version);assert.equal(r.manifest.artifact,a.manifest.artifact);assert.deepEqual(r.bytes,a.bytes);assert.equal(store.current().manifest.version,r.manifest.version);
});
test('publisher coalesces, atomically commits, dispatches explicitly and verifies Pages bytes',async t=>{
  const d=dir(t),store=new ArtifactStore({directory:path.join(d,'artifacts'),now:()=>123456}),mock=githubMock();let now=1000000;
  const publisher=new Publisher({stateDir:path.join(d,'queue'),repository:'owner/repo',token:'private-token',pagesBaseUrl:'https://demo.github.io/SigHeat',fetch:mock.fetch,now:()=>now,coalesceMs:60,retryBaseMs:10});
  const a=store.activate(bundle()),b=store.activate(bundle('moving_average'));assert.equal(publisher.enqueue(a),true);assert.equal(publisher.enqueue(b),true);
  await publisher.tick();assert.equal(mock.calls.length,0);now+=60;await publisher.tick();assert.equal(mock.patches,1);assert.equal(mock.dispatches,1);assert.equal(publisher.status().committed.version,b.manifest.version);assert.equal(publisher.status().deployed,null);
  mock.pages=b;now+=10;await publisher.tick();assert.equal(publisher.status().deployed.version,b.manifest.version);assert.equal(publisher.enqueue(b),false);
  const events=fs.readFileSync(path.join(d,'queue','publication-events.jsonl'),'utf8');assert.match(events,/superseded/);assert.match(events,/pages_verified/);assert.ok(!events.includes('private-token'));
  const history=publisher.history();assert.ok(history.length>=4);assert.equal(history[0].id,'publication-1');assert.ok(!JSON.stringify(history).includes('private-token'));
  const saved=fs.readFileSync(path.join(d,'queue','publisher.json'),'utf8');assert.ok(!saved.includes('private-token'));assert.ok(!saved.includes('Authorization'));
});
test('conflict retries new parent without force; dispatch retry survives restart without duplicate commits',async t=>{
  const d=dir(t),artifact=new ArtifactStore({directory:path.join(d,'artifacts'),now:()=>123456}).activate(bundle()),mock=githubMock();let now=1e6;mock.failPatch=1;mock.failDispatch=1;
  const opts={stateDir:path.join(d,'queue'),repository:'owner/repo',token:'private-token',fetch:mock.fetch,now:()=>now,coalesceMs:0,retryBaseMs:10};let p=new Publisher(opts);p.enqueue(artifact);await p.tick();assert.equal(p.status().current.phase,'queued');assert.equal(p.status().current.attempts,1);
  now+=10;await p.tick();assert.equal(p.status().current.phase,'committed');assert.equal(mock.patches,2);assert.equal(mock.dispatches,1);
  p=new Publisher(opts);now+=10;await p.tick();assert.equal(p.status().current.phase,'dispatched');assert.equal(mock.patches,2);assert.equal(mock.dispatches,2);
  assert.ok(!JSON.stringify(p.status()).includes('private-token'));
});
test('remote commit detection prevents duplicate commit after acknowledgement lost; retry limit visible',async t=>{
  const d=dir(t),artifact=new ArtifactStore({directory:path.join(d,'artifacts'),now:()=>123456}).activate(bundle()),mock=githubMock();let now=1e6;
  mock.files.set('models/latest.json',JSON.stringify(artifact.manifest));mock.files.set('models/'+artifact.manifest.artifact,artifact.bytes.toString());mock.failDispatch=10;
  const p=new Publisher({stateDir:path.join(d,'queue'),repository:'owner/repo',token:'private-token',fetch:mock.fetch,now:()=>now,coalesceMs:0,retryBaseMs:10,maxAttempts:2});p.enqueue(artifact);await p.tick();now+=10;await p.tick();assert.equal(p.status().current.phase,'failed');assert.equal(mock.patches,0);
  await p.tick();assert.equal(mock.dispatches,2);p.retry();assert.equal(p.status().current.phase,'committed');mock.failDispatch=0;await p.tick();assert.equal(p.status().current.phase,'dispatched');
});
test('disabled publisher retains queue and does not call network',async t=>{
  const d=dir(t),artifact=new ArtifactStore({directory:path.join(d,'artifacts'),now:()=>123456}).activate(bundle());
  const p=new Publisher({stateDir:path.join(d,'queue'),fetch:()=>assert.fail('network')});p.enqueue(artifact);await p.tick();assert.equal(p.status().enabled,false);assert.equal(p.status().queued.version,artifact.manifest.version);
});
test('static allowlist contains UI and validated models, excludes database, credentials and browser backups',t=>{
  const source=path.resolve(__dirname,'..'),project=dir(t),out=path.join(project,'tests','publisher-public-build');
  fs.copyFileSync(path.join(source,'index.html'),path.join(project,'index.html'));fs.copyFileSync(path.join(source,'dashboard.html'),path.join(project,'dashboard.html'));fs.cpSync(path.join(source,'assets'),path.join(project,'assets'),{recursive:true});
  fs.writeFileSync(path.join(project,'.env'),'GITHUB_TOKEN=private-token');fs.mkdirSync(path.join(project,'private-data'));fs.writeFileSync(path.join(project,'private-data','state.db'),'private');
  const dest=path.join(project,'public-dist');
  buildPublic({root:project,out:dest});assert.ok(fs.existsSync(path.join(dest,'dashboard.html')));assert.ok(fs.existsSync(path.join(dest,'assets','vendor','leaflet.js')));
  for(const name of ['private-data','server','data','docs','tests','node_modules','.env','README.md'])assert.equal(fs.existsSync(path.join(dest,name)),false);
  const m=JSON.parse(fs.readFileSync(path.join(dest,'models','latest.json'))),bytes=fs.readFileSync(path.join(dest,'models',m.artifact));assert.equal(hash(bytes),m.sha256);assert.equal(JSON.parse(bytes).profiles.length,0);assert.match(fs.readFileSync(path.join(dest,'assets','learning-seed.js'),'utf8'),/SigHeatLearningSeed=null/);
  assert.throws(()=>buildPublic({root:project,out:project}));assert.throws(()=>buildPublic({root:project,out}));
});
test('Pages version mismatch stops after bounded checks and corrupted immutable remote artifact is rejected',async t=>{
  const d=dir(t),store=new ArtifactStore({directory:path.join(d,'artifacts'),now:()=>123456}),artifact=store.activate(bundle()),mock=githubMock();let now=1e6;
  const p=new Publisher({stateDir:path.join(d,'queue'),repository:'owner/repo',token:'private-token',pagesBaseUrl:'https://demo.github.io/SigHeat',fetch:mock.fetch,now:()=>now,coalesceMs:0,retryBaseMs:10,maxAttempts:2});p.enqueue(artifact);await p.tick();
  mock.pages={...artifact,manifest:{...artifact.manifest,version:'model-old'}};now+=10;await p.tick();now+=10;await p.tick();assert.equal(p.status().current.phase,'failed');assert.equal(p.status().deployed,null);assert.match(p.status().current.error,/Pages belum/);
  const d2=dir(t),mock2=githubMock();mock2.files.set('models/latest.json',JSON.stringify(artifact.manifest));mock2.files.set('models/'+artifact.manifest.artifact,'corrupt');
  const p2=new Publisher({stateDir:d2,repository:'owner/repo',token:'private-token',fetch:mock2.fetch,now:()=>now,coalesceMs:0,maxAttempts:1});p2.enqueue(artifact);await p2.tick();assert.equal(p2.status().current.phase,'failed');assert.equal(mock2.patches,0);assert.equal(mock2.dispatches,0);
});
test('public project metadata survives rollback-compatible sanitization and noninteger valid intervals stay supported',()=>{
  const b=bundle();b.project_id='ABC';b.policy={version:'central-policy-v1',ridge_min_rows:120,cluster_min_rows:90,retry_rows:60,evaluate_n:24,block_n:24,margin:.05,buffer_rows:1200,password:'private'};
  b.profiles[0].context_key=JSON.stringify(['ABC','hp-a','browser','wss://broker.example/mqtt',2.5,'linear']);
  const cleaned=sanitizeBundle(b);assert.equal(cleaned.project_id,'ABC');assert.equal(cleaned.policy.password,undefined);assert.equal(JSON.parse(cleaned.profiles[0].context_key)[4],2.5);
  b.project_id='DEF';assert.throws(()=>sanitizeBundle(b));
});
