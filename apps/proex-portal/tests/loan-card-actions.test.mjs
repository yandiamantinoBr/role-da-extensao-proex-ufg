import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {compile,teamFixture} from './support/work-teams-fixture.mjs';
// Cartão do empréstimo (16/11): a ação principal fica visível, abre uma confirmação curta e não pede a ação duas vezes.
// Dados sintéticos; o servidor continua conferindo permissão, janela e estado.
const root=path.resolve(import.meta.dirname,'..'),tick=()=>new Promise(resolve=>setImmediate(resolve));
const text=node=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):'';
const HOUR=3600000;

function harness(initial){
 let props=initial,tree,frame;const instances=new Map(),effects=[],calls=[],focus=[];
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,i)=>Object.is(value,b[i]));
 const hooks={
  useState(value){const slot=frame.index++,owner=frame;if(!(slot in owner.slots))owner.slots[slot]=typeof value==='function'?value():value;return[owner.slots[slot],next=>{owner.slots[slot]=typeof next==='function'?next(owner.slots[slot]):next;}];},
  useRef(value){const slot=frame.index++;return frame.slots[slot]??={current:value};},
  useEffect(fn,deps){const slot=frame.index++,owner=frame,old=owner.slots[slot];if(!same(old?.deps,deps))effects.push(()=>{old?.cleanup?.();owner.slots[slot]={deps,cleanup:fn()};});},
 };
 const jsx=(type,p,key)=>({type,props:p,key});
 const require=name=>name==='react'?hooks:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='lucide-react'?new Proxy({},{get:(_t,key)=>String(key)}):name.endsWith('.module.css')?{default:new Proxy({},{get:(_t,key)=>String(key)})}:assert.fail(name);
 const mod={exports:{}},file=path.join(root,'components/portal/loan-card-actions.tsx');
 vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module:mod,exports:mod.exports,require,crypto,Error,window:{setTimeout:fn=>fn()}});
 const Component=mod.exports.default;
 const nodes=()=>{const out=[];const walk=v=>{if(!v||typeof v!=='object')return;if(Array.isArray(v))return v.forEach(walk);out.push(v);walk(v.props?.children);};walk(tree);return out;};
 const h={calls,focus,
  render(){frame=instances.get('root')??{slots:[],index:0};instances.set('root',frame);frame.index=0;tree=Component({...props,mutate:(action,payload)=>new Promise((resolve,reject)=>calls.push({action,payload,resolve,reject}))});for(const n of nodes())if(n.props?.ref&&!n.props.ref.current)n.props.ref.current={focus:()=>focus.push(n.type)};effects.splice(0).forEach(fn=>fn());},
  body:()=>text(tree),
  button(label){const b=nodes().find(n=>n.type==='button'&&(n.props['aria-label']===label||text(n).trim()===label));assert.ok(b,label);return b;},
  has:label=>nodes().some(n=>n.type==='button'&&(n.props['aria-label']===label||text(n).trim()===label)),
  click(label){const b=h.button(label);if(b.props.disabled)return 'disabled';b.props.onClick({currentTarget:{focus:()=>focus.push('opener')}});h.render();},
  type(value){nodes().find(n=>n.type==='textarea').props.onChange({target:{value}});h.render();},
  textarea:()=>nodes().find(n=>n.type==='textarea'),
  dispose(){instances.get('root')?.slots.forEach(slot=>slot?.cleanup?.());},
 };h.render();return h;
}

test('reserved: retirada is the visible main action; the confirmation asks only for the condition, never for the action again',async()=>{
 const h=harness({loanId:'loan-a',itemName:'Projetor sintético',status:'reserved'});
 try{
  assert.ok(h.has('Registrar retirada de Projetor sintético'));assert.ok(h.has('Cancelar a reserva de Projetor sintético'));
  h.click('Registrar retirada de Projetor sintético');
  assert.match(h.body(),/Confirmar retirada · Projetor sintético/);assert.equal(h.focus.at(-1),'textarea','focus goes to the condition field');
  assert.doesNotMatch(h.body(),/Escolha a ação|Atualização do empréstimo/);
  h.type('Com capa, sem avarias');h.click('Confirmar retirada');
  assert.equal(h.click('Confirmar retirada'),'disabled','a second tap while saving sends nothing');
  assert.equal(h.calls.length,1);const call=h.calls[0];
  assert.equal(call.action,'loan.status');assert.deepEqual({...call.payload,operationKey:undefined},{id:'loan-a',status:'out',conditionOut:'Com capa, sem avarias',operationKey:undefined});
  assert.match(call.payload.operationKey,/^[0-9a-f-]{36}$/);
  call.resolve({});await tick();h.render();
  assert.doesNotMatch(h.body(),/Confirmar retirada ·/,'closes after success');
 }finally{h.dispose();}
});

