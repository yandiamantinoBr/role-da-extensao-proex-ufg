import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const text=node=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):'';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function vault(id='org-a',state='missing'){return{organizations:[{id:'org-a',name:'Organização A'},{id:'org-b',name:'Organização B'},{id:'org-c',name:'Organização C'}],organizationId:id,revision:1,storageReady:true,legacyAvailable:false,recoverable:false,keys:[{provider:'groq',label:'Voz '+id,purpose:'Transcrição de voz em português',status:state,mask:state==='active'?'…AB99':null,createdAt:null,updatedAt:null}],groqPilot:null,reserved:{today:0,month:0,dailyLimit:1000000}};}
function harness(){
 let index=0,tree;const slots=[],effects=[],pending=[],requests=[];
 const hooks={useState(initial){const key=index++;if(!(key in slots))slots[key]=initial;return[slots[key],value=>slots[key]=typeof value==='function'?value(slots[key]):value];},useRef(initial){const key=index++;return slots[key]??= {current:initial};},useEffect(callback,deps){const key=index++,old=effects[key];if(old&&deps&&deps.every((value,i)=>value===old.deps?.[i]))return;pending.push(()=>{old?.cleanup?.();effects[key]={deps,cleanup:callback()};});}};
 const compiledModule={exports:{}},jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
 class FakeInput{value='test-only-groq-key-for-ui';}
 class FakeFormData{constructor(form){this.fields=form.fields;}get(name){return this.fields[name]??null;}}
 let code=ts.transpileModule(readFileSync(new URL('../components/portal/credential-vault-panel.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;code+='\nmodule.exports.TestPanel=CredentialVaultPanel;';
 vm.runInNewContext(code,{module:compiledModule,exports:compiledModule.exports,require:name=>name==='react'?hooks:name==='react/jsx-runtime'?jsx:name==='lucide-react'?{KeyRound:'KeyRound',LoaderCircle:'LoaderCircle'}:name.includes('contracts')?{PROVIDERS:{deepseek:{model:'deepseek-flash'},typesafe:{model:'jev-1.14.0'}},credentialProviders:['deepseek','typesafe','deepgram','groq']}:{default:{}},AbortController,Error,Intl,Date,URLSearchParams,FormData:FakeFormData,HTMLInputElement:FakeInput,fetch:(url,init)=>new Promise(resolve=>requests.push({url,init,resolve}))});
 function nodes(){const list=[];function visit(node){if(Array.isArray(node)){node.forEach(visit);return;}if(!node||typeof node!=='object')return;list.push(node);visit(node.props?.children);}visit(tree);return list;}
 const h={requests,FakeInput,render(){index=0;tree=compiledModule.exports.TestPanel({onConfigure(){}});pending.splice(0).forEach(effect=>effect());},nodes,find(type,predicate){const found=nodes().find(node=>node.type===type&&predicate(node));assert.ok(found,type);return found;},dispose(){effects.forEach(effect=>effect?.cleanup?.());}};h.render();return h;
}
async function load(h,value=vault()){h.requests[0].resolve({ok:true,json:async()=>value});await tick();h.render();}
test('Groq vault card has its reviewed model and scoped form; saving only calls the vault and clears the write-only input',async()=>{
 const h=harness();try{await load(h);h.find('p',node=>text(node).includes('Groq · whisper-large-v3-turbo'));const trigger=h.find('button',node=>node.props['aria-label']==='Cadastrar chave Groq');trigger.props.onClick({currentTarget:{focus(){}}});h.render();
  const form=h.find('form',node=>node.props['aria-label']==='Salvar chave Groq'),input=new h.FakeInput();
  form.props.onSubmit({preventDefault(){},currentTarget:{fields:{label:'Voz institucional',credentialValue:input.value},elements:{namedItem:()=>input}}});await tick();h.render();
  assert.equal(input.value,'');assert.equal(h.requests.length,2);assert.equal(h.requests[1].url,'/api/assistant/credentials');const body=JSON.parse(h.requests[1].init.body);assert.equal(body.provider,'groq');assert.equal(body.organizationId,'org-a');assert.equal(body.action,'save');assert.equal(Object.hasOwn(body,'sttEnabled'),false);
  h.requests[1].resolve({ok:true,json:async()=>({...vault('org-a','active'),revision:2})});await tick();h.render();h.find('p',node=>text(node)==='Credencial salva.');assert.equal(h.nodes().some(node=>node.type==='input'&&node.props.type==='password'),false);
 }finally{h.dispose();}
});
test('revoked vault access clears Groq masks/forms and late previous-organization responses cannot overwrite the selected organization',async()=>{
 const h=harness();try{await load(h,vault('org-a','active'));const change=h.find('select',()=>true).props.onChange;change({target:{value:'org-b'}});h.render();change({target:{value:'org-c'}});h.render();
  h.requests[2].resolve({ok:true,json:async()=>vault('org-c','active')});await tick();h.render();h.requests[1].resolve({ok:true,json:async()=>vault('org-b','active')});await tick();h.render();assert.equal(h.find('select',()=>true).props.value,'org-c');
  h.find('button',node=>node.props['aria-label']==='Desligar chave Groq').props.onClick({currentTarget:{focus(){}}});h.render();h.find('form',node=>node.props['aria-label']==='Desligar chave Groq').props.onSubmit({preventDefault(){},currentTarget:{fields:{},elements:{namedItem:()=>null}}});await tick();h.requests[3].resolve({ok:false,status:403,json:async()=>({error:'Acesso revogado'})});await tick();h.render();assert.equal(h.nodes().some(node=>node.type==='select'),false);assert.equal(h.nodes().some(node=>node.type==='form'),false);assert.equal(text(h.nodes()).includes('…AB99'),false);
 }finally{h.dispose();}
});
