import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const clock=Date.parse('2026-10-31T19:00:00.000Z');
class FixedDate extends Date { constructor(value=clock){super(value);} static now(){return clock;} }
const text=node=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):'';
function nodes(tree){const all=[];function visit(node){if(!node||typeof node!=='object')return;if(Array.isArray(node))return node.forEach(visit);all.push(node);visit(node.props?.children);}visit(tree);return all;}
const source=readFileSync(new URL('../components/portal/project-detail.tsx',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const civilDateSource=readFileSync(new URL('../lib/civil-date.ts',import.meta.url),'utf8');
const civilDateCode=ts.transpileModule(civilDateSource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const civilDates=await import(`data:text/javascript;base64,${Buffer.from(civilDateCode).toString('base64')}`);
const communicationSource = readFileSync(new URL('../lib/project-communication.ts', import.meta.url), 'utf8');
const communicationCode = ts.transpileModule(communicationSource, {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const communication = await import(`data:text/javascript;base64,${Buffer.from(communicationCode).toString('base64')}`);
async function renderDetail(relationships,schedule=[],canEdit=false,metadata={}){
 const slots=[],effects=[];let index=0,tree;
 const hooks={useState(initial){const key=index++;if(!(key in slots))slots[key]={value:typeof initial==='function'?initial():initial};return[slots[key].value,value=>{slots[key].value=typeof value==='function'?value(slots[key].value):value;}];},useRef(initial){const key=index++;return(slots[key]??={value:{current:initial}}).value;},useEffect(fn){const key=index++;if(!(key in slots)){slots[key]=true;effects.push(fn);}}};
 const jsx=(type,props)=>({type,props}),compiled={exports:{}};
 const payload={project:{id:'project-a',name:'Projeto sintético',status:'active',lifecycle:'active',scope:'internal',starts_at:'2026-10-31T13:00:00.000Z',description:'Projeto de contrato'},types:[],links:[],calls:[],schedule,versions:[],relatedProjects:[],organizationalUnits:[],permissions:{canEdit},relationships,...metadata};
 vm.runInNewContext(code,{module:compiled,exports:compiled.exports,require:name=>name==='react'?hooks:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='lucide-react'?new Proxy({},{get:(_,key)=>String(key)}):name.endsWith('.css')?{default:new Proxy({},{get:(_,key)=>String(key)})}:name==='@/lib/extension-catalog'?{areaLabel:value=>value,lineLabel:value=>value}:name==='@/lib/civil-date'?civilDates:name==='@/lib/project-communication'?communication:name==='./reports-center'?{ProjectReportExports:'ProjectReportExports'}:{DraftNotice:()=>null,useFormDraft:()=>({clear(){}})},Date:FixedDate,Intl,URL,AbortController,Number,fetch:async()=>({ok:true,json:async()=>payload})});
 function render(){index=0;tree=compiled.exports.default({projectId:'project-a',projects:[],mutate:async()=>({}),onBack(){},onEdit(){}});}
 render();effects.forEach(fn=>fn());await tick();render();
 return{tree,all:nodes(tree),text:text(tree),editSchedule(title){
  const row=nodes(tree).find(node=>node.type==='li'&&text(node).includes(title));
  const edit=nodes(row).find(node=>node.type==='button'&&text(node)==='Editar');
  assert.ok(edit);
  edit.props.onClick();
  render();
  const editor=nodes(tree).find(node=>typeof node.type==='function'&&node.props.editor?.kind==='schedule');
  assert.ok(editor);
  return nodes(editor.type(editor.props));
 }};
}
const loan=(id,ends_at,status='out')=>({id,item_id:'equipment',item_name:`Equipamento ${id}`,action_name:`Ação ${id}`,starts_at:Date.parse('2026-10-31T15:00:00.000Z'),ends_at,status});

test('project detail consumes the numeric-millisecond loan DTO and keeps a current withdrawal out of the overdue state',async()=>{
 const ui=await renderDetail({loans:[loan('current',Date.parse('2026-10-31T20:38:00.000Z'))]});
 const row=ui.all.find(node=>node.type==='li'&&text(node).includes('Ação current'));
 assert.ok(text(row).includes('31 de out. de 2026 → 31 de out. de 2026'));
 assert.ok(text(row).includes('Retirado'));
 assert.equal(text(row).includes('Não informado'),false);
 assert.equal(ui.text.includes('Em atraso'),false);
 assert.ok(ui.text.includes('1 em andamento'));
});

test('ISO, invalid and missing date values use finite comparisons and only a past withdrawn loan is overdue',async()=>{
 const ui=await renderDetail({loans:[loan('late',clock-1),loan('iso','2026-11-01T01:00:00.000Z'),loan('invalid','not-a-date'),loan('missing',null),loan('returned',clock-1,'returned'),loan('reserved',clock-1,'reserved')]});
 assert.equal(ui.all.filter(node=>node.type==='span'&&text(node)==='Em atraso').length,1);
 assert.ok(ui.text.includes('1 em atraso'));
 for(const id of ['invalid','missing']){const row=ui.all.find(node=>node.type==='li'&&text(node).includes(`Ação ${id}`));assert.ok(text(row).includes('Não informado'));assert.ok(text(row).includes('Retirado'));}
 const iso=ui.all.find(node=>node.type==='li'&&text(node).includes('Ação iso'));assert.ok(text(iso).includes('31 de out. de 2026'));assert.ok(text(iso).includes('Retirado'));
});

test('item availability consumes the server projection even without loan visibility and never invents a value for an absent field',async()=>{
 const items=[{id:'blocked',name:'Emprestado',category:'equipment',condition:'active',stock:1,reserved:0,available:0,unit:'unidade'},{id:'gifts',name:'Brindes reservados',category:'gift',condition:'active',stock:5,reserved:3,available:2,unit:'unidade'},...[['unknown','Sem projeção',undefined],['null','Nulo',null],['invalid','Inválido','invalid']].map(([id,name,available])=>({id,name,available,category:'equipment',condition:'active',stock:1,reserved:0,unit:'unidade'}))];
 const ui=await renderDetail({items,loans:null});
 const cells=name=>nodes(ui.all.find(node=>node.type==='tr'&&text(node).startsWith(name))).filter(node=>node.type==='td').map(text);
 assert.equal(cells('Emprestado').at(-1),'0');
 assert.equal(cells('Brindes reservados').at(-1),'2');
 for(const name of ['Sem projeção','Nulo','Inválido']) assert.equal(cells(name).at(-1),'Não informado');
 assert.equal(ui.text.includes('Empréstimos'),false);
});

test('project timeline renders date-only endpoints without shifting either civil day', async () => {
 const activity = { id: 'civil-activity', title: 'Atividade sintética', starts_at: '2026-11-09', ends_at: '2026-11-13',
  status: 'planned', url: 'https://example.invalid/fonte' };
 const ui = await renderDetail({}, [activity]);
 const row = ui.all.find(node => node.type === 'li' && text(node).includes(activity.title));
 assert.match(text(row), /09 de nov\. de 2026 → 13 de nov\. de 2026/);
 assert.equal(nodes(row).find(node => node.type === 'a').props.href, activity.url);
});

test('editing malformed legacy schedule dates requires an explicit correction without inventing a clock time', async () => {
 const activity = { id: 'legacy-activity', title: 'Atividade legada sintética', status: 'planned' };
 for (const [starts_at, ends_at, mode] of [
  ['2026-02-30', '2026-03-02', 'day'],
  ['2026-02-30T10:00:00Z', '2026-03-02T11:00:00Z', 'time'],
  ['2026-11-09', '2026-11-13T14:00:00Z', 'time'],
 ]) {
  const ui = await renderDetail({}, [{ ...activity, starts_at, ends_at }], true);
  const editor = ui.editSchedule(activity.title);
  const field = name => editor.find(node => node.props?.name === name).props;
  assert.equal(field('schedulePrecision').value, mode);
  assert.equal(field('startsAt').defaultValue, '');
  assert.equal(field('startsOn').defaultValue, '');
  assert.equal(field(mode === 'day' ? 'startsOn' : 'startsAt').required, true);
  if (mode === 'day') assert.equal(field('endsOn').defaultValue, ends_at);
  if (starts_at === '2026-11-09') assert.equal(field('endsAt').defaultValue, '');
 }
});

test('the detail distinguishes communication channels, leaves legacy links ordinary and hides history from viewers', async () => {
 const links = [
  {id:'old',label:'Edital anterior',url:'https://example.invalid/edital',kind:'notice'},
  {id:'canva',label:'Arte do estande',url:'https://www.canva.com/design/SYNTHETIC/view',communication_channel:'canva',communication_note:'Página 2 · 1080 × 1350 px'},
  {id:'site',label:'Notícia no portal',url:'https://example.invalid/noticia',communication_channel:'site'},
  {id:'instagram',label:'Publicação da equipe',url:'https://www.instagram.com/p/SYNTHETIC/',communication_channel:'instagram'},
 ];
 const versions = [{id:'old-art',entity_id:'canva',entity_type:'project_link',version:1,created_at:'2026-11-04T12:00:00Z',snapshot_json:JSON.stringify({...links[1],communication_note:'Nota histórica'})}];
 const editor = await renderDetail({}, [], true, {links, versions});
 const group = editor.all.find(node => node.type === 'div' && node.props.className === 'communication');
 assert.match(text(group), /Arte no CanvaArte do estandePágina 2 · 1080 × 1350 px/);
 assert.match(text(group), /Publicação no siteNotícia no portal/);
 assert.match(text(group), /Publicação no InstagramPublicação da equipe/);
 assert.doesNotMatch(text(group), /Edital anterior/);
 assert.equal(editor.all.filter(node => node.type === 'a' && text(node) === 'Edital anterior').length, 1);
 assert.match(editor.text, /Nota histórica/);
 const viewer = await renderDetail({}, [], false, {links, versions});
 assert.doesNotMatch(viewer.text, /Nota histórica|Restaurar/);
});

test('only a detail with report permission mounts the shortcut, including archived projects',async()=>{
 const denied=await renderDetail({},[],false,{permissions:{reports:false}});
 assert.equal(denied.all.some(node=>node.type==='ProjectReportExports'),false);
 const allowed=await renderDetail({},[],false,{permissions:{reports:true},project:{id:'project-a',name:'Projeto arquivado',status:'archived',lifecycle:'past',scope:'internal'}});
 assert.equal(allowed.all.find(node=>node.type==='ProjectReportExports').props.projectId,'project-a');
 assert.match(allowed.text,/Relatórios do projeto/);
});
