import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const text=node=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):'';
const defaults={enabled:false,documentEnabled:false,jevEnabled:false,sttEnabled:false,sttProvider:'legacy',usageScope:'organization',usageUserId:null,dailyCalls:20,dailyUsdMicros:1000000,dailyTokens:100000,timeoutMs:12000,dailyMs:300000,maxOutputTokens:1200,model:'deepseek-flash',jevModel:'jev-1.14.0'};
const status=(id='org-a',extra={})=>({organizationId:id,canConfigure:true,canDelegate:true,revision:3,config:{...defaults},organizations:['org-a','org-b','org-c'].map(id=>({id,name:id,canConfigure:true,legacySttProvider:'deepgram'})),candidates:[{userId:'member-a',name:'Integrante A'}],grants:[],...extra});
function harness(initialProps={}){
 let index=0,tree,props=initialProps;const slots=[],effects=[],pending=[],requests=[],callbacks=[];
 const hooks={useState(initial){const key=index++;if(!(key in slots))slots[key]=typeof initial==='function'?initial():initial;return[slots[key],value=>slots[key]=typeof value==='function'?value(slots[key]):value];},useRef(initial){const key=index++;return slots[key]??={current:initial};},useEffect(callback,deps){const key=index++,old=effects[key];if(old&&deps&&deps.every((value,i)=>Object.is(value,old.deps?.[i])))return;pending.push(()=>{old?.cleanup?.();effects[key]={deps,cleanup:callback()};});}};
 const mod={exports:{}},jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
 const source=ts.transpileModule(readFileSync(new URL('../components/portal/assistant-administration-panel.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const contracts={exports:{}};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/assistant/contracts.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{module:contracts,exports:contracts.exports,require:()=>({HttpError:Error})});
 vm.runInNewContext(source,{module:mod,exports:mod.exports,require:name=>name==='react'?hooks:name==='react/jsx-runtime'?jsx:name.includes('contracts')?contracts.exports:{default:{}},Error,AbortController,fetch:(url,init)=>new Promise((resolve,reject)=>requests.push({url,init,resolve,reject}))});
 function nodes(){const out=[];function walk(node){if(Array.isArray(node)){node.forEach(walk);return;}if(!node||typeof node!=='object')return;out.push(node);walk(node.props?.children);}walk(tree);return out;}
 const h={requests,callbacks,nodes,render(next=props){props=next;index=0;tree=mod.exports.default({onChanged:()=>callbacks.push('changed'),renderCredentials:id=>({type:'credential-area',props:{children:'Cofre '+id}}),...props});pending.splice(0).forEach(effect=>effect());},find(type,predicate){const found=nodes().find(node=>node.type===type&&predicate(node));assert.ok(found,type);return found;},button(label){return h.find('button',node=>text(node)===label);},select(label){return h.find('label',node=>text(node).startsWith(label)).props.children.find(child=>child?.type==='select');},text:()=>text(tree),dispose(){effects.forEach(effect=>effect?.cleanup?.());}};h.render();return h;
}
async function reply(h,index,value){h.requests[index].resolve({ok:true,json:async()=>value});await tick();h.render();}
async function ready(h,extra={}){await reply(h,0,status('',{...extra,canConfigure:false}));await reply(h,1,status('org-a',extra));}
test('administrator saves usage/provider choices only on explicit save with selected organization revision and no key values',async()=>{
 const h=harness();try{await ready(h,{canDelegate:false,config:{...defaults,sttEnabled:true}});h.select('Acesso ao uso').props.onChange({target:{value:'private'}});h.render();h.select('Provedor de transcrição').props.onChange({target:{value:'groq'}});h.render();assert.equal(h.requests.length,2);
  const enabled=h.find('label',node=>text(node).startsWith('Habilitar transcrição Groq')).props.children.find(node=>node?.type==='input');assert.equal(enabled.props.checked,false);enabled.props.onChange({target:{checked:true}});h.render();h.button('Salvar funções, acesso e limites').props.onClick();await tick();
  const body=JSON.parse(h.requests[2].init.body);assert.equal(body.action,'configure');assert.equal(body.organizationId,'org-a');assert.equal(body.expectedRevision,3);assert.equal(body.config.usageScope,'private');assert.equal(body.config.sttProvider,'groq');assert.equal(body.config.sttEnabled,true);
  for(const name of ['secret','deepseekKey','groqKey','replaceCredentials'])assert.equal(Object.hasOwn(body,name),false);
  assert.equal(h.text().includes('Quem pode configurar esta organização'),false);
 }finally{h.dispose();}
});
test('late previous-organization settings cannot redirect a save and access loss clears admin forms and credential content',async()=>{
 const h=harness();try{await ready(h);const change=h.select('Organização dos ajustes de IA').props.onChange;change({target:{value:'org-b'}});h.render();change({target:{value:'org-c'}});h.render();await reply(h,3,status('org-c'));await reply(h,2,status('org-b'));assert.equal(h.select('Organização dos ajustes de IA').props.value,'org-c');h.button('Salvar funções, acesso e limites').props.onClick();await tick();assert.equal(JSON.parse(h.requests[4].init.body).organizationId,'org-c');h.requests[4].resolve({ok:false,status:403,json:async()=>({error:'Permissão revogada'})});await tick();h.render();assert.equal(h.nodes().some(node=>node.type==='credential-area'),false);assert.equal(h.nodes().some(node=>node.type==='select'),false);assert.match(h.text(),/Permissão revogada/);
 }finally{h.dispose();}
});
test('closed administration discards late save results and an unauthorized actor gets no forms or diagnostics',async()=>{
 const h=harness();try{await ready(h);h.button('Salvar funções, acesso e limites').props.onClick();await tick();h.dispose();h.requests[2].resolve({ok:true,json:async()=>({ok:true,revision:4})});await tick();assert.deepEqual(h.callbacks,[]);}finally{h.dispose();}
 const denied=harness();try{await reply(denied,0,{organizationId:'',canConfigure:false,organizations:[{id:'org-a',name:'Org A',canConfigure:false}]});assert.equal(denied.nodes().some(node=>node.type==='select'),false);assert.equal(denied.nodes().some(node=>node.type==='credential-area'),false);assert.match(denied.text(),/não tem autorização/);}finally{denied.dispose();}
});

test('a concurrent credential refresh cannot leave configuration permanently busy or accept incomplete defaults',async()=>{
 const h=harness();try{await ready(h);h.button('Salvar funções, acesso e limites').props.onClick();await tick();h.render({refreshKey:1});await reply(h,3,status('org-a',{revision:4}));h.requests[2].resolve({ok:false,status:409,json:async()=>({error:'Configuração mudou'})});await tick();h.render({refreshKey:1});assert.equal(h.button('Salvar funções, acesso e limites').props.disabled,false);assert.match(h.text(),/Configuração mudou/);}finally{h.dispose();}
 const invalid=harness();try{await reply(invalid,0,status('org-a',{config:undefined}));assert.equal(invalid.nodes().some(node=>node.type==='credential-area'),false);assert.equal(invalid.nodes().some(node=>node.type==='select'),false);}finally{invalid.dispose();}
});

test('owner areas shorten the flow without fetching diagnostics or exposing credential content to a delegated configurator',async()=>{
 const h=harness({canManageKeys:true});try{await ready(h);assert.equal(h.nodes().some(node=>node.type==='credential-area'),true);assert.equal(h.nodes().some(node=>node.type==='select'&&node.props.value==='organization'),false);h.button('Funções e acesso').props.onClick();h.render({canManageKeys:true});assert.equal(h.nodes().some(node=>node.type==='credential-area'),false);assert.ok(h.button('Salvar funções, acesso e limites'));assert.equal(h.requests.length,2,'switching areas does not contact a provider or fetch diagnostics');}finally{h.dispose();}
});

test('explicit OpenAI selection clears both text functions without starting inference or altering speech and usage choices',async()=>{
 const h=harness();try{
  await ready(h,{config:{...defaults,enabled:true,documentEnabled:true,sttProvider:'groq',sttEnabled:true,usageScope:'private',usageUserId:'member-a'}});
  h.select('Provedor de texto e documentos').props.onChange({target:{value:'openai'}});h.render();
  assert.match(h.text(),/Pedidos de operações · OpenAI/);
  const functions=h.nodes().filter(node=>node.type==='label'&&['Pedidos de operações','Interpretação de documentos'].some(label=>text(node).startsWith(label)));
  assert.equal(functions.length,2);for(const node of functions)assert.equal(node.props.children.find(child=>child?.type==='input').props.checked,false);
  assert.equal(h.requests.length,2);h.button('Salvar funções, acesso e limites').props.onClick();await tick();
  const config=JSON.parse(h.requests[2].init.body).config;
  assert.equal(config.textProvider,'openai');assert.equal(config.openaiModel,'gpt-5.6-luna');assert.equal(config.enabled,false);assert.equal(config.documentEnabled,false);
  assert.equal(config.usageScope,'private');assert.equal(config.sttEnabled,true);assert.equal(config.sttProvider,'groq');
 }finally{h.dispose();}
});
