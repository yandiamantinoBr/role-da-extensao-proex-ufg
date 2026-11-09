import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createArchive, encryptArchive } from '../platform-node/backup-format.mjs';
import { importMain } from '../scripts/import-backup-to-postgres.mjs';
import { backupFixture, migrations } from './support/backup-fixture.mjs';

// Dados 100% sintéticos. O adaptador real (postgresTarget) usa SQL e não é exercitado
// aqui: este teste cobre a regra (destino vazio, releitura, nada parcial) com um destino falso.
const password = 'Synthetic recovery phrase 2026!';
const folder = mkdtempSync(join(realpathSync(tmpdir()), 'proex-import-tests-'));
after(() => rmSync(folder, { recursive: true, force: true }));
const sha = data => createHash('sha256').update(data).digest('hex');

async function packageFile(name, { withoutKeys = false } = {}) {
  const f = backupFixture();
  try {
    const capture = f.capture();
    if (withoutKeys) capture.objects = capture.objects.map(object => ({ ...object, key: null }));
    const encrypted = await encryptArchive(createArchive(capture, { migrations, ownerId: f.actor.userId, codeRevision: 'a'.repeat(40) }).bytes, password);
    const file = join(folder, `${name}.proexbackup`);
    writeFileSync(file, encrypted);
    return file;
  } finally { f.close(); }
}

function fakeTarget({ snapshots = 0, objects = 0, corrupt = false } = {}) {
  const state = { snapshot: snapshots ? { version: 1, bytes: Buffer.from('previous') } : null, objects: new Map(objects ? [['previous', { size: 1, data: Buffer.from('x') }]] : []), committed: false, closed: false };
  return {
    state,
    async transaction(work) {
      const draft = { snapshot: state.snapshot, objects: new Map(state.objects) };
      const result = await work({
        async counts() { return { snapshots: draft.snapshot ? 1 : 0, objects: draft.objects.size }; },
        async insertSnapshot(version, bytes) { draft.snapshot = { version, bytes: Buffer.from(bytes) }; },
        async insertObject(o) { draft.objects.set(o.key, { size: o.size, data: Buffer.from(o.data), type: o.contentType }); },
        async readback() {
          return { version: draft.snapshot.version, snapshotSha256: corrupt ? '0'.repeat(64) : sha(draft.snapshot.bytes),
            objects: [...draft.objects].map(([key, item]) => ({ key, size: item.size, sha256: sha(item.data) })) };
        },
      });
      state.snapshot = draft.snapshot; state.objects = draft.objects; state.committed = true; // só chega aqui sem exceção
      return result;
    },
    async close() { state.closed = true; },
  };
}
const run = (file, args, extra = {}) => importMain(['--input', file, ...args], { environment: { PROEX_TARGET_DATABASE_URL: 'synthetic' }, readSecret: async () => password, ...extra });

test('sem --apply valida o pacote e não abre conexão', async () => {
  const file = await packageFile('dry');
  let connected = false;
  const report = await run(file, [], { connect: async () => { connected = true; } });
  assert.equal(report.verified, true); assert.equal(report.apply, false);
  assert.equal(report.objects, 4); assert.equal(report.snapshotVersion, 7); assert.equal(connected, false);
});

test('--apply grava banco e anexos em destino vazio e confere a releitura', async () => {
  const file = await packageFile('apply'), target = fakeTarget();
  const report = await run(file, ['--apply'], { connect: async () => target });
  assert.equal(report.imported, true); assert.equal(report.objects, 4); assert.equal(report.skippedWithoutKey, 0);
  assert.equal(target.state.snapshot.version, 7); assert.equal(target.state.objects.size, 4);
  assert.ok(target.state.objects.has('synthetic/private/avatar')); assert.equal(target.state.closed, true);
});

test('destino que já tem banco ou anexos é recusado sem gravar nada', async () => {
  const file = await packageFile('busy');
  for (const options of [{ snapshots: 1 }, { objects: 1 }]) {
    const target = fakeTarget(options), before = JSON.stringify([target.state.snapshot, [...target.state.objects.keys()]]);
    await assert.rejects(run(file, ['--apply'], { connect: async () => target }), error => error.code === 'backup_import_not_empty');
    assert.equal(JSON.stringify([target.state.snapshot, [...target.state.objects.keys()]]), before); assert.equal(target.state.committed, false);
  }
});

test('releitura divergente desfaz tudo', async () => {
  const file = await packageFile('verify'), target = fakeTarget({ corrupt: true });
  await assert.rejects(run(file, ['--apply'], { connect: async () => target }), error => error.code === 'backup_import_verify');
  assert.equal(target.state.snapshot, null); assert.equal(target.state.objects.size, 0); assert.equal(target.state.committed, false); assert.equal(target.state.closed, true);
});

test('pacote vindo de disco, sem caminho dos anexos, importa o banco e avisa os anexos pulados', async () => {
  const file = await packageFile('disk', { withoutKeys: true }), target = fakeTarget();
  const report = await run(file, ['--apply'], { connect: async () => target });
  assert.equal(report.objects, 0); assert.equal(report.skippedWithoutKey, 4); assert.equal(target.state.snapshot.version, 7);
});

test('exige o destino por variável, recusa ambiente de produção e senha errada', async () => {
  const file = await packageFile('guards');
  await assert.rejects(importMain(['--input', file, '--apply'], { environment: {}, readSecret: async () => password }), /PROEX_TARGET_DATABASE_URL/);
  await assert.rejects(importMain(['--input', file], { environment: { PROEX_DATABASE_URL: 'synthetic' }, readSecret: async () => password }), error => error.code === 'backup_destination');
  await assert.rejects(run(file, [], { readSecret: async () => 'Wrong synthetic phrase 2026!!' }), error => error.code === 'backup_authentication');
  await assert.rejects(importMain(['--input', file, '--apply', 'url'], { environment: {}, readSecret: async () => password }));
});
