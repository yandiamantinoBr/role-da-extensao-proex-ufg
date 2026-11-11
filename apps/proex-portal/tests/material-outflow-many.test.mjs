import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compile,teamFixture} from './support/work-teams-fixture.mjs';
// Saída de vários materiais de uma vez (P9) e "Registrar movimento" pela ficha (R5).
// Serviços reais sobre todas as migrações, em SQLite na memória. Nomes e quantidades são sintéticos.
const {materialsAction,materialDetail,MAX_OUTFLOW_LINES}=await import(compile('lib/materials.ts'));
const {movementDetail}=await import(compile('lib/material-movements.ts'));
const {destinationPage}=await import(compile('lib/material-destinations.ts'));
const key=()=>crypto.randomUUID();

async function fixture(t){
 const f=teamFixture(t),owner=await f.actor('owner-a');
 f.native.prepare("UPDATE members SET role='inventory' WHERE user_id='viewer-a'").run();
 const run=async(who,action,input)=>materialsAction(f.db,await f.actor(who),action,{operationKey:key(),...input});
 const make=async(name,stock,projectId='project-a',category='gift',who='owner-a')=>{const item=(await run(who,'item.create',{projectId,name,category,unit:'unidade',lowStock:0})).item;if(stock)await run(who,'stock.move',{itemId:item.id,kind:'receive',delta:stock,reason:'Recebimento sintético'});return item;};
 const botton=await make('Botton sintético',300),caneta=await make('Caneta sintética',120),folder=await make('Folder sintético',50);
 const stock=id=>f.native.prepare('SELECT stock FROM items WHERE id=?').get(id).stock;
 const movements=()=>f.native.prepare("SELECT COUNT(*) n FROM stock_movements WHERE kind IN ('distribute','consume')").get().n;
 return{...f,owner,run,make,botton,caneta,folder,stock,movements};
}
const lines=(f,a=40,b=25,c=10)=>[{itemId:f.botton.id,quantity:a},{itemId:f.caneta.id,quantity:b},{itemId:f.folder.id,quantity:c}];

