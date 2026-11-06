#!/usr/bin/env node
'use strict';
// Build a static allowlist. Never point Pages at the repository root.
const fs = require('node:fs');
const path = require('node:path');
const {ArtifactStore,sanitizeBundle,hash} = require('../server/artifacts.cjs');
const DEFAULT = require('../models/default-rtt.json');
const ASSET_EXT = new Set(['.js','.css','.png','.jpg','.jpeg','.webp','.svg','.woff2','.ico','.txt']);
const EMPTY_SEED = "/* Central release: browser training backups are never published. */\n(function(r){r.SigHeatLearningSeed=null;})(globalThis);\n";
function buildPublic({root=path.resolve(__dirname,'..'),out=path.join(root,'public-dist')}={}) {
  root=path.resolve(root);out=path.resolve(out);
  const rel=path.relative(root,out);
  if(!rel||rel.startsWith('..')||path.isAbsolute(rel)||['assets','models','server','docs','tests','scripts'].includes(rel.split(path.sep)[0]))throw new Error('Output harus folder build tersendiri di dalam proyek.');
  if(fs.existsSync(out)&&fs.lstatSync(out).isSymbolicLink())throw new Error('Output build tidak boleh symlink.');
  fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
  function copy(file) { const from=path.join(root,file),to=path.join(out,file);if(fs.lstatSync(from).isSymbolicLink())throw new Error('Symlink tidak boleh diterbitkan: '+file);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to); }
  for(const file of ['index.html','dashboard.html'])copy(file);
  fs.writeFileSync(path.join(out,'.nojekyll'),'');
  function assets(dir) {
    for(const entry of fs.readdirSync(path.join(root,dir),{withFileTypes:true})) {
      if(entry.name.startsWith('.'))continue;
      const file=path.join(dir,entry.name);
      if(entry.isSymbolicLink())throw new Error('Symlink aset ditolak: '+file);
      if(entry.isDirectory())assets(file);
      else if(ASSET_EXT.has(path.extname(file).toLowerCase())&&(path.extname(file)!=='.txt'||/LICENSE|paho-EPL-1\.0/.test(entry.name))&&file!==path.join('assets','learning-seed.js'))copy(file);
    }
  }
  assets('assets');fs.writeFileSync(path.join(out,'assets','learning-seed.js'),EMPTY_SEED);
  const manifestPath=path.join(root,'models','latest.json');
  if(fs.existsSync(manifestPath)) {
    if(fs.lstatSync(manifestPath).isSymbolicLink())throw new Error('Symlink manifest ditolak.');
    const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
    if(manifest.schema!=='sigheat-model-manifest-v1'||!/^releases\/[a-z0-9][a-z0-9._-]{0,95}\.json$/.test(manifest.artifact))throw new Error('Manifest publik tidak valid.');
    const dir=path.join(root,'models','releases');
    if(!fs.existsSync(dir)||fs.lstatSync(dir).isSymbolicLink())throw new Error('Folder artefak publik tidak valid.');
    let referenced=false;
    for(const entry of fs.readdirSync(dir,{withFileTypes:true})) {
      if(!/^[a-z0-9][a-z0-9._-]{0,95}\.json$/.test(entry.name)||!entry.isFile())throw new Error('Isi folder rilis tidak valid.');
      const file=path.join('models','releases',entry.name),bytes=fs.readFileSync(path.join(root,file)),parsed=JSON.parse(bytes);
      if(JSON.stringify(parsed)!==JSON.stringify(sanitizeBundle(parsed)))throw new Error('Artefak rilis memuat field nonpublik.');
      if(manifest.artifact==='releases/'+entry.name){referenced=true;if(bytes.length!==manifest.bytes||hash(bytes)!==manifest.sha256)throw new Error('Checksum rilis tidak cocok.');}
      copy(file);
    }
    if(!referenced)throw new Error('Artefak rilis tidak ditemukan.');
    copy(path.join('models','latest.json'));
  } else {
    // Reproducible first installation: contains no measured model or telemetry.
    const store=new ArtifactStore({directory:path.join(out,'models'),now:()=>1793923200000});
    store.activate({schema:'sigheat-central-models-v1',revision:0,generated_at_ms:1793923200000,profiles:[],clusters:[],frozen_ridge:DEFAULT});
  }
  return out;
}
if(require.main===module){const out=buildPublic();process.stdout.write('Aset publik siap: '+out+'\n');}
module.exports={buildPublic};
