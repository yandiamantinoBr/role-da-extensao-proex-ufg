import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
const root=path.resolve(import.meta.dirname,'..'),tick=()=>new Promise(resolve=>setImmediate(resolve));
const text=node=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):'';
const notice=(patch={})=>({id:'episode-a',sequence:1,itemId:'item-a',projectId:'project-a',material:'Pasta de exemplo',projectName:'Projeto de exemplo',unit:'unidade',available:4,threshold:5,openedAvailable:5,openedThreshold:5,openedAt:'2026-11-06T12:00:00Z',cause:'stock',readAt:null,dismissedAt:null,...patch});
const response=(patch={})=>({viewerId:'user-a',notices:[notice()],unread:1,total:1,hasMore:false,nextBefore:null,asOf:'2026-11-06T12:00:00Z',includeDismissed:false,...patch});
function harness(initial={}){
 let props={userId:'user-a',organizationId:'org-a',projectId:'project-a',...initial},tree,frame,gate=null;
 const listeners=new Map(),window={addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:(n,f)=>{if(listeners.get(n)===f)listeners.delete(n);}},instances=new Map(),effects=[],layouts=[],modules=new Map(),requests=[],downloads=[],artifacts=[],toasts=[],selected=[],focus=[];
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,i)=>Object.is(value,b[i]));
 const hooks={
  useState(initial){const slot=frame.index++,owner=frame;if(!(slot in owner.slots))owner.slots[slot]=typeof initial==='function'?initial():initial;return[owner.slots[slot],next=>{owner.slots[slot]=typeof next==='function'?next(owner.slots[slot]):next;}];},
  useRef(initial){const slot=frame.index++;return frame.slots[slot]??={current:initial};},
  useCallback(fn,deps){const slot=frame.index++,owner=frame,old=owner.slots[slot];if(!same(old?.deps,deps))owner.slots[slot]={deps,fn};return owner.slots[slot].fn;},useEffect(fn,deps){effect(fn,deps,effects);},useLayoutEffect(fn,deps){effect(fn,deps,layouts);},
 };
 function effect(fn,deps,queue){const slot=frame.index++,owner=frame,old=owner.slots[slot];if(!same(old?.deps,deps))queue.push(()=>{old?.cleanup?.();owner.slots[slot]={deps,cleanup:fn()};});}
 const jsx=(type,props,key)=>({type,props,key});
 function load(file){
  if(modules.has(file))return modules.get(file);const mod={exports:{}};modules.set(file,mod.exports);
  function require(name){
   if(name==='react')return hooks;if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};
   if(name==='lucide-react')return new Proxy({},{get:(_target,key)=>String(key)});
   if(name==='sonner')return{toast:{success:message=>toasts.push(['success',message]),error:message=>toasts.push(['error',message])}};
   if(name.endsWith('.module.css'))return{default:new Proxy({},{get:(_target,key)=>String(key)})};
   if(name==='./date-field')return{default:values=>jsx('input',{...values,type:'text','data-pt-br-date':true})};
   if(name==='./export-formats')return{default:values=>jsx('div',{children:['pdf','xlsx','docx'].map(format=>jsx('button',{type:'button',disabled:values.disabled,'aria-label':`${values.label} em ${format.toUpperCase()}`,onClick:()=>values.onExport(format),children:format.toUpperCase()}))})};
   if(name==='./document-export')return{documentExport:async(format,title,columns,rows,display,info,presentation)=>{artifacts.push({format,title,columns,rows,info,presentation});if(gate)await gate;return new Blob([JSON.stringify({columns,rows,info})]);}};
   if(name==='./report-export')return{download:(name,blob)=>downloads.push({name,blob})};
   let target=name.startsWith('@/')?path.join(root,name.slice(2)):path.resolve(path.dirname(file),name);target=[target,target+'.ts',target+'.tsx'].find(existsSync);assert.ok(target,name);return load(target);
  }
  class FormData{constructor(form){this.values=new Map(Object.entries(form.values));}get(key){return this.values.get(key)??null;}}
  const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(code,{module:mod,exports:mod.exports,require,Date,Intl,JSON,URL,URLSearchParams,Error,DOMException,AbortController,Blob,crypto,FormData,window,fetch:(url,init)=>new Promise(resolve=>requests.push({url,init,resolve}))});return mod.exports;
 }
 const Component=load(path.join(root,'components/portal/material-attention-inbox.tsx')).default;
 function expand(value,address,used){
  if(!value||typeof value!=='object')return value;
  if(Array.isArray(value))return value.map((entry,index)=>expand(entry,address+'/'+index,used));
  if(typeof value.type==='function'){
   const key=address+'/'+value.type.name+':'+String(value.key??''),previous=frame;let owner=instances.get(key);
   if(!owner){owner={slots:[],index:0};instances.set(key,owner);}owner.index=0;used.add(key);frame=owner;
   const result=value.type(value.props);frame=previous;return expand(result,key,used);
  }
  return{...value,props:{...value.props,children:expand(value.props?.children,address+'/children',used)}};
 }
 function nodes(){const result=[];function walk(value){if(!value||typeof value!=='object')return;if(Array.isArray(value))return value.forEach(walk);result.push(value);walk(value.props?.children);}walk(tree);return result;}
 const h={requests,downloads,artifacts,toasts,selected,focus,
  render(patch={}){props={...props,...patch,onUnreadChange:n=>selected.push(n)};const used=new Set();tree=expand(jsx(Component,props),'root',used);for(const[key,owner]of instances)if(!used.has(key)){owner.slots.forEach(slot=>slot?.cleanup?.());instances.delete(key);}for(const entry of nodes())if(entry.props.ref&&!entry.props.ref.current)entry.props.ref.current={focus:()=>focus.push('focus'),scrollIntoView:()=>focus.push('scroll')};layouts.splice(0).forEach(fn=>fn());effects.splice(0).forEach(fn=>fn());},
  find(type,predicate=()=>true){return nodes().find(entry=>entry.type===type&&predicate(entry));},all(type){return nodes().filter(entry=>entry.type===type);},body(){return text(tree);},
  button(label){const result=h.find('button',entry=>entry.props['aria-label']===label||text(entry).trim()===label);assert.ok(result,label);return result;},
  click(label){const button=h.button(label);assert.equal(Boolean(button.props.disabled),false,label+' enabled');const result=button.props.onClick({currentTarget:{isConnected:true,focus(){}}});h.render();return result;},
  toggle(open){h.find('details').props.onToggle({currentTarget:{open}});h.render();},
  submit(title,values){const form=h.find('form',entry=>text(entry).includes(title));assert.ok(form,title);form.props.onSubmit({preventDefault(){},currentTarget:{values}});h.render();},
  last(){return requests.at(-1);},reply(request,value,status=200){request.resolve({ok:status>=200&&status<300,status,json:typeof value==='function'?value:async()=>value});},
  async ready(value=response(),status=200){h.reply(h.last(),value,status);await tick();h.render();},
  async open(value=response()){h.click('Preparar pessoas');await h.ready(value);},
  blockArtifact(){let release;gate=new Promise(resolve=>release=()=>{gate=null;resolve();});return release;},
  dispose(){for(const owner of instances.values())owner.slots.forEach(slot=>slot?.cleanup?.());instances.clear();},
 };h.render();return h;
}
test('material inbox shows server stock/minimum and contextual links with unread callback only after authorized data',async()=>{
 const h=harness();try{assert.match(h.body(),/Consultando avisos/);assert.ok(!h.body().includes('0 não lidos'));await h.ready();assert.equal(h.selected.at(-1),1);assert.match(h.body(),/Pasta de exemplo/);assert.match(h.body(),/Disponível4/);assert.match(h.body(),/Mínimo5/);assert.equal(h.find('a').props.href,'/?module=materials&project=project-a&itemId=item-a');assert.equal(h.last().init.cache,'no-store');}finally{h.dispose();}
});
test('read receipt is explicit and fresh inbox confirmation is required before changing counts',async()=>{
 const h=harness();try{await h.ready();h.click('Marcar lido');const req=h.last(),body=JSON.parse(req.init.body);assert.equal(body.action,'read');assert.deepEqual(body.episodeIds,['episode-a']);assert.ok(body.operationKey);assert.equal(req.init.headers['X-Proex-Action'],'1');h.reply(req,{viewerId:'user-a',action:'read',saved:true});await tick();h.render();assert.equal(h.selected.at(-1),1);assert.equal(h.last().init.method,undefined);await h.ready(response({unread:0,notices:[notice({readAt:'2026-11-06T12:01:00Z'})]}));assert.equal(h.selected.at(-1),0);assert.match(h.body(),/Leitura registrada/);assert.ok(!h.all('button').some(n=>text(n).trim()==='Marcar lido'));}finally{h.dispose();}
});
test('dismissed toggle and page cursor use matching envelopes; restore does not fabricate unread counts',async()=>{
 const h=harness();try{await h.ready(response({hasMore:true,nextBefore:1,total:8,unread:8}));h.click('Próxima');assert.match(h.last().url,/before=1/);await h.ready(response({notices:[notice({id:'episode-b',sequence:1})],total:8,unread:8}));h.click('Ver dispensados');assert.match(h.last().url,/includeDismissed=true/);assert.ok(!h.last().url.includes('before='));await h.ready(response({includeDismissed:true,notices:[notice({dismissedAt:'2026-11-06T12:01:00Z',readAt:'2026-11-06T12:01:00Z'})],unread:0}));h.click('Reexibir');assert.equal(JSON.parse(h.last().init.body).action,'restore');}finally{h.dispose();}
});
test('wrong identity, 403/409 and malformed envelopes clear all material titles and counts',async()=>{
 for(const value of [response({viewerId:'other'}),response({includeDismissed:true}),response({notices:[notice({available:-1})]}),response({hasMore:true,nextBefore:null})]){const h=harness();try{await h.ready(value);assert.ok(h.find('p',n=>n.props.role==='alert'));assert.ok(!h.body().includes('Pasta de exemplo'));assert.equal(h.selected.at(-1),0);}finally{h.dispose();}}
 for(const status of [403,409]){const h=harness();try{await h.ready();h.click('Atualizar avisos de estoque');await h.ready({error:'Acesso ou estoque mudou'},status);assert.ok(!h.body().includes('Pasta de exemplo'));assert.match(h.body(),/Acesso ou estoque mudou/);}finally{h.dispose();}}
});
test('account change aborts reads and writes, late receipts cannot change the new lifetime',async()=>{
 const h=harness();try{await h.ready();h.click('Dispensar');const pending=h.last();h.render({userId:'user-b'});assert.equal(pending.init.signal.aborted,true);h.reply(pending,{viewerId:'user-a',action:'dismiss',saved:true});await tick();h.render();assert.ok(!h.body().includes('Pasta de exemplo'));assert.ok(!h.body().includes('Aviso dispensado'));await h.ready(response({viewerId:'user-b',notices:[],total:0,unread:0}));assert.match(h.body(),/Nenhum aviso/);}finally{h.dispose();}
});
