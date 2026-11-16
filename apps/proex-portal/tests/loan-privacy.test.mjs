import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compile,teamFixture} from './support/work-teams-fixture.mjs';
// Privacidade em Empréstimos: texto livre (condição na saída e no retorno, ação atendida) só para quem consulta empréstimos.
// Serviços reais sobre todas as migrações em SQLite. E-mails e nomes são fictícios (domínio .invalid).
const {materialsAction}=await import(compile('lib/materials.ts'));
const {reportRows}=await import(compile('lib/reports.ts'));
const {calendarEntries,calendarRange,serializeCalendar}=await import(compile('lib/calendar.ts'));
const key=()=>crypto.randomUUID();
const SECRET_OUT='Entregue a fulana.saida@exemplo.invalid com a capa rasgada';
const SECRET_IN='Devolvido por ciclano.retorno@exemplo.invalid sem o cabo';
const SECRET_ACTION='Oficina com beltrano.acao@exemplo.invalid';

async function fixture(t){
 const f=teamFixture(t);
 // viewer-a: só relatórios (reports.read) no projeto A. loaner-a: responsável por empréstimos no projeto A.
 f.insert('portal_users',{user_id:'loaner-a',email:'loaner-a@example.invalid',status:'active',created_at:f.now,updated_at:f.now});
 f.insert('profiles',{user_id:'loaner-a',display_name:'Pessoa dos Empréstimos',created_at:f.now,updated_at:f.now});
 f.insert('members',{id:'member-loaner-a',user_id:'loaner-a',email:'loaner-a@example.invalid',role:'loans',project_id:'project-a',organization_id:'org-a',created_at:f.now});
 f.users['loaner-a']={userId:'loaner-a',email:'loaner-a@example.invalid',displayName:'Pessoa dos Empréstimos'};
 const run=async(who,action,input)=>materialsAction(f.db,await f.actor(who),action,{operationKey:key(),...input});
 const item=(await run('owner-a','item.create',{projectId:'project-a',name:'Projetor sintético',category:'equipment',unit:'unidade',lowStock:0})).item;
 await run('owner-a','stock.move',{itemId:item.id,kind:'receive',delta:1,reason:'Entrada sintética'});
 const now=Date.now();
 const loan=(await run('owner-a','loan.create',{projectId:'project-a',itemId:item.id,actionName:SECRET_ACTION,borrowerName:'Pessoa fictícia',borrowerContact:'contato.ficticio@exemplo.invalid',note:'Observação fictícia',startsAt:new Date(now-3600000).toISOString(),endsAt:new Date(now+7200000).toISOString()})).loan;
 await run('owner-a','loan.status',{id:loan.id,status:'out',conditionOut:SECRET_OUT});
 await run('owner-a','loan.status',{id:loan.id,status:'returned',conditionIn:SECRET_IN});
 return{...f,run,item,loan};
}
const textOf=value=>JSON.stringify(value);

test('report readers get the loan report without free-text conditions; who reads loans sees everything',async t=>{
 const f=await fixture(t);
 const reader=await reportRows(f.db,await f.actor('viewer-a'),{dataset:'loans'});
 assert.equal(reader.rows.length,1,'the reader still sees the loan itself');
 assert.equal(reader.rows[0].condicao_saida,'');assert.equal(reader.rows[0].condicao_retorno,'');
 assert.deepEqual(reader.withheldColumns,['condicao_saida','condicao_retorno']);
 assert.doesNotMatch(textOf({...reader,rows:reader.rows.map(row=>({...row,acao:''}))}),/exemplo\.invalid|capa rasgada|sem o cabo|Pessoa fictícia|Observação fictícia/,'no condition, borrower or note reaches the reader');
 // Decision (2026-11-16): the action name is the activity the report is about, so it stays; the form warns not to type people there.
 assert.equal(reader.rows[0].acao,SECRET_ACTION);
 assert.equal('__loan_project' in reader.rows[0],false,'the helper column never leaves the server');
 for(const who of ['loaner-a','owner-a']){
  const full=await reportRows(f.db,await f.actor(who),{dataset:'loans'});
  assert.equal(full.rows[0].condicao_saida,SECRET_OUT);assert.equal(full.rows[0].condicao_retorno,SECRET_IN);
  assert.equal(full.withheldColumns,undefined);
 }
 // Outside the project: nothing at all.
 assert.deepEqual((await reportRows(f.db,await f.actor('owner-b'),{dataset:'loans'})).rows,[]);
 assert.deepEqual((await reportRows(f.db,await f.actor('other-a2'),{dataset:'loans'})).rows,[]);
});

test('the permission to read conditions is checked again in the database, not taken from the profile loaded earlier',async t=>{
 const f=await fixture(t),stale=await f.actor('loaner-a');
 f.native.prepare("UPDATE members SET role='viewer' WHERE user_id='loaner-a'").run();
 const result=await reportRows(f.db,stale,{dataset:'loans'});
 assert.equal(result.rows[0].condicao_saida,'');assert.equal(result.rows[0].condicao_retorno,'');
 f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='loaner-a'").run(f.now);
 const revoked=await reportRows(f.db,stale,{dataset:'loans'});
 assert.doesNotMatch(textOf(revoked),/capa rasgada|sem o cabo/);
});

test('exports are built from the same rows: the reader file has no condition text (PDF, DOCX and XLSX share the response)',()=>{
 // The report center exports exactly the rows of /api/reports; there is no second query for files.
 const center=readFileSync(new URL('../components/portal/reports-center.tsx',import.meta.url),'utf8');
 assert.match(center,/withheldColumns/);
 assert.doesNotMatch(center,/condition_out|condition_in/,'the client never asks for the raw columns');
 const route=readFileSync(new URL('../app/api/reports/route.ts',import.meta.url),'utf8');
 assert.match(route,/reportRows\(db, actor, params\)/);
 // Both loan forms warn that the action name shows in reports.
 for(const file of ['../app/portal-client.tsx','../components/portal/project-quick-entry.tsx'])assert.match(readFileSync(new URL(file,import.meta.url),'utf8'),/Aparece em relatórios\. Não escreva nome ou contato de pessoas aqui\./);
});

test('Agenda: loans only for who reads loans; the ICS file leaves without the action name typed by people',async t=>{
 const f=await fixture(t),range=calendarRange();
 const own=await calendarEntries(f.db,await f.actor('loaner-a'),{category:'loans',range});
 const entry=own.entries.find(row=>row.sourceKind==='loan');
 assert.ok(entry,'who reads loans sees the loan in the Agenda');
 assert.match(entry.title,/Oficina com/,'inside the portal the full title stays');
 const ics=serializeCalendar(own.entries);
 assert.match(ics,/SUMMARY:Empréstimo · Projetor sintético/);
 assert.doesNotMatch(ics,/exemplo\.invalid|Oficina com|Pessoa fictícia|Observação fictícia|capa rasgada/,'no free text in the file');
 await assert.rejects(calendarEntries(f.db,await f.actor('viewer-a'),{category:'loans',range}),e=>e.status===403,'a report reader has no loan agenda');
 const all=await calendarEntries(f.db,await f.actor('viewer-a'),{range});
 assert.equal(all.entries.some(row=>row.sourceKind==='loan'),false);
});
