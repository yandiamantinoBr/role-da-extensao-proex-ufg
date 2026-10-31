import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url)), modules = new Map();
function compile(name) {
  if (modules.has(name)) return modules.get(name);
  if (name.endsWith('.json')) return `data:text/javascript;base64,${Buffer.from(`export default ${readFileSync(`${root}lib/${name}`, 'utf8')}`).toString('base64')}`;
  let source = ts.transpileModule(readFileSync(`${root}lib/${name}.ts`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  source = source.replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g, (_match, _quote, dependency) => `from ${JSON.stringify(compile(path.posix.normalize(path.posix.join(path.posix.dirname(name), dependency)).replace(/\.ts$/, '')))}`);
  const result = `data:text/javascript;base64,${Buffer.from(`${source}\n//# sourceURL=${name}-importer-test.mjs`).toString('base64')}`; modules.set(name, result); return result;
}
const { parseImportDocument } = await import(compile('importer/parse'));
const { canonicalSigaaUrl, readPublicSigaa } = await import(compile('importer/sigaa'));
const { previewImport, applyImport } = await import(compile('importer/service'));
const { readImportReview } = await import(compile('importer/review'));
const secret = 'test-only-import-review-key-with-no-production-access';
const publicUrl = 'https://sigaa.sistemas.ufg.br/sigaa/link/public/extensao/visualizacaoAcaoExtensao/9999999999';
const html = `<html><table><tr><td>Título:</td><td>Projeto fict&iacute;cio &amp; educa&ccedil;&atilde;o</td></tr><tr><td>Ano:</td><td>2026</td></tr><tr><td>Área Principal:</td><td>Comunicação</td></tr><tr><td>Unidade Proponente:</td><td>Unidade de demonstração</td></tr><tr><td>Tipo:</td><td>PROJETO</td></tr><tr><td>Coordenador:</td><td>Pessoa privada</td></tr><tr><td>Url da Acão:</td><td>${publicUrl}</td></tr></table><script>throw new Error('never execute')</script></html>`;
function fixture() {
  const native = new DatabaseSync(':memory:'); native.exec('PRAGMA foreign_keys=ON');
  for (const migration of readdirSync(`${root}drizzle`).filter(file => file.endsWith('.sql')).sort()) native.exec(readFileSync(`${root}drizzle/${migration}`, 'utf8'));
  const now = new Date().toISOString();
  native.prepare("INSERT INTO projects(id,name,description,scope,created_at) VALUES('project-a','Projeto anterior','Descrição preservada','external',?),('project-b','Outro projeto','','internal',?)").run(now, now);
  native.prepare("INSERT INTO organizational_units(id,name,acronym,kind,created_at,updated_at) VALUES('unit-a','Unidade de demonstração','QA','academic',?,?)").run(now, now);
  native.prepare("INSERT INTO project_types(id,key,label,created_at,updated_at) VALUES('type-qa','project','Projeto',?,?)").run(now, now);
  const actors = {};
  for (const [role, projectId] of [['owner', null], ['manager', 'project-a'], ['inventory', 'project-a'], ['viewer', 'project-a']]) {
    const userId = `${role}-qa`, email = `${role}@example.test`;
    native.prepare("INSERT INTO portal_users(user_id,email,status,created_at,updated_at) VALUES(?,?,'active',?,?)").run(userId, email, now, now);
    native.prepare('INSERT INTO members(id,user_id,email,role,project_id,created_at) VALUES(?,?,?,?,?,?)').run(userId, userId, email, role, projectId, now);
    actors[role] = { userId, email, displayName: role, capabilities: [], members: [{ id: userId, user_id: userId, email, role, project_id: projectId, revoked_at: null, created_at: now }] };
  }
  let failRecord = false;
  const db = { prepare(sql) { let values = []; return { bind(...args) { values = args; return this; }, async first() { return native.prepare(sql).get(...values) ?? null; }, async all() { return { results: native.prepare(sql).all(...values) }; }, async run() { return { meta: { changes: Number(native.prepare(sql).run(...values).changes) } }; }, execute() { if (failRecord && /INSERT INTO records/.test(sql)) { failRecord = false; throw new Error('synthetic_record_failure'); } const results = native.prepare(sql).all(...values); return { results, meta: { changes: Number(native.prepare('SELECT changes() n').get().n) } }; } }; }, async batch(statements) { native.exec('BEGIN'); try { const result = statements.map(statement => statement.execute()); native.exec('COMMIT'); return result; } catch (error) { native.exec('ROLLBACK'); throw error; } } };
  return { native, db, actors, failRecordOnce() { failRecord = true; } };
}
const document = (fields, extra = {}) => ({ kind: 'project', organizationId: 'org_proex', sourceMode: 'document', format: 'json', content: JSON.stringify(fields), ...extra });
const apply = (preview, selectedFields, operationKey = 'qa-import-operation-1', extra = {}) => ({ confirmed: true, reviewToken: preview.reviewToken, candidateKey: 'row-1', selectedFields, operationKey, ...extra });

test('HTML, JSON and CSV extract only operational fields, decode entities and preserve tombamento zeros', () => {
  const parsed = parseImportDocument('project', html, 'html')[0];
  assert.equal(parsed.fields.name, 'Projeto fictício & educação'); assert.equal(parsed.fields.thematicArea, 'comunicacao');
  assert.equal(JSON.stringify(parsed).includes('Pessoa privada'), false); assert.equal(Object.hasOwn(parsed.fields, 'role'), false);
  const csv = '"Nome";"Tombamento";"Descrição"\r\n"Equipamento QA";"0000123";"Linha 1\nLinha 2, com ".concat("texto")"';
  assert.throws(() => parseImportDocument('asset', csv, 'csv'), /Aspas|colunas/);
  const valid = '"Nome";"Tombamento";"Descrição"\r\n"Equipamento QA";"0000123";"Linha 1\nLinha 2, com ""aspas"""';
  const asset = parseImportDocument('asset', valid, 'csv')[0]; assert.equal(asset.fields.assetCode, '0000123'); assert.match(asset.fields.description, /Linha 2, com "aspas"/);
  const privateDocument = parseImportDocument('project', JSON.stringify({ name: 'Projeto QA', description: 'Contato pessoa@example.test, CPF 123.456.789-00', role: 'owner', email: 'private@example.test', stock: 99 }), 'json')[0];
  assert.equal(privateDocument.fields.role, undefined); assert.equal(privateDocument.fields.stock, undefined); assert.match(privateDocument.fields.description, /omitido/); assert.equal(JSON.stringify(privateDocument).includes('123.456'), false);
});

test('invalid dates, ambiguous headers, oversized documents and apparent credentials cannot become trusted data', () => {
  const candidate = parseImportDocument('project', JSON.stringify({ name: 'Projeto QA', inicio: '31/02/2026', area: 'inventada', thematicArea: 'Outra área' }), 'json')[0];
  assert.match(candidate.problems.startsAt, /não existe/); assert.match(candidate.problems.thematicArea, /áreas temáticas/);
  const valid = parseImportDocument('project', 'Título: Projeto QA\nInício: 31/10/2026\nFim: 31/10/2026', 'text')[0];
  assert.equal(valid.fields.startsAt, '2026-10-31T03:00:00.000Z'); assert.equal(valid.fields.endsAt, '2026-11-01T02:59:59.999Z');
  assert.throws(() => parseImportDocument('project', 'name,nome\nProjeto A,Projeto B', 'csv'), /colunas diferentes/);
  assert.throws(() => parseImportDocument('project', 'x'.repeat(256 * 1024 + 1), 'text'), error => error.code === 'import_document_limit');
  assert.throws(() => parseImportDocument('project', 'BETTER_AUTH_SECRET=synthetic-test-only', 'text'), error => error.code === 'import_sensitive_content');
  assert.throws(() => parseImportDocument('asset', JSON.stringify(Array.from({ length: 21 }, () => ({ name: 'QA' }))), 'json'), error => error.code === 'import_row_limit');
});

test('SIGAA reads use bounded public routes and anonymous memory cookies; reject SSRF, CAPTCHA and empty redirects', async () => {
  for (const value of ['http://127.0.0.1/', 'https://localhost/', 'https://sigaa.sistemas.ufg.br.evil.test/', 'https://user:pass@sigaa.sistemas.ufg.br/sigaa/link/public/extensao/visualizacaoAcaoExtensao/1', publicUrl + '?next=http://localhost', '0']) assert.throws(() => canonicalSigaaUrl(value));
  let calls = 0;
  const fetched = await readPublicSigaa(publicUrl, async (url, init) => { calls++; if (calls === 1) return new Response(null, { status: 302, headers: { Location: '/sigaa/public/extensao/viewDadosCursoEvento.jsf', 'Set-Cookie': 'JSESSIONID=synthetic-anonymous-session; HttpOnly' } }); assert.equal(init.headers.Cookie, 'JSESSIONID=synthetic-anonymous-session'); assert.equal(init.redirect, 'manual'); assert.match(String(url), /public\/extensao/); return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }); });
  assert.equal(calls, 2); assert.equal(fetched.externalId, '9999999999');
  await assert.rejects(readPublicSigaa(publicUrl, async () => new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/internal' } })), error => error.code === 'import_sigaa_protected');
  await assert.rejects(readPublicSigaa(publicUrl, async () => new Response('g-recaptcha', { headers: { 'Content-Type': 'text/html' } })), error => error.code === 'import_sigaa_protected');
  await assert.rejects(readPublicSigaa(publicUrl, async () => new Response(html.replaceAll('9999999999', '0'), { headers: { 'Content-Type': 'text/html' } })), error => error.code === 'import_sigaa_empty');
  await assert.rejects(readPublicSigaa(publicUrl, async () => new Response('x'.repeat(256 * 1024 + 1), { headers: { 'Content-Type': 'text/html' } })), error => error.code === 'import_document_limit');
  let redirects = 0;
  await assert.rejects(readPublicSigaa(publicUrl, async () => { redirects++; return new Response(null, { status: 302, headers: { Location: '/sigaa/public/extensao/viewDadosCursoEvento.jsf' } }); }), error => error.code === 'import_sigaa_unavailable');
  assert.equal(redirects, 5);
});

test('preview changes no data; signed confirmation binds actor, expiry and field choices', async () => {
  const f = fixture(); try {
    const before = f.native.prepare('SELECT COUNT(*) n FROM audit').get().n;
    const preview = await previewImport(f.db, f.actors.owner, document({ name: 'Projeto QA', scope: 'internal', role: 'owner' }), secret);
    assert.equal(f.native.prepare('SELECT COUNT(*) n FROM audit').get().n, before); assert.equal(preview.actorId, undefined);
    assert.equal(preview.candidates[0].fields.scope, undefined);
    await assert.rejects(applyImport(f.db, f.actors.owner, { ...apply(preview, ['name']), confirmed: false }, secret), error => error.code === 'import_confirmation_required');
    await assert.rejects(applyImport(f.db, f.actors.owner, apply(preview, ['role']), secret), error => error.code === 'import_fields');
    const [payload, signature] = preview.reviewToken.split('.');
    await assert.rejects(readImportReview(secret, `${payload.slice(0, -1)}${payload.endsWith('A') ? 'B' : 'A'}.${signature}`, f.actors.owner.userId));
    await assert.rejects(readImportReview(secret, preview.reviewToken, f.actors.manager.userId));
    await assert.rejects(readImportReview(secret, preview.reviewToken, f.actors.owner.userId, Date.now() + 16 * 60000));
    assert.equal(f.native.prepare('SELECT COUNT(*) n FROM projects').get().n, 2);
  } finally { f.native.close(); }
});

test('project updates apply selected fields, preserve other settings, record source and retry after partial failure', async () => {
  const f = fixture(); try {
    const preview = await previewImport(f.db, f.actors.manager, document({ name: 'Nome conferido', description: 'Não selecionada', thematicArea: 'Comunicação' }, { projectId: 'project-a', sourceUrl: 'https://proex.ufg.br/p/qa-fonte-sintetica' }), secret);
    const input = apply(preview, ['name', 'thematicArea']); f.failRecordOnce();
    await assert.rejects(applyImport(f.db, f.actors.manager, input, secret), /synthetic_record_failure/);
    const saved = await applyImport(f.db, f.actors.manager, input, secret);
    assert.equal(saved.projectId, 'project-a');
    const row = f.native.prepare('SELECT name,description,scope,thematic_area,version FROM projects WHERE id=?').get('project-a');
    assert.equal(row.name, 'Nome conferido'); assert.equal(row.description, 'Descrição preservada'); assert.equal(row.scope, 'external'); assert.equal(row.thematic_area, 'comunicacao'); assert.equal(row.version, 2);
    assert.equal(f.native.prepare('SELECT COUNT(*) n FROM project_links').get().n, 1); assert.equal(f.native.prepare('SELECT COUNT(*) n FROM records').get().n, 1);
    const replay = await applyImport(f.db, f.actors.manager, input, secret); assert.equal(replay.recordId, saved.recordId);
    assert.match(f.native.prepare('SELECT body FROM records WHERE id=?').get(saved.recordId).body, /SHA-256/);
  } finally { f.native.close(); }
});

test('project scoping is checked before source access, and public metadata never grants permissions', async () => {
  const f = fixture(); try {
    let calls = 0; const fetcher = async () => { calls++; throw new Error('should not fetch'); };
    await assert.rejects(previewImport(f.db, f.actors.manager, { kind: 'project', projectId: 'project-b', sourceMode: 'sigaa', sourceUrl: publicUrl }, secret, fetcher), error => error.status === 403);
    await assert.rejects(previewImport(f.db, f.actors.viewer, document({ name: 'QA' }, { projectId: 'project-a' }), secret), error => error.status === 403);
    await assert.rejects(previewImport(f.db, f.actors.manager, document({ name: 'QA' }), secret), error => error.status === 403);
    assert.equal(calls, 0);
    const preview = await previewImport(f.db, f.actors.owner, document({ name: 'Projeto novo', modality: 'PROJETO', unitName: 'Unidade de demonstração', members: ['owner'] }), secret);
    assert.equal(preview.candidates[0].suggestedTypeId, 'type-qa'); assert.equal(preview.candidates[0].suggestedUnitId, 'unit-a');
    const saved = await applyImport(f.db, f.actors.owner, apply(preview, ['name', 'modality', 'unitName'], 'qa-new-project', { unitId: 'unit-a', typeId: 'type-qa' }), secret);
    assert.equal(f.native.prepare('SELECT unit_id,type_id,prizes_enabled FROM projects WHERE id=?').get(saved.projectId).unit_id, 'unit-a');
    assert.equal(f.native.prepare('SELECT COUNT(*) n FROM members').get().n, 4); assert.equal(f.native.prepare('SELECT COUNT(*) n FROM portal_users').get().n, 4);
  } finally { f.native.close(); }
});

test('a changed project or a revoked/blocked account invalidates a prepared import before any further write', async () => {
  const f = fixture(); try {
    const preview = await previewImport(f.db, f.actors.manager, document({ name: 'Edição antiga' }, { projectId: 'project-a' }), secret);
    f.native.prepare("UPDATE projects SET name='Edição concorrente',version=version+1 WHERE id='project-a'").run();
    await assert.rejects(applyImport(f.db, f.actors.manager, apply(preview, ['name']), secret), error => error.status === 409);
    assert.equal(f.native.prepare("SELECT name FROM projects WHERE id='project-a'").get().name, 'Edição concorrente');
    const current = await previewImport(f.db, f.actors.manager, document({ name: 'Sem permissão atual' }, { projectId: 'project-a' }), secret);
    f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='manager-qa'").run(new Date().toISOString());
    await assert.rejects(applyImport(f.db, f.actors.manager, apply(current, ['name']), secret), error => error.status === 403);
    const owner = await previewImport(f.db, f.actors.owner, document({ name: 'Conta bloqueada' }), secret);
    f.native.prepare("UPDATE portal_users SET status='blocked' WHERE user_id='owner-qa'").run();
    await assert.rejects(applyImport(f.db, f.actors.owner, apply(owner, ['name']), secret), error => error.status === 403);
    assert.equal(f.native.prepare('SELECT COUNT(*) n FROM records').get().n, 0);
  } finally { f.native.close(); }
});

test('visual corrections are validated, selected explicitly and recorded as manual review', async () => {
  const f = fixture(); try {
    const preview = await previewImport(f.db, f.actors.owner, document({ description: 'Documento narrativo sem título identificado' }), secret);
    const saved = await applyImport(f.db, f.actors.owner, apply(preview, ['name', 'thematicArea'], 'qa-visual-correction', { edits: { name: 'Título conferido pela pessoa', thematicArea: 'Comunicação' } }), secret);
    assert.equal(f.native.prepare('SELECT thematic_area FROM projects WHERE id=?').get(saved.projectId).thematic_area, 'comunicacao');
    assert.match(f.native.prepare('SELECT body FROM records WHERE id=?').get(saved.recordId).body, /Campos ajustados manualmente/);
    await assert.rejects(applyImport(f.db, f.actors.owner, apply(preview, ['name'], 'qa-unsafe-edit', { edits: { name: 'QA', role: 'owner' } }), secret), error => error.code === 'import_fields');
    await assert.rejects(applyImport(f.db, f.actors.owner, apply(preview, ['name', 'thematicArea'], 'qa-invalid-area', { edits: { name: 'QA', thematicArea: 'Área inexistente' } }), secret), error => error.code === 'import_fields');
  } finally { f.native.close(); }
});

test('asset import preserves identifier text, records structured evidence and creates no stock movement', async () => {
  const f = fixture(); try {
    const preview = await previewImport(f.db, f.actors.inventory, { kind: 'asset', projectId: 'project-a', sourceMode: 'manual', content: JSON.stringify({ name: 'Projetor QA', assetCode: '000123', brand: 'Marca QA', serialNumber: 'SERIE-QA', location: 'Sala de conferência', stock: 1 }) }, secret);
    const input = apply(preview, ['name', 'assetCode', 'brand', 'serialNumber', 'assetLocation'], 'qa-import-asset-1');
    const saved = await applyImport(f.db, f.actors.inventory, input, secret), replay = await applyImport(f.db, f.actors.inventory, input, secret);
    assert.equal(saved.itemId, replay.itemId); assert.equal(saved.recordId, replay.recordId);
    const item = f.native.prepare('SELECT stock,asset_code,category FROM items WHERE id=?').get(saved.itemId);
    assert.equal(item.stock, 0); assert.equal(item.asset_code, '000123'); assert.equal(item.category, 'equipment');
    assert.equal(f.native.prepare('SELECT COUNT(*) n FROM stock_movements').get().n, 0);
    assert.match(f.native.prepare('SELECT body FROM records WHERE id=?').get(saved.recordId).body, /Marca: Marca QA/);
    await assert.rejects(applyImport(f.db, f.actors.inventory, { ...input, operationKey: 'qa-duplicate-asset' }, secret), error => error.code === 'import_duplicate');
    await assert.rejects(previewImport(f.db, f.actors.owner, { kind: 'asset', projectId: 'project-b', itemId: saved.itemId, sourceMode: 'manual', content: '{}' }, secret), error => error.code === 'project_mismatch');
    const evidence = await previewImport(f.db, f.actors.inventory, { kind: 'asset', projectId: 'project-a', itemId: saved.itemId, sourceMode: 'manual', content: JSON.stringify({ name: 'Nome observado na etiqueta', assetCode: '000123', sourceCondition: 'Necessita conferência' }) }, secret);
    const received = await applyImport(f.db, f.actors.inventory, apply(evidence, ['name', 'assetCode', 'conservationState'], 'qa-asset-evidence-1'), secret);
    assert.equal(f.native.prepare('SELECT name FROM items WHERE id=?').get(saved.itemId).name, 'Projetor QA');
    assert.match(f.native.prepare('SELECT body FROM records WHERE id=?').get(received.recordId).body, /Nome observado na etiqueta/);
  } finally { f.native.close(); }
});

test('Data de fim and término aliases preserve the final Brasília day without fabricating missing dates',()=>{
 for(const label of ['Data de fim','Data de término','Término']){const candidate=parseImportDocument('project',`Título: Projeto QA\nData de início: 01/11/2026\n${label}: 30/11/2026`,'text')[0];assert.equal(candidate.fields.startsAt,'2026-11-01T03:00:00.000Z');assert.equal(candidate.fields.endsAt,'2026-12-01T02:59:59.999Z');}
 assert.equal(parseImportDocument('project','Título: Projeto QA\nData de início: 01/11/2026','text')[0].fields.endsAt,undefined);
});
test('new project import requires explicit authorized organization, binds it to token/provenance and rechecks on replay',async()=>{
 const f=fixture();try{
  const at=new Date().toISOString();f.native.prepare("INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES('org-b','Organização B','organizacao-b',?,?)").run(at,at);
  const userId='local-owner-a',email='local-owner-a@example.test';f.native.prepare("INSERT INTO portal_users(user_id,email,status,created_at,updated_at) VALUES(?,?,'active',?,?)").run(userId,email,at,at);f.native.prepare("INSERT INTO members(id,user_id,email,role,project_id,organization_id,created_at) VALUES(?,?,?,'owner',NULL,'org_proex',?)").run(userId,userId,email,at);const owner={userId,email,displayName:'Admin A'};
  await assert.rejects(previewImport(f.db,owner,document({name:'Novo sem organização'},{organizationId:undefined}),secret),error=>error.code==='import_organization');
  await assert.rejects(previewImport(f.db,owner,document({name:'Escopo B'},{organizationId:'org-b'}),secret),error=>error.status===403);
  const preview=await previewImport(f.db,owner,document({name:'Projeto local A'}),secret);assert.equal(preview.organizationId,'org_proex');assert.equal(preview.provenance.organizationId,'org_proex');assert.equal((await readImportReview(secret,preview.reviewToken,userId)).version,2);
  const result=await applyImport(f.db,owner,apply(preview,['name'],'test-only-organization-import'),secret);assert.equal(f.native.prepare('SELECT organization_id FROM projects WHERE id=?').get(result.projectId).organization_id,'org_proex');
  f.native.prepare('UPDATE members SET revoked_at=? WHERE id=?').run(at,userId);await assert.rejects(applyImport(f.db,owner,apply(preview,['name'],'test-only-organization-import'),secret),error=>error.status===403);
 }finally{f.native.close();}
});

test('all sixteen documented asset fields enter the new zero-stock asset, preserve zeros, and never overwrite an existing asset',async()=>{
 const f=fixture();try{
  const values={name:'Bem documentado',assetCode:'00000042',brand:'Marca QA',model:'Modelo QA',serialNumber:'0000123',assetLocation:'Sala fictícia',responsibleUnit:'Unidade informada',responsibleReference:'Equipe fictícia',conservationState:'Conferido',assetStatus:'Em uso informado',origin:'Origem documental',destination:'Destino documental',processReference:'00001',responsibilityTerm:'00002',invoiceReference:'00003',sourceReference:'Documento sintético, página 1',acquisitionDate:'01/10/2026',acquisitionValueCents:'123456'};
  const preview=await previewImport(f.db,f.actors.inventory,{kind:'asset',projectId:'project-a',sourceMode:'manual',content:JSON.stringify(values)},secret);assert.deepEqual(preview.candidates[0].problems,{});
  const fields=Object.keys(values),saved=await applyImport(f.db,f.actors.inventory,apply(preview,fields,'qa-sixteen-asset-fields'),secret),row=f.native.prepare('SELECT * FROM items WHERE id=?').get(saved.itemId);
  assert.equal(row.stock,0);assert.equal(row.reserved,0);assert.equal(row.asset_code,'00000042');assert.equal(row.serial_number,'0000123');assert.equal(row.acquisition_value_cents,123456);assert.equal(row.acquisition_date,'2026-10-01');assert.equal(row.process_reference,'00001');assert.equal(row.responsibility_term,'00002');assert.equal(row.invoice_reference,'00003');assert.equal(row.responsible_reference,'Equipe fictícia');assert.equal(row.asset_location,'Sala fictícia');assert.equal(row.conservation_state,'Conferido');assert.equal(row.asset_status,'Em uso informado');assert.equal(row.origin,'Origem documental');assert.equal(row.destination,'Destino documental');assert.equal(row.source_reference,'Documento sintético, página 1');assert.equal(row.brand,'Marca QA');assert.equal(row.model,'Modelo QA');assert.equal(row.responsible_unit,'Unidade informada');
  const evidence=await previewImport(f.db,f.actors.inventory,{kind:'asset',projectId:'project-a',itemId:saved.itemId,sourceMode:'manual',content:JSON.stringify({...values,brand:'Marca observada depois',acquisitionValueCents:'999999'})},secret);const receipt=await applyImport(f.db,f.actors.inventory,apply(evidence,fields,'qa-sixteen-existing-evidence'),secret);assert.equal(f.native.prepare('SELECT brand FROM items WHERE id=?').get(saved.itemId).brand,'Marca QA');assert.match(f.native.prepare('SELECT body FROM records WHERE id=?').get(receipt.recordId).body,/Marca observada depois/);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM stock_movements').get().n,0);
  const noSource=parseImportDocument('asset',JSON.stringify({name:'Sem valor inferido',acquisitionValueCents:'1200'}),'json')[0];assert.match(noSource.problems.acquisitionValueCents,/referência/);const currency=parseImportDocument('asset',JSON.stringify({name:'Não converter moeda',acquisitionValueCents:'12,34',sourceReference:'Documento'}),'json')[0];assert.match(currency.problems.acquisitionValueCents,/centavos inteiros/);
 }finally{f.native.close();}
});
