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
 const result = `data:text/javascript;base64,${Buffer.from(`${source}\n//# sourceURL=${name}-assistant-test.mjs`).toString('base64')}`; modules.set(name, result); return result;
}
const { DEFAULT_ASSISTANT_CONFIG, validateProposal } = await import(compile('assistant/contracts'));
const { documentText } = await import(compile('importer/assistant'));
const { configureAssistant, assistantStatus, prepareAssistantPlan, applyAssistantPlan } = await import(compile('assistant/service'));
const { providerEndpoint } = await import(compile('assistant/provider'));
const { encryptCredentials, decryptCredentials, encryptProviderCredentials, decryptProviderCredentials, verifyPlan } = await import(compile('assistant/crypto'));
const { migrateAssistantCredentials } = await import(compile('assistant/credential-migration'));
const { assistantCredentialVault, manageAssistantCredential } = await import(compile('assistant/credential-vault'));
const { portalSnapshot } = await import(compile('portal-data'));
const { describePortableSchemas, exportPortablePage } = await import(compile('sync/portable'));
const { syncStatus } = await import(compile('sync/control'));
const { listSyncAttachments } = await import(compile('sync/attachments'));
const { startReviewedDictation } = await import(compile('assistant/dictation'));
const { manageAssistantGrant, loadSpeechSettings } = await import(compile('assistant/settings'));
const { transcribeSpeech, validateSpeechAudio, speechEndpoint, SPEECH_ENDPOINT, speechReservedUsdMicros } = await import(compile('assistant/speech'));
const { encodeSpeechWav, prepareSpeechWav } = await import(compile('../components/portal/speech-audio'));
const secret = 'test-only-assistant-auth-secret-no-production-access';
const key = 'test-only-fake-provider-credential';
const keys = { current: 'synthetic-only-independent-key-for-credential-migration' };
const vaultInput = (action, expectedRevision, extra = {}) => ({ action, organizationId: 'org_proex', provider: 'deepseek', expectedRevision, ...extra });
const saveVault = (f, expectedRevision = 0) => manageAssistantCredential(f.db, f.actors.owner,
 vaultInput('save', expectedRevision, { label: 'Chave sintética', secret: key }), secret, keys);
function fixture() {
 const native = new DatabaseSync(':memory:'); native.exec('PRAGMA foreign_keys=ON');
 for (const migration of readdirSync(`${root}drizzle`).filter(file => file.endsWith('.sql')).sort()) native.exec(readFileSync(`${root}drizzle/${migration}`, 'utf8'));
 const now = new Date().toISOString(); native.prepare("INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES('unit-synthetic','Outra org','outra-org',?,?)").run(now,now);
 native.prepare("INSERT INTO projects(id,name,description,scope,created_at) VALUES('project-a','Projeto A','','external',?),('project-b','Projeto B','','external',?)").run(now, now);
 native.prepare("INSERT INTO items(id,project_id,name,category,unit,created_at,updated_at) VALUES('item-a','project-a','Caneta QA','consumption','unidade',?,?),('item-b','project-b','Outro material','consumption','unidade',?,?)").run(now, now, now, now);
 const actors = {};
 for (const [role, project] of [['owner', null], ['manager', 'project-a'], ['inventory', 'project-a'], ['viewer', 'project-a']]) {
  const userId = `${role}-qa`, email = `${role}@example.test`;
  native.prepare("INSERT INTO portal_users(user_id,email,status,created_at,updated_at) VALUES(?,?,'active',?,?)").run(userId, email, now, now);
  native.prepare('INSERT INTO members(id,user_id,email,role,project_id,created_at) VALUES(?,?,?,?,?,?)').run(userId, userId, email, role, project, now);
  actors[role] = { userId, email, displayName: role, capabilities: [], members: [{ id: userId, user_id: userId, email, role, project_id: project, revoked_at: null, created_at: now }] };
 }
 let failReceipt = false, beforeStockBatch = null, beforeOtherBatch = null;
 const db = { prepare(sql) { let values = []; return { sql, bind(...args) { values = args; return this; }, async first() { return native.prepare(sql).get(...values) ?? null; }, async all() { return { results: native.prepare(sql).all(...values) }; }, async run() { return { meta: { changes: Number(native.prepare(sql).run(...values).changes) } }; }, execute() { if (failReceipt && /UPDATE ai_plans SET status='applied'/.test(sql)) { failReceipt = false; throw new Error('synthetic_receipt_failure'); } const results = native.prepare(sql).all(...values); return { results, meta: { changes: Number(native.prepare('SELECT changes() n').get().n) } }; } }; }, async batch(statements) { if(beforeOtherBatch&&statements.some(statement=>beforeOtherBatch.pattern.test(statement.sql))){const hook=beforeOtherBatch.callback;beforeOtherBatch=null;hook();} if (beforeStockBatch && statements.some(statement => /INSERT INTO stock_movements/.test(statement.sql))) { const hook = beforeStockBatch; beforeStockBatch = null; hook(); } native.exec('BEGIN'); try { const results = statements.map(statement => statement.execute()); native.exec('COMMIT'); return results; } catch (error) { native.exec('ROLLBACK'); throw error; } } };
 return { native, db, actors, failReceiptOnce() { failReceipt = true; }, raceStockOnce(callback) { beforeStockBatch = callback; }, raceBatch(pattern,callback){beforeOtherBatch={pattern,callback};} };
}
const configInput = (config = {}, extra = {}) => ({ action: 'configure', organizationId: 'org_proex', expectedRevision: 0, config: { ...DEFAULT_ASSISTANT_CONFIG, enabled: true, ...config }, deepseekKey: key, ...extra });
const request = (extra = {}) => ({ action: 'prepare', projectId: 'project-a', request: 'Registrar entrada de 10 canetas recebidas para a oficina.', consent: true, operationKey: 'test-only-assistant-call-1', ...extra });
const proposal = (extra = {}) => ({ intent: 'stock.receive', itemId: 'item-a', quantity: 10, title: 'Entrada de canetas', body: 'Canetas recebidas para a oficina', evidence: [{ source: 'request', quote: 'entrada de 10 canetas' }], ...extra });
function fakeProvider(overrides = {}) { let calls = 0; return { get calls() { return calls; }, fetch: async (url, init) => { calls++; assert.equal(init.redirect, 'error'); assert.ok(init.signal); assert.match(init.headers.Authorization, /^Bearer test-only/); const body = JSON.parse(init.body); if (String(url).includes('typesafe')) return Response.json({ model: body.model, answers: { faithful: { type: 'choice', choice: 'supported', confidence: 0.99, probabilities: { supported: 0.99, review: 0.01 }, ...overrides.decision } }, usage: { input_tokens: 500 } }); assert.equal(body.thinking.type, 'disabled'); assert.equal(body.response_format.type, 'json_object'); return Response.json({ model: 'deepseek-flash', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(proposal(overrides.proposal)) } }], usage: { prompt_tokens: 500, completion_tokens: 100 }, ...overrides.response }); } }; }
const confirm = preview => ({ action: 'apply', planToken: preview.planToken, confirmed: true });
const code = expected => error => error?.code === expected;

test('bare Portal, email and provider credentials stop before quota, outbound transport or document processing',async()=>{
 const f=fixture(),provider=fakeProvider();
 try{
  await configureAssistant(f.db,f.actors.owner,configInput(),secret);
  for(const prefix of ['pxs_','pxp_','pxm_','pxt_','pne_','gsk_','sk-','sk_']){
   const raw=prefix+'a'.repeat(43);
   await assert.rejects(prepareAssistantPlan(f.db,f.actors.inventory,request({request:'Consultar saldo usando '+raw}),secret,{fetcher:provider.fetch}),code('assistant_sensitive'));
   assert.throws(()=>documentText('Trecho documental com '+raw,'text'),code('document_ai_sensitive'));
  }
  assert.equal(provider.calls,0);
  assert.equal(f.native.prepare('SELECT COUNT(*) n FROM ai_organization_usage').get().n,0);
  assert.equal(f.native.prepare('SELECT COUNT(*) n FROM ai_plans').get().n,0);
 }finally{f.native.close();}
});

test('Groq vault preserves existing encrypted providers and makes no function or transport active merely by saving a key',async()=>{
 const f=fixture(),groqKey='gsk-synthetic-only-organization-groq';
 try{
  await configureAssistant(f.db,f.actors.owner,configInput({sttEnabled:false},{deepgramKey:key,typesafeKey:key}),secret);
  const before=await decryptProviderCredentials(secret,f.native.prepare('SELECT credentials_ciphertext FROM ai_organization_settings').get().credentials_ciphertext,'org_proex',keys);
  const vault=await manageAssistantCredential(f.db,f.actors.owner,{...vaultInput('save',1),provider:'groq',label:'Voz da organização',secret:groqKey},secret,keys);
  const row=f.native.prepare("SELECT * FROM ai_organization_settings WHERE organization_id='org_proex'").get(),after=await decryptProviderCredentials(secret,row.credentials_ciphertext,'org_proex',keys);
  for(const provider of ['deepseek','typesafe','deepgram'])assert.equal(after[provider],before[provider]);assert.equal(after.groq,groqKey);assert.match(row.credentials_ciphertext,/^v2\./);
  assert.equal(vault.keys.length,5);assert.equal(vault.keys.find(entry=>entry.provider==='groq').status,'active');assert.equal(JSON.parse(row.config_json).sttEnabled,false);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM ai_transcriptions').get().n,0);
  const exposed=JSON.stringify({vault,audit:f.native.prepare('SELECT details FROM audit').all()});for(const value of [groqKey,key,keys.current,row.credentials_ciphertext])assert.equal(exposed.includes(value),false);
 }finally{f.native.close();}
});

test('explicit Groq uses its organization vault key, replays without another charge and never uses an available environment key',async()=>{
 const f=fixture(),groqKey='test-only-vault-groq-org-a',environment={provider:'groq',organizationId:'org_proex',groqKey:'test-only-different-env-key'};let calls=0;
 try{
  await manageAssistantCredential(f.db,f.actors.owner,{...vaultInput('save',0),provider:'groq',label:'Voz institucional',secret:groqKey},secret,keys,environment);
  await configureAssistant(f.db,f.actors.owner,{action:'configure',organizationId:'org_proex',expectedRevision:1,config:{...DEFAULT_ASSISTANT_CONFIG,sttProvider:'groq',sttEnabled:true}},secret,environment,keys);
  const fetcher=async(url,init)=>{calls++;assert.equal(url,'https://api.groq.com/openai/v1/audio/transcriptions');assert.equal(init.headers.Authorization,'Bearer '+groqKey);assert.equal(init.body.get('model'),'whisper-large-v3-turbo');assert.equal(init.redirect,'error');return Response.json({text:'Texto para revisão humana.'});};
  const input=speechInput(wav(),{expectedProvider:'groq'}),result=await transcribeSpeech(f.db,f.actors.inventory,input,secret,{environment,keys,fetcher});assert.equal(result.provenance.credentialSource,'vault');
  assert.equal((await transcribeSpeech(f.db,f.actors.inventory,input,secret,{environment,keys,fetcher})).replayed,true);assert.equal(calls,1);
  assert.equal(f.native.prepare('SELECT reserved_usd_micros FROM ai_organization_usage').get().reserved_usd_micros,112);
  const status=await assistantStatus(f.db,f.actors.owner,secret,'org_proex',environment,keys);assert.equal(status.organizations.find(org=>org.id==='org_proex').sttCredentialSource,'vault');assert.equal(JSON.stringify(status).includes(groqKey),false);
  assert.equal(f.native.prepare('SELECT COUNT(*) n FROM stock_movements').get().n,0,'transcription does not apply a stock operation');
 }finally{f.native.close();}
});

