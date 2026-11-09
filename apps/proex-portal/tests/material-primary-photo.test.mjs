import test from 'node:test';
import assert from 'node:assert/strict';
import {compile,teamFixture} from './support/work-teams-fixture.mjs';
// Real services over migrated SQLite. Photos are synthetic attachment rows; no image bytes are stored.
const {materialsAction,materialDetail}=await import(compile('lib/materials.ts'));
const key=()=>crypto.randomUUID();
let clock=Date.parse('2026-11-09T12:00:00.000Z');
const tick=()=>new Date(clock+=60000).toISOString();

async function fixture(t){
 const f=teamFixture(t),owner=await f.actor('owner-a');
 const create=async name=>(await materialsAction(f.db,owner,'item.create',{projectId:'project-a',name,category:'gift',unit:'unidade',lowStock:0,operationKey:key()})).item;
 const item=await create('Bóton azul sintético'),other=await create('Bóton roxo sintético');
 const photo=(itemId=item.id,name='foto.jpg',mime='image/jpeg')=>{const recordId=key(),id=key(),at=tick();
  f.insert('records',{id:recordId,project_id:'project-a',kind:'material',title:'Foto sintética',occurred_at:at,item_id:itemId,created_by:'owner-a',created_at:at});
  f.insert('record_attachments',{id,record_id:recordId,project_id:'project-a',object_key:`synthetic/${id}`,name,mime,size:10,operation_key:key(),created_by:'owner-a',created_at:at});return id;};
 const choose=async(attachmentId,expectedAttachmentId,who='owner-a',extra={})=>materialsAction(f.db,await f.actor(who),'item.photo.primary',{itemId:item.id,attachmentId,expectedAttachmentId,operationKey:key(),...extra});
 const detail=async(who='owner-a')=>materialDetail(f.db,await f.actor(who),item.id);
 return{...f,owner,item,other,photo,choose,detail};
}

