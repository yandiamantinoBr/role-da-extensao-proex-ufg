import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root=path.resolve(import.meta.dirname,'..'),tick=()=>new Promise(resolve=>setImmediate(resolve));
const text=node=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):'';
const node=(patch={})=>({id:'unit-a',parentId:null,name:'Câmara de Extensão e Cultura',acronym:'CEC',kind:'council',relation:'root',position:0,status:'active',...patch});
const response=(patch={})=>({viewerId:'user-a',scope:{organizationId:'org-a',organizationName:'Organização A',projectId:'project-a',projectName:'Projeto A',canManage:true},version:2,canApplyTemplate:false,source:{label:'Organograma público',revision:'5.0.3',issuedOn:'2026-07-28',referenceUrl:'https://official.example/organograma.pdf',adapted:false},nodes:[node(),node({id:'unit-b',parentId:'unit-a',name:'Pró-reitoria de Extensão',acronym:'PROEX',kind:'office',relation:'governance'})],teams:[{id:'team-a',name:'Comunicação',status:'active'}],links:[{nodeId:'unit-b',teamId:'team-a'}],asOf:'2026-11-05T12:00:00Z',...patch});

/** Actual component + validators, keyed React lifetimes, effects and HTTP handlers.
 * Only framework widgets and serializers are substituted; delayed requests ignore
 * abort on purpose so that epoch/identity guards must also work. */
function harness(initial={}){
 let props={userId:'user-a',organizationId:'org-a',projectId:'project-a',...initial},tree,frame,gate=null;
 const instances=new Map(),effects=[],layouts=[],modules=new Map(),requests=[],downloads=[],artifacts=[],toasts=[],selected=[],focus=[];
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,i)=>Object.is(value,b[i]));
 const hooks={
  useState(initial){const slot=frame.index++,owner=frame;if(!(slot in owner.slots))owner.slots[slot]=typeof initial==='function'?initial():initial;return[owner.slots[slot],next=>{owner.slots[slot]=typeof next==='function'?next(owner.slots[slot]):next;}];},
  useRef(initial){const slot=frame.index++;return frame.slots[slot]??={current:initial};},
  useId(){const slot=frame.index++;return frame.slots[slot]??=`campo-${slot}`;},
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
 const Component=load(path.join(root,'components/portal/institutional-structure-panel.tsx')).default;
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
  button(label){const result=h.find('button',entry=>entry.props['aria-label']===label||text(entry)===label);assert.ok(result,label);return result;},
  click(label){const button=h.button(label);assert.equal(Boolean(button.props.disabled),false,label+' enabled');const result=button.props.onClick();h.render();return result;},
  toggle(open){h.find('details').props.onToggle({currentTarget:{open}});h.render();},
  submit(title,values){const form=h.find('form',entry=>text(entry).includes(title));assert.ok(form,title);form.props.onSubmit({preventDefault(){},currentTarget:{values}});h.render();},
  last(){return requests.at(-1);},reply(request,value,status=200){request.resolve({ok:status>=200&&status<300,status,json:typeof value==='function'?value:async()=>value});},
  async ready(value=response(),status=200){h.reply(h.last(),value,status);await tick();h.render();},
  async open(value=response()){h.toggle(true);await h.ready(value);},
  blockArtifact(){let release;gate=new Promise(resolve=>release=()=>{gate=null;resolve();});return release;},
  dispose(){for(const owner of instances.values())owner.slots.forEach(slot=>slot?.cleanup?.());instances.clear();},
 };h.render();return h;
}

test('closed disclosure has no GET, then shows a semantic tree, governance and authorized team navigation',async()=>{
 const h=harness();try{assert.equal(h.requests.length,0);await h.open();assert.equal(h.requests.length,1);assert.match(h.body(),/Governança/);assert.match(h.body(),/CEC/);assert.match(h.body(),/versão 2/);assert.equal(h.find('ul',entry=>entry.props.role==='tree'),undefined);assert.ok(h.find('article'));assert.ok(h.find('a',entry=>entry.props.href==='https://official.example/organograma.pdf'));h.click('Comunicação');assert.deepEqual(h.selected,['team-a']);assert.equal(h.last().init.cache,'no-store');assert.equal(h.last().init.redirect,'error');}finally{h.dispose();}
});