test('one operation delivers several materials with the same reason and destination; each line is an ordinary, revisable movement',async t=>{
 const f=await fixture(t);
 const result=await f.run('viewer-a','stock.move.many',{kind:'distribute',lines:lines(f),reason:'Entrega sintética do estande',destinationName:'Estande sintético',destinationKind:'event',processReference:'23070.000000/2026-00'});
 assert.deepEqual(result.movements.map(row=>[row.itemName,row.delta]),[['Botton sintético',-40],['Caneta sintética',-25],['Folder sintético',-10]]);
 assert.deepEqual([f.stock(f.botton.id),f.stock(f.caneta.id),f.stock(f.folder.id)],[260,95,40]);
 assert.equal(result.destination.name,'Estande sintético');
 // One destination was created and every line points to it.
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM material_destinations').get().n,1);
 assert.equal(f.native.prepare('SELECT COUNT(DISTINCT movement_id) n FROM stock_movement_destinations WHERE destination_id=?').get(result.destination.id).n,3);
 const page=await destinationPage(f.db,f.owner,result.destination.id);
 assert.equal(JSON.stringify(page).includes('Caneta sintética'),true);
 // Same note, date and process on each line; the audit keeps one row per movement and one for the whole delivery.
 const stored=f.native.prepare("SELECT m.note,c.process_reference FROM stock_movements m JOIN stock_movement_contexts c ON c.movement_id=m.id WHERE m.kind='distribute'").all();
 assert.deepEqual(stored.map(row=>[row.note,row.process_reference]),Array(3).fill(['Entrega sintética do estande','23070.000000/2026-00']));
 assert.equal(f.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='stock.move' AND json_extract(details,'$.batchId')=?").get(result.batchId).n,3);
 const whole=f.native.prepare("SELECT details FROM audit WHERE action='stock.move.many' AND entity_id=?").get(result.batchId);
 assert.deepEqual([JSON.parse(whole.details).lines,JSON.parse(whole.details).units],[3,75]);
 // The history of each material shows its own line, and it can be corrected or undone there, alone.
 const history=(await materialDetail(f.db,f.owner,f.caneta.id)).movements;
 assert.deepEqual(history.filter(row=>row.kind==='distribute').map(row=>[row.delta,row.status,row.destination?.name]),[[-25,'current','Estande sintético']]);
 const canetaMovement=result.movements[1].id;
 assert.equal((await movementDetail(f.db,f.owner,canetaMovement)).permissions.canRevise,true);
 await f.run('owner-a','stock.revise',{movementId:canetaMovement,mode:'undo',reason:'A caneta não foi entregue'});
 assert.deepEqual([f.stock(f.botton.id),f.stock(f.caneta.id),f.stock(f.folder.id)],[260,120,40],'undoing one line leaves the others');
});

test('all or nothing: an invalid line, a short balance, another project or an equipment records no line at all',async t=>{
 const f=await fixture(t),before=f.movements();
 const attempt=input=>f.run('owner-a','stock.move.many',{kind:'distribute',reason:'Entrega sintética',...input});
 await assert.rejects(attempt({lines:lines(f,40,25,51)}),e=>e.status===409&&e.code==='insufficient_stock'&&/Folder sintético/.test(e.message)&&/Nenhuma linha/.test(e.message));
 await assert.rejects(attempt({lines:[{itemId:f.botton.id,quantity:1}]}),e=>e.code==='invalid_lines','one material goes through its own sheet');
 await assert.rejects(attempt({lines:Array.from({length:MAX_OUTFLOW_LINES+1},()=>({itemId:f.botton.id,quantity:1}))}),e=>e.code==='invalid_lines');
 await assert.rejects(attempt({lines:[{itemId:f.botton.id,quantity:1},{itemId:f.botton.id,quantity:2}]}),e=>e.code==='duplicate_line');
 await assert.rejects(attempt({lines:[{itemId:f.botton.id,quantity:0},{itemId:f.caneta.id,quantity:1}]}),e=>e.code==='invalid_quantity');
 await assert.rejects(attempt({lines:[{itemId:f.botton.id,quantity:1.5},{itemId:f.caneta.id,quantity:1}]}),e=>e.code==='invalid_quantity');
 await assert.rejects(attempt({kind:'receive',lines:lines(f)}),e=>e.code==='invalid_movement','only deliveries and consumption');
 await assert.rejects(attempt({kind:'adjust',lines:lines(f)}),e=>e.code==='invalid_movement');
 await assert.rejects(attempt({lines:lines(f),reason:''}),e=>e.status===400,'the reason is required');
 const other=await f.make('Material de outro projeto',20,'project-a2');
 await assert.rejects(attempt({lines:[{itemId:f.botton.id,quantity:1},{itemId:other.id,quantity:1}]}),e=>e.code==='mixed_projects');
 const projector=await f.make('Projetor sintético',1,'project-a','equipment');
 await assert.rejects(attempt({lines:[{itemId:f.botton.id,quantity:1},{itemId:projector.id,quantity:1}]}),e=>e.code==='equipment_movement'&&/Projetor sintético/.test(e.message));
 await assert.rejects(attempt({lines:[{itemId:f.botton.id,quantity:1},{itemId:'nao-existe',quantity:1}]}),e=>e.status===404);
 f.native.prepare("UPDATE items SET condition='inactive' WHERE id=?").run(f.folder.id);
 await assert.rejects(attempt({lines:lines(f)}),e=>e.code==='item_inactive'&&/Folder sintético/.test(e.message));
 assert.equal(f.movements(),before,'no outflow was recorded');
 assert.deepEqual([f.stock(f.botton.id),f.stock(f.caneta.id)],[300,120]);
 assert.equal(f.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='stock.move.many'").get().n,0);
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM material_destinations').get().n,0,'no destination is left behind');
});

test('a balance that changes between the check and the write rolls every line back',async t=>{
 const f=await fixture(t);let armed=true;
 // Another delivery of the last material lands after this request read the balances.
 f.db.afterRead=sql=>{if(armed&&/FROM stock_movements WHERE ref_id IN/.test(sql)){armed=false;f.native.prepare("INSERT INTO stock_movements(id,item_id,delta,kind,note,ref_id,actor_id,created_at) VALUES('race',?,-45,'distribute','Entrega concorrente','race:1','owner-a',?)").run(f.folder.id,f.now);}};
 await assert.rejects(f.run('owner-a','stock.move.many',{kind:'consume',lines:lines(f,10,10,10),reason:'Consumo sintético'}),e=>e.status===409&&e.code==='insufficient_stock');
 f.db.afterRead=null;
 assert.deepEqual([f.stock(f.botton.id),f.stock(f.caneta.id),f.stock(f.folder.id)],[300,120,5],'only the concurrent delivery happened');
 assert.equal(f.native.prepare("SELECT COUNT(*) n FROM stock_movements WHERE kind='consume'").get().n,0);
});

test('a repeated request returns the same delivery once; the same key with other data is refused',async t=>{
 const f=await fixture(t),operationKey=key(),input={kind:'consume',lines:lines(f,5,6,7),reason:'Consumo sintético da oficina',operationKey};
 const first=await f.run('owner-a','stock.move.many',input),again=await f.run('owner-a','stock.move.many',input);
 assert.equal(again.duplicate,true);
 assert.deepEqual(again.movements.map(row=>row.id),first.movements.map(row=>row.id));
 assert.deepEqual([f.stock(f.botton.id),f.stock(f.caneta.id),f.stock(f.folder.id)],[295,114,43],'the balance moved once');
 assert.equal(f.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='stock.move.many'").get().n,1);
 await assert.rejects(f.run('owner-a','stock.move.many',{...input,lines:lines(f,5,6,8)}),e=>e.status===409&&e.code==='operation_conflict');
 await assert.rejects(f.run('owner-a','stock.move.many',{...input,reason:'Outro motivo'}),e=>e.code==='operation_conflict');
 await assert.rejects(f.run('owner-a','stock.move.many',{...input,lines:lines(f,5,6,7).slice(0,2)}),e=>e.code==='operation_conflict');
 // The key belongs to who used it: another person with the same key starts another delivery.
 const other=await f.run('viewer-a','stock.move.many',input);
 assert.equal(other.duplicate,undefined);assert.equal(f.stock(f.botton.id),290);
});

test('only who manages the stock of that project can do it, checked again inside the write',async t=>{
 const f=await fixture(t),input={kind:'distribute',lines:lines(f),reason:'Entrega sintética'};
 await assert.rejects(f.run('other-a2','stock.move.many',input),e=>e.status===403,'stock keeper of another project');
 await assert.rejects(f.run('owner-b','stock.move.many',input),e=>e.status===403,'another organization');
 f.native.prepare("UPDATE members SET role='viewer' WHERE user_id='viewer-a'").run();
 await assert.rejects(f.run('viewer-a','stock.move.many',input),e=>e.status===403,'a report reader');
 f.native.prepare("UPDATE members SET role='inventory' WHERE user_id='viewer-a'").run();
 // Access revoked after the request loaded the person: the assertion inside the batch refuses the write.
 const stale=await f.actor('viewer-a');let armed=true;
 f.db.afterRead=sql=>{if(armed&&/FROM stock_movements WHERE ref_id IN/.test(sql)){armed=false;f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='viewer-a'").run(f.now);}};
 await assert.rejects(materialsAction(f.db,stale,'stock.move.many',{...input,operationKey:key()}),e=>e.status===403);
 f.db.afterRead=null;
 assert.equal(f.movements(),0);assert.equal(f.stock(f.botton.id),300);
});

test('Registrar movimento has one path: the page opens the material sheet instead of keeping a second form',()=>{
 const portal=readFileSync(new URL('../app/portal-client.tsx',import.meta.url),'utf8');
 assert.doesNotMatch(portal,/OperationForm action="stock\.move"/,'the page no longer posts a movement by itself');
 assert.match(portal,/<MovementLauncher/);
 const launcher=readFileSync(new URL('../components/portal/movement-launcher.tsx',import.meta.url),'utf8');
 assert.match(launcher,/onOpenMaterial\(/,'choosing a material opens its sheet');
 assert.match(launcher,/'stock\.move\.many'/);
 assert.doesNotMatch(launcher,/'stock\.move'[,)]/,'a single movement is recorded only in the sheet');
 // The sheet is the one place that records a single movement, with the field name the server documents.
 const sheet=readFileSync(new URL('../components/portal/material-detail-drawer.tsx',import.meta.url),'utf8');
 assert.match(sheet,/action\('stock\.move', \{ itemId, kind: moveKind, delta, reason:/);
});
