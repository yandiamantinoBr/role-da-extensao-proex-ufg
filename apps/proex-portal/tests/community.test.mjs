import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import ts from 'typescript';

// Comunidade (0036): widgets pessoais, retorno ampliado e ouvidoria anônima. Dados sintéticos.
const root=fileURLToPath(new URL('../',import.meta.url)),cache=new Map(),url=code=>`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const replacements=new Map([
 [resolve(root,'lib/session.ts'),url('export async function getPortalUser(options){(globalThis.__communityTest.sessionCalls??=[]).push(options??{});return globalThis.__communityTest?.user??null;}')],
 [resolve(root,'lib/platform.ts'),url('export function database(){return globalThis.__communityTest.db;}')],
]);
function compile(file){file=resolve(root,file);if(replacements.has(file))return replacements.get(file);if(cache.has(file))return cache.get(file);let code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;code=code.replace(/from (['"])([^'"]+)\1/g,(match,_quote,dep)=>{if(!dep.startsWith('.')&&!dep.startsWith('@/'))return match;const target=dep.startsWith('@/')?resolve(root,dep.slice(2)):resolve(dirname(file),dep);return `from ${JSON.stringify(compile(target.endsWith('.ts')?target:`${target}.ts`))}`;});const result=url(code);cache.set(file,result);return result;}
const access=await import(compile('lib/access.ts')),feedback=await import(compile('lib/feedback.ts'));
const ombuds=await import(compile('lib/community/ombuds.ts')),widgets=await import(compile('lib/community/widgets.ts')),codes=await import(compile('lib/community/ombuds-code.ts'));
const ombudsRoute=await import(compile('app/api/community/ombuds/route.ts')),privacy=await import(compile('lib/privacy.ts'));

function fixture(t){ombuds.resetOmbudsMemoryBrake();const native=new DatabaseSync(':memory:');native.exec('PRAGMA foreign_keys=ON');for(const f of readdirSync(`${root}drizzle`).filter(x=>x.endsWith('.sql')).sort())native.exec(readFileSync(`${root}drizzle/${f}`,'utf8'));const now=new Date().toISOString();
 const insert=(table,row)=>{const cols=Object.keys(row);native.prepare(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')})`).run(...Object.values(row));};
 const db={beforeBatch:null,prepare(sql){let values=[];return{bind(...args){values=args;return this;},async first(column){const row=native.prepare(sql).get(...values)??null;return column?row?.[column]??null:row;},async all(){return{results:native.prepare(sql).all(...values),success:true};},async run(){return this.execute();},execute(){const results=native.prepare(sql).all(...values);return{results,success:true,meta:{changes:Number(native.prepare('SELECT changes() AS n').get().n)}};}};},async batch(statements){if(this.beforeBatch){const hook=this.beforeBatch;this.beforeBatch=null;hook();}native.exec('BEGIN');try{const r=statements.map(s=>s.execute());native.exec('COMMIT');return r;}catch(e){native.exec('ROLLBACK');throw e;}}};
 const user=async(id,role,project=null,org=null)=>{insert('portal_users',{user_id:id,email:`${id}@example.invalid`,status:'active',created_at:now,updated_at:now});insert('profiles',{user_id:id,display_name:`Pessoa ${id}`,created_at:now,updated_at:now});if(role)insert('members',{id:`m-${id}`,user_id:id,email:`${id}@example.invalid`,role,project_id:project,organization_id:org,created_at:now});return access.getActor(db,{userId:id,email:`${id}@example.invalid`,displayName:`Pessoa ${id}`});};
 for(const id of ['a','b']){insert('organizations',{id:`o-${id}`,name:`Org ${id}`,slug:`org-${id}`,created_at:now,updated_at:now});insert('projects',{id:`p-${id}`,name:`Projeto ${id}`,organization_id:`o-${id}`,created_at:now});insert('campaigns',{id:`c-${id}`,project_id:`p-${id}`,name:`Evento ${id}`,starts_at:now,ends_at:now,created_at:now});}
 t.after(()=>{native.close();delete globalThis.__communityTest;});return{native,db,user,now,insert};}