test('read-only scope cannot edit, inspect archives or prepare a reference; visible links do not contain a roster',async()=>{
 const h=harness();try{const data=response({scope:{...response().scope,canManage:false}});await h.open(data);assert.equal(h.find('button',entry=>text(entry)==='Nova unidade'),undefined);assert.equal(h.find('button',entry=>text(entry)==='Editar fonte'),undefined);assert.equal(h.find('input',entry=>entry.props.type==='checkbox'),undefined);assert.doesNotMatch(h.body(),/Pessoas e acessos|e-mail|Integrantes da organização/);assert.ok(h.button('Baixar estrutura institucional em PDF'));}finally{h.dispose();}
});

test('wrong account, project, cycles, duplicate IDs and archived regressions discard the entire response',async()=>{
 const base=response();const cases=[{},response({viewerId:'user-b'}),response({scope:{...base.scope,projectId:'project-b'}}),response({nodes:[node({parentId:'unit-a',relation:'subordination'})]}),response({nodes:[node(),node()]}),response({nodes:[node({status:'archived'})]}),response({scope:{...base.scope,canManage:false},teams:[{id:'team-a',name:'Archived',status:'archived'}]})];
 for(const data of cases){const h=harness();try{await h.open(data);assert.ok(h.find('div',entry=>entry.props.role==='alert'));assert.equal(h.find('article'),undefined);assert.equal(h.find('button',entry=>text(entry)==='Nova unidade'),undefined);}finally{h.dispose();}}
});

test('one scope notice, deep branches collapse behind named summaries, and only exceptional relations get a badge',async()=>{
 const deep=response({nodes:[node(),node({id:'unit-b',parentId:'unit-a',name:'Pró-reitoria de Extensão',acronym:'PROEX',kind:'office',relation:'governance'}),node({id:'unit-c',parentId:'unit-b',name:'Diretoria C',acronym:'',kind:'directorate',relation:'subordination'}),node({id:'unit-d',parentId:'unit-c',name:'Coordenação D',acronym:'',kind:'coordination',relation:'subordination'}),node({id:'unit-e',parentId:'unit-d',name:'Coordenação E com um nome institucional bastante longo',acronym:'',kind:'coordination',relation:'subordination'})],links:[]});
 const h=harness();try{await h.open(deep);
  assert.equal(h.body().split('não concede').length-1,1);assert.match(h.body(),/toda a organização/);assert.match(h.body(),/Relações de governança/);
  const branches=h.all('details').filter(entry=>entry.props.className==='children');assert.equal(branches.length,4);assert.deepEqual(branches.map(entry=>Boolean(entry.props.open)),[true,true,false,false]);
  const summaries=branches.map(entry=>text(entry.props.children.find(child=>child?.type==='summary')));assert.match(summaries[0],/1 unidade em governança.*Câmara de Extensão e Cultura/);assert.match(summaries[2],/1 unidade subordinada.*Diretoria C/);
  assert.deepEqual(h.all('span').filter(entry=>entry.props.className==='badge').map(text),['Governança']);assert.doesNotMatch(h.body(),/0 equipes/);
  for(const name of ['Câmara de Extensão e Cultura','Coordenação E com um nome institucional bastante longo']){const edit=h.button('Editar '+name);assert.ok(h.find('span',entry=>entry.props.className==='actionLabel'&&text(entry)==='Editar'&&edit.props.children.includes(entry)));}
 }finally{h.dispose();}
 const reader=harness();try{await reader.open(response({scope:{...response().scope,canManage:false}}));assert.equal(reader.body().split('não concede').length-1,1);assert.doesNotMatch(reader.body(),/toda a organização/);}finally{reader.dispose();}
});

test('a deep unit opens a named editor; Cancelar sends nothing, explains the result and returns focus to the clicked control',async()=>{
 const long='Coordenação E com um nome institucional bastante longo';
 const h=harness();try{await h.open(response({nodes:[node(),node({id:'unit-b',parentId:'unit-a',name:'Diretoria B',acronym:'',kind:'directorate',relation:'subordination'}),node({id:'unit-c',parentId:'unit-b',name:'Diretoria C',acronym:'',kind:'directorate',relation:'subordination'}),node({id:'unit-e',parentId:'unit-c',name:long,acronym:'',kind:'coordination',relation:'subordination'})],links:[]}));
  let restored=0;const count=h.requests.length;h.button('Editar '+long).props.onClick({currentTarget:{isConnected:true,focus(){restored++;}}});h.render();
  assert.match(text(h.find('h4',entry=>entry.props.tabIndex===-1)),new RegExp('Editar unidade · '+long));assert.ok(h.focus.length>=2);assert.ok(h.find('form'));
  h.click('Cancelar');assert.equal(h.find('form'),undefined);assert.equal(h.requests.length,count);assert.equal(restored,1);assert.match(h.body(),/Edição cancelada/);
 }finally{h.dispose();}
});

