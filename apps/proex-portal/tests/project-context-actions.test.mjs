import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {compile,teamFixture} from './support/work-teams-fixture.mjs';

const {projectDetail} = await import(compile('lib/projects.ts'));
const {materialsAction} = await import(compile('lib/materials.ts'));
const civil = await import(compile('lib/civil-date.ts'));
const communication = await import(compile('lib/project-communication.ts'));
const tick = () => new Promise(resolve => setImmediate(resolve));
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : '';
const deferred = () => {let resolve; const promise = new Promise(done => resolve = done); return {promise,resolve};};
const source = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const transpile = code => ts.transpileModule(code, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;

function harness(file, props = {}) {
  let index = 0, tree, pending = false, draftClears = 0;
  const slots = [], effects = [], requests = [], exports = [], downloads = [], focused = [];
  const same = (a,b) => a && a.length === b.length && a.every((value,n) => value === b[n]);
  const hooks = {
    useState(initial) {const i=index++; if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial; return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;pending=true;}];},
    useRef(initial) {const i=index++; return slots[i]??={current:initial};},
    useMemo(fn,deps) {const i=index++; if(!same(slots[i]?.deps,deps))slots[i]={deps,value:fn()};return slots[i].value;},
    useCallback(fn,deps) {return hooks.useMemo(()=>fn,deps);},
    useEffect(fn,deps=[]) {const i=index++,old=slots[i];if(!same(old?.deps,deps))effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:fn()};});},
    useLayoutEffect(fn,deps) {hooks.useEffect(fn,deps);},
  };
  class Element {constructor(label=''){this.label=label;this.isConnected=true;this.open=false;}focus(){focused.push(this.label);}scrollIntoView(){}showModal(){this.open=true;}close(){this.open=false;}querySelector(){return new Element('first-input');}}
  class Values {constructor(form){this.values=form?.values??new Map();}get(name){return this.values.get(name)??null;}entries(){return this.values.entries();}}
  const jsx=(type,props,key)=>({type,props,key}),compiledModule={exports:{}};
  const boundary='Boundary';
  const require=name=>name==='react'?hooks:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='lucide-react'?new Proxy({},{get:(_target,key)=>String(key)}):name.endsWith('.css')?{default:new Proxy({},{get:(_target,key)=>String(key)})}:name==='@/lib/civil-date'?civil:name==='@/lib/project-communication'?communication:name==='@/lib/extension-catalog'?{areaLabel:value=>value,lineLabel:value=>value}:name==='./use-form-draft'?{DraftNotice:'DraftNotice',useFormDraft:()=>({clear(){draftClears++;}})}:name==='./document-export'?{documentExport:(...args)=>{const task=deferred();exports.push({...task,args});return task.promise;}}:name==='./report-export'?{download:(...args)=>downloads.push(args)}:name==='./export-formats'?{default:'ExportFormats'}:name==='./project-quick-entry'?{default:'ProjectQuickEntry'}:name==='./reports-center'?{ProjectReportExports:boundary}:name==='sonner'?{toast:{success(){},error(){}}}:{default:boundary};
  vm.runInNewContext(transpile(source(`components/portal/${file}.tsx`)),{module:compiledModule,exports:compiledModule.exports,require,Date,Intl,URL,URLSearchParams,AbortController,crypto,FormData:Values,HTMLElement:Element,document:{activeElement:new Element('launcher')},window:{requestAnimationFrame:fn=>fn(),setTimeout,clearTimeout},setTimeout,clearTimeout,fetch:(url,init)=>new Promise(resolve=>requests.push({url,init,resolve}))});
  const nodes=()=>{const result=[];const visit=node=>{if(!node||typeof node!=='object')return;if(Array.isArray(node))return node.forEach(visit);result.push(node);visit(node.props?.children);};visit(tree);return result;};
  const h={requests,exports,downloads,focused,
    render(patch={}) {props={...props,...patch};let attempts=0;do{pending=false;index=0;effects.length=0;tree=compiledModule.exports.default(props);assert.ok(++attempts<5);}while(pending);for(const node of nodes())if(node.props?.ref&&!node.props.ref.current)node.props.ref.current=new Element(node.props.id??node.props['aria-label']??text(node));effects.splice(0).forEach(fn=>fn());},
    node(type,match=()=>true){return nodes().find(node=>node.type===type&&match(node));},
    button(label){const node=h.node('button',node=>text(node)===label||node.props['aria-label']===label);assert.ok(node,label);return node;},
    click(label){h.button(label).props.onClick();h.render();},
    request(part){return requests.filter(request=>!part||request.url.includes(part)).at(-1);},
    async reply(payload,part,status=200){const request=h.request(part);assert.ok(request,part);request.resolve({ok:status>=200&&status<300,json:async()=>payload});await tick();h.render();},
    submit(values){const form=h.node('form');assert.ok(form);return form.props.onSubmit({preventDefault(){},currentTarget:{values:new Map(Object.entries(values))}});},
    dispose(){slots.forEach(slot=>slot?.cleanup?.());},
    get draftClears(){return draftClears;},
  };h.render();return h;
}

