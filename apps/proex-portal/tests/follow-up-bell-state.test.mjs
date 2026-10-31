import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const text=node=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):'';
function harness(){
 let now=0,index=0,tree,props={userId:'user-a'},nextTimer=1;const slots=[],timers=new Map(),listeners=new Map(),requests=[],modules=new Map(),document={visibilityState:'visible'};
 const on=(name,fn)=>listeners.set(name,fn),off=(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name);};
 document.addEventListener=on;document.removeEventListener=off;
 const window={location:{origin:'http://127.0.0.1:5173'},addEventListener:on,removeEventListener:off,setInterval(fn,delay){const id=nextTimer++;timers.set(id,{fn,delay,interval:true});return id;},setTimeout(fn,delay){const id=nextTimer++;timers.set(id,{fn,delay});return id;}};
 const clear=id=>timers.delete(id),hooks={useState(initial){const i=index++;if(!(i in slots))slots[i]=initial;return[slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value];},useRef(initial){const i=index++;slots[i]??={current:initial};return slots[i];},useEffect(fn,deps){const i=index++,old=slots[i];if(!old||deps.some((v,n)=>v!==old.deps[n])){old?.cleanup?.();slots[i]={deps,cleanup:fn()};}}};
 function load(name){if(modules.has(name))return modules.get(name);const compiledModule={exports:{}};modules.set(name,compiledModule.exports);const require=name=>name==='react'?hooks:name==='react/jsx-runtime'?{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}:name==='lucide-react'?new Proxy({},{get:(_t,key)=>String(key)}):load('components/portal/'+name.replace('./','')+'.ts');
 const code=ts.transpileModule(readFileSync(new URL('../'+name,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{module:compiledModule,exports:compiledModule.exports,require,URL,Date:class extends Date{static now(){return now;}},Intl,AbortController,Event,JSON,window,document,clearInterval:clear,clearTimeout:clear,fetch:(url,init)=>new Promise(resolve=>requests.push({url,init,resolve}))});return compiledModule.exports;
 }
 const Component=load('components/portal/notification-bell.tsx').default;
 const nodes=()=>{const result=[];const visit=node=>{if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(visit);return;}result.push(node);visit(node.props?.children);};visit(tree);return result;};
 const h={requests,timers,document,render(next){props={...props,...next};index=0;tree=Component(props);return tree;},emit(name){listeners.get(name)?.();},advance(ms){now+=ms;},start(){for(const[id,timer]of timers)if(!timer.interval){timers.delete(id);timer.fn();}},interval(){for(const timer of timers.values())if(timer.interval)timer.fn();},reply(i,data){requests[i].resolve({ok:true,json:async()=>data});},button(name){const found=nodes().find(node=>node.type==='button'&&(node.props['aria-label']===name||text(node)===name));assert.ok(found,name);return found;},body(){return text(tree);},dispose(){for(const slot of slots)slot?.cleanup?.();}};
 h.render();return h;
}
const inbox=(title='Aviso A')=>({notifications:[{id:'notice-a',task_id:'task-a',title,status:'open',priority:'high',due_at:'2026-11-01',read_at:null,created_at:'2026-10-31T12:00:00Z'}],unread:1,hasMore:false,pending:[],pendingHasMore:false});

test('bell deduplicates pending fetches, pauses hidden tabs, throttles refreshes and performs no automatic writes',async()=>{
 const h=harness();try{h.start();assert.equal(h.requests.length,1);h.emit('focus');h.emit('proex:followup-changed');assert.equal(h.requests.length,1);h.reply(0,inbox());await tick();assert.equal(h.requests.length,2,'one queued refresh retains the mutation invalidation');h.reply(1,inbox());await tick();h.emit('focus');h.interval();assert.equal(h.requests.length,2);h.advance(60000);h.document.visibilityState='hidden';h.interval();h.emit('proex:followup-changed');assert.equal(h.requests.length,2);h.document.visibilityState='visible';h.emit('visibilitychange');assert.equal(h.requests.length,3);assert.ok(h.requests.every(r=>r.init.method==='GET'));assert.ok([...h.timers.values()].filter(t=>t.interval).every(t=>t.delay>=60000));}finally{h.dispose();}
});

test('changing account hides the previous inbox and aborts its request; reading requires an explicit action',async()=>{
 const h=harness();try{h.start();h.reply(0,inbox());await tick();h.render();h.button('Notificações: 1 não lidas').props.onClick();h.render();assert.ok(h.body().includes('Aviso A'));assert.equal(h.requests.length,2);const previous=h.requests[1];h.render({userId:'user-b'});assert.equal(previous.init.signal.aborted,true);assert.ok(!h.body().includes('Aviso A'));h.start();assert.equal(h.requests.length,3);h.reply(2,inbox('Aviso B'));await tick();h.render();h.button('Marcar todas como lidas').props.onClick();assert.equal(h.requests[3].init.method,'POST');assert.equal(JSON.parse(h.requests[3].init.body).action,'notification.read');assert.ok(!JSON.stringify(h.requests[3].init.body).includes('user-a'));}finally{h.dispose();}
});