const contains=(root,predicate)=>{let found=false;(function walk(value){if(found||!value||typeof value!=='object')return;if(Array.isArray(value))return value.forEach(walk);if(predicate(value)){found=true;return;}walk(value.props?.children);})(root);return found;};
const escape=(patch={})=>({key:'Escape',defaultPrevented:false,preventDefault(){},stopPropagation(){},...patch});
const editorSection=h=>h.find('section',entry=>entry.props['aria-labelledby']==='institutional-structure-editor-title');

test('one live region exists before opening and carries loading, then feedback, without being replaced',async()=>{
 const h=harness();try{const regions=()=>h.all('p').filter(entry=>entry.props.role==='status');assert.equal(regions().length,1);assert.equal(text(regions()[0]),'');assert.equal(h.requests.length,0);
  h.toggle(true);assert.equal(regions().length,1);assert.match(text(regions()[0]),/Consultando/);assert.equal(regions()[0].props['aria-live'],'polite');
  await h.ready();assert.equal(regions().length,1);assert.equal(text(regions()[0]),'');assert.equal(regions()[0].props.className,'srOnly');
  h.click('Editar fonte');h.click('Cancelar');assert.equal(regions().length,1);assert.match(text(regions()[0]),/Edição cancelada/);assert.equal(regions()[0].props.className,'feedback');
 }finally{h.dispose();}
});

test('compact preamble: metrics are one list and the source is a closed native disclosure that keeps its meaning and edit action',async()=>{
 const h=harness();try{await h.open();
  const metrics=h.find('ul',entry=>entry.props['aria-label']==='Resumo da estrutura');assert.ok(metrics);assert.equal(metrics.props.children.length,3);assert.match(text(metrics),/Unidades visíveis.*Relações de governança.*Equipes vinculadas/);
  const reference=h.find('details',entry=>entry.props.className==='reference');assert.ok(reference);assert.equal(reference.props.open,undefined);
  const summary=reference.props.children.find(child=>child?.type==='summary');assert.match(text(summary),/^Fonte: Organograma público/);assert.match(text(summary),/não certifica a estrutura vigente/);
  assert.equal(h.body().split('não certifica').length-1,1);assert.equal(h.body().split('não concede').length-1,1);
  assert.ok(contains(reference,entry=>entry.type==='button'&&text(entry)==='Editar fonte'));assert.ok(contains(reference,entry=>entry.type==='a'&&entry.props.href==='https://official.example/organograma.pdf'));
  h.click('Editar fonte');const tree=h.find('div',entry=>entry.props.className==='tree');assert.ok(editorSection(h));assert.equal(contains(tree,entry=>entry.type==='section'),false);
 }finally{h.dispose();}
 const reader=harness();try{await reader.open(response({scope:{...response().scope,canManage:false}}));const reference=reader.find('details',entry=>entry.props.className==='reference');assert.ok(reference);assert.equal(contains(reference,entry=>entry.type==='button'),false);}finally{reader.dispose();}
});

test('icon actions carry full titles, archive is the quiet action, and new units still open above the tree',async()=>{
 const h=harness();try{await h.open();
  for(const label of ['Editar Câmara de Extensão e Cultura','Vincular equipes: Câmara de Extensão e Cultura','Arquivar Câmara de Extensão e Cultura'])assert.equal(h.button(label).props.title,label);
  assert.match(h.button('Arquivar Câmara de Extensão e Cultura').props.className,/quietAction/);assert.doesNotMatch(h.button('Editar Câmara de Extensão e Cultura').props.className,/quietAction/);
  h.click('Nova unidade');assert.ok(editorSection(h));assert.equal(contains(h.find('div',entry=>entry.props.className==='tree'),entry=>entry.type==='section'),false);assert.match(text(h.find('h4',entry=>entry.props.tabIndex===-1)),/^Nova unidade formal$/);
 }finally{h.dispose();}
});

