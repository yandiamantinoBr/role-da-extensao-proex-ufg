import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const text=node=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?(node.props?.hidden||node.props?.style?.display==='none'?'':text(node.props?.children)):'';
function harness(){
 let now=0,index=0,tree,props={userId:'user-a'},nextTimer=1;const slots=[],timers=new Map(),listeners=new Map(),requests=[],modules=new Map(),document={visibilityState:'visible'};
 const on=(name,fn)=>listeners.set(name,fn),off=(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name);};
 document.addEventListener=on;document.removeEventListener=off;
 const window={location:{origin:'http://127.0.0.1:5173'},dispatchEvent(event){listeners.get(event.type)?.(event);},addEventListener:on,removeEventListener:off,setInterval(fn,delay){const id=nextTimer++;timers.set(id,{fn,delay,interval:true});return id;},setTimeout(fn,delay){const id=nextTimer++;timers.set(id,{fn,delay});return id;}};
 const clear=id=>timers.delete(id),hooks={useState(initial){const i=index++;if(!(i in slots))slots[i]=initial;return[slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value];},useRef(initial){const i=index++;slots[i]??={current:initial};return slots[i];},useEffect(fn,deps){const i=index++,old=slots[i];if(!old||deps.some((v,n)=>v!==old.deps[n])){old?.cleanup?.();slots[i]={deps,cleanup:fn()};}}};
 function load(name){if(modules.has(name))return modules.get(name);const compiledModule={exports:{}};modules.set(name,compiledModule.exports);const require=name=>name.endsWith('.module.css')?{default:new Proxy({},{get:(_target,key)=>String(key)})}:name==='react'?hooks:name==='next/link'?{default:'a'}:name==='./material-attention-inbox'?{default:'MaterialAttentionInbox',MATERIAL_ATTENTION_CHANGED:'proex:material-attention-changed'}:name==='./work-signals'?{TaskSignals:'task-signals'}:name==='react/jsx-runtime'?{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}:name==='lucide-react'?new Proxy({},{get:(_t,key)=>String(key)}):load(name==='../../lib/follow-up/notification-groups'?'lib/follow-up/notification-groups.ts':'components/portal/'+name.replace('./','')+'.ts');
 const code=ts.transpileModule(readFileSync(new URL('../'+name,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{module:compiledModule,exports:compiledModule.exports,require,URL,URLSearchParams,Date:class extends Date{static now(){return now;}},Intl,AbortController,Event,JSON,window,document,clearInterval:clear,clearTimeout:clear,fetch:(url,init)=>new Promise(resolve=>requests.push({url,init,resolve}))});return compiledModule.exports;
 }
 const Component=load('components/portal/notification-bell.tsx').default;
 const nodes=()=>{const result=[];const visit=node=>{if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(visit);return;}result.push(node);visit(node.props?.children);};visit(tree);return result;};
 const h={stockUnread(count){nodes().find(node=>node.type==='MaterialAttentionInbox').props.onUnreadChange(count);},requests,timers,document,render(next){props={...props,...next};index=0;tree=Component(props);return tree;},emit(name,event){listeners.get(name)?.(event);},advance(ms){now+=ms;},start(){for(const[id,timer]of timers)if(!timer.interval){timers.delete(id);timer.fn();}},interval(){for(const timer of timers.values())if(timer.interval)timer.fn();},reply(i,data,status=200){requests[i].resolve({ok:status>=200&&status<300,status,json:async()=>data});},button(name){const found=nodes().find(node=>node.type==='button'&&(node.props['aria-label']===name||text(node)===name));assert.ok(found,name);return found;},link(name){const found=nodes().find(node=>node.type==='a'&&text(node)===name);assert.ok(found,name);return found;},links(name){return nodes().filter(node=>node.type==='a'&&text(node)===name);},summary(name){const found=nodes().find(node=>node.type==='summary'&&text(node)===name);assert.ok(found,name);return found;},body(){return text(tree);},dispose(){for(const slot of slots)slot?.cleanup?.();}};
 h.render();return h;
}
const inbox=(title='Aviso A')=>({notifications:[{id:'notice-a',task_id:'task-a',title,status:'open',priority:'high',due_at:'2026-11-01',read_at:null,created_at:'2026-10-31T12:00:00Z'}],unread:1,hasMore:false,pending:[],pendingHasMore:false});

