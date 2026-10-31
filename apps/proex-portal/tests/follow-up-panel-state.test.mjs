import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function apiHarness(fetch){const compiledModule={exports:{}};const code=ts.transpileModule(readFileSync(new URL('../components/portal/follow-up-api.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(code,{module:compiledModule,exports:compiledModule.exports,fetch,URLSearchParams,Error,Intl,Date});return compiledModule.exports.followupApi;}

test('successful truncated JSON, wrong shapes and aborted bodies are errors, while HTTP errors preserve a useful fallback',async()=>{
 for(const view of ['tasks','catalog','detail','inbox']){const api=apiHarness(async()=>({ok:true,json:async()=>({})}));await assert.rejects(api('view='+view),/não corresponde/);}
 const malformedCatalog=apiHarness(async()=>({ok:true,json:async()=>({...catalog(),projects:[null]})}));await assert.rejects(malformedCatalog('view=catalog'),/não corresponde/);
 const truncated=apiHarness(async()=>({ok:true,json:async()=>{throw new SyntaxError('truncated');}}));await assert.rejects(truncated('view=detail'),/incompleta/);
 const abort=new Error('body aborted');abort.name='AbortError';const interrupted=apiHarness(async()=>({ok:true,json:async()=>{throw abort;}}));await assert.rejects(interrupted('view=detail'),error=>error===abort);
 const controller=new AbortController(),late=apiHarness(async()=>({ok:true,json:async()=>{controller.abort();return{notifications:[],pending:[],unread:0,hasMore:false};}}));await assert.rejects(late('view=inbox',undefined,controller.signal),error=>error.name==='AbortError');
 const unavailable=apiHarness(async()=>({ok:false,json:async()=>{throw new SyntaxError('HTML response');}}));await assert.rejects(unavailable('view=inbox'),/Não foi possível concluir/);
});

test('server dates are optional for older lists but malformed clock metadata never reaches the visual counters',async()=>{
 const legacy=apiHarness(async()=>({ok:true,json:async()=>({tasks:[],hasMore:false})}));assert.equal((await legacy('view=tasks')).tasks.length,0);
 for(const metadata of [{today:{}},{today:'2026-02-30'},{asOf:'not-a-date'}]){const invalid=apiHarness(async()=>({ok:true,json:async()=>({tasks:[],hasMore:false,...metadata})}));await assert.rejects(invalid('view=tasks'),/não corresponde/);}
 const current=apiHarness(async()=>({ok:true,json:async()=>({tasks:[],hasMore:false,today:'2026-10-31',asOf:'2026-10-31T19:00:00.000Z'})}));assert.equal((await current('view=tasks')).today,'2026-10-31');
});

const text=node=>typeof node==='number'?String(node):typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):'';
function harness(){
 let index=0,tree,props={defaultProjectId:'project-a',defaultOrganizationId:'org-a'};const slots=[],effects=[],timers=new Map(),requests=[];let next=0;
 const clear=id=>timers.delete(id),schedule=(fn,delay)=>{const id=++next;timers.set(id,{fn,delay});return id;};
 const hooks={useState(initial){const i=index++;if(!(i in slots))slots[i]=initial;return[slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value];},useRef(initial){const i=index++;slots[i]??={current:initial};return slots[i];},useEffect(fn,deps){const i=index++,old=slots[i];if(!old||deps.some((v,n)=>v!==old.deps[n]))effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:fn()};});}};
 const element=(type,props)=>typeof type==='function'&&['WorkTaskCard','TaskSignals','TaskStateBadge','TaskPriorityBadge','TaskDeadlineBadge','TaskPageSummary'].includes(type.name)?type(props):({type,props});const jsx={jsx:element,jsxs:element};
 const modules=new Map();function load(file){if(modules.has(file))return modules.get(file);const compiledModule={exports:{}};modules.set(file,compiledModule.exports);const require=name=>name.endsWith('.module.css')?{default:new Proxy({},{get:(_target,key)=>String(key)})}:name==='react'?hooks:name==='react/jsx-runtime'?jsx:name==='lucide-react'?new Proxy({},{get:(_target,key)=>String(key)}):name==='./use-form-draft'?{DraftNotice:'DraftNotice',useFormDraft:()=>({clear(){}})}:name==='../errors'?{HttpError:class extends Error{}}:name==='./work-task-card'?load('components/portal/work-task-card.tsx'):name==='./work-signals'?load('components/portal/work-signals.tsx'):name==='./task-page-summary'?load('components/portal/task-page-summary.tsx'):name==='@/lib/follow-up/presentation'?load('lib/follow-up/presentation.ts'):load(name==='@/lib/follow-up/contracts'?'lib/follow-up/contracts.ts':'components/portal/follow-up-api.ts');
 const code=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{module:compiledModule,exports:compiledModule.exports,require,URLSearchParams,URL,Intl,Date,JSON,Error,Event,AbortController,crypto,setTimeout:schedule,clearTimeout:clear,window:{location:{origin:'http://127.0.0.1:5173'},dispatchEvent(){}},fetch:(url,init)=>new Promise(resolve=>requests.push({url,init,resolve}))});return compiledModule.exports;}
 const Component=load('components/portal/follow-up-panel.tsx').default;
 const nodes=()=>{const result=[];const visit=node=>{if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(visit);return;}result.push(node);visit(node.props?.children);};visit(tree);return result;};
 const h={requests,find(type,predicate=()=>true){return nodes().find(node=>node.type===type&&predicate(node));},render(nextProps={}){props={...props,...nextProps};index=0;tree=Component(props);effects.splice(0).forEach(fn=>fn());},timers(){for(const[id,timer]of [...timers]){timers.delete(id);timer.fn();}},reply(request,data){request.resolve({ok:true,json:async()=>data});},view(request){return new URL(request.url,'http://127.0.0.1').searchParams.get('view');},pending(view){return requests.filter(r=>h.view(r)===view).at(-1);},button(name){const node=nodes().find(n=>n.type==='button'&&text(n)===name);assert.ok(node,name);return node;},hasButton(name){return nodes().some(n=>n.type==='button'&&text(n)===name);},select(name,value){const label=nodes().find(n=>n.type==='label'&&text(n).startsWith(name));assert.ok(label,name);const select=[label.props.children].flat().find(n=>n?.type==='select');assert.ok(select,name);select.props.onChange({target:{value}});},value(name){const label=nodes().find(n=>n.type==='label'&&text(n).startsWith(name));return [label.props.children].flat().find(n=>n?.type==='select').props.value;},body(){return text(tree);},component(name){const node=nodes().find(n=>typeof n.type==='function'&&n.type.name===name);assert.ok(node,name);return node;},dispose(){slots.forEach(slot=>slot?.cleanup?.());}};h.render();h.timers();return h;
}
const catalog=()=>({organizations:[{id:'org-a',name:'Organization A',canManage:true},{id:'org-b',name:'Organization B',canManage:true}],projects:[{id:'project-a',name:'Project A',organization_id:'org-a',canEdit:true},{id:'project-b',name:'Project B',organization_id:'org-b',canEdit:true}],people:[],teamPeople:[],teams:[],items:[],campaigns:[],loans:[],canEdit:true,canManageTeams:true});
const task=(id='task-a')=>({id,organization_id:'org-a',project_id:'project-a',title:'Task A',body:'Context A',priority:'medium',status:'open',due_at:null,version:1,created_at:'2026-10-31T12:00:00Z',updated_at:'2026-10-31T12:00:00Z',canEdit:true,canWork:false,canDelegateWork:false,project_name:'Project A',organization_name:'Organization A',campaign_id:null,item_id:null,loan_id:null,assignees:[]});
const detail=()=>({task:task(),checklist:null,workCandidates:[],workGrants:[],history:[]});
async function ready(h){h.reply(h.pending('catalog'),catalog());h.reply(h.pending('tasks'),{tasks:[task()],hasMore:false,today:'2026-10-31'});await tick();h.render();}

