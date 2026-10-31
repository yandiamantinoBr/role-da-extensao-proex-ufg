import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=ts.createSourceFile('portal-client.tsx',readFileSync(new URL('../app/portal-client.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function find(predicate){let found;function visit(node){if(predicate(node)){found=node;return;}if(!found)ts.forEachChild(node,visit);}visit(source);assert.ok(found);return found;}
const declaration=name=>find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name).getText(source);
const initializer=name=>find(node=>ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text===name).initializer.getText(source);
const scope=find(node=>ts.isJsxElement(node)&&node.openingElement.tagName.getText(source)==='section'&&node.openingElement.getText(source).includes('p-scope-filters'));
const countLoop=find(node=>ts.isForOfStatement(node)&&node.getText(source).includes('unitCounts.set'));
const materialButtons=[];function collect(node){if(ts.isJsxElement(node)&&node.openingElement.tagName.getText(source)==='button'&&node.openingElement.getText(source).includes('setSelectedMaterialId(string(i.id))'))materialButtons.push(node.getText(source));ts.forEachChild(node,collect);}collect(source);
const program=ts.transpileModule(`
const string=${initializer('string')},get=${initializer('get')};
const unitOf=${initializer('unitOf')},areaOf=${initializer('areaOf')},inUnit=${initializer('inUnit')},inArea=${initializer('inArea')};
${declaration('Field')}
${declaration('selectProject')}
${declaration('selectUnit')}
${declaration('selectArea')}
${declaration('clearScope')}
function render(){const hasUnassignedProjects=${initializer('hasUnassignedProjects')},scopedProjects=${initializer('scopedProjects')};const unitCounts=new Map(),areaCounts=new Map();${countLoop.getText(source)}return ${scope.getText(source)};}
function renderMaterial(){return [${materialButtons.join(',')}];}
capture({render,renderMaterial});
`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const text=node=>typeof node==='number'?String(node):typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):'';
function harness(){let routines,tree;const selected=[];const context={exports:{},require:()=>({jsx:(type,props)=>typeof type==='function'?type(props):{type,props},jsxs:(type,props)=>typeof type==='function'?type(props):{type,props}}),Map,Set,String,Number,Boolean,X:'X',ArrowRight:'ArrowRight',scopeStyles:new Proxy({},{get:(_target,key)=>String(key)}),filter:'a',unitFilter:'',areaFilter:'',projects:[{id:'a',name:'Projeto A',unit_id:'ua',thematic_area:'communication'},{id:'b',name:'Projeto B',unit_id:'ub',thematic_area:'culture'},{id:'c',name:'Projeto sem vínculo',unit_id:null,thematic_area:null}],visibleUnits:[{id:'ua',name:'Unidade A',acronym:'UA'},{id:'ub',name:'Unidade B',status:'archived'}],unitGroups:[{group:'Unidades',units:[{id:'ua',name:'Unidade A',acronym:'UA'},{id:'ub',name:'Unidade B',status:'archived'}]}],THEMATIC_AREAS:[{key:'communication',label:'Comunicação'},{key:'culture',label:'Cultura'},{key:'education',label:'Educação'}],i:{id:37,name:'Material de demonstração'},draftProject:'old-draft',offerProject:'old-offer',query:'old-search',setSelectedMaterialId:value=>selected.push(value),setUnitFilter:value=>context.unitFilter=value,setAreaFilter:value=>context.areaFilter=value,setFilter:value=>context.filter=value,setDraftProject:value=>context.draftProject=value,setOfferProject:value=>context.offerProject=value,setQuery:value=>context.query=value,capture:value=>routines=value};vm.runInNewContext(program,context);
 const nodes=()=>{const result=[];const visit=node=>{if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(visit);return;}result.push(node);visit(node.props?.children);};visit(tree);return result;};
 const h={context,selected,render(){tree=routines.render();},nodes,find(type,predicate=()=>true){return nodes().find(node=>node.type===type&&predicate(node));},select(label,value){const field=h.find('label',node=>text(node.props.children[0])===label);assert.ok(field,label);field.props.children[1].props.onChange({target:{value}});h.render();},materialButtons:()=>routines.renderMaterial()};h.render();return h;
}

test('native context disclosure preserves exact options, counts and current selections while handlers clear incompatible project drafts',()=>{
 const h=harness(),options=()=>h.nodes().filter(node=>node.type==='option');assert.equal(h.find('details').props.open,undefined);assert.equal(h.find('summary').props.onClick,undefined);assert.equal(h.nodes().filter(node=>node.type==='label').length,3);assert.ok(options().some(node=>node.props.value==='__unassigned__'&&text(node)==='Sem unidade vinculada (1)'));assert.ok(options().some(node=>node.props.value==='ub'&&text(node)==='Unidade B (arquivada) (1)'));assert.equal(options().find(node=>node.props.value==='education').props.disabled,true);
 h.select('Unidade responsável','ua');assert.equal(h.context.filter,'');assert.equal(h.context.draftProject,'');assert.equal(h.context.offerProject,'');assert.equal(h.context.query,'');assert.match(text(h.find('summary')),/Refinar contexto.*UA/s);assert.ok(options().some(node=>node.props.value==='communication'&&text(node)==='Comunicação (1)'));
 h.select('Área temática','culture');assert.equal(h.context.filter,'');assert.match(text(h.find('summary')),/UA · Cultura/);h.render();assert.equal(h.find('details').props.open,undefined);h.find('button',node=>text(node)==='Limpar filtros').props.onClick();h.render();assert.equal(h.context.filter,'');assert.equal(h.context.unitFilter,'');assert.equal(h.context.areaFilter,'');assert.equal(text(h.find('summary')).trim(),'Refinar contexto');
 h.select('Projeto','not-authorized');assert.equal(h.context.filter,'','unknown project cannot become a filter');h.select('Projeto','b');assert.equal(h.context.filter,'b');assert.equal(h.context.draftProject,'b');assert.equal(h.context.offerProject,'');
});
test('material name and final Details action open the same existing detail state without navigation or extra requests',()=>{
 const h=harness(),buttons=h.materialButtons();assert.equal(buttons.length,2);const name=buttons.find(node=>text(node)==='Material de demonstração'),detail=buttons.find(node=>text(node).startsWith('Detalhes'));assert.ok(name);assert.ok(detail);assert.equal(name.props.type,'button');assert.equal(name.props['aria-label'],'Abrir detalhes de Material de demonstração');assert.equal(name.props.className,'p-text-link');name.props.onClick();detail.props.onClick();assert.deepEqual(h.selected,['37','37']);
});
