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
 const module = {exports:{}}; modules.set(file,module.exports);
 const require = name => name === 'react/jsx-runtime' ? {jsx:element,jsxs:element} : name === 'lucide-react' ? new Proxy({}, {get:(_,key)=>String(key)}) : name.endsWith('.module.css') ? {default:new Proxy({}, {get:(_,key)=>String(key)})} : name === '../errors' ? {HttpError:class extends Error{}} : load(name === './work-signals' ? 'components/portal/work-signals.tsx' : name.startsWith('@/') ? name.slice(2)+'.ts' : name);
 const code=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,require,Date,Intl,Number,Math});return module.exports;
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
 const items=nodes(tree).filter(node=>node.type==='dd').map(text);assert.deepEqual(items,['1','1','1']);
});

test('missing server day shows unknown deadline attention instead of a false zero',()=>{
 const tree=TaskPageSummary({tasks:[task('a','open','2026-10-30')],today:''});assert.equal(text(nodes(tree).find(node=>node.type==='dd')),'—');assert.ok(text(tree).includes('Atualize para conferir os prazos'));
});
