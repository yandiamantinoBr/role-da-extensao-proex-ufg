import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url), tick = () => new Promise(resolve => setImmediate(resolve));
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : '';
const props = { kind: 'asset', defaultProjectId: 'project-a', projects: [{ id: 'project-a', name: 'Projeto A' }, { id: 'project-b', name: 'Projeto B' }], items: [], canWrite: () => true };
const preview = { projectId: 'project-a', itemId: null, reviewToken: 'synthetic-reviewed-document', provenance: { label: 'Documento sintético', retrievedAt: '2026-10-31T12:00:00Z', extraction: 'text-file' }, candidates: [{ key: 'row-1', fields: { name: 'Equipamento A', assetCode: '000123' }, problems: {}, warnings: [] }] };
function harness(initialProps = props) {
 const slots = [], requests = [], cache = new Map(); let index = 0, tree, currentProps = initialProps;
 const hooks = {
  useState(initial) { const key = index++; if (!(key in slots)) slots[key] = typeof initial === 'function' ? initial() : initial; return [slots[key], value => { slots[key] = typeof value === 'function' ? value(slots[key]) : value; }]; },
  useEffect(callback){const key=index++;if(!(key in slots))slots[key]={cleanup:callback()};},
  useRef(initial) { const key = index++; slots[key] ??= { current: initial }; return slots[key]; },
 };
 const jsx = { jsx: (type, attrs) => ({ type, props: attrs }), jsxs: (type, attrs) => ({ type, props: attrs }) };
 function load(file) {
  if (cache.has(file)) return cache.get(file);
  const compiledModule = { exports: {} }; cache.set(file, compiledModule.exports);
  const require = name => name === 'react' ? hooks : name === 'react/jsx-runtime' ? jsx : name === 'lucide-react' ? new Proxy({}, { get: (_object, key) => String(key) }) : name.endsWith('.css') ? { default: new Proxy({}, { get: (_object, key) => key }) } : load(name.startsWith('@/') ? `${name.slice(2)}.ts` : `${path.posix.normalize(path.posix.join(path.posix.dirname(file), name))}.ts`);
  const source = ts.transpileModule(readFileSync(new URL(file, root), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, { module: compiledModule, exports: compiledModule.exports, require, Error, Date, TextEncoder, TextDecoder, Uint8Array, AbortController, FormData, File, crypto, window: { setTimeout: () => 1, clearTimeout() {} }, fetch: (url, init) => new Promise((resolve, reject) => requests.push({ url, init, resolve, reject })) }); return compiledModule.exports;
 }
 const Component = load('components/portal/assisted-import-panel.tsx').default;
 function nodes() { const result = []; const visit = node => { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) { node.forEach(visit); return; } result.push(node); visit(node.props?.children); }; visit(tree); return result; }
 const h = {
  requests,
  render(nextProps = currentProps) { currentProps = nextProps; index = 0; tree = Component(currentProps); return tree; },
  find(type, predicate) { const found = nodes().find(node => node.type === type && predicate(node)); assert.ok(found, type); return found; },
  button(label) { return h.find('button', node => text(node).trim() === label); },
  chooseFile(file) { h.find('input', node => node.props.type === 'file').props.onChange({ currentTarget: { files: [file], value: file.name } }); h.render(); },
  content() { return h.find('textarea', () => true).props.value; },
  alerts() { return nodes().filter(node => node.props?.role === 'alert').map(text); },
  text() { return text(tree); },
 };
 h.render(); h.button('Abrir importação').props.onClick(); h.render();
 h.find('select', node => node.props.children.some?.(child => child?.props?.value === 'document')).props.onChange({ target: { value: 'document' } }); h.render();
 return h;
}
const file = (name, content = 'Nome: Equipamento A\nTombamento: 000123') => new File([content], name, { type: 'text/plain' });
function deferredFile(name) { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); const value = file(name); value.text = () => promise; return { value, resolve, reject }; }

