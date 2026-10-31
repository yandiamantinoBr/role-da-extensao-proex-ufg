import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scriptFixture } from './support/apps-script-fixture.mjs';

const schema = { table: 'projects', sheetName: 'projects', mode: 'metadata', columns: ['_rowKey', '_rowHash', 'id', 'name', 'version'].map(name => ({ name, editable: name === 'name', type: name === 'version' ? 'number' : 'text' })) };
const original = { _rowKey: 'synthetic-project', _rowHash: 'old-hash', id: 'synthetic-project', name: 'Nome original', version: 1 };
const fresh = { ...original, name: 'Valor atualizado no portal', _rowHash: 'new-hash', version: 2 };
const header = schema.columns.map(column => column.name), previousVerified = '2026-10-25T23:17:59.564Z';
function seeded() {
  const fixture = scriptFixture(); fixture.schemas = [schema]; fixture.rows.projects = [fresh];
  fixture.addSheet('projects', [header, header.map(name => original[name])]);
  fixture.addSheet('Controle', [['key', 'value', 'note'], ['lastVerifiedAt', previousVerified, ''], ['baseline:projects:synthetic-project', JSON.stringify(original), '']]);
  return fixture;
}
const finish = fixture => fixture.calls.findLast(call => call.tool === 'proex_sync_run_finish').args;

test('readback rejects altered values even when stored keys and hashes match', () => {
  const f = seeded(), s = f.sheets.get('projects');
  assert.equal(f.context.conferirTabela_(f.ss, schema, [original]), true);
  s.cells[1][3] = 'Alteração com hash intacto';
  assert.equal(f.context.conferirTabela_(f.ss, schema, [original]), false);
  s.cells[1][3] = original.name; s.cells.push(header.map(name => original[name]));
  assert.equal(f.context.conferirTabela_(f.ss, schema, [original]), false);
  s.cells.pop(); s.cells.pop();
  assert.equal(f.context.conferirTabela_(f.ss, schema, [original]), false);
  const typed = { table: 'synthetic', sheetName: 'synthetic', columns: ['text', 'zero', 'bool', 'empty'].map(name => ({ name })) };
  f.addSheet('synthetic', [['text', 'zero', 'bool', 'empty'], ['=texto literal', '0', 'false', '']]);
  assert.equal(f.context.conferirTabela_(f.ss, typed, [{ text: '=texto literal', zero: 0, bool: false, empty: null }]), true);
});

test('an edit made while reading the portal is preserved without advancing its baseline', () => {
  const f = seeded();
  f.onCall = tool => { if (tool === 'proex_sync_read') f.sheets.get('projects').cells[1][3] = 'Edição feita durante HTTP'; };
  assert.match(f.context.sincronizar_(), /conflito/);
  assert.equal(f.sheets.get('projects').cells[1][3], 'Edição feita durante HTTP');
  assert.deepEqual(JSON.parse(f.control()['baseline:projects:synthetic-project']), original);
  assert.equal(f.control().lastVerifiedAt, previousVerified);
  assert.equal(finish(f).status, 'conflict'); assert.equal(finish(f).readbackVerified, false);
});

test('concurrent additions to empty or missing metadata sheets and deleted sheets are preserved', () => {
  for (const initial of ['header', 'missing', 'deleted']) {
    const f = seeded();
    if (initial === 'header') f.sheets.get('projects').cells = [header];
    if (initial === 'missing') f.sheets.delete('projects');
    f.onCall = tool => {
      if (tool !== 'proex_sync_read') return;
      if (initial === 'deleted') f.sheets.delete('projects');
      else f.addSheet('projects', [header, ['new', 'new-hash', 'new', 'Nova linha humana', '1']]);
    };
    f.context.sincronizar_();
    assert.equal(finish(f).status, 'conflict', initial);
    assert.equal(f.sheets.get('projects')?.cells[1][3] ?? null, initial === 'deleted' ? null : 'Nova linha humana');
  }
});

test('failed readback keeps last full verification and original baseline', () => {
  const f = seeded();
  f.sheets.get('projects').onWrite = ({ row }) => { if (row === 1) f.sheets.get('projects').cells[1][3] = 'Gravação divergente'; };
  assert.match(f.context.sincronizar_(), /relê as tabelas desde o início/);
  assert.equal(finish(f).status, 'failed'); assert.equal(finish(f).tablesVerified, 0);
  assert.equal(f.control().syncState, 'partial'); assert.equal(f.control().lastAttemptStatus, 'failed');
  assert.equal(f.control().lastVerifiedAt, previousVerified);
  assert.deepEqual(JSON.parse(f.control()['baseline:projects:synthetic-project']), original);
});

test('full verification is recorded after read-only tables too, while timeout never appears verified', () => {
  const f = seeded(), readonly = { table: 'visits', sheetName: 'visits', mode: 'read_only', columns: [{ name: '_rowKey' }, { name: 'hits' }] };
  f.schemas.push(readonly); f.rows.visits = [{ _rowKey: 'synthetic-visit', hits: 0 }];
  f.context.sincronizar_();
  assert.equal(f.control().syncState, 'verified'); assert.equal(f.control().tablesVerified, '2');
  assert.equal(f.control().lastAttemptStatus, 'completed'); assert.notEqual(f.control().lastVerifiedAt, previousVerified);
  assert.equal(finish(f).tablesVerified, 2); assert.equal(finish(f).readbackVerified, true);
  const timeout = seeded(); timeout.onCall = tool => { if (tool === 'proex_sync_read') timeout.advance(301000); };
  timeout.context.sincronizar_();
  assert.equal(finish(timeout).status, 'failed'); assert.equal(timeout.control().lastVerifiedAt, previousVerified);
  assert.equal(timeout.sheets.get('projects').cells[1][3], original.name);
});