const count=(f,table,where='1=1',...values)=>Number(f.native.prepare(`SELECT count(*) n FROM ${table} WHERE ${where}`).get(...values).n);
/** Every text cell of every table, to prove that no row written by the ombuds names its author. */
function dump(native){const rows=new Set();for(const {name} of native.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all())for(const row of native.prepare(`SELECT * FROM "${name}"`).all())rows.add(`${name}:${JSON.stringify(row)}`);return rows;}

test('ombuds code: 100 random bits, readable format and tolerant normalization',()=>{const code=codes.newOmbudsCode();assert.match(code,/^OUV(-[0-9A-HJKMNP-TV-Z]{4}){5}$/);assert.equal(codes.normalizeOmbudsCode(code.toLowerCase().replaceAll('-',' ')),code.slice(4).replaceAll('-',''));assert.equal(codes.normalizeOmbudsCode('OUV-OOOO-IIII-LLLL-0000-1111'),'00001111111100001111');for(const bad of ['', 'OUV-1234', 'x'.repeat(90), 12, null, 'OUV-UUUU-0000-0000-0000-0000'])assert.equal(codes.normalizeOmbudsCode(bad),null);assert.notEqual(codes.newOmbudsCode(),codes.newOmbudsCode());});

test('anonymous ombuds: submitting writes no row that contains the author id, e-mail or name',async t=>{const f=fixture(t),a=await f.user('reporter-a','viewer','p-a','o-a');const before=dump(f.native),audit=count(f,'audit'),keys=count(f,'mutation_keys'),limits=count(f,'portal_rate_limits');
 const code=codes.newOmbudsCode();assert.deepEqual(await ombuds.ombudsReporterAction(f.db,a,{action:'submit',code,category:'workload',body:'A carga de trabalho desta semana passou do combinado.'}),{received:true,duplicate:false});
 const added=[...dump(f.native)].filter(row=>!before.has(row));assert.equal(added.length,2);for(const row of added){assert.doesNotMatch(row,/reporter-a|Pessoa reporter-a|example\.invalid/);assert.doesNotMatch(row,/T\d\d:\d\d/,'only civil days, never instants');assert.ok(!row.includes(code)&&!row.includes(code.slice(4).replaceAll('-','')),'the plain code is never stored');}
 assert.equal(count(f,'audit'),audit);assert.equal(count(f,'mutation_keys'),keys);assert.equal(count(f,'portal_rate_limits'),limits);
 assert.match(f.native.prepare("SELECT sql FROM sqlite_schema WHERE name='ombuds_reports'").get().sql,/WITHOUT ROWID/);
 const columns=['ombuds_reports','ombuds_messages'].flatMap(table=>f.native.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name));for(const forbidden of ['author_id','user_id','actor_id','email','created_at','project_id','organization_id'])assert.ok(!columns.includes(forbidden),forbidden);});

test('ombuds tracking by code, duplicate retry, reused code and follow-up messages',async t=>{const f=fixture(t),a=await f.user('a','viewer','p-a','o-a'),other=await f.user('b','operator','p-b','o-b'),code=codes.newOmbudsCode();const body='Relato sintético para conferir o acompanhamento.';
 await ombuds.ombudsReporterAction(f.db,a,{action:'submit',code,category:'conduct',body});
 assert.deepEqual(await ombuds.ombudsReporterAction(f.db,a,{action:'submit',code,category:'conduct',body}),{received:true,duplicate:true});
 await assert.rejects(()=>ombuds.ombudsReporterAction(f.db,a,{action:'submit',code,category:'conduct',body:'Outro texto completamente diferente aqui.'}),e=>e.status===409&&e.code==='ombuds_code_used');
 const tracked=await ombuds.ombudsReporterAction(f.db,other,{action:'track',code:code.toLowerCase()});assert.equal(tracked.report.status,'received');assert.equal(tracked.report.id,undefined,'the internal id is not exposed to the reporter');assert.equal(tracked.messages.length,1);
 await ombuds.ombudsReporterAction(f.db,a,{action:'reply',code,body:'Complemento do relato.'});assert.equal((await ombuds.ombudsReporterAction(f.db,a,{action:'track',code})).messages.at(-1).side,'reporter');
 await assert.rejects(()=>ombuds.ombudsReporterAction(f.db,a,{action:'track',code:codes.newOmbudsCode()}),e=>e.status===404);
 await assert.rejects(()=>ombuds.ombudsReporterAction(f.db,a,{action:'track',code:'OUV-1'}),e=>e.status===400);
 await assert.rejects(()=>ombuds.ombudsReporterAction(f.db,a,{action:'submit',code:codes.newOmbudsCode(),category:'secret',body}),e=>e.status===400);
 await assert.rejects(()=>ombuds.ombudsReporterAction(f.db,a,{action:'submit',code:codes.newOmbudsCode(),category:'other',body:'curto'}),e=>e.status===400);
 await assert.rejects(()=>ombuds.ombudsReporterAction(f.db,a,{action:'submit',code:codes.newOmbudsCode(),category:'other',body,userId:'a'}),e=>e.status===400);});

