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
      // SQLite cannot widen a CHECK in place. This reviewed metadata-only
      // rebuild has populated preservation and rollback tests below; no domain
      // table or other destructive statement is allowed through this exception.
      const reviewedMetadataRebuilds = {
        '0025_groq_organization_credentials.sql': ['ai_provider_credential_metadata', 'ai_provider_credential_metadata_groq'],
        '0027_openai_organization_credentials.sql': ['ai_provider_credential_metadata', 'ai_provider_credential_metadata_openai'],
        // 0036 widens the feedback kind CHECK and adds nullable columns; preservation/rollback test below.
        '0036_community.sql': ['portal_feedback', 'portal_feedback_v36'],
      };
      const reviewed = reviewedMetadataRebuilds[name];
      const guardedSql = reviewed
        ? sql.replace(`DROP TABLE ${reviewed[0]};`,'').replace(`ALTER TABLE ${reviewed[1]} RENAME TO ${reviewed[0]};`,'')
        : sql;
      assert.doesNotMatch(guardedSql, /DROP\s+TABLE|RENAME\s+TO|foreign_keys\s*=\s*OFF/i);
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

for(const [file,provider,temporary,existing] of [
 ['0025_groq_organization_credentials.sql','groq','ai_provider_credential_metadata_groq',['deepseek','typesafe','deepgram']],
 ['0027_openai_organization_credentials.sql','openai','ai_provider_credential_metadata_openai',['deepseek','typesafe','deepgram','groq']],
])test(`reviewed ${provider} metadata rebuild preserves populated rows, keys and foreign keys and rolls back a failed rename`,()=>{
 const migration=readFileSync(new URL(file,root),'utf8');
 for(const failAtRename of [false,true]){
  const db=new DatabaseSync(':memory:');try{
   db.exec('PRAGMA foreign_keys=ON');
   for(const name of readdirSync(root).filter(name=>name.endsWith('.sql')&&name<file).sort())db.exec(readFileSync(new URL(name,root),'utf8'));
   const at='2026-11-05T12:00:00.000Z',put=db.prepare('INSERT INTO ai_provider_credential_metadata(organization_id,provider,label,mask,state,created_at,created_by,updated_at,updated_by)VALUES(?,?,?,?,?,?,?,?,?)');
   for(const [index,previous]of existing.entries())put.run('org_proex',previous,'Synthetic '+previous,'…test',['active','disabled','removed'][index%3],at,'synthetic-owner',at,'synthetic-editor');
   const before=db.prepare('SELECT * FROM ai_provider_credential_metadata ORDER BY provider').all(),columns=db.prepare('PRAGMA table_info(ai_provider_credential_metadata)').all(),fks=db.prepare('PRAGMA foreign_key_list(ai_provider_credential_metadata)').all();
   db.exec('BEGIN');
   if(failAtRename){
    const interrupted=migration.replace(`ALTER TABLE ${temporary} RENAME`,`SELECT json_extract('[]','synthetic_failure'); ALTER TABLE ${temporary} RENAME`);
    assert.throws(()=>db.exec(interrupted));db.exec('ROLLBACK');
    assert.equal(db.prepare('SELECT name FROM sqlite_master WHERE name=?').get(temporary),undefined);
    assert.throws(()=>put.run('org_proex',provider,'Synthetic','…test','active',at,'synthetic-owner',at,'synthetic-editor'),/CHECK/);
   }else{db.exec(migration);db.exec('COMMIT');}
   assert.deepEqual(db.prepare('SELECT * FROM ai_provider_credential_metadata ORDER BY provider').all(),before);
   assert.deepEqual(db.prepare('PRAGMA table_info(ai_provider_credential_metadata)').all(),columns);
   assert.deepEqual(db.prepare('PRAGMA foreign_key_list(ai_provider_credential_metadata)').all(),fks);
   assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
   if(!failAtRename){
    put.run('org_proex',provider,'Synthetic','…test','active',at,'synthetic-owner',at,'synthetic-editor');
    assert.throws(()=>put.run('org_proex',provider,'Duplicate','…test','active',at,'synthetic-owner',at,'synthetic-editor'),/UNIQUE/);
    assert.throws(()=>put.run('foreign-org',provider,'Foreign','…test','active',at,'synthetic-owner',at,'synthetic-editor'),/FOREIGN KEY/);
   }
  }finally{db.close();}
 }
});

test('reviewed 0036 feedback rebuild preserves populated rows and indexes, widens kinds and rolls back a failed rename',()=>{
 const file='0036_community.sql',migration=readFileSync(new URL(file,root),'utf8');
 for(const failAtRename of [false,true]){
  const db=new DatabaseSync(':memory:');try{
   db.exec('PRAGMA foreign_keys=ON');
   for(const name of readdirSync(root).filter(name=>name.endsWith('.sql')&&name<file).sort())db.exec(readFileSync(new URL(name,root),'utf8'));
   const at='2026-11-09T12:00:00.000Z';
   db.exec(`INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES('synthetic-org','Org','synthetic-org','${at}','${at}');INSERT INTO projects(id,name,organization_id,created_at) VALUES('synthetic-project','Projeto','synthetic-org','${at}')`);
   const put=db.prepare('INSERT INTO portal_feedback(id,author_id,project_id,kind,module,body,release,status,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
   put.run('f-1','synthetic-a',null,'problem','projects','Problema sintético para a migração.','2026.11.09','new',1,at,at);
   put.run('f-2','synthetic-b','synthetic-project','suggestion','materials','Sugestão sintética para a migração.','2026.11.08','resolved',3,at,at);
   const before=db.prepare('SELECT id,author_id,project_id,kind,module,body,release,status,version,created_at,updated_at FROM portal_feedback ORDER BY id').all();
   db.exec('BEGIN');
   if(failAtRename){
    const interrupted=migration.replace('ALTER TABLE portal_feedback_v36 RENAME',"SELECT json_extract('[]','synthetic_failure'); ALTER TABLE portal_feedback_v36 RENAME");
    assert.throws(()=>db.exec(interrupted));db.exec('ROLLBACK');
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='portal_feedback_v36'").get(),undefined);
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='ombuds_reports'").get(),undefined,'the whole migration rolls back');
    assert.throws(()=>put.run('f-3','synthetic-c',null,'praise','projects','Elogio antes da migração.','x','new',1,at,at),/CHECK/);
   }else{db.exec(migration);db.exec('COMMIT');}
   assert.deepEqual(db.prepare('SELECT id,author_id,project_id,kind,module,body,release,status,version,created_at,updated_at FROM portal_feedback ORDER BY id').all(),before);
   assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
   if(!failAtRename){
    assert.deepEqual(db.prepare("SELECT count(*) n FROM portal_feedback WHERE campaign_id IS NOT NULL OR response IS NOT NULL").get().n,0);
    assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='portal_feedback' AND name LIKE 'portal_feedback_%' ORDER BY name").all().map(row=>row.name),['portal_feedback_author_idx','portal_feedback_campaign_idx','portal_feedback_project_idx']);
    put.run('f-3','synthetic-c',null,'praise','projects','Elogio depois da migração.','x','new',1,at,at);
    assert.throws(()=>put.run('f-4','synthetic-c','missing-project','problem','projects','Projeto inexistente na migração.','x','new',1,at,at),/FOREIGN KEY/);
    assert.throws(()=>db.prepare("UPDATE portal_feedback SET response='Só a resposta, sem autor' WHERE id='f-1'").run(),/CHECK/);
   }
  }finally{db.close();}
 }
});
