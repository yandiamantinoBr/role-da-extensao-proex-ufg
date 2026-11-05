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