test('an existing unit is edited inside its own tree item; Escape cancels like Cancelar, but never during a save',async()=>{
 const name='Pró-reitoria de Extensão';
 const h=harness();try{await h.open();
  let restored=0;const count=h.requests.length;h.button('Editar '+name).props.onClick({currentTarget:{isConnected:true,focus(){restored++;}}});h.render();
  const item=h.all('li').find(entry=>entry.props.className==='node'&&text(entry.props.children[0]).includes(name));assert.equal(item.props.children[0].type,'article');assert.equal(item.props.children[1]?.type,'section');
  assert.equal(contains(h.find('div',entry=>entry.props.className==='tree'),entry=>entry.props?.['aria-labelledby']==='institutional-structure-editor-title'),true);
  const title=h.find('h4',entry=>entry.props.tabIndex===-1);assert.equal(text(title),'Editar unidade · '+name);assert.equal(h.find('span',entry=>entry.props.className==='editorName').props.title,name);assert.ok(h.focus.length>=2);
  editorSection(h).props.onKeyDown(escape({defaultPrevented:true}));h.render();assert.ok(h.find('form'));
  editorSection(h).props.onKeyDown(escape());h.render();assert.equal(h.find('form'),undefined);assert.equal(h.requests.length,count);assert.equal(restored,1);assert.match(h.body(),/Edição cancelada/);
  h.button('Editar '+name).props.onClick({currentTarget:{isConnected:true,focus(){restored++;}}});h.render();
  h.submit('Salvar unidade',{name:'Pró-reitoria revisada',acronym:'PROEX',kind:'office',position:'0'});const pending=h.last();assert.equal(pending.init.method,'POST');
  editorSection(h).props.onKeyDown(escape());h.render();assert.ok(h.find('form'));assert.equal(pending.init.signal.aborted,false);assert.equal(restored,1);assert.doesNotMatch(h.body(),/Edição cancelada/);
  h.reply(pending,{error:'Conflito',code:'structure_version'},409);await tick();h.render();assert.ok(h.find('form'));
 }finally{h.dispose();}
});

test('canApplyTemplate distinguishes truly empty state from a filtered archived catalog; nothing seeds automatically',async()=>{
 for(const canApplyTemplate of [false,true]){const h=harness();try{await h.open(response({nodes:[],links:[],canApplyTemplate}));assert.equal(h.requests.length,1);const prepare=h.find('button',entry=>text(entry)==='Preparar referência oficial');assert.equal(Boolean(prepare),canApplyTemplate);if(canApplyTemplate){h.click('Preparar referência oficial');assert.equal(h.requests.length,1);assert.match(h.body(),/Revise antes de aplicar/);assert.equal(h.all('details').filter(entry=>entry.props.className==='templateItem').length,11);h.all('input').find(entry=>entry.props.value==='Câmara de Extensão e Cultura').props.onChange({target:{value:'Colegiado revisado'}});h.render();h.submit('Aplicar estrutura revisada',{});const input=JSON.parse(h.last().init.body);assert.equal(input.action,'template.apply');assert.equal(input.nodes.length,11);assert.equal(input.nodes[0].name,'Colegiado revisado');assert.equal(input.expectedVersion,2);assert.equal(input.organizationId,'org-a');assert.equal(typeof input.operationKey,'string');assert.equal(h.last().init.headers['X-Proex-Action'],'1');}}finally{h.dispose();}}
});

test('editing a node uses CAS, omits current descendants from parents, and only acknowledges after a fresh GET',async()=>{
 const h=harness();try{await h.open();h.click('Editar Câmara de Extensão e Cultura');assert.ok(h.focus.length>=2);const parents=h.find('select',entry=>entry.props['aria-label']==='Unidade superior');assert.equal(text(parents),'Sem unidade superior (raiz)');h.submit('Salvar unidade',{name:'Colegiado revisto',acronym:'CEC',kind:'council',position:'4'});const post=h.last(),body=JSON.parse(post.init.body);assert.equal(body.action,'node.save');assert.equal(body.id,'unit-a');assert.equal(body.parentId,null);assert.equal(body.relation,'root');assert.equal(body.position,4);assert.equal(body.expectedVersion,2);assert.doesNotMatch(h.body(),/Estrutura salva e conferida/);h.reply(post,{viewerId:'user-a',organizationId:'org-a',entityId:'unit-a',version:3,duplicate:false});await tick();h.render();assert.equal(h.last().init.method,undefined);assert.doesNotMatch(h.body(),/Estrutura salva e conferida/);await h.ready(response({version:3,nodes:[node({name:'Colegiado revisto'}),response().nodes[1]]}));assert.match(h.body(),/Estrutura salva e conferida/);assert.match(h.body(),/Colegiado revisto/);assert.equal(h.find('form'),undefined);}finally{h.dispose();}
});

