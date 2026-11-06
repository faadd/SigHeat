/* Central models: verified, atomic, read-only browser inference. No training here. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./ml.js'), require('./clusters.js'), require('./default-model.js'));
  else root.SigHeatCentralClient = factory(root.SigHeatML, root.SigHeatClusters, root.SigHeatDefaultModel);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (M, K, DEFAULT) {
  'use strict';
  const MAX_BYTES = 8 * 1024 * 1024, CACHE_KEY = 'sigheat.central.models.v1:';
  const clone = value => JSON.parse(JSON.stringify(value));
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,48}$/.test(value);
  function context(value, quality = false) {
    try {
      const a = JSON.parse(value), n = quality ? 4 : 6;
      if (typeof value !== 'string' || value.length > 2048 || JSON.stringify(a) !== value || !Array.isArray(a) || a.length !== n || !id(a[0])) return null;
      const offset = quality ? 0 : 1;
      if (!quality && !id(a[1])) return null;
      if (!['browser', 'termux'].includes(a[1 + offset]) || !finite(a[3 + offset]) || a[3 + offset] < 2 || a[3 + offset] > 60) return null;
      const u = new URL(a[2 + offset]);
      if (u.protocol !== 'wss:' || !u.hostname || u.username || u.password || u.search || u.hash || u.href !== a[2 + offset]) return null;
      if (!quality && !['linear', 'gravity_removed', 'unavailable'].includes(a[5])) return null;
      return a;
    } catch (_) { return null; }
  }
  function validateBundle(bundle) {
    if (!bundle || bundle.schema !== 'sigheat-central-models-v1' || !Number.isSafeInteger(bundle.revision) || bundle.revision < 0 ||
        !finite(bundle.generated_at_ms) || bundle.generated_at_ms < 1 || !Array.isArray(bundle.profiles) || !Array.isArray(bundle.clusters) ||
        bundle.profiles.length > 10000 || bundle.clusters.length > 10000 || !K.validateModel(bundle.frozen_clusters) ||
        ((bundle.profiles.length || bundle.clusters.length) && !id(bundle.project_id)) || !M.validateContextModel(bundle.frozen_ridge) || bundle.frozen_ridge.scope !== 'bootstrap') return false;
    const seen = new Set(), qualitySeen = new Set();
    for (const p of bundle.profiles) {
      if (!p || !context(p.context_key) || JSON.parse(p.context_key)[0] !== bundle.project_id || seen.has(p.context_key) || !['ridge', 'persistence', 'moving_average'].includes(p.method) || !M.validateContextModel(p.model) ||
          (p.model.scope === 'context' && p.model.context_key !== p.context_key)) return false;
      seen.add(p.context_key);
    }
    for (const p of bundle.clusters) {
      if (!p || !context(p.context_key, true) || JSON.parse(p.context_key)[0] !== bundle.project_id || qualitySeen.has(p.context_key) || !K.validateModel(p.model) ||
          (p.model.context_key !== undefined && p.model.context_key !== p.context_key)) return false;
      qualitySeen.add(p.context_key);
    }
    return true;
  }
  function validateManifest(m) {
    return !!(m && m.schema === 'sigheat-model-manifest-v1' && typeof m.version === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(m.version) &&
      typeof m.sha256 === 'string' && /^[a-f0-9]{64}$/.test(m.sha256) && Number.isSafeInteger(m.bytes) && m.bytes > 0 && m.bytes <= MAX_BYTES &&
      typeof m.artifact === 'string' && /^releases\/[A-Za-z0-9_.-]+\.json$/.test(m.artifact) && !m.artifact.includes('..'));
  }
  function safeURL(value, base) {
    const u = new URL(value, base);
    if (!['https:', 'http:'].includes(u.protocol) || !u.hostname || u.username || u.password || u.hash) throw new Error('URL layanan harus HTTP(S), tanpa kredensial atau fragmen.');
    return u.href;
  }
  function qualityKey(row) { return JSON.stringify([row.project_id || '', row.source, new URL(row.broker_endpoint).href, row.interval_s]); }
  function create(options = {}) {
    const fetcher = options.fetch || globalThis.fetch, crypto = options.crypto || globalThis.crypto, now = options.now || Date.now;
    const storage = options.storage || null, listeners = new Set(), rows = new Map();
    let url = options.manifestURL ? safeURL(options.manifestURL, options.baseURL) : '', token = options.token || '', timer = null, bundle = null, manifest = null, busy = null;
    let restoring;
    let status = {enabled: !!url, source: 'bootstrap', version: null, synced_at_ms: null, last_attempt_ms: null, error: null, cache_error: null};
    const notify = () => { for (const fn of listeners) fn(getStatus()); };
    const getStatus = () => ({...status, stale: !status.synced_at_ms || now() - status.synced_at_ms > 180000, manifest_url: url, revision: bundle?.revision ?? null});
    async function checksum(text) {
      if (!crypto?.subtle) throw new Error('Pemeriksaan SHA-256 memerlukan HTTPS atau localhost.');
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('');
    }
    async function verified(m, body) {
      if (!validateManifest(m)) throw new Error('Manifest model tidak valid.');
      const size = new TextEncoder().encode(body).length;
      if (size !== m.bytes || size > MAX_BYTES || await checksum(body) !== m.sha256) throw new Error('Ukuran atau checksum model tidak cocok.');
      const b = JSON.parse(body);
      if (!validateBundle(b)) throw new Error('Schema, parameter, fitur, atau konteks model tidak valid.');
      return b;
    }
    async function restore() {
      if (!url || !storage) return false;
      try {
        const raw = storage.getItem(CACHE_KEY + url);
        if (!raw || raw.length > MAX_BYTES * 2) return false;
        const saved = JSON.parse(raw), b = await verified(saved.manifest, saved.body);
        bundle = b; manifest = saved.manifest;
        status = {...status, source: 'cache', version: manifest.version, synced_at_ms: null}; notify(); return true;
      } catch (_) { status.cache_error = 'Cache model ditolak karena tidak valid.'; notify(); return false; }
    }
    async function read(fetchURL, limit) {
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), options.timeoutMs || 12000);
      try {
        const response = await fetcher(fetchURL, {cache: 'no-store', credentials: 'omit', redirect: 'error', signal: controller.signal, headers: token ? {Authorization: 'Bearer ' + token} : {}});
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const length = Number(response.headers?.get?.('content-length'));
        if (length > limit) throw new Error('Respons terlalu besar.');
        const text = await response.text();
        if (new TextEncoder().encode(text).length > limit) throw new Error('Respons terlalu besar.');
        return text;
      } finally { clearTimeout(timeout); }
    }
    async function sync() {
      if (!url) return false;
      if (busy) return busy;
      busy = (async () => {
        await restoring;
        status.last_attempt_ms = now();
        try {
          const m = JSON.parse(await read(url, 32768));
          if (!validateManifest(m)) throw new Error('Manifest model tidak valid.');
          // A new publication may intentionally roll back to an older model. Version is an identity, not an age gate.
          if (manifest?.version === m.version && manifest.sha256 === m.sha256 && bundle) {
            status = {...status, source: 'central', error: null, synced_at_ms: now()}; notify(); return true;
          }
          const artifactURL = new URL(m.artifact, url);
          if (artifactURL.origin !== new URL(url).origin) throw new Error('Artefak model harus berasal dari origin manifest.');
          const body = await read(artifactURL.href, MAX_BYTES), b = await verified(m, body);
          bundle = b; manifest = m;
          status = {...status, source: 'central', version: m.version, error: null, synced_at_ms: now()};
          try { storage?.setItem(CACHE_KEY + url, JSON.stringify({manifest: m, body})); status.cache_error = null; }
          catch (_) { status.cache_error = 'Cache browser penuh/tidak tersedia; model tetap dipakai di memori.'; }
          notify(); return true;
        } catch (error) {
          status = {...status, source: bundle ? 'cache' : 'bootstrap', error: 'Sinkronisasi gagal: ' + String(error.message || error)}; notify(); return false;
        } finally { busy = null; }
      })();
      return busy;
    }
    function start() { if (!timer && url) { sync(); timer = setInterval(sync, Math.max(10000, options.pollMs || 60000)); } }
    function stop() { if (timer) clearInterval(timer); timer = null; }
    function profile(row) { try { return bundle?.profiles.find(p => p.context_key === M.contextKey(row)) || null; } catch (_) { return null; } }
    const api = {
      sync, start, stop, ready: null, status: getStatus, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      bundle() { return bundle ? clone(bundle) : null; }, manifest() { return manifest ? clone(manifest) : null; },
      ingest(row) {
        if (!row || !['browser', 'termux'].includes(row.source)) return {accepted: false};
        let key; try { M.prepareContextRows([row]); key = M.contextKey(row); } catch (_) { return {accepted: false}; }
        const history = rows.get(key) || [], last = history.at(-1);
        if (last && (row.sent_at_ms <= last.sent_at_ms || (row.boot_id === last.boot_id && row.sequence <= last.sequence))) return {accepted: false};
        history.push(clone(row)); rows.set(key, history.slice(-6)); return {accepted: true, needsMaintenance: false};
      },
      forecast(row) {
        let key; try { key = M.contextKey(row); } catch (_) { return {status: 'unavailable', reason: 'Konteks belum dipilih.'}; }
        const history = rows.get(key) || [], last = history.at(-1), p = profile(row);
        if (!last || last.sequence !== row.sequence || last.boot_id !== row.boot_id) return {status: 'warming_up', reason: 'Menunggu data baru di dashboard ini.'};
        const f = M.forecastContext(p?.model || bundle?.frozen_ridge || DEFAULT, history);
        if (f.status === 'ready') {
          f.method = p?.method || 'ridge';
          f.prediction_ms = f.method === 'persistence' ? f.persistence_ms : f.method === 'moving_average' ? f.moving_average_ms : f.ml_prediction_ms;
          f.publication_version = status.version;
          f.origin = 'central_parameters';
        }
        return f;
      },
      classify(row) {
        let p; try { p = bundle?.clusters.find(p => p.context_key === qualityKey(row)); } catch (_) { return {quality: 'unknown', label: 'Tidak terklasifikasi'}; }
        return K.classify(p?.model || bundle?.frozen_clusters || K.defaultModel(), row);
      },
      inspect(row) {
        const p = row ? profile(row) : null; let q, key;
        try { key = M.contextKey(row); q = bundle?.clusters.find(p => p.context_key === qualityKey(row)); } catch (_) {}
        return {contextKey: key, sampleCount: rows.get(key)?.length || 0, modelId: (p?.model || bundle?.frozen_ridge || DEFAULT).model_id,
          modelProvenance: p?.model?.provenance || 'synthetic', method: p?.method || 'ridge', clusterModelId: (q?.model || bundle?.frozen_clusters || K.defaultModel()).model_id,
          clusterProvenance: q?.model?.provenance || 'synthetic', storageAvailable: !!storage, central: true,
          storageMessage: 'Training dan arsip berada di layanan pusat. Browser hanya menjalankan inferensi dari parameter yang tersinkronisasi.',
          publicationVersion: status.version, syncStatus: getStatus()};
      },
      exportRows(row) { try { return clone(rows.get(M.contextKey(row)) || []); } catch (_) { return []; } },
    };
    api.ready = restoring = restore();
    return api;
  }
  return {create, validateBundle, validateManifest, context, qualityKey, safeURL, MAX_BYTES};
});
