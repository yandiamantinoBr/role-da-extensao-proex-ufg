import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import ts from 'typescript';

// Comunidade fase 2 (0037): recados e selos. Dados sintéticos.
const root=fileURLToPath(new URL('../',import.meta.url)),cache=new Map(),url=code=>`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const replacements=new Map([[resolve(root,'lib/session.ts'),url('export async function getPortalUser(){return null;}')],[resolve(root,'lib/platform.ts'),url('export function database(){return null;}')]]);
function compile(file){file=resolve(root,file);if(replacements.has(file))return replacements.get(file);if(cache.has(file))return cache.get(file);let code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;code=code.replace(/from (['"])([^'"]+)\1/g,(match,_quote,dep)=>{if(!dep.startsWith('.')&&!dep.startsWith('@/'))return match;const target=dep.startsWith('@/')?resolve(root,dep.slice(2)):resolve(dirname(file),dep);return `from ${JSON.stringify(compile(target.endsWith('.ts')?target:`${target}.ts`))}`;});const result=url(code);cache.set(file,result);return result;}
const access=await import(compile('lib/access.ts')),messages=await import(compile('lib/community/messages.ts')),badges=await import(compile('lib/community/badges.ts')),privacy=await import(compile('lib/privacy.ts'));
function fixture(t){const native=new DatabaseSync(':memory:');native.exec('PRAGMA foreign_keys=ON');for(const f of readdirSync(`${root}drizzle`).filter(x=>x.endsWith('.sql')).sort())native.exec(readFileSync(`${root}drizzle/${f}`,'utf8'));const now=new Date().toISOString();
 const insert=(table,row)=>{const cols=Object.keys(row);native.prepare(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')})`).run(...Object.values(row));};
 const db={beforeBatch:null,prepare(sql){let values=[];return{bind(...args){values=args;return this;},async first(column){const row=native.prepare(sql).get(...values)??null;return column?row?.[column]??null:row;},async all(){return{results:native.prepare(sql).all(...values),success:true};},async run(){return this.execute();},execute(){const results=native.prepare(sql).all(...values);return{results,success:true,meta:{changes:Number(native.prepare('SELECT changes() AS n').get().n)}};}};},async batch(statements){if(this.beforeBatch){const hook=this.beforeBatch;this.beforeBatch=null;hook();}native.exec('BEGIN');try{const r=statements.map(s=>s.execute());native.exec('COMMIT');return r;}catch(e){native.exec('ROLLBACK');throw e;}}};
 const user=async(id,role,project=null,org=null)=>{insert('portal_users',{user_id:id,email:`${id}@example.invalid`,status:'active',created_at:now,updated_at:now});insert('profiles',{user_id:id,display_name:`Pessoa ${id}`,created_at:now,updated_at:now});if(role)insert('members',{id:`m-${id}`,user_id:id,email:`${id}@example.invalid`,role,project_id:project,organization_id:org,created_at:now});return access.getActor(db,{userId:id,email:`${id}@example.invalid`,displayName:`Pessoa ${id}`});};
 for(const id of ['a','b']){insert('organizations',{id:`o-${id}`,name:`Org ${id}`,slug:`org-${id}`,created_at:now,updated_at:now});insert('projects',{id:`p-${id}`,name:`Projeto ${id}`,organization_id:`o-${id}`,created_at:now});}
 t.after(()=>native.close());return{native,db,user,now,insert};}
const count=(f,table,where='1=1',...values)=>Number(f.native.prepare(`SELECT count(*) n FROM ${table} WHERE ${where}`).get(...values).n);
const send=(f,actor,recipientId,body='Recado sintético.',organizationId='o-a')=>messages.messageAction(f.db,actor,{action:'send',organizationId,recipientId,body,operationKey:crypto.randomUUID()});