test('uncertain POST keeps a stable operation key for the same retry and CSRF-safe headers; 403 erases old data',async()=>{
 const h=harness();try{await h.open();h.click('Nova unidade');const fields={name:'Arquivo de Extensão',acronym:'',kind:'unit',position:'0'};h.submit('Salvar unidade',fields);const first=JSON.parse(h.last().init.body);await h.ready({error:'Resposta temporária indisponível'},503);h.submit('Salvar unidade',fields);assert.equal(JSON.parse(h.last().init.body).operationKey,first.operationKey);assert.equal(h.last().init.credentials,'same-origin');await h.ready({error:'Acesso revogado',code:'structure_scope'},403);assert.doesNotMatch(h.body(),/Câmara de Extensão e Cultura|Pró-reitoria de Extensão|Arquivo de Extensão/);assert.match(h.body(),/Acesso revogado/);assert.equal(h.find('form'),undefined);}finally{h.dispose();}
});

test('source editor uses the Portuguese DateField contract; archive requires a confirmation and checks archived-team links too',async()=>{
 const h=harness();try{await h.open();h.click('Editar fonte');assert.ok(h.find('input',entry=>entry.props['data-pt-br-date']&&entry.props.name==='issuedOn'));h.submit('Salvar fonte',{label:'Fonte revisada',revision:'6',issuedOn:'2026-11-05'});assert.equal(JSON.parse(h.last().init.body).issuedOn,'2026-11-05');await h.ready({error:'Version changed'},409);h.click('Cancelar');h.click('Arquivar Câmara de Extensão e Cultura');assert.equal(h.button('Confirmar arquivamento').props.disabled,true);h.click('Cancelar');h.click('Arquivar Pró-reitoria de Extensão');assert.equal(h.button('Confirmar arquivamento').props.disabled,true);assert.match(h.body(),/inclusive as arquivadas/);}finally{h.dispose();}
 const archived=harness();try{await archived.open(response({nodes:[node()],links:[{nodeId:'unit-a',teamId:'team-a'}],teams:[{id:'team-a',name:'Equipe arquivada',status:'archived'}]}));archived.click('Arquivar Câmara de Extensão e Cultura');assert.equal(archived.button('Confirmar arquivamento').props.disabled,true);assert.equal(archived.requests.length,1);}finally{archived.dispose();}
});

test('archive, reactivation and link changes are explicit actions, preserve IDs and never submit people',async()=>{
 const h=harness();try{await h.open(response({nodes:[node()],links:[]}));h.click('Vincular equipes: Câmara de Extensão e Cultura');h.submit('Vincular equipe',{teamId:'team-a'});assert.deepEqual(Object.keys(JSON.parse(h.last().init.body)).sort(),['action','expectedVersion','linked','nodeId','operationKey','organizationId','teamId'].sort());assert.equal(JSON.parse(h.last().init.body).linked,true);await h.ready({error:'Try again'},409);h.click('Cancelar');h.click('Arquivar Câmara de Extensão e Cultura');h.click('Confirmar arquivamento');assert.equal(JSON.parse(h.last().init.body).action,'node.status');assert.equal(JSON.parse(h.last().init.body).status,'archived');}finally{h.dispose();}
 const reactivated=harness();try{await reactivated.open(response({nodes:[],links:[]}));reactivated.find('input',entry=>entry.props.type==='checkbox').props.onChange({target:{checked:true}});reactivated.render();assert.equal(new URL(reactivated.last().url,'https://portal.example').searchParams.get('includeArchived'),'true');await reactivated.ready(response({nodes:[node({status:'archived'})],links:[]}));reactivated.click('Reativar Câmara de Extensão e Cultura');reactivated.click('Confirmar reativação');assert.equal(JSON.parse(reactivated.last().init.body).status,'active');}finally{reactivated.dispose();}
});

test('close, account change, project change and unmount abort pending reads without late data resurrection',async()=>{
 for(const change of ['close','account','project','unmount']){const h=harness();try{h.toggle(true);const old=h.last();if(change==='close'){h.toggle(false);h.toggle(true);}else if(change==='account')h.render({userId:'user-b',organizationId:'org-b',projectId:'project-b'});else if(change==='project')h.render({projectId:'project-b'});else h.dispose();assert.equal(old.init.signal.aborted,true);h.reply(old,response());await tick();if(change!=='unmount')h.render();assert.doesNotMatch(h.body(),/Câmara de Extensão e Cultura/);if(change==='account'||change==='project'){assert.equal(h.find('details').props.open,false);assert.equal(h.requests.length,1);}}finally{h.dispose();}}
});

