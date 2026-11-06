'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {atomicWrite,hash,sanitizeBundle} = require('./artifacts.cjs');
function sameManifest(a,b) { return Boolean(a && b && a.schema === 'sigheat-model-manifest-v1' && a.version === b.version && a.sha256 === b.sha256 && a.artifact === b.artifact); }
function requestError(code, status) { const e = new Error(code); e.status = status; return e; }
class Publisher {
  constructor({stateDir, repository='', branch='main', token='', pagesBaseUrl='', workflow='pages.yml', fetch:fetcher=global.fetch, now=Date.now, coalesceMs=60000, maxAttempts=5, retryBaseMs=30000, requestTimeoutMs=15000}) {
    if (repository && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Repository GitHub harus owner/repo.');
    if (!branch || /[\s\x00-\x1f~^:?*\[\\]/.test(branch) || branch.includes('..') || branch.startsWith('-')) throw new Error('Nama branch tidak valid.');
    if (!/^[A-Za-z0-9_.-]+\.ya?ml$/.test(workflow)) throw new Error('Nama workflow tidak valid.');
    if (pagesBaseUrl) { const u = new URL(pagesBaseUrl); if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) throw new Error('URL Pages harus HTTPS tanpa kredensial.'); }
    this.directory=path.resolve(stateDir); this.file=path.join(this.directory,'publisher.json'); this.historyFile=path.join(this.directory,'publication-events.jsonl');
    this.repository=repository; this.branch=branch; this.token=token; this.pagesBaseUrl=pagesBaseUrl.replace(/\/$/,''); this.workflow=workflow; this.fetch=fetcher; this.now=now;
    this.coalesceMs=coalesceMs; this.maxAttempts=maxAttempts; this.retryBaseMs=retryBaseMs; this.requestTimeoutMs=requestTimeoutMs; this.busy=false;
    fs.mkdirSync(this.directory,{recursive:true,mode:0o700});
    try { this.state=JSON.parse(fs.readFileSync(this.file,'utf8')); if(this.state.schema!=='sigheat-publisher-v1') throw new Error('Status penerbit tidak kompatibel.'); }
    catch(e) { if(e.code!=='ENOENT') throw e; this.state={schema:'sigheat-publisher-v1',queued:null,current:null,committed:null,deployed:null,latest:null}; }
  }
  save() { atomicWrite(this.file,JSON.stringify(this.state,null,2)+'\n'); }
  event(kind,data={}) { fs.appendFileSync(this.historyFile,JSON.stringify({at_ms:this.now(),kind,...data})+'\n',{mode:0o600}); }
  history() {
    let text;try{text=fs.readFileSync(this.historyFile,'utf8');}catch(e){if(e.code==='ENOENT')return [];throw e;}
    const out=[];let index=0;
    for(const line of text.split('\n')) {
      index++;if(!line.trim())continue;let event;try{event=JSON.parse(line);}catch{continue;}
      if(!Number.isSafeInteger(event.at_ms)||typeof event.kind!=='string')continue;
      const row={id:'publication-'+index,at_ms:event.at_ms,kind:event.kind};
      for(const key of ['version','by','sha256','commit_sha','phase','attempt','error','exhausted'])if(event[key]!==undefined)row[key]=event[key];
      out.push(row);
    }
    return out;
  }
  status() {
    const display = x => x ? {version:x.manifest?.version || x.version,sha256:x.manifest?.sha256 || x.sha256,phase:x.phase,attempts:x.attempts || 0,queued_at_ms:x.queued_at_ms,committed_at_ms:x.committed_at_ms,deployed_at_ms:x.deployed_at_ms,commit_sha:x.commit_sha,next_attempt_ms:x.next_attempt_ms,error:x.error || null} : null;
    return {enabled:Boolean(this.token&&this.repository),repository:this.repository||null,branch:this.branch,pages_url:this.pagesBaseUrl||null,queued:display(this.state.queued),current:display(this.state.current),committed:display(this.state.committed),deployed:display(this.state.deployed),active_version:this.state.latest?.version||null,
      note:!this.token||!this.repository?'Publikasi belum dikonfigurasi; model pusat tetap aktif.':(!this.pagesBaseUrl?'URL Pages belum diisi; status terbit tidak dapat diverifikasi.':null)};
  }
  enqueue(artifact) {
    const manifest=artifact.manifest, bytes=Buffer.from(artifact.bytes);
    if (!manifest || manifest.schema!=='sigheat-model-manifest-v1' || !/^[a-z0-9][a-z0-9._-]{0,95}$/.test(manifest.version) || !/^releases\/[a-z0-9][a-z0-9._-]{0,95}\.json$/.test(manifest.artifact) || bytes.length!==manifest.bytes || bytes.length>8*1024*1024 || hash(bytes)!==manifest.sha256) throw new Error('Artefak publikasi tidak utuh.');
    const parsed=JSON.parse(bytes.toString('utf8'));
    if(JSON.stringify(parsed)!==JSON.stringify(sanitizeBundle(parsed))) throw new Error('Artefak memiliki field yang tidak diizinkan untuk publik.');
    this.state.latest={version:manifest.version,sha256:manifest.sha256};
    if ([this.state.queued,this.state.current,this.state.committed].some(x=>sameManifest(x?.manifest,manifest))) { this.save(); return false; }
    if(this.state.queued) this.event('superseded',{version:this.state.queued.manifest.version,by:manifest.version});
    this.state.queued={manifest,bytes:bytes.toString('base64'),phase:'queued',attempts:0,queued_at_ms:this.now(),next_attempt_ms:this.now()+this.coalesceMs,error:null};
    this.event('queued',{version:manifest.version,sha256:manifest.sha256}); this.save(); return true;
  }
  retry() {
    for(const job of [this.state.current,this.state.queued]) if(job?.phase==='failed') {job.phase=job.resume_phase||'queued';job.attempts=0;job.next_attempt_ms=this.now();job.error=null;}
    this.save();
  }
  async api(route,{method='GET',body,allow404=false}={}) {
    let r;
    try { r=await this.fetch('https://api.github.com/repos/'+this.repository+route,{method,headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+this.token,'X-GitHub-Api-Version':'2022-11-28','User-Agent':'SigHeat-central/5.0','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(this.requestTimeoutMs),redirect:'error'}); }
    catch {throw requestError('GitHub tidak dapat dihubungi atau permintaan habis waktu.',0);}
    if(r.status===404&&allow404)return null;
    if(!r.ok)throw requestError('GitHub HTTP '+r.status+'; periksa izin repository, branch, workflow, dan batas API.',r.status);
    if(r.status===204)return null;
    try {return await r.json();}catch{throw requestError('Respons GitHub tidak dapat dibaca.',r.status);}
  }
  async contents(file) {
    let r=await this.api('/contents/'+file.split('/').map(encodeURIComponent).join('/')+'?ref='+encodeURIComponent(this.branch),{allow404:true});
    if(!r)return null;
    if(r.type!=='file')throw requestError('Berkas repository bukan file.',0);
    if(r.encoding==='none'&&/^[a-f0-9]{40,64}$/.test(r.sha||''))r=await this.api('/git/blobs/'+r.sha);
    if(r.encoding!=='base64'||typeof r.content!=='string'||r.content.length>12*1024*1024)throw requestError('Berkas repository tidak dapat diperiksa dengan aman.',0);
    return Buffer.from(r.content.replace(/\s/g,''),'base64');
  }
  async commit(job) {
    const ref=await this.api('/git/ref/heads/'+encodeURIComponent(this.branch));
    if(!/^[a-f0-9]{40,64}$/.test(ref?.object?.sha||''))throw requestError('SHA branch GitHub tidak valid.',0);
    const latest=await this.contents('models/latest.json');
    let old;try{old=latest?JSON.parse(latest):null;}catch{old=null;}
    const immutablePath='models/'+job.manifest.artifact, bytes=Buffer.from(job.bytes,'base64');
    const existing=await this.contents(immutablePath);
    if(sameManifest(old,job.manifest)&&existing?.equals(bytes)) {job.commit_sha=ref.object.sha;return;}
    if(existing&&!existing.equals(bytes))throw requestError('Artefak dengan versi sama sudah berbeda di GitHub; publikasi dihentikan.',409);
    const base=await this.api('/git/commits/'+ref.object.sha);
    if(!base?.tree?.sha)throw requestError('Pohon commit GitHub tidak valid.',0);
    const entries=[{path:'models/latest.json',mode:'100644',type:'blob',content:JSON.stringify(job.manifest,null,2)+'\n'}];
    if(!existing)entries.unshift({path:immutablePath,mode:'100644',type:'blob',content:bytes.toString('utf8')});
    const tree=await this.api('/git/trees',{method:'POST',body:{base_tree:base.tree.sha,tree:entries}});
    const commit=await this.api('/git/commits',{method:'POST',body:{message:'Publish SigHeat model '+job.manifest.version,tree:tree.sha,parents:[ref.object.sha]}});
    // No force: a concurrent update makes this fail, then a retry reads a new base.
    await this.api('/git/refs/heads/'+encodeURIComponent(this.branch),{method:'PATCH',body:{sha:commit.sha,force:false}});
    job.commit_sha=commit.sha;
  }
  async tick() {
    if(this.busy||!this.repository||!this.token)return this.status();
    this.busy=true;
    try {
      if(this.state.queued && this.now()>=this.state.queued.next_attempt_ms && (!this.state.current || ['deployed','dispatched','failed'].includes(this.state.current.phase))) {
        if(this.state.current && this.state.current.phase!=='deployed') this.event('superseded',{version:this.state.current.manifest.version,by:this.state.queued.manifest.version});
        this.state.current=this.state.queued;this.state.queued=null;this.save();
      }
      const job=this.state.current;
      if(!job||['failed','deployed'].includes(job.phase)||this.now()<job.next_attempt_ms)return this.status();
      try {
        if(job.phase==='queued') {
          await this.commit(job);job.phase='committed';job.committed_at_ms=this.now();job.attempts=0;job.error=null;
          this.state.committed={...job,bytes:undefined};this.event('committed',{version:job.manifest.version,commit_sha:job.commit_sha});this.save();
        }
        if(job.phase==='committed') {
          // Explicit dispatch is essential: GITHUB_TOKEN commits need not trigger push builds.
          await this.api('/actions/workflows/'+encodeURIComponent(this.workflow)+'/dispatches',{method:'POST',body:{ref:this.branch,inputs:{model_version:job.manifest.version}}});
          job.phase='dispatched';job.dispatched_at_ms=this.now();job.attempts=0;job.error=null;job.next_attempt_ms=this.now()+this.retryBaseMs;
          this.event('deployment_requested',{version:job.manifest.version});this.save();
        } else if(job.phase==='dispatched'&&this.pagesBaseUrl) {
          let r;try{r=await this.fetch(this.pagesBaseUrl+'/models/latest.json?t='+this.now(),{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(this.requestTimeoutMs)});}catch{throw requestError('Manifest Pages belum dapat diambil.',0);}
          if(!r.ok)throw requestError('Manifest Pages HTTP '+r.status+'.',r.status);
          let manifest;try{manifest=await r.json();}catch{throw requestError('Manifest Pages tidak dapat dibaca.',0);}
          if(sameManifest(manifest,job.manifest)) {
            // Confirm the referenced bytes too, not just a successful workflow/manifest.
            const ar=await this.fetch(this.pagesBaseUrl+'/models/'+manifest.artifact+'?t='+this.now(),{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(this.requestTimeoutMs)});
            const b=Buffer.from(await ar.arrayBuffer());
            if(!ar.ok||b.length!==manifest.bytes||hash(b)!==manifest.sha256)throw requestError('Artefak Pages belum utuh atau masih tertunda.',0);
            job.phase='deployed';job.deployed_at_ms=this.now();job.error=null;
            this.state.deployed={...job,bytes:undefined};this.event('pages_verified',{version:job.manifest.version});this.save();
          } else {throw requestError('Pages belum menyajikan versi commit ini; deployment masih tertunda atau gagal.',0);}
        }
      } catch(e) {
        // Error strings are controlled, never echo responses, request headers or tokens.
        job.attempts++;job.error=(e.status!==undefined?e.message:'Publikasi gagal; lihat konfigurasi jaringan dan coba ulang.');
        const resumePhase=job.phase;job.next_attempt_ms=this.now()+Math.min(3600000,this.retryBaseMs*2**(job.attempts-1));
        if(job.attempts>=this.maxAttempts){job.resume_phase=resumePhase;job.phase='failed';}
        this.event('retry',{version:job.manifest.version,phase:resumePhase,attempt:job.attempts,error:job.error,exhausted:job.phase==='failed'});this.save();
      }
      return this.status();
    } finally {this.busy=false;}
  }
}
module.exports={Publisher,sameManifest};