test('recados: only people who share the organization; recipient-only read; no management reading path',async t=>{const f=fixture(t),a=await f.user('a','viewer','p-a','o-a'),b=await f.user('b','operator','p-a','o-a'),c=await f.user('c','viewer','p-b','o-b'),owner=await f.user('owner','owner');
 const people=await messages.messagePeople(f.db,a);assert.deepEqual(people.organizations.map(o=>o.id),['o-a']);assert.ok(people.organizations[0].people.some(p=>p.id==='b'));assert.ok(!JSON.stringify(people).includes('example.invalid'),'names only, never e-mails');assert.ok(!people.organizations[0].people.some(p=>p.id==='c'));
 const sent=await send(f,a,'b');await assert.rejects(()=>send(f,a,'c'),e=>e.status===409);await assert.rejects(()=>send(f,a,'c','Outra organização','o-b'),e=>e.status===403);await assert.rejects(()=>send(f,a,'a'),e=>e.status===400);
 const inbox=await messages.messageList(f.db,b);assert.equal(inbox.unread,1);assert.equal(inbox.inbox[0].senderName,'Pessoa a');
 assert.equal((await messages.messageList(f.db,owner)).inbox.length,0,'the global owner does not read other people\'s messages');assert.equal((await messages.messageList(f.db,c)).inbox.length,0);
 await assert.rejects(()=>messages.messageAction(f.db,a,{action:'read',id:sent.id}),e=>e.status===404,'only the recipient marks as read');await messages.messageAction(f.db,b,{action:'read',id:sent.id});assert.equal(await messages.unreadMessages(f.db,'b'),0);
 await assert.rejects(()=>messages.messageAction(f.db,c,{action:'hide',id:sent.id}),e=>e.status===404);await messages.messageAction(f.db,a,{action:'hide',id:sent.id});assert.equal((await messages.messageList(f.db,a)).sent.length,0);assert.equal((await messages.messageList(f.db,b)).inbox.length,1,'hiding is per person');
 assert.equal(count(f,'audit',"action LIKE 'community.%'"),0);assert.ok((await messages.messagePeople(f.db,owner)).organizations.length>=2,'the global owner can write to anyone');});

test('recados: block, revocation inside the batch, retry and daily ceiling',async t=>{const f=fixture(t),a=await f.user('a','viewer','p-a','o-a'),b=await f.user('b','viewer','p-a','o-a');
 await messages.messageAction(f.db,b,{action:'block',userId:'a'});await assert.rejects(()=>send(f,a,'b'),e=>e.status===409);await messages.messageAction(f.db,b,{action:'unblock',userId:'a'});await send(f,a,'b');
 await send(f,b,'a');await messages.messageAction(f.db,a,{action:'block',userId:'b'});assert.equal((await messages.messageList(f.db,a)).inbox.length,0,'blocked sender is hidden from the inbox');assert.equal(await messages.unreadMessages(f.db,'a'),0);
 f.db.beforeBatch=()=>f.native.prepare('UPDATE members SET revoked_at=? WHERE user_id=?').run(f.now,'b');await assert.rejects(()=>send(f,a,'b'),e=>e.status===409);f.native.prepare('UPDATE members SET revoked_at=NULL WHERE user_id=?').run('b');
 const key=crypto.randomUUID(),input={action:'send',organizationId:'o-a',recipientId:'b',body:'Repetido',operationKey:key};const first=await messages.messageAction(f.db,a,input);assert.equal((await messages.messageAction(f.db,a,input)).id,first.id);
 for(const bad of [{body:''},{body:'x'.repeat(1001)},{recipientId:'nada inválido'},{extra:1}])await assert.rejects(()=>messages.messageAction(f.db,a,{action:'send',organizationId:'o-a',recipientId:'b',body:'ok',operationKey:crypto.randomUUID(),...bad}),e=>e.status===400);
 const put=f.native.prepare("INSERT INTO community_messages(id,organization_id,sender_id,recipient_id,body,created_at) VALUES(?,'o-a','a','b','x',?)");for(let i=count(f,'community_messages',"sender_id='a'");i<messages.DAILY_MESSAGES;i++)put.run(crypto.randomUUID(),f.now);
 await assert.rejects(()=>send(f,a,'b'),e=>e.status===429);await assert.rejects(()=>messages.messageList(f.db,null),e=>e.status===401);});

