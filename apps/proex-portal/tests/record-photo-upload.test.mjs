import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { compile } from './support/work-teams-fixture.mjs';

const { MAX_UPLOAD_FILE_BYTES } = await import(compile('lib/upload-limits.ts'));
const source = readFileSync(new URL('../components/portal/records-panel.tsx', import.meta.url), 'utf8');
const declarations = ts.createSourceFile('records-panel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = Object.fromEntries(declarations.statements
  .filter(statement => ts.isFunctionDeclaration(statement) && statement.name)
  .map(statement => [statement.name.text, statement.getText(declarations)]));
const code = ts.transpileModule([
  functions.prepareRecordAttachment, functions.AttachmentQueue, 'module.exports = { AttachmentQueue, prepareRecordAttachment };',
].join('\n'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const jsx = (type, props) => ({ type, props });
const jpegSource = (type = 'image/jpeg', name = 'camera.jpeg', valid = true) => {
  const bytes = Buffer.alloc(MAX_UPLOAD_FILE_BYTES + 5000);
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]).copy(bytes);
  if (valid) Buffer.from([0xff, 0xd9]).copy(bytes, bytes.length - 2);
  return new File([bytes], name, { type, lastModified: 200 });
};
const pdfSource = () => new File([Buffer.from('%PDF-1.6\n%%EOF')], 'registro.pdf', { type: 'application/pdf', lastModified: 200 });
function mount(prepareUploadPhoto) {
  let index = 0, tree;
  const slots = [], pending = [], uploads = [];
  const hooks = {
    useState(initial) {
      const key = index++;
      slots[key] ??= { value: initial };
      return [slots[key].value, value => { slots[key].value = value; }];
    },
    useRef(initial) { return slots[index++] ??= { current: initial }; },
    useId() { return ':qa:'; },
    useEffect(run, deps) {
      const key = index++, previous = slots[key];
      if (previous && deps.length === previous.deps.length && deps.every((value, n) => value === previous.deps[n])) return;
      previous?.cleanup?.();
      slots[key] = { deps, cleanup: run() };
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports, require(name) { assert.equal(name, 'react/jsx-runtime'); return { jsx, jsxs: jsx }; }, ...hooks,
    prepareUploadPhoto, AbortController, MAX_FILE_BYTES: MAX_UPLOAD_FILE_BYTES, UPLOAD_LIMIT_LABEL: '4 MB', FormData, crypto,
    window: { addEventListener() {}, removeEventListener() {} }, sizeLabel: bytes => String(bytes),
    Camera: 'Camera', ImagePlus: 'ImagePlus', Trash2: 'Trash2', Check: 'Check', LoaderCircle: 'LoaderCircle', Upload: 'Upload',
    async requestJson(_url, { body }) {
      uploads.push({ recordId: body.get('recordId'), file: body.get('file') });
      return { recordId: 'record-a', attachment: { id: 'upload-' + uploads.length } };
    },
    attachmentValue: value => value,
  });
  const render = () => { index = 0; tree = module.exports.AttachmentQueue({ recordId: 'record-a', onAttachment() {}, onPendingChange: value => pending.push(value) }); };
  const query = (type, check) => {
    function find(node) {
      if (!node || typeof node !== 'object') return undefined;
      if (Array.isArray(node)) return node.map(find).find(Boolean);
      return node.type === type && check(node.props) ? node.props : find(node.props.children);
    }
    return find(tree);
  };
  render();
  return { render, query, uploads, pending, prepare: module.exports.prepareRecordAttachment,
    choose(files) { return query('input', props => props.multiple).onChange({ target: { files, value: 'anything' } }); },
    dispose() { slots.forEach(slot => slot.cleanup?.()); },
  };
}

test('the record picker prepares only oversized JPEG photos and keeps PDF bytes and other selections', async () => {
  const seen = [];
  const jpeg = jpegSource('', 'camera.jpeg'), pdf = pdfSource(), invalid = jpegSource('image/jpeg', 'broken.jpg', false);
  const largePng = new File([Buffer.alloc(MAX_UPLOAD_FILE_BYTES + 1)], 'original.png', { type: 'image/png' });
  const prepared = new File([Buffer.from([0xff, 0xd8, 0xff, 0xd9])], 'camera.jpg', { type: 'image/jpeg' });
  const h = mount(async (source, name, signal) => { seen.push(source); assert.equal(name, 'foto-do-registro'); assert.equal(signal.aborted, false); return prepared; });
  assert.equal(await h.prepare(pdf, new AbortController().signal), pdf);
  await h.choose([pdf, invalid, largePng, jpeg, jpeg]);
  h.render();
  assert.deepEqual(seen, [jpeg]);
  assert.ok(h.query('p', props => props.role === 'alert').children.includes('broken.jpg'));
  assert.ok(h.query('p', props => props.role === 'status').children.includes('Foto preparada'));
  await h.choose([jpeg]);
  assert.deepEqual(seen, [jpeg], 'original source identity deduplicates after JPEG conversion');
  h.render();
  h.query('button', props => props.className.includes('p-button-primary')).onClick();
  for (let attempts = 0; h.uploads.length < 2 && attempts < 10; attempts++) await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.uploads.map(row => row.recordId), ['record-a', 'record-a']);
  assert.equal(h.uploads[0].file.name, pdf.name);
  assert.deepEqual(await h.uploads[0].file.bytes(), await pdf.bytes());
  assert.equal(h.uploads[1].file.name, 'camera.jpg');
  const heic = new File([Buffer.from('sample')], 'sem-suporte.heic', { type: 'image/heic' });
  await assert.rejects(h.prepare(heic, new AbortController().signal), /Converta fotos HEIC para JPEG/);
  h.dispose();
});

test('the picker blocks uploads and another selection during photo preparation and aborts on unmount', async () => {
  let started, complete;
  const ready = new Promise(resolve => { started = resolve; });
  const wait = new Promise(resolve => { complete = resolve; });
  const h = mount((file, _name, signal) => { started({ file, signal }); return wait; });
  const pdf = pdfSource();
  await h.choose([pdf]); h.render();
  const jpeg = jpegSource();
  const selection = h.choose([jpeg]), operation = await ready;
  h.render();
  const send = h.query('button', props => props.className.includes('p-button-primary'));
  assert.equal(send.disabled, true);
  assert.match(h.query('p', props => props.role === 'status').children, /Preparando arquivos/);
  send.onClick(); await h.choose([jpegSource('image/jpeg', 'another.jpg')]);
  h.dispose();
  assert.equal(operation.signal.aborted, true);
  complete(pdf); await selection;
  assert.equal(h.pending.at(-1), false);
  assert.deepEqual(h.uploads, []);
});
