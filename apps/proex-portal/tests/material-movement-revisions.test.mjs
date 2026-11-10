import test from 'node:test';
import assert from 'node:assert/strict';
import {compile,teamFixture} from './support/work-teams-fixture.mjs';
// Real services over every migration in SQLite. Names, units and files are synthetic; no bytes are stored.
const {materialsAction,materialDetail}=await import(compile('lib/materials.ts'));
const {movementDetail}=await import(compile('lib/material-movements.ts'));
const {destinationPage,listDestinations}=await import(compile('lib/material-destinations.ts'));
const {stockConsumption}=await import(compile('lib/stock-context.ts'));
const key=()=>crypto.randomUUID();

async function fixture(t){
 const f=teamFixture(t),owner=await f.actor('owner-a');
 // A second person who also moves the stock of project A (the "Adriana" of the request).
 f.native.prepare("UPDATE members SET role='inventory' WHERE user_id='viewer-a'").run();
 f.native.prepare("UPDATE profiles SET display_name='Pessoa do Estoque' WHERE user_id='viewer-a'").run();
 f.insert('organizational_units',{id:'unit-gabinete',name:'Gabinete sintético',acronym:'GAB',kind:'proex',created_at:f.now,updated_at:f.now});
 const run=async(who,action,input)=>materialsAction(f.db,await f.actor(who),action,{operationKey:key(),...input});
 const item=(await run('owner-a','item.create',{projectId:'project-a',name:'Botton azul sintético',category:'gift',unit:'unidade',lowStock:0})).item;
 await run('owner-a','stock.move',{itemId:item.id,kind:'receive',delta:700,reason:'Recebimento sintético'});
 const deliver=async(quantity=100,extra={})=>(await run('owner-a','stock.move',{itemId:item.id,kind:'distribute',delta:-quantity,reason:'Entrega sintética para o evento',...extra})).movement;
 const stock=()=>f.native.prepare('SELECT stock FROM items WHERE id=?').get(item.id).stock;
 return{...f,owner,item,run,deliver,stock};
}

