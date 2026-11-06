import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import {compile} from './support/traffic-fixture.mjs';

const contracts=await import(compile('lib/campaign-planning/contracts.ts'));
const clocks=await import(compile('lib/date-time-field.ts'));
const source=readFileSync(new URL('../components/portal/campaign-planning-panel.tsx',import.meta.url),'utf8');
// Execute the real form and its handlers; the private body is exposed only in this VM.
const code=ts.transpileModule(`${source}\nexport {PlanningBody as ClockTestBody};`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const text=node=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):'';
const nodes=tree=>{const result=[];function visit(node){if(!node||typeof node!=='object')return;if(Array.isArray(node))return node.forEach(visit);result.push(node);visit(node.props?.children);}visit(tree);return result;};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const workspace=()=>({viewerId:'clock-viewer',campaignId:'clock-campaign',primaryProjectId:'clock-project',campaign:{name:'Ação sintética',status:'draft',primaryProjectName:'Projeto sintético'},canManage:true,version:3,sessions:[],hosts:[],asOf:'2026-11-06T15:00:00Z'});

function harness(){
 const slots=[],effects=[],requests=[];let index=0,tree;
 const effect=(fn,deps)=>{const key=index++,previous=slots[key];if(!previous||!deps||deps.some((value,i)=>!Object.is(value,previous.deps?.[i]))){slots[key]={deps};effects.push(()=>{previous?.cleanup?.();slots[key].cleanup=fn();});}};
 const hooks={
  useState(initial){const key=index++;if(!(key in slots))slots[key]={value:typeof initial==='function'?initial():initial};return[slots[key].value,next=>{slots[key].value=typeof next==='function'?next(slots[key].value):next;}];},
  useRef(initial){const key=index++;return slots[key]??={current:initial};},
  useEffect:effect,useLayoutEffect:effect,
 };
 const jsx=(type,props)=>({type,props}),compiled={exports:{}};
 vm.runInNewContext(code,{
  module:compiled,exports:compiled.exports,
  require:name=>{
   if(name==='react')return hooks;
   if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};
   if(name==='lucide-react')return new Proxy({},{get:(_,key)=>String(key)});
   if(name==='sonner')return{toast:{dismiss(){},success(){},error(){}}};
   if(name==='@/lib/campaign-planning/contracts')return contracts;
   if(name==='@/lib/date-time-field')return clocks;
   if(name.endsWith('.css'))return{default:new Proxy({},{get:(_,key)=>String(key)})};
   if(name==='./date-field')return{default:'DateField'};
   if(name==='./export-formats')return{default:'ExportFormats'};
   if(name==='./campaign-planning-export')return{};
   throw new Error(`Unstubbed planning form dependency: ${name}`);
  },
  Date,Intl,URLSearchParams,AbortController,Map,Set,Error,crypto:{randomUUID},
  fetch:(url,init)=>new Promise(resolve=>requests.push({url,init,resolve})),
 });
 const h={
  requests,
  render(){index=0;tree=compiled.exports.ClockTestBody({userId:'clock-viewer',campaignId:'clock-campaign',projectId:'clock-project',projects:[{id:'clock-project',name:'Projeto sintético',organizationId:'clock-org'}]});while(effects.length)effects.shift()();},
  all(){return nodes(tree);},
  button(label){const result=this.all().find(node=>node.type==='button'&&text(node).trim()===label);assert.ok(result,`Button: ${label}`);return result;},
  field(label){const wrapping=this.all().find(node=>node.type==='label'&&Array.isArray(node.props.children)&&text(node.props.children[0])===label);assert.ok(wrapping,`Field label: ${label}`);const result=nodes(wrapping).find(node=>node.type==='input'||node.type==='select');assert.ok(result,`Field control: ${label}`);return result;},
  set(label,value){this.field(label).props.onChange({target:{value}});this.render();},
  blur(label){const field=this.field(label);assert.equal(typeof field.props.onBlur,'function',`${label} normalizes on blur`);const target={value:field.props.value};field.props.onBlur({target,currentTarget:target});this.render();},
  submit(){const form=this.all().find(node=>node.type==='form'&&node.props.noValidate);assert.ok(form);form.props.onSubmit({preventDefault(){}});this.render();},
  posts(){return requests.filter(request=>request.init.method==='POST');},
  body(){return text(tree);},
  dispose(){slots.forEach(slot=>slot?.cleanup?.());},
 };
 h.render();return h;
}
async function ready(){
 const h=harness();
 const details=h.all().find(node=>node.type==='details'&&node.props['data-campaign-planning']!==undefined);
 details.props.onToggle({currentTarget:{open:true}});h.render();
 assert.equal(h.requests.length,1);
 h.requests[0].resolve({ok:true,json:async()=>workspace()});await tick();h.render();
 h.button('Adicionar sessão').props.onClick({currentTarget:null});h.render();
 const date=h.all().find(node=>node.type==='DateField');assert.ok(date);date.props.onValueChange('2026-11-09');h.render();
 return h;
}