test('the server day renews the list and its deadlines without resetting filters or querying the catalog again',async()=>{
 const h=harness();try{
  h.render({serverDay:'2026-10-31'});h.timers();await ready(h);
  h.select('Estado','blocked');h.render();h.timers();const old=h.pending('tasks');
  const catalogs=h.requests.filter(request=>h.view(request)==='catalog').length;
  h.render({serverDay:'2026-11-01'});assert.ok(!h.body().includes('Task A'));h.timers();
  assert.equal(old.init.signal.aborted,true);assert.equal(h.value('Estado'),'blocked');
  assert.equal(h.requests.filter(request=>h.view(request)==='catalog').length,catalogs);
  h.reply(old,{tasks:[{...task(),title:'Late old day'}],hasMore:false,today:'2026-10-31'});await tick();h.render();assert.ok(!h.body().includes('Late old day'));
  h.reply(h.pending('tasks'),{tasks:[{...task(),status:'blocked',due_at:'2026-10-31'}],hasMore:false,today:'2026-11-01'});await tick();h.render();assert.match(h.body(),/Prazo vencido/);
 }finally{h.dispose();}
});

test('switching project hides the previous list and editing actions before effects finish; late responses do not restore them',async()=>{
 const h=harness();try{await ready(h);assert.ok(h.body().includes('Task A'));assert.ok(h.hasButton('Nova demanda'));
 h.select('Projeto','project-b');h.render();assert.ok(!h.body().includes('Task A'));assert.ok(!h.hasButton('Nova demanda'));h.timers();const old=h.pending('tasks');
 h.select('Organização','org-a');h.render();h.timers();assert.equal(old.init.signal.aborted,true);h.reply(old,{tasks:[{...task(),title:'Old late task B'}],hasMore:false});await tick();h.render();assert.ok(!h.body().includes('Old late task B'));
 }finally{h.dispose();}
});

