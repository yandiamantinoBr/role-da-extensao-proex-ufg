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
};
function harness(answer) {
 let index=0,tree;const slots=[],requests=[];
 const hooks={useState(initial){const key=index++;if(!(key in slots))slots[key]=initial;return[slots[key],value=>slots[key]=typeof value==='function'?value(slots[key]):value];},useRef(initial){const key=index++;return slots[key]??={current:initial};},useEffect(){index++;}};
 const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
 const {TaskTriage}=load('components/portal/task-triage.tsx',name=>name==='react'?hooks:name==='react/jsx-runtime'?jsx:modules[name],
  {AbortController,Error,fetch:async(url,init)=>{requests.push({url,init});return answer;}});
 const task={id:'task-synthetic',version:1,status:'open',priority:'medium',importance:null};
 const h={requests,render(){index=0;tree=TaskTriage({task,busy:false,save:async()=>{}});},text:()=>text(tree),
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
