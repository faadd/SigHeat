/* Read-only central audit views. Figures are drawn from recorded predictions, never replayed models. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.SigHeatCentralCharts = api; api.mount(root); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const labels = {actual: 'RTT aktual', active: 'Metode aktif', frozen: 'Model awal beku', persistence: 'RTT terakhir', moving_average: 'Rerata 6 RTT', candidate: 'Kandidat', incumbent: 'Model aktif', threshold: 'Ambang 0,95 × terbaik'};
  const colors = {actual: '#142f2b', active: '#247253', frozen: '#8b4c90', persistence: '#a36b17', moving_average: '#267fb1', candidate: '#247253', incumbent: '#a36b17', threshold: '#934841'};
  const statuses = {evaluating: 'Sedang dievaluasi', promoted: 'Diterima', rejected: 'Ditolak', training_failed: 'Training gagal', cancelled: 'Dibatalkan'};
  function keyParts(key) { try { const a = JSON.parse(key); return Array.isArray(a) ? a : []; } catch (_) { return []; } }
  function qualityKey(key) { const a = keyParts(key); return a.length === 6 ? JSON.stringify([a[0], a[2], a[3], a[4]]) : key; }
  function rowTime(row) { return row.target_at_ms ?? row.expected_target_ms ?? row.end_ms ?? row.completed_at_ms ?? row.at_ms ?? row.created_at_ms ?? 0; }
  function matches(row, f = {}) {
    const key = row.context_key || row.quality_context_key || '', parts = keyParts(key), shared = parts.length === 4;
    if (f.context && key !== f.context && key !== qualityKey(f.context)) return false;
    const project = row.project_id ?? parts[0], device = row.device_id ?? (shared ? null : parts[1]), source = row.source ?? parts[shared ? 1 : 2], broker = row.broker_endpoint ?? parts[shared ? 2 : 3], interval = row.interval_s ?? parts[shared ? 3 : 4];
    if (f.project && project !== f.project || f.device && !shared && device !== f.device || f.source && source !== f.source || f.broker && broker !== f.broker || f.interval && String(interval) !== String(f.interval)) return false;
    const time = rowTime(row);
    if (finite(f.from) && (row.start_ms ?? time) < f.from || finite(f.through) && time > f.through) return false;
    if (f.model && ![row.model_id, row.candidate_model_id, row.incumbent_model_id, ...(row.model_ids || [])].includes(f.model)) return false;
    return true;
  }
  function filterHistory(history, f) {
    const out = {};
    for (const name of ['predictions', 'blocks', 'candidates', 'events', 'clusterEvaluations', 'publicationEvents']) out[name] = (history?.[name] || []).filter(row => (name === 'publicationEvents' ? matches(row, {from:f.from, through:f.through}) : matches(row, f)) && (!(name === 'candidates' || name === 'clusterEvaluations') || !f.status || row.status === f.status));
    return out;
  }
  function exportSelection(history, filters) {
    const selected = filterHistory(history, filters), dependencies = new Set();
    for (const row of [...selected.blocks, ...selected.candidates]) for (const id of row.prediction_ids || []) dependencies.add(id);
    const present = new Set(selected.predictions.map(row => row.id));
    for (const row of history.predictions || []) if (dependencies.has(row.id) && !present.has(row.id)) selected.predictions.push({...row, dependency_only: true});
    selected.predictions.sort((a,b)=>rowTime(a)-rowTime(b));
    return selected;
  }
  function recomputeMAE(predictions) {
    const valid = predictions.filter(p => p.status === 'valid' && finite(p.actual_ms) && ['active', 'frozen', 'persistence', 'moving_average'].every(k => finite(p[k + '_ms'])));
    const mae_ms = {};
    for (const k of ['active', 'frozen', 'persistence', 'moving_average']) mae_ms[k] = valid.length ? valid.reduce((s, p) => s + Math.abs(p[k + '_ms'] - p.actual_ms), 0) / valid.length : null;
    return {n: valid.length, mae_ms};
  }
  function csvCell(value) {
    let s = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (typeof value === 'string' && /^[\s]*[=+@-]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function exportCSV(history, metadata = {}) {
    const fields = ['record_type', 'id', 'algorithm', 'dependency_only', 'type', 'kind', 'at_ms', 'version', 'commit_sha', 'phase', 'attempt', 'context_key', 'project_id', 'device_id', 'source', 'broker_endpoint', 'interval_s', 'created_at_ms', 'input_end_ms', 'target_boot_id', 'target_sequence', 'target_at_ms', 'expected_target_ms', 'target_received_at_ms', 'actual_ms', 'active_ms', 'frozen_ms', 'persistence_ms', 'moving_average_ms', 'candidate_ms', 'method', 'model_id', 'candidate_id', 'revision', 'status', 'reason', 'n', 'start_ms', 'end_ms', 'mae_ms', 'errors_ms', 'prediction_ids', 'target_ids', 'distances', 'model_ids', 'methods', 'mixed_versions', 'threshold', 'improvement_pct', 'candidate_mean_squared_distance', 'incumbent_mean_squared_distance', 'unit', 'window', 'export_metadata'];
    const rows = [];
    for (const type of ['predictions', 'blocks', 'candidates', 'events', 'clusterEvaluations', 'publicationEvents']) for (const row of history[type] || []) rows.push({...row, record_type: type, unit: type === 'clusterEvaluations' || row.algorithm === 'kmeans' ? 'fixed_feature_squared_distance' : 'ms', window: 6, export_metadata: metadata});
    return '\ufeff' + [fields.join(','), ...rows.map(row => fields.map(k => csvCell(row[k])).join(','))].join('\r\n');
  }
  function mount(root) {
    const d = root.document;
    if (!d || d.body.dataset.page !== 'dashboard' || !d.getElementById('central-learning') || !root.SigHeatCentralClient) return;
    const $ = id => d.getElementById(id), text = (id, value) => { $(id).textContent = value; };
    const el = (tag, value, className) => { const node = d.createElement(tag); if (value != null) node.textContent = value; if (className) node.className = className; return node; };
    let local, session;
    try { local = root.localStorage; session = root.sessionStorage; } catch (_) {}
    let config = {mode: 'central', apiURL: '', manifestURL: ''};
    try {
      const saved=JSON.parse(local?.getItem('sigheat.central.config.v1') || '{}');
      if(saved && ['central','local'].includes(saved.mode) && typeof saved.apiURL==='string' && typeof saved.manifestURL==='string') {
        if(saved.apiURL)root.SigHeatCentralClient.safeURL(saved.apiURL,root.location.href);
        if(saved.manifestURL)root.SigHeatCentralClient.safeURL(saved.manifestURL,root.location.href);
        config={mode:saved.mode,apiURL:saved.apiURL,manifestURL:saved.manifestURL};
      }
    } catch (_) {}
    const injected = root.SigHeatCentralConfig || {};
    if (injected.apiURL) config = {...config, ...injected, manifestURL: injected.manifestURL || '', mode: 'central'};
    let savedToken = ''; try { savedToken = session?.getItem('sigheat.central.read-key') || ''; } catch (_) {}
    let token = savedToken, client = null, state = null, history = {}, filtered = {}, lastApiAt = null, apiError = '', loading = false, refreshAgain = false, centralEnabled = false;
    let selectedRow = null, selectedContext = '', refreshTimer, modelTimer, visibilityDemo = false, configGeneration = 0;
    const listeners = new Set();
    const date = (n, detailed = false) => finite(n) ? new Intl.DateTimeFormat('id-ID', {timeZone: $('central-timezone').value, ...(detailed ? {year: 'numeric', month: '2-digit', day: '2-digit'} : {}), hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false}).format(n) : '—';
    const number = (n, digits = 2) => finite(n) ? n.toLocaleString('id-ID', {maximumFractionDigits: digits}) : '—';
    function notify() { for (const fn of listeners) fn(); }
    function apiBase() { return config.apiURL.replace(/\/$/, ''); }
    async function request(path, requestConfig = config, readKey = token) {
      if (!requestConfig.apiURL) throw new Error('URL layanan pusat belum diatur.');
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await root.fetch(requestConfig.apiURL.replace(/\/$/, '') + path, {cache: 'no-store', credentials: 'omit', redirect: 'error', signal: controller.signal, headers: readKey ? {Authorization: 'Bearer ' + readKey} : {}});
        if (!response.ok) throw new Error('HTTP ' + response.status + (response.status === 401 ? ' · Periksa kunci baca API.' : ''));
        return await response.json();
      } finally { clearTimeout(timeout); }
    }
    function setOptions(id, values, placeholder) {
      const select = $(id), previous = select.value;
      select.replaceChildren(el('option', placeholder)); select.firstChild.value = '';
      for (const [value, title] of values) { const option = el('option', title); option.value = value; select.append(option); }
      select.value = Array.from(select.options).some(o => o.value === previous) ? previous : '';
    }
    function contexts() {
      return state?.contexts || [];
    }
    function fillFilters() {
      const items = contexts();
      const fields = [['project', 'project_id'], ['device', 'device_id'], ['source', 'source'], ['broker', 'broker_endpoint'], ['interval', 'interval_s']];
      for (const [name, key] of fields) {
        const values = [...new Set(items.map(item => item[key] ?? keyParts(item.context_key || item.key)[{project_id:0,device_id:1,source:2,broker_endpoint:3,interval_s:4}[key]]).filter(v => v != null))].sort();
        setOptions('central-' + name, values.map(v => [String(v), String(v) + (name === 'interval' ? ' detik' : '')]), 'Semua ' + name);
      }
      const ids = new Set();
      for (const type of ['predictions', 'candidates', 'events']) for (const p of history[type] || []) for (const id of [p.model_id, p.incumbent_model_id]) if (id) ids.add(id);
      setOptions('central-model-filter', [...ids].sort().map(v => [v, v]), 'Semua model');
      fillContexts();
    }
    function fillContexts() {
      const f = {...filters(false), from:null, through:null}, items = contexts().filter(item => matches({...item, context_key: item.context_key || item.key}, f));
      const previous = $('central-context').value || selectedContext;
      setOptions('central-context', items.map(item => { const key = item.context_key || item.key, a = keyParts(key); return [key, `${a[0]} · ${a[1]} · ${a[2]} · ${a[4]} dtk · ${a[5]} · ${a[3]}`]; }), 'Pilih satu konteks');
      if (items.some(item => (item.context_key || item.key) === previous)) $('central-context').value = previous;
      else if (items.length) $('central-context').value = items[0].context_key || items[0].key;
      selectedContext = $('central-context').value;
    }
    function filters(withContext = true) {
      const range = id => { const s = $(id).value; if (!s) return null; const n = Date.parse(s + ($('central-timezone').value === 'UTC' ? 'Z' : '+07:00')); return finite(n) ? n : null; };
      return {context: withContext ? $('central-context').value : '', project: $('central-project').value, device: $('central-device').value, source: $('central-source').value, broker: $('central-broker').value, interval: $('central-interval').value, from: range('central-from'), through: range('central-through'), model: withContext ? $('central-model-filter').value : '', status: withContext ? $('central-candidate-filter').value : ''};
    }
    function chartMetadata() {
      return {generated_at_ms: Date.now(), timezone: $('central-timezone').value, filters: filters(), unit: 'ms (RTT/MAE); fixed_feature_squared_distance (K-Means)', window: 6, block_targets: 24, model_publication_version: client?.status().version || null, central_revision: state?.revision ?? null, valid_target_count: filtered.predictions?.filter(p => p.status === 'valid').length || 0, truncated: !!history.truncated, observed_range_start_ms: filtered.predictions?.length ? Math.min(...filtered.predictions.map(rowTime)) : null, observed_range_end_ms: filtered.predictions?.length ? Math.max(...filtered.predictions.map(rowTime)) : null, model_ids: [...new Set((filtered.predictions||[]).map(p=>p.model_id))], policy: history.policy || state?.policy || null, source: 'central_recorded_before_target', no_replay: true};
    }
    function renderStatus() {
      const s = client?.status();
      text('central-service-state', !centralEnabled ? 'Mode lokal pada browser' : !config.apiURL ? 'Mode terbitan · riwayat belum terhubung' : apiError ? 'Tidak dapat dihubungi' : state ? (state.broker?.connected === false ? 'Pusat aktif · MQTT terputus' : 'Pusat aktif') : 'Menghubungkan…');
      const stats = state?.stats || {};
      text('central-service-note', state ? `Revisi aktif ${state.revision ?? '—'} · ${state.active_devices ?? 0} perangkat aktif · ${stats.accepted ?? 0} pengukuran diterima · ${stats.timeouts ?? 0} timeout · ${stats.excluded_predictions ?? 0} pasangan dikeluarkan. Diperiksa ${date(lastApiAt, true)}.` : 'Pengukuran hanya dikumpulkan selama pusat dan edge aktif.');
      text('central-model-state', s?.version ? `${s.source === 'cache' ? 'Cache · ' : ''}${s.version}` : centralEnabled ? 'Bootstrap sintetis · belum sinkron' : 'Model lokal / sintetis');
      text('central-sync-note', !centralEnabled ? 'Training terjadi hanya pada browser ini.' : s?.error || `${config.manifestURL || !config.apiURL ? 'Sumber manifest terbitan' : 'Parameter pusat'} · sinkron ${date(s?.synced_at_ms, true)}${s?.stale ? ' · perlu diperbarui' : ''}. Pemeriksaan tiap 60 detik.`);
      const p = state?.publication || {};
      text('central-publish-state', !state ? 'Belum diperiksa' : !p.enabled ? 'Belum dikonfigurasi' : p.current?.phase || (p.queued ? 'Antrean publikasi' : 'Menunggu perubahan model'));
      text('central-publish-note', `Commit: ${p.committed?.version || p.committed_version || p.committedVersion || p.last_committed_version || 'belum terkonfirmasi'} · Pages: ${p.deployed?.version || p.deployed_version || p.deployedVersion || p.pages_version || 'belum terkonfirmasi'}. Aktif di pusat tidak otomatis berarti sudah terbit.${p.current?.error ? ' '+p.current.error : ''}`);
      const message = !centralEnabled ? 'Mode lokal masih terpisah per browser. Pilih Terpusat dan isi URL pusat untuk pembelajaran bersama.' : apiError || s?.error || (visibilityDemo ? 'Dashboard menampilkan contoh lokal. Grafik di bawah tetap arsip pengukuran nyata dari pusat, terpisah dari demo.' : state ? 'Grafik memakai log pengukuran nyata pusat. Tidak ada training atau promosi model pada browser ini.' : 'Model terbitan disinkronkan otomatis. Isi URL layanan pusat untuk melihat riwayat pengukuran dan grafik bersama.');
      text('central-message', message); $('central-message').classList.toggle('central-error', !!apiError);
      $('central-export-all').disabled = !centralEnabled || !config.apiURL;
    }
    function table(id, headers, rows) {
      const host = $(id); host.replaceChildren();
      if (!rows.length) { host.append(el('p', 'Belum ada catatan sesuai filter.', 'central-empty')); return; }
      const t = el('table'), head = el('thead'), tr = el('tr'), body = el('tbody');
      for (const title of headers) { const th = el('th', title); th.scope = 'col'; tr.append(th); } head.append(tr); t.append(head);
      for (const values of rows) { const r = el('tr'); for (const value of values) r.append(el('td', value ?? '—')); body.append(r); } t.append(body); host.append(t);
    }
    function svgNode(tag, attributes, content) { const node = d.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attributes || {})) node.setAttribute(k, String(v)); if (content != null) node.textContent = content; return node; }
    function chart(id, title, points, series, unit = 'ms', empty = 'Belum ada evaluasi yang lengkap. Biarkan pengukuran berjalan; nilai tidak dibuat-buat.') {
      const host = $(id); host.replaceChildren();
      const values = points.flatMap(p => series.map(k => p[k]).filter(finite));
      if (!points.length || !values.length || !$('central-context').value) { host.append(el('p', !$('central-context').value ? 'Pilih satu konteks untuk membandingkan model pada pengukuran yang sama.' : empty, 'central-empty')); return; }
      const w = 1000, h = 320, left = 70, right = 24, top = 44, bottom = 72, plotW = w-left-right, plotH = h-top-bottom;
      const start = Math.min(...points.map(p => p.time)), end = Math.max(...points.map(p => p.time)), max = Math.max(...values) * 1.08 || 1;
      const x = value => left + (end === start ? .5 : (value-start)/(end-start))*plotW, y = value => top + plotH*(1-value/max);
      const svg = svgNode('svg', {viewBox:`0 0 ${w} ${h}`,role:'img','aria-label':title});
      svg.append(svgNode('title', {}, title), svgNode('desc', {}, `${unit}. Zona ${$('central-timezone').value}. ${JSON.stringify({...chartMetadata(),chart_title:title,chart_unit:unit,chart_start_ms:start,chart_end_ms:end,plotted_points:points.length,series})}`), svgNode('rect',{width:w,height:h,fill:'#ffffff'}),svgNode('text',{x:left,y:20,fill:'#193c31','font-size':14,'font-family':'sans-serif'},title+' · '+unit));
      for(let i=0;i<=4;i++){ const value=max*i/4, yy=y(value); svg.append(svgNode('line',{x1:left,y1:yy,x2:w-right,y2:yy,stroke:'#dae4dc','stroke-width':1}),svgNode('text',{x:left-10,y:yy+4,'text-anchor':'end',fill:'#516a5e','font-size':11,'font-family':'sans-serif'},number(value,unit==='ms'?1:5))); }
      for(const t of (start===end?[start]:Array.from({length:5},(_,i)=>start+(end-start)*i/4))){ svg.append(svgNode('text',{x:x(t),y:h-bottom+22,'text-anchor':'middle',fill:'#516a5e','font-size':11,'font-family':'sans-serif'},date(t))); }
      let previousVersion = null;
      for(const p of points){ if(p.version && previousVersion && p.version!==previousVersion){const line=svgNode('line',{x1:x(p.time),x2:x(p.time),y1:top,y2:h-bottom,stroke:'#8f9c94','stroke-dasharray':'4 5'});line.append(svgNode('title',{},'Versi/metode berubah: '+p.version));svg.append(line);} if(p.version)previousVersion=p.version; }
      series.forEach((key,index)=>{
        let path='', drawing=false;
        for(const p of points){ if(!finite(p[key])){drawing=false;continue;}path+=(drawing?' L ':' M ')+x(p.time).toFixed(2)+' '+y(p[key]).toFixed(2);drawing=true; }
        svg.append(svgNode('path',{d:path,fill:'none',stroke:colors[key]||'#536d61','stroke-width':key==='actual'?2.5:1.8,...(key==='frozen'||key==='threshold'?{'stroke-dasharray':'6 4'}:{})}));
        for(const p of points){if(!finite(p[key]))continue;const circle=svgNode('circle',{cx:x(p.time),cy:y(p[key]),r:3,fill:colors[key]||'#536d61',tabindex:'0'});const hint=`${labels[key]||key}: ${number(p[key],6)} ${unit}\n${date(p.time,true)} ${$('central-timezone').value}\n${p.note||''}`;circle.setAttribute('aria-label',hint);circle.append(svgNode('title',{},hint));svg.append(circle);}
        const xx=left+index*170;svg.append(svgNode('line',{x1:xx,x2:xx+18,y1:h-25,y2:h-25,stroke:colors[key]||'#536d61','stroke-width':3}),svgNode('text',{x:xx+24,y:h-21,fill:'#193c31','font-size':11,'font-family':'sans-serif'},labels[key]||key));
      });
      host.append(svg);
    }
    function renderGraphs() {
      filtered = filterHistory(history, filters());
      const selectedSeries = Array.from(d.querySelectorAll('[data-central-series]:checked')).map(n=>n.dataset.centralSeries);
      const predictions = [...filtered.predictions].sort((a,b)=>rowTime(a)-rowTime(b));
      const valid = predictions.filter(p=>p.status==='valid').length, excluded = predictions.filter(p=>p.status==='excluded').length;
      text('central-range-note', `${predictions.length} catatan prediksi · ${valid} target valid · ${excluded} pasangan dikeluarkan · ${filtered.blocks.length} blok lengkap. Zona ${$('central-timezone').value}.${history.truncated ? ' Respons dibatasi; unduh seluruh arsip pusat untuk riwayat lengkap.' : ''}`);
      chart('central-rtt-chart','RTT aktual dan prediksi',predictions.map(p=>({time:rowTime(p),actual:p.actual_ms,active:p.status==='valid'?p.active_ms:null,frozen:p.status==='valid'?p.frozen_ms:null,persistence:p.status==='valid'?p.persistence_ms:null,moving_average:p.status==='valid'?p.moving_average_ms:null,version:p.model_id+' / '+p.method,note:`${p.device_id} · dibuat ${date(p.created_at_ms,true)} · target ${p.target_boot_id}/${p.target_sequence}\n${p.method} · ${p.model_id} · ${p.status}${p.reason?' · '+p.reason:''}\nGalat aktif ${number(p.errors_ms?.active)} ms`})),['actual',...selectedSeries]);
      chart('central-mae-chart','MAE blok 24 target',filtered.blocks.map(b=>({time:b.end_ms,...b.mae_ms,version:(b.model_ids||[]).join(',')+' / '+(b.methods||[]).join(','),note:`n=${b.n} · ${date(b.start_ms,true)} — ${date(b.end_ms,true)}\n${b.mixed_versions?'Sistem adaptif campuran':'Satu versi/metode'} · ${(b.model_ids||[]).join(', ')}\nBlok ${b.id}`})),selectedSeries);
      const ridge = filtered.candidates.filter(c=>c.algorithm==='ridge');
      chart('central-candidate-chart','Evaluasi kandidat Ridge',ridge.map(c=>({time:c.completed_at_ms||c.created_at_ms,...(c.mae_ms||{}),threshold:c.threshold,version:c.model_id,note:`${c.id} · ${statuses[c.status]||c.status} · n=${c.n}/${c.required}\n${c.reason||''}`})),['candidate','incumbent','persistence','moving_average','threshold']);
      table('central-candidates-table',['Waktu / kandidat','Status / n','MAE kandidat / aktif','RTT terakhir / rerata','Ambang / perbaikan','Keputusan / data latihan'],ridge.map(c=>[`${date(c.completed_at_ms||c.created_at_ms,true)} · ${c.model_id||c.id}`,`${statuses[c.status]||c.status} · ${c.n||0}/${c.required||24}`,`${number(c.mae_ms?.candidate)} / ${number(c.mae_ms?.incumbent)} ms`,`${number(c.mae_ms?.persistence)} / ${number(c.mae_ms?.moving_average)} ms`,`${number(c.threshold)} ms · ${finite(c.improvement_pct)?number(c.improvement_pct)+'%':'Tidak tersedia (mis. acuan nol/belum lengkap)'}`,`${c.reason||'Menunggu evaluasi'} · ${c.report?.rows?.total||c.training_measurement_ids?.length||'—'} baris · alpha ${c.report?.alpha??'—'}`]));
      const cluster=filtered.candidates.filter(c=>c.algorithm==='kmeans');
      chart('central-cluster-chart','Rata-rata jarak kuadrat K-Means',cluster.map(c=>({time:c.completed_at_ms||c.created_at_ms,candidate:c.candidate_mean_squared_distance,incumbent:c.incumbent_mean_squared_distance,threshold:c.threshold,version:c.model_id,note:`${c.id} · ${statuses[c.status]||c.status} · n=${c.n}/${c.required}\n${c.reason||''}`})),['candidate','incumbent','threshold'],'jarak kuadrat');
      table('central-clusters-table',['Waktu / model','Status / n','Kandidat / aktif','Ambang / perbaikan','Alasan'],cluster.map(c=>[`${date(c.completed_at_ms||c.created_at_ms,true)} · ${c.model_id||c.id}`,`${statuses[c.status]||c.status} · ${c.n||0}/${c.required||24}`,`${number(c.candidate_mean_squared_distance,8)} / ${number(c.incumbent_mean_squared_distance,8)}`,`${number(c.threshold,8)} · ${finite(c.improvement_pct)?number(c.improvement_pct)+'%':'—'}`,c.reason||'Menunggu evaluasi']));
      const qkey=qualityKey($('central-context').value), q=(state?.quality_contexts||[]).find(q=>(q.context_key||q.key)===qkey), counts=el('div',null,'central-counts');
      ['Rendah','Sedang','Tinggi'].forEach((name,i)=>counts.append(el('span',`${name}: ${q?.counts?.[i]??'—'}`))); counts.append(el('span',`Tidak terklasifikasi: ${q?.unknown??'—'}`)); $('central-cluster-counts').replaceChildren(counts,el('p',`Keanggotaan sejak aktivasi model pusat ${q?.model_id||'—'}; tidak mengikuti rentang waktu grafik. Profil tanpa fitur lengkap dihitung terpisah.`, 'small muted'));
      table('central-timeline-table',['Waktu','Peristiwa / status','Model / metode','Rincian'],[...filtered.events.filter(e=>e.scope!=='publication'),...(filtered.publicationEvents||[])].sort((a,b)=>(b.at_ms||b.created_at_ms)-(a.at_ms||a.created_at_ms)).map(e=>[date(e.at_ms||e.created_at_ms,true),e.type||e.kind,e.model_id||e.method||e.version||'—',JSON.stringify(e)]));
      const b=client?.bundle(); text('central-model-parameters',b?JSON.stringify({manifest:client.manifest(),revision:b.revision,profiles:b.profiles.filter(p=>p.context_key===$('central-context').value),clusters:b.clusters.filter(p=>p.context_key===qkey),frozen_ridge:b.frozen_ridge,candidate_history:filtered.candidates.map(c=>({id:c.id,context_key:c.context_key,status:c.status,training_rows:c.training_rows,policy:c.policy,report:c.report,model:c.model}))},null,2):'Belum ada paket model pusat valid.');
      $('central-export-csv').disabled=!predictions.length&&!filtered.candidates.length; $('central-export-json').disabled=!b&&!state;
    }
    async function refresh() {
      if(!centralEnabled)return;if(loading){refreshAgain=true;return;}loading=true;$('central-refresh').disabled=true;
      const generation=configGeneration, activeClient=client, activeConfig={...config}, activeKey=token;
      try { await activeClient?.sync(); if(generation!==configGeneration)return; if(activeConfig.apiURL){const s=await request('/api/status',activeConfig,activeKey);if(generation!==configGeneration)return;state=s;fillFilters();const f=filters(),query=new URLSearchParams({limit:'2000'});if(f.context)query.set('context',f.context);if(f.from!==null)query.set('from',String(f.from));if(f.through!==null)query.set('to',String(f.through));if(f.model)query.set('model',f.model);if(f.status)query.set('candidate_status',f.status);const h=await request('/api/history?'+query.toString(),activeConfig,activeKey);if(generation!==configGeneration)return;history=h;lastApiAt=Date.now();apiError='';fillFilters();renderGraphs();} }
      catch(error){if(generation!==configGeneration)return;apiError='Riwayat pusat belum diperbarui: '+String(error.message||error)+'. Data lama tetap diberi waktu pembaruan.';}
      finally{if(generation===configGeneration){loading=false;$('central-refresh').disabled=false;renderStatus();notify();if(refreshAgain){refreshAgain=false;refresh();}}}
    }
    function applyConfig() {
      const generation=++configGeneration; loading=false;refreshAgain=false;
      client?.stop();clearInterval(refreshTimer);clearInterval(modelTimer);
      centralEnabled=config.mode==='central';state=null;history={};apiError='';lastApiAt=null;
      let manifestURL=config.manifestURL || (config.apiURL?apiBase()+'/api/models/latest.json':new URL('models/latest.json',root.location.href).href);
      client=root.SigHeatCentralClient.create({manifestURL:centralEnabled?manifestURL:'',token:config.apiURL&&!config.manifestURL?token:'',storage:local,baseURL:root.location.href});
      client.subscribe(()=>{renderStatus();notify();});
      root.SigHeatCentral.manager=client;
      $('central-mode').value=config.mode;$('central-api-url').value=config.apiURL;$('central-manifest-url').value=config.manifestURL;$('central-read-key').value=token;
      client.ready.then(()=>{if(generation!==configGeneration)return;renderStatus();if(centralEnabled)refresh();});
      if(centralEnabled)refreshTimer=setInterval(refresh,60000);
      renderStatus();renderGraphs();notify();
    }
    function download(content,name,type){const url=URL.createObjectURL(new Blob([content],{type})),a=el('a');a.href=url;a.download=name;d.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    $('central-config-form').addEventListener('submit',event=>{
      event.preventDefault();
      try{
        const mode=$('central-mode').value, raw=$('central-api-url').value.trim(), manifest=$('central-manifest-url').value.trim();
        const apiURL=raw?root.SigHeatCentralClient.safeURL(raw,root.location.href).replace(/\/$/,''):'',manifestURL=manifest?root.SigHeatCentralClient.safeURL(manifest,root.location.href):'';
        if(root.location.protocol==='https:'&&[apiURL,manifestURL].some(v=>v.startsWith('http:')&&!/^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(v)))throw new Error('Dashboard HTTPS memerlukan API HTTPS. Untuk mode lokal buka dashboard dari layanan pusat.');
        config={mode,apiURL,manifestURL};token=$('central-read-key').value.trim();
        try{local?.setItem('sigheat.central.config.v1',JSON.stringify(config));session?.setItem('sigheat.central.read-key',token);}catch(_){}
        applyConfig();
      }catch(error){text('central-message',String(error.message||error));$('central-message').classList.add('central-error');}
    });
    $('central-refresh').addEventListener('click',refresh);
    for(const name of ['project','device','source','broker','interval'])$('central-'+name).addEventListener('change',()=>{fillContexts();renderGraphs();refresh();});
    for(const name of ['context','from','through','timezone','model-filter','candidate-filter'])$('central-'+name).addEventListener('change',()=>{selectedContext=$('central-context').value;renderGraphs();renderStatus();refresh();});
    for(const input of d.querySelectorAll('[data-central-series]'))input.addEventListener('change',renderGraphs);
    for(const button of d.querySelectorAll('[data-central-svg]'))button.addEventListener('click',()=>{const svg=$(button.dataset.centralSvg).querySelector('svg');if(!svg){text('central-message','Grafik belum memiliki data untuk diunduh.');return;}download(new XMLSerializer().serializeToString(svg),button.dataset.centralSvg+'.svg','image/svg+xml');});
    $('central-export-csv').addEventListener('click',async()=>{
      const selectedFilters=filters(), metadata=chartMetadata();$('central-export-csv').disabled=true;
      try{
        if(!config.apiURL)throw new Error('URL layanan pusat diperlukan untuk ekspor log lengkap.');
        text('central-message','Mengambil log lengkap sesuai konteks untuk memastikan seluruh target pembanding ikut diekspor…');
        const query=new URLSearchParams({format:'json'});if(selectedFilters.context)query.set('context',selectedFilters.context);
        const archive=await request('/api/export?'+query.toString()), rows=exportSelection(archive.history||{},selectedFilters);
        download(exportCSV(rows,{...metadata,filters:selectedFilters,truncated:false,displayed_history_truncated:metadata.truncated,export_scope:'all_matching_records_and_referenced_prediction_dependencies',exported_prediction_count:rows.predictions.length}), 'sigheat-log-evaluasi-terfilter.csv','text/csv;charset=utf-8');
        text('central-message','CSV lengkap diunduh. Baris dependency_only menjaga semua target pembanding tetap tersedia walau berada di luar filter model/waktu.');
      }catch(error){text('central-message','Ekspor CSV gagal: '+String(error.message||error));}
      finally{$('central-export-csv').disabled=false;}
    });
    $('central-export-json').addEventListener('click',()=>download(JSON.stringify({metadata:chartMetadata(),status:state,manifest:client?.manifest(),models:client?.bundle(),history:filtered},null,2),'sigheat-metadata-evaluasi.json','application/json'));
    $('central-export-all').addEventListener('click',async()=>{try{const all=await request('/api/export?format=json');download(JSON.stringify(all,null,2),'sigheat-arsip-pusat.json','application/json');text('central-message','Arsip pusat diunduh. Simpan aman karena memuat riwayat pengukuran.');}catch(error){text('central-message','Ekspor gagal: '+String(error.message||error));}});
    root.SigHeatCentral={manager:client,enabled:()=>centralEnabled,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},status:()=>({config:{mode:config.mode,apiURL:config.apiURL,manifestURL:config.manifestURL},service:state,sync:client?.status(),error:apiError}),
      select(row,demo){selectedRow=row;visibilityDemo=!!demo;if(row&&row.source!=='demo'){const key=root.SigHeatML.contextKey(row);if(!selectedContext){selectedContext=key;fillContexts();renderGraphs();}}renderStatus();},
      inspect(row){const info=client?.inspect(row)||{};if(!row)return info;const p=state?.contexts?.find(p=>(p.context_key||p.key)===info.contextKey),q=state?.quality_contexts?.find(p=>(p.context_key||p.key)===qualityKey(info.contextKey));return {...info,sampleCount:p?.rows||info.sampleCount,totalAccepted:p?.total_accepted,forecastCandidate:p?.candidate,clusterCandidate:q?.candidate,lastForecastEvaluation:p?.last_evaluation,lastClusterEvaluation:q?.last_evaluation,trainingReport:history.candidates?.find(c=>c.id===p?.last_training?.id)?.report};},
      async exportDataset(row){try{const suffix=row?'&context='+encodeURIComponent(root.SigHeatML.contextKey(row)):'';const response=await root.fetch(apiBase()+'/api/export?format=csv&type=measurements'+suffix,{cache:'no-store',credentials:'omit',redirect:'error',headers:token?{Authorization:'Bearer '+token}:{}});if(!response.ok)throw new Error('HTTP '+response.status);download(await response.text(),'sigheat-dataset-pusat.csv','text/csv;charset=utf-8');}catch(error){text('central-message','Dataset gagal diunduh: '+String(error.message||error));}}
    };
    applyConfig();
    root.addEventListener('pagehide',()=>{client?.stop();clearInterval(refreshTimer);});
  }
  return {mount, matches, filterHistory, exportSelection, recomputeMAE, exportCSV, qualityKey};
});