test('bell deduplicates pending fetches, pauses hidden tabs, throttles refreshes and performs no automatic writes',async()=>{
 const h=harness();try{h.start();assert.equal(h.requests.length,1);h.emit('focus');h.emit('proex:followup-changed');assert.equal(h.requests.length,1);h.reply(0,inbox());await tick();assert.equal(h.requests.length,2,'one queued refresh retains the mutation invalidation');h.reply(1,inbox());await tick();h.emit('focus');h.interval();assert.equal(h.requests.length,2);h.advance(60000);h.document.visibilityState='hidden';h.interval();h.emit('proex:followup-changed');assert.equal(h.requests.length,2);h.document.visibilityState='visible';h.emit('visibilitychange');assert.equal(h.requests.length,3);assert.ok(h.requests.every(r=>r.init.method==='GET'));assert.ok([...h.timers.values()].filter(t=>t.interval).every(t=>t.delay>=60000));}finally{h.dispose();}
});

test('changing account hides the previous inbox and aborts its request; reading requires an explicit action',async()=>{
 const h=harness();try{h.start();h.reply(0,inbox());await tick();h.render();h.button('Notificações: 1 não lida').props.onClick();h.render();assert.ok(h.body().includes('Aviso A'));assert.equal(h.requests.length,2);const previous=h.requests[1];h.render({userId:'user-b'});assert.equal(previous.init.signal.aborted,true);assert.ok(!h.body().includes('Aviso A'));h.start();assert.equal(h.requests.length,3);h.reply(2,inbox('Aviso B'));await tick();h.render();h.button('Marcar todas como lidas').props.onClick();assert.equal(h.requests[3].init.method,'POST');assert.equal(JSON.parse(h.requests[3].init.body).action,'notification.read');assert.ok(!JSON.stringify(h.requests[3].init.body).includes('user-a'));}finally{h.dispose();}
});


test('empty inbox opens without a counter and Escape or close restores focus to its named trigger',async()=>{
 const h=harness();let focused=0;try{h.start();h.reply(0,{notifications:[],pending:[],unread:0,hasMore:false,pendingHasMore:false});await tick();h.render();const trigger=h.button('Notificações: 0 não lidas');trigger.props.ref.current={focus(){focused++;}};assert.equal(text(trigger),'');assert.equal(trigger.props['aria-expanded'],false);trigger.props.onClick();h.render();assert.equal(h.button('Notificações: 0 não lidas').props['aria-expanded'],true);assert.equal(h.button('Notificações: 0 não lidas').props['aria-controls'],'followup-notification-center');assert.match(h.body(),/Nenhuma notificação disponível/);assert.equal(h.button('Marcar todas como lidas').props.disabled,true);h.emit('keydown',{key:'Escape'});h.render();assert.equal(h.button('Notificações: 0 não lidas').props['aria-expanded'],false);assert.equal(focused,1);assert.ok(!h.body().includes('Nenhuma notificação disponível'));h.button('Notificações: 0 não lidas').props.onClick();h.render();h.button('Fechar notificações').props.onClick();h.render();assert.equal(focused,2);assert.equal(h.button('Notificações: 0 não lidas').props['aria-expanded'],false);}finally{h.dispose();}
});
test('large unread counts keep a bounded visible badge and the complete accessible count',async()=>{
 const h=harness();try{h.start();h.reply(0,{...inbox(),unread:150});await tick();h.render();const trigger=h.button('Notificações: 150 não lidas');assert.equal(text(trigger),'99+');const badge=trigger.props.children.find(child=>child?.type==='span');assert.equal(String(badge.props['aria-hidden']),'true');trigger.props.onClick();h.render();assert.match(h.body(),/150 não lidas/);assert.equal(h.button('Marcar todas como lidas').props.disabled,false);}finally{h.dispose();}
});