test('a correction 100 → 150 adjusts the balance, keeps the original visible as corrected and records who, when, why, before and after',async t=>{
 const f=await fixture(t);const original=await f.deliver(100);assert.equal(f.stock(),600);
 const result=await f.run('viewer-a','stock.revise',{movementId:original.id,mode:'correct',quantity:150,note:'Entrega sintética para o evento',reason:'Foram 150 unidades, conferido no recibo'});
 assert.equal(f.stock(),550);assert.equal(result.revision.kind,'correction');assert.equal(result.revision.actorName,'Pessoa do Estoque');
 assert.equal(result.revision.before.delta,-100);assert.equal(result.revision.after.delta,-150);
 const history=(await materialDetail(f.db,f.owner,f.item.id)).movements;
 // Mirrors are bookkeeping: the list shows the corrected original and its current version.
 assert.deepEqual(history.filter(row=>row.kind==='distribute').map(row=>[row.delta,row.status]),[[-150,'current'],[-100,'corrected']]);
 const old=history.find(row=>row.id===original.id),current=history.find(row=>row.id===result.currentMovementId);
 assert.equal(old.revision.actorName,'Pessoa do Estoque');assert.equal(old.revision.reason,'Foram 150 unidades, conferido no recibo');
 assert.equal(current.correctionOf.targetMovementId,original.id);assert.equal(current.correctionOf.before.delta,-100);assert.equal(current.origin.label,'Corrigido por Pessoa do Estoque');
 const detail=await movementDetail(f.db,f.owner,original.id);
 assert.equal(detail.role,'original');assert.equal(detail.currentMovementId,result.currentMovementId);assert.equal(detail.versions.length,2);
 assert.deepEqual(detail.balance,{before:700,after:600,current:550});assert.equal(detail.permissions.canRevise,false,'only the current version is revised');
 assert.equal((await movementDetail(f.db,f.owner,result.currentMovementId)).permissions.canRevise,true);
 assert.equal(f.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='stock.revise'").get().n,1);
 // A second correction on the current version keeps the same chain.
 const again=await f.run('owner-a','stock.revise',{movementId:result.currentMovementId,mode:'correct',quantity:140,note:'Entrega sintética para o evento',reason:'Recontagem do recibo'});
 assert.equal(f.stock(),560);assert.equal((await movementDetail(f.db,f.owner,original.id)).revisions.length,2);assert.equal(again.revision.before.delta,-150);
 await assert.rejects(f.run('owner-a','stock.revise',{movementId:original.id,mode:'correct',quantity:120,note:'x',reason:'Outra tentativa'}),e=>e.status===409&&e.code==='movement_already_revised');
});

test('undo appends a cancelling row, marks the movement as undone and cannot be repeated; mirrors are never revised',async t=>{
 const f=await fixture(t);const original=await f.deliver(100);
 const result=await f.run('owner-a','stock.revise',{movementId:original.id,mode:'undo',reason:'Lançamento em duplicidade'});
 assert.equal(f.stock(),700);assert.equal(result.currentMovementId,null);
 const row=(await materialDetail(f.db,f.owner,f.item.id)).movements.find(entry=>entry.id===original.id);assert.equal(row.status,'undone');assert.equal(row.revision.reason,'Lançamento em duplicidade');
 await assert.rejects(f.run('owner-a','stock.revise',{movementId:original.id,mode:'undo',reason:'De novo'}),e=>e.code==='movement_already_revised');
 const mirror=f.native.prepare('SELECT reversal_movement_id id FROM stock_movement_revisions').get().id;
 await assert.rejects(f.run('owner-a','stock.revise',{movementId:mirror,mode:'undo',reason:'Anular anulação'}),e=>e.code==='movement_not_revisable');
 assert.equal((await movementDetail(f.db,f.owner,mirror)).role,'mirror');
 // The ledger stays append-only.
 assert.throws(()=>f.native.prepare('UPDATE stock_movement_revisions SET reason=?').run('x'),/stock_revision_immutable/);
 assert.throws(()=>f.native.prepare('DELETE FROM stock_movement_revisions').run(),/stock_revision_immutable/);
 assert.throws(()=>f.native.prepare('DELETE FROM stock_movements WHERE id=?').run(original.id),/movement_immutable/);
});

test('idempotent by operationKey; a key reused with other data is refused; nothing changed is refused',async t=>{
 const f=await fixture(t);const original=await f.deliver(100),operationKey=key();
 const input={movementId:original.id,mode:'correct',quantity:150,note:'Entrega sintética para o evento',reason:'Foram 150',operationKey};
 const first=await f.run('owner-a','stock.revise',input),replay=await f.run('owner-a','stock.revise',input);
 assert.equal(replay.duplicate,true);assert.equal(replay.revision.id,first.revision.id);assert.equal(f.stock(),550);
 await assert.rejects(f.run('owner-a','stock.revise',{...input,quantity:160}),e=>e.status===409);
 const other=await f.deliver(10);
 await assert.rejects(f.run('owner-a','stock.revise',{movementId:other.id,mode:'correct',quantity:10,note:'Entrega sintética para o evento',reason:'Sem mudança'}),e=>e.code==='revision_unchanged');
});

test('permission: only who moves the stock of the project; revocation during the batch rolls everything back',async t=>{
 const f=await fixture(t);const original=await f.deliver(100);
 for(const who of ['other-a2','owner-b'])await assert.rejects(f.run(who,'stock.revise',{movementId:original.id,mode:'undo',reason:'Sem acesso'}),e=>e.status===403);
 const batch=f.db.batch;let fired=false;f.db.batch=async statements=>{if(!fired){fired=true;f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='owner-a'").run(f.now);}return batch(statements);};
 await assert.rejects(f.run('owner-a','stock.revise',{movementId:original.id,mode:'undo',reason:'Acesso revogado'}),e=>e.status===403);
 f.db.batch=batch;f.native.prepare("UPDATE members SET revoked_at=NULL WHERE user_id='owner-a'").run();
 assert.equal(f.stock(),600);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM stock_movement_revisions').get().n,0);
});

test('undoing an entry that later outflows depend on is refused without touching the balance',async t=>{
 const f=await fixture(t);const receipt=f.native.prepare("SELECT id FROM stock_movements WHERE kind='receive'").get().id;await f.deliver(650);
 await assert.rejects(f.run('owner-a','stock.revise',{movementId:receipt,mode:'undo',reason:'Teste de saldo'}),e=>e.code==='insufficient_stock');
 assert.equal(f.stock(),50);
});

test('origin of an assistant movement reads "Feito pelo Rolê a pedido de …" and shows the request when it was kept',async t=>{
 const f=await fixture(t);const movement=await f.deliver(100);
 f.insert('ai_plans',{id:'plan-sintetico',actor_id:'owner-a',project_id:'project-a',payload_json:'{}',payload_digest:'x',expires_at:0,status:'applied',result_json:JSON.stringify({ok:true,movementId:movement.id}),created_at:f.now});
 const row=(await materialDetail(f.db,f.owner,f.item.id)).movements.find(entry=>entry.id===movement.id);
 assert.deepEqual(row.origin,{via:'assistant',label:'Feito pelo Rolê a pedido de Gestão Aurora'});
 assert.deepEqual((await movementDetail(f.db,f.owner,movement.id)).movement.origin,{via:'assistant',label:'Feito pelo Rolê a pedido de Gestão Aurora'},'sem pedido guardado, sem resumo');
 const summary='Registrar saída de 100 canetas para a oficina.';
 f.native.prepare("UPDATE ai_plans SET result_json=? WHERE id='plan-sintetico'").run(JSON.stringify({ok:true,movementId:movement.id,origin:summary}));
 const expected={via:'assistant',label:'Feito pelo Rolê a pedido de Gestão Aurora',summary};
 assert.deepEqual((await movementDetail(f.db,f.owner,movement.id)).movement.origin,expected);
 assert.deepEqual((await materialDetail(f.db,f.owner,f.item.id)).movements.find(entry=>entry.id===movement.id).origin,expected);
 const manual=await f.deliver(5);
 assert.equal('summary' in (await movementDetail(f.db,f.owner,manual.id)).movement.origin,false,'movimento manual não ganha resumo');
 f.native.prepare("UPDATE ai_plans SET result_json=? WHERE id='plan-sintetico'").run(JSON.stringify({ok:true,movementId:movement.id,origin:{texto:summary}}));
 assert.equal('summary' in (await movementDetail(f.db,f.owner,movement.id)).movement.origin,false,'valor que não é texto é ignorado');
});

test('destinations: typed names are matched or created once, have a page with what went there, and corrections move the totals',async t=>{
 const f=await fixture(t);const first=await f.deliver(100,{destinationName:'Centro de Eventos sintético',destinationKind:'place'});
 const second=await f.deliver(20,{destinationName:'  centro de eventos SINTÉTICO '});
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM material_destinations').get().n,1);assert.equal(first.destination.id,second.destination.id);
 const destinationId=first.destination.id;
 let page=await destinationPage(f.db,f.owner,destinationId);
 assert.equal(page.destination.name,'Centro de Eventos sintético');assert.equal(page.movements.length,2);assert.equal(page.totals[0].outgoing,120);
 assert.ok(page.movements[0].materialHref.includes(f.item.id));
 const evento=(await f.run('owner-a','destination.create',{projectId:'project-a',kind:'event',name:'Evento sintético 2026',officialUrl:'https://example.invalid/evento'})).destination;
 await f.run('owner-a','stock.revise',{movementId:first.id,mode:'correct',quantity:150,note:'Entrega sintética para o evento',destinationId:evento.id,reason:'Foi para o evento'});
 page=await destinationPage(f.db,f.owner,destinationId);assert.equal(page.totals[0].outgoing,20);assert.deepEqual(page.movements.map(row=>row.status).sort(),['corrected','current']);
 const eventPage=await destinationPage(f.db,f.owner,evento.id);assert.equal(eventPage.totals[0].outgoing,150);assert.equal(eventPage.destination.officialUrl,'https://example.invalid/evento');
 assert.equal((await listDestinations(f.db,f.owner,'project-a')).destinations.length,2);
 // Another organization neither sees nor uses it; an unsafe link is refused; archived names are not reused silently.
 await assert.rejects(destinationPage(f.db,await f.actor('owner-b'),destinationId),e=>e.status===403);
 await assert.rejects(f.run('owner-a','destination.create',{projectId:'project-a',name:'Link inseguro',officialUrl:'javascript:alert(1)'}),e=>e.status===400);
 await f.run('owner-a','destination.update',{id:destinationId,expectedVersion:1,status:'archived'});
 await assert.rejects(f.deliver(5,{destinationId}),e=>e.code==='stock_destination_scope');
 await assert.rejects(f.deliver(5,{destinationName:'Centro de eventos sintético'}),e=>e.code==='stock_destination_scope');
 assert.throws(()=>f.native.prepare('DELETE FROM material_destinations').run(),/material_destination_immutable/);
});

test('reports and consumption count each corrected chain once and skip undone movements',async t=>{
 const f=await fixture(t);const a=await f.deliver(100),b=await f.deliver(30);
 await f.run('owner-a','stock.revise',{movementId:a.id,mode:'correct',quantity:150,note:'Entrega sintética para o evento',reason:'Foram 150'});
 await f.run('owner-a','stock.revise',{movementId:b.id,mode:'undo',reason:'Não aconteceu'});
 const view=await stockConsumption(f.db,f.owner,{projectId:'project-a'});
 const outgoing=view.groups.filter(group=>group.kind==='distribute').reduce((sum,group)=>sum+Number(group.quantity),0);
 assert.equal(outgoing,150);assert.equal(view.movements.filter(row=>row.kind==='distribute').length,1);
 assert.equal(f.stock(),550);
});

test('evidence files: linked to the movement, kept out of the photo gallery, never the main photo, deleted only with a reason',async t=>{
 const f=await fixture(t);const movement=await f.deliver(100);
 const {recordId}=await f.run('owner-a','stock.evidence.prepare',{movementId:movement.id});
 assert.equal((await f.run('owner-a','stock.evidence.prepare',{movementId:movement.id})).recordId,recordId,'one evidence record per movement');
 const file=(name,mime)=>{const id=key();f.insert('record_attachments',{id,record_id:recordId,project_id:'project-a',object_key:`synthetic/${id}`,name,mime,size:10,operation_key:key(),created_by:'owner-a',created_at:f.now});return id;};
 const photo=file('entrega-com-processo.jpg','image/jpeg'),pdf=file('processo-ci.pdf','application/pdf');
 let detail=await movementDetail(f.db,f.owner,movement.id);assert.deepEqual(detail.movement.attachments.map(entry=>entry.id).sort(),[photo,pdf].sort());
 const material=await materialDetail(f.db,f.owner,f.item.id);assert.equal(material.photos.length,0);assert.equal(material.movements.find(row=>row.id===movement.id).attachmentCount,2);
 await assert.rejects(f.run('owner-a','item.photo.primary',{itemId:f.item.id,attachmentId:photo,expectedAttachmentId:null}),e=>e.code==='primary_photo_invalid');
 assert.throws(()=>f.insert('item_primary_photos',{id:key(),item_id:f.item.id,project_id:'project-a',attachment_id:photo,actor_id:'owner-a',created_at:f.now}),/primary_photo_changed/);
 await assert.rejects(f.run('owner-a','stock.attachment.delete',{movementId:movement.id,attachmentId:photo,reason:''}),e=>e.status===400);
 await assert.rejects(f.run('other-a2','stock.attachment.delete',{movementId:movement.id,attachmentId:photo,reason:'Foto errada'}),e=>e.status===403);
 await f.run('owner-a','stock.attachment.delete',{movementId:movement.id,attachmentId:photo,reason:'Foto de outra entrega'});
 detail=await movementDetail(f.db,f.owner,movement.id);assert.deepEqual(detail.movement.attachments.map(entry=>entry.id),[pdf]);
 assert.equal(detail.deletedAttachments[0].reason,'Foto de outra entrega');assert.equal(detail.deletedAttachments[0].actorName,'Gestão Aurora');
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM record_attachments').get().n,2,'the row and the stored file stay; only hidden');
});

test('material photos: a wrong photo is deleted logically with who, when and why; the main photo must be replaced first',async t=>{
 const f=await fixture(t);
 const photo=name=>{const recordId=key(),id=key();f.insert('records',{id:recordId,project_id:'project-a',kind:'material',title:'Foto sintética',occurred_at:f.now,item_id:f.item.id,created_by:'owner-a',created_at:f.now});f.insert('record_attachments',{id,record_id:recordId,project_id:'project-a',object_key:`synthetic/${id}`,name,mime:'image/jpeg',size:10,operation_key:key(),created_by:'owner-a',created_at:f.now});return id;};
 const good=photo('boton.jpg'),wrong=photo('foto-errada.jpg');
 const shown=(await materialDetail(f.db,f.owner,f.item.id)).primaryPhotoId;
 if(shown!==wrong)await f.run('owner-a','item.photo.primary',{itemId:f.item.id,attachmentId:wrong,expectedAttachmentId:shown});
 await f.run('owner-a','item.photo.primary',{itemId:f.item.id,attachmentId:good,expectedAttachmentId:wrong});
 await assert.rejects(f.run('owner-a','item.photo.delete',{itemId:f.item.id,attachmentId:good,reason:'Quero apagar'}),e=>e.code==='primary_photo_delete');
 await f.run('viewer-a','item.photo.delete',{itemId:f.item.id,attachmentId:wrong,reason:'Foto de outro material'});
 const view=await materialDetail(f.db,f.owner,f.item.id);
 assert.deepEqual(view.photos.map(entry=>entry.id),[good]);assert.equal(view.deletedPhotos[0].actorName,'Pessoa do Estoque');assert.equal(view.deletedPhotos[0].reason,'Foto de outro material');
 assert.equal(view.photoHistory[0].previousDeleted,true);assert.equal(view.photoHistory[0].previousUrl,null);
 await assert.rejects(f.run('owner-a','item.photo.delete',{itemId:f.item.id,attachmentId:wrong,reason:'De novo'}),e=>e.code==='attachment_changed');
});

test('ownership: a unit may own the material and an event destination may be set; scope is enforced',async t=>{
 const f=await fixture(t);const evento=(await f.run('owner-a','destination.create',{projectId:'project-a',kind:'event',name:'Evento sintético da comunicação'})).destination;
 const updated=(await f.run('owner-a','item.update',{id:f.item.id,expectedVersion:f.item.version,ownerUnitId:'unit-gabinete',eventDestinationId:evento.id})).item;
 assert.equal(updated.owner_unit_id,'unit-gabinete');assert.equal(updated.event_destination_id,evento.id);assert.equal(updated.stock,700,'ownership never touches balances');
 const view=await materialDetail(f.db,f.owner,f.item.id);assert.equal(view.ownership.ownerUnit.name,'Gabinete sintético');assert.equal(view.ownership.eventDestination.name,'Evento sintético da comunicação');
 assert.equal((await destinationPage(f.db,f.owner,evento.id)).destinedItems[0].id,f.item.id);
 const foreign=(await materialsAction(f.db,await f.actor('owner-b'),'destination.create',{projectId:'project-b',name:'Destino reservado B',operationKey:key()})).destination;
 await assert.rejects(f.run('owner-a','item.update',{id:f.item.id,expectedVersion:updated.version,eventDestinationId:foreign.id}),e=>e.code==='item_owner_scope');
 assert.throws(()=>f.native.prepare('UPDATE items SET event_destination_id=? WHERE id=?').run(foreign.id,f.item.id),/item_owner_scope/);
 const back=(await f.run('owner-a','item.update',{id:f.item.id,expectedVersion:updated.version,ownerUnitId:null,eventDestinationId:null})).item;assert.equal(back.owner_unit_id,null);
});
