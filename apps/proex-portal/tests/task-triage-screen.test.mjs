import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Tela da triagem: o valor de "Reserva estimada" é o que o servidor informou; sem informação, o número de sempre.
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const text=node=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):'';
function load(file,require,globals={}) {
 const mod={exports:{}};
 const source=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(source,{module:mod,exports:mod.exports,require,...globals});
 return mod.exports;
}
const stubs=name=>name.endsWith('errors')?{HttpError:Error}:{containsCredential:()=>false};
const modules={
 '@/lib/follow-up/contracts':load('lib/follow-up/contracts.ts',stubs),
 '@/lib/follow-up/triage-contract':load('lib/follow-up/triage-contract.ts',stubs),
 '@/lib/assistant/contracts':load('lib/assistant/contracts.ts',stubs),
 '@/lib/assistant/role-contracts':load('lib/assistant/role-contracts.ts',stubs),
};
function harness(answer) {
 let index=0,tree;const slots=[],requests=[];
 const hooks={useState(initial){const key=index++;if(!(key in slots))slots[key]=initial;return[slots[key],value=>slots[key]=typeof value==='function'?value(slots[key]):value];},useRef(initial){const key=index++;return slots[key]??={current:initial};},useEffect(){index++;}};
 const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
 const {TaskTriage}=load('components/portal/task-triage.tsx',name=>name==='react'?hooks:name==='react/jsx-runtime'?jsx:modules[name],
  {AbortController,Error,crypto,fetch:async(url,init)=>{requests.push({url,init});return typeof answer==='function'?answer(url,init):answer;}});
 const task={id:'task-synthetic',version:1,status:'open',priority:'medium',importance:null};
 const nodes=()=>{const found=[],visit=node=>{if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(visit);return;}found.push(node);visit(node.props?.children);};visit(tree);return found;};
 const h={requests,render(){index=0;tree=TaskTriage({task,busy:false,save:async()=>{}});},text:()=>text(tree),
  find(type){const found=nodes().find(node=>node.type===type);assert.ok(found,type);return found;},
  consent:()=>h.find('input'),
  write(value){h.find('textarea').props.onChange({target:{value}});h.render();},
  authorize(){h.consent().props.onChange({target:{checked:true}});h.render();},
  async submit(){h.find('form').props.onSubmit({preventDefault(){}});await tick();await tick();h.render();},
  async open(){tree.props.onToggle({currentTarget:{open:true}});await tick();h.render();}};
 h.render();return h;
}
const state=value=>({ok:true,json:async()=>value});

test('without a ceiling from the server the triage screen shows the same estimate as before',async()=>{
 const h=harness(state({enabled:true}));await h.open();
 assert.equal(h.requests.length,1);assert.equal(h.requests[0].url,'/api/follow-up/triage?id=task-synthetic');
 assert.match(h.text(),/Reserva estimada de até US\$\s0,000173 por análise\./);
});
test('with a chosen decision model the triage screen shows the reservation the server informed',async()=>{
 const h=harness(state({enabled:true,reserveUsdMicros:2048}));await h.open();
 assert.match(h.text(),/Reserva estimada de até US\$\s0,002048 por análise\./);
 assert.doesNotMatch(h.text(),/0,000173/);
});
test('a malformed or refused ceiling never reaches the screen',async()=>{
 for(const value of ['2048',-5,0,1.5,null,Number.MAX_SAFE_INTEGER+2]){
  const h=harness(state({enabled:true,reserveUsdMicros:value}));await h.open();
  assert.match(h.text(),/Reserva estimada de até US\$\s0,000173 por análise\./,String(value));
 }
 const refused=harness({ok:false,json:async()=>({enabled:true,reserveUsdMicros:2048})});await refused.open();
 assert.match(refused.text(),/A triagem com IA está indisponível/);assert.doesNotMatch(refused.text(),/0,002048/);
});

