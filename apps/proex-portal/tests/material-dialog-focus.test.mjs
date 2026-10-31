import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../components/portal/material-detail-drawer.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;

/** Small native-dialog model: focus movement and queued close events are browser boundaries. */
function browser() {
  const events = [], focuses = [], document = {activeElement: null};
  class Element {
    constructor(id, tagName = 'BUTTON') {this.id = id; this.tagName = tagName; this.isConnected = true; this.disabled = false;}
    focus(options) {if (this.isConnected && !this.disabled) {document.activeElement = this; focuses.push({id: this.id, options});}}
  }
  document.body = new Element('body', 'BODY'); document.documentElement = new Element('html', 'HTML');
  document.main = new Element('main', 'MAIN'); document.getElementById = id => id === 'main' ? document.main : null;
  document.activeElement = document.body;
  class Dialog extends Element {
    constructor(id) {super(id, 'DIALOG'); this.open = false; this.closeButton = new Element(id + ':close');}
    contains(node) {return node === this || node === this.closeButton;}
    showModal() {this.nativeOpener = document.activeElement; this.open = true; this.closeButton.focus();}
    close() {if (!this.open) return; this.open = false; document.activeElement = document.body; this.nativeOpener?.focus(); const handler = this.onClose; events.push(() => handler?.());}
  }
  return {document, Element, Dialog, focuses, flush() {while (events.length) events.shift()();}};
}

function mount(browser, id = 'item-a') {
  const slots = [], effects = []; let index = 0, tree, closed = 0;
  const hooks = {
    useState(initial) {const i = index++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => slots[i] = typeof value === 'function' ? value(slots[i]) : value];},
    useRef(initial) {const i = index++; return slots[i] ??= {current: initial};},
    useCallback(fn) {return fn;},
    useEffect(fn) {const i = index++; if (!(i in slots)) {slots[i] = {}; effects.push(() => {slots[i].cleanup = fn();});}},
  };
  const compiledModule = {exports: {}}, jsx = (type, props) => ({type, props});
  vm.runInNewContext(code + '\nmodule.exports.MaterialDialogForTest = MaterialDialog;', {
    module: compiledModule, exports: compiledModule.exports, require: name => name === 'react' ? hooks : name === 'react/jsx-runtime' ? {jsx, jsxs: jsx} : name === 'lucide-react' ? new Proxy({}, {get: (_target, key) => String(key)}) : name.endsWith('.css') ? {default: new Proxy({}, {get: (_target, key) => String(key)})} : {default: () => null},
    document: browser.document, HTMLElement: browser.Element, Error, Date, FormData, crypto,
    fetch: () => new Promise(() => {}),
  });
  const node = new browser.Dialog(id);
  const nodes = () => {const all = []; const visit = value => {if (!value || typeof value !== 'object') return; if (Array.isArray(value)) return value.forEach(visit); all.push(value); visit(value.props?.children);}; visit(tree); return all;};
  function render() {index = 0; tree = compiledModule.exports.MaterialDialogForTest({itemId: id, onClose() {closed++;}}); tree.props.ref.current = node; node.onClose = tree.props.onClose;}
  render(); effects.forEach(effect => effect());
  return {
    node, get closed() {return closed;},
    closeButton() {nodes().find(value => value.type === 'button' && value.props['aria-label'] === 'Fechar detalhes').props.onClick(); browser.flush();},
    escape() {node.close(); browser.flush();},
    backdrop() {tree.props.onClick({target: node, currentTarget: node}); browser.flush();},
    cleanup() {slots.forEach(slot => slot?.cleanup?.()); node.isConnected = false;},
    replayEffect() {slots.forEach(slot => slot?.cleanup?.()); effects.forEach(effect => effect());},
  };
}

test('normal close and backdrop return focus to the connected launcher, never to main', () => {
  for (const action of ['closeButton', 'backdrop']) {
    const b = browser(), opener = new b.Element('catalog-launcher'); opener.focus(); const h = mount(b);
    assert.equal(b.document.activeElement, h.node.closeButton); h[action]();
    assert.equal(b.document.activeElement, opener); assert.equal(h.closed, 1); assert.ok(!b.focuses.some(entry => entry.id === 'main'));
    h.cleanup(); b.flush(); assert.equal(h.closed, 1);
  }
});

test('Escape after a URL opening from BODY, HTML or absent opener focuses the main content', () => {
  for (const initial of ['body', 'documentElement', null]) {
    const b = browser(); b.document.activeElement = initial ? b.document[initial] : null; const h = mount(b);
    assert.equal(b.document.activeElement, h.node.closeButton); h.escape();
    assert.equal(b.document.activeElement, b.document.main); assert.equal(h.closed, 1);
    assert.equal(b.focuses.at(-1).options.preventScroll, true); h.cleanup();
  }
});

test('a disconnected or no-longer-focusable opener falls back to main', () => {
  for (const changed of ['isConnected', 'disabled']) {
    const b = browser(), opener = new b.Element('catalog-launcher'); opener.focus(); const h = mount(b);
    opener[changed] = changed === 'disabled'; h.escape();
    assert.equal(b.document.activeElement, b.document.main); assert.equal(h.closed, 1); h.cleanup();
  }
});

test('switching target ignores the old queued close, preserves new dialog focus and closes only the current target', () => {
  const b = browser(), opener = new b.Element('catalog-launcher'); opener.focus();
  const old = mount(b, 'item-a'); old.cleanup();
  const current = mount(b, 'item-b'); b.flush();
  assert.equal(old.closed, 0); assert.equal(current.closed, 0); assert.equal(current.node.open, true);
  assert.equal(b.document.activeElement, current.node.closeButton);
  current.escape(); assert.equal(current.closed, 1); assert.equal(old.closed, 0); assert.equal(b.document.activeElement, opener); current.cleanup();
});

test('a queued close from effect replay cannot close a reopened native dialog or steal its focus', () => {
  const b = browser(), opener = new b.Element('catalog-launcher'); opener.focus(); const h = mount(b);
  h.replayEffect(); b.flush(); assert.equal(h.closed, 0); assert.equal(h.node.open, true); assert.equal(b.document.activeElement, h.node.closeButton);
  h.escape(); assert.equal(h.closed, 1); assert.equal(b.document.activeElement, opener); h.cleanup();
});
