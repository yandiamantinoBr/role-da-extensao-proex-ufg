// Local-only: real SQLite/gzip/CAS, synthetic shared memory store, no network or credentials.
// Run with the pinned package manager: pnpm exec node scripts/benchmark-snapshot-authority.mjs
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {gunzipSync} from 'node:zlib';
import ts from 'typescript';
import {root} from '../tests/support/traffic-fixture.mjs';

const baselineRef='aab2d2f',requests=1000,syntheticProjects=1000;
const moduleUrl=source=>`data:text/javascript;base64,${Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64')}`;
const baseline=await import(moduleUrl(execFileSync('git',['show',`${baselineRef}:apps/proex-portal/platform-node/d1.ts`],{cwd:root,encoding:'utf8'})));
const current=await import(moduleUrl(readFileSync(new URL('../platform-node/d1.ts',import.meta.url),'utf8')));
const temporary=mkdtempSync(join(tmpdir(),'proex-snapshot-read-benchmark-'));
const migrations=[{name:'0000_synthetic_authority.sql',sql:'CREATE TABLE projects(id TEXT PRIMARY KEY,description TEXT NOT NULL); CREATE TABLE grants(user_id TEXT PRIMARY KEY,revoked INTEGER NOT NULL DEFAULT 0);'}];
const sql="SELECT description FROM projects WHERE id='project-0' AND EXISTS(SELECT 1 FROM grants WHERE user_id='synthetic-reader' AND revoked=0)";
const rounded=value=>Number(value.toFixed(3));
async function sample(SnapshotD1,label){
 let snapshot=null;const stats={A:{version:0,load:0,commit:0,loadedBytes:0},B:{version:0,load:0,commit:0,loadedBytes:0}};
 const store=client=>({async version(){stats[client].version++;return snapshot?.version??0;},async load(){stats[client].load++;if(!snapshot)return null;stats[client].loadedBytes+=snapshot.data.byteLength;return{version:snapshot.version,data:snapshot.data.slice()};},async commit(expected,data){stats[client].commit++;if((snapshot?.version??0)!==expected)return null;snapshot={version:expected+1,data:data.slice()};return snapshot.version;}});
 const a=new SnapshotD1(store('A'),migrations,join(temporary,`${label}-a.sqlite`),10**12),b=new SnapshotD1(store('B'),migrations,join(temporary,`${label}-b.sqlite`),10**12);
 const reset=()=>{for(const client of ['A','B'])stats[client]={version:0,load:0,commit:0,loadedBytes:0};};
 async function timings(task){reset();const times=[],start=performance.now();for(let i=0;i<requests;i++){const began=performance.now();await task();times.push(performance.now()-began);}times.sort((x,y)=>x-y);return{requests,metadata:{...stats.A},totalMs:rounded(performance.now()-start),p50Ms:rounded(times[Math.ceil(times.length*.5)-1]),p95Ms:rounded(times[Math.ceil(times.length*.95)-1])};}
 try{
  const seed=[a.prepare("INSERT INTO grants(user_id) VALUES('synthetic-reader')")];
  for(let i=0;i<syntheticProjects;i++)seed.push(a.prepare('INSERT INTO projects(id,description) VALUES(?,?)').bind(`project-${i}`,Array.from({length:8},(_,part)=>createHash('sha256').update(`synthetic-${i}-${part}`).digest('hex')).join('')));
  await a.batch(seed);await b.prepare('SELECT 1').all();assert.ok(await a.prepare(sql).first());
  const bytes={raw:gunzipSync(snapshot.data).byteLength,compressed:snapshot.data.byteLength};
  const single=await timings(async()=>assert.ok(await a.prepare(sql).first()));
  const readBatch=await timings(async()=>assert.equal((await a.batch([a.prepare(sql),a.prepare('SELECT COUNT(*) n FROM projects')]))[0].results.length,1));
  reset();await b.prepare("UPDATE grants SET revoked=1 WHERE user_id='synthetic-reader'").run();const row=await a.prepare(sql).first();
  return{snapshotBytes:bytes,single,readBatch,afterRevocation:{privateReadAllowed:row!==null,A:{...stats.A},B:{...stats.B}}};
 }finally{a.close();b.close();}
}
try{
 const before=await sample(baseline.SnapshotD1,'before'),after=await sample(current.SnapshotD1,'after');
 assert.equal(before.afterRevocation.privateReadAllowed,true);assert.equal(after.afterRevocation.privateReadAllowed,false);
 assert.deepEqual(after.single.metadata,{version:requests,load:0,commit:0,loadedBytes:0});assert.deepEqual(after.readBatch.metadata,{version:requests,load:0,commit:0,loadedBytes:0});
 assert.equal(after.afterRevocation.A.load,1);assert.equal(after.afterRevocation.A.commit,0);
 console.log(JSON.stringify({benchmark:'authoritative-snapshot-reads',baselineRef,requests,syntheticProjects,transport:'real SQLite/gzip/CAS; in-memory metadata/payload store, no network',limitation:'Local CPU measurement only, not production latency. Each metadata call adds the real store RTT; batching independent reads shares one authoritative check. No read TTL is enabled by the compatibility constructor argument.',before,after},null,2));
}finally{rmSync(temporary,{recursive:true,force:true});}
