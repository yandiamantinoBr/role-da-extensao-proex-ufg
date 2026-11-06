import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
const root=path.resolve(import.meta.dirname,'..'),tick=()=>new Promise(resolve=>setImmediate(resolve));
const text=node=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):'';
const person=(patch={})=>({id:'person-a',name:'Pessoa de exemplo',position:'Apoio aos eventos',sector:'Área de exemplo',contact:'pessoa@example.invalid',contactStatus:'entered',status:'pending',version:1,sourceKind:'manual',referenceId:null,sourceUrl:null,sourceUpdatedOn:null,checkedOn:'2026-11-06',adapted:false,createdAt:'2026-11-06T12:00:00Z',updatedAt:'2026-11-06T12:00:00Z',...patch});
const response=(patch={})=>({viewerId:'user-a',scope:{organizationId:'org-a',organizationName:'Organização A'},people:[person()],asOf:'2026-11-06T12:00:00Z',...patch});
const detail=(patch={})=>({viewerId:'user-a',organizationId:'org-a',person:person(),history:[{version:1,at:'2026-11-06T12:00:00Z',person:person()}],historyHasMore:false,...patch});
function harness(initial={}){
 let props={userId:'user-a',organizationId:'org-a',projectId:'project-a',...initial},tree,frame,gate=null;
 const instances=new Map(),effects=[],layouts=[],modules=new Map(),requests=[],downloads=[],artifacts=[],toasts=[],selected=[],focus=[];
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,i)=>Object.is(value,b[i]));
 const hooks={
  useState(initial){const slot=frame.index++,owner=frame;if(!(slot in owner.slots))owner.slots[slot]=typeof initial==='function'?initial():initial;return[owner.slots[slot],next=>{owner.slots[slot]=typeof next==='function'?next(owner.slots[slot]):next;}];},
  useRef(initial){const slot=frame.index++;return frame.slots[slot]??={current:initial};},
  useEffect(fn,deps){effect(fn,deps,effects);},useLayoutEffect(fn,deps){effect(fn,deps,layouts);},
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
  vm.runInNewContext(code,{module:mod,exports:mod.exports,require,Date,Intl,JSON,URL,URLSearchParams,Error,DOMException,AbortController,Blob,crypto,FormData,fetch:(url,init)=>new Promise(resolve=>requests.push({url,init,resolve}))});return mod.exports;
 }
 const Component=load(path.join(root,'components/portal/directory-panel.tsx')).default;
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
  render(patch={}){props={...props,...patch,onSelectTeam:id=>selected.push(id)};const used=new Set();tree=expand(jsx(Component,props),'root',used);for(const[key,owner]of instances)if(!used.has(key)){owner.slots.forEach(slot=>slot?.cleanup?.());instances.delete(key);}for(const entry of nodes())if(entry.props.ref&&!entry.props.ref.current)entry.props.ref.current={focus:()=>focus.push('focus'),scrollIntoView:()=>focus.push('scroll')};layouts.splice(0).forEach(fn=>fn());effects.splice(0).forEach(fn=>fn());},
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
test('directory is opt-in and private: matching read, bounded cards, direct editor and independently loaded history',async()=>{
 const h=harness();try{assert.equal(h.requests.length,0);assert.match(h.body(),/não cria conta, convite, acesso ou aviso/);await h.open();assert.equal(h.last().init.cache,'no-store');assert.match(h.body(),/Pré-cadastrado/);h.click('Editar pré-cadastro de Pessoa de exemplo');const req=h.last();assert.match(req.url,/personId=person-a/);await h.ready(detail());h.click('Histórico de alterações');assert.match(h.body(),/Versão 1/);assert.ok(h.find('input',n=>n.props.name==='name'));h.click('Cancelar');assert.ok(!h.find('form'));}finally{h.dispose();}
});
test('save is explicit and status remains pending; success is shown only after a fresh matching read',async()=>{
 const h=harness();try{await h.open();h.click('Adicionar pessoa');h.submit('Adicionar pré-cadastro',{name:'Outra pessoa',position:'Apoio',sector:'Área de exemplo',contact:'outra@example.invalid',status:'pending'});const req=h.last();assert.equal(req.init.method,'POST');const input=JSON.parse(req.init.body);assert.equal(input.action,'person.create');assert.equal(input.status,'pending');assert.equal(input.organizationId,'org-a');assert.equal(input.userId,undefined);assert.ok(input.operationKey);assert.equal(req.init.headers['X-Proex-Action'],'1');await h.ready(detail({person:person({id:'person-b',name:'Outra pessoa'}),history:[{version:1,at:'2026-11-06T12:00:00Z',person:person({id:'person-b',name:'Outra pessoa'})}]}));assert.match(h.body(),/Salvando/);assert.ok(!h.body().includes('Pré-cadastro salvo.'));await h.ready(response({people:[person(),person({id:'person-b',name:'Outra pessoa'})]}));assert.match(h.body(),/Pré-cadastro salvo/);assert.ok(!h.find('form'));assert.equal(h.toasts.at(-1)[0],'success');}finally{h.dispose();}
});

