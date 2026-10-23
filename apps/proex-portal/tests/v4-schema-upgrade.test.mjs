import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
const root = new URL('../drizzle/', import.meta.url);
test('V4 upgrade is additive and preserves production ledgers, references and guards', () => {
  const native = new DatabaseSync(':memory:');
  try {
    native.exec('PRAGMA foreign_keys=ON');
    const migrations = readdirSync(root).filter(name => name.endsWith('.sql')).sort();
    for (const name of migrations.filter(name => name < '0004')) native.exec(readFileSync(new URL(name, root), 'utf8'));
    native.exec(`INSERT INTO projects(id,name,created_at) VALUES('existing-project','Existing','2026-10-23T00:00:00Z');
      INSERT INTO items(id,project_id,name,category,unit,created_at) VALUES('existing-gift','existing-project','Button','gift','unidade','2026-10-23T00:00:00Z');
      INSERT INTO stock_movements(id,item_id,delta,kind,note,actor_id,created_at) VALUES('existing-movement','existing-gift',9,'receive','Prior entry','staff','2026-10-23T00:00:00Z');
      INSERT INTO campaigns(id,project_id,name,location,starts_at,ends_at,status,rules_text,created_at) VALUES('existing-campaign','existing-project','Event','','2026-10-23T00:00:00Z','2026-10-24T00:00:00Z','draft','','2026-10-23T00:00:00Z');
      INSERT INTO participations(id,campaign_id,identity_id,identity_method,modality,state,created_at) VALUES('existing-participation','existing-campaign','person','account','wheel','completed','2026-10-23T00:00:00Z');`);
    const beforeTriggers = native.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all().map(row => row.name);
    for (const name of migrations.filter(name => name >= '0004')) {
      const sql = readFileSync(new URL(name, root), 'utf8');
      assert.doesNotMatch(sql, /DROP\s+TABLE|RENAME\s+TO|foreign_keys\s*=\s*OFF/i);
      native.exec(sql);
    }
    assert.equal(native.prepare("SELECT stock,category_id FROM items WHERE id='existing-gift'").get().stock, 9);
    assert.equal(native.prepare("SELECT lifecycle FROM projects WHERE id='existing-project'").get().lifecycle, 'active');
    assert.equal(native.prepare('SELECT COUNT(*) n FROM stock_movements').get().n, 1);
    assert.equal(native.prepare('SELECT COUNT(*) n FROM participations').get().n, 1);
    assert.deepEqual(native.prepare('PRAGMA foreign_key_check').all(), []);
    const afterTriggers = native.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all().map(row => row.name);
    for (const trigger of beforeTriggers) assert.ok(afterTriggers.includes(trigger));
    assert.throws(() => native.prepare("DELETE FROM stock_movements WHERE id='existing-movement'").run(), /immutable/);
    assert.throws(() => native.prepare("INSERT INTO participations(id,campaign_id,identity_id,identity_method,modality,state,created_at) VALUES('duplicate','existing-campaign','person','account','dice','completed','2026-10-23T00:00:00Z')").run(), /UNIQUE/);
    native.exec("INSERT INTO projects(id,name,parent_id,created_at) VALUES('child','Child','existing-project','2026-10-23T00:00:00Z')");
    assert.throws(() => native.prepare("UPDATE projects SET parent_id='child' WHERE id='existing-project'").run(), /project_parent_cycle/);
    native.exec("INSERT INTO material_categories(id,project_id,label,label_key,core_kind,created_at,updated_at) VALUES('wrong-core','existing-project','Equipment','equipment','equipment','2026-10-23T00:00:00Z','2026-10-23T00:00:00Z')");
    assert.throws(() => native.prepare("UPDATE items SET category_id='wrong-core' WHERE id='existing-gift'").run(), /material_category_mismatch/);
    for (const table of ['sync_attachment_tickets', 'sync_attachment_exports', 'sync_receipts', 'privacy_requests']) assert.ok(native.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
  } finally { native.close(); }
});