test('the bell groups one task window without changing global unread and marks the task once on explicit opening',async()=>{
 const h=harness(),window={...inbox(),viewerId:'user-a',today:'2026-10-31',unread:120,hasMore:true,notifications:Array.from({length:5},(_,i)=>({...inbox().notifications[0],id:'notice-'+i,created_at:`2026-10-31T12:0${i}:00Z`,read_at:i<2?'2026-10-31T11:00:00Z':null})),pending:[{id:'task-a',title:'Pendente A',priority:'high',due_at:null}]};
 try{h.start();h.reply(0,window);await tick();h.render();h.button('Notificações: 120 não lidas').props.onClick();h.render();assert.equal(h.links('Aviso A').length,1);assert.match(h.body(),/5 atualizações · 3 não lidas nesta janela/);assert.match(h.body(),/Última atualização: 31\/10\/2026/);h.button('Pendentes').props.onClick();h.render();assert.match(h.body(),/Pendentes que você acompanha/);assert.match(h.body(),/criou ou recebeu/);assert.equal(h.link('Meu trabalho').props.href,'/?module=my-work');h.button('Avisos').props.onClick();h.render();h.link('Aviso A').props.onClick({button:0,preventDefault(){}});assert.equal(h.requests.length,3);assert.deepEqual(JSON.parse(h.requests[2].init.body),{action:'notification.read',taskId:'task-a',read:true});assert.equal(h.requests[1].init.signal.aborted,true);
 const read={...window,unread:117,notifications:window.notifications.map(n=>({...n,read_at:n.read_at??'2026-10-31T14:00:00Z'}))};h.reply(2,read);await tick();h.render();h.button('Notificações: 117 não lidas');h.reply(1,window);await tick();h.render();h.button('Notificações: 117 não lidas');
 }finally{h.dispose();}
});

test('a forbidden task-read response clears protected inbox data and an old response cannot replace a different account',async()=>{
 for(const mode of ['forbidden','account']){const h=harness();try{h.start();h.reply(0,{...inbox(),viewerId:'user-a'});await tick();h.render();h.button('Notificações: 1 não lida').props.onClick();h.render();h.link('Aviso A').props.onClick({button:0,preventDefault(){}});
 if(mode==='forbidden'){h.reply(2,{error:'Seu acesso mudou.'},403);await tick();h.render();h.button('Notificações');h.reply(1,inbox());await tick();h.render();h.button('Notificações');assert.equal(h.body().includes('Aviso A'),false);}
 else{h.render({userId:'user-b'});assert.equal(h.requests[2].init.signal.aborted,true);h.start();h.reply(3,{...inbox('Aviso B'),viewerId:'user-b'});await tick();h.render();h.reply(2,{...inbox(),viewerId:'user-a'});await tick();h.render();h.button('Notificações: 1 não lida').props.onClick();h.render();assert.ok(h.body().includes('Aviso B'));assert.equal(h.body().includes('Aviso A'),false);}
 }finally{h.dispose();}}
});

test('malformed new group DTOs and a mismatched viewer never replace the authorized inbox',async()=>{
 for(const data of [{...inbox(),groups:[{task_id:'task-a',title:'Invalid',status:'open',priority:'high',due_at:null,updates:0,unread:1,last_created_at:'invalid'}]},{...inbox('Aviso de outra conta'),viewerId:'user-b'}]){const h=harness();try{h.start();h.reply(0,data);await tick();h.render();h.button('Notificações').props.onClick();h.render();assert.equal(h.body().includes('Aviso A'),false);assert.equal(h.body().includes('Aviso de outra conta'),false);}finally{h.dispose();}}
});

