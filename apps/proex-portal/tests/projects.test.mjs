import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import path from 'node:path';

const directory = fileURLToPath(new URL('../', import.meta.url));
const modules = new Map();
function compile(name) {
  if (modules.has(name)) return modules.get(name);
  let code = ts.transpileModule(readFileSync(`${directory}lib/${name}.ts`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  code = code.replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g, (_match, _quote, dependency) => `from ${JSON.stringify(compile(path.posix.normalize(path.posix.join(path.posix.dirname(name),dependency)).replace(/\.ts$/, '')))}`);
  const url = `data:text/javascript;base64,${Buffer.from(`${code}\n//# sourceURL=${name}-under-test.mjs`).toString('base64')}`;
  modules.set(name, url);
  return url;
}
const { campaignAction } = await import(compile('campaigns'));
const { projectAction, projectDetail } = await import(compile('projects'));
function actor(db, role, projectId) {
  const member = { id: crypto.randomUUID(), user_id: crypto.randomUUID(), email: `${role}@example.invalid`, role, project_id: projectId, revoked_at: null, created_at: new Date().toISOString() };
  db.native.prepare('INSERT INTO members(id,user_id,email,role,project_id,revoked_at,created_at) VALUES(?,?,?,?,?,?,?)').run(...Object.values(member));
  return { userId: member.user_id, email: member.email, displayName: role, members: [member], capabilities: ['projects.manage', 'campaigns.manage'] };
}
function database() {
  const native = new DatabaseSync(':memory:');
  native.exec('PRAGMA foreign_keys=ON');
  for (const migration of readdirSync(`${directory}drizzle`).filter(name => name.endsWith('.sql')).sort()) native.exec(readFileSync(`${directory}drizzle/${migration}`, 'utf8'));
  for (const id of ['project-a', 'project-b']) native.prepare('INSERT INTO projects(id,name,created_at) VALUES(?,?,?)').run(id, id, new Date().toISOString());
  const prepare = sql => {
    let values = [];
    return {
      bind(...args) { values = args; return this; },
      async first(column) { const row = native.prepare(sql).get(...values); return column ? row?.[column] ?? null : row ?? null; },
      async all() { return { success: true, results: native.prepare(sql).all(...values) }; },
      async run() { const result = native.prepare(sql).run(...values); return { success: true, results: [], meta: { changes: Number(result.changes) } }; },
      execute() { return { success: true, results: native.prepare(sql).all(...values), meta: { changes: Number(native.prepare('SELECT changes() AS n').get().n) } }; },
    };
  };
  return {
    native, prepare,
    async batch(statements) {
      native.exec('BEGIN');
      try { const result = statements.map(value => value.execute()); native.exec('COMMIT'); return result; }
      catch (error) { native.exec('ROLLBACK'); throw error; }
    },
  };
}
const createInput = () => ({ name: 'A'.repeat(120), shortName: 'PROEX', description: 'An institutional project', status: 'active', color: '#54216c', officialUrl: 'https://example.invalid/project', startsAt: '2026-10-20T10:00:00-03:00', endsAt: '2027-10-20T10:00:00-03:00', location: 'Campus', operationKey: crypto.randomUUID() });

test('global owner creates complete project metadata without truncating a 120-character name', async () => {
  const db = database();
  try {
    const owner = actor(db, 'owner', null);
    const result = await campaignAction(db, owner, 'project.create', createInput());
    assert.equal(result.project.name.length, 120);
    assert.equal(result.project.short_name, 'PROEX');
    assert.equal(result.project.color, '#54216C');
    assert.equal(result.project.starts_at, '2026-10-20T13:00:00.000Z');
    assert.equal(result.project.official_url, 'https://example.invalid/project');
    assert.equal(result.project.version, 1);
    assert.equal(db.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='project.create'").get().n, 1);
  } finally { db.native.close(); }
});

test('project organizational unit and optional dynamics are versioned without granting other projects', async () => {
  const db=database();
  try {
    const owner=actor(db,'owner',null),manager=actor(db,'manager','project-a'),now=new Date().toISOString();
    db.native.prepare("INSERT INTO organizational_units(id,name,acronym,kind,created_at,updated_at) VALUES('unit-a','Academic unit','UNI','academic',?,?)").run(now,now);
    db.native.prepare("INSERT INTO organizational_units(id,name,kind,status,created_at,updated_at) VALUES('unit-old','Archived unit','agency','archived',?,?)").run(now,now);
    const legacy={...db.native.prepare("SELECT * FROM projects WHERE id='project-a'").get()};delete legacy.unit_id;delete legacy.prizes_enabled;
    db.native.prepare("INSERT INTO entity_versions(id,entity_type,entity_id,project_id,version,snapshot_json,actor_id,created_at) VALUES('legacy-project-a','project','project-a','project-a',1,?,?,?)").run(JSON.stringify(legacy),manager.userId,now);
    const first=await projectAction(db,manager,'project.update',{id:'project-a',expectedVersion:1,unitId:'unit-a',prizesEnabled:true,operationKey:crypto.randomUUID()});
    assert.equal(first.project.unit_id,'unit-a');assert.equal(first.project.prizes_enabled,1);assert.equal(first.project.version,2);
    assert.equal(JSON.parse(db.native.prepare("SELECT snapshot_json FROM entity_versions WHERE entity_type='project' AND entity_id='project-a' AND version=2").get().snapshot_json).prizes_enabled,1);
    await assert.rejects(projectDetail(db,manager,'project-b'),error=>error.status===404);
    await assert.rejects(projectAction(db,manager,'project.update',{id:'project-a',expectedVersion:1,unitId:null,prizesEnabled:false}),error=>error.status===409);
    for(const invalid of [{unitId:'missing-unit'},{unitId:'unit-old'},{prizesEnabled:'true'}])await assert.rejects(projectAction(db,owner,'project.create',{...createInput(),...invalid}),error=>error.status===400);
    db.native.prepare("UPDATE organizational_units SET status='archived' WHERE id='unit-a'").run();
    const preserved=await projectAction(db,manager,'project.update',{id:'project-a',expectedVersion:2,name:'Updated purpose'});
    assert.equal(preserved.project.unit_id,'unit-a');assert.equal(preserved.project.prizes_enabled,1);
    const restored=await projectAction(db,manager,'entity.restore',{entityType:'project',entityId:'project-a',restoreVersion:1,expectedVersion:3,operationKey:crypto.randomUUID()});
    assert.equal(restored.project.unit_id,'unit-a');assert.equal(restored.project.prizes_enabled,1);assert.equal(restored.project.version,4);
    assert.equal(db.native.prepare('SELECT COUNT(*) n FROM members WHERE user_id=?').get(manager.userId).n,1);
  } finally {db.native.close();}
});

test('project material spreadsheet view is returned only to a current global owner', async () => {
  const db=database();
  try {
    const owner=actor(db,'owner',null),manager=actor(db,'manager','project-a'),now=new Date().toISOString();
    db.native.prepare('INSERT INTO settings(name,value,updated_at) VALUES(?,?,?)').run('sync.google_sheets.configuration',JSON.stringify({spreadsheetId:'synthetic-workbook-projects'}),now);
    db.native.prepare('INSERT INTO settings(name,value,updated_at) VALUES(?,?,?)').run('sync.google_sheets.material_links',JSON.stringify({spreadsheetId:'synthetic-workbook-projects',sheetId:12,views:{'project-a':34},version:1}),now);
    assert.equal((await projectDetail(db,owner,'project-a')).spreadsheetLinks.materialsUrl,'https://docs.google.com/spreadsheets/d/synthetic-workbook-projects/edit#gid=12&fvid=34');
    assert.equal((await projectDetail(db,manager,'project-a')).spreadsheetLinks.materialsUrl,null);
    assert.equal((await projectDetail(db,owner,'project-b')).spreadsheetLinks.materialsUrl,null);
    db.native.prepare('UPDATE members SET revoked_at=? WHERE id=?').run(now,owner.members[0].id);
    assert.equal((await projectDetail(db,owner,'project-a')).spreadsheetLinks.materialsUrl,null);
  } finally {db.native.close();}
});

test('project managers edit their scope while creation remains global and forged capability arrays grant nothing', async () => {
  const db = database();
  try {
    const manager = actor(db, 'manager', 'project-a');
    await assert.rejects(campaignAction(db, manager, 'project.create', createInput()), error => error.status === 403);
    await assert.rejects(campaignAction(db, manager, 'project.update', { id: 'project-b', expectedVersion: 1, name: 'Unauthorized' }), error => error.status === 403);
    const updated = await campaignAction(db, manager, 'project.update', { id: 'project-a', expectedVersion: 1, name: 'Revised project', shortName: 'REV', status: 'archived' });
    assert.equal(updated.project.name, 'Revised project');
    assert.equal(updated.project.status, 'archived');
    assert.equal(updated.project.version, 2);
    const operator = actor(db, 'operator', 'project-a');
    await assert.rejects(campaignAction(db, operator, 'project.update', { id: 'project-a', expectedVersion: 2, name: 'Forged privilege' }), error => error.status === 403);
  } finally { db.native.close(); }
});

test('invalid project names, URLs, colors and intervals are rejected without silent changes', async () => {
  const db = database();
  try {
    const owner = actor(db, 'owner', null), good = createInput();
    for (const invalid of [
      { name: 'A'.repeat(121) }, { shortName: 'X'.repeat(41) }, { color: '#xyzxyz' },
      { officialUrl: 'javascript:alert(1)' }, { officialUrl: 'https://user:password@example.invalid/' },
      { startsAt: '2026-02-30T10:00:00Z' }, { startsAt: '2026-10-20T10:00' },
      { startsAt: '2028-01-01T00:00:00Z', endsAt: '2027-01-01T00:00:00Z' },
    ]) await assert.rejects(campaignAction(db, owner, 'project.create', { ...good, ...invalid }), error => error.status === 400);
    assert.equal(db.native.prepare('SELECT COUNT(*) n FROM projects').get().n, 2);
    assert.equal(db.native.prepare('SELECT COUNT(*) n FROM audit').get().n, 0);
  } finally { db.native.close(); }
});

test('project edits use optimistic concurrency and recheck a revoked membership inside SQL', async () => {
  const db = database();
  try {
    const manager = actor(db, 'manager', 'project-a');
    const results = await Promise.allSettled([
      campaignAction(db, manager, 'project.update', { id: 'project-a', expectedVersion: 1, name: 'First revision' }),
      campaignAction(db, manager, 'project.update', { id: 'project-a', expectedVersion: 1, name: 'Other revision' }),
    ]);
    assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
    assert.equal(db.native.prepare("SELECT version FROM projects WHERE id='project-a'").get().version, 2);
    db.native.prepare('UPDATE members SET revoked_at=? WHERE id=?').run(new Date().toISOString(), manager.members[0].id);
    await assert.rejects(campaignAction(db, manager, 'project.update', { id: 'project-a', expectedVersion: 2, name: 'Revoked revision' }), error => error.status === 409);
    assert.equal(db.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='project.update'").get().n, 1);
  } finally { db.native.close(); }
});

test('failed project audit rolls back the complete metadata update', async () => {
  const db = database();
  try {
    const manager = actor(db, 'manager', 'project-a');
    db.native.exec("CREATE TRIGGER test_audit_failure BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT,'test_audit_failure'); END");
    await assert.rejects(campaignAction(db, manager, 'project.update', { id: 'project-a', expectedVersion: 1, name: 'Must roll back' }));
    const project = db.native.prepare("SELECT name,version FROM projects WHERE id='project-a'").get();
    assert.equal(project.name, 'project-a');
    assert.equal(project.version, 1);
  } finally { db.native.close(); }
});

test('project creation retries and concurrent requests share one claim, entity and audit', async () => {
  const db = database();
  try {
    const owner = actor(db, 'owner', null), input = createInput();
    const [first, replay] = await Promise.all([campaignAction(db, owner, 'project.create', input), campaignAction(db, owner, 'project.create', input)]);
    assert.equal(first.id, replay.id);
    assert.equal((await campaignAction(db, owner, 'project.create', input)).id, first.id);
    await assert.rejects(campaignAction(db, owner, 'project.create', { ...input, name: 'Changed request' }), error => error.code === 'operation_changed');
    assert.equal(db.native.prepare('SELECT COUNT(*) n FROM projects').get().n, 3);
    assert.equal(db.native.prepare('SELECT COUNT(*) n FROM mutation_keys').get().n, 1);
    assert.equal(db.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='project.create'").get().n, 1);
  } finally { db.native.close(); }
});

test('a revoked owner cannot leave an orphan creation claim or create a project', async () => {
  const db = database();
  try {
    const owner = actor(db, 'owner', null);
    db.native.prepare('UPDATE members SET revoked_at=? WHERE id=?').run(new Date().toISOString(), owner.members[0].id);
    await assert.rejects(campaignAction(db, owner, 'project.create', createInput()));
    assert.equal(db.native.prepare('SELECT COUNT(*) n FROM projects').get().n, 2);
    assert.equal(db.native.prepare('SELECT COUNT(*) n FROM mutation_keys').get().n, 0);
    assert.equal(db.native.prepare('SELECT COUNT(*) n FROM audit').get().n, 0);
  } finally { db.native.close(); }
});

test('draft campaign editing rejects missing and stale client versions without overwriting another revision', async () => {
  const db = database();
  try {
    const manager = actor(db, 'manager', 'project-a');
    const request = { projectId: 'project-a', name: 'Draft event', location: 'Campus', rulesText: 'Draft rules', startsAt: '2030-01-10T10:00:00Z', endsAt: '2030-01-10T18:00:00Z', retryLimit: 0, brindeOfferId: null, superOfferId: null };
    const created = await campaignAction(db, manager, 'campaign.create', request);
    await assert.rejects(campaignAction(db, manager, 'campaign.update', { ...request, id: created.id, name: 'Missing version' }), error => error.status === 400);
    await campaignAction(db, manager, 'campaign.update', { ...request, id: created.id, expectedVersion: 1, name: 'First revision' });
    await assert.rejects(campaignAction(db, manager, 'campaign.update', { ...request, id: created.id, expectedVersion: 1, name: 'Stale revision' }), error => error.status === 409 && error.code === 'campaign_changed');
    const row = db.native.prepare('SELECT name,version FROM campaigns WHERE id=?').get(created.id);
    assert.equal(row.name, 'First revision'); assert.equal(row.version, 2);
    assert.equal(db.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='campaign.update'").get().n, 1);
  } finally { db.native.close(); }
});

test('project types, lifecycle and hierarchy preserve scoped editing and reject cycles', async () => {
  const db=database();try{
    const owner=actor(db,'owner',null),manager=actor(db,'manager','project-a');
    const type=await projectAction(db,owner,'project.type.create',{key:'program',label:'Programa',description:'Institutional grouping',status:'active',operationKey:crypto.randomUUID()});
    await projectAction(db,owner,'project.update',{id:'project-a',expectedVersion:1,name:'Child project',typeId:type.id,parentId:'project-b',lifecycle:'catalog',operationKey:crypto.randomUUID()});
    const updated=await projectAction(db,manager,'project.update',{id:'project-a',expectedVersion:2,name:'Scoped revision',operationKey:crypto.randomUUID()});
    assert.equal(updated.project.parent_id,'project-b');assert.equal(updated.project.type_id,type.id);assert.equal(updated.project.lifecycle,'catalog');
    await assert.rejects(projectAction(db,owner,'project.update',{id:'project-b',expectedVersion:1,parentId:'project-a',operationKey:crypto.randomUUID()}),error=>error.code==='project_cycle');
    const detail=await projectDetail(db,manager,'project-a');assert.equal(detail.relatedProjects.length,0,'Parent name is not exposed outside project scope.');
    await assert.rejects(projectDetail(db,manager,'project-b'),error=>error.status===404);
  }finally{db.native.close();}
});

test('concurrent project hierarchy edits cannot create a cycle or orphan mutation claim', async () => {
  const db=database();try{const owner=actor(db,'owner',null);const results=await Promise.allSettled([
    projectAction(db,owner,'project.update',{id:'project-a',expectedVersion:1,parentId:'project-b',operationKey:crypto.randomUUID()}),
    projectAction(db,owner,'project.update',{id:'project-b',expectedVersion:1,parentId:'project-a',operationKey:crypto.randomUUID()}),
  ]);assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(db.native.prepare('SELECT COUNT(*) n FROM mutation_keys').get().n,1);assert.equal(db.native.prepare('SELECT COUNT(*) n FROM projects WHERE parent_id IS NOT NULL').get().n,1);
  }finally{db.native.close();}
});

test('links and schedules validate input, save snapshots, restore by new CAS revision and replay safely', async () => {
  const db=database();try{
    const manager=actor(db,'manager','project-a');
    const input={projectId:'project-a',label:'Official page',url:'https://proex.ufg.br/',kind:'official',operationKey:crypto.randomUUID()};
    const created=await projectAction(db,manager,'project.link.create',input);
    assert.equal((await projectAction(db,manager,'project.link.create',input)).id,created.id);
    const updated=await projectAction(db,manager,'project.link.update',{id:created.id,expectedVersion:1,label:'Revised label',operationKey:crypto.randomUUID()});
    assert.equal(updated.project_link.version,2);
    const restoration={entityType:'project_link',entityId:created.id,restoreVersion:1,expectedVersion:2,operationKey:crypto.randomUUID()};
    const restored=await projectAction(db,manager,'entity.restore',restoration);
    assert.equal(restored.project_link.label,'Official page');assert.equal(restored.project_link.version,3);
    assert.equal((await projectAction(db,manager,'entity.restore',restoration)).duplicate,true);
    assert.equal(db.native.prepare("SELECT COUNT(*) n FROM entity_versions WHERE entity_type='project_link' AND entity_id=?").get(created.id).n,3);
    await assert.rejects(projectAction(db,manager,'project.link.create',{...input,url:'javascript:alert(1)',operationKey:crypto.randomUUID()}),error=>error.code==='invalid_url');
    await assert.rejects(projectAction(db,manager,'project.link.update',{id:created.id,expectedVersion:1,label:'Stale write',operationKey:crypto.randomUUID()}),error=>error.status===409);
    const schedule=await projectAction(db,manager,'project.schedule.create',{projectId:'project-a',title:'Public reference milestone',startsAt:'2025-10-21T12:00:00Z',endsAt:'2025-10-21T12:00:00Z',status:'completed',note:'Documented institutional source; no operational attendance',url:'https://proex.ufg.br/',operationKey:crypto.randomUUID()});
    assert.equal(schedule.project_schedule_item.status,'completed');assert.equal(db.native.prepare('SELECT COUNT(*) n FROM campaigns').get().n,0);
    const detail=await projectDetail(db,manager,'project-a');assert.equal(detail.links.length,1);assert.equal(detail.schedule.length,1);
  }finally{db.native.close();}
});

test('shared calls require current authority for every project and remain editable only by authorized managers', async () => {
  const db=database();try{
    const owner=actor(db,'owner',null),manager=actor(db,'manager','project-a');
    const input={projectId:'project-a',title:'Institutional call',referenceCode:'PROEX 01/2026',description:'Public metadata',status:'closed',officialUrl:'https://proex.ufg.br/',linkedProjectIds:['project-b'],operationKey:crypto.randomUUID()};
    await assert.rejects(projectAction(db,manager,'call.create',input),error=>error.status===403);
    const created=await projectAction(db,owner,'call.create',input);assert.equal((await projectAction(db,owner,'call.create',input)).id,created.id);
    const detail=await projectDetail(db,manager,'project-a');assert.equal(detail.calls[0].canEdit,false);assert.deepEqual(detail.calls[0].linkedProjectIds,[]);assert.equal(detail.versions.filter(row=>row.entity_type==='call').length,0);
    await assert.rejects(projectAction(db,manager,'call.update',{id:created.id,expectedVersion:1,title:'Unauthorized unlink',linkedProjectIds:[],operationKey:crypto.randomUUID()}),error=>error.status===403);
    await projectAction(db,owner,'call.update',{id:created.id,expectedVersion:1,title:'New title',linkedProjectIds:[],operationKey:crypto.randomUUID()});
    assert.equal(db.native.prepare('SELECT COUNT(*) n FROM project_calls WHERE call_id=?').get(created.id).n,0);
    const versions=db.native.prepare("SELECT snapshot_json FROM entity_versions WHERE entity_type='call' AND entity_id=? ORDER BY version").all(created.id);
    assert.deepEqual(JSON.parse(versions[0].snapshot_json).linked_project_ids,['project-b']);assert.deepEqual(JSON.parse(versions[1].snapshot_json).linked_project_ids,[]);
  }finally{db.native.close();}
});

test('project details redact domain relationships and revoked type writers leave no claim', async () => {
  const db=database();try{
    const viewer=actor(db,'viewer','project-a'),operator=actor(db,'operator','project-a'),owner=actor(db,'owner',null);
    for(const principal of [viewer,operator]){const detail=await projectDetail(db,principal,'project-a');assert.equal(detail.permissions.canEdit,false);assert.equal(detail.relationships.items,null);assert.equal(detail.relationships.loans,null);assert.deepEqual(detail.versions,[]);}
    db.native.prepare('UPDATE members SET revoked_at=? WHERE id=?').run(new Date().toISOString(),owner.members[0].id);
    await assert.rejects(projectAction(db,owner,'project.type.create',{key:'revoked',label:'Must not exist',operationKey:crypto.randomUUID()}),error=>error.status===409);
    assert.equal(db.native.prepare('SELECT COUNT(*) n FROM project_types').get().n,0);assert.equal(db.native.prepare('SELECT COUNT(*) n FROM mutation_keys').get().n,0);
  }finally{db.native.close();}
});

test('project scope separates internal PROEX actions from external partners without changing access', async () => {
  const db=database();
  try {
    const owner=actor(db,'owner',null),manager=actor(db,'manager','project-a');
    assert.equal(db.native.prepare("SELECT scope FROM projects WHERE id='project-a'").get().scope,'internal','existing projects stay internal');
    const external=await projectAction(db,owner,'project.create',{...createInput(),scope:'external'});
    assert.equal(external.project.scope,'external');
    await assert.rejects(projectAction(db,owner,'project.create',{...createInput(),scope:'partner'}),error=>error.status===400);
    const updated=await projectAction(db,manager,'project.update',{id:'project-a',expectedVersion:1,scope:'external',operationKey:crypto.randomUUID()});
    assert.equal(updated.project.scope,'external');
    const kept=await projectAction(db,manager,'project.update',{id:'project-a',expectedVersion:2,name:'Other name'});
    assert.equal(kept.project.scope,'external','omitted scope keeps the stored value');
    await assert.rejects(projectDetail(db,manager,external.project.id),error=>error.status===404,'scope never widens a project grant');
  } finally {db.native.close();}
});