test('ombuds admits only active internal members; revocation inside the batch blocks the report',async t=>{const f=fixture(t),outsider=await f.user('outsider',null),a=await f.user('a','viewer','p-a','o-a'),input=()=>({action:'submit',code:codes.newOmbudsCode(),category:'other',body:'Relato de quem não deveria conseguir enviar.'});
 await assert.rejects(()=>ombuds.ombudsReporterAction(f.db,null,input()),e=>e.status===401);
 await assert.rejects(()=>ombuds.ombudsReporterAction(f.db,outsider,input()),e=>e.status===403);
 f.db.beforeBatch=()=>f.native.prepare('UPDATE members SET revoked_at=? WHERE user_id=?').run(f.now,'a');
 await assert.rejects(()=>ombuds.ombudsReporterAction(f.db,a,input()),e=>e.status===403);assert.equal(count(f,'ombuds_reports'),0);});

test('only the platform owner reads the ombuds inbox and replies; the reply is audited without reporter data',async t=>{const f=fixture(t),a=await f.user('a','viewer','p-a','o-a'),manager=await f.user('m','manager','p-a','o-a'),orgOwner=await f.user('oo','owner',null,'o-a'),owner=await f.user('owner','owner'),code=codes.newOmbudsCode();
 await ombuds.ombudsReporterAction(f.db,a,{action:'submit',code,category:'environment',body:'O ambiente da sala ficou difícil para trabalhar.'});
 for(const actor of [a,manager,orgOwner])await assert.rejects(()=>ombuds.ombudsInbox(f.db,actor),e=>e.status===403);
 const inbox=await ombuds.ombudsInbox(f.db,owner);assert.equal(inbox.reports.length,1);const report=inbox.reports[0];assert.equal(report.status,'received');assert.ok(!JSON.stringify(inbox).includes('Pessoa a'));
 await assert.rejects(()=>ombuds.ombudsManageAction(f.db,manager,{action:'respond',id:report.id,body:'Resposta indevida',expectedVersion:1}),e=>e.status===403);
 await ombuds.ombudsManageAction(f.db,owner,{action:'respond',id:report.id,body:'Recebemos e vamos conversar com a coordenação.',expectedVersion:report.version});
 await assert.rejects(()=>ombuds.ombudsManageAction(f.db,owner,{action:'respond',id:report.id,body:'Versão antiga',expectedVersion:report.version}),e=>e.status===409);
 assert.equal(count(f,'ombuds_messages',"side='ombuds'"),1,'a stale reply is rolled back entirely');
 const tracked=await ombuds.ombudsReporterAction(f.db,a,{action:'track',code});assert.equal(tracked.report.status,'answered');assert.equal(tracked.messages.at(-1).side,'ombuds');
 const audit=f.native.prepare("SELECT actor_id,entity_id,details FROM audit WHERE action LIKE 'ombuds.%'").all();assert.equal(audit.length,1);assert.equal(audit[0].actor_id,'owner');assert.doesNotMatch(JSON.stringify(audit),/"a"|Pessoa a/);
 await ombuds.ombudsManageAction(f.db,owner,{action:'status',id:report.id,status:'closed',expectedVersion:report.version+1});
 await assert.rejects(()=>ombuds.ombudsReporterAction(f.db,a,{action:'reply',code,body:'Mais um detalhe.'}),e=>e.status===409&&e.code==='ombuds_closed');
 await assert.rejects(()=>ombuds.ombudsManageAction(f.db,owner,{action:'status',id:report.id,status:'received',expectedVersion:report.version+2}),e=>e.status===400);});

