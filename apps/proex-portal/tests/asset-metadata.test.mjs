import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url)), modules = new Map();
const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const overrides = new Map([
  ['lib/platform', moduleUrl('export const database=()=>globalThis.__assetDb; export const bucket=()=>globalThis.__assetStorage; export const ownerEmail=()=>undefined;')],
  ['lib/session', moduleUrl('export const getPortalUser=async()=>null;')],
]);
function compile(name) {
  name = name.replace(/\.ts$/, ''); if (overrides.has(name)) return overrides.get(name); if (modules.has(name)) return modules.get(name);
  let code = name.endsWith('.json') ? `export default ${readFileSync(path.join(root, name), 'utf8')}` : ts.transpileModule(readFileSync(path.join(root, `${name}.ts`), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  code = code.replace(/from (['"])(\.{1,2}\/[^'"]+|@\/[^'"]+)\1/g, (_all, _quote, dependency) => `from ${JSON.stringify(compile(dependency.startsWith('@/') ? dependency.slice(2) : path.posix.normalize(path.posix.join(path.posix.dirname(name), dependency))))}`);
  const url = moduleUrl(`${code}\n//# sourceURL=${name}-asset-under-test.mjs`); modules.set(name, url); return url;
}
const { materialsAction, materialDetail } = await import(compile('lib/materials'));
const { assetMetadata, assetCurrencyCents, ASSET_METADATA_COLUMNS } = await import(compile('lib/asset-metadata'));
const { createRecord, uploadRecordAttachment, recordAttachment } = await import(compile('lib/records'));
const { reportRows } = await import(compile('lib/reports'));
const { portalSnapshot } = await import(compile('lib/portal-data'));
const { exportPortablePage, describePortableSchemas } = await import(compile('lib/sync/portable'));
const { applyPortableChanges } = await import(compile('lib/sync/apply'));
const { callSyncTool } = await import(compile('lib/sync/tools'));
const publicEvent = await import(compile('app/api/events/[id]/route'));
const { prizeComponents } = await import(compile('lib/campaigns'));
const migrations = readdirSync(path.join(root, 'drizzle')).filter(name => name.endsWith('.sql')).sort();
function fixture() {
  const native = new DatabaseSync(':memory:'); native.exec('PRAGMA foreign_keys=ON'); for (const file of migrations) native.exec(readFileSync(path.join(root, 'drizzle', file), 'utf8'));
  const now = new Date().toISOString(); for (const id of ['project-a','project-b']) native.prepare('INSERT INTO projects(id,name,created_at) VALUES(?,?,?)').run(id,id,now);
  let beforeBatch, afterRead;
  const db = { native, beforeBatch(callback) { beforeBatch = callback; }, afterRead(callback) { afterRead = callback; }, prepare(sql) { let args = []; return {
    bind(...values) { args = values; return this; }, async first(column) { const row = native.prepare(sql).get(...args); afterRead?.(sql); return column ? row?.[column] ?? null : row ?? null; },
    async all() { const results = native.prepare(sql).all(...args); afterRead?.(sql); return { success: true, results }; },
    async run() { const result = native.prepare(sql).run(...args); return { success: true, results: [], meta: { changes: Number(result.changes) } }; },
    execute() { const results = native.prepare(sql).all(...args); return { success: true, results, meta: { changes: Number(native.prepare('SELECT changes() n').get().n) } }; },
  }; }, async batch(statements) { if (beforeBatch) { const callback = beforeBatch; beforeBatch = null; callback(); } native.exec('BEGIN'); try { const results = statements.map(statement => statement.execute()); native.exec('COMMIT'); return results; } catch (error) { native.exec('ROLLBACK'); throw error; } } };
  const objects = new Map(), storage = { async put(key, value) { objects.set(key, value); }, async get(key) { return objects.get(key); }, async delete(key) { objects.delete(key); } };
  return { db, storage, now, close: () => native.close() };
}
function principal(f, role = 'inventory', project = 'project-a') {
  const userId = crypto.randomUUID(), member = { id: crypto.randomUUID(), user_id: userId, email: `${role}@synthetic.invalid`, role, project_id: project, revoked_at: null, created_at: f.now };
  f.db.native.prepare('INSERT INTO members(id,user_id,email,role,project_id,revoked_at,created_at) VALUES(?,?,?,?,?,?,?)').run(...Object.values(member));
  f.db.native.prepare('INSERT INTO portal_users(user_id,email,status,created_at,updated_at) VALUES(?,?,?,?,?)').run(userId,member.email,'active',f.now,f.now);
  return { userId, email: member.email, displayName: 'Synthetic staff', members: [member], capabilities: [] };
}
const input = (extra = {}) => ({ projectId: 'project-a', name: 'Synthetic projector', category: 'equipment', unit: 'unidade', assetCode: '00001234', operationKey: crypto.randomUUID(), ...extra });
const make = async (f, actor, extra = {}) => (await materialsAction(f.db, actor, 'item.create', input(extra))).item;

test('0010 upgrades legacy assets without inventing fields, balances, document links or valuations', () => {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON');
  for (const file of migrations.filter(file => !file.startsWith('0010_'))) db.exec(readFileSync(path.join(root,'drizzle',file),'utf8'));
  db.exec("INSERT INTO projects(id,name,created_at) VALUES('legacy-p','Legacy project','2026-01-01'); INSERT INTO items(id,project_id,name,category,unit,stock,asset_code,created_at) VALUES('legacy-i','legacy-p','Legacy asset','equipment','unidade',1,'000009','2026-01-01')");
  db.exec(readFileSync(path.join(root,'drizzle/0010_structured_asset_metadata.sql'),'utf8'));
  const item = db.prepare("SELECT * FROM items WHERE id='legacy-i'").get(); assert.equal(item.asset_code,'000009'); assert.equal(item.stock,1);
  for (const field of ASSET_METADATA_COLUMNS) assert.equal(item[field],null,field);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM stock_movements').get().n,0); assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]); db.close();
});
test('manual metadata preserves textual zeros, missing values and ledger state, with versioned restoration', async () => {
  const f = fixture(), actor = principal(f);
  try {
    const item = await make(f,actor,{ brand:'Synthetic brand', serialNumber:'00000077', assetStatus:'Em conferência', responsibleReference:'Responsável conforme termo sintético', acquisitionValueCents:0, responsibilityTerm:'TERMO-SINTETICO-01' });
    assert.equal(item.asset_code,'00001234'); assert.equal(item.serial_number,'00000077'); assert.equal(item.stock,0); assert.equal(item.acquisition_value_cents,0); assert.equal(item.model,null);
    const updated = await materialsAction(f.db,actor,'item.update',{ id:item.id,expectedVersion:1,model:'Model B',assetStatus:'Informado como transferido',destination:'Destino documental' });
    assert.equal(updated.item.condition,'active'); assert.equal(updated.item.stock,0); assert.equal(updated.item.acquisition_value_cents,0);
    await assert.rejects(materialsAction(f.db,actor,'item.update',{ id:item.id,expectedVersion:1,brand:'Stale' }),error=>error.code==='item_changed');
    const restored = await materialsAction(f.db,actor,'item.restore',{ id:item.id,expectedVersion:2,restoreVersion:1 }); assert.equal(restored.item.model,null); assert.equal(restored.item.version,3);
    assert.equal(f.db.native.prepare('SELECT COUNT(*) n FROM stock_movements').get().n,0); assert.equal(f.db.native.prepare('SELECT COUNT(*) n FROM loans').get().n,0);
    await assert.rejects(make(f,actor,{assetCode:1234}),error=>error.status===400);
  } finally { f.close(); }
});
test('validation refuses inferred numbers, invalid dates and undocumented values, while exact decimal UI input preserves absence', () => {
  assert.equal(assetCurrencyCents(''),null); assert.equal(assetCurrencyCents('0'),0); assert.equal(assetCurrencyCents('001234,56'),123456); assert.equal(assetCurrencyCents('12.3'),1230);
  for (const value of ['1.234,56','1e3','-1','12,345']) assert.throws(()=>assetCurrencyCents(value));
  assert.equal(assetMetadata({}).acquisitionValueCents,null);
  for (const invalid of [{serialNumber:77},{acquisitionDate:'2026-02-30'},{acquisitionValueCents:'123'},{acquisitionValueCents:123},{sourceReference:'source',acquisitionValueCents:1.5},{brand:'a\u0000b'}]) assert.throws(()=>assetMetadata(invalid));
  assert.equal(assetMetadata({sourceReference:'Documento sintético, p. 2',acquisitionValueCents:123}).acquisitionValueCents,123);
});
test('project A/B, anonymous, viewer and loans cannot read or alter private asset metadata; live revocation rolls back updates and creates', async () => {
  const f=fixture(), actor=principal(f), other=principal(f,'inventory','project-b'), viewer=principal(f,'viewer'), loans=principal(f,'loans');
  try {
    const item=await make(f,actor); for(const denied of [other,viewer,loans,null]) await assert.rejects(materialDetail(f.db,denied,item.id),error=>[401,403].includes(error.status));
    await assert.rejects(materialsAction(f.db,other,'item.update',{id:item.id,expectedVersion:1,brand:'Forbidden'}),error=>error.status===403);
    f.db.beforeBatch(()=>f.db.native.prepare('UPDATE members SET revoked_at=? WHERE user_id=?').run(f.now,actor.userId));
    await assert.rejects(materialsAction(f.db,actor,'item.update',{id:item.id,expectedVersion:1,brand:'Revoked'}),error=>error.code==='item_changed');
    assert.equal(f.db.native.prepare('SELECT brand FROM items WHERE id=?').get(item.id).brand,null); assert.equal(f.db.native.prepare('SELECT COUNT(*) n FROM entity_versions WHERE entity_id=?').get(item.id).n,1);
    const creating=principal(f); f.db.beforeBatch(()=>f.db.native.prepare('UPDATE members SET revoked_at=? WHERE user_id=?').run(f.now,creating.userId));
    await assert.rejects(make(f,creating,{assetCode:'000055'})); assert.equal(f.db.native.prepare('SELECT COUNT(*) n FROM items').get().n,1);
  } finally {f.close();}
});
test('detail revalidates after asynchronous history queries, preserves private PDF records and hides loan identities', async () => {
  const f=fixture(), actor=principal(f), other=principal(f,'inventory','project-b');
  try {
    const item=await make(f,actor); const record=await createRecord(f.db,actor,{projectId:'project-a',itemId:item.id,kind:'material',title:'Synthetic invoice reference',body:'Private synthetic source',occurredAt:f.now,operationKey:crypto.randomUUID()});
    const attached=await uploadRecordAttachment(f.db,f.storage,actor,{recordId:record.id,bytes:new TextEncoder().encode('%PDF-1.7\nSynthetic\n%%EOF'),name:'synthetic-document.pdf',declaredMime:'application/pdf',operationKey:crypto.randomUUID()});
    const detail=await materialDetail(f.db,actor,item.id); assert.equal(detail.attachments[0].id,attached.attachment.id); assert.equal(detail.photos.length,0); assert.equal(detail.records[0].id,record.id); assert.doesNotMatch(JSON.stringify(detail),/object_key|borrower_contact|borrower_name/);
    await assert.rejects(recordAttachment(f.db,other,attached.attachment.id),error=>error.status===403);
    let fired=false; f.db.afterRead(sql=>{if(!fired&&sql.includes('SELECT id,status,starts_at,ends_at,checked_out_at')){fired=true;f.db.native.prepare('UPDATE members SET revoked_at=? WHERE user_id=?').run(f.now,actor.userId);}});
    await assert.rejects(materialDetail(f.db,actor,item.id),error=>error.status===403); assert.equal(fired,true);
  } finally {f.close();}
});
test('private report columns are opt-in and live inventory scoped, and defaults never include fiscal, responsible or value fields', async()=>{
  const f=fixture(), actor=principal(f), viewer=principal(f,'viewer');
  try {
    await make(f,actor,{invoiceReference:'SYNTHETIC-PRIVATE-NF',responsibleReference:'SYNTHETIC-PRIVATE-RESP',acquisitionValueCents:12345});
    const ordinary=await reportRows(f.db,actor,{dataset:'materials'}); assert.equal(ordinary.rows.length,1); assert.equal('nota_fiscal' in ordinary.rows[0],false); assert.equal('responsavel_documentado' in ordinary.rows[0],false); assert.equal('valor_aquisicao_centavos' in ordinary.rows[0],false);
    const privateReport=await reportRows(f.db,actor,{dataset:'materials',assetDetails:'1'}); assert.equal(privateReport.rows[0].nota_fiscal,'SYNTHETIC-PRIVATE-NF'); assert.equal(privateReport.rows[0].valor_aquisicao_centavos,12345);
    assert.equal((await reportRows(f.db,viewer,{dataset:'materials',assetDetails:'1'})).rows.length,0);
    f.db.native.prepare('UPDATE members SET revoked_at=? WHERE user_id=?').run(f.now,actor.userId); assert.equal((await reportRows(f.db,actor,{dataset:'materials',assetDetails:true})).rows.length,0);
  }finally{f.close();}
});
test('Sheets metadata allowlist keeps tombamento text, private owner scope, CAS and missing valuation; limited MCP cannot export assets',async()=>{
  const f=fixture(), actor=principal(f), owner=principal(f,'owner',null);
  try{
    const item=await make(f,actor); const schema=describePortableSchemas().tables.find(row=>row.table==='items'); assert.equal(schema.columns.find(column=>column.name==='asset_code').type,'text'); assert.equal(schema.columns.find(column=>column.name==='acquisition_value_cents').private,true);
    const changed=await applyPortableChanges(f.db,owner,{changes:[{changeKey:'asset-sheet-metadata-0001',table:'items',id:item.id,expectedVersion:1,fields:{serial_number:'000098',asset_location:'Sala sintética',acquisition_value_cents:null}}]}); assert.equal(changed.results[0].status,'applied');
    const exported=await exportPortablePage(f.db,owner,{table:'items'});assert.equal(exported.rows[0].serial_number,'000098');assert.equal(exported.rows[0].asset_code,'00001234');assert.equal(exported.rows[0].acquisition_value_cents,null);
    await assert.rejects(exportPortablePage(f.db,actor,{table:'items'}),error=>error.status===403);
    await assert.rejects(callSyncTool(f.db,actor,'proex_sync_read',{table:'items'},'https://synthetic.invalid'),error=>error.status===403);
  }finally{f.close();}
});
test('public campaign, game projection and broad portal payload never expose the added private item fields',async()=>{
  const f=fixture(), actor=principal(f), owner=principal(f,'owner',null);
  try{
    await make(f,actor,{invoiceReference:'SYNTHETIC-SECRET-INVOICE',responsibleReference:'SYNTHETIC-SECRET-RESP',acquisitionValueCents:54321});
    const gift=await make(f,actor,{assetCode:'000099',category:'gift',invoiceReference:'SYNTHETIC-SECRET-INVOICE'});
    for (const kind of ['brinde','super']) { f.db.native.prepare('INSERT INTO offers(id,project_id,name,kind) VALUES(?,?,?,?)').run(kind,'project-a','Synthetic gift',kind); f.db.native.prepare('INSERT INTO offer_components(offer_id,item_id,quantity) VALUES(?,?,?)').run(kind,gift.id,1); }
    const game=await prizeComponents(f.db,{project_id:'project-a',brinde_offer_id:'brinde',super_offer_id:'super'}); assert.doesNotMatch(JSON.stringify(game),/SYNTHETIC-SECRET|invoice_reference|acquisition_value|responsible_reference/);
    f.db.native.prepare("INSERT INTO campaigns(id,project_id,name,location,starts_at,ends_at,status,rules_text,created_at) VALUES('public-event','project-a','Public synthetic event','',?,?,'active','Rules',?)").run(f.now,'2099-01-01T00:00:00Z',f.now);
    globalThis.__assetDb=f.db; const response=await publicEvent.GET(new Request('https://synthetic.invalid/api/events/public-event'),{params:Promise.resolve({id:'public-event'})});assert.equal(response.status,200);
    const publicBody=await response.text(); assert.doesNotMatch(publicBody,/SYNTHETIC-SECRET|invoice_reference|acquisition_value|responsible_reference/);
    const snapshot=await portalSnapshot(f.db,owner); assert.doesNotMatch(JSON.stringify(snapshot),/SYNTHETIC-SECRET|invoice_reference|acquisition_value|responsible_reference/);
  }finally{delete globalThis.__assetDb;f.close();}
});
