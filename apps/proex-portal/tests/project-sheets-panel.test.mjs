import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const tick = () => new Promise(resolve => setImmediate(resolve));
const text = node => typeof node === 'number' || typeof node === 'string' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : '';
const sheetId = 'synthetic_sheet_12345678901234567890', otherSheet = 'other_synthetic_sheet_12345678901234567890';
const credential = {id:'credential-a',label:'Conector da equipe',scope:'read',connection_version:1,created_at:'2026-11-05T12:00:00Z',expires_at:'2026-12-05T12:00:00Z',revoked_at:null,last_used_at:null};
const response = (projectId='project-a',canManage=true) => ({projectId,canManage,connection:{id:'connection-a',projectId,spreadsheetId:sheetId,spreadsheetUrl:`https://docs.google.com/spreadsheets/d/${sheetId}/edit`,label:'Planilha do projeto A',enabled:true,includeTasks:false,version:1,tabsVersion:1,tabs:{items:{gid:0,url:`https://docs.google.com/spreadsheets/d/${sheetId}/edit#gid=0`},followup_tasks:{gid:1,url:`https://docs.google.com/spreadsheets/d/${sheetId}/edit#gid=1`}}},tokens:[credential],scriptUrl:'/integracoes/proex-projeto-planilha.gs'});
const syntheticSecret = 'pxp_synthetic_local_connection_key_123456789';
function harness(props={projectId:'project-a',projectName:'Projeto A'}) {
 let cursor=0, tree, dirty=false; const slots=[], effects=[], timers=new Map(), requests=[], clipboard=[]; let timerId=0;
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,i)=>Object.is(value,b[i]));
 const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;dirty=true;}];},useRef(initial){const i=cursor++;return slots[i]??={current:initial};},useEffect(fn,deps){const i=cursor++,old=slots[i];if(!same(old?.deps,deps)){effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:fn()};});}}};
 const mod={exports:{}},jsx=(type,props)=>({type,props});
 const code=ts.transpileModule(readFileSync(new URL('../components/portal/project-sheets-panel.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 class FormData{constructor(form){this.values=form.values;}get(key){return this.values.get(key)??null;}}
 vm.runInNewContext(code,{module:mod,exports:mod.exports,require:name=>name==='react'?hooks:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='lucide-react'?new Proxy({},{get:(_,key)=>key}):{default:new Proxy({},{get:(_,key)=>key})},URL,Date,Intl,Error,Number,AbortController,FormData,window:{setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id)},navigator:{clipboard:{writeText:async value=>clipboard.push(value)}},localStorage:{setItem(){assert.fail('secrets/preferences must never be persisted by this component');},getItem(){assert.fail('component must not read local storage');}},fetch:(url,init)=>new Promise(resolve=>requests.push({url,init,resolve}))});
 const nodes=()=>{const result=[];const visit=node=>{if(!node||typeof node!=='object')return;if(Array.isArray(node))return node.forEach(visit);result.push(node);visit(node.props?.children);};visit(tree);return result;};
 const h={requests,clipboard,exports:mod.exports,render(patch={}){props={...props,...patch};let n=0;do{cursor=0;dirty=false;tree=mod.exports.default(props);assert.ok(++n<5);}while(dirty);for(const node of nodes())if(node.props?.ref&&!node.props.ref.current)node.props.ref.current={open:false,focus(){},select(){}};effects.splice(0).forEach(fn=>fn());},timers(){const queued=[...timers.values()];timers.clear();queued.forEach(fn=>fn());h.render();},node(type,predicate=()=>true){return nodes().find(node=>node.type===type&&predicate(node));},button(label){const found=h.node('button',node=>text(node)===label||node.props['aria-label']===label);assert.ok(found,label);return found;},click(label){h.button(label).props.onClick();h.render();},body(){return text(tree);},form(title){const found=h.node('form',node=>text(node).startsWith(title));assert.ok(found,title);return found;},submit(title,fields){return h.form(title).props.onSubmit({preventDefault(){},currentTarget:{values:new Map(Object.entries(fields))}});},toggle(open){const node=h.node('details');assert.ok(node);node.props.ref.current.open=open;node.props.onToggle({currentTarget:node.props.ref.current});h.render();},reply(request,body,status=200){request.resolve({ok:status>=200&&status<300,json:async()=>body});},async ready(body=response(),status=200){h.reply(requests.at(-1),body,status);await tick();h.render();},dispose(){slots.forEach(slot=>slot?.cleanup?.());}};
 h.render();h.timers();return h;
}

test('members receive native project sheet links without master access or connection management',async()=>{
 const h=harness();try{const data=response('project-a',false);data.connection.tabs.bad={gid:2,url:`https://docs.google.com/spreadsheets/d/${otherSheet}/edit`};await h.ready(data);
 assert.ok(h.node('a',node=>node.props.href.endsWith('#gid=0')));assert.ok(!h.node('a',node=>node.props.href.endsWith('#gid=1')));assert.ok(!h.node('details'));assert.ok(!h.body().includes('Conector da equipe'));assert.ok(!h.body().includes('Chaves emitidas'));assert.ok(!h.node('a',node=>node.props.href.includes(otherSheet)));
 h.render({projectId:'project-b'});assert.ok(!h.body().includes('Planilha do projeto A'));assert.ok(!h.node('a',node=>node.props.href.includes(sheetId)));h.timers();await h.ready(response('project-b',false));assert.match(h.body(),/Planilha do projeto A/);
 }finally{h.dispose();}
});
test('sheet address parsing accepts only a native Google document and rejects an arbitrary endpoint',()=>{
 const h=harness();try{const parse=h.exports.projectSheetId;assert.equal(parse(sheetId),sheetId);assert.equal(parse(`https://docs.google.com/spreadsheets/d/${sheetId}/edit#gid=0`),sheetId);for(const raw of ['https://evil.test/spreadsheets/d/'+sheetId,'http://docs.google.com/spreadsheets/d/'+sheetId,'https://person:secret@docs.google.com/spreadsheets/d/'+sheetId,'javascript:alert(1)','short'])assert.equal(parse(raw),'');}finally{h.dispose();}
});
test('configure opts out of demand disclosure by default and uses the current connection version',async()=>{
 const h=harness();try{await h.ready({...response(),connection:null,tokens:[]});h.toggle(true);assert.match(h.body(),/Todos com acesso ao arquivo no Google/);assert.equal(h.node('input',node=>node.props.name==='includeTasks').props.defaultChecked,false);
 const saving=h.submit('1. Vincular',{spreadsheet:`https://docs.google.com/spreadsheets/d/${sheetId}/edit`,label:'Planilha A',enabled:'on'});const sent=JSON.parse(h.requests.at(-1).init.body);assert.equal(sent.expectedVersion,0);assert.equal(sent.includeTasks,false);assert.equal(sent.spreadsheetId,sheetId);assert.equal(h.requests.at(-1).init.headers['X-Proex-Action'],'1');await h.ready(response());await saving;h.render();assert.match(h.body(),/Vínculo salvo/);
 }finally{h.dispose();}
});
test('one-time connection key is password-masked, copied explicitly, discarded when closed and never reloaded from metadata',async()=>{
 const h=harness();try{await h.ready();h.toggle(true);const creating=h.submit('2. Autorizar',{scope:'materials',credentialLabel:'Conector A'});await h.ready({id:'credential-new',token:syntheticSecret,expiresAt:'2026-12-05T12:00:00Z',connectionVersion:1});await creating;h.render();let input=h.node('input',node=>node.props.value===syntheticSecret);assert.ok(input);assert.equal(input.props.type,'password');h.click('Mostrar');assert.equal(h.node('input',node=>node.props.value===syntheticSecret).props.type,'text');await h.button('Copiar chave').props.onClick();assert.deepEqual(h.clipboard,[syntheticSecret]);h.toggle(false);assert.ok(!h.node('input',node=>node.props.value===syntheticSecret));h.toggle(true);assert.ok(!h.node('input',node=>node.props.value===syntheticSecret));assert.equal(h.requests.length,2);assert.ok(!h.body().includes(syntheticSecret));
 }finally{h.dispose();}
});
test('late issuance after closing or switching project cannot expose the old key',async()=>{
 for(const mode of ['close','switch']){const h=harness();try{await h.ready();h.toggle(true);const creating=h.submit('2. Autorizar',{scope:'read',credentialLabel:'Conector A'}),pending=h.requests.at(-1);if(mode==='close')h.toggle(false);else{h.render({projectId:'project-b'});h.timers();await h.ready(response('project-b'));}h.reply(pending,{id:'credential-new',token:syntheticSecret,expiresAt:'2026-12-05T12:00:00Z',connectionVersion:1});await creating;h.render();assert.ok(!h.node('input',node=>node.props.value===syntheticSecret));if(mode==='switch')assert.ok(h.node('a',node=>node.props.href.includes(sheetId)));}finally{h.dispose();}}
});
test('revoke requires the explicit row confirmation and a failed request remains retryable',async()=>{
 const h=harness();try{await h.ready();h.toggle(true);h.click('Revogar');assert.equal(h.requests.length,1);assert.match(h.body(),/Interromper esta conexão/);let pending=h.button('Confirmar revogação').props.onClick();await h.ready({error:'Falha sintética de rede'},503);await pending;h.render();assert.match(h.body(),/Falha sintética de rede/);pending=h.button('Confirmar revogação').props.onClick();assert.equal(JSON.parse(h.requests.at(-1).init.body).id,'credential-a');await h.ready({id:'credential-a',revokedAt:'2026-11-05T13:00:00Z'});await pending;h.render();assert.match(h.body(),/Chave revogada/);assert.equal(h.node('button',node=>text(node)==='Revogar'),undefined);
 }finally{h.dispose();}
});
test('wrong project response and malformed issuance produce useful errors without revealing a key',async()=>{
 const h=harness();try{await h.ready(response('foreign-project'));assert.match(h.body(),/não corresponde/);assert.ok(!h.node('a'));h.click('Atualizar vínculo da planilha');h.timers();await h.ready();h.toggle(true);const pending=h.submit('2. Autorizar',{scope:'read',credentialLabel:'Conector A'});await h.ready({token:syntheticSecret,expiresAt:'2026-12-05',connectionVersion:999});await pending;h.render();assert.match(h.body(),/chave recebida está incompleta/);assert.ok(!h.node('input',node=>node.props.value===syntheticSecret));
 }finally{h.dispose();}
});


test('a permission failure on refresh hides the previous links and credentials',async()=>{
 const h=harness();try{await h.ready();h.toggle(true);assert.ok(h.node('a'));h.click('Atualizar lista');h.timers();await h.ready({error:'Acesso revogado.'},403);assert.match(h.body(),/Acesso revogado/);assert.equal(h.node('a'),undefined);assert.equal(h.node('details'),undefined);}finally{h.dispose();}
});
