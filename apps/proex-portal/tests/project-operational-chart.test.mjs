import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const mod={exports:{}};
const code=ts.transpileModule(readFileSync(new URL('../components/portal/project-operational-chart.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
vm.runInNewContext(code,{module:mod,exports:mod.exports,require:name=>name==='lucide-react'?new Proxy({},{get:(_,key)=>key}):name==='react/jsx-runtime'?{jsx(){},jsxs(){}}:{},Date,Number});
const datasets=props=>mod.exports.projectOperationalDatasets({projectId:'project-a',schedule:[],now:Date.parse('2026-11-05T12:00:00Z'),...props});
test('project graphics never expose an unauthorized relationship as a zero-count dataset',()=>{
 assert.deepEqual(Array.from(datasets({items:null,loans:null}),row=>row.id),['schedule']);
 assert.deepEqual(Array.from(datasets({items:[],loans:[]}),row=>row.id),['schedule','materials','loans']);
});
test('material bars count distinct records without adding incompatible units',()=>{
 const result=datasets({items:[{id:'water',condition:'active',stock:1000,unit:'caixa',available:2,low_stock:4},{id:'vest',condition:'active',stock:30,unit:'unidade',available:20,low_stock:3},{id:'repair',condition:'maintenance',available:0},{id:'unknown',condition:'active',available:null},{id:'out-on-loan',category:'equipment',condition:'active',stock:1,available:0,low_stock:0}]}).find(row=>row.id==='materials');
 assert.equal(result.rows.length,5); assert.deepEqual(Array.from(result.groups,row=>row.rows.length),[1,1,1,2]);
 assert.equal(result.groups.flatMap(row=>Array.from(row.rows)).length,5);
});
test('loan categories are disjoint and invalid dates never imply lateness',()=>{
 const result=datasets({loans:[{id:'late',status:'out',ends_at:'2026-11-04'},{id:'future',status:'out',ends_at:'2026-11-06'},{id:'missing',status:'out',ends_at:null},{id:'reserved',status:'reserved',ends_at:'2026-11-04'},{id:'returned',status:'returned',ends_at:'2026-11-04'},{id:'cancelled',status:'cancelled'}]}).find(row=>row.id==='loans');
 assert.deepEqual(Array.from(result.groups,row=>row.rows.length),[1,3,1,1]);
 assert.equal(result.unit,'empréstimos carregados · até 100 mais recentes');
});
test('overview variant (Início and Materiais) omits activities, keeps null datasets absent and labels loans by scope',()=>{
 assert.deepEqual(Array.from(datasets({schedule:null,items:null,loans:null,variant:'overview'}),row=>row.id),[]);
 assert.deepEqual(Array.from(datasets({schedule:null,items:[],loans:null,variant:'overview'}),row=>row.id),['materials']);
 const result=datasets({schedule:null,items:[{id:'a',condition:'active',available:0,low_stock:1,project_id:'p1'}],loans:[{id:'l',status:'returned',project_id:'p2'}],variant:'overview'});
 assert.deepEqual(Array.from(result,row=>row.id),['materials','loans']);
 assert.equal(result.find(row=>row.id==='loans').unit,'empréstimos nos projetos selecionados');
 assert.equal(result.find(row=>row.id==='materials').groups[0].rows[0].project_id,'p1');
});
