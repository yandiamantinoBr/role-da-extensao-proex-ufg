import test from 'node:test';
import assert from 'node:assert/strict';
import {compile,teamFixture} from './support/work-teams-fixture.mjs';
// Real services over migrated SQLite. Synthetic names only.
const {prizeTiersWorkspace,prizeTiersAction}=await import(compile('lib/prize-tiers/service.ts'));
const {tierOdds,DEFAULT_SUPER_SUPER_PERCENT}=await import(compile('lib/prize-tiers/contracts.ts'));
const {materialsAction}=await import(compile('lib/materials.ts'));
const {campaignAction}=await import(compile('lib/campaigns.ts'));
const {participationAction}=await import(compile('lib/participation.ts'));
const key=()=>crypto.randomUUID();

async function fixture(t){
 const f=teamFixture(t),owner=await f.actor('owner-a');
 const item=async(name,stock=50,projectId='project-a')=>{const created=(await materialsAction(f.db,projectId==='project-a'?owner:await f.actor('owner-b'),'item.create',{projectId,name,category:'gift',unit:'unidade',lowStock:0,operationKey:key()})).item;await materialsAction(f.db,projectId==='project-a'?owner:await f.actor('owner-b'),'stock.move',{itemId:created.id,delta:stock,kind:'receive',note:'Entrada sintética',operationKey:key()});return created;};
 const offer=async(name,kind,components,projectId='project-a')=>(await materialsAction(f.db,projectId==='project-a'?owner:await f.actor('owner-b'),'offer.create',{projectId,name,kind,components,operationKey:key()})).offer;
 const planner=await item('Planner sintético'),blue=await item('Bóton azul sintético'),orange=await item('Bóton laranja sintético'),folder=await item('Pasta transparente sintética'),agenda=await item('Agenda sintética');
 const plannerOffer=await offer('Planner','brinde',[{itemId:planner.id,quantity:1}]);
 const buttonsOffer=await offer('Conjunto de bótons','super',[{itemId:blue.id,quantity:1},{itemId:orange.id,quantity:1}]);
 const folderOffer=await offer('Pasta transparente','super',[{itemId:folder.id,quantity:1}]);
 const agendaOffer=await offer('Agenda','super',[{itemId:agenda.id,quantity:1}]);
 const now=Date.now();
 const campaignId=(await campaignAction(f.db,owner,'campaign.create',{projectId:'project-a',name:'Dinâmica sintética',startsAt:new Date(now-3600e3).toISOString(),endsAt:new Date(now+86400e3).toISOString(),retryLimit:1,rulesText:'Regras sintéticas',brindeOfferId:plannerOffer.id,superOfferId:buttonsOffer.id})).id;
 const read=async(who='owner-a')=>prizeTiersWorkspace(f.db,await f.actor(who),{campaignId});
 const act=async(input,who='owner-a')=>prizeTiersAction(f.db,await f.actor(who),{campaignId,operationKey:key(),...input});
 return{...f,owner,campaignId,planner,blue,orange,folder,agenda,plannerOffer,buttonsOffer,folderOffer,agendaOffer,item,offer,read,act};
}
const ledger=f=>({
 items:f.native.prepare('SELECT id,stock,reserved,version FROM items ORDER BY id').all(),
 movements:f.native.prepare('SELECT * FROM stock_movements ORDER BY id').all(),
 reservations:f.native.prepare('SELECT * FROM reservations ORDER BY id').all(),
 entitlements:f.native.prepare('SELECT * FROM entitlements ORDER BY id').all(),
 offers:f.native.prepare('SELECT * FROM offers ORDER BY id').all(),
 components:f.native.prepare('SELECT * FROM offer_components ORDER BY offer_id,item_id').all(),
 campaigns:f.native.prepare('SELECT * FROM campaigns ORDER BY id').all(),
});