test('a late detail cannot close a new form, reappear after closing or replace a different deep link',async()=>{
 const h=harness();try{await ready(h);h.button('Task A').props.onClick();h.render();const pending=h.pending('detail');
 h.button('Nova demanda').props.onClick();h.reply(pending,detail());await tick();h.render();assert.ok(h.body().includes('Nova demanda'));assert.ok(!h.body().includes('Context A'));
 h.render({initialTaskId:'task-a'});h.timers();h.render();h.reply(h.pending('detail'),detail());await tick();h.render();assert.ok(h.body().includes('Context A'));
 h.render({initialTaskId:'task-b'});assert.ok(!h.body().includes('Context A'),'old detail is hidden immediately, before the new prop effect finishes');
 }finally{h.dispose();}
});


test('selection callbacks keep URL state current and its echo does not close a newly opened form',async()=>{
 const h=harness(),seen=[];try{h.render({onSelectTask:id=>seen.push(id)});await ready(h);h.button('Task A').props.onClick();h.render({initialTaskId:'task-a'});h.timers();h.render();assert.deepEqual(seen,['task-a']);
 h.button('Nova demanda').props.onClick();h.render({initialTaskId:''});h.timers();h.render();assert.deepEqual(seen,['task-a','']);assert.ok(h.body().includes('Nova demanda'));assert.ok(h.component('TaskEditor'));
 const saving=h.component('TaskEditor').props.save({action:'task.create',operationKey:'synthetic-key'});const request=h.requests.at(-1);h.reply(request,{...detail(),task:{...task('new-task'),title:'New task'}});await saving;h.render({initialTaskId:'new-task'});h.timers();h.render();assert.deepEqual(seen,['task-a','','new-task']);assert.ok(h.body().includes('New task'));h.button('Fechar').props.onClick();assert.equal(seen.at(-1),'');
 }finally{h.dispose();}
});


test('a catalog resolving between a scope-change handler and its effect cleanup cannot reset the new organization',async()=>{
 const h=harness();try{await ready(h);h.button('Atualizar').props.onClick();h.render();const old=h.pending('catalog');h.select('Projeto','project-b');h.reply(old,catalog());await tick();h.render();assert.equal(h.value('Projeto'),'project-b');assert.equal(h.value('Organização'),'org-b');assert.ok(!h.hasButton('Nova demanda'));}finally{h.dispose();}
});


test('advanced filters stay native and initially collapsed while active values still filter the request and update the summary',async()=>{
 const h=harness();try{await ready(h);const filters=()=>h.find('details',node=>text(node).includes('Buscar e filtrar'));assert.ok(filters());assert.equal(filters().props.open,undefined);assert.ok(h.hasButton('Nova demanda'));assert.equal(h.find('summary',node=>text(node).startsWith('Buscar e filtrar')).props.onClick,undefined);
 h.select('Estado','blocked');h.render();h.select('Prioridade','high');h.render();const search=h.find('input',node=>node.props.placeholder==='Título ou contexto');search.props.onChange({target:{value:'coletes'}});h.render();h.timers();let query=new URL(h.pending('tasks').url,'http://127.0.0.1').searchParams;assert.equal(query.get('status'),'blocked');assert.equal(query.get('priority'),'high');assert.equal(query.get('search'),'coletes');assert.match(text(h.find('summary',node=>text(node).startsWith('Buscar e filtrar'))),/3 filtros ativos/);assert.equal(h.value('Estado'),'blocked');assert.equal(h.value('Prioridade'),'high');assert.equal(filters().props.open,undefined,'rerenders do not control or reset the native disclosure');
 h.select('Estado','all');h.render();h.select('Prioridade','all');h.render();h.find('input',node=>node.props.placeholder==='Título ou contexto').props.onChange({target:{value:''}});h.render();h.timers();query=new URL(h.pending('tasks').url,'http://127.0.0.1').searchParams;assert.equal(query.get('search'),null);assert.equal(query.get('status'),'all');assert.equal(query.get('priority'),'all');assert.equal(text(h.find('summary',node=>text(node).startsWith('Buscar e filtrar'))),'Buscar e filtrar');}finally{h.dispose();}
});