test('planning clocks accept four digits in a Brazilian 24-hour text field and normalize on blur without losing draft fields',async()=>{
 const h=await ready();try{
  for(const label of ['Início','Fim']){const props=h.field(label).props;assert.equal(props.type,'text');assert.equal(props.inputMode,'numeric');assert.equal(props.maxLength,5);assert.match(props.lang,/^pt-br$/i);assert.match(props.placeholder,/^hh:mm$/i);}
  h.set('Nome (opcional)','Sessão sintética');h.set('Situação','confirmed');h.set('Início','1330');h.set('Fim','1500');
  h.blur('Início');h.blur('Fim');
  assert.equal(h.field('Início').props.value,'13:30');assert.equal(h.field('Fim').props.value,'15:00');
  assert.equal(h.field('Nome (opcional)').props.value,'Sessão sintética');assert.equal(h.field('Situação').props.value,'confirmed');
 }finally{h.dispose();}
});

test('submitting a four-digit clock without blur sends canonical civil HH:mm values and the chosen session status',async()=>{
 const h=await ready();try{
  h.set('Início','1330');h.set('Fim','1500');h.set('Situação','confirmed');h.submit();
  assert.equal(h.posts().length,1);const body=JSON.parse(h.posts()[0].init.body);
  assert.equal(body.action,'session.save');assert.equal(body.startsAt,'13:30');assert.equal(body.endsAt,'15:00');assert.equal(body.status,'confirmed');assert.equal(body.sessionDate,'2026-11-09');assert.equal(body.expectedVersion,3);
 }finally{h.dispose();}
});

test('both blank clocks remain optional for a tentative session and are sent as null',async()=>{
 const h=await ready();try{h.submit();assert.equal(h.posts().length,1);const body=JSON.parse(h.posts()[0].init.body);assert.equal(body.startsAt,null);assert.equal(body.endsAt,null);assert.equal(body.status,'tentative');}finally{h.dispose();}
});

test('the planning form accepts the complete 24-hour boundary from 00:00 to 23:59',async()=>{
 const h=await ready();try{
  h.set('Início','00:00');h.set('Fim','23:59');h.set('Situação','confirmed');h.submit();
  assert.equal(h.posts().length,1);const body=JSON.parse(h.posts()[0].init.body);assert.equal(body.startsAt,'00:00');assert.equal(body.endsAt,'23:59');assert.equal(body.status,'confirmed');
 }finally{h.dispose();}
});

test('canceling and adding a session again resets controlled clocks, status and name without posting',async()=>{
 const h=await ready();try{
  h.set('Início','1330');h.set('Fim','1500');h.set('Situação','confirmed');h.set('Nome (opcional)','Rascunho para descartar');
  h.button('Cancelar').props.onClick();h.render();
  h.button('Adicionar sessão').props.onClick({currentTarget:null});h.render();
  assert.equal(h.field('Início').props.value,'');assert.equal(h.field('Fim').props.value,'');assert.equal(h.field('Situação').props.value,'tentative');assert.equal(h.field('Nome (opcional)').props.value,'');
  assert.equal(h.posts().length,0);assert.equal(h.requests.length,1);
 }finally{h.dispose();}
});

for(const [name,start,end,status,message] of [
 ['24:00','24:00','15:00','tentative',/HH:MM|hora válida/],
 ['1260','13:30','1260','tentative',/HH:MM|hora válida/],
 ['missing start','','15:00','tentative',/início e fim juntos/],
 ['missing end','13:30','','tentative',/início e fim juntos/],
 ['equal clocks','13:30','13:30','tentative',/fim deve ser posterior/],
 ['reversed clocks','15:00','13:30','tentative',/fim deve ser posterior/],
 ['confirmed without clocks','','','confirmed',/Confirme início e fim/],
 ['done without clocks','','','done',/Confirme início e fim/],
])test(`invalid planning clocks (${name}) show a useful error, preserve the draft and never POST a business mutation`,async()=>{
 const h=await ready();try{
  h.set('Nome (opcional)','Rascunho preservado');h.set('Início',start);h.set('Fim',end);h.set('Situação',status);h.submit();
  assert.equal(h.posts().length,0);assert.equal(h.requests.length,1);assert.match(h.body(),message);
  if(name==='24:00')assert.equal(h.field('Início').props['aria-invalid'],true);
  assert.equal(h.field('Início').props.value,start);assert.equal(h.field('Fim').props.value,end);assert.equal(h.field('Situação').props.value,status);assert.equal(h.field('Nome (opcional)').props.value,'Rascunho preservado');
 }finally{h.dispose();}
});
