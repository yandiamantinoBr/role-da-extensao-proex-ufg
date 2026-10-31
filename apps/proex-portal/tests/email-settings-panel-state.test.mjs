import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const text=node=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):'';
const token='pne_'+'s'.repeat(43),expiry=new Date(Date.now()+86400000).toISOString();
function status(org='org-a',manager=true,tokens=[]){return{organizationId:org,canManage:manager,organizationEnabled:false,self:{email:'synthetic@example.invalid',enabled:false},configuration:manager?{enabled:false,version:1,senderEmail:'sender@example.invalid',portalOrigin:'https://example.invalid',dailyLimit:50,personDailyLimit:3,eventLimit:100,intervalSeconds:300}:null,notice:'Synthetic status',...(manager?{dispatchTokens:tokens,queue:[],state:null,uncertain:[]}:{})};}
const tokenRow=()=>({id:'token-a',label:'Synthetic token',expires_at:expiry,expired:0,revoked_at:null});
function harness(options={}){
 const slots=[],effects=[],timers=new Map(),requests=[],storageWrites=[],clipboard=[];let index=0,tree,next=0,organizationId='org-a';
 const hooks={useState(initial){const i=index++;if(!(i in slots))slots[i]=initial;return[slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value];},useRef(initial){const i=index++;slots[i]??={current:initial};return slots[i];},useCallback(fn,deps){const i=index++,old=slots[i];if(!old||deps.some((v,n)=>v!==old.deps[n]))slots[i]={deps,value:fn};return slots[i].value;},useEffect(fn,deps){const i=index++,old=slots[i];if(!old||deps.some((v,n)=>v!==old.deps[n]))effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:fn()};});}};
 const modules=new Map(),jsx={jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key})};
 function load(file){if(modules.has(file))return modules.get(file);const compiledModule={exports:{}};modules.set(file,compiledModule.exports);const source=readFileSync(new URL('../components/portal/'+file,import.meta.url),'utf8')+(file.endsWith('panel.tsx')?'\nexport {EmailForm};':'');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const storage={setItem(...values){storageWrites.push(values);},getItem(){return null;},removeItem(){}};
 vm.runInNewContext(code,{module:compiledModule,exports:compiledModule.exports,require:name=>name==='react'?hooks:name==='react/jsx-runtime'?jsx:load('email-settings-api.ts'),Date,JSON,Error,AbortController,encodeURIComponent,localStorage:storage,sessionStorage:storage,window:{getSelection:()=>({removeAllRanges(){},addRange(){}}),setTimeout(fn){const id=++next;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)},document:{createRange:()=>({selectNodeContents(){}})},navigator:options.unavailableClipboard?{}:{clipboard:{writeText:async value=>{clipboard.push(value);if(options.copyError)throw new Error('private-clipboard-error-'+token);if(options.copyPromise)await options.copyPromise;}}},fetch:(url,init)=>new Promise(resolve=>requests.push({url,init,resolve}))});return compiledModule.exports;}
 const Component=load('email-settings-panel.tsx').EmailForm,api=load('email-settings-api.ts');
 const nodes=()=>{const out=[];const visit=node=>{if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(visit);return;}out.push(node);visit(node.props?.children);};visit(tree);return out;};
 const h={requests,storageWrites,clipboard,api,render(org=organizationId){organizationId=org;index=0;tree=Component({organizationId});effects.splice(0).forEach(fn=>fn());},flush(){for(const[id,fn]of [...timers]){timers.delete(id);fn();}},reply(index,data,ok=true,httpStatus=200){requests[index].resolve({ok,status:httpStatus,json:async()=>data});},bodyFailure(index,error,ok=true){requests[index].resolve({ok,status:200,json:async()=>{throw error;}});},button(name){const node=nodes().find(n=>n.type==='button'&&text(n)===name);assert.ok(node,name);return node;},hasButton(name){return nodes().some(n=>n.type==='button'&&text(n)===name);},confirmStored(){const label=nodes().find(n=>n.type==='label'&&text(n).includes('Conferi no destino'));assert.ok(label);const input=Array.isArray(label.props.children)?label.props.children.find(n=>n?.type==='input'):label.props.children;input.props.onChange({target:{checked:true}});},selectable(){const node=nodes().find(n=>n.type==='code');assert.ok(node);node.props.ref.current={focus(){}};return node;},body(){return text(tree);},dispose(){slots.forEach(slot=>slot?.cleanup?.());}};h.render();h.flush();return h;
}
async function ready(h){h.reply(0,status());await tick();h.render();}
async function create(h){h.button('Criar credencial restrita de avisos').props.onClick();const post=h.requests.length-1;h.reply(post,{id:'token-a',label:'Synthetic token',token,expiresAt:expiry,organizationId:'org-a'});await tick();return h.requests.length-1;}