test('selecting an invalid replacement clears the former file and cannot submit its stale content', async () => {
 for (const invalid of [file('not-supported.exe'), file('too-large.txt', 'x'.repeat(256 * 1024 + 1))]) {
  const h = harness(); h.chooseFile(file('accepted-a.txt')); await tick(); h.render(); assert.match(h.text(), /Selecionado: accepted-a.txt/);
  h.chooseFile(invalid); await tick(); h.render(); assert.equal(h.text().includes('accepted-a.txt'), false); assert.equal(h.content(), '');
  assert.match(h.text(), /Use PDF|256 KiB/); h.button('Preparar prévia').props.onClick(); await tick(); h.render();
  assert.equal(h.requests.length, 0); assert.match(h.text(), /documento válido ou informe o conteúdo/); assert.ok(h.find('input', node => node.props.type === 'file'));
 }
});
test('file reading disables preparation and an older read cannot clear the latest pending read or overwrite its result', async () => {
 const h = harness(), a = deferredFile('document-a.txt'), b = deferredFile('document-b.txt');
 h.chooseFile(a.value); assert.equal(h.button('Preparar prévia').props.disabled, true); assert.match(h.text(), /Lendo o documento/);
 h.button('Preparar prévia').props.onClick(); await tick(); assert.equal(h.requests.length, 0);
 // Simulate a queued second change event while the first File.text() is pending.
 h.chooseFile(b.value); a.resolve('Nome: Não usar A'); await tick(); h.render(); assert.equal(h.button('Preparar prévia').props.disabled, true);
 b.resolve('Nome: Usar documento B'); await tick(); h.render(); assert.equal(h.button('Preparar prévia').props.disabled, false); assert.equal(h.content(), 'Nome: Usar documento B'); assert.match(h.text(), /Selecionado: document-b.txt/); assert.equal(h.text().includes('document-a.txt'), false);
});
test('a failed older read cannot replace the selected newer file or display a stale error', async () => {
 const h = harness(), a = deferredFile('old-a.txt'); h.chooseFile(a.value); h.chooseFile(file('new-b.txt', 'Nome: Equipamento B')); await tick(); h.render();
 a.reject(new Error('old file failed')); await tick(); h.render(); assert.equal(h.content(), 'Nome: Equipamento B'); assert.match(h.text(), /Selecionado: new-b.txt/); assert.equal(h.alerts().length, 0); assert.equal(h.button('Preparar prévia').props.disabled, false);
});
test('changing the global context preserves the reviewed destination and source, with a visible warning', async () => {
 const h = harness(); h.chooseFile(file('source-a.txt')); await tick(); h.render(); h.button('Preparar prévia').props.onClick(); await tick();
 assert.equal(h.requests[0].init.body.get('projectId'), 'project-a'); h.requests[0].resolve({ ok: true, json: async () => preview }); await tick(); h.render(); assert.match(h.text(), /Destino: Projeto A/);
 h.render({ ...props, defaultProjectId: 'project-b' }); assert.match(h.text(), /filtro geral mostra Projeto B/); assert.match(h.text(), /continua destinada a Projeto A/); assert.match(h.text(), /Destino: Projeto A/); assert.equal(h.button('Confirmar e salvar').props.disabled, true);
 h.button('Voltar à fonte').props.onClick(); h.render(); assert.match(h.text(), /Selecionado: source-a.txt/); assert.equal(h.requests.length, 1);
});

test('project creation displays the sole authorized organization and requires explicit choice when several are available',async()=>{
 const organizations=[{id:'org-a',name:'Organização A',status:'active',canManage:true},{id:'org-b',name:'Organização B',status:'active',canManage:true},{id:'org-hidden',name:'Não autorizada',status:'active',canManage:false},{id:'org-archived',name:'Arquivada',status:'archived',canManage:true}];
 const single=harness({...props,kind:'project',defaultProjectId:'',canCreateProject:true,organizations:[organizations[0],organizations[2],organizations[3]]});assert.equal(single.find('input',node=>node.props.readOnly).props.value,'Organização A');assert.equal(single.button('Preparar prévia').props.disabled,false);
 const multiple=harness({...props,kind:'project',defaultProjectId:'',canCreateProject:true,organizations});assert.equal(multiple.button('Preparar prévia').props.disabled,true);const selector=multiple.find('select',node=>text(node).includes('Selecione explicitamente a organização'));assert.equal(selector.props.value,'');assert.equal(text(selector).includes('Não autorizada'),false);assert.equal(text(selector).includes('Arquivada'),false);
 selector.props.onChange({target:{value:'org-b'}});multiple.render();assert.equal(multiple.button('Preparar prévia').props.disabled,false);multiple.chooseFile(file('project-org-b.txt'));await tick();multiple.render();multiple.button('Preparar prévia').props.onClick();await tick();assert.equal(multiple.requests[0].init.body.get('organizationId'),'org-b');
});


