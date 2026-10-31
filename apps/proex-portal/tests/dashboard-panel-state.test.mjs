import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const text=node=>typeof node==='number'?String(node):typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):'';
function harness(overrides={}){
 let tree,index=0;const slots=[],cache=new Map(),seen=[],pins=[];
 const hooks={useState(initial){const i=index++;if(!(i in slots))slots[i]=initial;return[slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value];}};
 const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
 function load(name){if(cache.has(name))return cache.get(name);const compiledModule={exports:{}};const require=name=>name==='react'?hooks:name==='react/jsx-runtime'?jsx:name==='lucide-react'?new Proxy({},{get:(_target,key)=>String(key)}):load(name.replace('./',''));const source=ts.transpileModule(readFileSync(new URL('../components/portal/'+name+'.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;vm.runInNewContext(source,{module:compiledModule,exports:compiledModule.exports,require,Date,Number,Boolean,String,Set,Map});cache.set(name,compiledModule.exports);return compiledModule.exports;}
 const navigationSource=ts.transpileModule(readFileSync(new URL('../components/portal/navigation-model.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,navigation={exports:{}};vm.runInNewContext(navigationSource,{module:navigation,exports:navigation.exports,require:()=>new Proxy({},{get:(_target,key)=>String(key)})});cache.set('navigation-model',navigation.exports);
 const props={modules:navigation.exports.PORTAL_MODULES,pinned:['reports','records','team','calendar'],frequent:['events'],onNavigate:id=>seen.push(id),onTogglePin:id=>pins.push(id),displayName:'Pessoa QA',role:'owner',roleLabel:'Responsável institucional',projects:[{id:'a',name:'Projeto A',scope:'internal'},{id:'b',name:'Projeto B',scope:'internal'},{id:'c',name:'Projeto C',scope:'external'}],items:[{id:'item-a',category:'gift',condition:'active',stock:0,reserved:0,low_stock:2},{id:'item-b',category:'gift',condition:'active',stock:10,reserved:0,low_stock:2}],loans:[{id:'out',status:'out',ends_at:'2026-10-30T00:00:00Z'},{id:'reserved',status:'reserved',starts_at:'2026-11-02T12:00:00Z',action_name:'Retirada futura'}],campaigns:[{id:'active',status:'active'},{id:'draft',status:'draft'}],selectedProjectId:'',now:Date.parse('2026-10-31T12:00:00Z'),onSelectProject:id=>seen.push('project:'+id),known:{projects:true,items:true,loans:true,campaigns:true},...overrides};
 const Component=load('dashboard-panel');const Dashboard=Component.default;
 const nodes=()=>{const result=[];const visit=node=>{if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(visit);return;}result.push(node);visit(node.props?.children);};visit(tree);return result;};
 const h={seen,pins,props,render(){index=0;tree=Dashboard(props);},nodes,body:()=>text(tree),find(type,predicate){return nodes().find(node=>node.type===type&&predicate(node));},summaries(){return nodes().filter(node=>node.type==='button'&&node.props.className==='pd-summary');}};h.render();return h;
}
function summary(h,title){return h.summaries().find(node=>text(node.props.children[0])===title);}
function count(node){return text(node.props.children.find(child=>child?.type==='strong'));}

test('one summary retains every allowed numeric indicator even when personal shortcuts favor other modules',()=>{
 const h=harness();assert.equal(h.find('section',node=>node.props.className==='pd-welcome'),undefined);assert.ok(!h.body().includes('Seu próximo passo'));assert.match(h.body(),/Responsável institucional · Somente registros disponíveis para sua conta/);assert.equal(h.summaries().length,4);
 for(const[title,value]of [['Projetos','3'],['Materiais','2'],['Empréstimos','2'],['Dinâmicas','1']])assert.equal(count(summary(h,title)),value);
 assert.match(text(summary(h,'Projetos')),/2 internos · 1 externo/);assert.match(text(summary(h,'Empréstimos')),/1 retirados · 1 reservados/);assert.match(text(summary(h,'Empréstimos')),/1 em atraso/);assert.match(h.body(),/1 devolução em atraso/);assert.match(h.body(),/1 material com saldo baixo/);assert.match(h.body(),/Retirada futura/);summary(h,'Materiais').props.onClick();assert.deepEqual(h.seen,['materials']);
});
test('selected project counts, absent datasets and unavailable modules keep their distinct meanings',()=>{
 const h=harness({selectedProjectId:'c',modules:[{id:'projects',icon:'Projects'},{id:'materials',icon:'Materials'},{id:'calendar',icon:'Calendar'}],items:[],known:{projects:true,items:false,loans:false,campaigns:false}});assert.equal(count(summary(h,'Projetos')),'1');assert.match(text(summary(h,'Projetos')),/0 internos · 1 externo/);assert.equal(count(summary(h,'Materiais')),'Consultar');assert.equal(summary(h,'Empréstimos'),undefined);assert.equal(summary(h,'Dinâmicas'),undefined);assert.match(h.body(),/Resumo · Projeto C/);
 const empty=harness({modules:[{id:'projects',icon:'Projects'}],projects:[],items:[],loans:[],campaigns:[],pinned:[],frequent:[]});assert.equal(count(summary(empty,'Projetos')),'0');assert.match(empty.body(),/Seus projetos aparecerão aqui/);
});
test('personal shortcut controls, role recommendations and project navigation remain actionable after removing the hero',()=>{
 const h=harness();assert.match(h.body(),/Seus atalhos/);h.find('button',node=>node.props['aria-label']==='Remover Relatórios dos atalhos').props.onClick();assert.deepEqual(h.pins,['reports']);h.find('button',node=>text(node)==='Personalizar').props.onClick();h.render();assert.match(h.body(),/Deixe o início com a sua cara, Pessoa/);h.find('button',node=>node.props.className==='pd-shortcut-link'&&text(node).startsWith('Relatórios')).props.onClick();assert.deepEqual(h.seen,['reports']);h.find('button',node=>node.props['aria-pressed']===false&&text(node).includes('Projeto C')).props.onClick();assert.deepEqual(h.seen,['reports','project:c']);
 const inventory=harness({pinned:[],frequent:[],role:'inventory'});assert.match(inventory.body(),/Para começar/);assert.equal(text(inventory.find('button',node=>node.props.className==='pd-shortcut-link')).startsWith('Materiais'),true);
});
