'use strict';
// Public model files are built from an allowlist. Database rows, GPS, arbitrary
// report fields and broker credentials are never copied into a release.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const M = require('../assets/ml.js');
const K = require('../assets/clusters.js');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const clone = (v) => JSON.parse(JSON.stringify(v));
const RIDGE_FIELDS = ['format','schema_version','scope','context_key','window','features','centers','scales','coefficients','intercept','alpha','provenance','horizon_s','training_interval_s','trained_through_ms','evaluated_through_ms','validation','test','model_id','applicability'];
const CLUSTER_FIELDS = ['format','schema_version','algorithm','k','transform','features','centroids','counts','inertia','trained_rows','ignored_rows','provenance','context_key','model_id'];
const METHOD = new Set(['ridge','persistence','moving_average']);
const VERSION = /^[a-z0-9][a-z0-9._-]{0,95}$/;
function pick(value, names) { const out = {}; for (const key of names) if (value?.[key] !== undefined) out[key] = clone(value[key]); return out; }
function safeContext(value, quality = false) {
  try {
    const c = JSON.parse(value); const i = quality ? 1 : 2; const u = new URL(c[i + 1]);
    return typeof value === 'string' && Array.isArray(c) && JSON.stringify(c) === value && c.length === (quality ? 4 : 6) &&
      /^[A-Za-z0-9_-]{1,48}$/.test(c[0]) && (quality || /^[A-Za-z0-9_-]{1,48}$/.test(c[1])) &&
      ['browser','termux'].includes(c[i]) && u.protocol === 'wss:' && !u.username && !u.password && !u.search && !u.hash &&
      u.href === c[i + 1] && Number.isFinite(c[i + 2]) && c[i + 2] >= 2 && c[i + 2] <= 60 &&
      (quality || ['linear','gravity_removed','unavailable'].includes(c[5]));
  } catch { return false; }
}
function ridgeModel(model) {
  const m = pick(model, RIDGE_FIELDS);
  // Nested metric objects also use a strict allowlist.
  for (const split of ['validation','test']) m[split] = Object.fromEntries(['ridge','persistence','moving_average'].map(method => [method, pick(m[split]?.[method], ['n','mae_ms','rmse_ms'])]));
  if (m.applicability) m.applicability = pick(m.applicability, ['sources','interval_min_s','interval_max_s','accel_modes']);
  if (!M.validateContextModel(m)) throw new Error('Model Ridge publik tidak valid.');
  if (m.scope === 'context' && !safeContext(m.context_key)) throw new Error('Konteks Ridge publik tidak valid.');
  return m;
}
function clusterModel(model) {
  const m = pick(model, CLUSTER_FIELDS);
  if (!K.validateModel(m) || (m.context_key !== undefined && !safeContext(m.context_key, true))) throw new Error('Model K-Means publik tidak valid.');
  return m;
}
function sanitizeBundle(bundle) {
  if (bundle?.schema !== 'sigheat-central-models-v1' || !Array.isArray(bundle.profiles) || !Array.isArray(bundle.clusters) || bundle.profiles.length > 10000 || bundle.clusters.length > 10000) throw new Error('Paket pusat tidak valid.');
  const ids = new Set();
  function profile(p, quality) {
    if (!safeContext(p.context_key, quality) || ids.has((quality ? 'K' : 'R') + p.context_key)) throw new Error('Konteks model tidak valid atau berulang.');
    ids.add((quality ? 'K' : 'R') + p.context_key);
    const model = quality ? clusterModel(p.model) : ridgeModel(p.model);
    if (model.context_key != null && model.context_key !== p.context_key) throw new Error('Konteks model dan pembungkus berbeda.');
    if (!quality && !METHOD.has(p.method)) throw new Error('Metode prediksi tidak valid.');
    const out = { context_key: p.context_key, model, ...(!quality ? {method: p.method} : {}) };
    for (const key of ['trained_at_ms','promoted_at_ms','revision']) if (Number.isSafeInteger(p[key]) && p[key] >= 0) out[key] = p[key];
    return out;
  }
  const out = {schema: 'sigheat-central-models-v1', code_version: '5.0.0', revision: Number.isSafeInteger(bundle.revision) && bundle.revision >= 0 ? bundle.revision : 0,
    generated_at_ms: Number.isSafeInteger(bundle.generated_at_ms) && bundle.generated_at_ms >= 0 ? bundle.generated_at_ms : 0,
    profiles: bundle.profiles.map(p => profile(p, false)).sort((a,b) => a.context_key.localeCompare(b.context_key)),
    clusters: bundle.clusters.map(p => profile(p, true)).sort((a,b) => a.context_key.localeCompare(b.context_key)), frozen_ridge: ridgeModel(bundle.frozen_ridge)};
  const projectId = bundle.project_id ?? ([...out.profiles,...out.clusters][0] ? JSON.parse([...out.profiles,...out.clusters][0].context_key)[0] : undefined);
  if (projectId !== undefined) {
    if (!/^[A-Za-z0-9_-]{1,48}$/.test(projectId) || [...out.profiles,...out.clusters].some(p => JSON.parse(p.context_key)[0] !== projectId)) throw new Error('Identitas proyek publik tidak cocok.');
    out.project_id = projectId;
  }
  if (bundle.policy !== undefined) {
    out.policy = pick(bundle.policy,['version','ridge_min_rows','cluster_min_rows','retry_rows','evaluate_n','block_n','margin','buffer_rows']);
    if (!/^central-policy-[a-z0-9-]{1,32}$/.test(out.policy.version || '') || Object.entries(out.policy).some(([k,v]) => k !== 'version' && (!Number.isFinite(v) || v < 0 || v > 50000))) throw new Error('Kebijakan publik tidak valid.');
  }
  out.frozen_clusters = clusterModel(bundle.frozen_clusters || K.defaultModel());
  if (out.frozen_ridge.scope !== 'bootstrap') throw new Error('Model awal beku harus bootstrap.');
  return out;
}
function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive:true, mode:0o700});
  const tmp = file + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  try { fs.writeFileSync(tmp, value, {mode:0o600}); fs.renameSync(tmp, file); }
  finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