test('a failure keeps what was typed and the same operation key, so a retry after a lost reply records once',async()=>{
 const h=harness({loanId:'loan-a',itemName:'Câmera sintética',status:'out'});
 try{
  assert.ok(h.has('Registrar devolução de Câmera sintética'));assert.equal(h.has('Cancelar a reserva de Câmera sintética'),false,'out loans cannot be cancelled');
  h.click('Registrar devolução de Câmera sintética');h.type('Voltou com a bateria');h.click('Confirmar devolução');
  const first=h.calls[0];first.reject(new Error('A conexão foi interrompida.'));await tick();h.render();
  assert.match(h.body(),/A conexão foi interrompida/);assert.equal(h.textarea().props.value,'Voltou com a bateria');
  h.click('Confirmar devolução');const second=h.calls[1];
  assert.equal(second.payload.operationKey,first.payload.operationKey);assert.equal(second.payload.conditionIn,'Voltou com a bateria');
  second.resolve({});await tick();h.render();
  h.click('Registrar devolução de Câmera sintética');h.click('Confirmar devolução');
  assert.notEqual(h.calls[2].payload.operationKey,first.payload.operationKey,'a new action gets a new key');
 }finally{h.dispose();}
});

test('Voltar closes without sending and returns focus; a blocked checkout only offers cancelling; closed loans show nothing',()=>{
 const h=harness({loanId:'loan-a',itemName:'Tripé sintético',status:'reserved',checkoutBlocked:true});
 try{
  assert.equal(h.has('Registrar retirada de Tripé sintético'),false);
  h.click('Cancelar a reserva de Tripé sintético');assert.match(h.body(),/Cancelar esta reserva\?/);assert.equal(h.textarea(),undefined);
  h.click('Voltar');assert.equal(h.calls.length,0);assert.equal(h.focus.at(-1),'opener');
  h.click('Cancelar a reserva de Tripé sintético');h.click('Cancelar reserva');
  assert.deepEqual({...h.calls[0].payload,operationKey:undefined},{id:'loan-a',status:'cancelled',note:'',operationKey:undefined});
 }finally{h.dispose();}
 for(const status of ['returned','cancelled']){const closed=harness({loanId:'loan-b',itemName:'Bem',status});assert.equal(closed.body(),'');closed.dispose();}
});

test('the card puts the action outside the details; details keep borrower, terms, attachment and history; no status select remains',()=>{
 const source=readFileSync(path.join(root,'app/portal-client.tsx'),'utf8');
 const card=source.slice(source.indexOf('<article className={`p-card p-loan-card'),source.indexOf('</article>',source.indexOf('<article className={`p-card p-loan-card')));
 assert.ok(card.indexOf('<LoanCardActions')<card.indexOf('<details'),'action is on the card, not hidden in details');
 assert.match(card,/'loans\.manage', 'loans\.checkout'\) && <LoanCardActions/,'only who manages or checks out loans sees it');
 assert.match(card,/<summary>Detalhes, termos e ocorrências/);assert.match(card,/<LoanAttachment/);assert.match(card,/historyHref\(\{ kind: 'loan'/);assert.match(card,/Responsável pela retirada/);
 assert.doesNotMatch(card,/action="loan\.status"|Atualização do empréstimo|Escolha a ação/);
});

test('server: the confirmation payload stores each stage condition; a repeat is a duplicate; readers and other projects are refused',async t=>{
 const f=teamFixture(t),{materialsAction}=await import(compile('lib/materials.ts'));
 const run=async(who,action,input,key=crypto.randomUUID())=>materialsAction(f.db,await f.actor(who),action,{operationKey:key,...input});
 const item=(await run('owner-a','item.create',{projectId:'project-a',name:'Projetor sintético',category:'equipment',unit:'unidade',lowStock:0})).item;
 await run('owner-a','stock.move',{itemId:item.id,kind:'receive',delta:1,reason:'Entrada sintética'});
 const now=Date.now(),loan=(await run('owner-a','loan.create',{projectId:'project-a',itemId:item.id,actionName:'Oficina sintética',borrowerName:'Pessoa fictícia',startsAt:new Date(now-HOUR).toISOString(),endsAt:new Date(now+HOUR).toISOString()})).loan;
 await assert.rejects(run('viewer-a','loan.status',{id:loan.id,status:'out',conditionOut:'x'}),e=>e.status===403);
 await assert.rejects(run('owner-b','loan.status',{id:loan.id,status:'out',conditionOut:'x'}),e=>e.status===403);
 const key=crypto.randomUUID();
 await run('owner-a','loan.status',{id:loan.id,status:'out',conditionOut:'Com capa'},key);
 const again=await run('owner-a','loan.status',{id:loan.id,status:'out',conditionOut:'Com capa'},key);
 assert.ok(again.duplicate||again.loan?.status==='out');
 await run('owner-a','loan.status',{id:loan.id,status:'returned',conditionIn:'Sem avarias'});
 const row=f.native.prepare('SELECT status,condition_out,condition_in FROM loans WHERE id=?').get(loan.id);
 assert.deepEqual({...row},{status:'returned',condition_out:'Com capa',condition_in:'Sem avarias'});
 assert.equal(f.native.prepare("SELECT COUNT(*) n FROM audit WHERE entity_id=? AND action='loan.status'").get(loan.id).n,2,'one audit entry per stage, none for the repeat');
});
