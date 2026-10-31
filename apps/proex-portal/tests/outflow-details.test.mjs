import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const modules = new Map();
function compile(file) {
  file = resolve(root, file);
  if (modules.has(file)) return modules.get(file);
  let code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  code = code.replace(/from (['"])(\.[^'"]+)\1/g, (_match, _quote, dependency) => `from ${JSON.stringify(compile(resolve(dirname(file), dependency.endsWith('.ts') ? dependency : `${dependency}.ts`)))}`);
  const url = dataModule(`${code}\n//# sourceURL=${file.replace(root, '')}-under-test.mjs`);
  modules.set(file, url);
  return url;
}
const { reportRows } = await import(compile('lib/reports.ts'));
const { quantityTotal } = await import(compile('lib/report-quantities.ts'));

function fixture() {
  const native = new DatabaseSync(':memory:');
  native.exec('PRAGMA foreign_keys=ON');
  for (const migration of readdirSync(`${root}drizzle`).filter(name => name.endsWith('.sql')).sort()) native.exec(readFileSync(`${root}drizzle/${migration}`, 'utf8'));
  const now = '2026-10-10T15:00:00.000Z';
  native.prepare("INSERT INTO organizational_units(id,name,acronym,kind,created_at,updated_at) VALUES('unit-a','Faculdade A','FA','academic',?,?)").run(now, now);
  native.prepare("INSERT INTO projects(id,name,created_at,unit_id,thematic_area,scope) VALUES('project-a','Projeto A',?,'unit-a','cultura','external'),('project-b','Projeto B',?,NULL,'saude','internal')").run(now, now);
  native.prepare("INSERT INTO items(id,project_id,name,category,unit,stock,reserved,low_stock,created_at) VALUES('item-a','project-a','Caixa de som','equipment','unidade',1,0,1,?),('item-b','project-b','Camisetas','gift','unidade',40,5,10,?)").run(now, now);
  native.prepare("INSERT INTO stock_movements(id,item_id,delta,kind,note,actor_id,created_at) VALUES('m-1','item-b',50,'receive','Compra','test','2026-09-02T12:00:00.000Z'),('m-2','item-b',-10,'distribute','Feira','test','2026-10-05T12:00:00.000Z')").run();
  native.prepare("INSERT INTO loans(id,project_id,item_id,action_name,borrower_name,borrower_contact,starts_at,ends_at,created_by,created_at) VALUES('loan-a','project-a','item-a','Mostra','Pessoa privada','pessoa@example.invalid',?,?,'test',?)").run(Date.parse('2026-10-01T12:00:00.000Z'), Date.parse('2026-10-03T12:00:00.000Z'), now);
  native.prepare("INSERT INTO records(id,project_id,kind,title,body,occurred_at,created_by,created_at) VALUES('r-1','project-a','observation','Reunião','Notas','2026-10-01T12:00:00.000Z','test',?),('r-2','project-a','maintenance','Conserto','Cabo','2026-10-02T12:00:00.000Z','test',?)").run(now, now);
  const db = { native, prepare(sql) { let values = []; return { bind(...args) { values = args; return this; }, async all() { return { results: native.prepare(sql).all(...values) }; }, async first() { return native.prepare(sql).get(...values) ?? null; } }; } };
  return db;
}
function actor(db,role,project=null){const userId=crypto.randomUUID(),member={id:crypto.randomUUID(),user_id:userId,email:role+'@example.invalid',role,project_id:project,revoked_at:null,created_at:'2026-01-01T00:00:00.000Z'};db.native.prepare('INSERT INTO members(id,user_id,email,role,project_id,revoked_at,created_at) VALUES(?,?,?,?,?,?,?)').run(...Object.values(member));return {userId,email:member.email,displayName:role,capabilities:[],members:[member]};}

function detailedFixture(){
 const db=fixture(),n=db.native,at='2026-10-05T02:30:00.000Z';
 n.prepare("INSERT INTO portal_users(user_id,email,status,created_at,updated_at) VALUES('recorded-operator','PRIVATE-EMAIL@example.invalid','active',?,?)").run(at,at);
 n.prepare("INSERT INTO profiles(user_id,display_name,phone,created_at,updated_at) VALUES('recorded-operator','Operador sintético','PRIVATE-PHONE',?,?)").run(at,at);
 n.prepare("INSERT INTO activity_groups(id,project_id,title,occurred_at,kind,note,created_by,created_at) VALUES('activity-a','project-a','Feira institucional',?,'mixed','PRIVATE-GROUP-NOTE','recorded-operator',?)").run(at,at);
 n.prepare("INSERT INTO items(id,project_id,name,category,unit,stock,created_at) VALUES('distribution-a','project-a','Kit institucional','distribution','kit',0,?),('legacy-equipment','project-a','Equipamento legado','equipment','unidade',1,?)").run(at,at);
 const movement=n.prepare('INSERT INTO stock_movements(id,item_id,delta,kind,note,actor_id,created_at,group_id,ref_id) VALUES(?,?,?,?,?,?,?,?,?)');
 movement.run('receive-a','distribution-a',20,'receive','Entrada','recorded-operator','2026-10-01T12:00:00.000Z',null,null);
 movement.run('distribution-a','distribution-a',-3,'distribute','PRIVATE-PURPOSE','recorded-operator',at,'activity-a','manual:PRIVATE-ACTOR:PRIVATE-KEY');
 movement.run('consumption-a','distribution-a',-1,'consume','PRIVATE-CONSUME','recorded-operator',at,null,null);
 movement.run('adjustment-a','distribution-a',-1,'adjust','PRIVATE-ADJUST','recorded-operator',at,null,null);
 const loan=n.prepare("INSERT INTO loans(id,project_id,item_id,action_name,borrower_name,borrower_contact,starts_at,ends_at,status,note,condition_out,condition_in,created_by,created_at,checked_out_at,returned_at,group_id) VALUES(?,'project-a',?,'Mostra institucional','PRIVATE-BORROWER','PRIVATE-CONTACT',?,?,?,'PRIVATE-LOAN-PURPOSE','PRIVATE-OUT-CONDITION','PRIVATE-IN-CONDITION','recorded-operator',?,?,?,'activity-a')");
 loan.run('loan-out','item-a',Date.parse('2026-10-05T00:00:00Z'),Date.parse('2026-11-10T12:00:00Z'),'out',at,at,null);
 loan.run('loan-returned','item-a',Date.parse('2026-10-02T00:00:00Z'),Date.parse('2026-10-04T12:00:00Z'),'returned',at,'2026-10-02T12:00:00.000Z','2026-10-04T12:00:00.000Z');
 loan.run('loan-unknown','legacy-equipment',Date.parse('2026-09-01T12:00:00Z'),Date.parse('2026-09-02T12:00:00Z'),'returned',at,null,'2026-09-02T12:00:00.000Z');
 loan.run('loan-audit-date','item-a',Date.parse('2026-10-06T00:00:00Z'),Date.parse('2026-10-07T12:00:00Z'),'returned',at,null,'2026-10-07T12:00:00.000Z');
 const audit=n.prepare("INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) VALUES(?,'recorded-operator','project-a','loan.status',?,?,?)");
 audit.run('checkout-out','loan-out','{"status":"out"}',at);
 audit.run('checkout-returned','loan-returned','{"status":"out"}','2026-10-02T12:00:00.000Z');
 audit.run('checkout-invalid','loan-audit-date','{invalid-json','2026-10-01T12:00:00.000Z');
 audit.run('checkout-fallback','loan-audit-date','{"status":"out"}','2026-10-06T12:00:00.000Z');
 n.prepare("INSERT INTO offers(id,project_id,name,kind) VALUES('offer-a','project-a','Brinde','brinde')").run();
 n.prepare("INSERT INTO campaigns(id,project_id,name,starts_at,ends_at,status,retry_limit,created_at) VALUES('campaign-a','project-a','Evento público',?,?,'active',0,?)").run(new Date(Date.now()-3600000).toISOString(),new Date(Date.now()+3600000).toISOString(),at);
 n.prepare("INSERT INTO participations(id,campaign_id,identity_id,identity_method,modality,state,created_at) VALUES('PRIVATE-PARTICIPATION','campaign-a','PRIVATE-IDENTITY','account','wheel','ready',?)").run(at);
 n.prepare("INSERT INTO attempts(id,participation_id,number,idempotency_key,result,state,created_at) VALUES('PRIVATE-ATTEMPT','PRIVATE-PARTICIPATION',1,'PRIVATE-IDEMPOTENCY','brinde','done',?)").run(at);
 n.prepare("INSERT INTO entitlements(id,attempt_id,participation_id,offer_id,state,created_at,delivered_at) VALUES('PRIVATE-ENTITLEMENT','PRIVATE-ATTEMPT','PRIVATE-PARTICIPATION','offer-a','delivered',?,?)").run(at,at);
 movement.run('redeem-a','distribution-a',-2,'redeem','Entrega de prêmio','recorded-operator','2026-10-08T12:00:00.000Z',null,'prize:PRIVATE-ENTITLEMENT:distribution-a');
 return db;
}

test('detailed outflows trace action, sources, one equipment per checkout and current balances without changing the summary',async()=>{
 const db=detailedFixture();try{
  const admin=actor(db,'owner'),before=db.native.prepare('SELECT total_changes() n').get().n;
  const summary=await reportRows(db,admin,{dataset:'outflows',projectId:'project-a'}),result=await reportRows(db,admin,{dataset:'outflow_details',projectId:'project-a'});
  assert.equal(summary.rows.length,2);assert.equal(quantityTotal(summary.rows,'quantidade'),5);assert.equal(result.rows.length,6);
  const distribution=result.rows.find(r=>r.id==='movement:distribution-a');assert.equal(distribution.acao,'Feira institucional');assert.equal(distribution.registrado_por,'Operador sintético');assert.equal(distribution.quantidade,3);assert.equal(distribution.unidade_medida,'kit');assert.equal(distribution.saldo_atual,13);assert.match(distribution.saldo_origem,/atual/);assert.equal(distribution.data_saida,'2026-10-04');
  const prize=result.rows.find(r=>r.tipo==='redeem');assert.equal(prize.acao,'Evento público');assert.equal(prize.evento_id,'campaign-a');assert.equal(prize.quantidade,2);
  assert.ok(result.rows.filter(r=>r.tipo==='loan').every(r=>r.quantidade===1));assert.equal(result.rows.find(r=>r.id==='loan:loan-returned').situacao_retorno,'returned');
  assert.ok(!JSON.stringify(result).includes('PRIVATE-'));assert.equal(db.native.prepare('SELECT total_changes() n').get().n,before);
 }finally{db.native.close();}
});

test('free text is absent unless explicitly requested; contact, beneficiary, account and redemption secrets are never projected',async()=>{
 const db=detailedFixture();try{
  const admin=actor(db,'owner'),plain=await reportRows(db,admin,{dataset:'outflow_details',projectId:'project-a'});
  for(const row of plain.rows)for(const key of ['finalidade_registrada','observacao_atividade','condicao_saida','condicao_retorno'])assert.equal(key in row,false);
  const detail=await reportRows(db,admin,{dataset:'outflow_details',projectId:'project-a',includeNotes:'1'});
  assert.equal(detail.rows.find(r=>r.tipo==='distribute').finalidade_registrada,'PRIVATE-PURPOSE');assert.equal(detail.rows.find(r=>r.tipo==='distribute').observacao_atividade,'PRIVATE-GROUP-NOTE');
  const serialized=JSON.stringify(detail);for(const forbidden of ['PRIVATE-EMAIL','PRIVATE-PHONE','PRIVATE-BORROWER','PRIVATE-CONTACT','PRIVATE-IDENTITY','PRIVATE-PARTICIPATION','PRIVATE-ENTITLEMENT','PRIVATE-KEY','PRIVATE-ACTOR'])assert.ok(!serialized.includes(forbidden),forbidden);
 }finally{db.native.close();}
});

test('branches obey current resource permissions and only operational roles see current operator names',async()=>{
 const db=detailedFixture();try{
  for(const [role,types] of [['inventory',['distribute','redeem']],['loans',['loan']],['viewer',['distribute','loan','redeem']]]){
   const person=actor(db,role,'project-a'),rows=(await reportRows(db,person,{dataset:'outflow_details',projectId:'project-a'})).rows;
   assert.deepEqual([...new Set(rows.map(r=>r.tipo))].sort(),types.sort());
   if(role==='viewer')assert.ok(rows.every(r=>r.registrado_por==='Restrito ao perfil operacional'));else assert.ok(rows.some(r=>r.registrado_por==='Operador sintético'));
   assert.deepEqual((await reportRows(db,person,{dataset:'outflow_details',projectId:'project-b'})).rows,[]);
   db.native.prepare('UPDATE members SET revoked_at=? WHERE id=?').run('2026-10-31T12:00:00Z',person.members[0].id);
   assert.deepEqual((await reportRows(db,person,{dataset:'outflow_details'})).rows,[]);
  }
 }finally{db.native.close();}
});

test('periods use recorded checkout or its audit, never its schedule; filters exclude reservations, adjustments and consumption',async()=>{
 const db=detailedFixture();try{
  const admin=actor(db,'owner'),all=(await reportRows(db,admin,{dataset:'outflow_details',projectId:'project-a'})).rows;
  const unknown=all.find(r=>r.id==='loan:loan-unknown');assert.equal(unknown.data_saida,null);assert.equal(unknown.instante_saida_utc,null);assert.match(unknown.fonte_data,/não registrada/);
  const fallback=all.find(r=>r.id==='loan:loan-audit-date');assert.equal(fallback.data_saida,'2026-10-06');assert.equal(fallback.fonte_data,'Auditoria da retirada');
  const range=(await reportRows(db,admin,{dataset:'outflow_details',projectId:'project-a',from:'2026-10-04',to:'2026-10-04'})).rows;assert.deepEqual(new Set(range.map(r=>r.id)),new Set(['movement:distribution-a','loan:loan-out']));
  assert.equal((await reportRows(db,admin,{dataset:'outflow_details',projectId:'project-a',outflowType:'loan',returnState:'out'})).rows.length,1);
  assert.equal((await reportRows(db,admin,{dataset:'outflow_details',projectId:'project-a',returnState:'not_applicable'})).rows.length,2);
  assert.equal((await reportRows(db,admin,{dataset:'outflow_details',projectId:'project-a',outflowType:'redeem'})).rows.length,1);
  await assert.rejects(reportRows(db,admin,{dataset:'outflow_details',outflowType:['loan']}),{status:400});await assert.rejects(reportRows(db,admin,{dataset:'outflow_details',returnState:'reserved'}),{status:400});
 }finally{db.native.close();}
});

test('organization boundaries and operational name visibility survive a stale owner or inventory actor',async()=>{
 const db=detailedFixture();try{
  const n=db.native,at='2026-10-01T12:00:00Z';
  n.prepare("INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES('foreign-org','Organização privada B','foreign-org',?,?)").run(at,at);
  n.prepare("INSERT INTO projects(id,name,organization_id,created_at) VALUES('foreign-project','Projeto privado B','foreign-org',?)").run(at);
  n.prepare("INSERT INTO items(id,project_id,name,category,unit,created_at) VALUES('foreign-item','foreign-project','Material privado B','distribution','kg',?)").run(at);
  n.prepare("INSERT INTO stock_movements(id,item_id,delta,kind,note,actor_id,created_at) VALUES('foreign-receive','foreign-item',20,'receive','Entrada','foreign-operator',?),('foreign-out','foreign-item',-2,'distribute','FINALIDADE PRIVADA B','foreign-operator',?)").run(at,at);
  const cachedOwner=actor(db,'owner');n.prepare("UPDATE members SET organization_id='org_proex' WHERE id=?").run(cachedOwner.members[0].id);
  const scoped=await reportRows(db,cachedOwner,{dataset:'outflow_details',includeNotes:'1'});assert.ok(!JSON.stringify(scoped).includes('privad'));assert.deepEqual((await reportRows(db,cachedOwner,{dataset:'outflow_details',projectId:'foreign-project'})).rows,[]);
  const inventory=actor(db,'inventory','project-a');assert.ok((await reportRows(db,inventory,{dataset:'outflow_details'})).rows.some(row=>row.registrado_por==='Operador sintético'));
  n.prepare("UPDATE members SET role='viewer' WHERE id=?").run(inventory.members[0].id);
  const downgraded=(await reportRows(db,inventory,{dataset:'outflow_details'})).rows;assert.ok(downgraded.length);assert.ok(downgraded.every(row=>row.registrado_por==='Restrito ao perfil operacional'));
  n.prepare("UPDATE portal_users SET anonymized_at=? WHERE user_id='recorded-operator'").run(at);
  assert.ok(!(await reportRows(db,cachedOwner,{dataset:'outflow_details'})).rows.some(row=>row.registrado_por==='Operador sintético'));
 }finally{db.native.close();}
});

test('audit reports reject nonexistent or reversed dates and prototype dataset names',async()=>{
 const db=detailedFixture();try{const admin=actor(db,'owner');
  for(const input of [{dataset:'constructor'},{dataset:'outflow_details',from:'2026-02-30'},{dataset:'outflow_details',from:'2026-10-10',to:'2026-10-01'}])await assert.rejects(reportRows(db,admin,input),{status:400});
 }finally{db.native.close();}
});
test('large detailed pages keep response bytes bounded and use a constant number of SQL reads without writes',async t=>{
 const db=detailedFixture();try{
  const n=db.native,at='2026-10-15T12:00:00.000Z',operator='recorded-operator';
  n.prepare("INSERT INTO stock_movements(id,item_id,delta,kind,note,actor_id,created_at) VALUES('bulk-receive','distribution-a',6000,'receive','Entrada sintética',?,?)").run(operator,at);
  const insert=n.prepare("INSERT INTO stock_movements(id,item_id,delta,kind,note,actor_id,created_at) VALUES(?,'distribution-a',-1,'distribute','Saída sintética',?,?)");
  n.exec('BEGIN');for(let i=0;i<5100;i++)insert.run('bulk-out-'+i,operator,at);n.exec('COMMIT');
  const caller=actor(db,'owner'),prepare=db.prepare.bind(db);let reads=0;
  db.prepare=sql=>{const statement=prepare(sql),all=statement.all;statement.all=async()=>{reads++;return all.call(statement);};return statement;};
  const before=n.prepare('SELECT total_changes() n').get().n,samples=[];let result;
  for(let i=0;i<5;i++){const start=performance.now();result=await reportRows(db,caller,{dataset:'outflow_details',projectId:'project-a'});samples.push(performance.now()-start);}
  const bytes=Buffer.byteLength(JSON.stringify(result));assert.equal(result.truncated,true);assert.ok(result.rows.length>0);assert.ok(bytes<3.1*1024*1024,`Detailed response was ${bytes} bytes`);assert.ok(reads<=10,'one page must not query separately for every row');assert.equal(n.prepare('SELECT total_changes() n').get().n,before);
  samples.sort((a,b)=>a-b);t.diagnostic(JSON.stringify({benchmark:'synthetic-outflow-detail',sourceRows:5106,returnedRows:result.rows.length,responseBytes:bytes,sqlReadsForFivePages:reads,writes:0,p50Ms:Number(samples[2].toFixed(2)),p95Ms:Number(samples[4].toFixed(2)),limitation:'SQLite in memory; no network or serverless capacity claim'}));
 }finally{db.native.close();}
});
test('an opt-in cannot grant viewer notes and each resource rechecks operational authority at the SQL await',async()=>{
 const db=detailedFixture();try{
  const viewer=actor(db,'viewer','project-a'),restricted=(await reportRows(db,viewer,{dataset:'outflow_details',includeNotes:'1'})).rows;
  assert.ok(restricted.length);for(const row of restricted)for(const key of ['finalidade_registrada','observacao_atividade','condicao_saida','condicao_retorno'])assert.equal(row[key],null);
  const inventory=actor(db,'inventory','project-a');
  const combined=(await reportRows(db,inventory,{dataset:'outflow_details',includeNotes:'1'})).rows;
  assert.equal(combined.find(row=>row.tipo==='distribute').finalidade_registrada,'PRIVATE-PURPOSE');assert.ok(combined.every(row=>row.tipo!=='loan'));
  const prepare=db.prepare.bind(db);let armed=true;
  db.prepare=sql=>{const statement=prepare(sql),all=statement.all;statement.all=async()=>{await Promise.resolve();if(armed){armed=false;db.native.prepare("UPDATE members SET role='viewer' WHERE id=?").run(inventory.members[0].id);}return all.call(statement);};return statement;};
  const after=(await reportRows(db,inventory,{dataset:'outflow_details',includeNotes:'1'})).rows;
  assert.ok(after.length);assert.ok(after.every(row=>row.finalidade_registrada===null&&row.observacao_atividade===null&&row.condicao_saida===null&&row.condicao_retorno===null&&row.registrado_por==='Restrito ao perfil operacional'));
 }finally{db.native.close();}
});
