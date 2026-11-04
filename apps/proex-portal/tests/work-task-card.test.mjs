import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const modules = new Map();
const text = value => typeof value === 'string' || typeof value === 'number' ? String(value) : Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : '';
const nodes = tree => { const output=[];const visit=node=>{if(!node||typeof node!=='object')return;if(Array.isArray(node))return node.forEach(visit);output.push(node);visit(node.props?.children);};visit(tree);return output; };
const element = (type, props) => typeof type === 'function' ? type(props) : { type, props };
function load(file) {
 if (modules.has(file)) return modules.get(file);
 const compiledModule = {exports:{}}; modules.set(file,compiledModule.exports);
 const require = name => name === 'react/jsx-runtime' ? {jsx:element,jsxs:element} : name === 'lucide-react' ? new Proxy({}, {get:(_,key)=>String(key)}) : name.endsWith('.module.css') ? {default:new Proxy({}, {get:(_,key)=>String(key)})} : name === '../errors' ? {HttpError:class extends Error{}} : load(name === './work-signals' ? 'components/portal/work-signals.tsx' : name.startsWith('@/') ? name.slice(2)+'.ts' : name);
 const code=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{module:compiledModule,exports:compiledModule.exports,require,Date,Intl,Number,Math});return compiledModule.exports;
}
const {WorkTaskCard}=load('components/portal/work-task-card.tsx');
const {TaskPageSummary}=load('components/portal/task-page-summary.tsx');
const task=(id,status='open',due_at=null)=>({id,title:'Recontar materiais sintéticos',status,priority:'high',due_at,project_name:'Projeto sintético',organization_name:'Organização sintética',assignees:[]});

test('task cards keep status outside the primary action and preserve explicit responsible names',()=>{
 let selected=0;const row=task('a','blocked','2026-10-30');row.assignees=[{user_id:'u',team_id:null,name:'Pessoa A'},{user_id:null,team_id:'t',name:'Comunicação'}];
 const tree=WorkTaskCard({task:row,today:'2026-10-31',selected:true,onOpen:()=>selected++});
 const button=nodes(tree).find(node=>node.type==='button');assert.equal(text(button),row.title);assert.equal(button.props['aria-expanded'],true);button.props.onClick();assert.equal(selected,1);
 for(const label of ['Bloqueada','Prioridade alta','Prazo vencido','Pessoa A','Comunicação'])assert.ok(text(tree).includes(label));
 assert.equal(nodes(button).some(node=>node.props?.role==='group'),false);
});

test('the page summary labels its population and does not turn completed or cancelled tasks into overdue work',()=>{
 const rows=[task('overdue','open','2026-10-30'),task('today','in_progress','2026-10-31'),task('done','completed','2020-01-01'),task('cancelled','cancelled','2020-01-01')];
 const tree=TaskPageSummary({tasks:rows,today:'2026-10-31'});assert.ok(text(tree).includes('Nesta página · 4 demandas'));
 const metrics=nodes(tree).find(node=>node.type==='dl'&&node.props.className==='metrics');
 const items=nodes(metrics).filter(node=>node.type==='dd').map(text);assert.deepEqual(items,['1','1','1']);
});

test('missing server day shows unknown deadline attention instead of a false zero',()=>{
 const tree=TaskPageSummary({tasks:[task('a','open','2026-10-30')],today:''});assert.equal(text(nodes(tree).find(node=>node.type==='dd')),'—');assert.ok(text(tree).includes('Atualize para conferir os prazos'));
});

test('the page visual counts actual priorities and dates, keeps civil groups ordered and marks unknown deadlines',()=>{
 const rows=[
  {...task('future','open','2026-11-09'),priority:'medium'},
  task('now','in_progress','2026-11-04'),
  task('done','completed','2026-11-04'),
  {...task('unknown','blocked','2026-02-30'),priority:'low'},
  task('missing','open',null),
 ];
 const opened=[];
 const tree=TaskPageSummary({tasks:rows,today:'2026-11-04',page:2,hasMore:true,selectedId:'done',onOpen:id=>opened.push(id)});
 const [distribution,timeline]=nodes(tree).filter(node=>node.type==='details');
 assert.match(text(tree),/Página 2.*Há mais na próxima página/);
 assert.deepEqual(nodes(distribution).filter(node=>node.type==='dd').map(text),['2','1','1','1','0','3','1','1']);
 assert.ok(nodes(distribution).filter(node=>node.props.className==='track').every(node=>node.props['aria-hidden']==='true'));
 assert.deepEqual(nodes(timeline).filter(node=>node.type==='time').map(node=>node.props.dateTime),['2026-11-04','2026-11-09']);
 assert.match(text(timeline),/04\/11\/2026Hoje/);
 assert.match(text(timeline),/2 demandas sem prazo válido/);
 assert.doesNotMatch(text(timeline),/Prazo vencido/);
 const buttons=nodes(timeline).filter(node=>node.type==='button');
 assert.equal(buttons.length,3);
 const selected=buttons.find(node=>node.props['aria-expanded']);
 selected.props.onClick();
 assert.deepEqual(opened,['done']);
});
