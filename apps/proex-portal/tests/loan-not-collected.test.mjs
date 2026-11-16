import test from 'node:test';
import assert from 'node:assert/strict';
import {compile,teamFixture} from './support/work-teams-fixture.mjs';
// Reserva com horário vencido e sem retirada vira "Não retirado" e libera o equipamento (decisão de 2026-11-16).
// Serviços reais sobre todas as migrações em SQLite. Dados sintéticos.
const {materialsAction}=await import(compile('lib/materials.ts'));
const {loanDisplayState}=await import(compile('lib/loan-lifecycle.ts'));
const {reportRows}=await import(compile('lib/reports.ts'));
const {calendarEntries,calendarRange}=await import(compile('lib/calendar.ts'));
const {loanMatches,emptyLoanFilters}=await import(compile('lib/loan-list-filters.ts'));
const {getActor,closeUncollectedLoans}=await import(compile('lib/access.ts'));
const key=()=>crypto.randomUUID();
const HOUR=3600000;

async function fixture(t){
 const f=teamFixture(t);
 const run=async(who,action,input)=>materialsAction(f.db,await f.actor(who),action,{operationKey:key(),...input});
 const equipment=async name=>{const item=(await run('owner-a','item.create',{projectId:'project-a',name,category:'equipment',unit:'unidade',lowStock:0})).item;await run('owner-a','stock.move',{itemId:item.id,kind:'receive',delta:1,reason:'Entrada sintética'});return item;};
 const reserve=async(item,startsAt,endsAt)=>(await run('owner-a','loan.create',{projectId:'project-a',itemId:item.id,actionName:'Oficina sintética',borrowerName:'Pessoa fictícia',startsAt:new Date(startsAt).toISOString(),endsAt:new Date(endsAt).toISOString()})).loan;
 const loan=id=>({...f.native.prepare('SELECT status,close_reason,returned_at,checked_out_at FROM loans WHERE id=?').get(id)});
 // A reservation saved before this rule, already entirely in the past (written directly, as legacy data).
 const legacy=(item,endsAt,status='reserved')=>{const id=key();f.native.prepare("INSERT INTO loans(id,project_id,item_id,action_name,borrower_name,starts_at,ends_at,status,created_by,created_at,updated_at,checked_out_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(id,'project-a',item.id,'Ação antiga sintética','Pessoa fictícia',endsAt-2*HOUR,endsAt,status,'owner-a',f.now,f.now,status==='out'?f.now:null);return id;};
 return{...f,run,equipment,reserve,loan,legacy};
}

test('exact hour: before ends_at it stays reserved; at ends_at it becomes not collected, once, with an audit row',async t=>{
 const f=await fixture(t),item=await f.equipment('Projetor sintético'),now=Date.now();
 const reservation=await f.reserve(item,now-HOUR,now+HOUR),endsAt=f.native.prepare('SELECT ends_at FROM loans WHERE id=?').get(reservation.id).ends_at;
 assert.equal(await closeUncollectedLoans(f.db,endsAt-1),0,'one millisecond before the end it can still be collected');
 assert.equal(f.loan(reservation.id).status,'reserved');
 assert.equal(await closeUncollectedLoans(f.db,endsAt),1,'at the exact end it can no longer be collected');
 assert.deepEqual(f.loan(reservation.id),{status:'cancelled',close_reason:'not_collected',returned_at:null,checked_out_at:null},'never turned into a return');
 assert.equal(await closeUncollectedLoans(f.db,endsAt+HOUR),0,'idempotent');
 const audit=f.native.prepare("SELECT actor_id,project_id,details FROM audit WHERE action='loan.not_collected' AND entity_id=?").all(reservation.id);
 assert.equal(audit.length,1);assert.equal(audit[0].project_id,'project-a');assert.equal(JSON.parse(audit[0].details).reason,'not_collected');
 assert.equal(loanDisplayState('cancelled','not_collected'),'not_collected');assert.equal(loanDisplayState('cancelled',null),'cancelled');
});

test('every request closes overdue reservations first; checked-out loans are never closed and stay late',async t=>{
 const f=await fixture(t),a=await f.equipment('Câmera sintética'),b=await f.equipment('Tripé sintético'),past=Date.now()-HOUR;
 const reserved=f.legacy(a,past),out=f.legacy(b,past,'out');
 await getActor(f.db,f.users['viewer-a']);
 assert.equal(f.loan(reserved).close_reason,'not_collected');
 assert.equal(f.loan(out).status,'out','a loan that left keeps waiting for its return');
 assert.equal(f.loan(out).close_reason,null);assert.equal(f.loan(out).returned_at,null);
});

test('the equipment is freed: a new reservation is accepted; the old reservation cannot be collected or cancelled',async t=>{
 const f=await fixture(t),item=await f.equipment('Projetor sintético'),now=Date.now();
 const old=f.legacy(item,now-60000);
 await getActor(f.db,f.users['owner-a']);
 await assert.rejects(f.run('owner-a','loan.status',{id:old,status:'out'}),e=>e.status===409&&e.code==='loan_not_collected');
 await assert.rejects(f.run('owner-a','loan.status',{id:old,status:'cancelled'}),e=>e.code==='loan_not_collected');
 const next=await f.reserve(item,now-HOUR,now+HOUR);
 assert.equal(f.loan(next.id).status,'reserved','a new reservation for the same equipment is accepted');
 await f.run('owner-a','loan.status',{id:next.id,status:'out',conditionOut:'Sem avarias'});
 assert.equal(f.loan(next.id).status,'out');
});

test('a reservation that already ended is refused at creation',async t=>{
 const f=await fixture(t),item=await f.equipment('Projetor sintético'),now=Date.now();
 await assert.rejects(f.reserve(item,now-3*HOUR,now-HOUR),e=>e.status===400&&e.code==='loan_already_ended');
});

test('report, agenda and list call it "Não retirado", apart from cancellations',async t=>{
 const f=await fixture(t),a=await f.equipment('Câmera sintética'),b=await f.equipment('Tripé sintético'),now=Date.now();
 const missed=f.legacy(a,now-60000);
 const cancelled=await f.reserve(b,now+HOUR,now+2*HOUR);await f.run('owner-a','loan.status',{id:cancelled.id,status:'cancelled'});
 const owner=await f.actor('owner-a');
 const rows=(await reportRows(f.db,owner,{dataset:'loans'})).rows;
 assert.equal(rows.find(row=>row.id===missed).situacao,'not_collected');
 assert.equal(rows.find(row=>row.id===cancelled.id).situacao,'cancelled');
 const entry=(await calendarEntries(f.db,owner,{category:'loans',range:calendarRange()})).entries.find(row=>row.sourceId===missed);
 assert.ok(entry,'the agenda still shows the missed reservation');
 assert.equal(entry.state,'not_collected');assert.equal(entry.status,'CANCELLED');
 const loans=[{state:'not_collected',startsAt:now-2*HOUR,endsAt:now-60000,labels:['Câmera']},{state:'cancelled',startsAt:now+HOUR,endsAt:now+2*HOUR,labels:['Tripé']}];
 assert.deepEqual(loans.filter(loanMatches({...emptyLoanFilters,state:'not_collected'},now)).map(row=>row.labels[0]),['Câmera']);
 assert.deepEqual(loans.filter(loanMatches({...emptyLoanFilters,state:'cancelled'},now)).map(row=>row.labels[0]),['Tripé']);
});

test('the reason is born only when a reservation is closed, and never changes afterwards',async t=>{
 const f=await fixture(t),item=await f.equipment('Projetor sintético'),now=Date.now();
 assert.throws(()=>f.native.prepare("INSERT INTO loans(id,project_id,item_id,action_name,borrower_name,starts_at,ends_at,status,created_by,created_at,close_reason) VALUES('x','project-a',?,?,?,?,?,'cancelled','owner-a',?,'not_collected')").run(item.id,'Ação','Pessoa',now,now+HOUR,f.now),/loan_close_reason/);
 const out=f.legacy(item,now+HOUR,'out');
 assert.throws(()=>f.native.prepare("UPDATE loans SET status='cancelled',close_reason='not_collected' WHERE id=?").run(out),/loan_close_reason/,'only a reservation');
 f.native.prepare("UPDATE loans SET status='returned',returned_at=? WHERE id=?").run(f.now,out);
 const old=f.legacy(item,now-60000);await closeUncollectedLoans(f.db,now);
 assert.equal(f.loan(old).close_reason,'not_collected');
 assert.throws(()=>f.native.prepare("UPDATE loans SET close_reason=NULL WHERE id=?").run(old),/loan_close_reason/);
 assert.throws(()=>f.native.prepare("UPDATE loans SET status='reserved' WHERE id=?").run(old),/loan_close_reason/);
});

test('project detail and snapshot carry the reason, so no screen shows it as a plain cancellation',async t=>{
 const f=await fixture(t),item=await f.equipment('Câmera sintética'),now=Date.now();
 const missed=f.legacy(item,now-60000);
 const owner=await f.actor('owner-a');
 const {projectDetail}=await import(compile('lib/projects.ts'));
 const detail=await projectDetail(f.db,owner,'project-a');
 const row=(detail.relationships?.loans??[]).find(loan=>loan.id===missed);
 assert.equal(row?.close_reason,'not_collected','project detail');
 const {portalSnapshot}=await import(compile('lib/portal-data.ts'));
 const snapshot=await portalSnapshot(f.db,owner);
 assert.equal(snapshot.loans.find(loan=>loan.id===missed).close_reason,'not_collected','snapshot');
});