const projectPayload=()=>({project:{id:'project-a',name:'Projeto de exemplo',status:'active',lifecycle:'active',scope:'internal'},links:[],calls:[],schedule:[],versions:[],relatedProjects:[],permissions:{inventoryManage:true,loansManage:true},relationships:{items:[],loans:[],loanEquipment:[{id:'equipment-a',name:'Caixa de som',category:'equipment'}]}});
const consumption=()=>({asOf:'2026-11-06T12:00:00Z',scope:{projectId:'project-a',from:'2026-10-07',to:'2026-11-06'},unit:null,projects:[{id:'project-a',name:'Projeto de exemplo'}],items:[],groups:[{itemId:'item-a',projectId:'project-a',material:'Pastas',measurementUnit:'unidade',kind:'consume',quantity:3,counterpartyType:'unit',counterpartyUnitId:'unit-a',counterpartyName:'Unidade de exemplo'}],movements:[{id:'movement-a',itemId:'item-a',projectId:'project-a',material:'Pastas',measurementUnit:'unidade',kind:'consume',delta:-3,occurredAt:'2026-11-05T12:00:00Z',context:{counterpartyType:'unit',counterpartyId:'unit-a',counterpartyName:'Unidade de exemplo',processReference:'Referência sintética'}}],truncated:false,notice:'Somente projetos autorizados.'});

test('a loans-only profile receives only the minimum reservable equipment catalog and the project modal uses it',async t=>{
  const f=teamFixture(t),owner=await f.actor('owner-a');
  const equipment=(await materialsAction(f.db,owner,'item.create',{projectId:'project-a',name:'Equipamento sintético',category:'equipment',unit:'unidade',lowStock:0,description:'Descrição privada de estoque',operationKey:crypto.randomUUID()})).item;
  f.native.prepare("UPDATE members SET role='loans' WHERE user_id='viewer-a'").run();
  const data=await projectDetail(f.db,await f.actor('viewer-a'),'project-a');
  assert.equal(data.relationships.items,null);assert.equal(data.permissions.inventoryManage,false);assert.equal(data.permissions.loansManage,true);
  assert.equal(data.relationships.loanEquipment[0].id,equipment.id);
  assert.deepEqual(Object.keys(data.relationships.loanEquipment[0]).sort(),['category','id','name']);
  assert.ok(!JSON.stringify(data.relationships.loanEquipment).includes('Descrição privada'));
  const h=harness('project-detail',{projectId:'project-a',projects:[data.project],mutate:async()=>({}),onBack(){},onEdit(){}});try{
    await h.reply(data,'/api/projects/');h.click('Reservar');
    assert.equal(h.node('ProjectQuickEntry').props.items[0].id,equipment.id);
  }finally{h.dispose();}
});

test('a routine refresh keeps the captured quick-entry target mounted rather than reopening an empty form',async()=>{
  const h=harness('project-detail',{projectId:'project-a',refreshKey:1,projects:[projectPayload().project],mutate:async()=>({}),onBack(){},onEdit(){}});try{
    await h.reply(projectPayload(),'/api/projects/');h.click('Adicionar material');
    const before=h.node('ProjectQuickEntry');assert.ok(before);
    h.render({refreshKey:2});const during=h.node('ProjectQuickEntry');assert.ok(during,'same-project refresh must not unmount the modal');
    assert.equal(during.key,before.key);assert.equal(during.props.project.id,'project-a');
    await h.reply(projectPayload(),'/api/projects/');assert.equal(h.node('ProjectQuickEntry').key,before.key);
  }finally{h.dispose();}
});