test('Groq disable/remove cannot silently resume from legacy environment; re-enabling a key does not enable STT',async()=>{
 for(const action of ['disable','remove']){
  const f=fixture(),environment={provider:'groq',organizationId:'org_proex',groqKey:'test-only-env-groq-fallback'};let calls=0;
  try{
   await manageAssistantCredential(f.db,f.actors.owner,{...vaultInput('save',0),provider:'groq',label:'Voz institucional',secret:'test-only-vault-groq-credential'},secret,keys,environment);
   const config={...DEFAULT_ASSISTANT_CONFIG,sttProvider:'groq',sttEnabled:true};await configureAssistant(f.db,f.actors.owner,{action:'configure',organizationId:'org_proex',expectedRevision:1,config},secret,environment,keys);
   await manageAssistantCredential(f.db,f.actors.owner,{...vaultInput(action,2),provider:'groq'},secret,keys,environment);
   const stored=JSON.parse(f.native.prepare('SELECT config_json FROM ai_organization_settings').get().config_json);assert.equal(stored.sttEnabled,false);assert.equal(stored.sttProvider,'groq');
   await assert.rejects(configureAssistant(f.db,f.actors.owner,{action:'configure',organizationId:'org_proex',expectedRevision:3,config},secret,environment,keys),code('assistant_credentials'));
   await assert.rejects(transcribeSpeech(f.db,f.actors.inventory,speechInput(wav(),{expectedProvider:'groq'}),secret,{environment,keys,fetcher:async()=>{calls++;return Response.json({text:'Denied'});}}),code('assistant_unavailable'));assert.equal(calls,0);
   if(action==='disable'){await manageAssistantCredential(f.db,f.actors.owner,{...vaultInput('enable',3),provider:'groq'},secret,keys,environment);assert.equal(JSON.parse(f.native.prepare('SELECT config_json FROM ai_organization_settings').get().config_json).sttEnabled,false);}
  }finally{f.native.close();}
 }
});

test('Groq credentials and quotas are organization-specific while prior environment routing remains limited to its authorized organization',async()=>{
 const f=fixture(),environment={provider:'groq',organizationId:'org_proex',groqKey:'test-only-authorized-pilot-key'};
 try{
  for(const [id,value] of [['org_proex','test-only-groq-key-org-a'],['unit-synthetic','test-only-groq-key-org-b']]){
   await manageAssistantCredential(f.db,f.actors.owner,{action:'save',organizationId:id,provider:'groq',expectedRevision:0,label:'Voz da unidade',secret:value},secret,keys,environment);
   await configureAssistant(f.db,f.actors.owner,{action:'configure',organizationId:id,expectedRevision:1,config:{...DEFAULT_ASSISTANT_CONFIG,sttProvider:'groq',sttEnabled:true,dailyCalls:1}},secret,environment,keys);
   assert.equal((await loadSpeechSettings(f.db,secret,id,environment,keys)).apiKey,value);
  }
  const at=new Date().toISOString();f.native.prepare("INSERT INTO projects(id,name,organization_id,created_at)VALUES('project-c','Outra unidade','unit-synthetic',?)").run(at);let calls=0;
  const fetcher=async(_url,init)=>{calls++;assert.match(init.headers.Authorization,/key-org-[ab]$/);return Response.json({text:'Transcrição isolada.'});};
  await assert.rejects(transcribeSpeech(f.db,f.actors.inventory,speechInput(wav(),{projectId:'project-c',expectedProvider:'groq'}),secret,{environment,keys,fetcher}),code('forbidden'));assert.equal(calls,0);
  await transcribeSpeech(f.db,f.actors.inventory,speechInput(wav(),{expectedProvider:'groq'}),secret,{environment,keys,fetcher});
  await transcribeSpeech(f.db,f.actors.owner,speechInput(wav(),{projectId:'project-c',expectedProvider:'groq'}),secret,{environment,keys,fetcher});
  assert.deepEqual(f.native.prepare('SELECT organization_id,calls,reserved_usd_micros FROM ai_organization_usage ORDER BY organization_id').all().map(row=>({...row})),[{organization_id:'org_proex',calls:1,reserved_usd_micros:112},{organization_id:'unit-synthetic',calls:1,reserved_usd_micros:112}]);
  // A missing provider selection in stored legacy JSON still follows the prior
  // environment only for its explicitly configured organization.
  const legacy={...DEFAULT_ASSISTANT_CONFIG,sttEnabled:true};delete legacy.sttProvider;
  const cipher=await encryptProviderCredentials(secret,{deepgram:key},'unit-synthetic',keys);
  f.native.prepare("UPDATE ai_organization_settings SET config_json=?,credentials_ciphertext=?,revision=revision+1 WHERE organization_id='unit-synthetic'").run(JSON.stringify(legacy),cipher);
  const fallback=await loadSpeechSettings(f.db,secret,'unit-synthetic',environment,keys);assert.equal(fallback.provider,'deepgram');assert.equal(fallback.apiKey,key);
 }finally{f.native.close();}
});

test('Groq vault writes recheck owner/CAS and invalidate in-flight transcription after provider reply',async()=>{
 const f=fixture();try{
  const input={...vaultInput('save',0),provider:'groq',label:'Voz institucional',secret:'test-only-vault-groq-credential'};await manageAssistantCredential(f.db,f.actors.owner,input,secret,keys);
  const before=f.native.prepare('SELECT credentials_ciphertext FROM ai_organization_settings').get().credentials_ciphertext;
  await assert.rejects(manageAssistantCredential(f.db,f.actors.owner,{...input,secret:'test-only-stale-groq-credential'},secret,keys),code('assistant_configuration_changed'));assert.equal(f.native.prepare('SELECT credentials_ciphertext FROM ai_organization_settings').get().credentials_ciphertext,before);
  await configureAssistant(f.db,f.actors.owner,{action:'configure',organizationId:'org_proex',expectedRevision:1,config:{...DEFAULT_ASSISTANT_CONFIG,sttProvider:'groq',sttEnabled:true}},secret,undefined,keys);
  const fetcher=async()=>{await manageAssistantCredential(f.db,f.actors.owner,{...vaultInput('disable',2),provider:'groq'},secret,keys);return Response.json({text:'This reply must be withheld.'});};
  await assert.rejects(transcribeSpeech(f.db,f.actors.inventory,speechInput(wav(),{expectedProvider:'groq'}),secret,{keys,fetcher}),error=>['assistant_unavailable','speech_configuration_changed','speech_forbidden'].includes(error.code));
  assert.equal(f.native.prepare('SELECT result_ciphertext FROM ai_transcriptions').get().result_ciphertext,null);
  f.raceBatch(/UPDATE ai_organization_settings/,()=>f.native.prepare("UPDATE members SET revoked_at=? WHERE id='owner-qa'").run(new Date().toISOString()));
  await assert.rejects(manageAssistantCredential(f.db,f.actors.owner,{...vaultInput('enable',3),provider:'groq'},secret,keys),code('assistant_key_admin'));
 }finally{f.native.close();}
});

test('Groq cost uses official hourly integer micro-USD rounding and minimum10seconds while preserving Deepgram reservations',()=>{
 assert.equal(speechReservedUsdMicros('groq',1),112);assert.equal(speechReservedUsdMicros('groq',10),112);assert.equal(speechReservedUsdMicros('groq',30),334);assert.equal(speechReservedUsdMicros('groq',60),667);assert.equal(speechReservedUsdMicros('groq',3600),40000);assert.equal(speechReservedUsdMicros('deepgram',1),500);assert.equal(speechReservedUsdMicros('deepgram',60),30000);
});