test('odds premise: one repetition gives Brinde 7/12 and Super 7/36; Super Super is the stated share of Super',()=>{
 const odds=tierOdds(DEFAULT_SUPER_SUPER_PERCENT,1);
 assert.equal(DEFAULT_SUPER_SUPER_PERCENT,25);
 assert.ok(Math.abs(odds.brinde-7/12)<1e-12);assert.ok(Math.abs(odds.super+odds.superSuper-7/36)<1e-12);assert.ok(Math.abs(odds.superSuper-7/36/4)<1e-12);
 assert.ok(Math.abs(odds.brinde+odds.super+odds.superSuper+odds.nothing-1)<1e-12);
 const none=tierOdds(0,0);assert.equal(none.superSuper,0);assert.ok(Math.abs(none.super-1/6)<1e-12);assert.equal(tierOdds(25,null).retryLimit,1);
});

test('levels start unsaved with the explicit 25% premise; moving an option records who, when, before and after',async t=>{
 const f=await fixture(t);const initial=await f.read();
 assert.equal(initial.version,0);assert.equal(initial.superSuperPercent,25);assert.equal(initial.percentIsDefault,true);assert.equal(initial.canManage,true);
 assert.ok(initial.options.every(option=>option.tier===null));assert.deepEqual(initial.history,[]);
 assert.deepEqual(initial.options.find(option=>option.offerId===f.buttonsOffer.id).components.map(c=>c.quantity),[1,1]);
 const first=await f.act({action:'tier.set',expectedVersion:0,offerId:f.folderOffer.id,tier:'super'});assert.equal(first.version,1);assert.equal(first.duplicate,false);
 await f.act({action:'tier.set',expectedVersion:1,offerId:f.agendaOffer.id,tier:'super_super'});
 // Yan's case: the folder moves from Super to Super Super, like the agenda.
 const moved=await f.act({action:'tier.set',expectedVersion:2,offerId:f.folderOffer.id,tier:'super_super'});assert.equal(moved.version,3);
 const view=await f.read();assert.equal(view.version,3);
 assert.equal(view.options.find(o=>o.offerId===f.folderOffer.id).tier,'super_super');assert.equal(view.options.find(o=>o.offerId===f.folderOffer.id).updatedBy,'Gestão Aurora');
 assert.deepEqual(view.history.map(h=>[h.offerName,h.previousTier,h.tier,h.actorName]),[['Pasta transparente','super','super_super','Gestão Aurora'],['Agenda',null,'super_super','Gestão Aurora'],['Pasta transparente',null,'super','Gestão Aurora']]);
 assert.ok(view.history.every(h=>Number.isFinite(Date.parse(h.createdAt))));
 assert.equal(f.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='prize_tiers.tier.set'").get().n,3);
 // Removing from the dynamic is also history, and the option is listed apart.
 await f.act({action:'tier.set',expectedVersion:3,offerId:f.agendaOffer.id,tier:null});
 const after=await f.read();assert.equal(after.options.find(o=>o.offerId===f.agendaOffer.id).tier,null);assert.deepEqual([after.history[0].previousTier,after.history[0].tier],['super_super',null]);
});

test('replay, stale version, no-op and foreign offer are rejected without partial writes',async t=>{
 const f=await fixture(t);const operationKey=key();
 const input={campaignId:f.campaignId,action:'tier.set',expectedVersion:0,offerId:f.plannerOffer.id,tier:'brinde',operationKey};
 const a=await prizeTiersAction(f.db,f.owner,input),b=await prizeTiersAction(f.db,f.owner,input);
 assert.equal(a.duplicate,false);assert.equal(b.duplicate,true);assert.equal(b.version,1);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM campaign_prize_history').get().n,1);
 await assert.rejects(prizeTiersAction(f.db,f.owner,{...input,tier:'super'}),e=>e.status===409&&e.code==='operation_changed');
 await assert.rejects(f.act({action:'tier.set',expectedVersion:0,offerId:f.folderOffer.id,tier:'super'}),e=>e.status===409&&e.code==='prize_tiers_conflict');
 await assert.rejects(f.act({action:'tier.set',expectedVersion:1,offerId:f.plannerOffer.id,tier:'brinde'}),e=>e.status===409&&e.code==='prize_tiers_unchanged');
 const foreign=await f.offer('Kit reservado B','super',[{itemId:(await f.item('Material reservado B',5,'project-b')).id,quantity:1}],'project-b');
 await assert.rejects(f.act({action:'tier.set',expectedVersion:1,offerId:foreign.id,tier:'super'}),e=>e.status===409&&e.code==='prize_tier_scope');
 assert.throws(()=>f.native.prepare("INSERT INTO campaign_prize_tiers(campaign_id,offer_id,tier,updated_by,updated_at) VALUES(?,?,?,?,?)").run(f.campaignId,foreign.id,'super','owner-a',f.now),/prize_tier_scope/);
 assert.equal((await f.read()).version,1);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM campaign_prize_history').get().n,1);
 await assert.rejects(f.act({action:'tier.set',expectedVersion:1,offerId:f.folderOffer.id,tier:'mega'}),e=>e.status===400);
});

test('the premise is editable, confirming the default is recorded, and every change stays in the history',async t=>{
 const f=await fixture(t);
 // A level change alone does not confirm the premise.
 await f.act({action:'tier.set',expectedVersion:0,offerId:f.plannerOffer.id,tier:'brinde'});assert.equal((await f.read()).percentIsDefault,true);
 await f.act({action:'percent.set',expectedVersion:1,superSuperPercent:25});
 let view=await f.read();assert.equal(view.percentIsDefault,false);assert.equal(view.superSuperPercent,25);assert.deepEqual([view.history[0].kind,view.history[0].previousPercent,view.history[0].percent],['percent',null,25]);
 await f.act({action:'percent.set',expectedVersion:2,superSuperPercent:30});view=await f.read();assert.equal(view.superSuperPercent,30);assert.deepEqual([view.history[0].previousPercent,view.history[0].percent],[25,30]);
 await assert.rejects(f.act({action:'percent.set',expectedVersion:3,superSuperPercent:30}),e=>e.code==='prize_tiers_unchanged');
 await assert.rejects(f.act({action:'percent.set',expectedVersion:3,superSuperPercent:101}),e=>e.status===400);
 assert.throws(()=>f.native.prepare('UPDATE campaign_prize_history SET percent=99').run(),/prize_history_immutable/);
 assert.throws(()=>f.native.prepare('DELETE FROM campaign_prize_history').run(),/prize_history_immutable/);
 assert.throws(()=>f.native.prepare('DELETE FROM campaign_prize_settings').run(),/prize_history_immutable/);
});

test('a new option is a regular kit of the project created and placed in one step',async t=>{
 const f=await fixture(t);
 const created=await f.act({action:'option.create',expectedVersion:0,name:'Conjunto de 3 bótons',tier:'super',components:[{itemId:f.blue.id,quantity:1},{itemId:f.orange.id,quantity:1}]});
 const offer=f.native.prepare('SELECT * FROM offers WHERE id=?').get(created.entityId);assert.equal(offer.kind,'super');assert.equal(offer.project_id,'project-a');
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM offer_components WHERE offer_id=?').get(created.entityId).n,2);
 const view=await f.read();assert.equal(view.options.find(o=>o.offerId===created.entityId).tier,'super');assert.equal(view.history[0].offerName,'Conjunto de 3 bótons');
 await assert.rejects(f.act({action:'option.create',expectedVersion:1,name:'Repetido',tier:'super',components:[{itemId:f.blue.id,quantity:1},{itemId:f.blue.id,quantity:2}]}),e=>e.status===400);
 const foreign=await f.item('Material reservado B',5,'project-b');
 await assert.rejects(f.act({action:'option.create',expectedVersion:1,name:'Fora do projeto',tier:'super',components:[{itemId:foreign.id,quantity:1}]}),e=>e.status===409);
 assert.equal(f.native.prepare("SELECT COUNT(*) n FROM offers WHERE name IN ('Repetido','Fora do projeto')").get().n,0);
});

test('permission: readers see but cannot change; other organizations and anonymous get nothing; closed dynamics are read-only',async t=>{
 const f=await fixture(t);await f.act({action:'tier.set',expectedVersion:0,offerId:f.plannerOffer.id,tier:'brinde'});
 const viewer=await f.read('viewer-a');assert.equal(viewer.canManage,false);assert.deepEqual(viewer.materials,[]);assert.equal(viewer.options.find(o=>o.offerId===f.plannerOffer.id).tier,'brinde');
 await assert.rejects(f.act({action:'tier.set',expectedVersion:1,offerId:f.folderOffer.id,tier:'super'},'viewer-a'),e=>e.status===403);
 await assert.rejects(f.act({action:'percent.set',expectedVersion:1,superSuperPercent:50},'other-a2'),e=>e.status===403);
 await assert.rejects(f.read('owner-b'),e=>e.status===403);await assert.rejects(f.act({action:'tier.set',expectedVersion:1,offerId:f.folderOffer.id,tier:'super'},'owner-b'),e=>e.status===403);
 await assert.rejects(prizeTiersWorkspace(f.db,null,{campaignId:f.campaignId}),e=>e.status===401);
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM campaign_prize_history').get().n,1);
 // Revocation between the read and the commit rolls the write back.
 const batch=f.db.batch;let fired=false;f.db.batch=async statements=>{if(!fired){fired=true;f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='owner-a'").run(f.now);}return batch(statements);};
 await assert.rejects(f.act({action:'tier.set',expectedVersion:1,offerId:f.folderOffer.id,tier:'super'}),e=>e.status===403);
 f.db.batch=batch;f.native.prepare("UPDATE members SET revoked_at=NULL WHERE user_id='owner-a'").run();
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM campaign_prize_history').get().n,1);
 f.native.prepare("UPDATE campaigns SET status='closed' WHERE id=?").run(f.campaignId);
 assert.equal((await f.read()).canManage,false);
 await assert.rejects(f.act({action:'tier.set',expectedVersion:1,offerId:f.folderOffer.id,tier:'super'}),e=>e.status===409&&e.code==='prize_tiers_closed');
});

test('moving levels after a real delivery changes no stock, reservation, entitlement, offer or dynamic row',async t=>{
 const f=await fixture(t);
 f.insert('settings',{name:'privacyNotice',value:'Aviso sintético de privacidade.',updated_at:f.now});
 await campaignAction(f.db,f.owner,'campaign.status',{id:f.campaignId,status:'active'});
 const ticket=await participationAction(f.db,f.owner,'participation.ticket',{campaignId:f.campaignId,operationKey:key()});
 const outcome=await participationAction(f.db,f.owner,'participation.physical',{attemptId:ticket.attemptId,result:'super'});
 const code=outcome.entitlement.id;await participationAction(f.db,f.owner,'prize.redeem',{code,operationKey:key()});
 const pendingTicket=await participationAction(f.db,f.owner,'participation.ticket',{campaignId:f.campaignId,operationKey:key()});assert.ok(pendingTicket.attemptId);
 const before=ledger(f);assert.equal(before.entitlements.find(e=>e.id===code).state,'delivered');assert.ok(before.reservations.some(r=>r.state==='held'));
 // The delivered set moves to Super Super, the planner leaves and returns, the premise changes.
 let version=0;
 for(const input of [{action:'tier.set',offerId:f.buttonsOffer.id,tier:'super_super'},{action:'tier.set',offerId:f.plannerOffer.id,tier:'brinde'},{action:'tier.set',offerId:f.plannerOffer.id,tier:null},{action:'percent.set',superSuperPercent:40},{action:'tier.set',offerId:f.buttonsOffer.id,tier:'super'}])version=(await f.act({...input,expectedVersion:version})).version;
 assert.equal(version,5);assert.deepEqual(ledger(f),before);
 assert.equal(f.native.prepare("SELECT COUNT(*) n FROM stock_movements WHERE kind='redeem'").get().n,2);
});