test('quick-entry saves once while mounted, but a result after navigation unmount cannot select the old material',async()=>{
  for(const leave of [false,true]){
    const saving=deferred(),seen=[],calls=[];
    const h=harness('project-quick-entry',{kind:'material',project:{id:'project-a',name:'Projeto de exemplo'},items:[],mutate:(...args)=>{calls.push(args);return saving.promise;},onClose(){},onSaved:id=>seen.push(id)});
    const result=h.submit({name:'Pasta sintética',category:'gift',unit:'unidade',lowStock:'0'});h.submit({name:'Duplicada'});
    assert.equal(calls.length,1);if(leave)h.dispose();saving.resolve({item:{id:'created-item'}});await result;
    assert.deepEqual(seen,leave?[]:['created-item']);assert.equal(h.draftClears,1);
    if(!leave)h.dispose();
  }
});

test('consumption export cancels a prepared private file after selection, project or mount changes',async()=>{
  for(const change of ['selection','project','unmount']){
    const h=harness('stock-consumption-panel',{projectId:'project-a'});try{
      const data=consumption();await h.reply(data,'/api/materials/consumption?');
      const promise=h.node('ExportFormats').props.onExport('xlsx'),rejection=assert.rejects(promise,/recorte mudou/);
      await h.reply(data,'/api/materials/consumption?');assert.equal(h.exports.length,1);
      if(change==='selection')h.click('Recebimentos');if(change==='project')h.render({projectId:'project-b'});if(change==='unmount')h.dispose();
      h.exports[0].resolve(new Blob(['synthetic']));await rejection;assert.deepEqual(h.downloads,[]);
    }finally{h.dispose();}
  }
});

test('unchanged consumption export rechecks live data after preparation and downloads exactly once',async()=>{
  const h=harness('stock-consumption-panel',{projectId:'project-a'});try{
    const data=consumption();await h.reply(data,'/api/materials/consumption?');
    const promise=h.node('ExportFormats').props.onExport('pdf');await h.reply(data,'/api/materials/consumption?');
    h.exports[0].resolve(new Blob(['synthetic']));await tick();
    await h.reply(data,'/api/materials/consumption?');await promise;
    assert.equal(h.downloads.length,1);assert.equal(h.downloads[0][0],'materiais-operacoes.pdf');
  }finally{h.dispose();}
});

test('records initial project actually scopes the first request and its filter value',()=>{
  const h=harness('records-panel',{initialProjectId:'project-a',projects:[{id:'project-a',name:'Projeto A'},{id:'project-b',name:'Projeto B'}],items:[],loans:[],canWrite:()=>false});try{
    assert.equal(new URL(h.request('/api/records?').url,'https://example.invalid').searchParams.get('projectId'),'project-a');
    assert.ok(h.node('select',node=>node.props.value==='project-a'));
  }finally{h.dispose();}
});

test('actual navigation handlers clear an earlier edit/move mode before opening another context',()=>{
  const file=source('app/portal-client.tsx'),ast=ts.createSourceFile('portal-client.tsx',file,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const declarations=new Map();const visit=node=>{if(ts.isFunctionDeclaration(node)&&node.name)declarations.set(node.name.text,node);ts.forEachChild(node,visit);};visit(ast);
  for(const name of ['applyLocation','navigate','selectProject','selectUnit','selectArea']){
    const calls=[],globals={module:{exports:{}},allowedTabs:[{id:'materials'}],tab:'projects',pushNavigation:{current:false},teamIntentPending:{current:false},setTeamIntent(){},setDeniedModule(){},navigation:{recordVisit(){}},focusModule(){},unitFilter:'',areaFilter:'',personalOrganization:'',projects:[{id:'project-a',organization_id:'org-a'}],unitOf:()=>'',inArea:()=>true};
    for(const setter of ['setTab','setFilter','setDraftProject','setOfferProject','setUnitFilter','setAreaFilter','setWorkRecord','setSelectedMaterialId','setMaterialMode','setSelectedDemandId','setReportInitialDataset','setPersonalStatus','setPersonalOrganization','setQuery','setAccountOpen'])globals[setter]=value=>calls.push([setter,value]);
    vm.runInNewContext(transpile(declarations.get(name).getText(ast))+`\nmodule.exports=${name};`,globals);
    globals.module.exports(name==='applyLocation'?{tab:'materials',project:'project-a',unit:'',area:'',record:{module:'materials',recordId:'item-b'},demand:'',report:'projects'}:name==='navigate'?'materials':name==='selectProject'?'project-a':'new-context');
    assert.ok(calls.some(([setter,value])=>setter==='setMaterialMode'&&value==='view'),name);
  }
});