test('ombuds abuse limits are collective, never per person',async t=>{const f=fixture(t),a=await f.user('a','viewer','p-a','o-a');for(let i=0;i<ombuds.OMBUDS_DAILY_REPORTS;i++){ombuds.resetOmbudsMemoryBrake();await ombuds.ombudsReporterAction(f.db,a,{action:'submit',code:codes.newOmbudsCode(),category:'other',body:`Relato sintético número ${i} para o limite.`});}
 ombuds.resetOmbudsMemoryBrake();
 await assert.rejects(()=>ombuds.ombudsReporterAction(f.db,a,{action:'submit',code:codes.newOmbudsCode(),category:'other',body:'Um relato além do limite do dia.'}),e=>e.status===429);
 const code=codes.newOmbudsCode();f.native.exec('DELETE FROM ombuds_messages;DELETE FROM ombuds_reports');await ombuds.ombudsReporterAction(f.db,a,{action:'submit',code,category:'other',body:'Relato para o limite de mensagens.'});
 for(let i=1;i<ombuds.OMBUDS_DAILY_MESSAGES_PER_REPORT;i++){ombuds.resetOmbudsMemoryBrake();await ombuds.ombudsReporterAction(f.db,a,{action:'reply',code,body:`Complemento ${i}`});}
 ombuds.resetOmbudsMemoryBrake();
 await assert.rejects(()=>ombuds.ombudsReporterAction(f.db,a,{action:'reply',code,body:'Complemento além do limite'}),e=>e.status===429);});

test('ombuds route: reporter actions read the session without refresh, CSRF and private headers',async t=>{const f=fixture(t);await f.user('a','viewer','p-a','o-a');globalThis.__communityTest={db:f.db,user:{userId:'a',email:'a@example.invalid',displayName:'Pessoa a'}};const origin='https://portal.example.invalid',headers={Origin:origin,'X-Proex-Action':'1','Content-Type':'application/json'};const post=(h,body)=>new Request(`${origin}/api/community/ombuds`,{method:'POST',headers:h,body});
 const body=JSON.stringify({action:'submit',code:codes.newOmbudsCode(),category:'process',body:'Processo de compras está confuso para a equipe.'});
 assert.equal((await ombudsRoute.POST(post({...headers,Origin:'https://evil.invalid'},body))).status,403);
 globalThis.__communityTest.sessionCalls=[];const ok=await ombudsRoute.POST(post(headers,body));assert.equal(ok.status,200);assert.equal(ok.headers.get('cache-control'),'private, no-store');assert.deepEqual(globalThis.__communityTest.sessionCalls,[{refresh:false}]);
 assert.equal((await ombudsRoute.GET()).status,403);globalThis.__communityTest.user=null;assert.equal((await ombudsRoute.POST(post(headers,body))).status,401);});