test('cleaning captures the previous cursor even if new notices arrive before confirmation',async()=>{
 const h=harness();
 const first={...inbox(),clearThrough:'notice-a',viewerId:'user-a'};
 const fresh={...inbox('Aviso posterior'),clearThrough:'notice-b',viewerId:'user-a',notifications:[{...inbox().notifications[0],id:'notice-b',title:'Aviso posterior'}]};
 try{
  h.start();h.reply(0,first);await tick();h.render();
  h.button('Notificações: 1 não lida').props.onClick();h.render();
  h.button('Limpar todos os avisos').props.onClick();h.render();
  assert.match(h.body(),/demandas e o histórico continuam disponíveis/);
  h.reply(1,fresh);await tick();h.render();
  h.button('Confirmar limpeza').props.onClick();
  assert.deepEqual(JSON.parse(h.requests[2].init.body),{action:'notification.dismiss',through:'notice-a'});
  h.reply(2,fresh);await tick();h.render();
  assert.match(h.body(),/Avisos anteriores removidos da sua caixa/);
  assert.ok(h.body().includes('Aviso posterior'));
 }finally{h.dispose();}
});

test('opening a notice in another tab leaves the current inbox and unread state alone',async()=>{
 const h=harness(),opened=[];
 try{
  h.render({onSelectTask:id=>opened.push(id)});
  h.start();h.reply(0,inbox());await tick();h.render();
  h.button('Notificações: 1 não lida').props.onClick();h.render();
  h.reply(1,inbox());await tick();h.render();
  for(const modifiers of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{button:1},{defaultPrevented:true}]){
   h.link('Aviso A').props.onClick({button:0,...modifiers,preventDefault(){assert.fail('O navegador deve lidar com o gesto');}});
  }
  assert.deepEqual(opened,[]);
  assert.equal(h.requests.length,2);
  assert.equal(h.button('Notificações: 1 não lida').props['aria-expanded'],true);
  let prevented=false;
  h.link('Aviso A').props.onClick({button:0,preventDefault(){prevented=true;}});h.render();
  assert.equal(prevented,true);
  assert.equal(opened.length,1);
  assert.deepEqual(JSON.parse(h.requests[2].init.body),{action:'notification.read',taskId:opened[0],read:true});
  assert.equal(h.button('Notificações: 1 não lida').props['aria-expanded'],false);
 }finally{h.dispose();}
});

test('followed tasks have separate personal hide and restore actions and keep their navigation',async()=>{
 const h=harness(),pending={id:'task-a',title:'Pendência sintética',status:'open',priority:'high',due_at:'2026-11-09',version:2};
 const first={...inbox(),pending:[pending],hiddenPending:[],clearThrough:'notice-a',viewerId:'user-a'};
 try{
  h.start();h.reply(0,first);await tick();h.render();
  h.button('Notificações: 1 não lida').props.onClick();h.render();
  assert.ok(!h.body().includes('Pendentes que você acompanha'));
  h.button('Pendentes').props.onClick();h.render();
  assert.match(h.body(),/Pendentes que você acompanha/);
  assert.equal(h.link('Pendência sintética').props.href,'/?module=demands&demandId=task-a');
  h.button('Ocultar pendência: Pendência sintética').props.onClick();
  assert.deepEqual(JSON.parse(h.requests[2].init.body),{action:'pending.visibility',taskId:'task-a',version:2,hidden:true});
  h.reply(2,{...first,pending:[],hiddenPending:[pending],pendingVisibility:'confirmed'});await tick();h.render();
  assert.match(h.body(),/Pendência ocultada da sua lista/);
  assert.match(h.body(),/Pendências ocultadas \(1\)/);
  h.button('Mostrar pendência: Pendência sintética').props.onClick();
  assert.deepEqual(JSON.parse(h.requests[3].init.body),{action:'pending.visibility',taskId:'task-a',version:2,hidden:false});
  h.reply(3,{...first,pendingVisibility:'confirmed'});await tick();h.render();
  assert.match(h.body(),/Pendência de volta à sua lista/);
 }finally{h.dispose();}
});