// Destino da triagem: o aviso e a autorização nomeiam quem recebe o resumo, e o pedido leva o nome mostrado.
const ready={ok:true,json:async()=>({status:'ready',proposalId:'proposal-synthetic',proposal:{urgency:'high',importance:'medium'}})};
test('without a chosen model the notice and the authorization keep the same words and the request names no model',async()=>{
 const h=harness((_url,init)=>init?.method==='POST'?ready:state({enabled:true}));await h.open();
 assert.ok(h.text().includes('Escreva um resumo operacional sem nomes, contatos ou documentos. O JEV recebe esse resumo e o prazo desta demanda. Reserva estimada'));
 assert.ok(h.text().includes('Autorizo enviar este resumo e prazo à TypeSafe.'));
 assert.doesNotMatch(h.text(),/modelo /);
 h.write('Resumo sintético da demanda.');h.authorize();await h.submit();
 assert.equal(h.requests.length,2);assert.equal(h.requests[1].init.method,'POST');
 const body=JSON.parse(h.requests[1].init.body);
 assert.deepEqual(Object.keys(body),['id','expectedVersion','operationKey','context','consent','destinationName']);
 assert.equal(body.destinationName,'');assert.equal(body.consent,true);
 assert.match(h.text(),/Sugestão para revisão/);
});
test('with a chosen model the notice and the authorization name it and the request carries the name shown',async()=>{
 const h=harness((_url,init)=>init?.method==='POST'?ready:state({enabled:true,reserveUsdMicros:173,destinationName:'Decider v1.2 (Perplexity)'}));await h.open();
 assert.ok(h.text().includes('O modelo Decider v1.2 (Perplexity) recebe esse resumo e o prazo desta demanda. Se ele não puder responder, quem recebe é o JEV padrão, da TypeSafe.'));
 assert.ok(h.text().includes('Autorizo enviar este resumo e prazo ao modelo Decider v1.2 (Perplexity) e, se ele não puder responder, ao JEV padrão, da TypeSafe.'));
 assert.equal(h.text().includes('Autorizo enviar este resumo e prazo à TypeSafe.'),false);
 h.write('Resumo sintético da demanda.');h.authorize();await h.submit();
 assert.equal(JSON.parse(h.requests[1].init.body).destinationName,'Decider v1.2 (Perplexity)');
 // Nome que não é texto curto nunca chega à tela nem ao pedido.
 for(const value of [7,null,{label:'x'},['x']]){
  const odd=harness((_url,init)=>init?.method==='POST'?ready:state({enabled:true,destinationName:value}));await odd.open();
  assert.ok(odd.text().includes('O JEV recebe esse resumo e o prazo desta demanda.'),JSON.stringify(value));
  odd.write('Resumo sintético da demanda.');odd.authorize();await odd.submit();
  assert.equal(JSON.parse(odd.requests[1].init.body).destinationName,'');
 }
});
test('when the server says the destination changed the screen clears the authorization and shows who receives it now',async()=>{
 let name='';
 const changed={ok:false,json:async()=>({error:'O modelo que recebe este resumo mudou. Confira o aviso e autorize de novo.',code:'triage_destination'})};
 const h=harness((_url,init)=>init?.method==='POST'?changed:state(name?{enabled:true,destinationName:name}:{enabled:true}));await h.open();
 h.write('Resumo sintético da demanda.');h.authorize();assert.equal(h.consent().props.checked,true);
 name='Decider v1.2 (Perplexity)';
 await h.submit();
 assert.deepEqual(h.requests.map(request=>request.init?.method??'GET'),['GET','POST','GET'],'asks the state again after the refusal');
 assert.equal(h.consent().props.checked,false,'the person has to authorize the new destination');
 assert.ok(h.text().includes('O modelo que recebe este resumo mudou. Confira o aviso e autorize de novo.'));
 assert.ok(h.text().includes('Autorizo enviar este resumo e prazo ao modelo Decider v1.2 (Perplexity)'));
 assert.doesNotMatch(h.text(),/Sugestão para revisão/);
});