test('trigger status distinguishes data and attachments and activation authenticates before replacing triggers', () => {
  const f = seeded(); f.triggers.push({ getHandlerFunction: () => 'sincronizarAutomatico' });
  f.context.verEstado();
  assert.match(f.alerts[0], /Gatilho de dados nesta conta: 1 instalado/);
  assert.match(f.alerts[0], /Gatilho de anexos nesta conta: não instalado/);
  assert.match(f.alerts[0], /outras contas não são visíveis/);
  assert.ok(f.calls.every(call => call.tool === 'proex_sync_describe'));
  f.onCall = () => { throw new Error('synthetic authentication failure'); };
  assert.throws(() => f.context.ativarAutomatico()); assert.equal(f.triggers.length, 1);
  f.onCall = () => {}; f.triggers.push({ getHandlerFunction: () => 'unrelatedHandler' });
  f.context.ativarAutomatico();
  assert.deepEqual(f.triggers.map(trigger => trigger.getHandlerFunction()).sort(), ['copiarAnexosAutomatico', 'sincronizarAutomatico', 'unrelatedHandler'].sort());
});

test('attachment HTTP errors are reported while other copies are still confirmed; number return stays compatible', () => {
  const f = seeded(); f.attachments = [{ kind: 'record', id: 'bad', mime: 'image/png' }, { kind: 'loan', id: 'good', mime: 'application/pdf' }, { kind: 'loan', id: 'existing', driveExport: { deletedAt: null } }];
  f.download = url => ({ status: url.endsWith('/bad') ? 503 : 200, bytes: Buffer.from('synthetic') });
  assert.throws(() => f.context.copiarAnexos_(), /1 confirmado\(s\), 1 falha/);
  const result = JSON.parse(f.properties.get('LAST_ATTACHMENTS_RESULT'));
  assert.equal(result.status, 'failed'); assert.equal(result.copied, 1); assert.equal(result.existing, 1);
  assert.deepEqual(result.codes, ['download_http_503']); assert.equal(f.files.size, 1);
  assert.equal(f.calls.filter(call => call.tool === 'proex_sync_attachment_ack').length, 1);
  const success = seeded(); assert.equal(success.context.copiarAnexos_(), 0);
  assert.equal(JSON.parse(success.properties.get('LAST_ATTACHMENTS_RESULT')).status, 'completed');
});

test('failed attachment receipt is not counted as a verified copy or leaked into logs', () => {
  const f = seeded(); f.attachments = [{ kind: 'loan', id: 'synthetic', mime: 'application/pdf' }];
  f.onCall = tool => { if (tool === 'proex_sync_attachment_ack') throw Object.assign(new Error('private ticket, name or provider detail'), { code: 'attachment_export_exists' }); };
  assert.throws(() => f.context.copiarAnexos_(), error => !error.message.includes('private ticket') && /0 confirmado/.test(error.message));
  const result = JSON.parse(f.properties.get('LAST_ATTACHMENTS_RESULT'));
  assert.equal(result.status, 'failed'); assert.equal(result.copied, 0); assert.equal(result.failed, 1);
  assert.deepEqual(result.codes, ['attachment_export_exists']);
});

test('a corrupt or shared Drive copy is never acknowledged even if its size matches', () => {
  for (const scenario of ['corrupt', 'shared']) {
    const f = seeded(); f.attachments = [{ kind: 'loan', id: 'synthetic', mime: 'application/pdf' }];
    if (scenario === 'corrupt') f.storedBytes = bytes => bytes.map((byte, index) => index === 0 ? byte ^ 1 : byte);
    else f.fileEditors = ['synthetic-editor'];
    assert.throws(() => f.context.copiarAnexos_(), /0 confirmado/);
    assert.equal(f.calls.some(call => call.tool === 'proex_sync_attachment_ack'), false);
    assert.deepEqual(JSON.parse(f.properties.get('LAST_ATTACHMENTS_RESULT')).codes, [scenario === 'corrupt' ? 'attachment_readback_failed' : 'attachment_not_private']);
  }
});

test('attachment lock and time budget have explicit states without claiming all files were copied', () => {
  const busy = seeded(); busy.lock(true); assert.equal(busy.context.copiarAnexos_(), 0);
  assert.equal(JSON.parse(busy.properties.get('LAST_ATTACHMENTS_RESULT')).status, 'busy');
  const partial = seeded(); partial.attachments = [{ kind: 'loan', id: 'synthetic', mime: 'application/pdf' }];
  partial.onCall = tool => { if (tool === 'proex_sync_attachment_list') partial.advance(241000); };
  assert.equal(partial.context.copiarAnexos_(), 0);
  const result = JSON.parse(partial.properties.get('LAST_ATTACHMENTS_RESULT'));
  assert.equal(result.status, 'partial'); assert.match(partial.context.resumoAnexos_(result), /há anexos por conferir/);
  const missing = seeded(); missing.properties.delete('ATTACHMENTS_FOLDER_ID');
  assert.throws(() => missing.context.copiarAnexos_(), /Conecte a planilha/);
  assert.equal(JSON.parse(missing.properties.get('LAST_ATTACHMENTS_RESULT')).status, 'failed');
});
