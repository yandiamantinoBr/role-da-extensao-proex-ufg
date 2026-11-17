import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compile,teamFixture} from './support/work-teams-fixture.mjs';
// Critério de data dos empréstimos (decisão de 16/11): sobreposição em lista, Agenda e Relatórios, em Brasília.
// Entra o empréstimo em curso em algum momento do período, mesmo que tenha começado antes. Dados sintéticos.
const {materialsAction}=await import(compile('lib/materials.ts'));
const {reportRows}=await import(compile('lib/reports.ts'));
const {calendarEntries,calendarRange}=await import(compile('lib/calendar.ts'));
const {loanMatches,emptyLoanFilters}=await import(compile('lib/loan-list-filters.ts'));
const at=text=>new Date(`${text}-03:00`).toISOString();
// Período consultado: 10/03/2099 a 12/03/2099 (inclusive), em Brasília.
const CASES=[
 ['Começa antes e termina dentro','2099-03-09T10:00:00','2099-03-10T10:00:00',true],
 ['Cobre o período inteiro','2099-03-08T09:00:00','2099-03-15T18:00:00',true],
 ['Termina exatamente no início do período','2099-03-09T10:00:00','2099-03-10T00:00:00',false],
 ['Começa exatamente depois do último dia','2099-03-13T00:00:00','2099-03-13T05:00:00',false],
 ['Começa no último dia e passa da meia-noite','2099-03-12T23:30:00','2099-03-13T01:00:00',true],
];
const EXPECTED=CASES.filter(c=>c[3]).map(c=>c[0]).sort();

async function fixture(t){
 const f=teamFixture(t);
 const run=async(action,input)=>materialsAction(f.db,await f.actor('owner-a'),action,{operationKey:crypto.randomUUID(),...input});
 for(const [name,startsAt,endsAt] of CASES){
  const item=(await run('item.create',{projectId:'project-a',name:`Bem · ${name}`,category:'equipment',unit:'unidade',lowStock:0})).item;
  await run('stock.move',{itemId:item.id,kind:'receive',delta:1,reason:'Entrada sintética'});
  await run('loan.create',{projectId:'project-a',itemId:item.id,actionName:name,borrowerName:'Pessoa fictícia',startsAt:at(startsAt),endsAt:at(endsAt)});
 }
 return f;
}

test('reports use overlap in Brasília, with exact limits at midnight; the old start-date criterion missed loans that began earlier',async t=>{
 const f=await fixture(t);
 const {rows}=await reportRows(f.db,await f.actor('owner-a'),{dataset:'loans',from:'2099-03-10',to:'2099-03-12'});
 assert.deepEqual(rows.map(row=>row.acao).sort(),EXPECTED);
 const onlyFrom=(await reportRows(f.db,await f.actor('owner-a'),{dataset:'loans',from:'2099-03-13'})).rows.map(row=>row.acao).sort();
 assert.deepEqual(onlyFrom,['Cobre o período inteiro','Começa exatamente depois do último dia','Começa no último dia e passa da meia-noite']);
});

test('list, Agenda and reports agree on the same loans for the same period',async t=>{
 const f=await fixture(t);
 const list=CASES.filter(([name,startsAt,endsAt])=>loanMatches({...emptyLoanFilters,from:'2099-03-10',to:'2099-03-12'},Date.now())({state:'reserved',startsAt:at(startsAt),endsAt:at(endsAt),labels:[name]})).map(c=>c[0]).sort();
 assert.deepEqual(list,EXPECTED);
 const agenda=(await calendarEntries(f.db,await f.actor('owner-a'),{category:'loans',range:calendarRange('2099-03-10','2099-03-12')})).entries;
 assert.deepEqual(agenda.map(entry=>CASES.find(c=>entry.title.includes(c[0]))?.[0]).filter(Boolean).sort(),EXPECTED);
});

test('the criterion is written on the screen in the list, Agenda and Reports, and the forms say Brasília before saving',()=>{
 const read=file=>readFileSync(new URL(file,import.meta.url),'utf8');
 const client=read('../app/portal-client.tsx'),agenda=read('../components/portal/calendar-panel.tsx'),reports=read('../components/portal/reports-center.tsx'),quick=read('../components/portal/project-quick-entry.tsx');
 assert.match(client,/Entram os empréstimos em curso em algum momento entre as datas, mesmo que tenham começado antes\. Horário de Brasília\./);assert.match(agenda,/Entram os compromissos em curso em algum momento entre as datas, mesmo que tenham começado antes\. Horário de Brasília\./);
 assert.match(reports,/O período inclui todo empréstimo em curso entre as datas, mesmo que tenha começado antes \(horário de Brasília\)/);
 assert.match(client,/<strong>Empréstimos:<\/strong> entram os que estavam em curso em algum momento do período, mesmo que tenham começado antes\./,'visible next to the report period');
 assert.match(reports,/\['Critério de data', 'Entram os empréstimos em curso/,'the exported file carries the criterion');
 assert.match(client,/<Field label="Retirada prevista \(horário de Brasília\)">/);assert.match(client,/<Field label="Devolução prevista \(horário de Brasília\)">/);
 assert.equal((quick.match(/<span>(Retirada|Devolução) prevista \(horário de Brasília\) \*<\/span>/g)||[]).length,2);
});
