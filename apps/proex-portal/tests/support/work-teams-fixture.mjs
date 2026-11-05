import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import ts from 'typescript';
const root = fileURLToPath(new URL('../../', import.meta.url)), cache = new Map();
export function compile(file) {
 file = resolve(root, file); if (cache.has(file)) return cache.get(file);
 let code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
 code = code.replace(/from (['"])(\.[^'"]+)\1/g, (_m, _q, name) => `from ${JSON.stringify(compile(resolve(dirname(file), name + '.ts')))}`);
 code = code.replace(/from (['"])@\/([^'"]+)\1/g, (_m, _q, name) => `from ${JSON.stringify(compile(name + '.ts'))}`);
 const url = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64'); cache.set(file, url); return url;
}
export const { getActor } = await import(compile('lib/access.ts'));
export const { followupAction } = await import(compile('lib/follow-up/service.ts'));
export const { teamsWorkspace } = await import(compile('lib/follow-up/teams.ts'));
export function teamFixture(t) {
 const native = new DatabaseSync(':memory:'); native.exec('PRAGMA foreign_keys=ON');
 for (const name of readdirSync(root + 'drizzle').filter(name => name.endsWith('.sql')).sort()) native.exec(readFileSync(root + 'drizzle/' + name, 'utf8'));
 t?.after(() => native.close()); const now = new Date().toISOString();
 const insert = (table, row) => { const keys = Object.keys(row); native.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(...Object.values(row)); };
 for (const suffix of ['a','b']) insert('organizations', { id: `org-${suffix}`, name: `Organização ${suffix.toUpperCase()}`, slug: `org-${suffix}`, created_at: now, updated_at: now });
 for (const [project, org, name] of [['a','a','Projeto Aurora'],['a2','a','Projeto Horizonte'],['b','b','Projeto reservado B']]) insert('projects', { id: `project-${project}`, organization_id: `org-${org}`, name, created_at: now });
 const users = {};
 function user(name, role, project, org, display) {
  insert('portal_users', { user_id: name, email: `${name}@example.invalid`, status: 'active', created_at: now, updated_at: now });
  insert('profiles', { user_id: name, display_name: display ?? name, created_at: now, updated_at: now });
  insert('members', { id: `member-${name}`, user_id: name, email: `${name}@example.invalid`, role, project_id: project, organization_id: org, created_at: now });
  users[name] = { userId: name, email: `${name}@example.invalid`, displayName: display ?? name };
 }
 user('owner-a','owner',null,'org-a','Gestão Aurora'); user('owner-b','owner',null,'org-b','Gestão B');
 user('viewer-a','viewer','project-a','org-a','Pessoa Aurora'); user('other-a2','inventory','project-a2','org-a','Pessoa Horizonte');
 user('worker-b','inventory','project-b','org-b','Pessoa reservada B');
 const db = { afterRead: null, prepare(sql) { let values = []; return { sql, bind(...args) { values = args; return this; }, async first() { const result = native.prepare(sql).get(...values) ?? null; db.afterRead?.(sql); return result; }, async all() { const results = native.prepare(sql).all(...values); db.afterRead?.(sql); return { results }; }, execute() { const results = native.prepare(sql).all(...values); return { results, meta: { changes: Number(native.prepare('SELECT changes() n').get().n) } }; }, async run() { return this.execute(); } }; }, async batch(statements) { native.exec('BEGIN'); try { const result = statements.map(statement => statement.execute()); native.exec('COMMIT'); return result; } catch (error) { native.exec('ROLLBACK'); throw error; } } };
 const actor = name => getActor(db, users[name]);
 return { db, native, now, insert, users, actor, act: async (name, action, input) => followupAction(db, await actor(name), action, { ...input, operationKey: crypto.randomUUID() }) };
}
export async function teamScenario(t) {
 const f = teamFixture(t);
 const a = await f.act('owner-a','team.create',{ organizationId:'org-a',name:'Comunicação e Design',userIds:['viewer-a','other-a2'] });
 const a2 = await f.act('owner-a','team.create',{ organizationId:'org-a',name:'Apoio aos eventos',userIds:['viewer-a'] });
 const hidden = await f.act('owner-a','team.create',{ organizationId:'org-a',name:'Equipe interna Horizonte',userIds:['other-a2'] });
 const b = await f.act('owner-b','team.create',{ organizationId:'org-b',name:'Equipe reservada B',userIds:['worker-b'] });
 const task = (name, projectId, teamIds, extra = {}) => f.act(name,'task.create',{ projectId,title:'Conferir materiais do evento',priority:'high',dueAt:'2020-01-01',teamIds,...extra });
 const shared = await task('owner-a','project-a',[a.teamId,a2.teamId]);
 await task('owner-a','project-a',[a.teamId],{ title:'Artes prontas para avaliação',status:'completed',priority:'low',dueAt:null });
 await task('owner-a','project-a2',[a.teamId],{ title:'Demanda reservada Horizonte' });
 await task('owner-b','project-b',[b.teamId],{ title:'Demanda reservada B' });
 await f.act('owner-a','task.create',{ organizationId:'org-a',title:'Planejamento da organização',teamIds:[a.teamId] });
 return { ...f, a:a.teamId,a2:a2.teamId,hidden:hidden.teamId,b:b.teamId,shared:shared.task.id };
}
