import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url), tick = () => new Promise(resolve => setImmediate(resolve));
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : '';

function harness() {
  const slots = [], effects = [], pending = [], cache = new Map(), requests = [], lifecycle = []; let index = 0, tree, mounted = null, props = {};
  const Boundary = () => null;
  const hooks = {
    useState(initial) { const key = index++; if (!(key in slots)) slots[key] = typeof initial === 'function' ? initial() : initial; return [slots[key], value => { slots[key] = typeof value === 'function' ? value(slots[key]) : value; }]; },
    useRef(initial) { const key = index++; slots[key] ??= { current: initial }; return slots[key]; },
    useEffect(callback,deps) { const key=index++,old=effects[key]; if(old&&deps&&deps.every((value,i)=>Object.is(value,old.deps?.[i])))return; pending.push(()=>{old?.cleanup?.();effects[key]={deps,cleanup:callback()};}); },
  };
  const jsx = { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) };
  function load(file) {
    if (cache.has(file)) return cache.get(file); const compiledModule = { exports: {} }; cache.set(file, compiledModule.exports);
    const require = name => name.endsWith('.module.css') ? {default:{}} : name === 'lucide-react' ? new Proxy({},{get:(_target,key)=>String(key)}) : name === 'react' ? hooks : name === 'react/jsx-runtime' ? jsx : name === './assistant-connection-panel' ? { default: Boundary } : name === './speech-input' ? { default: () => null } : load(name.startsWith('@/') ? `${name.slice(2)}.ts` : `${path.posix.normalize(path.posix.join(path.posix.dirname(file), name))}.ts`);
    const code = ts.transpileModule(readFileSync(new URL(file, root), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInNewContext(code, { module: compiledModule, exports: compiledModule.exports, require, Error, crypto, AbortController, window: { setTimeout: () => 1, clearTimeout() {} }, fetch: (url, init) => new Promise(resolve => requests.push({ url, init, resolve })) }); return compiledModule.exports;
  }
  const Component = load('components/portal/assistant-administration-panel.tsx').default, defaults = load('lib/assistant/contracts.ts').DEFAULT_ASSISTANT_CONFIG;
  function nodes() { const result = []; const visit = (node, ancestors = []) => { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) { node.forEach(child => visit(child, ancestors)); return; } result.push({ ...node, ancestors }); visit(node.props?.children, [...ancestors, node]); }; visit(tree); return result; }
  // A generic type/key boundary records mount lifetimes. Product authorization
  // and revision decisions are made only by the real parent TSX above.
  function reconcile() {
    const next = nodes().find(node => node.type === Boundary);
    if (mounted && (!next || next.key !== mounted.key)) { lifecycle.push(['unmount', mounted.props.orgId, mounted.props.revision]); mounted = null; }
    if (next && !mounted) { mounted = { key: next.key, props: next.props, state: { consent: false }, ancestors: next.ancestors }; lifecycle.push(['mount', next.props.orgId, next.props.revision]); }
    else if (next && mounted) { mounted.props = next.props; mounted.ancestors = next.ancestors; }
  }
  const h = {
    requests, lifecycle,
    render(next=props) { props=next; index=0; tree=Component({canManageKeys:true,...props}); pending.splice(0).forEach(effect=>effect()); reconcile(); },
    button(label) { const node = nodes().find(node => node.type === 'button' && text(node) === label); assert.ok(node, label); return node; },
    selector() { const label = nodes().find(node => node.type === 'label' && text(node).startsWith('Organização da IA')); assert.ok(label); return label.props.children.find(node => node?.type === 'select'); },
    status(org = 'org-a', extra = {}) { return { available: true, canConfigure: true, canDelegate: false, organizationId: org, revision: 1, config: defaults, organizations: ['org-a', 'org-b'].map(id => ({ id, name: id, canConfigure: true, available: true, sttAvailable: false })), ...extra }; },
    get boundary() { return mounted; },
    async reply(index, body) { requests[index].resolve({ ok: true, json: async () => body }); await tick(); h.render(); },
    dispose() { effects.forEach(effect=>effect?.cleanup?.()); },
  }; h.render(); return h;
}
async function open(h,status) { await h.reply(0,h.status('',{canConfigure:false})); await h.reply(1,status); }

test('saved diagnostics mount only after an explicit diagnostics selection and close when changing areas',async()=>{
 const h=harness();try{
  await open(h,h.status('org-a',{revision:3}));assert.equal(h.boundary,null);
  h.button('Diagnóstico').props.onClick();h.render();assert.equal(h.boundary.props.orgId,'org-a');assert.equal(h.boundary.props.revision,3);
  h.button('Chaves').props.onClick();h.render();assert.equal(h.boundary,null);
  assert.deepEqual(h.lifecycle,[['mount','org-a',3],['unmount','org-a',3]]);
  assert.equal(h.requests.length,2,'no provider request merely by choosing an area');
 }finally{h.dispose();}
});

test('viewers and unsaved configurations never mount diagnostics',async()=>{
 const denied=harness();try{await denied.reply(0,denied.status('',{canConfigure:false,organizations:[{id:'org-a',name:'A',canConfigure:false}]}));assert.equal(denied.boundary,null);assert.deepEqual(denied.lifecycle,[]);}finally{denied.dispose();}
 const h=harness();try{await open(h,h.status('org-a',{revision:0}));h.button('Diagnóstico').props.onClick();h.render();assert.equal(h.boundary,null);assert.deepEqual(h.lifecycle,[]);}finally{h.dispose();}
});

test('changing organization or the saved revision remounts diagnostics without carrying prior consent',async()=>{
 const h=harness();try{
  await open(h,h.status());h.button('Diagnóstico').props.onClick();h.render();h.boundary.state.consent=true;
  h.selector().props.onChange({target:{value:'org-b'}});h.render();assert.equal(h.boundary,null);
  await h.reply(2,h.status('org-b'));assert.equal(h.boundary.props.orgId,'org-b');assert.equal(h.boundary.state.consent,false);h.boundary.state.consent=true;
  h.render({refreshKey:1});await h.reply(3,h.status('org-b',{revision:2}));assert.equal(h.boundary.props.revision,2);assert.equal(h.boundary.state.consent,false);
  assert.deepEqual(h.lifecycle,[['mount','org-a',1],['unmount','org-a',1],['mount','org-b',1],['unmount','org-b',1],['mount','org-b',2]]);
  assert.ok(h.requests.every(request=>request.url.startsWith('/api/assistant')));
 }finally{h.dispose();}
});