test('a valid token is shown only after fresh authorized metadata, remains copyable once, and never enters browser storage',async()=>{
 const h=harness();try{await ready(h);const refresh=await create(h);h.render();assert.ok(!h.body().includes(token));h.reply(refresh,status('org-a',true,[tokenRow()]));await tick();h.render();assert.ok(h.body().includes(token));h.button('Copiar credencial').props.onClick();await tick();assert.deepEqual(h.clipboard,[token]);assert.deepEqual(h.storageWrites,[]);h.render();assert.match(h.body(),/navegador confirmou/);assert.equal(h.button('Já guardei').props.disabled,true);h.button('Já guardei').props.onClick();h.render();assert.ok(h.body().includes(token));h.confirmStored();h.render();h.button('Já guardei').props.onClick();h.render();assert.ok(!h.body().includes(token));h.button('Atualizar estado').props.onClick();h.render();assert.ok(!h.hasButton('Criar credencial restrita de avisos'));h.reply(h.requests.length-1,status('org-a',true,[tokenRow()]));await tick();h.render();assert.ok(!h.body().includes(token));}finally{h.dispose();}
});

test('403 after refresh removes old management and token; restored authority cannot reveal the old plaintext',async()=>{
 const h=harness();try{await ready(h);h.reply(await create(h),status('org-a',true,[tokenRow()]));await tick();h.render();assert.ok(h.body().includes(token));h.button('Atualizar estado').props.onClick();h.render();assert.ok(!h.body().includes(token));h.reply(h.requests.length-1,{error:'Acesso revogado.'},false,403);await tick();h.render();assert.ok(h.body().includes('Acesso revogado.'));assert.ok(!h.body().includes(token));assert.ok(!h.hasButton('Criar credencial restrita de avisos'));h.button('Atualizar estado').props.onClick();h.reply(h.requests.length-1,status());await tick();h.render();assert.ok(!h.body().includes(token));}finally{h.dispose();}
});

test('loss of canManage during the post-create recheck never exposes the token',async()=>{
 const h=harness();try{await ready(h);h.reply(await create(h),status('org-a',false));await tick();h.render();assert.ok(!h.body().includes(token));assert.ok(!h.hasButton('Criar credencial restrita de avisos'));}finally{h.dispose();}
});

test('malformed GET and POST200 contracts cannot crash or report success; a wrong organization is rejected',async()=>{
 for(const value of [{},{...status(),self:{}},status('org-b')]){const h=harness();try{h.reply(0,value);await tick();assert.doesNotThrow(()=>h.render());assert.ok(!h.hasButton('Criar credencial restrita de avisos'));}finally{h.dispose();}}
 const h=harness();try{await ready(h);h.button('Criar credencial restrita de avisos').props.onClick();h.reply(1,{});await tick();h.render();assert.ok(!h.body().includes('Atualizado.'));assert.ok(!h.hasButton('Criar credencial restrita de avisos'));}finally{h.dispose();}
});

test('switching organization aborts a pending mutation and ignores its late token/body',async()=>{
 const h=harness();try{await ready(h);h.button('Criar credencial restrita de avisos').props.onClick();const old=h.requests[1];h.render('org-b');assert.ok(!h.body().includes('synthetic@example.invalid'));assert.equal(old.init.signal.aborted,true);h.flush();h.reply(1,{id:'token-a',label:'Synthetic token',token,expiresAt:expiry,organizationId:'org-a'});h.reply(2,status('org-b'));await tick();h.render();assert.ok(!h.body().includes(token));assert.ok(h.hasButton('Criar credencial restrita de avisos'));assert.equal(JSON.parse(h.requests[1].init.body).organizationId,'org-a');assert.ok(h.requests[2].url.endsWith('org-b'));}finally{h.dispose();}
});