test('stale hide and restore show the refreshed list without a false success',async()=>{
 for(const hidden of [false,true]){
  const h=harness(),pending={id:'task-a',title:'Pendência anterior',status:'open',priority:'high',due_at:null,version:2};
  const first={...inbox(),pending:hidden?[]:[pending],hiddenPending:hidden?[pending]:[],viewerId:'user-a'};
  try{
   h.start();h.reply(0,first);await tick();h.render();
   h.button('Notificações: 1 não lida').props.onClick();h.render();
   h.button('Pendentes').props.onClick();h.render();
   h.button(`${hidden?'Mostrar':'Ocultar'} pendência: Pendência anterior`).props.onClick();
   h.reply(2,{...first,pending:[{...pending,title:'Pendência atualizada',version:3}],hiddenPending:[],pendingVisibility:'outdated'});await tick();h.render();
   assert.match(h.body(),/Esta pendência mudou ou saiu da sua lista/);
   assert.equal(h.links('Pendência anterior').length,0);
   assert.equal(h.links('Pendência atualizada').length,1);
   assert.doesNotMatch(h.body(),/Pendência ocultada da sua lista|Pendência de volta à sua lista/);
  }finally{h.dispose();}
 }
});

test('hidden pending pages are navigable by cursor and can restore a later item without touching earlier ones',async()=>{
 const h=harness(),after='0~2026-11-09~task-19';let focused=0;
 const tasks=Array.from({length:20},(_,index)=>({id:'task-'+index,title:'Ocultada '+index,status:'open',priority:'high',due_at:'2026-11-09',version:1}));
 const later={...tasks[0],id:'task-20',title:'Ocultada 20'};
 const base={...inbox(),viewerId:'user-a',hiddenPendingAfter:null,hiddenPending:tasks,hiddenPendingHasMore:true,hiddenPendingCursor:after};
 const next={...base,hiddenPendingAfter:after,hiddenPending:[later],hiddenPendingHasMore:false,hiddenPendingCursor:null};
 try{
  h.start();h.reply(0,base);await tick();h.render();
  h.button('Notificações: 1 não lida').props.onClick();h.render();
  h.button('Pendentes').props.onClick();h.render();
  assert.match(h.body(),/Pendências ocultadas \(20\+\)/);
  h.summary('Pendências ocultadas (20+)').props.ref.current={focus(){focused++;}};
  assert.equal(h.button('Anterior').props.disabled,true);
  h.button('Próxima').props.onClick();h.render();
  assert.equal(h.requests[1].init.signal.aborted,true);
  assert.match(h.body(),/Carregando pendências ocultadas/);
  h.reply(1,base);await tick();h.render();
  assert.equal(new URL(h.requests[2].url,'https://example.invalid').searchParams.get('hiddenAfter'),after);
  h.reply(2,next);await tick();h.render();
  assert.match(h.body(),/Página 2/);
  assert.equal(focused,1);
  assert.equal(h.button('Próxima').props.disabled,true);
  h.button('Anterior').props.onClick();
  assert.equal(new URL(h.requests[3].url,'https://example.invalid').searchParams.get('hiddenAfter'),null);
  h.reply(3,base);await tick();h.render();
  assert.match(h.body(),/Página 1/);
  h.button('Próxima').props.onClick();
  h.reply(4,next);await tick();h.render();
  h.button('Mostrar pendência: Ocultada 20').props.onClick();
  assert.deepEqual(JSON.parse(h.requests[5].init.body),{action:'pending.visibility',taskId:'task-20',version:1,hidden:false});
  h.reply(5,{...base,hiddenPendingCursor:null,hiddenPendingHasMore:false,pending:[later],pendingVisibility:'confirmed'});await tick();h.render();
  assert.match(h.body(),/Pendência de volta à sua lista/);
  assert.match(h.body(),/Pendências ocultadas \(20\)/);
  assert.equal(h.link('Ocultada 20').props.href,'/?module=demands&demandId=task-20');
 }finally{h.dispose();}
});

test('stock badge joins demand notices and clears the previous account count without reading or dismissing anything',async()=>{
 const h=harness();try{h.start();h.reply(0,inbox());await tick();h.render();h.stockUnread(3);h.render();assert.ok(h.button('Notificações: 4 não lidas'));assert.equal(h.requests.filter(request=>request.init?.method==='POST').length,0);h.render({userId:'user-b'});assert.equal(h.body().includes('Aviso A'),false);h.stockUnread(0);h.render();assert.ok(h.button('Notificações: 0 não lidas'));assert.equal(h.requests.filter(request=>request.init?.method==='POST').length,0);}finally{h.dispose();}
});
