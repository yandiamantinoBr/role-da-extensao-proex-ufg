import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
const root=new URL('../',import.meta.url),tick=()=>new Promise(resolve=>setImmediate(resolve));
const text=node=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):'';
function harness(){
 const slots=[],cleanups=[],cache=new Map(),requests=[];let index=0,tree;
 const hooks={useState(initial){const key=index++;if(!(key in slots))slots[key]=typeof initial==='function'?initial():initial;return[slots[key],value=>{slots[key]=typeof value==='function'?value(slots[key]):value;}];},useRef(initial){const key=index++;slots[key]??={current:initial};return slots[key];},useEffect(callback){const key=index++;if(!(key in slots)){slots[key]=true;cleanups.push(callback());}}};
 const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
 function load(file){if(cache.has(file))return cache.get(file);const compiledModule={exports:{}};cache.set(file,compiledModule.exports);const require=name=>name==='react'?hooks:name==='react/jsx-runtime'?jsx:name==='./assistant-connection-panel'?{default:()=>null}:load(name.startsWith('@/')?`${name.slice(2)}.ts`:`${path.posix.normalize(path.posix.join(path.posix.dirname(file),name))}${name==='./speech-input'?'.tsx':'.ts'}`);const source=ts.transpileModule(readFileSync(new URL(file,root),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;vm.runInNewContext(source,{module:compiledModule,exports:compiledModule.exports,require,Error,File,Blob,FormData,AbortController,TextEncoder,TextDecoder,Uint8Array,DataView,ArrayBuffer,crypto,setTimeout,clearTimeout,window:{setTimeout:()=>1,clearTimeout(){}},fetch:(url,init)=>new Promise(resolve=>requests.push({url,init,resolve}))});return compiledModule.exports;}
 const Component=load('components/portal/assistant-panel.tsx').default,defaults=load('lib/assistant/contracts.ts').DEFAULT_ASSISTANT_CONFIG;
 function nodes(){const result=[];const visit=node=>{if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(visit);return;}result.push(node);visit(node.props?.children);};visit(tree);return result;}
 const h={requests,render(){index=0;tree=Component({projects:[{id:'project-a',name:'Projeto A',organization_id:'org-a'}],defaultProjectId:'project-a'});},find(type,predicate){const found=nodes().find(node=>node.type===type&&predicate(node));assert.ok(found,type);return found;},button(name){return h.find('button',node=>text(node)===name);},selector(){return h.find('label',node=>text(node).startsWith('Organização da configuração')).props.children.find(child=>child?.type==='select');},keys(){return nodes().filter(node=>node.type==='input'&&node.props.type==='password');},status(id){return{available:true,canConfigure:true,canDelegate:true,organizationId:id,revision:1,config:{...defaults,enabled:true},organizations:['org-a','org-b','org-c'].map(value=>({id:value,name:value,canConfigure:true,available:true,sttAvailable:false})),candidates:[],grants:[]};},dispose(){cleanups.forEach(cleanup=>cleanup?.());}};h.render();return h;
}
async function open(h, extra={}){h.button('Assistente com revisão').props.onClick();await tick();h.requests[0].resolve({ok:true,json:async()=>({...h.status('org-a'),...extra})});await tick();h.render();}
test('operational assistant has no credential, configuration, grant or diagnostic administration even for an owner',async()=>{
 const h=harness();try{await open(h);assert.equal(h.keys().length,0);for(const forbidden of ['Configurar IA','Salvar configuração','Nova chave','Testar autenticação','Autorizar integrante'])assert.equal(text(h.find('section',()=>true)).includes(forbidden),false,forbidden);assert.ok(h.button('Preparar proposta'));}finally{h.dispose();}
});
test('account renders only profile while authorized configuration remains in Settings',()=>{
 const source=readFileSync(new URL('../app/portal-client.tsx',import.meta.url),'utf8');const profile=source.slice(source.indexOf("{tab === 'profile'"),source.indexOf("{tab === 'records'"));assert.match(profile,/ProfilePanel/);assert.doesNotMatch(profile,/AssistantPanel/);assert.ok(source.includes('data.canConfigureAi === true'));assert.ok(source.includes('canManageKeys={isPlatformOwner}'));
});

// Trava de destino: com modelo de conferência escolhido, a tela mostra quem confere, manda esse nome no preparo
// e, se o servidor disser que mudou, busca o nome de agora e pede a autorização de novo.
const DECIDER='Decider v1.2 (Perplexity)',OTHER='Drex Max v1.1 (Nace)';
const sentence=name=>`Os registros de estoque são conferidos pelo modelo ${name}.`;
const routedStatus=(h,name)=>({...h.status('org-a'),organizations:h.status('org-a').organizations.map(organization=>organization.id==='org-a'&&name?{...organization,decisionRouteName:name}:organization)});
async function fill(h){
 h.find('textarea',node=>node.props.placeholder?.startsWith('Ex.:')).props.onChange({target:{value:'Registrar entrada de 10 canetas.'}});
 h.find('input',node=>node.props.type==='checkbox'&&node.props.checked===false&&!node.props.disabled&&node.props.onChange.toString().includes('setConsent')).props.onChange({target:{checked:true}});
 h.render();
}
const consentBox=h=>h.find('label',node=>text(node).startsWith('Autorizo enviar este pedido')).props.children[0];
test('sem modelo de conferência escolhido: a tela não ganha frase nova e o preparo vai sem o campo de destino',async()=>{
 const h=harness();try{
  await open(h);await fill(h);
  assert.equal(text(h.find('section',()=>true)).includes('são conferidos pelo modelo'),false);
  void h.button('Preparar proposta').props.onClick();await tick();
  assert.equal('decisionDestination' in JSON.parse(h.requests[1].init.body),false);
  assert.deepEqual(Object.keys(JSON.parse(h.requests[1].init.body)),['action','projectId','request','consent','operationKey'],'o pedido de sempre');
 }finally{h.dispose();}
});
test('com modelo de conferência escolhido: a tela nomeia quem confere, manda o nome no preparo e volta ao aviso quando o servidor diz que mudou',async()=>{
 const h=harness();try{
  h.button('Assistente com revisão').props.onClick();await tick();h.requests[0].resolve({ok:true,json:async()=>routedStatus(h,DECIDER)});await tick();h.render();
  assert.ok(text(h.find('section',()=>true)).includes(sentence(DECIDER)));
  await fill(h);assert.equal(consentBox(h).props.checked,true);
  void h.button('Preparar proposta').props.onClick();await tick();
  assert.equal(JSON.parse(h.requests[1].init.body).decisionDestination,DECIDER);
  // O servidor recusa (o modelo mudou): a tela busca o estado de novo, mostra o nome de agora e desmarca a autorização.
  h.requests[1].resolve({ok:false,status:409,json:async()=>({error:'O modelo que confere este registro mudou. Confira o aviso e confirme de novo.',code:'assistant_destination'})});await tick();await tick();
  assert.equal(h.requests.length,3,'nova leitura do estado');assert.equal(h.requests[2].init.method,undefined);
  h.requests[2].resolve({ok:true,json:async()=>routedStatus(h,OTHER)});await tick();await tick();h.render();
  const shown=text(h.find('section',()=>true));
  assert.ok(shown.includes('O modelo que confere este registro mudou. Confira o aviso e confirme de novo.'));
  assert.ok(shown.includes(sentence(OTHER)));assert.equal(shown.includes(DECIDER),false,'o nome antigo saiu da tela');
  assert.equal(consentBox(h).props.checked,false,'a autorização é pedida de novo');
  assert.equal(h.button('Preparar proposta').props.disabled,true);
  // Autorizando de novo, o preparo leva o nome novo.
  consentBox(h).props.onChange({target:{checked:true}});h.render();
  void h.button('Preparar proposta').props.onClick();await tick();
  assert.equal(JSON.parse(h.requests[3].init.body).decisionDestination,OTHER);
 }finally{h.dispose();}
});