function signature(bundle) { const b = sanitizeBundle(bundle); delete b.generated_at_ms; delete b.revision; return hash(JSON.stringify(b)); }
class ArtifactStore {
  constructor({directory, now = Date.now}) {
    this.directory = path.resolve(directory); this.now = now;
    fs.mkdirSync(path.join(this.directory,'releases'), {recursive:true,mode:0o700});
  }
  current() {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(this.directory,'latest.json'),'utf8'));
      const bytes = this.read(manifest.artifact);
      if (!bytes || manifest.schema !== 'sigheat-model-manifest-v1' || !VERSION.test(manifest.version) || hash(bytes) !== manifest.sha256 || bytes.length !== manifest.bytes) throw new Error('Artefak lokal tidak utuh.');
      const bundle = sanitizeBundle(JSON.parse(bytes.toString('utf8')));
      return {manifest,bytes,signature:signature(bundle),path:path.join(this.directory,manifest.artifact)};
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  activate(input) {
    const bundle = sanitizeBundle(input), sig = signature(bundle), previous = this.current();
    if (previous?.signature === sig) return {...previous,changed:false};
    bundle.generated_at_ms = this.now();
    const bytes = Buffer.from(JSON.stringify(bundle,null,2) + '\n'), digest = hash(bytes), version = 'model-' + digest.slice(0,24);
    if (bytes.length > 8 * 1024 * 1024) throw new Error('Paket parameter melebihi batas browser 8 MiB; kurangi konteks aktif melalui kebijakan arsip.');
    const artifact = `releases/${version}.json`, dest = path.join(this.directory,artifact);
    if (fs.existsSync(dest) && !fs.readFileSync(dest).equals(bytes)) throw new Error('Artefak berversi tidak boleh ditimpa.');
    if (!fs.existsSync(dest)) atomicWrite(dest,bytes);
    const manifest = {schema:'sigheat-model-manifest-v1',version,artifact,sha256:digest,bytes:bytes.length,published_at_ms:this.now(),model_revision:bundle.revision};
    atomicWrite(path.join(this.directory,'latest.json'),JSON.stringify(manifest,null,2)+'\n');
    return {manifest,bytes,signature:sig,path:dest,changed:true};
  }
  rollback(version, reason = 'Operator memilih artefak lama') {
    if (!VERSION.test(version)) throw new Error('Versi rollback tidak valid.');
    const artifact = `releases/${version}.json`, bytes = this.read(artifact);
    if (!bytes) throw new Error('Artefak rollback tidak ditemukan.');
    const bundle = sanitizeBundle(JSON.parse(bytes)), now = this.now();
    // The publication is NEW even though the model artifact intentionally is old.
    const manifest = {schema:'sigheat-model-manifest-v1',version:`rollback-${now}-${crypto.randomBytes(4).toString('hex')}`,artifact,sha256:hash(bytes),bytes:bytes.length,published_at_ms:now,model_revision:bundle.revision,rollback_of:version};
    atomicWrite(path.join(this.directory,'latest.json'),JSON.stringify(manifest,null,2)+'\n');
    atomicWrite(path.join(this.directory,`rollback-${now}.json`),JSON.stringify({at_ms:now,version:manifest.version,artifact,reason:String(reason).slice(0,300)})+'\n');
    return {manifest,bytes,signature:signature(bundle),path:path.join(this.directory,artifact),changed:true};
  }
  read(relative) {
    if (relative !== 'latest.json' && !/^releases\/[a-z0-9][a-z0-9._-]{0,95}\.json$/.test(relative)) return null;
    try { return fs.readFileSync(path.join(this.directory,relative)); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }
}
module.exports = {ArtifactStore, sanitizeBundle, signature, hash, atomicWrite, safeContext};