test('a hung old POST cannot block a new scope or unlock its pending mutation when the old response finishes',async()=>{
 const h=harness();try{await h.open();h.click('Nova unidade');h.submit('Salvar unidade',{name:'Unidade A',acronym:'',kind:'unit',position:'0'});const old=h.last();h.render({userId:'user-b',organizationId:'org-b',projectId:'project-b'});assert.equal(old.init.signal.aborted,true);const dataB=response({viewerId:'user-b',scope:{organizationId:'org-b',organizationName:'Organização B',projectId:'project-b',projectName:'Projeto B',canManage:true},nodes:[node({name:'Unidade B'})],links:[]});await h.open(dataB);h.click('Nova unidade');h.submit('Salvar unidade',{name:'Unidade B nova',acronym:'',kind:'unit',position:'0'});const newer=h.last();assert.notEqual(newer,old);h.reply(old,{viewerId:'user-a',organizationId:'org-a',entityId:'unit-new-a',version:3,duplicate:false});await tick();h.render();assert.equal(h.find('fieldset',entry=>text(entry).includes('Nome da unidade')).props.disabled,true);assert.equal(h.requests.at(-1),newer);h.reply(newer,{error:'Conflito',code:'structure_version'},409);await tick();h.render();assert.equal(h.find('fieldset',entry=>text(entry).includes('Nome da unidade')).props.disabled,false);assert.doesNotMatch(h.body(),/Unidade A/);}finally{h.dispose();}
});

test('PDF DOCX XLSX use two fresh identical queries, allowlisted rows and no download before the last read',async()=>{
 for(const format of ['PDF','DOCX','XLSX']){const h=harness();try{await h.open();const query=h.last().url,pending=h.click('Baixar estrutura institucional em '+format);assert.equal(h.last().url,query);assert.equal(h.downloads.length,0);await h.ready();assert.equal(h.artifacts.length,1);assert.equal(h.requests.length,3);assert.equal(h.last().url,query);assert.equal(h.downloads.length,0);await h.ready(response({asOf:'2026-11-05T12:00:01Z'}));await pending;assert.equal(h.downloads.length,1);assert.equal(h.downloads[0].name,'proex-estrutura-institucional.'+format.toLowerCase());const body=await h.downloads[0].blob.text();assert.match(body,/Versão do cadastro/);assert.match(body,/Referência oficial aplicada sem alterações/);assert.doesNotMatch(body,/user-a|org-a|project-a|unit-a|unit-b|team-a|https:|referenceUrl/);}finally{h.dispose();}}
});

test('final revocation, modified structure, unexpected viewer and a failed last read all withhold the artifact',async()=>{
 for(const mode of ['revoked','changed','viewer','network']){const h=harness();try{await h.open();const pending=h.click('Baixar estrutura institucional em PDF'),caught=pending.catch(error=>error);await h.ready();const last=mode==='revoked'?{error:'Acesso revogado'}:mode==='changed'?response({version:3}):mode==='viewer'?response({viewerId:'user-b'}):async()=>{throw new SyntaxError('Incomplete');};await h.ready(last,mode==='revoked'?403:200);const error=await caught;assert.ok(error instanceof Error);assert.equal(h.downloads.length,0);if(mode==='revoked'||mode==='viewer')assert.doesNotMatch(h.body(),/Câmara de Extensão e Cultura/);}finally{h.dispose();}}
});

test('context change, close and unmount during artifact creation abort export even when the renderer finishes later',async()=>{
 for(const mode of ['context','close','unmount']){const h=harness();try{await h.open();const release=h.blockArtifact(),pending=h.click('Baixar estrutura institucional em PDF'),caught=pending.catch(error=>error);await h.ready();assert.equal(h.artifacts.length,1);const count=h.requests.length;if(mode==='context')h.render({projectId:'project-b'});else if(mode==='close')h.toggle(false);else h.dispose();release();assert.equal((await caught).name,'AbortError');assert.equal(h.requests.length,count);assert.equal(h.downloads.length,0);}finally{h.dispose();}}
});