test('a plausible Groq credential pasted into a request is rejected before transport or admission',async()=>{
 const f=fixture(),provider=fakeProvider();try{await configureAssistant(f.db,f.actors.owner,configInput(),secret);await assert.rejects(prepareAssistantPlan(f.db,f.actors.inventory,request({request:'Consulte o estoque com gsk_synthetic_key_never_send_to_a_provider'}),secret,{fetcher:provider.fetch}),code('assistant_sensitive'));assert.equal(provider.calls,0);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM ai_calls').get().n,0);}finally{f.native.close();}
});

test('Groq metadata migration preserves three populated providers and ciphertext/settings without touching collateral tables',async()=>{
 const native=new DatabaseSync(':memory:');native.exec('PRAGMA foreign_keys=ON');
 try{
  for(const migration of readdirSync(`${root}drizzle`).filter(file=>file.endsWith('.sql')&&!file.startsWith('0025')).sort())native.exec(readFileSync(`${root}drizzle/${migration}`,'utf8'));
  const at=new Date().toISOString(),cipher=await encryptProviderCredentials(secret,{deepseek:key,typesafe:key,deepgram:key},'org_proex',keys),config=JSON.stringify({...DEFAULT_ASSISTANT_CONFIG,enabled:true});
  native.prepare('INSERT INTO ai_organization_settings(organization_id,revision,config_json,credentials_ciphertext,updated_by,updated_at)VALUES(?,1,?,?,?,?)').run('org_proex',config,cipher,'synthetic-owner',at);
  for(const [i,provider] of ['deepseek','typesafe','deepgram'].entries())native.prepare('INSERT INTO ai_provider_credential_metadata(organization_id,provider,label,mask,state,created_at,created_by,updated_at,updated_by)VALUES(?,?,?,?,?,?,?,?,?)').run('org_proex',provider,'Chave '+provider,'…tail',['active','disabled','removed'][i],at,'synthetic-owner',at,'synthetic-owner');
  const metadata=native.prepare('SELECT * FROM ai_provider_credential_metadata ORDER BY provider').all(),settings=native.prepare('SELECT * FROM ai_organization_settings').all(),tables=native.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  native.exec(readFileSync(`${root}drizzle/0025_groq_organization_credentials.sql`,'utf8'));
  assert.deepEqual(native.prepare('SELECT * FROM ai_provider_credential_metadata ORDER BY provider').all(),metadata);assert.deepEqual(native.prepare('SELECT * FROM ai_organization_settings').all(),settings);assert.deepEqual(native.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all(),tables);assert.equal(native.prepare('PRAGMA foreign_key_check').all().length,0);
  native.prepare('INSERT INTO ai_provider_credential_metadata(organization_id,provider,label,mask,state,created_at,created_by,updated_at,updated_by)VALUES(?,?,?,?,?,?,?,?,?)').run('org_proex','groq','Voz','…tail','active',at,'synthetic-owner',at,'synthetic-owner');
  assert.throws(()=>native.prepare('UPDATE ai_provider_credential_metadata SET provider=? WHERE provider=?').run('unverified-provider','groq'),/CHECK/);
 }finally{native.close();}
});

test('credentials use authenticated encryption, cannot be decrypted after tampering or key rotation', async () => {
 const ciphertext = await encryptCredentials(secret, { deepseek: key }); assert.equal(ciphertext.includes(key), false); assert.deepEqual(await decryptCredentials(secret, ciphertext), { deepseek: key });
 await assert.rejects(decryptCredentials(secret + '-rotated', ciphertext), code('assistant_credentials_unavailable'));
 const [version, iv, bytes] = ciphertext.split('.'); await assert.rejects(decryptCredentials(secret, `${version}.${iv}.${bytes.slice(0, -2)}aa`), code('assistant_credentials_unavailable'));
});

test('provider envelopes distinguish the legacy and dedicated secrets, organization, version and rotation', async () => {
 const value = { deepseek: key };
 const legacy = await encryptProviderCredentials(secret, value, 'org_proex');
 const v2 = await encryptProviderCredentials(secret, value, 'org_proex', keys);
 assert.match(legacy, /^v1\./);
 assert.match(v2, /^v2\.[\w-]{16}\.[\w-]{16}\.[\w-]+$/);
 assert.notEqual(v2, await encryptProviderCredentials(secret, value, 'org_proex', keys));
 assert.deepEqual(await decryptProviderCredentials(secret, legacy, 'org_proex', keys), value);
 assert.deepEqual(await decryptProviderCredentials(secret + '-rotated', v2, 'org_proex', keys), value);
 const rotated = { current: keys.current + '-rotated', previous: keys.current };
 assert.deepEqual(await decryptProviderCredentials(secret, v2, 'org_proex', rotated), value);
 for (const [envelope, scope, available] of [
  [v2, 'org_proex', {}], [v2, 'org_proex', { current: rotated.current }], [v2, 'different-org', keys],
  [v2.replace(/^v2\./, 'v1.'), 'org_proex', keys], [v2 + '.', 'org_proex', keys],
  [v2.replace(/\.([\w-])([\w-]+)$/, (_, initial, rest) => '.' + (initial === 'A' ? 'B' : 'A') + rest), 'org_proex', keys],
 ]) await assert.rejects(decryptProviderCredentials(secret, envelope, scope, available), code('assistant_credentials_unavailable'));
 await assert.rejects(encryptProviderCredentials(secret, value, 'org_proex', {}, v2), code('assistant_key_configuration'));
 await assert.rejects(encryptProviderCredentials(secret, value, 'org_proex', { current: secret }), code('assistant_key_configuration'));
});

test('only the live global owner can migrate bounded batches; unreadable rows do not prevent progress', async () => {
 const f = fixture();
 try {
  await configureAssistant(f.db, f.actors.owner, configInput(), secret);
  const now = new Date().toISOString(), add = f.native.prepare('INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES(?,?,?,?,?)');
  for (const id of ['org-a-broken', 'org-b-synthetic']) add.run(id, id, id, now, now);
  const copy = f.native.prepare('INSERT INTO ai_organization_settings SELECT ?,revision,config_json,?,updated_by,updated_at FROM ai_organization_settings WHERE organization_id=\'org_proex\'');
  copy.run('org-a-broken', 'v1.broken.invalid');
  copy.run('org-b-synthetic', await encryptCredentials(secret, { deepseek: key }, 'org-b-synthetic'));
  const row = () => f.native.prepare("SELECT * FROM ai_organization_settings WHERE organization_id='org_proex'").get();
  const before = row();
  await manageAssistantGrant(f.db, f.actors.owner, { action: 'grant.create', organizationId: 'org_proex', userId: f.actors.manager.userId });
  await assert.rejects(migrateAssistantCredentials(f.db, f.actors.manager, {}, secret, keys), code('assistant_key_admin'));
  await assert.rejects(migrateAssistantCredentials(f.db, null, {}, secret, keys), code('unauthenticated'));
  await assert.rejects(migrateAssistantCredentials(f.db, f.actors.owner, { limit: 11 }, secret, keys), code('assistant_key_migration_input'));
  await assert.rejects(migrateAssistantCredentials(f.db, f.actors.owner, {}, secret, {}), code('assistant_key_configuration'));
  const first = await migrateAssistantCredentials(f.db, f.actors.owner, { limit: 1 }, secret, keys);
  assert.deepEqual(first, { migrated: 0, changed: 0, unreadable: 1, remaining: 3, nextCursor: 'org-a-broken' });
  const second = await migrateAssistantCredentials(f.db, f.actors.owner, { cursor: first.nextCursor }, secret, keys);
  assert.deepEqual(second, { migrated: 2, changed: 0, unreadable: 0, remaining: 1, nextCursor: null });
  const after = row(), { credentials_ciphertext: ciphertext, ...other } = after;
  assert.match(ciphertext, /^v2\./);
  const { credentials_ciphertext: legacyCiphertext, ...previousFields } = before;
  assert.deepEqual(other, previousFields, 'reciphering leaves non-credential fields intact');
  const receipt = await migrateAssistantCredentials(f.db, f.actors.owner, {}, secret, keys);
  assert.deepEqual(receipt, { migrated: 0, changed: 0, unreadable: 1, remaining: 1, nextCursor: null });
  const audit = f.native.prepare("SELECT details FROM audit WHERE action='assistant.credentials.reencrypted'").all();
  assert.equal(audit.length, 2);
  const publicStatus = await assistantStatus(f.db, f.actors.owner, secret + '-rotated', 'org_proex', undefined, keys);
  assert.equal(publicStatus.available, true);
  const exported = JSON.stringify({ receipt, audit, publicStatus });
  for (const privateValue of [key, secret, keys.current, ciphertext, legacyCiphertext]) assert.ok(!exported.includes(privateValue));
 } finally { f.native.close(); }
});

test('reciphering and settings saves use compare-and-swap in both directions and recheck live ACL', async () => {
 const f = fixture();
 try {
  await configureAssistant(f.db, f.actors.owner, configInput(), secret);
  const row = () => f.native.prepare("SELECT revision,credentials_ciphertext FROM ai_organization_settings WHERE organization_id='org_proex'").get();
  const set = f.native.prepare("UPDATE ai_organization_settings SET credentials_ciphertext=? WHERE organization_id='org_proex'");
  const concurrentLegacy = await encryptCredentials(secret, { deepseek: key + '-concurrent' }, 'org_proex');
  f.raceBatch(/SET credentials_ciphertext=/, () => set.run(concurrentLegacy));
  assert.equal((await migrateAssistantCredentials(f.db, f.actors.owner, {}, secret, keys)).changed, 1);
  assert.equal(row().credentials_ciphertext, concurrentLegacy);
  const concurrentV2 = await encryptProviderCredentials(secret, { deepseek: key }, 'org_proex', keys);
  f.raceBatch(/SET revision=\?,config_json=/, () => set.run(concurrentV2));
  await assert.rejects(configureAssistant(f.db, f.actors.owner, configInput({}, { expectedRevision: 1 }), secret), code('assistant_configuration_changed'));
  assert.equal(row().credentials_ciphertext, concurrentV2);
  await assert.rejects(configureAssistant(f.db, f.actors.owner, configInput({}, { expectedRevision: 1, replaceCredentials: true }), secret), code('assistant_key_configuration'));
  set.run(concurrentLegacy);
  f.raceBatch(/SET credentials_ciphertext=/, () => f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id=?").run(new Date().toISOString(), f.actors.owner.userId));
  await assert.rejects(migrateAssistantCredentials(f.db, f.actors.owner, {}, secret, keys), code('assistant_key_admin'));
  assert.equal(row().credentials_ciphertext, concurrentLegacy);
  assert.equal(f.native.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='assistant.credentials.reencrypted'").get().n, 0);
 } finally { f.native.close(); }
});

test('a rotated dedicated key can migrate older v2 envelopes and signed plans still use the login secret', async () => {
 const f = fixture();
 try {
  await saveVault(f);
  await configureAssistant(f.db, f.actors.owner, { action: 'configure', organizationId: 'org_proex', expectedRevision: 1, config: { ...DEFAULT_ASSISTANT_CONFIG, enabled: true } }, secret, undefined, keys);
  const rotated = { current: keys.current + '-rotation', previous: keys.current };
  const preview = await prepareAssistantPlan(f.db, f.actors.inventory, request(), secret, { fetcher: fakeProvider().fetch, keys: rotated });
  assert.equal((await migrateAssistantCredentials(f.db, f.actors.owner, {}, secret, rotated)).migrated, 1);
  const result = await applyAssistantPlan(f.db, f.actors.inventory, confirm(preview), secret, undefined, { current: rotated.current });
  assert.ok(result.movementId);
 } finally { f.native.close(); }
});

test('the owner-only vault masks credentials, preserves delegated configuration, and disables dependent features', async () => {
 const f = fixture();
 try {
  const read = () => assistantCredentialVault(f.db, f.actors.owner, 'org_proex', secret, keys);
  const write = (action, revision, extra) => manageAssistantCredential(f.db, f.actors.owner, vaultInput(action, revision, extra), secret, keys);
  const config = (revision, changes = {}) => ({ action: 'configure', organizationId: 'org_proex', expectedRevision: revision, config: { ...DEFAULT_ASSISTANT_CONFIG, ...changes } });
  const syntheticKey = 'sk-only-synthetic-credential-zW12';
  await manageAssistantGrant(f.db, f.actors.owner, { action: 'grant.create', organizationId: 'org_proex', userId: f.actors.manager.userId });
  await assert.rejects(assistantCredentialVault(f.db, f.actors.manager, 'org_proex', secret, keys), code('assistant_key_admin'));
  await assert.rejects(manageAssistantCredential(f.db, f.actors.manager, vaultInput('save', 0, { label: 'Outra chave', secret: syntheticKey }), secret, keys), code('assistant_key_admin'));
  await assert.rejects(write('save', 0, { label: syntheticKey, secret: syntheticKey }), code('assistant_key_label'));
  const saved = await write('save', 0, { label: 'DeepSeek QA', secret: syntheticKey });
  assert.equal(saved.keys[0].mask, 'sk-…zW12');
  assert.equal(saved.keys[0].status, 'active');
  await assert.rejects(configureAssistant(f.db, f.actors.manager, { ...config(1), deepseekKey: key }, secret, undefined, keys), code('assistant_key_admin'));
  assert.equal((await configureAssistant(f.db, f.actors.manager, config(1, { enabled: true, documentEnabled: true }), secret, undefined, keys)).revision, 2);
  const disabled = await write('disable', 2);
  assert.equal(disabled.keys[0].status, 'disabled');
  const disabledEnvelope = f.native.prepare('SELECT credentials_ciphertext FROM ai_organization_settings').get().credentials_ciphertext;
  assert.equal((await decryptProviderCredentials(secret, disabledEnvelope, 'org_proex', keys)).deepseek, undefined);
  await assert.rejects(configureAssistant(f.db, f.actors.manager, config(3, { enabled: true }), secret, undefined, keys), code('assistant_credentials'));
  assert.equal((await assistantStatus(f.db, f.actors.owner, secret, 'org_proex', undefined, keys)).config.documentEnabled, false);
  assert.equal((await write('enable', 3)).keys[0].status, 'active');
  assert.equal((await assistantStatus(f.db, f.actors.owner, secret, 'org_proex', undefined, keys)).available, false);
  await assert.rejects(write('remove', 3), code('assistant_configuration_changed'));
  assert.equal((await write('remove', 4)).keys[0].status, 'removed');
  const row = f.native.prepare("SELECT credentials_ciphertext FROM ai_organization_settings WHERE organization_id='org_proex'").get();
  assert.equal((await decryptProviderCredentials(secret, row.credentials_ciphertext, 'org_proex', keys)).deepseek, undefined);
  const audit = f.native.prepare("SELECT details FROM audit WHERE action LIKE 'assistant.credentials.%'").all();
  assert.equal(audit.length, 4);
  const exposed = JSON.stringify({ vault: await read(), audit });
  for (const value of [syntheticKey, keys.current, row.credentials_ciphertext]) assert.ok(!exposed.includes(value));
 } finally { f.native.close(); }
});


test('vault rejects plausible keys in labels and sanitizes legacy labels and masks without echoing them', async () => {
 const f = fixture(), speech = { provider: 'groq', organizationId: 'org_proex', groqKey: 'syntheticGroqValue' };
 const foreignKey = 'sk-qa-foreign-provider-only-Fz29', randomLookingKey = 'A0qp9b7f7CgT5m2RX4j5pY8s';
 try {
  await manageAssistantCredential(f.db, f.actors.owner,
   { ...vaultInput('save', 0, { label: 'Texto de outra organização', secret: foreignKey }), organizationId: 'unit-synthetic' }, secret, keys, speech);
  for (const label of ['Voz ' + speech.groqKey, 'Chave ' + foreignKey, randomLookingKey]) {
   await assert.rejects(manageAssistantCredential(f.db, f.actors.owner,
    vaultInput('save', 0, { label, secret: key }), secret, keys, speech), error => {
     assert.equal(error.code, 'assistant_key_label');
     assert.ok(!error.message.includes(label));
     return true;
    });
  }
  const saved = await manageAssistantCredential(f.db, f.actors.owner,
   vaultInput('save', 0, { label: 'Credencial de homologação', secret: key }), secret, keys, speech);
  assert.equal(saved.keys[0].label, 'Credencial de homologação');
  assert.match(saved.keys[0].mask, /^…[A-Za-z0-9_-]{4}$/);
  const metadata = f.native.prepare("SELECT label,mask FROM ai_provider_credential_metadata WHERE organization_id='org_proex'");
  f.native.prepare("UPDATE ai_provider_credential_metadata SET label=?,mask=? WHERE organization_id='org_proex'")
   .run(speech.groqKey, foreignKey);
  const read = await assistantCredentialVault(f.db, f.actors.owner, 'org_proex', secret, keys, speech);
  assert.equal(read.keys[0].label, 'DeepSeek');
  assert.equal(read.keys[0].mask, null);
  assert.equal(metadata.get().label, speech.groqKey, 'reading does not change stored data');
  const disabled = await manageAssistantCredential(f.db, f.actors.owner, vaultInput('disable', 1), secret, keys, speech);
  assert.equal(disabled.keys[0].status, 'disabled');
  assert.deepEqual({ ...metadata.get() }, { label: 'DeepSeek', mask: '' });
  const audit = f.native.prepare("SELECT details FROM audit WHERE action LIKE 'assistant.credentials.%'").all();
  assert.equal(audit.length, 3);
  for (const { details } of audit) assert.deepEqual(Object.keys(JSON.parse(details)).sort(), ['provider', 'revision', 'state']);
  const exposed = JSON.stringify({ read, disabled, audit });
  for (const protectedValue of [speech.groqKey, foreignKey, key, keys.current]) assert.ok(!exposed.includes(protectedValue));
 } finally { f.native.close(); }
});

test('vault owner and revision are checked again inside the write transaction, and recovery needs explicit confirmation', async () => {
 const f = fixture();
 try {
  await saveVault(f);
  const sql = f.native.prepare("UPDATE ai_organization_settings SET credentials_ciphertext='v1.lost.ciphertext' WHERE organization_id='org_proex'");
  sql.run();
  assert.equal((await assistantCredentialVault(f.db, f.actors.owner, 'org_proex', secret, keys)).recoverable, true);
  await assert.rejects(saveVault(f, 1), code('assistant_key_recovery'));
  const replacement = vaultInput('save', 1, { label: 'Recuperação sintética', secret: key, replaceUnavailable: true });
  f.raceBatch(/vault_authority_changed/, () => f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id=?").run(new Date().toISOString(), f.actors.owner.userId));
  await assert.rejects(manageAssistantCredential(f.db, f.actors.owner, replacement, secret, keys), code('assistant_key_admin'));
  assert.equal(f.native.prepare('SELECT credentials_ciphertext FROM ai_organization_settings').get().credentials_ciphertext, 'v1.lost.ciphertext');
  f.native.prepare('UPDATE members SET revoked_at=NULL WHERE user_id=?').run(f.actors.owner.userId);
  const result = await manageAssistantCredential(f.db, f.actors.owner, replacement, secret, keys);
  assert.equal(result.recoverable, false);
  assert.equal(result.keys[0].status, 'active');
 } finally { f.native.close(); }
});

test('vault reservations follow Brasília day and month, and missing dedicated key never advertises a v2 downgrade', async () => {
 const f = fixture(), DateConstructor = globalThis.Date;
 try {
  const day = DateConstructor.parse('2026-11-01T02:30:00.000Z');
  globalThis.Date = class extends DateConstructor {
   constructor(...args) { super(...(args.length ? args : [day])); }
   static now() { return day; }
  };
  const insert = f.native.prepare('INSERT INTO ai_organization_usage(organization_id,day,reserved_usd_micros) VALUES(?,?,?)');
  insert.run('org_proex', '2026-10-01', 7);
  insert.run('org_proex', '2026-10-31', 11);
  insert.run('org_proex', '2026-11-01', 23);
  await configureAssistant(f.db, f.actors.owner, configInput(), secret);
  const legacy = await assistantCredentialVault(f.db, f.actors.owner, 'org_proex', secret, {});
  assert.equal(legacy.legacyAvailable, true);
  assert.equal(legacy.storageReady, false);
  assert.equal(legacy.keys[0].status, 'active');
  assert.equal(legacy.keys[0].mask, null);
  assert.deepEqual(legacy.reserved, { today: 11, month: 18, dailyLimit: 1000000 });
  assert.equal((await assistantStatus(f.db, f.actors.owner, secret, 'org_proex')).credentialVaultManaged, false);
  await migrateAssistantCredentials(f.db, f.actors.owner, {}, secret, keys);
  const missing = await assistantCredentialVault(f.db, f.actors.owner, 'org_proex', secret, {});
  assert.equal(missing.legacyAvailable, false);
  assert.equal(missing.storageReady, false);
  assert.equal(missing.keys[0].status, 'unavailable');
  assert.equal((await assistantStatus(f.db, f.actors.owner, secret, 'org_proex')).credentialVaultManaged, true);
  await assert.rejects(configureAssistant(f.db, f.actors.owner, configInput({}, { expectedRevision: 1, replaceCredentials: true }), secret), code('assistant_key_configuration'));
 } finally { globalThis.Date = DateConstructor; f.native.close(); }
});
test('only platform owner configures; no endpoint override, no plaintext echo, optimistic revision required', async () => {
 const f = fixture(); try {
  await assert.rejects(configureAssistant(f.db, f.actors.manager, configInput(), secret), code('assistant_configuration_forbidden'));
  await assert.rejects(configureAssistant(f.db, f.actors.owner, configInput({ endpoint: 'https://127.0.0.1/' }), secret), code('assistant_schema'));
  const result = await configureAssistant(f.db, f.actors.owner, configInput(), secret); assert.deepEqual(result, { ok: true, revision: 1 });
  const stored = f.native.prepare('SELECT * FROM ai_organization_settings').get(); assert.equal(stored.credentials_ciphertext.includes(key), false); assert.equal(JSON.stringify(stored).includes(key), false);
  const status = await assistantStatus(f.db, f.actors.owner, secret, 'org_proex'); assert.equal(status.available, true); assert.equal(JSON.stringify(status).includes('ciphertext'), false); assert.equal(JSON.stringify(status).includes(key), false);
  await assert.rejects(configureAssistant(f.db, f.actors.owner, configInput(), secret), code('assistant_configuration_changed'));
  if (!f.native.prepare('PRAGMA table_info(members)').all().some(row => row.name === 'organization_id')) f.native.exec('ALTER TABLE members ADD organization_id TEXT');
  f.native.prepare("UPDATE members SET organization_id='unit-synthetic' WHERE role='owner'").run();
  await assert.rejects(configureAssistant(f.db, f.actors.owner, configInput({}, { expectedRevision: 1 }), secret), code('assistant_configuration_forbidden'));
 } finally { f.native.close(); }
});
test('provider allowlist rejects SSRF, redirects, custom ports and lookalike domains before fetch', () => {
 assert.equal(providerEndpoint('deepseek'), 'https://api.deepseek.com/chat/completions');
 for (const url of ['http://127.0.0.1/', 'https://127.0.0.1/', 'https://localhost/', 'https://api.deepseek.com.evil.test/chat/completions', 'https://api.deepseek.com:8443/chat/completions', 'https://u:p@api.deepseek.com/chat/completions', 'https://api.deepseek.com/chat/completions?next=http://localhost']) assert.throws(() => providerEndpoint('deepseek', url), code('assistant_endpoint'));
 assert.throws(() => providerEndpoint('unknown'), code('assistant_endpoint'));
});
test('unconfigured and non-consenting requests make no paid calls; scope A cannot inspect project B', async () => {
 const f = fixture(), provider = fakeProvider(); try {
  await assert.rejects(prepareAssistantPlan(f.db, f.actors.inventory, request(), secret, { fetcher: provider.fetch }), code('assistant_unavailable'));
  await configureAssistant(f.db, f.actors.owner, configInput(), secret);
  await assert.rejects(prepareAssistantPlan(f.db, f.actors.inventory, request({ consent: false }), secret, { fetcher: provider.fetch }), code('assistant_consent'));
  await assert.rejects(prepareAssistantPlan(f.db, f.actors.inventory, request({ projectId: 'project-b' }), secret, { fetcher: provider.fetch }), code('forbidden'));
  await assert.rejects(prepareAssistantPlan(f.db, f.actors.viewer, request(), secret, { fetcher: provider.fetch }), code('forbidden'));
  await assert.rejects(prepareAssistantPlan(f.db, f.actors.inventory, request({ request: 'api_key=synthetic-secret' }), secret, { fetcher: provider.fetch }), code('assistant_sensitive'));
  assert.equal(provider.calls, 0);
 } finally { f.native.close(); }
});
test('fake provider proposes only; signed plan and normal inventory service apply once with audit', async () => {
 const f = fixture(), provider = fakeProvider(); try {
  await configureAssistant(f.db, f.actors.owner, configInput(), secret);
  const preview = await prepareAssistantPlan(f.db, f.actors.inventory, request(), secret, { fetcher: provider.fetch });
  assert.equal(preview.plan.before.stock, 0); assert.equal(preview.plan.after.stock, 10); assert.equal(preview.plan.actorId, undefined); assert.equal(preview.undoAvailable, false);
  assert.equal(f.native.prepare('SELECT stock FROM items WHERE id=?').get('item-a').stock, 0);
  const repeated = await prepareAssistantPlan(f.db, f.actors.inventory, request(), secret, { fetcher: provider.fetch }); assert.equal(repeated.plan.id, preview.plan.id); assert.equal(provider.calls, 1);
  await assert.rejects(applyAssistantPlan(f.db, f.actors.inventory, { ...confirm(preview), confirmed: false }, secret), code('assistant_confirmation'));
  await assert.rejects(applyAssistantPlan(f.db, f.actors.inventory, { ...confirm(preview), proposal: proposal({ quantity: 999 }) }, secret), code('assistant_schema'));
  const result = await applyAssistantPlan(f.db, f.actors.inventory, confirm(preview), secret); assert.ok(result.movementId);
  assert.equal((await applyAssistantPlan(f.db, f.actors.inventory, confirm(preview), secret)).replayed, true);
  assert.equal(f.native.prepare('SELECT stock FROM items WHERE id=?').get('item-a').stock, 10); assert.equal(f.native.prepare('SELECT COUNT(*) n FROM stock_movements').get().n, 1);
  assert.equal(f.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='assistant.apply'").get().n, 1);
 } finally { f.native.close(); }
});
test('tampered token, different actor, expired plan and revoked membership cannot apply', async () => {
 const f = fixture(), provider = fakeProvider(); try {
  await configureAssistant(f.db, f.actors.owner, configInput(), secret);
  const preview = await prepareAssistantPlan(f.db, f.actors.inventory, request(), secret, { fetcher: provider.fetch });
  const [body, signature] = preview.planToken.split('.');
  await assert.rejects(verifyPlan(secret, `${body.slice(0, -2)}aa.${signature}`, f.actors.inventory.userId), code('assistant_plan_invalid'));
  await assert.rejects(applyAssistantPlan(f.db, f.actors.manager, confirm(preview), secret), code('assistant_plan_invalid'));
  await assert.rejects(applyAssistantPlan(f.db, f.actors.inventory, confirm(preview), secret, preview.plan.expiresAt + 1), code('assistant_plan_invalid'));
  f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='inventory-qa'").run(new Date().toISOString());
  await assert.rejects(applyAssistantPlan(f.db, f.actors.inventory, confirm(preview), secret), code('forbidden'));
  assert.equal(f.native.prepare('SELECT COUNT(*) n FROM stock_movements').get().n, 0);
 } finally { f.native.close(); }
});
test('project and DB payload tampering fail closed; changed stock requires fresh preview', async () => {
 const f = fixture(), provider = fakeProvider(); try {
  await configureAssistant(f.db, f.actors.owner, configInput(), secret);
  const preview = await prepareAssistantPlan(f.db, f.actors.inventory, request(), secret, { fetcher: provider.fetch });
  f.native.prepare("UPDATE ai_plans SET payload_json=replace(payload_json,'stock.receive','stock.consume') WHERE id=?").run(preview.plan.id);
  await assert.rejects(applyAssistantPlan(f.db, f.actors.inventory, confirm(preview), secret), code('assistant_plan_invalid'));
  const next = await prepareAssistantPlan(f.db, f.actors.inventory, request({ operationKey: 'test-only-second-plan' }), secret, { fetcher: provider.fetch });
  f.native.prepare("INSERT INTO stock_movements(id,item_id,delta,kind,note,ref_id,actor_id,created_at) VALUES('concurrent','item-a',1,'receive','QA','concurrent','owner-qa',?)").run(new Date().toISOString());
  await assert.rejects(applyAssistantPlan(f.db, f.actors.inventory, confirm(next), secret), code('assistant_stock_changed'));
 } finally { f.native.close(); }
});
test('quotas reserve before call, duplicate retries cannot pay again, unknown failures retain reservation', async () => {
 const f = fixture(), provider = fakeProvider(); try {
  await configureAssistant(f.db, f.actors.owner, configInput({ dailyCalls: 1 }), secret);
  await assert.rejects(prepareAssistantPlan(f.db, f.actors.inventory, request(), secret, { fetcher: async () => { throw new Error('test-only-network-failure'); } }), code('assistant_provider_unavailable'));
  const usage = f.native.prepare('SELECT * FROM ai_organization_usage').get(); assert.equal(usage.calls, 1); assert.ok(usage.reserved_usd_micros > 0); assert.ok(usage.reserved_tokens > 0); assert.ok(usage.reserved_ms > 0);
  await assert.rejects(prepareAssistantPlan(f.db, f.actors.inventory, request(), secret, { fetcher: provider.fetch }), code('assistant_call_replay'));
  await assert.rejects(prepareAssistantPlan(f.db, f.actors.inventory, request({ operationKey: 'test-only-second-call' }), secret, { fetcher: provider.fetch }), code('assistant_quota'));
  assert.equal(provider.calls, 0); assert.deepEqual(f.native.prepare('SELECT * FROM ai_organization_usage').get(), usage);
 } finally { f.native.close(); }
});
test('atomic stock predicate closes a concurrent change between preflight and domain transaction', async () => {
 const f = fixture(), provider = fakeProvider(); try {
  await configureAssistant(f.db, f.actors.owner, configInput(), secret);
  const preview = await prepareAssistantPlan(f.db, f.actors.inventory, request(), secret, { fetcher: provider.fetch });
  f.raceStockOnce(() => f.native.prepare("INSERT INTO stock_movements(id,item_id,delta,kind,note,ref_id,actor_id,created_at) VALUES('race','item-a',1,'receive','QA','race','owner-qa',?)").run(new Date().toISOString()));
  await assert.rejects(applyAssistantPlan(f.db, f.actors.inventory, confirm(preview), secret), code('assistant_stock_changed'));
  assert.equal(f.native.prepare('SELECT stock FROM items WHERE id=?').get('item-a').stock, 1); assert.equal(f.native.prepare('SELECT COUNT(*) n FROM stock_movements').get().n, 1); assert.equal(f.native.prepare("SELECT status FROM ai_plans WHERE id=?").get(preview.plan.id).status, 'ready');
 } finally { f.native.close(); }
});
test('each daily ceiling independently refuses a request before provider transport', async () => {
 for (const ceiling of [{ dailyUsdMicros: 1000 }, { dailyTokens: 1000 }, { dailyMs: 1000 }]) {
  const f = fixture(), provider = fakeProvider(); try { await configureAssistant(f.db, f.actors.owner, configInput(ceiling), secret); await assert.rejects(prepareAssistantPlan(f.db, f.actors.inventory, request(), secret, { fetcher: provider.fetch }), code('assistant_quota')); assert.equal(provider.calls, 0); assert.equal(f.native.prepare('SELECT COUNT(*) n FROM ai_calls').get().n, 0); assert.equal(f.native.prepare('SELECT calls FROM ai_organization_usage').get().calls, 0); } finally { f.native.close(); }
 }
});
test('revocation during provider response prevents any plan; disabling config invalidates issued plans', async () => {
 const f = fixture(), provider = fakeProvider(); try {
  await configureAssistant(f.db, f.actors.owner, configInput(), secret);
  await assert.rejects(prepareAssistantPlan(f.db, f.actors.inventory, request(), secret, { fetcher: async (...args) => { const response = await provider.fetch(...args); f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='inventory-qa'").run(new Date().toISOString()); return response; } }), code('forbidden'));
  assert.equal(f.native.prepare('SELECT COUNT(*) n FROM ai_plans').get().n, 0);
  const preview = await prepareAssistantPlan(f.db, f.actors.manager, request({ operationKey: 'test-only-manager-plan' }), secret, { fetcher: provider.fetch });
  await configureAssistant(f.db, f.actors.owner, configInput({ enabled: false }, { expectedRevision: 1 }), secret);
  await assert.rejects(applyAssistantPlan(f.db, f.actors.manager, confirm(preview), secret), code('assistant_unavailable'));
  assert.equal(f.native.prepare('SELECT COUNT(*) n FROM stock_movements').get().n, 0);
 } finally { f.native.close(); }
});
test('read-only stock queries and operational records use scoped normal services', async () => {
 const f = fixture(); try {
  await configureAssistant(f.db, f.actors.owner, configInput(), secret);
  const query = fakeProvider({ proposal: { intent: 'stock.query', quantity: 0 } });
  const preview = await prepareAssistantPlan(f.db, f.actors.manager, request(), secret, { fetcher: query.fetch });
  const result = await applyAssistantPlan(f.db, f.actors.manager, confirm(preview), secret); assert.equal(result.queried, true); assert.equal(result.item.project_id, 'project-a'); assert.equal(f.native.prepare('SELECT COUNT(*) n FROM stock_movements').get().n, 0);
  const note = 'Registrar ocorrência: montagem concluída.', record = fakeProvider({ proposal: { intent: 'record.create', itemId: null, quantity: 0, title: 'Montagem da oficina', body: 'Montagem concluída.', evidence: [{ source: 'request', quote: 'montagem concluída' }] } });
  const second = await prepareAssistantPlan(f.db, f.actors.manager, request({ request: note, operationKey: 'test-only-record-call' }), secret, { fetcher: record.fetch });
  const saved = await applyAssistantPlan(f.db, f.actors.manager, confirm(second), secret); assert.ok(saved.recordId); assert.equal(f.native.prepare('SELECT project_id FROM records WHERE id=?').get(saved.recordId).project_id, 'project-a');
  assert.equal((await applyAssistantPlan(f.db, f.actors.manager, confirm(second), secret)).replayed, true); assert.equal(f.native.prepare('SELECT COUNT(*) n FROM records').get().n, 1);
 } finally { f.native.close(); }
});
test('Jev is optional typed confirmation; low confidence blocks the proposal and version is pinned', async () => {
 const f = fixture(), provider = fakeProvider({ decision: { confidence: 0.4 } }); try {
  await configureAssistant(f.db, f.actors.owner, configInput({ jevEnabled: true }, { typesafeKey: key }), secret);
  await assert.rejects(prepareAssistantPlan(f.db, f.actors.inventory, request(), secret, { fetcher: provider.fetch }), code('assistant_needs_review'));
  assert.equal(provider.calls, 2); assert.equal(f.native.prepare('SELECT COUNT(*) n FROM ai_plans').get().n, 0);
  const good = fakeProvider(), preview = await prepareAssistantPlan(f.db, f.actors.inventory, request({ operationKey: 'test-only-good-jev' }), secret, { fetcher: good.fetch });
  assert.equal(preview.plan.provenance.jevModel, 'jev-1.14.0'); assert.equal(good.calls, 2);
 } finally { f.native.close(); }
});
test('normal domain idempotency recovers a crash after movement without duplicating physical effects', async () => {
 const f = fixture(), provider = fakeProvider(); try {
  await configureAssistant(f.db, f.actors.owner, configInput(), secret); const preview = await prepareAssistantPlan(f.db, f.actors.inventory, request(), secret, { fetcher: provider.fetch });
  f.failReceiptOnce(); await assert.rejects(applyAssistantPlan(f.db, f.actors.inventory, confirm(preview), secret), /synthetic_receipt_failure/);
  const recovered = await applyAssistantPlan(f.db, f.actors.inventory, confirm(preview), secret); assert.ok(recovered.movementId); assert.equal(f.native.prepare('SELECT COUNT(*) n FROM stock_movements').get().n, 1); assert.equal(f.native.prepare('SELECT stock FROM items WHERE id=?').get('item-a').stock, 10);
 } finally { f.native.close(); }
});
test('strict schema rejects invented fields, foreign IDs, quantities and fabricated provenance', () => {
 const items = [{ id: 'item-a' }], text = request().request;
 for (const candidate of [proposal({ sql: 'SELECT 1' }), proposal({ itemId: 'item-b' }), proposal({ quantity: 999 }), proposal({ evidence: [{ source: 'request', quote: 'not in the actual request' }] }), proposal({ evidence: [{ source: 'https://evil.test/', quote: 'entrada de 10 canetas' }] })]) assert.throws(() => validateProposal(candidate, text, items));
});
test('AI secrets and internal state cannot enter portal snapshot, MCP/Sheets pages or Drive attachment manifest', async () => {
 const f = fixture(); try {
  await saveVault(f); const ciphertext = f.native.prepare('SELECT credentials_ciphertext FROM ai_organization_settings').get().credentials_ciphertext;
  assert.match(ciphertext, /^v2\./);
  const schemas = describePortableSchemas(), snapshot = await portalSnapshot(f.db, f.actors.owner), status = await syncStatus(f.db, f.actors.owner), attachments = await listSyncAttachments(f.db, f.actors.owner);
  for (const table of ['ai_settings', 'ai_plans', 'ai_calls', 'ai_daily_usage', 'ai_organization_settings', 'ai_configuration_grants', 'ai_organization_usage', 'ai_transcriptions', 'ai_provider_credential_metadata']) { assert.equal(schemas.tables.some(row => row.table === table), false); await assert.rejects(exportPortablePage(f.db, f.actors.owner, { table })); }
  const pages = []; for (const schema of schemas.tables) pages.push(await exportPortablePage(f.db, f.actors.owner, { table: schema.table }));
  const exposed = JSON.stringify({ snapshot, status, attachments, pages }); for (const forbidden of [key, keys.current, ciphertext, 'credentials_ciphertext', 'config_json', 'ai_settings']) assert.equal(exposed.includes(forbidden), false, forbidden);
 } finally { f.native.close(); }
});
test('browser dictation requires consent, stages final text only, and ignores events after cancellation', () => {
 let constructed = 0, instance, draft = '', listening = false;
 class FakeSpeech { static instances = []; constructor() { constructed++; FakeSpeech.instances.push(this); } start() {} stop() { this.onend(); } abort() {} }
 const options = { consent: false, onText: text => { draft += text; }, onState: value => { listening = value; }, onError: () => assert.fail('unexpected speech error') };
 assert.throws(() => startReviewedDictation(FakeSpeech, options)); assert.equal(constructed, 0);
 assert.throws(() => startReviewedDictation(undefined, { ...options, consent: true }));
 const session = startReviewedDictation(FakeSpeech, { ...options, consent: true }); instance = FakeSpeech.instances.at(-1); assert.equal(listening, true); assert.equal(instance.lang, 'pt-BR');
 instance.onresult({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: 'unconfirmed speech' } }] }); assert.equal(draft, '');
 instance.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'entrada de 10 canetas' } }] }); assert.equal(draft, 'entrada de 10 canetas ');
 session.abort(); assert.equal(listening, false); instance.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'late ignored text' } }] }); assert.equal(draft, 'entrada de 10 canetas ');
});

