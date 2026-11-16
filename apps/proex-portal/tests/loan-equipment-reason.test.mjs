import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compile,teamFixture} from './support/work-teams-fixture.mjs';
// Seletor de equipamento com o motivo de indisponibilidade (16/11). O servidor continua conferindo. Dados sintéticos.
const {materialsAction}=await import(compile('lib/materials.ts'));
const {equipmentStatus,equipmentOptionLabel,equipmentBlockMessage}=await import(compile('lib/equipment-availability.ts'));
const {projectDetail}=await import(compile('lib/projects.ts'));
const key=()=>crypto.randomUUID();
const HOUR=3600000;

async function fixture(t){
 const f=teamFixture(t);
 const run=async(who,action,input)=>materialsAction(f.db,await f.actor(who),action,{operationKey:key(),...input});
 const equipment=async(name,{receive=true}={})=>{const item=(await run('owner-a','item.create',{projectId:'project-a',name,category:'equipment',unit:'unidade',lowStock:0})).item;if(receive)await run('owner-a','stock.move',{itemId:item.id,kind:'receive',delta:1,reason:'Entrada sintética'});return item;};
 const reserve=(item,startsAt,endsAt)=>run('owner-a','loan.create',{projectId:'project-a',itemId:item.id,actionName:'Oficina sintética',borrowerName:'Pessoa fictícia',startsAt:new Date(startsAt).toISOString(),endsAt:new Date(endsAt).toISOString()});
 const setCondition=(item,condition)=>f.native.prepare('UPDATE items SET condition=? WHERE id=?').run(condition,item.id);
 return{...f,run,equipment,reserve,setCondition};
}

test('the reason is written for each case, and only active equipment with one unit can be reserved',()=>{
 assert.deepEqual(equipmentStatus({condition:'active',stock:1}),{reservable:true,reason:''});
 assert.deepEqual(equipmentStatus({condition:'maintenance',stock:1}),{reservable:false,reason:'em manutenção'});
 assert.deepEqual(equipmentStatus({condition:'inactive',stock:1}),{reservable:false,reason:'inativo'});
 assert.deepEqual(equipmentStatus({condition:'active',stock:0}),{reservable:false,reason:'sem entrada no estoque'});
 assert.deepEqual(equipmentStatus({condition:'active',stock:1,on_loan:true}),{reservable:true,reason:'retirado agora'},'another time slot can still be reserved');
 assert.deepEqual(equipmentStatus({condition:'active',stock:1,reserved_now:1}),{reservable:true,reason:'reservado agora'});
 assert.equal(equipmentOptionLabel({name:'Projetor',condition:'maintenance',stock:1}),'Projetor · em manutenção');
 assert.equal(equipmentOptionLabel({name:'Projetor',condition:'active',stock:1}),'Projetor');
 assert.match(equipmentBlockMessage({condition:'maintenance'},'checkout'),/retirada fica bloqueada.*manutenção/);
 assert.equal(equipmentBlockMessage({condition:'active',stock:1},'reserve'),null);
});

test('the server refuses with the reason: maintenance, inactive and no unit in stock',async t=>{
 const f=await fixture(t),now=Date.now();
 const repair=await f.equipment('Projetor em conserto');f.setCondition(repair,'maintenance');
 await assert.rejects(f.reserve(repair,now+HOUR,now+2*HOUR),e=>e.status===409&&e.code==='equipment_unavailable'&&/manutenção/.test(e.message));
 const retired=await f.equipment('Câmera antiga');f.setCondition(retired,'inactive');
 await assert.rejects(f.reserve(retired,now+HOUR,now+2*HOUR),e=>e.code==='equipment_unavailable'&&/inativo/.test(e.message));
 const empty=await f.equipment('Tripé sem entrada',{receive:false});
 await assert.rejects(f.reserve(empty,now+HOUR,now+2*HOUR),e=>e.code==='equipment_unavailable'&&/estoque/.test(e.message));
 const gift=(await f.run('owner-a','item.create',{projectId:'project-a',name:'Botton sintético',category:'gift',unit:'unidade',lowStock:0})).item;
 await assert.rejects(f.reserve(gift,now+HOUR,now+2*HOUR),e=>e.code==='equipment_unavailable'&&/equipamento individual/.test(e.message));
});

test('maintenance recorded after the reservation blocks the checkout and says why; back in use, it works',async t=>{
 const f=await fixture(t),now=Date.now(),item=await f.equipment('Projetor sintético');
 const loan=(await f.reserve(item,now-HOUR,now+HOUR)).loan;
 f.setCondition(item,'maintenance');
 await assert.rejects(f.run('owner-a','loan.status',{id:loan.id,status:'out'}),e=>e.status===409&&e.code==='equipment_unavailable'&&/manutenção/.test(e.message));
 assert.equal(f.native.prepare('SELECT status FROM loans WHERE id=?').get(loan.id).status,'reserved','nothing changed');
 f.setCondition(item,'active');
 await f.run('owner-a','loan.status',{id:loan.id,status:'out',conditionOut:'Sem avarias'});
 assert.equal(f.native.prepare('SELECT status FROM loans WHERE id=?').get(loan.id).status,'out');
});

test('the project quick entry lists unavailable equipment with its state, so the selector can explain it',async t=>{
 const f=await fixture(t),repair=await f.equipment('Projetor em conserto');f.setCondition(repair,'maintenance');
 await f.equipment('Câmera pronta');
 const list=(await projectDetail(f.db,await f.actor('owner-a'),'project-a')).relationships.loanEquipment;
 assert.deepEqual(list.map(item=>[item.name,item.condition,Number(item.stock)]),[['Câmera pronta','active',1],['Projetor em conserto','maintenance',1]],'available first');
 // Both forms show the reason and disable what cannot be reserved.
 for(const file of ['../app/portal-client.tsx','../components/portal/project-quick-entry.tsx']){
  const source=readFileSync(new URL(file,import.meta.url),'utf8');
  assert.match(source,/disabled=\{!equipmentStatus\((i|item)\)\.reservable\}/);
  assert.match(source,/equipmentOptionLabel\((i|item)\)/);
 }
});