test('selos: weekday working hours only, one per kind per week, level from variety; repeated reads write nothing',async t=>{const f=fixture(t),a=await f.user('a','inventory','p-a','o-a');
 const monday=Date.parse('2026-11-09T15:00:00.000Z'),period=badges.brasiliaWeek(monday);assert.equal(period.week,'2026-11-09');assert.equal(period.start,'2026-11-09T03:00:00.000Z');
 f.insert('items',{id:'i-1',project_id:'p-a',name:'Item',category:'gift',unit:'unidade',created_at:f.now});
 const move=at=>f.insert('stock_movements',{id:crypto.randomUUID(),item_id:'i-1',delta:1,kind:'receive',note:'',actor_id:'a',created_at:at});
 move('2026-11-09T23:30:00.000Z');// 20:30 in Brasília: overtime does not count
 move('2026-11-14T15:00:00.000Z');// Saturday: does not count
 let state=await badges.badgeState(f.db,a,monday);assert.equal(state.badges.find(b=>b.id==='field').thisWeek,false);
 move('2026-11-10T13:00:00.000Z');move('2026-11-10T14:00:00.000Z');// Tuesday 10:00 and 11:00: one badge, not two
 state=await badges.badgeState(f.db,a,monday);assert.equal(state.badges.find(b=>b.id==='field').thisWeek,true);assert.equal(state.total,1);assert.equal(state.level,1);
 const writes=count(f,'community_badges');await badges.badgeState(f.db,a,monday);assert.equal(count(f,'community_badges'),writes);
 f.insert('community_badges',{user_id:'a',badge:'thanks',week:'2026-11-02',earned_at:f.now});f.insert('community_badges',{user_id:'a',badge:'field',week:'2026-11-02',earned_at:f.now});
 state=await badges.badgeState(f.db,a,monday);assert.equal(state.level,2);assert.equal(state.nextLevelAt,6);
 await badges.badgeAction(f.db,a,{action:'seen',level:2});assert.equal((await badges.badgeState(f.db,a,monday)).seenLevel,2);});

test('selos: off and pause stop all computation; only the owner sees them; anonymization removes phase 2 data',async t=>{const f=fixture(t),a=await f.user('a','inventory','p-a','o-a'),b=await f.user('b','viewer','p-a','o-a'),owner=await f.user('owner','owner');
 f.insert('items',{id:'i-1',project_id:'p-a',name:'Item',category:'gift',unit:'unidade',created_at:f.now});f.insert('stock_movements',{id:'s1',item_id:'i-1',delta:1,kind:'receive',note:'',actor_id:'a',created_at:'2026-11-10T13:00:00.000Z'});
 const monday=Date.parse('2026-11-11T15:00:00.000Z'),today=badges.brasiliaWeek().today;
 await badges.badgeAction(f.db,a,{action:'preferences',enabled:false,pausedUntil:null,expectedVersion:0});assert.deepEqual(Object.keys(await badges.badgeState(f.db,a,monday)).sort(),['enabled','paused','pausedUntil','version']);assert.equal(count(f,'community_badges'),0);
 await assert.rejects(()=>badges.badgeAction(f.db,a,{action:'preferences',enabled:true,pausedUntil:null,expectedVersion:0}),e=>e.status===409);
 await badges.badgeAction(f.db,a,{action:'preferences',enabled:true,pausedUntil:'2099-01-01',expectedVersion:1}).then(()=>assert.fail('far pause accepted'),e=>assert.equal(e.status,400));
 await badges.badgeAction(f.db,a,{action:'preferences',enabled:true,pausedUntil:today,expectedVersion:1});const paused=await badges.badgeState(f.db,a);assert.equal(paused.paused,true);assert.equal(count(f,'community_badges'),0);
 assert.equal((await badges.badgeState(f.db,b,monday)).total,0,'nobody else sees or earns my badges');assert.equal((await badges.badgeState(f.db,owner,monday)).total,0);
 await send(f,a,'b');await messages.messageAction(f.db,b,{action:'block',userId:'a'});f.insert('community_badges',{user_id:'a',badge:'thanks',week:'2026-11-02',earned_at:f.now});
 const request=await privacy.requestPrivacy(f.db,'a');await privacy.resolvePrivacy(f.db,owner,{requestId:request.id,decision:'anonymize'},{async delete(){}});
 for(const table of ['community_messages','community_blocks','community_preferences','community_badges'])assert.equal(count(f,table),0,table);});