function organizationActor(f, userId, role, organizationId='org_proex') {
 const at=new Date().toISOString(),email=`${userId}@example.test`;f.native.prepare("INSERT INTO portal_users(user_id,email,status,created_at,updated_at) VALUES(?,?,'active',?,?)").run(userId,email,at,at);f.native.prepare('INSERT INTO members(id,user_id,email,role,project_id,organization_id,created_at) VALUES(?,?,?,?,NULL,?,?)').run(userId,userId,email,role,organizationId,at);return{userId,email,displayName:userId,members:[],capabilities:[]};
}
test('organization TI delegation is explicit, owner-controlled, revocable and never expands stock permissions',async()=>{
 const f=fixture();try{
  const ti=organizationActor(f,'synthetic-ti','viewer'),localOwner=organizationActor(f,'local-owner','owner');
  await configureAssistant(f.db,localOwner,configInput(),secret);
  await assert.rejects(configureAssistant(f.db,ti,configInput({}, {expectedRevision:1}),secret),code('assistant_configuration_forbidden'));
  await manageAssistantGrant(f.db,localOwner,{action:'grant.create',organizationId:'org_proex',userId:ti.userId});
  const status=await assistantStatus(f.db,ti,secret,'org_proex');assert.equal(status.canConfigure,true);assert.equal(status.canDelegate,false);assert.equal(status.grants,undefined);assert.equal(JSON.stringify(status).includes(key),false);
  await configureAssistant(f.db,ti,configInput({}, {expectedRevision:1}),secret);
  await assert.rejects(configureAssistant(f.db,ti,configInput({}, {organizationId:'unit-synthetic',expectedRevision:0}),secret),code('assistant_configuration_forbidden'));
  await assert.rejects(prepareAssistantPlan(f.db,ti,request(),secret,{fetcher:fakeProvider().fetch}),code('forbidden'));
  await assert.rejects(manageAssistantGrant(f.db,ti,{action:'grant.create',organizationId:'org_proex',userId:localOwner.userId}),code('assistant_configuration_forbidden'));
  const grant=f.native.prepare('SELECT id FROM ai_configuration_grants WHERE user_id=?').get(ti.userId);await manageAssistantGrant(f.db,localOwner,{action:'grant.revoke',organizationId:'org_proex',grantId:grant.id});
  await assert.rejects(configureAssistant(f.db,ti,configInput({}, {expectedRevision:2}),secret),code('assistant_configuration_forbidden'));
 }finally{f.native.close();}
});
test('revoking an issuer or grant between validation and config transaction fails without saving credentials',async()=>{
 const f=fixture();try{
  const ti=organizationActor(f,'technical-delegate','viewer'),issuer=organizationActor(f,'grant-issuer','owner');await configureAssistant(f.db,issuer,configInput(),secret);await manageAssistantGrant(f.db,issuer,{action:'grant.create',organizationId:'org_proex',userId:ti.userId});
  f.raceBatch(/UPDATE ai_organization_settings/,()=>f.native.prepare('UPDATE ai_configuration_grants SET revoked_at=? WHERE user_id=?').run(new Date().toISOString(),ti.userId));
  await assert.rejects(configureAssistant(f.db,ti,configInput({}, {expectedRevision:1}),secret),code('assistant_configuration_forbidden'));assert.equal(f.native.prepare('SELECT revision FROM ai_organization_settings').get().revision,1);
  await manageAssistantGrant(f.db,issuer,{action:'grant.create',organizationId:'org_proex',userId:ti.userId});f.native.prepare('UPDATE members SET revoked_at=? WHERE id=?').run(new Date().toISOString(),issuer.userId);
  await assert.rejects(configureAssistant(f.db,ti,configInput({}, {expectedRevision:1}),secret),code('assistant_configuration_forbidden'));
 }finally{f.native.close();}
});
function wav(seconds=1){const samples=new Float32Array(Math.floor(seconds*16000));for(let i=0;i<samples.length;i++)samples[i]=.1*Math.sin(i*.1);return encodeSpeechWav({duration:seconds,length:samples.length,sampleRate:16000,numberOfChannels:1,getChannelData:()=>samples});}
const speechInput=(bytes=wav(),extra={})=>({projectId:'project-a',operationKey:'test-only-transcription-call',consent:true,mime:'audio/wav',bytes,...extra});
function fakeSpeechProvider(){let calls=0;return{get calls(){return calls;},fetch:async(url,init)=>{calls++;assert.equal(url,SPEECH_ENDPOINT);assert.equal(init.redirect,'error');assert.match(init.headers.Authorization,/^Token test-only/);assert.equal(init.headers['Content-Type'],'audio/wav');const duration=validateSpeechAudio(new Uint8Array(init.body),'audio/wav').duration;return Response.json({metadata:{duration,model_info:{'synthetic-model':{arch:'nova-3',name:'3-general-nova',version:'2026-05-13.synthetic'}}},results:{channels:[{alternatives:[{transcript:'Registrar entrada de 10 canetas.'}]}]}});}};}
test('STT accepts real bounded PCM bytes, uses official HTTP adapter and encrypts transcript recovery without storing audio',async()=>{
 const f=fixture(),provider=fakeSpeechProvider();try{
  await configureAssistant(f.db,f.actors.owner,configInput({sttEnabled:true},{deepgramKey:key}),secret);const result=await transcribeSpeech(f.db,f.actors.inventory,speechInput(),secret,{fetcher:provider.fetch});assert.equal(result.transcript,'Registrar entrada de 10 canetas.');assert.equal(result.provenance.duration,1);assert.equal(result.provenance.organizationId,'org_proex');
  const stored=f.native.prepare('SELECT * FROM ai_transcriptions').get();assert.equal(JSON.stringify(stored).includes('Registrar entrada'),false);assert.equal(JSON.stringify(stored).includes(key),false);assert.equal(stored.status,'complete');
  const replay=await transcribeSpeech(f.db,f.actors.inventory,speechInput(),secret,{fetcher:provider.fetch});assert.equal(replay.replayed,true);assert.equal(provider.calls,1);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM stock_movements').get().n,0);
  const ciphertext=f.native.prepare('SELECT credentials_ciphertext FROM ai_organization_settings').get().credentials_ciphertext;await assert.rejects(decryptCredentials(secret,ciphertext,'unit-synthetic'),code('assistant_credentials_unavailable'));
 }finally{f.native.close();}
});
test('Groq is scoped to its explicit organization and uses reviewed multipart speech with the same durable reservation',async()=>{
 const f=fixture(),deepgram=fakeSpeechProvider(),groqKey='test-only-groq-transcription-credential';
 const environment={provider:'groq',organizationId:'org_proex',groqKey};
 let calls=0;
 const fetcher=async(url,init)=>{
  calls++;
  assert.equal(url,'https://api.groq.com/openai/v1/audio/transcriptions');
  assert.equal(init.method,'POST');
  assert.equal(init.redirect,'error');
  assert.equal(init.cache,'no-store');
  assert.deepEqual(init.headers,{Authorization:'Bearer '+groqKey});
  assert.ok(init.signal);
  assert.deepEqual([...init.body.keys()],['file','model','language','response_format']);
  assert.equal(init.body.get('model'),'whisper-large-v3-turbo');
  assert.equal(init.body.get('language'),'pt');
  assert.equal(init.body.get('response_format'),'json');
  const audio=init.body.get('file');
  assert.equal(audio.name,'audio.wav');
  assert.equal(validateSpeechAudio(new Uint8Array(await audio.arrayBuffer()),audio.type).duration,1);
  return Response.json({text:'Transcrição de teste.',x_groq:{id:'provider-private-id'}});
 };
 try{
  await configureAssistant(f.db,f.actors.owner,configInput({sttEnabled:true},{deepgramKey:key}),secret,environment);
  const at=new Date().toISOString();
  f.native.prepare("INSERT INTO projects(id,name,organization_id,created_at) VALUES('project-c','Projeto C','unit-synthetic',?)").run(at);
  await configureAssistant(f.db,f.actors.owner,configInput({sttEnabled:true},{organizationId:'unit-synthetic',deepgramKey:key}),secret,environment);
  const status=await assistantStatus(f.db,f.actors.owner,secret,'org_proex',environment);
  assert.equal(status.organizations.find(org=>org.id==='org_proex').sttProvider,'groq');
  assert.equal(status.organizations.find(org=>org.id==='unit-synthetic').sttProvider,'deepgram');
  assert.equal(JSON.stringify(status).includes(groqKey),false);
  const input=speechInput(wav(),{expectedProvider:'groq'});
  await assert.rejects(transcribeSpeech(f.db,f.actors.inventory,speechInput(),secret,{environment,fetcher}),code('speech_provider_changed'));
  await assert.rejects(transcribeSpeech(f.db,f.actors.inventory,{...input,consent:false},secret,{environment,fetcher}),code('speech_consent'));
  await assert.rejects(transcribeSpeech(f.db,f.actors.inventory,input,secret,{environment:{...environment,groqKey:undefined},fetcher}),code('assistant_unavailable'));
  assert.equal(calls,0);
  const result=await transcribeSpeech(f.db,f.actors.inventory,input,secret,{environment,fetcher});
  assert.equal(result.transcript,'Transcrição de teste.');
  assert.equal(result.provenance.provider,'groq');
  assert.equal(result.provenance.model,'whisper-large-v3-turbo');
  assert.equal(result.provenance.returnedVersion,null);
  assert.equal(JSON.stringify(result).includes('provider-private-id'),false);
  const replay=await transcribeSpeech(f.db,f.actors.inventory,input,secret,{environment,fetcher});
  assert.equal(replay.replayed,true);
  await assert.rejects(transcribeSpeech(f.db,f.actors.inventory,speechInput(),secret,{fetcher:deepgram.fetch}),code('speech_operation_changed'));
  const usage=f.native.prepare("SELECT calls,reserved_usd_micros FROM ai_organization_usage WHERE organization_id='org_proex'").get();
  assert.equal(usage.calls,1);
  assert.equal(usage.reserved_usd_micros,112);
  assert.equal(calls,1);
  assert.equal(deepgram.calls,0);
  await transcribeSpeech(f.db,f.actors.owner,speechInput(wav(),{projectId:'project-c'}),secret,{environment,fetcher:deepgram.fetch});
  assert.equal(deepgram.calls,1);
 }finally{f.native.close();}
});

