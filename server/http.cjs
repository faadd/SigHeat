'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const TYPES = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8'};
const HTML = new Set(['index.html','dashboard.html','participant.html','devices.html','activity.html','guide.html']);
function secureEqual(a, b) {
  const aa = crypto.createHash('sha256').update(a).digest();
  const bb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(aa, bb);
}
function csvCell(value) {
  let text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (typeof value !== 'number' && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
function toCSV(rows) {
  if (!rows.length) return '';
  const fields = [...new Set(rows.flatMap(r => Object.keys(r)))];
  return [fields.map(csvCell).join(','), ...rows.map(r => fields.map(f => csvCell(r[f])).join(','))].join('\r\n') + '\r\n';
}
function filtersFrom(url) {
  const filters = {};
  for (const name of ['context', 'project', 'device', 'source', 'broker', 'model', 'status', 'candidate_status']) {
    const value = url.searchParams.get(name); if (value && value.length <= 2048) filters[name] = value;
  }
  for (const name of ['from', 'to', 'interval']) {
    const value = url.searchParams.get(name);
    if (value !== null) {
      if (!Number.isFinite(Number(value)) || Number(value) < 0) throw new Error('Filter waktu/interval tidak valid.');
      filters[name] = Number(value);
    }
  }
  return filters;
}
function createHttpServer({config, engine, artifacts, getStatus, getHistory = (filters) => engine.history(filters)}) {
  const rootReal = fs.realpathSync(config.root);
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org; connect-src 'self' https: wss: http://localhost:* http://127.0.0.1:*; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const send = (status, body, type = 'application/json; charset=utf-8') => {
      res.writeHead(status, {'Content-Type': type});
      res.end(req.method === 'HEAD' ? undefined : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    };
    try {
      // A hostile page can resolve its hostname to loopback (DNS rebinding).
      // Only explicit loopback Host names may use the optional-token local API.
      if (config.localOnly) {
        let host;
        try { host = new URL('http://' + req.headers.host).hostname; } catch { return send(400,{error:'Host tidak valid.'}); }
        if (!['127.0.0.1','localhost','[::1]'].includes(host) && !(config.readToken && req.headers.host === config.publicHost)) return send(403,{error:'Host lokal tidak diizinkan.'});
      }
      const url = new URL(req.url, 'http://sigheat.local');
      const pathname = decodeURIComponent(url.pathname);
      if (pathname === '/healthz') return send(200, {service:'SigHeat central',ready:true});
      if (pathname.startsWith('/api/')) {
        const origin = req.headers.origin;
        const sameOrigin = origin && [ `http://${req.headers.host}`, `https://${req.headers.host}` ].includes(origin);
        if (origin && !sameOrigin && !config.allowedOrigins.includes(origin)) return send(403, {error:'Origin dashboard tidak diizinkan.'});
        if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
        if (req.method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Authorization');
          return send(204, '');
        }
        if (!['GET','HEAD'].includes(req.method)) return send(405,{error:'API hanya baca.'});
        if (config.readToken && !secureEqual(req.headers.authorization || '', `Bearer ${config.readToken}`)) return send(401,{error:'Kunci baca pusat diperlukan.'});
        if (pathname === '/api/status') return send(200, getStatus());
        if (pathname === '/api/history') {
          let filters; try { filters=filtersFrom(url); } catch { return send(400,{error:'Filter tidak valid.'}); }
          return send(200, getHistory({...filters,limit:2000}));
        }
        if (pathname === '/api/export') {
          let filters; try { filters=filtersFrom(url); } catch { return send(400,{error:'Filter tidak valid.'}); }
          const format = url.searchParams.get('format') || 'json';
          const type = url.searchParams.get('type') || 'predictions';
          const history = type === 'measurements' ? null : getHistory(filters);
          if (format === 'json') {
            res.setHeader('Content-Disposition','attachment; filename="sigheat-audit.json"');
            return send(200,{schema:'sigheat-audit-export-v1',exported_at_ms:Date.now(),filters,units:{rtt:'ms',mae:'ms',cluster_distance:'mean squared distance in fixed transformed feature space'},window_n:24,status:getStatus(),models:engine.modelBundle(),history:history || {measurements:engine.measurements(filters)}});
          }
          if (format !== 'csv' || !['predictions','blocks','candidates','events','clusterEvaluations','measurements'].includes(type)) return send(400,{error:'Format/jenis ekspor tidak dikenal.'});
          const rows = type === 'measurements' ? engine.measurements(filters) : history[type] || [];
          res.setHeader('Content-Disposition',`attachment; filename="sigheat-${type}.csv"`);
          return send(200,toCSV(rows),'text/csv; charset=utf-8');
        }
        if (pathname === '/api/models/latest.json') {
          const current = artifacts.current();
          if (!current) return send(503,{error:'Paket model belum tersedia.'});
          return send(200,current.manifest || current);
        }
        if (/^\/api\/models\/releases\/[A-Za-z0-9._-]+\.json$/.test(pathname)) {
          const relative = pathname.slice('/api/models/'.length);
          let bytes; try { bytes = artifacts.read(relative); } catch { return send(404,{error:'Versi model tidak ditemukan.'}); }
          if (!bytes) return send(404,{error:'Versi model tidak ditemukan.'});
          return send(200, bytes);
        }
        return send(404,{error:'API tidak ditemukan.'});
      }
      if (!['GET','HEAD'].includes(req.method)) return send(405,'Metode tidak didukung.','text/plain');
      if (pathname === '/assets/central-config.js') return send(200,"window.SigHeatCentralConfig = { apiURL: location.origin, mode: 'central' };\n",TYPES['.js']);
      const relative = pathname === '/' ? 'dashboard.html' : pathname.replace(/^\//,'');
      const extension = path.extname(relative).toLowerCase();
      const allowed = HTML.has(relative) || relative === '.nojekyll' ||
        /^assets\/[A-Za-z0-9_./-]+$/.test(relative) && !!TYPES[extension] && !relative.split('/').some(s=>s.startsWith('.')) ||
        /^models\/(default-rtt|default-clusters|latest)\.json$/.test(relative) || /^models\/releases\/[A-Za-z0-9._-]+\.json$/.test(relative);
      if (!allowed || relative.split('/').includes('..') || relative.includes('\\')) return send(404,'Tidak ditemukan.','text/plain');
      const file = path.resolve(config.root, relative);
      let real; try { real = fs.realpathSync(file); } catch { return send(404,'Tidak ditemukan.','text/plain'); }
      if (!real.startsWith(rootReal + path.sep) || !fs.statSync(real).isFile()) return send(404,'Tidak ditemukan.','text/plain');
      return send(200,fs.readFileSync(real),TYPES[extension] || 'text/plain');
    } catch (error) {
      if (res.headersSent) return res.end();
      return send(error instanceof URIError ? 400 : 500,{error:'Permintaan tidak dapat diproses. Periksa konfigurasi dan filter.'});
    }
  });
}
module.exports = {createHttpServer, filtersFrom, toCSV};