test('an unmounted account cannot receive a late token and the new account starts without old state',async()=>{
 const old=harness(),fresh=harness();try{await ready(old);old.button('Criar credencial restrita de avisos').props.onClick();old.dispose();old.reply(1,{id:'token-a',label:'Synthetic token',token,expiresAt:expiry,organizationId:'org-a'});fresh.reply(0,status());await tick();fresh.render();assert.ok(!fresh.body().includes(token));assert.equal(old.requests.length,2);assert.deepEqual(fresh.storageWrites,[]);}finally{fresh.dispose();}
});

test('the helper preserves AbortError, rejects truncated JSON and validates every mutation action contract',async()=>{
 const h=harness();try{h.reply(0,status());await tick();h.render();
 let promise=h.api.loadEmailStatus('org-a');const abort=new Error('Aborted body');abort.name='AbortError';h.bodyFailure(h.requests.length-1,abort);await assert.rejects(promise,error=>error===abort);
 promise=h.api.loadEmailStatus('org-a');h.bodyFailure(h.requests.length-1,new SyntaxError('truncated'));await assert.rejects(promise,/incompleta/);
 for(const action of ['configure','preference','token.create','token.revoke','reconcile']){promise=h.api.updateEmailSettings('org-a',{action});h.reply(h.requests.length-1,{});await assert.rejects(promise);}
 const responses=[['configure',{ok:true,version:2}],['preference',{ok:true}],['token.revoke',{ok:true}],['reconcile',{ok:true,retry:false,meaning:'manual_attestation_no_delivery_proof'}]];
 for(const[action,response]of responses){promise=h.api.updateEmailSettings('org-a',{action});h.reply(h.requests.length-1,response);assert.equal((await promise).kind,'updated');}
 promise=h.api.updateEmailSettings('org-a',{action:'token.create'});h.reply(h.requests.length-1,{id:'token-a',label:'Synthetic',token,expiresAt:expiry,organizationId:'org-b'});await assert.rejects(promise);
 }finally{h.dispose();}
});


test('copy rejection or unavailable API keeps the credential visible, exposes manual selection and never echoes the private error',async()=>{
 for(const options of [{copyError:true},{unavailableClipboard:true}]){const h=harness(options);try{await ready(h);h.reply(await create(h),status('org-a',true,[tokenRow()]));await tick();h.render();h.button('Copiar credencial').props.onClick();await tick();h.render();assert.match(h.body(),/Não foi possível copiar automaticamente/);assert.ok(h.body().includes(token));assert.ok(!h.body().includes('private-clipboard-error'));assert.equal(h.button('Já guardei').props.disabled,true);h.selectable();h.button('Selecionar credencial').props.onClick();h.render();assert.match(h.body(),/Credencial selecionada/);h.confirmStored();h.render();h.button('Já guardei').props.onClick();h.render();assert.ok(!h.body().includes(token));assert.deepEqual(h.storageWrites,[]);}finally{h.dispose();}}
});
test('clipboard is awaited, double clicks dedupe, and a late result cannot restore token feedback after403',async()=>{
 let complete;const h=harness({copyPromise:new Promise(resolve=>complete=resolve)});try{await ready(h);h.reply(await create(h),status('org-a',true,[tokenRow()]));await tick();h.render();const copy=h.button('Copiar credencial');copy.props.onClick();copy.props.onClick();h.render();assert.equal(h.clipboard.length,1);assert.ok(h.hasButton('Copiando…'));assert.equal(h.button('Já guardei').props.disabled,true);h.button('Atualizar estado').props.onClick();h.reply(h.requests.length-1,{error:'Acesso revogado.'},false,403);await tick();complete();await tick();h.render();assert.ok(!h.body().includes(token));assert.ok(!h.body().includes('navegador confirmou'));assert.match(h.body(),/Acesso revogado/);}finally{h.dispose();}
});