test('document AI opt-in names the organization, requires explicit consent and resets when the source changes',async()=>{
 const organizations=[{id:'org-a',name:'Organização A',status:'active',canManage:true}],setup={...props,projects:[{id:'project-a',name:'Projeto A',organization_id:'org-a'}],organizations};const h=harness(setup);h.chooseFile(file('ai-source.txt','Cadastro: Equipamento A'));await tick();h.render();
 const use=h.find('input',node=>node.props.type==='checkbox'&&text(h.find('label',label=>text(label).includes('Usar IA para estruturar'))).includes('Usar IA'));assert.equal(use.props.checked,false);use.props.onChange({target:{checked:true}});h.render();assert.match(h.text(),/Organização A/);assert.match(h.text(),/16 KiB/);assert.equal(h.button('Preparar prévia').props.disabled,true);h.button('Preparar prévia').props.onClick();await tick();assert.equal(h.requests.length,0);
 h.find('label',node=>text(node).includes('Autorizo enviar o texto extraído')).props.children[0].props.onChange({target:{checked:true}});h.render();h.button('Preparar prévia').props.onClick();await tick();const body=h.requests[0].init.body;assert.equal(body.get('useAi'),'true');assert.equal(body.get('aiConsent'),'true');assert.match(body.get('aiOperationKey'),/^[A-Za-z0-9_-]{8,100}$/);
 h.requests[0].resolve({ok:false,json:async()=>({error:'Erro sintético; mesma operação pode ser conferida.'})});await tick();h.render();h.find('textarea',()=>true).props.onChange({target:{value:'Outro conteúdo'}});h.render();assert.equal(h.button('Preparar prévia').props.disabled,true);
});

test('AI previews show evidence and missing fields, and conflicts are not selected automatically',async()=>{
 const setup={...props,projects:[{id:'project-a',name:'Projeto A',organization_id:'org-a'}],organizations:[{id:'org-a',name:'Organização A',status:'active',canManage:true}]},h=harness(setup);h.chooseFile(file('ai-preview.txt'));await tick();h.render();h.button('Preparar prévia').props.onClick();await tick();
 const review={...preview,organizationId:'org-a',provenance:{...preview.provenance,ai:{model:'deepseek-flash',configRevision:1}},candidates:[{...preview.candidates[0],evidence:{name:{status:'conflict',method:'rule',quote:'Nome documentado',confidence:null},assetCode:{status:'literal',method:'ai',quote:'Tombamento: 000123',confidence:null},brand:{status:'missing',method:'ai',quote:null,confidence:null}}}]};h.requests[0].resolve({ok:true,json:async()=>review});await tick();h.render();assert.match(h.text(),/confiança numérica não está disponível/);assert.match(h.text(),/não encontrado na fonte/);assert.match(h.text(),/Tombamento: 000123/);assert.ok(h.button('Completar campos não encontrados'));const name=h.find('input',node=>node.props.id==='import-asset-name');assert.equal(name.props.checked,false);assert.equal(h.find('input',node=>node.props.id==='import-asset-assetCode').props.checked,true);
});


test('an empty global filter selects a real initial asset destination and never displays an unselected option as the current target',()=>{const setup={...props,defaultProjectId:'',projects:[{id:'project-a',name:'Projeto A',organization_id:'org-a'}],organizations:[{id:'org-a',name:'Organização A',status:'active',canManage:true}]},h=harness(setup);assert.equal(h.find('select',node=>text(node).includes('Projeto A')).props.value,'project-a');assert.equal(h.button('Preparar prévia').props.disabled,false);});


test('a preview response from an older source, file or destination cannot restore stale fields after the change handler',async()=>{
 for(const change of ['content','file','project']){const h=harness();h.chooseFile(file('source-before.txt'));await tick();h.render();h.button('Preparar prévia').props.onClick();await tick();const request=h.requests[0];if(change==='content')h.find('textarea',()=>true).props.onChange({target:{value:'Nome: Fonte nova'}});if(change==='file')h.chooseFile(file('source-after.txt','Nome: Fonte nova'));if(change==='project')h.find('select',node=>text(node).includes('Projeto A')).props.onChange({target:{value:'project-b'}});assert.equal(request.init.signal.aborted,true);request.resolve({ok:true,json:async()=>preview});await tick();h.render();assert.ok(!h.text().includes('Documento sintético'));assert.ok(h.button('Preparar prévia'));}
});

test('editing a formerly missing field preserves the completed value and the original missing evidence',async()=>{
 const h=harness();h.chooseFile(file('missing.txt'));await tick();h.render();h.button('Preparar prévia').props.onClick();await tick();h.requests[0].resolve({ok:true,json:async()=>({...preview,candidates:[{...preview.candidates[0],evidence:{brand:{status:'missing',method:'ai',quote:null,confidence:null}}}]})});await tick();h.render();h.button('Completar campos não encontrados').props.onClick();h.render();const input=()=>h.find('input',node=>node.props.placeholder&&node.props.maxLength===120&&node.props.value==='');const candidate=input();candidate.props.onChange({target:{value:'M'}});h.render();const field=h.find('input',node=>node.props.value==='M');field.props.onChange({target:{value:'Marca documentada'}});h.render();assert.ok(h.find('input',node=>node.props.value==='Marca documentada'));assert.match(h.text(),/editado manualmente|não encontrado na fonte/);
});