test('Groq malformed output and reflected key are withheld without fallback or repeated transport',async()=>{
 const environment={provider:'groq',organizationId:'org_proex',groqKey:'test-only-groq-transcription-credential'};
 for(const response of [{text:' '},{text:environment.groqKey}]){
  const f=fixture();
  let calls=0;
  const fetcher=async()=>{calls++;return Response.json(response);};
  try{
   await configureAssistant(f.db,f.actors.owner,configInput({sttEnabled:true}),secret,environment);
   const input=speechInput(wav(),{expectedProvider:'groq'});
   await assert.rejects(transcribeSpeech(f.db,f.actors.manager,input,secret,{environment,fetcher}),code('speech_schema'));
   await assert.rejects(transcribeSpeech(f.db,f.actors.manager,input,secret,{environment,fetcher}),code('speech_replay'));
   const stored=f.native.prepare('SELECT status,result_ciphertext FROM ai_transcriptions').get();
   assert.equal(stored.status,'failed');
   assert.equal(stored.result_ciphertext,null);
   assert.equal(f.native.prepare('SELECT calls FROM ai_organization_usage').get().calls,1);
   assert.equal(calls,1);
  }finally{f.native.close();}
 }
});

test('STT rejects mismatched MIME, corrupt headers, silence, excessive duration/size and SSRF before provider cost',async()=>{
 const f=fixture(),provider=fakeSpeechProvider();try{
  await configureAssistant(f.db,f.actors.owner,configInput({sttEnabled:true},{deepgramKey:key}),secret);
  const broken=wav();broken[36]=0;
  const silent=wav();silent.fill(0,44);
  for(const input of [speechInput(wav(),{mime:'image/png'}),speechInput(broken),speechInput(silent),speechInput(new Uint8Array(4*1024*1024+1)),speechInput(wav(),{consent:false})])await assert.rejects(transcribeSpeech(f.db,f.actors.inventory,input,secret,{fetcher:provider.fetch}));
  assert.throws(()=>encodeSpeechWav({duration:91,length:1,sampleRate:16000,numberOfChannels:1,getChannelData:()=>new Float32Array(1)}));
  for(const url of ['http://127.0.0.1/','https://api.deepgram.com.evil.test/v1/listen',SPEECH_ENDPOINT+'&callback=https://localhost'])assert.throws(()=>speechEndpoint(url),code('speech_endpoint'));
  assert.equal(provider.calls,0);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM ai_transcriptions').get().n,0);
 }finally{f.native.close();}
});
test('STT rechecks scope, revocation before admission, and revoked replay; abort retains quota without a second call',async()=>{
 const f=fixture(),provider=fakeSpeechProvider();try{
  await configureAssistant(f.db,f.actors.owner,configInput({sttEnabled:true},{deepgramKey:key}),secret);
  await assert.rejects(transcribeSpeech(f.db,f.actors.inventory,speechInput(wav(),{projectId:'project-b'}),secret,{fetcher:provider.fetch}));assert.equal(provider.calls,0);
  f.raceBatch(/INSERT INTO ai_transcriptions/,()=>f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='inventory-qa'").run(new Date().toISOString()));
  await assert.rejects(transcribeSpeech(f.db,f.actors.inventory,speechInput(),secret,{fetcher:provider.fetch}),code('speech_forbidden'));assert.equal(provider.calls,0);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM ai_transcriptions').get().n,0);
  const abort=new AbortController();const pending=transcribeSpeech(f.db,f.actors.manager,speechInput(),secret,{signal:abort.signal,fetcher:async(_url,init)=>new Promise((_resolve,reject)=>{init.signal.addEventListener('abort',()=>reject(new Error('synthetic abort')));abort.abort();})});await assert.rejects(pending,code('speech_provider'));assert.equal(f.native.prepare('SELECT status FROM ai_transcriptions').get().status,'failed');assert.equal(f.native.prepare('SELECT calls FROM ai_organization_usage').get().calls,1);
  await assert.rejects(transcribeSpeech(f.db,f.actors.manager,speechInput(),secret,{fetcher:provider.fetch}),code('speech_replay'));assert.equal(provider.calls,0);
 }finally{f.native.close();}
});
test('STT permission loss during response withholds transcript and quota is isolated by organization',async()=>{
 const f=fixture(),provider=fakeSpeechProvider();try{
  await configureAssistant(f.db,f.actors.owner,configInput({sttEnabled:true},{deepgramKey:key}),secret);
  await assert.rejects(transcribeSpeech(f.db,f.actors.inventory,speechInput(),secret,{fetcher:async(...args)=>{const response=await provider.fetch(...args);f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='inventory-qa'").run(new Date().toISOString());return response;}}));assert.equal(f.native.prepare('SELECT result_ciphertext FROM ai_transcriptions').get().result_ciphertext,null);
  const blocked=new AbortController();blocked.abort();await assert.rejects(transcribeSpeech(f.db,f.actors.manager,speechInput(wav(),{operationKey:'test-only-aborted-before'}),secret,{signal:blocked.signal,fetcher:provider.fetch}),code('speech_aborted'));assert.equal(provider.calls,1);
  const at=new Date().toISOString();f.native.prepare("INSERT INTO projects(id,name,organization_id,created_at) VALUES('project-c','Projeto C','unit-synthetic',?)").run(at);await configureAssistant(f.db,f.actors.owner,configInput({sttEnabled:true},{organizationId:'unit-synthetic',deepgramKey:key}),secret);await transcribeSpeech(f.db,f.actors.owner,speechInput(wav(),{projectId:'project-c'}),secret,{fetcher:provider.fetch});assert.equal(f.native.prepare('SELECT COUNT(*) n FROM ai_organization_usage WHERE calls=1').get().n,2);
 }finally{f.native.close();}
});
test('browser WAV conversion preserves enforced duration and canonical PCM without remote conversion',async()=>{
 const bytes=wav(),file=new File([bytes],'synthetic.wav',{type:'audio/wav'}),converted=await prepareSpeechWav(file,()=>assert.fail('canonical WAV needs no decoder'));assert.equal(converted.type,'audio/wav');assert.equal(validateSpeechAudio(new Uint8Array(await converted.arrayBuffer()),converted.type).duration,1);
 await assert.rejects(prepareSpeechWav(new File([bytes],'not-audio.svg',{type:'image/svg+xml'})));
});

function freezeInitialMisses(f,pattern){const original=f.db.prepare.bind(f.db);let reads=0,release;const barrier=new Promise(resolve=>{release=resolve;});f.db.prepare=sql=>{const statement=original(sql);if(!pattern.test(sql))return statement;return{...statement,bind(...values){statement.bind(...values);return this;},async first(){const result=await statement.first();if(++reads<=2){if(reads===2)release();await barrier;}return result;}};};}
test('concurrent identical paid prepares own one admission even when the second insert is refused at the daily ceiling',async()=>{
 for(const dailyCalls of [1,2]){const f=fixture(),provider=fakeProvider();try{await configureAssistant(f.db,f.actors.owner,configInput({dailyCalls}),secret);freezeInitialMisses(f,/SELECT fingerprint,status,plan_id FROM ai_calls/);const results=await Promise.allSettled([prepareAssistantPlan(f.db,f.actors.inventory,request(),secret,{fetcher:provider.fetch}),prepareAssistantPlan(f.db,f.actors.inventory,request(),secret,{fetcher:provider.fetch})]);assert.ok(results.some(result=>result.status==='fulfilled'));assert.equal(provider.calls,1);assert.equal(f.native.prepare('SELECT calls FROM ai_organization_usage').get().calls,1);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM ai_calls').get().n,1);for(const result of results)if(result.status==='rejected')assert.equal(result.reason.code,'assistant_call_replay');}finally{f.native.close();}}
});
test('concurrent identical speech requests cannot reuse another reservation nonce or exceed dailyCalls=1',async()=>{
 for(const dailyCalls of [1,2]){const f=fixture(),provider=fakeSpeechProvider();try{await configureAssistant(f.db,f.actors.owner,configInput({dailyCalls,sttEnabled:true},{deepgramKey:key}),secret);freezeInitialMisses(f,/SELECT \* FROM ai_transcriptions WHERE id=/);const results=await Promise.allSettled([transcribeSpeech(f.db,f.actors.inventory,speechInput(),secret,{fetcher:provider.fetch}),transcribeSpeech(f.db,f.actors.inventory,speechInput(),secret,{fetcher:provider.fetch})]);assert.ok(results.some(result=>result.status==='fulfilled'));assert.equal(provider.calls,1);assert.equal(f.native.prepare('SELECT calls FROM ai_organization_usage').get().calls,1);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM ai_transcriptions').get().n,1);for(const result of results)if(result.status==='rejected')assert.equal(result.reason.code,'speech_replay');}finally{f.native.close();}}
});

test('final plan persistence checks revocation and configuration atomically before exposing its snapshot',async()=>{
 for(const change of ['revoked','configuration']){const f=fixture(),provider=fakeProvider();try{await configureAssistant(f.db,f.actors.owner,configInput(),secret);f.raceBatch(/INSERT INTO ai_plans/,()=>{if(change==='revoked')f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='inventory-qa'").run(new Date().toISOString());else f.native.prepare("UPDATE ai_organization_settings SET revision=revision+1,config_json=json_set(config_json,'$.enabled',0)").run();});await assert.rejects(prepareAssistantPlan(f.db,f.actors.inventory,request(),secret,{fetcher:provider.fetch}),code('assistant_forbidden'));assert.equal(provider.calls,1);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM ai_plans').get().n,0);assert.equal(f.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='assistant.plan'").get().n,0);assert.equal(f.native.prepare('SELECT status FROM ai_calls').get().status,'failed');}finally{f.native.close();}}
});

test('expired transcription recovery erases its ciphertext on next organization use and never repeats a paid call',async()=>{
 const f=fixture(),provider=fakeSpeechProvider();try{await configureAssistant(f.db,f.actors.owner,configInput({sttEnabled:true},{deepgramKey:key}),secret);const now=Date.now();await transcribeSpeech(f.db,f.actors.inventory,speechInput(),secret,{fetcher:provider.fetch,now});assert.ok(f.native.prepare('SELECT result_ciphertext FROM ai_transcriptions').get().result_ciphertext);await assert.rejects(transcribeSpeech(f.db,f.actors.inventory,speechInput(),secret,{fetcher:provider.fetch,now:now+3600001}),code('speech_replay'));assert.equal(f.native.prepare('SELECT result_ciphertext FROM ai_transcriptions').get().result_ciphertext,null);assert.equal(provider.calls,1);}finally{f.native.close();}
});


test('every operational provider dispatch rechecks live SQL after awaited settings decryption',async()=>{
 for(const dispatch of [1,2])for(const mode of ['revoke','revision']){const f=fixture();try{await configureAssistant(f.db,f.actors.owner,configInput({jevEnabled:dispatch===2},{...(dispatch===2?{typesafeKey:'test-only-typesafe-provider-credential'}:{})}),secret);const original=f.db.prepare.bind(f.db);let reads=0;f.db.prepare=sql=>{const statement=original(sql),first=statement.first.bind(statement);statement.first=async(...args)=>{const row=await first(...args);if(/^SELECT s\.\*/.test(sql)&&++reads===(dispatch===2?3:2)){if(mode==='revoke')f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='manager-qa'").run(new Date().toISOString());else f.native.prepare('UPDATE ai_organization_settings SET revision=revision+1').run();}return row;};return statement;};const p=fakeProvider();await assert.rejects(prepareAssistantPlan(f.db,f.actors.manager,request({operationKey:crypto.randomUUID()}),secret,{fetcher:p.fetch}),error=>['assistant_forbidden','assistant_usage_forbidden','forbidden'].includes(error.code));assert.equal(p.calls,dispatch-1);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM ai_plans').get().n,0);}finally{f.native.close();}}
});

function onSettingsRead(f,number,change){const original=f.db.prepare.bind(f.db);let reads=0;f.db.prepare=sql=>{const statement=original(sql),first=statement.first.bind(statement);statement.first=async(...args)=>{const row=await first(...args);if(/^SELECT s\.\*/.test(sql)&&++reads===number)change();return row;};return statement;};}
const revokeManager=f=>f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='manager-qa'").run(new Date().toISOString());
test('speech dispatch revalidates after credential decryption and observes an abort during its final SQL fence',async()=>{
 for(const change of ['revoke','revision','abort']){const f=fixture(),provider=fakeSpeechProvider(),controller=new AbortController();try{await configureAssistant(f.db,f.actors.owner,configInput({sttEnabled:true},{deepgramKey:key}),secret);onSettingsRead(f,2,()=>{if(change==='revoke')revokeManager(f);else if(change==='revision')f.native.prepare('UPDATE ai_organization_settings SET revision=revision+1').run();else controller.abort();});await assert.rejects(transcribeSpeech(f.db,f.actors.manager,speechInput(),secret,{fetcher:provider.fetch,signal:controller.signal}),error=>['speech_forbidden','assistant_usage_forbidden','speech_aborted'].includes(error.code));assert.equal(provider.calls,0);assert.equal(f.native.prepare('SELECT status FROM ai_transcriptions').get().status,'failed');}finally{f.native.close();}}
});
test('speech replay withholds decrypted transcript if authorization or configuration changes during decrypt',async()=>{
 for(const change of ['revoke','revision']){const f=fixture(),provider=fakeSpeechProvider(),decrypt=crypto.subtle.decrypt;try{await configureAssistant(f.db,f.actors.owner,configInput({sttEnabled:true},{deepgramKey:key}),secret);await transcribeSpeech(f.db,f.actors.manager,speechInput(),secret,{fetcher:provider.fetch});crypto.subtle.decrypt=async function(...args){const result=await decrypt.apply(this,args);if(new TextDecoder().decode(args[0].additionalData).startsWith('ai_settings:speech:')){if(change==='revoke')revokeManager(f);else f.native.prepare('UPDATE ai_organization_settings SET revision=revision+1').run();}return result;};await assert.rejects(transcribeSpeech(f.db,f.actors.manager,speechInput(),secret,{fetcher:provider.fetch}),code('speech_forbidden'));assert.equal(provider.calls,1);assert.equal(f.native.prepare('SELECT status FROM ai_transcriptions').get().status,'complete');}finally{crypto.subtle.decrypt=decrypt;f.native.close();}}
});
test('plan signing prepares the response before its final configuration and live authority check, including replay',async()=>{
 for(const replay of [false,true]){const f=fixture(),provider=fakeProvider(),sign=crypto.subtle.sign;try{await configureAssistant(f.db,f.actors.owner,configInput(),secret);if(replay)await prepareAssistantPlan(f.db,f.actors.manager,request(),secret,{fetcher:provider.fetch});crypto.subtle.sign=async function(...args){const result=await sign.apply(this,args);if(new TextDecoder().decode(args[2]).startsWith('proex.assistant.plan/v2:'))f.native.prepare('UPDATE ai_organization_settings SET revision=revision+1').run();return result;};await assert.rejects(prepareAssistantPlan(f.db,f.actors.manager,request(),secret,{fetcher:provider.fetch}),code('assistant_forbidden'));assert.equal(provider.calls,1);}finally{crypto.subtle.sign=sign;f.native.close();}}
});
test('query apply is fenced in its receipt transaction and applied replay is fenced after settings decryption',async()=>{
 for(const replay of [false,true])for(const change of ['revoke','revision']){const f=fixture(),provider=fakeProvider({proposal:{intent:'stock.query',quantity:0}});try{await configureAssistant(f.db,f.actors.owner,configInput(),secret);const preview=await prepareAssistantPlan(f.db,f.actors.manager,request(),secret,{fetcher:provider.fetch});const changeNow=()=>{if(change==='revoke')revokeManager(f);else f.native.prepare('UPDATE ai_organization_settings SET revision=revision+1').run();};if(replay){await applyAssistantPlan(f.db,f.actors.manager,confirm(preview),secret);onSettingsRead(f,1,changeNow);}else f.raceBatch(/UPDATE ai_plans SET status='applied'/,changeNow);await assert.rejects(applyAssistantPlan(f.db,f.actors.manager,confirm(preview),secret),error=>['assistant_forbidden','assistant_usage_forbidden'].includes(error.code));assert.equal(f.native.prepare('SELECT status FROM ai_plans').get().status,replay?'applied':'ready');assert.equal(f.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='assistant.apply'").get().n,replay?1:0);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM stock_movements').get().n,0);}finally{f.native.close();}}
});
test('authorization loss after a committed physical movement keeps that movement and safe idempotent recovery',async()=>{
 const f=fixture(),provider=fakeProvider();try{await configureAssistant(f.db,f.actors.owner,configInput(),secret);const preview=await prepareAssistantPlan(f.db,f.actors.manager,request(),secret,{fetcher:provider.fetch});f.raceBatch(/UPDATE ai_plans SET status='applied'/,()=>revokeManager(f));await assert.rejects(applyAssistantPlan(f.db,f.actors.manager,confirm(preview),secret),code('assistant_forbidden'));assert.equal(f.native.prepare('SELECT stock FROM items WHERE id=?').get('item-a').stock,10);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM stock_movements').get().n,1);assert.equal(f.native.prepare('SELECT status FROM ai_plans').get().status,'ready');f.native.prepare("UPDATE members SET revoked_at=NULL WHERE user_id='manager-qa'").run();await applyAssistantPlan(f.db,f.actors.manager,confirm(preview),secret);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM stock_movements').get().n,1);assert.equal(f.native.prepare('SELECT status FROM ai_plans').get().status,'applied');}finally{f.native.close();}
});