test('history failure ends loading and retries independently without closing or submitting the editor',async()=>{
 const h=harness();try{
  await h.open();h.click('Editar pré-cadastro de Pessoa de exemplo');const first=h.last();h.click('Histórico de alterações');assert.match(h.body(),/Conferindo histórico/);
  await h.ready({error:'Não foi possível consultar o histórico.'},500);assert.match(h.body(),/Não foi possível consultar o histórico/);assert.ok(!h.body().includes('Conferindo histórico'));assert.ok(h.find('form'));assert.ok(h.find('input',n=>n.props.name==='name'));assert.ok(h.button('Salvar pré-cadastro'));
  h.click('Tentar histórico novamente');const retry=h.last();assert.notEqual(retry,first);assert.equal(first.init.signal.aborted,true);assert.match(retry.url,/personId=person-a/);assert.notEqual(retry.init.method,'POST');assert.ok(h.find('form'));assert.match(h.body(),/Conferindo histórico/);assert.ok(!h.body().includes('Não foi possível consultar o histórico'));
  await h.ready(detail());assert.match(h.body(),/Versão 1/);assert.ok(!h.body().includes('Conferindo histórico'));assert.ok(!h.body().includes('Tentar histórico novamente'));assert.ok(h.find('form'));assert.equal(h.requests.filter(req=>req.init.method==='POST').length,0);
 }finally{h.dispose();}
});

test('history retry respects editor lifetime and does not attach a late failure to another person',async()=>{
 const h=harness();try{
  const other=person({id:'person-b',name:'Outra pessoa'});await h.open(response({people:[person(),other]}));h.click('Editar pré-cadastro de Pessoa de exemplo');await h.ready({error:'Falha temporária'},500);h.click('Histórico de alterações');h.click('Tentar histórico novamente');const retry=h.last();h.click('Editar pré-cadastro de Outra pessoa');assert.equal(retry.init.signal.aborted,true);h.reply(retry,{error:'Erro atrasado'},500);await tick();h.render();assert.ok(!h.body().includes('Erro atrasado'));await h.ready(detail({person:other,history:[{version:1,at:'2026-11-06T12:00:00Z',person:other}]}));h.click('Histórico de alterações');assert.match(h.body(),/Versão 1/);assert.ok(!h.body().includes('Tentar histórico novamente'));
 }finally{h.dispose();}
});
test('403, malformed data and wrong account/organization remove private cards and editors',async()=>{
 for(const value of [response({viewerId:'different'}),response({scope:{organizationId:'org-b',organizationName:'Outra'}}),response({people:[{...person(),sourceUrl:'https://evil.invalid'}]})]){const h=harness();try{await h.open(value);assert.ok(h.find('p',n=>n.props.role==='alert'));assert.ok(!h.body().includes('Pessoa de exemplo'));}finally{h.dispose();}}
 const h=harness();try{await h.open();h.click('Editar pré-cadastro de Pessoa de exemplo');h.reply(h.last(),{error:'Acesso removido'},403);await tick();h.render();assert.ok(!h.body().includes('Pessoa de exemplo'));assert.ok(!h.find('form'));assert.match(h.body(),/Acesso removido/);}finally{h.dispose();}
});
test('close/account changes abort delayed reads, history and writes; late receipts cannot contaminate a new lifetime',async()=>{
 const h=harness();try{await h.open();h.click('Editar pré-cadastro de Pessoa de exemplo');const history=h.last();h.click('Cancelar');assert.equal(history.init.signal.aborted,true);h.reply(history,detail());await tick();h.render();assert.ok(!h.find('form'));h.click('Adicionar pessoa');h.submit('Adicionar pré-cadastro',{name:'Outra pessoa',position:'Apoio',sector:'Área',contact:'nova@example.invalid',status:'pending'});const saving=h.last();h.click('Fechar');assert.equal(saving.init.signal.aborted,true);h.reply(saving,detail());await tick();h.render();assert.ok(!h.body().includes('Pré-cadastro salvo'));h.click('Preparar pessoas');const old=h.last();h.render({userId:'user-b',organizationId:'org-b'});assert.equal(old.init.signal.aborted,true);h.reply(old,response());await tick();h.render();assert.ok(!h.body().includes('Pessoa de exemplo'));assert.ok(h.button('Preparar pessoas'));}finally{h.dispose();}
});
test('retries preserve operation identity after ambiguous failure and changed form starts a new intent',async()=>{
 const h=harness();try{await h.open();h.click('Adicionar pessoa');const values={name:'Outra pessoa',position:'Apoio',sector:'Área',contact:'nova@example.invalid',status:'pending'};h.submit('Adicionar pré-cadastro',values);const first=h.last();h.reply(first,{error:'Falha de comunicação'},500);await tick();h.render();h.submit('Adicionar pré-cadastro',values);const second=h.last();assert.equal(JSON.parse(first.init.body).operationKey,JSON.parse(second.init.body).operationKey);h.reply(second,{error:'Falha de comunicação'},500);await tick();h.render();h.find('form').props.onChange();h.submit('Adicionar pré-cadastro',{...values,name:'Outro nome'});assert.notEqual(JSON.parse(first.init.body).operationKey,JSON.parse(h.last().init.body).operationKey);}finally{h.dispose();}
});
test('list pages and filters keep history separate from account authority',async()=>{
 const h=harness();try{await h.open(response({people:Array.from({length:8},(_,n)=>person({id:`person-${n}`,name:`Pessoa ${n}`,status:n===7?'archived':'pending'}))}));assert.equal(h.all('button').filter(b=>String(b.props['aria-label']).startsWith('Editar pré-cadastro')).length,6);h.click('Próxima');assert.match(h.body(),/Pessoa 6/);assert.ok(!h.body().includes('Pessoa 0'));}finally{h.dispose();}
});