test('widgets are off by default, private to their owner and limited',async t=>{const f=fixture(t),a=await f.user('a','viewer','p-a','o-a'),b=await f.user('b','manager','p-a','o-a'),owner=await f.user('owner','owner');
 const initial=await widgets.widgetState(f.db,a);assert.deepEqual(initial.settings,{notes:false,reminders:false,roleShortcut:false,version:0});
 await widgets.widgetAction(f.db,a,{action:'settings',notes:true,reminders:true,roleShortcut:false,expectedVersion:0});
 await assert.rejects(()=>widgets.widgetAction(f.db,a,{action:'settings',notes:true,reminders:false,roleShortcut:false,expectedVersion:0}),e=>e.status===409);
 const note=await widgets.widgetAction(f.db,a,{action:'create',kind:'note',body:'Levar o crachá amanhã.',operationKey:crypto.randomUUID()});
 const later=await widgets.widgetAction(f.db,a,{action:'create',kind:'reminder',body:'Conferir a sala.',dueOn:'2026-11-20',operationKey:crypto.randomUUID()});
 await widgets.widgetAction(f.db,a,{action:'create',kind:'reminder',body:'Entregar relatório.',dueOn:'2026-11-12',dueTime:'09:30',operationKey:crypto.randomUUID()});
 const state=await widgets.widgetState(f.db,a);assert.equal(state.notes.length,1);assert.deepEqual(state.reminders.map(r=>r.body),['Entregar relatório.','Conferir a sala.']);
 for(const actor of [b,owner]){const other=await widgets.widgetState(f.db,actor);assert.equal(other.notes.length,0);await assert.rejects(()=>widgets.widgetAction(f.db,actor,{action:'delete',id:note.id,expectedVersion:1}),e=>e.status===404);await assert.rejects(()=>widgets.widgetAction(f.db,actor,{action:'update',id:note.id,body:'alterado',expectedVersion:1}),e=>e.status===404);}
 await widgets.widgetAction(f.db,a,{action:'done',id:later.id,done:true,expectedVersion:1});assert.ok((await widgets.widgetState(f.db,a)).reminders.find(r=>r.id===later.id).doneAt);
 for(const bad of [{kind:'note',body:''},{kind:'note',body:'x'.repeat(501)},{kind:'note',body:'com data',dueOn:'2026-11-12'},{kind:'reminder',body:'hora sem data',dueTime:'10:00'},{kind:'reminder',body:'hora',dueOn:'2026-11-12',dueTime:'25:00'},{kind:'reminder',body:'data',dueOn:'2026-02-31'},{kind:'other',body:'x'}])await assert.rejects(()=>widgets.widgetAction(f.db,a,{action:'create',operationKey:crypto.randomUUID(),...bad}),e=>e.status===400);
 for(let i=1;i<widgets.NOTE_LIMIT;i++)await widgets.widgetAction(f.db,a,{action:'create',kind:'note',body:`Nota ${i}`,operationKey:crypto.randomUUID()});
 await assert.rejects(()=>widgets.widgetAction(f.db,a,{action:'create',kind:'note',body:'Uma a mais',operationKey:crypto.randomUUID()}),e=>e.status===409);
 assert.equal(count(f,'audit',"action LIKE 'widget%'"),0,'private notes never reach the audit log');
 await assert.rejects(()=>widgets.widgetState(f.db,null),e=>e.status===401);const outsider=await f.user('outsider',null);await assert.rejects(()=>widgets.widgetState(f.db,outsider),e=>e.status===403);});

test('account anonymization deletes personal notes and widget settings',async t=>{const f=fixture(t),a=await f.user('a','viewer','p-a','o-a'),owner=await f.user('owner','owner');await widgets.widgetAction(f.db,a,{action:'settings',notes:true,reminders:false,roleShortcut:true,expectedVersion:0});await widgets.widgetAction(f.db,a,{action:'create',kind:'note',body:'Nota pessoal.',operationKey:crypto.randomUUID()});
 const request=await privacy.requestPrivacy(f.db,a.userId);await privacy.resolvePrivacy(f.db,owner,{requestId:request.id,decision:'anonymize'},{async delete(){}});assert.equal(count(f,'personal_notes'),0);assert.equal(count(f,'personal_widget_settings'),0);});

