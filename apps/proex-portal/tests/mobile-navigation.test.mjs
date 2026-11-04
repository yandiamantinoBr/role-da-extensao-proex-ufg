import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../components/portal/portal-navigation.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function harness() {
  const slots = [], media = [], timers = new Map(), listeners = new Map();
  let tree, cursor = 0, width = 375, timerId = 0, pending = [], mountedRefs = [];
  const document = {
    activeElement: null,
    body: { style: { overflow: 'auto' } },
    getElementById: id => id === 'main' ? main : null,
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type, listener) => { if (listeners.get(type) === listener) listeners.delete(type); },
  };
  const focusable = () => ({ focus() { document.activeElement = this; } });
  const main = focusable(), formField = focusable(), trigger = focusable(), closeButton = focusable();
  const navigation = { contains: element => element === trigger };
  const drawer = { querySelector: () => closeButton };
  const slot = initial => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initial;
    return index;
  };
  const hooks = {
    useState(initial) {
      const index = slot(initial);
      return [slots[index], value => { slots[index] = value; }];
    },
    useRef(initial) { return slots[slot({ current: initial })]; },
    useCallback(callback) { return slots[slot(callback)]; },
    useEffect(callback, dependencies) {
      const index = slot(null), previous = slots[index];
      if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
        pending.push(() => {
          previous?.cleanup?.();
          slots[index] = { dependencies, cleanup: callback() };
        });
      }
    },
  };
  const window = {
    matchMedia(query) {
      const [, direction, pixels] = query.match(/\((min|max)-width:\s*(\d+)px\)/);
      const matcher = { matches: () => direction === 'max' ? width <= Number(pixels) : width >= Number(pixels) };
      media.push(matcher);
      return {
        get matches() { return matcher.matches(); },
        addEventListener: (_type, callback) => { matcher.callback = callback; },
        removeEventListener: () => { delete matcher.callback; },
      };
    },
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  };
  const jsx = (type, props) => ({ type, props });
  const compiledModule = { exports: {} };
  const imports = {
    react: hooks,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    './navigation-model': { recommendedModules: () => [] },
  };
  vm.runInNewContext(compiled, { module: compiledModule, exports: compiledModule.exports, document, window, require: name => imports[name] ?? {} });

  function find(predicate, node = tree) {
    if (Array.isArray(node)) return node.map(child => find(predicate, child)).find(Boolean);
    if (!node || typeof node !== 'object') return undefined;
    return predicate(node) ? node : find(predicate, node.props?.children ?? null);
  }
  const more = () => find(node => node.props?.['aria-haspopup'] === 'dialog');
  const dialog = () => find(node => node.props?.role === 'dialog');
  const search = () => find(node => node.type === 'input');
  function render() {
    cursor = 0;
    pending = [];
    tree = compiledModule.exports.MobileNavigation({
      modules: [{ id: 'overview', label: 'Início', description: 'Resumo', icon: 'home' }],
      active: 'overview', pinned: [], role: 'owner', onTogglePin() {}, onNavigate() {},
    });
    mountedRefs.forEach(ref => { ref.current = null; });
    const nav = find(node => node.type === 'nav');
    mountedRefs = [];
    for (const [node, element] of [[nav, navigation], [more(), trigger], [dialog(), drawer]]) {
      if (!node?.props.ref) continue;
      node.props.ref.current = element;
      mountedRefs.push(node.props.ref);
    }
    pending.forEach(effect => effect());
    for (const [id, callback] of timers) {
      timers.delete(id);
      callback();
    }
  }
  render();
  return {
    document, main, formField, trigger, closeButton, more, dialog, search, render,
    open() { more().props.onClick(); render(); },
    escape() { listeners.get('keydown')?.({ key: 'Escape' }); render(); },
    resize(nextWidth) {
      for (const matcher of media) {
        const previous = matcher.matches();
        width = nextWidth;
        if (previous !== matcher.matches()) matcher.callback?.();
      }
      render();
    },
  };
}

test('Escape restores the trigger and reopens mobile navigation with an empty search', () => {
  const view = harness();
  view.open();
  view.search().props.onChange({ target: { value: 'busca sem resultado' } });
  view.render();
  assert.equal(view.search().props.value, 'busca sem resultado');
  view.escape();
  assert.equal(view.dialog(), undefined);
  assert.equal(view.document.body.style.overflow, 'auto');
  assert.equal(view.document.activeElement, view.trigger);
  view.open();
  assert.equal(view.search().props.value, '');
  assert.equal(view.document.activeElement, view.closeButton);
});

test('leaving mobile width preserves form focus while the drawer is closed', () => {
  const view = harness();
  view.formField.focus();
  view.resize(721);
  assert.equal(view.document.activeElement, view.formField);
});

test('leaving mobile width closes the drawer and transfers its focus to main', () => {
  const view = harness();
  view.open();
  assert.equal(view.document.activeElement, view.closeButton);
  assert.equal(view.document.body.style.overflow, 'hidden');
  view.resize(720.5);
  assert.equal(view.dialog(), undefined);
  assert.equal(view.document.body.style.overflow, 'auto');
  assert.equal(view.document.activeElement, view.main);
});
