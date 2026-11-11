// Destino da leitura de documento com IA nos dois caminhos do importador (JSON e formulário com arquivo):
// o que a tela mandou em `aiDestination` chega até a conferência do servidor.
// Tudo aqui é sintético: chaves falsas, provedor falso, banco em memória. Nenhuma chamada real.
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {compile,nativeFixture,root} from './support/traffic-fixture.mjs';

const {configureAssistant}=await import(compile('lib/assistant/settings.ts'));
const {migrateAssistantCredentials}=await import(compile('lib/assistant/credential-migration.ts'));
const {manageAssistantCredential}=await import(compile('lib/assistant/credential-vault.ts'));
const {DEFAULT_ASSISTANT_CONFIG}=await import(compile('lib/assistant/contracts.ts'));

const secret='test-only-import-destination-session-secret',keys={current:'synthetic-only-dedicated-import-destination-key'};
const base='https://portal.example.invalid',OPENAI='https://api.openai.com/v1/chat/completions',DEEPSEEK='https://api.deepseek.com/chat/completions';
const LUNA='GPT-5.6 Luna (OpenAI)',CHANGED={error:'O modelo que recebe este texto mudou. Confira o aviso e autorize de novo.',code:'document_ai_destination'};
const content='O cadastro se chama Jardim universitário. Sua área informada é Comunicação. A execução começa em 31/10/2026. Não há data final informada.';
const fields={fields:[{key:'name',value:'Jardim universitário',quote:'O cadastro se chama Jardim universitário.'},{key:'thematicArea',value:'Comunicação',quote:'Sua área informada é Comunicação.'}]};

async function fixture(t,documentModel) {
 const f=nativeFixture();
 const owner=f.owner(),org=f.native.prepare("SELECT organization_id FROM projects WHERE id='project-fixture'").get().organization_id;
 const revision=()=>f.native.prepare('SELECT revision FROM ai_organization_settings WHERE organization_id=?').get(org).revision;
 await configureAssistant(f.db,owner,{organizationId:org,expectedRevision:0,config:{...DEFAULT_ASSISTANT_CONFIG,enabled:true,documentEnabled:true},deepseekKey:'synthetic-only-text-provider'},secret);
 await migrateAssistantCredentials(f.db,owner,{},secret,keys);
 await manageAssistantCredential(f.db,owner,{action:'save',organizationId:org,provider:'openai',expectedRevision:revision(),label:'Chave sintética',secret:'synthetic-only-openai-credential'},secret,keys);
 await configureAssistant(f.db,owner,{organizationId:org,expectedRevision:revision(),config:{...DEFAULT_ASSISTANT_CONFIG,enabled:true,documentEnabled:true,documentModel}},secret,undefined,keys);
 const replacements=new Map([
  [resolve(root,'lib/platform.ts'),"export function database(){return globalThis.__importDestinationTest.db;} export function inviteSecret(){return globalThis.__importDestinationTest.secret;} export function assistantCredentialKeys(){return globalThis.__importDestinationTest.keys;}"],
  [resolve(root,'lib/session.ts'),"export async function getPortalUser(){return globalThis.__importDestinationTest.owner;}"],
 ]),cache=new Map();
 globalThis.__importDestinationTest={db:f.db,owner,secret,keys};
 const calls=[];
 // As rotas não recebem um `fetch` de teste: o global é trocado só durante este teste.
 t.mock.method(globalThis,'fetch',async(url,init)=>{const body=JSON.parse(init.body);calls.push(String(url));return Response.json({model:body.model,choices:[{finish_reason:'stop',message:{content:JSON.stringify(fields)}}],usage:{prompt_tokens:500,completion_tokens:200}});});
 t.after(()=>{delete globalThis.__importDestinationTest;f.close();});
 const json=await import(compile('app/api/imports/route.ts',replacements,cache)),form=await import(compile('app/api/imports/document/route.ts',replacements,cache));
 const paths={
  json:destination=>json.POST(new Request(base+'/api/imports',{method:'POST',headers:{Origin:base,'X-Proex-Action':'1','Content-Type':'application/json'},
   body:JSON.stringify({action:'preview',kind:'project',projectId:'',organizationId:org,itemId:'',sourceMode:'document',sourceUrl:'',format:'text',useAi:true,aiConsent:true,aiOperationKey:crypto.randomUUID(),content,...(destination===undefined?{}:{aiDestination:destination})})})),
  form:destination=>{
   const body=new FormData();body.set('file',new File([content],'fonte-sintetica.txt',{type:'text/plain'}));
   for(const [name,value] of Object.entries({kind:'project',projectId:'',organizationId:org,itemId:'',sourceUrl:'',useAi:'true',aiConsent:'true',aiOperationKey:crypto.randomUUID(),...(destination===undefined?{}:{aiDestination:destination})}))body.set(name,value);
   return form.POST(new Request(base+'/api/imports/document',{method:'POST',headers:{Origin:base,'X-Proex-Action':'1'},body}));
  },
 };
 const reserved=()=>f.native.prepare('SELECT COUNT(*) n FROM ai_document_calls').get().n;
 return {...f,calls,paths,reserved};
}

for(const path of ['json','form']) test(`importer ${path} path: with a chosen document model the request must carry the destination the authorization showed`,async t=>{
 const f=await fixture(t,'openai-gpt-5-6-luna');
 for(const destination of [undefined,'',LUNA,'Outro modelo sintético|']){
  const response=await f.paths[path](destination);
  assert.equal(response.status,409,String(destination));assert.deepEqual(await response.json(),CHANGED);
  assert.deepEqual(f.calls,[],'nothing reaches a provider');assert.equal(f.reserved(),0,'nothing is reserved');
 }
 const response=await f.paths[path](LUNA+'|'),preview=await response.json();
 assert.equal(response.status,200,JSON.stringify(preview));
 assert.deepEqual(f.calls,[OPENAI]);assert.equal(preview.provenance.ai.provider,'catalog:openai-gpt-5-6-luna');assert.equal(f.reserved(),1);
});

for(const path of ['json','form']) test(`importer ${path} path: without a chosen model the destination field is ignored`,async t=>{
 const f=await fixture(t,'');
 for(const destination of [undefined,'',LUNA+'|']){
  const response=await f.paths[path](destination),preview=await response.json();
  assert.equal(response.status,200,JSON.stringify(preview));assert.equal(preview.provenance.ai.provider,'deepseek');
 }
 assert.deepEqual(f.calls,[DEEPSEEK,DEEPSEEK,DEEPSEEK]);
});