test('feedback: praise and event feedback reach the managers of the event project and the reply reaches the author',async t=>{const f=fixture(t),a=await f.user('a','viewer','p-a','o-a'),manager=await f.user('m','manager','p-a','o-a'),otherManager=await f.user('mb','manager','p-b','o-b'),owner=await f.user('owner','owner');
 const created=await feedback.feedbackAction(f.db,a,{action:'create',kind:'praise',module:'community',body:'A equipe do evento atendeu muito bem.',campaignId:'c-a',operationKey:crypto.randomUUID()});
 const row=f.native.prepare('SELECT project_id,campaign_id,kind FROM portal_feedback WHERE id=?').get(created.id);assert.deepEqual({...row},{project_id:'p-a',campaign_id:'c-a',kind:'praise'});
 await assert.rejects(()=>feedback.feedbackAction(f.db,a,{action:'create',kind:'problem',module:'community',body:'Evento de outro projeto sem acesso.',campaignId:'c-b',operationKey:crypto.randomUUID()}),e=>e.status===403);
 await assert.rejects(()=>feedback.feedbackAction(f.db,a,{action:'create',kind:'problem',module:'community',body:'Projeto diferente do evento informado.',campaignId:'c-a',projectId:'p-b',operationKey:crypto.randomUUID()}),e=>e.status===403);
 const managed=await feedback.feedbackList(f.db,manager,true);assert.equal(managed.entries.length,1);assert.equal(managed.entries[0].campaign_name,'Evento a');assert.equal(managed.entries[0].author_name,'Pessoa a');
 assert.equal((await feedback.feedbackList(f.db,otherManager,true)).entries.length,0);assert.equal((await feedback.feedbackList(f.db,owner,true)).entries.length,1);
 assert.equal((await feedback.feedbackList(f.db,a)).entries[0].author_name,null,'the own list does not need the author name');
 await assert.rejects(()=>feedback.feedbackAction(f.db,a,{action:'respond',id:created.id,status:'resolved',response:'Autorresposta',expectedVersion:1}),e=>e.status===409);
 await assert.rejects(()=>feedback.feedbackAction(f.db,otherManager,{action:'respond',id:created.id,status:'resolved',response:'Resposta de fora',expectedVersion:1}),e=>e.status===409);
 await feedback.feedbackAction(f.db,manager,{action:'respond',id:created.id,status:'resolved',response:'Obrigado! Vamos repassar à equipe.',expectedVersion:1});
 const own=(await feedback.feedbackList(f.db,a)).entries[0];assert.equal(own.response,'Obrigado! Vamos repassar à equipe.');assert.equal(own.status,'resolved');assert.ok(own.responded_at);
 assert.equal(count(f,'audit',"action='feedback.respond' AND actor_id='m'"),1);
 await assert.rejects(()=>feedback.feedbackAction(f.db,manager,{action:'respond',id:created.id,status:'resolved',response:'x',expectedVersion:2}),e=>e.status===400);});

test('ombuds per-person brake lives only in memory and the collective message ceiling holds',async t=>{const f=fixture(t),a=await f.user('a','viewer','p-a','o-a');const before=dump(f.native).size;
 for(let i=0;i<ombuds.OMBUDS_MEMORY_LIMIT;i++)await ombuds.ombudsReporterAction(f.db,a,{action:'submit',code:codes.newOmbudsCode(),category:'other',body:`Relato sintético do freio ${i}.`});
 await assert.rejects(()=>ombuds.ombudsReporterAction(f.db,a,{action:'submit',code:codes.newOmbudsCode(),category:'other',body:'Um a mais dentro da hora.'}),e=>e.status===429&&e.code==='ombuds_memory_limit');
 assert.equal(dump(f.native).size-before,ombuds.OMBUDS_MEMORY_LIMIT*2,'the brake writes nothing: only the reports and their first messages');
 ombuds.resetOmbudsMemoryBrake();const code=codes.newOmbudsCode();await ombuds.ombudsReporterAction(f.db,a,{action:'submit',code,category:'other',body:'Relato para o teto coletivo.'});
 const id=f.native.prepare('SELECT report_id FROM ombuds_messages WHERE seq=1 LIMIT 1').get().report_id,day=f.native.prepare('SELECT sent_on FROM ombuds_messages LIMIT 1').get().sent_on;
 const put=f.native.prepare("INSERT INTO ombuds_messages(id,report_id,side,body,sent_on,seq) VALUES(?,?,'reporter','x',?,?)");for(let i=0;i<ombuds.OMBUDS_DAILY_MESSAGES;i++)put.run(crypto.randomUUID(),id,day,100+i);
 ombuds.resetOmbudsMemoryBrake();await assert.rejects(()=>ombuds.ombudsReporterAction(f.db,a,{action:'reply',code,body:'Além do teto coletivo.'}),e=>e.status===429);});
