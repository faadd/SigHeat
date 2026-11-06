'use strict';
const path = require('node:path');
const C = require('../assets/core.js');

function integer(value, fallback, min, max, label) {
  const n = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${label} tidak valid.`);
  return n;
}
function readConfig(env = process.env, root = path.resolve(__dirname, '..')) {
  const projectId = env.SIGHEAT_PROJECT_ID || 'ABC';
  if (!C.validId(projectId)) throw new Error('SIGHEAT_PROJECT_ID: gunakan huruf, angka, - atau _, maksimal 48 karakter.');
  const brokerEndpoint = C.endpoint(env.SIGHEAT_BROKER_ENDPOINT || 'wss://broker.hivemq.com:8884/mqtt');
  if (!brokerEndpoint) throw new Error('SIGHEAT_BROKER_ENDPOINT harus URL wss tanpa kredensial/query.');
  const host = env.SIGHEAT_HOST || '127.0.0.1';
  if (!/^[A-Za-z0-9.:[\]-]+$/.test(host)) throw new Error('SIGHEAT_HOST tidak valid.');
  const localOnly = ['127.0.0.1', 'localhost', '::1'].includes(host);
  const readToken = env.SIGHEAT_READ_TOKEN || '';
  if (readToken && (readToken.length < 24 || /[\r\n]/.test(readToken))) throw new Error('SIGHEAT_READ_TOKEN harus sedikitnya 24 karakter tanpa baris baru.');
  if (!localOnly && !readToken) throw new Error('Isi SIGHEAT_READ_TOKEN sebelum membuka API ke jaringan.');
  const publicUrl = env.SIGHEAT_PUBLIC_URL || '';
  let publicHost = null;
  if (publicUrl) {
    const u = new URL(publicUrl);
    if (u.protocol !== 'https:' || u.origin !== publicUrl || u.username || u.password) throw new Error('SIGHEAT_PUBLIC_URL harus origin HTTPS tanpa path.');
    if (!readToken) throw new Error('SIGHEAT_READ_TOKEN wajib untuk URL pusat publik.');
    publicHost = u.host;
  }
  const allowedOrigins = (env.SIGHEAT_ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
  for (const origin of allowedOrigins) {
    let u; try { u = new URL(origin); } catch { throw new Error('SIGHEAT_ALLOWED_ORIGINS harus berisi origin HTTP/HTTPS dipisahkan koma.'); }
    if (!['http:', 'https:'].includes(u.protocol) || u.origin !== origin || u.username || u.password) throw new Error('Origin CORS harus tepat, contoh https://faadd.github.io (tanpa path).');
  }
  const mqttUrl = env.SIGHEAT_MQTT_URL || brokerEndpoint;
  let transport; try { transport = new URL(mqttUrl); } catch { throw new Error('SIGHEAT_MQTT_URL tidak valid.'); }
  if (transport.username || transport.password || transport.hash || transport.search ||
      !(['wss:', 'mqtts:'].includes(transport.protocol) ||
        ['mqtt:', 'ws:'].includes(transport.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(transport.hostname))) {
    throw new Error('Transport MQTT harus terenkripsi; mqtt/ws biasa hanya untuk pengujian localhost. Gunakan variabel username/password terpisah.');
  }
  const dataDir = path.resolve(root, env.SIGHEAT_DATA_DIR || 'private-data');
  const relative = path.relative(root, dataDir);
  if (!relative || /^(assets|models)(\/|\\|$)/.test(relative)) throw new Error('SIGHEAT_DATA_DIR tidak boleh di root proyek, assets, atau models.');
  const repository = env.SIGHEAT_GITHUB_REPOSITORY || '';
  if (repository && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('SIGHEAT_GITHUB_REPOSITORY harus owner/repo.');
  const pagesBaseUrl = env.SIGHEAT_PAGES_URL || '';
  if (pagesBaseUrl) {
    const u = new URL(pagesBaseUrl);
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) throw new Error('SIGHEAT_PAGES_URL harus HTTPS tanpa kredensial.');
  }
  return {
    root, projectId, brokerEndpoint, host, localOnly, publicUrl, publicHost,
    port: integer(env.SIGHEAT_PORT, 8787, 0, 65535, 'SIGHEAT_PORT'),
    readToken, allowedOrigins, mqttUrl,
    mqttUsername: env.SIGHEAT_MQTT_USERNAME || undefined,
    mqttPassword: env.SIGHEAT_MQTT_PASSWORD || undefined,
    dataDir, dbPath: path.join(dataDir, 'sigheat.sqlite'),
    repository, githubToken: env.SIGHEAT_GITHUB_TOKEN || '',
    githubBranch: env.SIGHEAT_GITHUB_BRANCH || 'main', pagesBaseUrl,
    publishCoalesceMs: integer(env.SIGHEAT_PUBLISH_COALESCE_SECONDS, 60, 0, 3600, 'SIGHEAT_PUBLISH_COALESCE_SECONDS') * 1000,
    maxPayloadBytes: 32768
  };
}
module.exports = { readConfig };
