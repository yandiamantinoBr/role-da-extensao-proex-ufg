import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const migrations = readdirSync(resolve(root, 'drizzle')).filter(name => name.endsWith('.sql')).sort()
  .map(name => ({ name, sql: readFileSync(resolve(root, 'drizzle', name), 'utf8') }));
const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;

// Real route, authentication, rate-limit and SQLite logic. Only request identity,
// platform binding and the already separately tested sync-tool dispatcher are replaced.
export function compile(file, replacements = new Map(), cache = new Map()) {
  file = resolve(root, file);
  if (replacements.has(file)) return moduleUrl(replacements.get(file));
  if (cache.has(file)) return cache.get(file);
  let code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  code = code.replace(/from (['"])(@\/[^'"]+|\.{1,2}\/[^'"]+)\1/g, (_match, _quote, dependency) => {
    const target = dependency.startsWith('@/') ? resolve(root, dependency.slice(2)) : resolve(dirname(file), dependency);
    return `from ${JSON.stringify(compile(target.endsWith('.ts') ? target : `${target}.ts`, replacements, cache))}`;
  });
  const result = moduleUrl(`${code}\n//# sourceURL=${file.replace(root, '').replaceAll('\\', '/')}-under-test.mjs`);
  cache.set(file, result);
  return result;
}

export async function trafficModules(eventSource) {
  const replacements = new Map([
    [resolve(root, 'lib/platform.ts'), 'export function database(){return globalThis.__proexTraffic.db;}'],
    [resolve(root, 'lib/session.ts'), 'export async function getPortalUser(){return globalThis.__proexTraffic.user??null;}'],
    [resolve(root, 'lib/participation.ts'), 'export async function draw(){throw new Error("not used in read-only fixture");} export async function participationView(){return {id:"synthetic-participation"};}'],
    [resolve(root, 'lib/sync/tools.ts'), 'export async function callSyncTool(_db,_actor,tool){globalThis.__proexTraffic.toolCalls++;return tool==="ping"?{pong:true}:undefined;}'],
  ]);
  if (eventSource) {
    // Baseline source is still compiled with its original, real database helpers.
    const tempPath = resolve(root, 'app/api/events/[id]/route.ts');
    const original = ts.transpileModule(eventSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    const code = original.replace(/from (['"])(@\/[^'"]+|\.{1,2}\/[^'"]+)\1/g, (_match, _quote, dep) => {
      const target = dep.startsWith('@/') ? resolve(root, dep.slice(2)) : resolve(dirname(tempPath), dep);
      return `from ${JSON.stringify(compile(`${target}.ts`, replacements))}`;
    });
    return { event: await import(moduleUrl(code)) };
  }
  return {
    event: await import(compile('app/api/events/[id]/route.ts', replacements)),
    connector: await import(compile('app/api/sync/connector/route.ts', replacements)),
    rate: await import(compile('lib/rate-limit.ts', replacements)),
    tokens: await import(compile('lib/sync/tokens.ts', replacements)),
    contracts: await import(compile('lib/sync/contracts.ts', replacements)),
  };
}

export function nativeFixture() {
  const native = new DatabaseSync(':memory:');
  native.exec('PRAGMA foreign_keys=ON');
  for (const migration of migrations) native.exec(migration.sql);
  const stats = { commits: 0, changedRows: 0 };
  const totalChanges = () => Number(native.prepare('SELECT total_changes() n').get().n);
  function execute(sql, parameters) {
    const statement = native.prepare(sql);
    if (statement.columns().length) return { success: true, results: statement.all(...parameters), meta: { changes: /^\s*SELECT\b/i.test(sql) ? 0 : Number(native.prepare('SELECT changes() n').get().n) } };
    const info = statement.run(...parameters);
    return { success: true, results: [], meta: { changes: Number(info.changes) } };
  }
  function operation(task) {
    const before = totalChanges(), result = task(), changes = totalChanges() - before;
    if (changes) { stats.commits++; stats.changedRows += changes; }
    return result;
  }
  function prepare(sql, parameters = []) {
    return {
      bind: (...args) => prepare(sql, args),
      async first(column) { const row = operation(() => native.prepare(sql).get(...parameters)); return column ? row?.[column] ?? null : row ?? null; },
      async all() { return operation(() => execute(sql, parameters)); },
      async run() { return operation(() => execute(sql, parameters)); },
      execute: () => execute(sql, parameters),
    };
  }
  const db = { prepare, async batch(statements) {
    return operation(() => {
      native.exec('BEGIN IMMEDIATE');
      try { const results = statements.map(statement => statement.execute()); native.exec('COMMIT'); return results; }
      catch (error) { native.exec('ROLLBACK'); throw error; }
    });
  } };
  const now = new Date().toISOString();
  native.prepare("INSERT INTO projects(id,name,created_at) VALUES('project-fixture','Synthetic project',?)").run(now);
  native.prepare("INSERT INTO campaigns(id,project_id,name,starts_at,ends_at,status,created_at) VALUES('event-fixture','project-fixture','Synthetic event',?,?,'active',?)").run(now, now, now);
  const context = { db, user: null, toolCalls: 0 };
  globalThis.__proexTraffic = context;
  return {
    native, db, stats, context,
    resetStats() { stats.commits = 0; stats.changedRows = 0; },
    owner() {
      native.prepare("INSERT INTO portal_users(user_id,email,status,activation_pending,created_at,updated_at) VALUES('owner-fixture','owner@example.invalid','active',0,?,?)").run(now, now);
      native.prepare("INSERT INTO members(id,user_id,email,role,project_id,created_at) VALUES('member-fixture','owner-fixture','owner@example.invalid','owner',NULL,?)").run(now);
      return { userId: 'owner-fixture', email: 'owner@example.invalid', displayName: 'Synthetic owner', members: [], capabilities: [] };
    },
    close() { native.close(); if (globalThis.__proexTraffic === context) delete globalThis.__proexTraffic; },
  };
}
