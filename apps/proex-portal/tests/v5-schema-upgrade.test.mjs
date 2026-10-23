import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
const migrationsRoot=new URL('../drizzle/',import.meta.url);

test('V5 upgrade adds organizational metadata in place while preserving inventory, participation, private profiles and project guards',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('PRAGMA foreign_keys=ON');
  const migrations=readdirSync(migrationsRoot).filter(name=>name.endsWith('.sql')).sort();
  for(const migration of migrations.filter(name=>name<'0005'))db.exec(readFileSync(new URL(migration,migrationsRoot),'utf8'));
  db.exec(`INSERT INTO projects(id,name,lifecycle,created_at) VALUES('project-a','Legacy project','catalog','2026-10-23T00:00:00.000Z');
   INSERT INTO items(id,project_id,name,category,unit,created_at) VALUES('gift-a','project-a','Legacy button','gift','unidade','2026-10-23T00:00:00.000Z');
   INSERT INTO stock_movements(id,item_id,delta,kind,note,actor_id,created_at) VALUES('movement-a','gift-a',12,'receive','Legacy inventory','staff-a','2026-10-23T00:00:00.000Z');
   INSERT INTO campaigns(id,project_id,name,location,starts_at,ends_at,status,rules_text,created_at) VALUES('campaign-a','project-a','Legacy event','','2026-10-23T00:00:00.000Z','2026-10-24T00:00:00.000Z','draft','','2026-10-23T00:00:00.000Z');
   INSERT INTO participations(id,campaign_id,identity_id,identity_method,modality,state,created_at) VALUES('participation-a','campaign-a','person-a','account','wheel','completed','2026-10-23T00:00:00.000Z');
   INSERT INTO profiles(user_id,display_name,avatar_key,mime,unit,job_title,phone,version,created_at,updated_at) VALUES('staff-a','Legacy display name','private-avatar-key','image/png','Free-form legacy unit','Legacy job title','Private phone',7,'2026-10-23T00:00:00.000Z','2026-10-23T00:00:00.000Z');`);
  const beforeTriggers=db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all().map(row=>row.name);
  for(const migration of migrations.filter(name=>name>='0005')){
   const sql=readFileSync(new URL(migration,migrationsRoot),'utf8');
   assert.doesNotMatch(sql,/DROP\s+TABLE|RENAME\s+TO|foreign_keys\s*=\s*OFF|INSERT\s+INTO|UPDATE\s+(projects|profiles)/i);
   db.exec(sql);
  }
  assert.deepEqual({...db.prepare("SELECT name,lifecycle,unit_id,prizes_enabled FROM projects WHERE id='project-a'").get()},{name:'Legacy project',lifecycle:'catalog',unit_id:null,prizes_enabled:0});
  assert.deepEqual({...db.prepare("SELECT display_name,unit,job_title,phone,avatar_key,version,unit_id,affiliation,registration_type,registration_number FROM profiles WHERE user_id='staff-a'").get()},{display_name:'Legacy display name',unit:'Free-form legacy unit',job_title:'Legacy job title',phone:'Private phone',avatar_key:'private-avatar-key',version:7,unit_id:null,affiliation:'',registration_type:'',registration_number:''});
  assert.equal(db.prepare("SELECT stock FROM items WHERE id='gift-a'").get().stock,12);assert.equal(db.prepare('SELECT COUNT(*) n FROM participations').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM organizational_units').get().n,0);
  const afterTriggers=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all().map(row=>row.name));for(const trigger of beforeTriggers)assert.ok(afterTriggers.has(trigger));
  assert.throws(()=>db.prepare("DELETE FROM stock_movements WHERE id='movement-a'").run(),/immutable/);
  assert.throws(()=>db.prepare("UPDATE projects SET parent_id='project-a' WHERE id='project-a'").run(),/project_parent_cycle/);
  assert.throws(()=>db.prepare("UPDATE projects SET prizes_enabled=2 WHERE id='project-a'").run(),/CHECK/);
  assert.throws(()=>db.prepare("UPDATE profiles SET affiliation='owner' WHERE user_id='staff-a'").run(),/CHECK/);
  assert.throws(()=>db.prepare("UPDATE profiles SET registration_type='cpf' WHERE user_id='staff-a'").run(),/CHECK/);
  assert.throws(()=>db.prepare("UPDATE projects SET unit_id='missing-unit' WHERE id='project-a'").run(),/FOREIGN KEY/);
  db.exec("INSERT INTO organizational_units(id,name,acronym,kind,created_at,updated_at) VALUES('unit-a','Faculdade','FAC','academic','2026-10-23T00:00:00.000Z','2026-10-23T00:00:00.000Z')");
  db.exec("UPDATE projects SET unit_id='unit-a',prizes_enabled=1 WHERE id='project-a'; UPDATE profiles SET unit_id='unit-a',affiliation='technical',registration_type='siape',registration_number='1234567' WHERE user_id='staff-a'");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM members").get().n,0,'organizational metadata never grants access');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.close();}
});
