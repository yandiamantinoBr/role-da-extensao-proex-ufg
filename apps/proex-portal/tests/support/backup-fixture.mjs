import { gzipSync } from 'node:zlib';
import { sha256 } from '../../platform-node/backup-format.mjs';
import { nativeFixture, migrations } from './traffic-fixture.mjs';
export { migrations };
export function backupFixture() {
  const f = nativeFixture(); const actor = f.owner(), now = new Date().toISOString();
  // The owner fixture must carry its actual membership when exercising the
  // participant/team boundary; an empty membership array describes a participant.
  actor.members = f.native.prepare('SELECT * FROM members WHERE user_id=?').all(actor.userId).map(row => ({ ...row }));
  f.native.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TEXT DEFAULT CURRENT_TIMESTAMP); CREATE TABLE backup_test_private(secret TEXT); INSERT INTO backup_test_private VALUES(\'synthetic-only-private-state\');');
  for (const migration of migrations) f.native.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(migration.name);
  const objects = ['document', 'record', 'avatar', 'orphan'].map(kind => ({ key: `synthetic/private/${kind}`, storageId: sha256(`synthetic/private/${kind}`), contentType: kind === 'document' ? 'application/pdf' : 'image/png', data: Buffer.from(`synthetic bytes for ${kind}`) }));
  f.native.prepare("INSERT INTO items(id,project_id,name,category,unit,stock,created_at) VALUES('backup-equipment','project-fixture','Synthetic equipment','equipment','unit',1,?)").run(now);
  f.native.prepare("INSERT INTO loans(id,project_id,item_id,action_name,borrower_name,starts_at,ends_at,status,created_by,created_at) VALUES('backup-loan','project-fixture','backup-equipment','Synthetic loan','Synthetic borrower',1,2,'cancelled','owner-fixture',?)").run(now);
  f.native.prepare("INSERT INTO documents(id,loan_id,project_id,object_key,name,mime,size,created_by,created_at,content_hash) VALUES('backup-doc','backup-loan','project-fixture',?,'synthetic.pdf','application/pdf',?,'owner-fixture',?,?)").run(objects[0].key, objects[0].data.length, now, sha256(objects[0].data));
  f.native.prepare("INSERT INTO records(id,project_id,kind,title,occurred_at,created_by,created_at) VALUES('backup-record','project-fixture','observation','Synthetic record',?,'owner-fixture',?)").run(now, now);
  f.native.prepare("INSERT INTO record_attachments(id,record_id,project_id,object_key,name,mime,size,operation_key,created_by,created_at) VALUES('backup-record-file','backup-record','project-fixture',?,'synthetic.png','image/png',?,'synthetic-backup-operation','owner-fixture',?)").run(objects[1].key, objects[1].data.length, now);
  f.native.prepare("INSERT INTO profiles(user_id,display_name,avatar_key,mime,created_at,updated_at) VALUES('owner-fixture','Synthetic owner',?,'image/png',?,?)").run(objects[2].key, now, now);
  return { ...f, actor, objects, snapshot: () => ({ version: 7, data: gzipSync(f.native.serialize()) }), capture: () => ({ backend: 'postgres', snapshot: { version: 7, data: gzipSync(f.native.serialize()) }, objects: objects.map(object => ({ ...object, data: Buffer.from(object.data) })) }) };
}
