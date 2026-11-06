'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mqtt = require('mqtt');
const { readConfig } = require('./config.cjs');
const { CentralEngine } = require('./engine.cjs');
const { ArtifactStore } = require('./artifacts.cjs');
const { Publisher } = require('./publisher.cjs');
const { createHttpServer } = require('./http.cjs');

async function startCentral(config = readConfig(), options = {}) {
  const now=options.now || Date.now;
  fs.mkdirSync(config.dataDir,{recursive:true,mode:0o700});
  const engine = options.engine || new CentralEngine({dbPath:config.dbPath,projectId:config.projectId,brokerEndpoint:config.brokerEndpoint,now});
  const artifacts = new ArtifactStore({directory:path.join(config.dataDir,'models')});
  const publisher = new Publisher({stateDir:path.join(config.dataDir,'publication'),repository:config.repository,branch:config.githubBranch,token:config.githubToken,pagesBaseUrl:config.pagesBaseUrl,coalesceMs:config.publishCoalesceMs});
  const startedAt = now();
  const broker = {connected:false,subscribed:false,last_error:null,reconnect_count:0,last_received_at_ms:null,received:0,accepted:0,rejected:0};
  let lastRevision, client, closed = false, modelSyncError = null;
  const syncModels = () => {
    const bundle = engine.modelBundle();
    if (bundle.revision === lastRevision) return;
    const artifact = artifacts.activate(bundle);
    publisher.enqueue(artifact);
    lastRevision = bundle.revision;
    modelSyncError = null;
  };
  try { syncModels(); } catch (e) { engine.close(); throw e; }
  const getStatus = () => ({...engine.snapshot(),schema:'sigheat-central-status-v1',mode:'central',server_version:'5.0.0',server_time_ms:now(),started_at_ms:startedAt,project_id:config.projectId,broker_endpoint:config.brokerEndpoint,broker:{...broker},publication:publisher.status(),model_sync_error:modelSyncError,active_manifest:artifacts.current()?.manifest || null,retention:{training_rows_per_context:1200,raw_measurements:'Tidak dihapus otomatis; cadangkan dan pantau ruang disk.'}});
  const getHistory = (filters={}) => {
    const history=engine.history(filters);
    const publicationEvents=(publisher.history?.() || []).filter(e=>(filters.from==null||e.at_ms>=filters.from)&&(filters.to==null||e.at_ms<=filters.to));
    return {...history,publicationEvents};
  };
  const server = createHttpServer({config,engine,artifacts,getStatus,getHistory});
  try {
    await new Promise((resolve,reject)=>{ server.once('error',reject);server.listen(config.port,config.host,resolve); });
  } catch (e) { engine.close(); throw e; }
  if (options.connectMqtt !== false) {
    client = mqtt.connect(config.mqttUrl,{
      clientId:`sigheat-central-${crypto.randomBytes(8).toString('hex')}`,
      clean:true,protocolVersion:4,connectTimeout:15000,reconnectPeriod:3000,
      keepalive:30,resubscribe:true,queueQoSZero:false,
      username:config.mqttUsername,password:config.mqttPassword,
      rejectUnauthorized:true
    });
    client.on('connect',()=>{
      broker.connected=true;broker.last_error=null;
      client.subscribe(`sigheat/${config.projectId}/edge/+/telemetry`,{qos:1},(error,granted)=>{
        broker.subscribed=!error && !!granted?.length && granted.every(g=>g.qos!==128);
        if (!broker.subscribed) broker.last_error='Broker menolak langganan telemetri.';
      });
    });
    client.on('reconnect',()=>{ broker.reconnect_count++; });
    client.on('offline',()=>{broker.connected=false;broker.subscribed=false;});
    client.on('close',()=>{broker.connected=false;broker.subscribed=false;});
    client.on('error',()=>{broker.last_error='Sambungan MQTT gagal; mencoba kembali otomatis. Periksa broker, internet, dan kredensial.';});
    client.on('message',(topic,payload,packet)=>{
      broker.received++;broker.last_received_at_ms=now();
      // Retained measurements are historical, not newly observed targets.
      if (packet.retain || payload.length>config.maxPayloadBytes) {broker.rejected++;return;}
      try {
        const result=engine.ingest(topic,payload.toString('utf8'),broker.last_received_at_ms);
        if (result.accepted) {
          broker.accepted++;
          try{syncModels();}catch(_){modelSyncError='Pengukuran tersimpan; sinkronisasi paket model tertunda dan akan dicoba ulang. Periksa ruang disk.';}
        }
        else broker.rejected++;
      } catch (_) {
        broker.rejected++;broker.last_error='Telemetri gagal disimpan/diproses. Periksa ruang disk dan log validasi; data tidak dianggap berhasil.';
      }
    });
  }
  const publicationTimer=setInterval(()=>{
    try{syncModels();}catch(_){modelSyncError='Sinkronisasi paket model tertunda; percobaan ulang otomatis.';}
    publisher.tick().catch(()=>{});
  },15000);
  publicationTimer.unref();
  const close=async()=>{
    if(closed)return;closed=true;clearInterval(publicationTimer);
    if(client) await new Promise(resolve=>client.end(true,{},resolve));
    await new Promise(resolve=>server.close(resolve));
    engine.close();
  };
  return {server,engine,artifacts,publisher,client,broker,getStatus,syncModels,close};
}
if(require.main===module) {
  startCentral().then(app=>{
    const addr=app.server.address();
    console.log(`SigHeat pusat aktif: http://${addr.address==='::1'?'[::1]':addr.address}:${addr.port}/dashboard.html`);
    console.log('Pusat mengumpulkan telemetri dan melatih otomatis. Biarkan proses ini tetap berjalan.');
    let stopping=false;
    for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{if(stopping)return;stopping=true;await app.close();process.exit(0);});
  }).catch(error=>{console.error('Pusat gagal dimulai: '+error.message);process.exitCode=1;});
}
module.exports={startCentral};