test('before any choice the newest photo stays main; an explicit change keeps the old photo and records before/after, author and date',async t=>{
 const f=await fixture(t);const webcam=f.photo(f.item.id,'captura-webcam.jpg'),real=f.photo(f.item.id,'boton-azul.jpg');
 let view=await f.detail();assert.equal(view.primaryPhotoId,real);assert.equal(view.primaryPhotoPinned,false);assert.deepEqual(view.photoHistory,[]);
 // The team picks the earlier photo as main: the newest one is not deleted, only stops being main.
 await f.choose(webcam,real);view=await f.detail();
 assert.equal(view.primaryPhotoId,webcam);assert.equal(view.photos[0].id,webcam);assert.equal(view.primaryPhotoPinned,true);assert.deepEqual(view.photos.map(p=>p.id).sort(),[webcam,real].sort());
 assert.equal(view.photoHistory.length,1);const [change]=view.photoHistory;
 assert.equal(change.previousAttachmentId,real);assert.equal(change.attachmentId,webcam);assert.equal(change.url,`/api/records/files/${webcam}`);assert.equal(change.previousUrl,`/api/records/files/${real}`);
 assert.equal(change.actorName,'Gestão Aurora');assert.ok(Number.isFinite(Date.parse(change.createdAt)));
 // A new photo is uploaded first, then chosen: the pointer moves, earlier photos stay.
 const fresh=f.photo(f.item.id,'nova.jpg');view=await f.detail();assert.equal(view.primaryPhotoId,webcam,'an upload alone never replaces an explicit choice');
 await f.choose(fresh,webcam);view=await f.detail();assert.equal(view.primaryPhotoId,fresh);assert.equal(view.photos.length,3);
 assert.deepEqual(view.photoHistory.map(h=>[h.previousAttachmentId,h.attachmentId]),[[webcam,fresh],[real,webcam]]);
 assert.equal(f.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='item.photo.primary'").get().n,2);
});

test('first choice right after an upload accepts the photo that was main before the upload; "only add" can pin the current photo',async t=>{
 const f=await fixture(t);const old=f.photo();const shown=(await f.detail()).primaryPhotoId;assert.equal(shown,old);
 const uploaded=f.photo();assert.equal((await f.detail()).primaryPhotoId,uploaded,'legacy order: newest first while nothing is pinned');
 await f.choose(uploaded,shown);let view=await f.detail();assert.equal(view.photoHistory[0].previousAttachmentId,old);
 const g=await fixture(t);const kept=g.photo();await g.choose(kept,kept);view=await g.detail();assert.equal(view.primaryPhotoPinned,true);assert.equal(view.photoHistory[0].previousAttachmentId,null);
 g.photo();view=await g.detail();assert.equal(view.primaryPhotoId,kept,'after pinning, adding to the gallery leaves the main photo alone');
});

test('stale, repeated, foreign and non-image choices are refused; a lost reply is replayed once',async t=>{
 const f=await fixture(t);const a=f.photo(),b=f.photo(),foreign=f.photo(f.other.id),pdf=f.photo(f.item.id,'nota.pdf','application/pdf');
 const operationKey=key(),first=await f.choose(a,b,'owner-a',{operationKey}),again=await f.choose(a,b,'owner-a',{operationKey});
 assert.equal(again.duplicate,true);assert.equal(again.primaryPhoto.id,first.primaryPhoto.id);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM item_primary_photos').get().n,1);
 await assert.rejects(f.choose(a,b),e=>e.status===409&&e.code==='primary_photo_unchanged');
 await assert.rejects(f.choose(b,b),e=>e.status===409&&e.code==='primary_photo_changed');
 await assert.rejects(f.choose(foreign,a),e=>e.status===409&&e.code==='primary_photo_invalid');
 await assert.rejects(f.choose(pdf,a),e=>e.status===409&&e.code==='primary_photo_invalid');
 await assert.rejects(f.choose(b,a,'owner-a',{extra:'x'}),e=>e.status===400);
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM item_primary_photos').get().n,1);
 // The database refuses a pointer whose "previous" is not the current main photo.
 assert.throws(()=>f.insert('item_primary_photos',{id:key(),item_id:f.item.id,project_id:'project-a',attachment_id:b,previous_attachment_id:b===a?null:foreign,actor_id:'owner-a',created_at:f.now}),/primary_photo_changed/);
});

test('permission: only stock managers of the project change it; whoever reads the material sees the history; others see nothing',async t=>{
 const f=await fixture(t);const a=f.photo(),b=f.photo();
 await assert.rejects(f.choose(a,b,'viewer-a'),e=>e.status===403);
 await assert.rejects(f.choose(a,b,'other-a2'),e=>e.status===403);
 await assert.rejects(f.choose(a,b,'owner-b'),e=>e.status===403);
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM item_primary_photos').get().n,0);
 // Revocation between the checks and the commit rolls everything back.
 const batch=f.db.batch;let fired=false;f.db.batch=async statements=>{if(!fired){fired=true;f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='owner-a'").run(f.now);}return batch(statements);};
 await assert.rejects(f.choose(a,b),e=>e.status===403);f.db.batch=batch;f.native.prepare("UPDATE members SET revoked_at=NULL WHERE user_id='owner-a'").run();
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM item_primary_photos').get().n,0);assert.equal(f.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='item.photo.primary'").get().n,0);
 await f.choose(a,b);
 f.native.prepare("UPDATE members SET role='inventory' WHERE user_id='viewer-a'").run();const reader=await f.detail('viewer-a');assert.equal(reader.photoHistory.length,1);assert.equal(reader.primaryPhotoId,a);
 f.native.prepare("UPDATE members SET role='viewer' WHERE user_id='viewer-a'").run();await assert.rejects(f.detail('viewer-a'),e=>e.status===403);await assert.rejects(f.detail('owner-b'),e=>e.status===403);
});

test('history and photos are kept: pointers cannot be edited or deleted; the current main photo cannot be hidden and no photo is hidden without a log',async t=>{
 const f=await fixture(t);const a=f.photo(),b=f.photo(),loose=f.photo();await f.choose(a,loose);
 assert.throws(()=>f.native.prepare('UPDATE item_primary_photos SET attachment_id=?').run(b),/primary_photo_immutable/);
 assert.throws(()=>f.native.prepare('DELETE FROM item_primary_photos').run(),/primary_photo_immutable/);
 const log=id=>f.native.prepare("INSERT INTO record_attachment_deletions(attachment_id,project_id,item_id,reason,actor_id,created_at) VALUES(?,?,?,?,?,?)").run(id,'project-a',f.item.id,'Foto sintética errada','owner-a',f.now);
 for(const id of [a,loose]){
  assert.throws(()=>f.native.prepare('UPDATE record_attachments SET deleted_at=? WHERE id=?').run(f.now,id),/attachment_deletion_required|primary_photo_immutable/);
  assert.throws(()=>f.native.prepare('DELETE FROM record_attachments WHERE id=?').run(id),/primary_photo_immutable/);
 }
 // 0038: the current main photo stays protected even with a log; an earlier main photo may be hidden with one.
 log(a);assert.throws(()=>f.native.prepare('UPDATE record_attachments SET deleted_at=? WHERE id=?').run(f.now,a),/primary_photo_immutable/);
 log(loose);f.native.prepare('UPDATE record_attachments SET deleted_at=? WHERE id=?').run(f.now,loose);
 assert.throws(()=>f.native.prepare('UPDATE record_attachments SET deleted_at=NULL WHERE id=?').run(loose),/attachment_deletion_required/);
 f.native.prepare('UPDATE record_attachments SET caption=? WHERE id=?').run('Legenda sintética',a);
 log(b);f.native.prepare('UPDATE record_attachments SET deleted_at=? WHERE id=?').run(f.now,b);
 assert.deepEqual(f.native.prepare('PRAGMA foreign_key_check').all(),[]);
});
