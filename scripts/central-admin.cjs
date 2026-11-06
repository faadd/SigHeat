'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync, backup } = require('node:sqlite');
const { readConfig } = require('../server/config.cjs');
const { ArtifactStore, sanitizeBundle } = require('../server/artifacts.cjs');
const { Publisher } = require('../server/publisher.cjs');

function argsOf(args) {
  const out = {command:args[0]};
  for(let i=1;i<args.length;i+=2) {
    if(!['--output','--input','--version','--reason'].includes(args[i]) || !args[i+1]) throw new Error('Argumen tidak dikenal atau nilainya kosong.');
    out[args[i].slice(2)]=args[i+1];
  }
  return out;
}
function ensureStopped(config) {
  const file=config.dbPath+'.writer.lock';
  if(!fs.existsSync(file))return;
  let lock;try{lock=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw new Error('Lock database tidak dapat diperiksa. Hentikan pusat dan periksa lock.');}
  if(!Number.isSafeInteger(lock.pid)||lock.pid<1)throw new Error('Lock database tidak valid.');
  const {processIdentity}=require('../server/store.cjs');
  if(processIdentity && lock.identity) {
    const actual=processIdentity(lock.pid);
    if(actual && actual!==lock.identity)return;
  }
  try{process.kill(lock.pid,0);}catch(e){if(e.code==='ESRCH')return;throw new Error('Tidak dapat memastikan pusat sudah berhenti.');}
  throw new Error('Hentikan layanan pusat dahulu (Ctrl+C / stop service).');
}
function checkedSource(file) {
  if(!fs.existsSync(file))throw new Error('Database sumber tidak ditemukan.');
  const db=new DatabaseSync(file,{readOnly:true});
  try{
    if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw new Error('Cadangan SQLite rusak.');
    if(db.prepare('PRAGMA user_version').get().user_version!==1)throw new Error('Versi database tidak kompatibel.');
    const names=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name);
    if(!['metadata','measurements','predictions','models','candidates'].every(n=>names.includes(n)))throw new Error('Berkas bukan database pusat SigHeat.');
    return db;
  }catch(e){db.close();throw e;}
}
async function run(args=process.argv.slice(2),config=readConfig()) {
  const a=argsOf(args);
  if(a.command==='backup') {
    if(!a.output)throw new Error('Gunakan --output /folder/cadangan.sqlite');
    const destination=path.resolve(a.output);
    if(fs.existsSync(destination))throw new Error('Tujuan sudah ada. Pilih nama cadangan baru.');
    fs.mkdirSync(path.dirname(destination),{recursive:true,mode:0o700});
    const source=checkedSource(config.dbPath);
    try{await backup(source,destination);fs.chmodSync(destination,0o600);}finally{source.close();}
    console.log('Cadangan SQLite konsisten dibuat: '+destination);
    console.log('Berisi pengukuran, model, kandidat, dan bukti evaluasi. Simpan juga folder private-data/models dan private-data/publication untuk arsip publikasi GitHub.');
    return destination;
  }
  if(a.command==='restore') {
    ensureStopped(config);
    if(!a.input)throw new Error('Gunakan --input /folder/cadangan.sqlite');
    const sourceFile=path.resolve(a.input);
    if(sourceFile===path.resolve(config.dbPath))throw new Error('Sumber dan tujuan pemulihan harus berbeda.');
    const source=checkedSource(sourceFile),temp=config.dbPath+'.restore-'+Date.now();
    const record=source.prepare("SELECT value FROM metadata WHERE key='engine_state'").get();
    let saved;try{saved=JSON.parse(record?.value);}catch{source.close();throw new Error('State pembelajaran dalam cadangan tidak dapat dibaca.');}
    if(saved.project_id!==config.projectId || saved.broker_endpoint!==config.brokerEndpoint) {source.close();throw new Error('Project/broker cadangan berbeda. Sesuaikan konfigurasi untuk memulihkan proyek tersebut.');}
    fs.mkdirSync(config.dataDir,{recursive:true,mode:0o700});
    try{await backup(source,temp);}finally{source.close();}
    const stamp=Date.now();
    if(fs.existsSync(config.dbPath)) {
      const previous=checkedSource(config.dbPath);
      try{await backup(previous,config.dbPath+'.before-restore-'+stamp);}finally{previous.close();}
    }
    for(const suffix of ['-wal','-shm','.writer.lock'])if(fs.existsSync(config.dbPath+suffix))fs.unlinkSync(config.dbPath+suffix);
    fs.renameSync(temp,config.dbPath);fs.chmodSync(config.dbPath,0o600);
    // A queued future publication from the replaced DB must not resume silently.
    const publication=path.join(config.dataDir,'publication');
    if(fs.existsSync(publication))fs.renameSync(publication,publication+'.before-restore-'+stamp);
    console.log('Database dipulihkan. Arsip lama dipertahankan; antrean publikasi lama dinonaktifkan. Jalankan npm run central.');
    return config.dbPath;
  }
  if(a.command==='rollback' || a.command==='retry') {
    ensureStopped(config);
    const publisher=new Publisher({stateDir:path.join(config.dataDir,'publication'),repository:config.repository,branch:config.githubBranch,token:config.githubToken,pagesBaseUrl:config.pagesBaseUrl,coalesceMs:config.publishCoalesceMs});
    if(a.command==='retry') {publisher.retry();console.log('Antrean gagal diaktifkan kembali. Jalankan npm run central untuk melanjutkan.');return;}
    if(!a.version || !/^[a-z0-9][a-z0-9._-]{0,95}$/.test(a.version) || !a.reason?.trim())throw new Error('Gunakan --version model-VERSI --reason "alasan rollback"');
    const artifacts=new ArtifactStore({directory:path.join(config.dataDir,'models')});
    const bytes=artifacts.read(`releases/${a.version}.json`);
    if(!bytes)throw new Error('Artefak versi tersebut tidak ada di server ini.');
    const bundle=sanitizeBundle(JSON.parse(bytes));
    const {CentralEngine}=require('../server/engine.cjs');
    const engine=new CentralEngine({dbPath:config.dbPath,projectId:config.projectId,brokerEndpoint:config.brokerEndpoint});
    try{
      const updated=engine.rollbackModels(bundle,a.reason.trim());
      const artifact=artifacts.activate(updated);
      publisher.enqueue(artifact);
      console.log('Parameter pusat dipulihkan; riwayat tidak dihapus. Versi publikasi: '+artifact.manifest.version);
      console.log('Jalankan npm run central. Publikasi diproses bila GitHub telah dikonfigurasi.');
    }finally{engine.close();}
    return;
  }
  throw new Error('Perintah: backup --output FILE | restore --input FILE | rollback --version VERSION --reason TEKS | retry');
}
if(require.main===module)run().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={run,argsOf,ensureStopped,checkedSource};
