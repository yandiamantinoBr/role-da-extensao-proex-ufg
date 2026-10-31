import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,readdirSync} from 'node:fs';import {DatabaseSync} from 'node:sqlite';import {fileURLToPath} from 'node:url';import path from 'node:path';import ts from 'typescript';
const root=fileURLToPath(new URL('../',import.meta.url)),cache=new Map();
function compile(name){if(cache.has(name))return cache.get(name);if(name.endsWith('.json'))return'data:text/javascript;base64,'+Buffer.from('export default '+readFileSync(root+'lib/'+name,'utf8')).toString('base64');let source=ts.transpileModule(readFileSync(root+'lib/'+name+'.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;source=source.replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g,(_m,_q,dependency)=>`from ${JSON.stringify(compile(path.posix.normalize(path.posix.join(path.posix.dirname(name),dependency)).replace(/\.ts$/,'')))}`);const url='data:text/javascript;base64,'+Buffer.from(source+'\n//# sourceURL='+name+'-document-ai-test.mjs').toString('base64');cache.set(name,url);return url;}
const {DEFAULT_ASSISTANT_CONFIG}=await import(compile('assistant/contracts'));
const {configureAssistant,prepareAssistantPlan,applyAssistantPlan}=await import(compile('assistant/service'));
const {previewImport,applyImport}=await import(compile('importer/service'));
const {describePortableSchemas,exportPortablePage}=await import(compile('sync/portable'));
const secret='synthetic-document-ai-secret-with-no-production-access',key='synthetic-document-provider-credential';
function fixture(t){const native=new DatabaseSync(':memory:');native.exec('PRAGMA foreign_keys=ON');for(const file of readdirSync(root+'drizzle').filter(file=>file.endsWith('.sql')).sort())native.exec(readFileSync(root+'drizzle/'+file,'utf8'));t.after(()=>native.close());const now=new Date().toISOString();native.prepare("INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES('org-b','Org B','org-b',?,?)").run(now,now);native.prepare("INSERT INTO projects(id,name,organization_id,created_at) VALUES('project-a','Project A','org_proex',?),('project-b','Project B','org-b',?)").run(now,now);const actors={};for(const[role,project,org]of[['owner',null,null],['manager','project-a','org_proex'],['inventory','project-a','org_proex'],['viewer','project-a','org_proex']]){native.prepare("INSERT INTO portal_users(user_id,email,status,created_at,updated_at) VALUES(?,?,'active',?,?)").run(role,role+'@example.invalid',now,now);native.prepare('INSERT INTO members(id,user_id,email,role,project_id,organization_id,created_at) VALUES(?,?,?,?,?,?,?)').run('member-'+role,role,role+'@example.invalid',role,project,org,now);actors[role]={userId:role,email:role+'@example.invalid',displayName:role,members:[],capabilities:[]};}
 const db={before:null,freeze:null,prepare(sql){let values=[];return{sql,bind(...args){values=args;return this;},async first(){const row=native.prepare(sql).get(...values)??null;if(db.freeze&&/SELECT fingerprint,status,result_ciphertext/.test(sql))await db.freeze();return row;},async all(){return{results:native.prepare(sql).all(...values)};},async run(){return{meta:{changes:Number(native.prepare(sql).run(...values).changes)}};},execute(){const rows=native.prepare(sql).all(...values);return{results:rows,meta:{changes:Number(native.prepare('SELECT changes() n').get().n)}};}};},async batch(statements){if(db.before&&statements.some(statement=>db.before.pattern.test(statement.sql))){const hook=db.before;db.before=null;hook.callback();}native.exec('BEGIN');try{const result=statements.map(statement=>statement.execute());native.exec('COMMIT');return result;}catch(error){native.exec('ROLLBACK');throw error;}}};
 return{native,db,actors,now,async configure(extra={}){return configureAssistant(db,actors.owner,{action:'configure',organizationId:'org_proex',expectedRevision:0,config:{...DEFAULT_ASSISTANT_CONFIG,enabled:true,documentEnabled:true,...extra},deepseekKey:key,...(extra.jevEnabled?{typesafeKey:'synthetic-typesafe-key-credential'}:{})},secret);}};
}
const content='O cadastro se chama Jardim universitário. Sua área informada é Comunicação. A execução começa em 31/10/2026. Não há data final informada.';
const proposals=()=>({fields:[{key:'name',value:'Jardim universitário',quote:'O cadastro se chama Jardim universitário.'},{key:'thematicArea',value:'Comunicação',quote:'Sua área informada é Comunicação.'},{key:'startsAt',value:'31/10/2026',quote:'A execução começa em 31/10/2026.'}]});
const input=(extra={})=>({kind:'project',organizationId:'org_proex',sourceMode:'document',format:'text',content,useAi:true,aiConsent:true,aiOperationKey:crypto.randomUUID(),...extra});
const confirm=(preview,extra={})=>({reviewToken:preview.reviewToken,candidateKey:'row-1',selectedFields:['name','thematicArea','startsAt'],confirmed:true,operationKey:crypto.randomUUID(),...extra});
function provider(value=proposals(),hook,decision={}){let calls=0;return{get calls(){return calls;},fetch:async(url,init)=>{calls++;assert.equal(init.redirect,'error');const request=JSON.parse(init.body);assert.ok(!JSON.stringify(request).includes(key));hook?.(request);if(String(url).includes('typesafe'))return Response.json({model:'jev-1.14.0',answers:{faithful:{type:'choice',choice:'supported',confidence:0.99,probabilities:{supported:0.99,review:0.01},...decision}},usage:{input_tokens:500}});return Response.json({model:'deepseek-flash',choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:500,completion_tokens:200}});}};}

function afterSettingsRead(f, at, callback) {
 let seen=0;const prepare=f.db.prepare;
 f.db.prepare=function(sql){const statement=prepare.call(this,sql);if(/SELECT s\.\* FROM ai_organization_settings/.test(sql)){const first=statement.first;statement.first=async function(){const row=await first.call(this);if(++seen===at)callback();return row;};}return statement;};
}
test('independent: revocation while reloading settings before dispatch prevents every provider POST',async t=>{
 const f=fixture(t);await f.configure();const p=provider();
 afterSettingsRead(f,2,()=>f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='manager'").run(f.now));
 await assert.rejects(previewImport(f.db,f.actors.manager,input({projectId:'project-a'}),secret,p.fetch));
 assert.equal(p.calls,0,'no document may leave after permission was revoked during settings await');
});
test('independent: config rotation while reloading settings prevents dispatch of old credential',async t=>{
 const f=fixture(t);await f.configure();const p=provider();
 afterSettingsRead(f,2,()=>f.native.prepare('UPDATE ai_organization_settings SET revision=revision+1').run());
 await assert.rejects(previewImport(f.db,f.actors.owner,input(),secret,p.fetch));
 assert.equal(p.calls,0,'no POST may use a configuration invalidated while settings were loading');
});test('independent: serialized Jev request must fit its conservative reservation before paid dispatch',async t=>{
 const f=fixture(t);await f.configure({jevEnabled:true});const {ASSET_IMPORT_FIELDS}=await import(compile('importer/contracts'));
 const quote='配'.repeat(590),fields=ASSET_IMPORT_FIELDS.filter(field=>!['acquisitionDate','acquisitionValueCents'].includes(field.key)).map(field=>({key:field.key,value:'配',quote}));
 let calls=0,secondBytes=0,reservedSecondBytes=0;const base=provider({fields});
 const fetcher=async(url,init)=>{calls++;if(String(url).includes('typesafe')){secondBytes=Buffer.byteLength(init.body);const tokens=f.native.prepare('SELECT reserved_tokens FROM ai_organization_usage').get().reserved_tokens;reservedSecondBytes=(tokens-DEFAULT_ASSISTANT_CONFIG.maxOutputTokens+18000)/2;}return base.fetch(url,init);};
 const result=await Promise.allSettled([previewImport(f.db,f.actors.inventory,input({kind:'asset',projectId:'project-a',content:quote}),secret,fetcher)]);
 assert.ok(secondBytes<=reservedSecondBytes,`dispatched ${secondBytes} UTF-8 bytes under only ${reservedSecondBytes} reserved input tokens; result=${result[0].status}; calls=${calls}`);
});
test('independent: UTF-8 source and shared two-call budget are enforced before admission',async t=>{
 const f=fixture(t),p=provider();await f.configure({jevEnabled:true,dailyCalls:1});
 await assert.rejects(previewImport(f.db,f.actors.owner,input({content:'🧪'.repeat(4097)}),secret,p.fetch),{code:'document_ai_limit'});
 await assert.rejects(previewImport(f.db,f.actors.owner,input(),secret,p.fetch),{code:'document_ai_quota'});
 assert.equal(p.calls,0);assert.equal(f.native.prepare('SELECT calls FROM ai_organization_usage').get().calls,0);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM ai_document_calls').get().n,0);
});
test('independent: configuration delegation does not grant document or cross-organization access',async t=>{
 const f=fixture(t),p=provider();await f.configure();
 f.native.prepare("INSERT INTO ai_configuration_grants(id,organization_id,user_id,grantor_member_id,granted_by,created_at) VALUES('synthetic-ti','org_proex','viewer','member-owner','owner',?)").run(f.now);
 await assert.rejects(previewImport(f.db,f.actors.viewer,input({kind:'asset',projectId:'project-a'}),secret,p.fetch),{code:'forbidden'});
 await assert.rejects(previewImport(f.db,f.actors.inventory,input({kind:'asset',projectId:'project-b',organizationId:'org-b'}),secret,p.fetch),{code:'forbidden'});
 assert.equal(p.calls,0);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM ai_document_calls').get().n,0);
});
test('independent: prepended document guard preserves project CAS and original mutation receipts',async t=>{
 const f=fixture(t),p=provider();await f.configure();const preview=await previewImport(f.db,f.actors.manager,input({projectId:'project-a'}),secret,p.fetch);
 f.db.before={pattern:/UPDATE projects SET/,callback:()=>f.native.prepare("UPDATE projects SET version=version+1,name='Concurrent synthetic edit' WHERE id='project-a'").run()};
 await assert.rejects(applyImport(f.db,f.actors.manager,confirm(preview),secret),{code:'project_changed'});
 assert.equal(f.native.prepare("SELECT name FROM projects WHERE id='project-a'").get().name,'Concurrent synthetic edit');
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM records').get().n,0);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM mutation_keys').get().n,0);
});
test('independent: organization archival inside apply batch prevents project and receipt creation',async t=>{
 const f=fixture(t),p=provider();await f.configure();const preview=await previewImport(f.db,f.actors.owner,input(),secret,p.fetch);
 f.db.before={pattern:/INSERT INTO projects/,callback:()=>f.native.prepare("UPDATE organizations SET status='archived' WHERE id='org_proex'").run()};
 await assert.rejects(applyImport(f.db,f.actors.owner,confirm(preview),secret),{code:'document_ai_forbidden'});
 assert.equal(f.native.prepare('SELECT COUNT(*) n FROM projects').get().n,2);assert.equal(f.native.prepare('SELECT COUNT(*) n FROM records').get().n,0);
});
test('independent: encrypted literal suggestions are bound to the call; replay cannot swap ciphertext',async t=>{
 const f=fixture(t),p=provider();await f.configure();const first=input(),second=input();await previewImport(f.db,f.actors.owner,first,secret,p.fetch);await previewImport(f.db,f.actors.owner,second,secret,p.fetch);
 const rows=f.native.prepare('SELECT id,result_ciphertext FROM ai_document_calls ORDER BY rowid').all();assert.equal(rows.length,2);
 f.native.prepare('UPDATE ai_document_calls SET result_ciphertext=? WHERE id=?').run(rows[1].result_ciphertext,rows[0].id);
 await assert.rejects(previewImport(f.db,f.actors.owner,first,secret,p.fetch),{code:'assistant_credentials_unavailable'});assert.equal(p.calls,2);
});
test('independent: literal quotes do not become truth or numeric confidence; source contact is excluded from transport',async t=>{
 const f=fixture(t);await f.configure();const email='document-contact@example.invalid',cpf='123.456.789-00',p=provider(proposals(),body=>{const sent=JSON.stringify(body);assert.ok(!sent.includes(email));assert.ok(!sent.includes(cpf));});
 const preview=await previewImport(f.db,f.actors.owner,input({content:content+' Contato '+email+' CPF '+cpf}),secret,p.fetch);
 assert.equal(preview.candidates[0].evidence.name.confidence,null);assert.match(preview.candidates[0].warnings.join('\n'),/não comprova a veracidade/);
 const {portalSnapshot}=await import(compile('portal-data'));const {getActor}=await import(compile('access'));const owner=await getActor(f.db,f.actors.owner);const snapshots=[await portalSnapshot(f.db,owner)];for(const table of describePortableSchemas().tables)snapshots.push(await exportPortablePage(f.db,owner,{table:table.table}));
 const exposed=JSON.stringify(snapshots);for(const privateValue of [key,proposals().fields[0].quote,f.native.prepare('SELECT result_ciphertext FROM ai_document_calls').get().result_ciphertext])assert.ok(!exposed.includes(privateValue));
 assert.ok(!exposed.includes('ai_document_calls'));assert.ok(!describePortableSchemas().tables.some(table=>/ai_organization_settings|ai_document_calls/.test(table.table)));
});
test('independent: existing stock assistant must also fence after settings wait before generation',async t=>{
 const f=fixture(t);await f.configure();const request='Registre uma anotação.',p=provider({intent:'record.create',itemId:null,quantity:0,title:'Registro sintético',body:'Anotação sintética.',evidence:[{source:'request',quote:request}]});
 afterSettingsRead(f,2,()=>f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='manager'").run(f.now));
 await assert.rejects(prepareAssistantPlan(f.db,f.actors.manager,{action:'prepare',projectId:'project-a',request,operationKey:crypto.randomUUID(),consent:true},secret,{fetcher:p.fetch}));
 assert.equal(p.calls,0,'revocation during settings wait must block generation in the existing assistant too');
});
test('independent: existing speech upload must fence after settings wait before sending audio',async t=>{
 const f=fixture(t);await configureAssistant(f.db,f.actors.owner,{action:'configure',organizationId:'org_proex',expectedRevision:0,config:{...DEFAULT_ASSISTANT_CONFIG,enabled:true,sttEnabled:true},deepseekKey:key,deepgramKey:'synthetic-speech-credential-for-fixture'},secret);
 const bytes=Buffer.alloc(32044);bytes.write('RIFF',0);bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(16000,24);bytes.writeUInt32LE(32000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(32000,40);for(let offset=44;offset<bytes.length;offset+=2)bytes.writeInt16LE(500,offset);
 const {transcribeSpeech}=await import(compile('assistant/speech'));let calls=0;const fetcher=async()=>{calls++;return Response.json({});};
 afterSettingsRead(f,2,()=>f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='manager'").run(f.now));
 await assert.rejects(transcribeSpeech(f.db,f.actors.manager,{projectId:'project-a',operationKey:crypto.randomUUID(),consent:true,mime:'audio/wav',bytes},secret,{fetcher}));
 assert.equal(calls,0,'revocation during settings wait must block the audio upload too');
});
function syntheticWav(){const bytes=Buffer.alloc(32044);bytes.write('RIFF',0);bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(16000,24);bytes.writeUInt32LE(32000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(32000,40);for(let offset=44;offset<bytes.length;offset+=2)bytes.writeInt16LE(500,offset);return bytes;}
function afterSubtleOperation(t,name,matching,callback){const original=crypto.subtle[name];crypto.subtle[name]=async function(...args){const result=await original.apply(this,args);if(matching(...args))callback();return result;};t.after(()=>{crypto.subtle[name]=original;});}
async function queryPlan(f){await f.configure();f.native.prepare("INSERT INTO items(id,project_id,name,category,unit,created_at) VALUES('synthetic-item','project-a','Private synthetic item','consumption','unidade',?)").run(f.now);const request='Consulte o material.',p=provider({intent:'stock.query',itemId:'synthetic-item',quantity:0,title:'Consulta',body:'Consulta sintética.',evidence:[{source:'request',quote:request}]});return prepareAssistantPlan(f.db,f.actors.manager,{action:'prepare',projectId:'project-a',request,operationKey:crypto.randomUUID(),consent:true},secret,{fetcher:p.fetch});}
test('independent: speech replay revalidates after awaited decryption before revealing transcript',async t=>{
 const f=fixture(t);await configureAssistant(f.db,f.actors.owner,{action:'configure',organizationId:'org_proex',expectedRevision:0,config:{...DEFAULT_ASSISTANT_CONFIG,enabled:true,sttEnabled:true},deepseekKey:key,deepgramKey:'synthetic-speech-credential-for-fixture'},secret);
 const {transcribeSpeech}=await import(compile('assistant/speech'));const request={projectId:'project-a',operationKey:crypto.randomUUID(),consent:true,mime:'audio/wav',bytes:syntheticWav()};let calls=0;
 const fetcher=async()=>{calls++;return Response.json({metadata:{duration:1,model_info:{synthetic:{arch:'nova-3',version:'synthetic-v1'}}},results:{channels:[{alternatives:[{transcript:'Transcrição sintética privada.'}]}]}});};
 await transcribeSpeech(f.db,f.actors.manager,request,secret,{fetcher});
 afterSubtleOperation(t,'decrypt',algorithm=>new TextDecoder().decode(algorithm.additionalData).startsWith('ai_settings:speech:'),()=>f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='manager'").run(f.now));
 await assert.rejects(transcribeSpeech(f.db,f.actors.manager,request,secret,{fetcher}));assert.equal(calls,1);
});
test('independent: stock query applies only while access is still authorized inside final batch',async t=>{
 const f=fixture(t),prepared=await queryPlan(f);f.db.before={pattern:/UPDATE ai_plans SET status='applied'/,callback:()=>f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='manager'").run(f.now)};
 await assert.rejects(applyAssistantPlan(f.db,f.actors.manager,{action:'apply',planToken:prepared.planToken,confirmed:true},secret));
 assert.equal(f.native.prepare('SELECT status FROM ai_plans').get().status,'ready');assert.equal(f.native.prepare("SELECT COUNT(*) n FROM audit WHERE action='assistant.apply'").get().n,0);
});
test('independent: applied query replay revalidates after settings decrypt before returning private item',async t=>{
 const f=fixture(t),prepared=await queryPlan(f),request={action:'apply',planToken:prepared.planToken,confirmed:true};await applyAssistantPlan(f.db,f.actors.manager,request,secret);
 afterSettingsRead(f,1,()=>f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='manager'").run(f.now));
 await assert.rejects(applyAssistantPlan(f.db,f.actors.manager,request,secret));
});
test('independent: preparation replay revalidates configuration after awaited signing',async t=>{
 const f=fixture(t);await f.configure();const request='Registre uma anotação.',p=provider({intent:'record.create',itemId:null,quantity:0,title:'Registro sintético',body:'Anotação sintética.',evidence:[{source:'request',quote:request}]}),input={action:'prepare',projectId:'project-a',request,operationKey:crypto.randomUUID(),consent:true};
 await prepareAssistantPlan(f.db,f.actors.manager,input,secret,{fetcher:p.fetch});
 afterSubtleOperation(t,'sign',(_algorithm,_key,data)=>new TextDecoder().decode(data).startsWith('proex.assistant.plan/v2:'),()=>f.native.prepare('UPDATE ai_organization_settings SET revision=revision+1').run());
 await assert.rejects(prepareAssistantPlan(f.db,f.actors.manager,input,secret,{fetcher:p.fetch}));assert.equal(p.calls,1);
});
