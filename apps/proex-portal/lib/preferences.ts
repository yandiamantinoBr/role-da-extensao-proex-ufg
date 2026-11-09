import { accessibleProjects, type PortalActor } from './access';
import { all, iso, one } from './database';
import { activeAccount, authority } from './follow-up/scope';
import { HttpError } from './errors';

/*
 * Preferências pessoais de navegação (0038): projetos e equipes fixados.
 * Só a própria pessoa lê e grava (user_id da sessão). Guardamos apenas ids; a tela mostra
 * somente os que a pessoa ainda pode ver, então perder um acesso nunca revela o nome de nada.
 * A anonimização da conta apaga a linha (lib/privacy.ts).
 */
export const PIN_LIMIT = 12;
export type PinKind = 'project' | 'team';
export type Preferences = { projectPins: string[]; teamPins: string[]; version: number };
export type PinnedTeam = { id: string; name: string; organizationId: string };
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

function actorRequired(actor: PortalActor | null): PortalActor {
  if (!actor) throw new HttpError(401, 'Entre para continuar.', 'unauthenticated');
  return actor;
}
function ids(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !ID.test(item))) throw new HttpError(400, `Lista de ${label} inválida.`, 'invalid_pins');
  return [...new Set(value as string[])].slice(0, PIN_LIMIT);
}
function parse(raw: unknown): string[] {
  try { const value = JSON.parse(String(raw ?? '[]')); return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && ID.test(item)).slice(0, PIN_LIMIT) : []; } catch { return []; }
}
async function read(db: D1Database, userId: string): Promise<Preferences> {
  const row = await one(db, 'SELECT project_pins,team_pins,version FROM user_preferences WHERE user_id=?', [userId]);
  return { projectPins: parse(row?.project_pins), teamPins: parse(row?.team_pins), version: Number(row?.version ?? 0) };
}

/**
 * Nomes das equipes fixadas que a pessoa ainda pode ver: integrante ativa da equipe com vínculo
 * vigente na organização, ou com autoridade de gestão nela. As demais somem sem revelar nome.
 */
async function visibleTeams(db: D1Database, userId: string, teamIds: string[]): Promise<PinnedTeam[]> {
  if (!teamIds.length) return [];
  const rows = await all(db, `SELECT team.id,team.name,team.organization_id FROM followup_teams team
   JOIN portal_users caller ON caller.user_id=?
   WHERE team.id IN (${teamIds.map(() => '?').join(',')}) AND team.status='active' AND ${activeAccount('caller')}
   AND (${authority('caller.user_id', 'team.organization_id', 'NULL', true)}
    OR (EXISTS(SELECT 1 FROM followup_team_members mine WHERE mine.team_id=team.id AND mine.user_id=caller.user_id AND mine.removed_at IS NULL)
     AND EXISTS(SELECT 1 FROM members m LEFT JOIN projects p ON p.id=m.project_id WHERE m.user_id=caller.user_id AND m.revoked_at IS NULL
      AND (m.organization_id=team.organization_id OR p.organization_id=team.organization_id OR (m.role='owner' AND m.project_id IS NULL AND m.organization_id IS NULL)))))`,
   [userId, ...teamIds]);
  return teamIds.flatMap(id => rows.filter(row => row.id === id).map(row => ({ id: String(row.id), name: String(row.name), organizationId: String(row.organization_id) })));
}

async function visibleIds(db: D1Database, actor: PortalActor, kind: PinKind, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  if (kind === 'team') return new Set((await visibleTeams(db, actor.userId, ids)).map(team => team.id));
  const scope = accessibleProjects(actor);
  const rows = await all(db, `SELECT id FROM projects WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  return new Set(rows.map(row => String(row.id)).filter(id => scope === null || scope.includes(id)));
}

export async function preferencesFor(db: D1Database, rawActor: PortalActor | null): Promise<Preferences & { teams: PinnedTeam[] }> {
  const actor = actorRequired(rawActor), current = await read(db, actor.userId);
  return { ...current, teams: await visibleTeams(db, actor.userId, current.teamPins) };
}

/** Grava a lista inteira com conferência de versão; em conflito, tenta de novo sobre o estado atual. */
async function write(db: D1Database, userId: string, change: (current: Preferences) => Preferences): Promise<Preferences> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await read(db, userId), next = change(current), now = iso();
    const project = JSON.stringify(next.projectPins), team = JSON.stringify(next.teamPins);
    const result = current.version === 0
      ? await db.prepare('INSERT INTO user_preferences(user_id,project_pins,team_pins,version,updated_at) VALUES(?,?,?,1,?) ON CONFLICT(user_id) DO NOTHING').bind(userId, project, team, now).run()
      : await db.prepare('UPDATE user_preferences SET project_pins=?,team_pins=?,version=version+1,updated_at=? WHERE user_id=? AND version=?').bind(project, team, now, userId, current.version).run();
    if (result.meta.changes === 1) return { ...next, version: current.version + 1 };
  }
  throw new HttpError(409, 'Seus fixados mudaram em outro aparelho agora há pouco. Atualize a página.', 'preferences_changed');
}

export async function preferencesAction(db: D1Database, rawActor: PortalActor | null, input: Record<string, unknown>): Promise<Preferences & { teams: PinnedTeam[] }> {
  const saved = await applyAction(db, rawActor, input);
  return { ...saved, teams: await visibleTeams(db, actorRequired(rawActor).userId, saved.teamPins) };
}

async function applyAction(db: D1Database, rawActor: PortalActor | null, input: Record<string, unknown>): Promise<Preferences> {
  const actor = actorRequired(rawActor);
  if (Object.keys(input).some(key => !['action', 'kind', 'id', 'pinned', 'projectPins', 'teamPins'].includes(key))) throw new HttpError(400, 'Há campos não permitidos nesta operação.', 'invalid_input');
  if (input.action === 'pin') {
    const kind = input.kind === 'team' ? 'team' : input.kind === 'project' ? 'project' : null;
    if (!kind) throw new HttpError(400, 'Escolha um projeto ou uma equipe.', 'invalid_pin_kind');
    const [id] = ids([input.id], 'fixados');
    if (typeof input.pinned !== 'boolean') throw new HttpError(400, 'Informe se o item fica fixado.', 'invalid_pin');
    const pinned = input.pinned, key = kind === 'project' ? 'projectPins' : 'teamPins';
    // Fixados que a pessoa não vê mais (acesso retirado, equipe arquivada) saem ao fixar algo novo,
    // para não ocupar vagas do limite sem aparecer em lugar nenhum.
    const before = pinned ? (await read(db, actor.userId))[key] : [];
    const visible = await visibleIds(db, actor, kind, before), hidden = new Set(before.filter(item => !visible.has(item)));
    return write(db, actor.userId, current => {
      const list = current[key].filter(item => item !== id && !hidden.has(item));
      if (pinned && list.length >= PIN_LIMIT) throw new HttpError(409, `Você pode fixar até ${PIN_LIMIT} ${kind === 'project' ? 'projetos' : 'equipes'}. Remova um para incluir outro.`, 'pin_limit');
      return { ...current, [key]: pinned ? [...list, id] : list };
    });
  }
  if (input.action === 'import') {
    // Traz os fixados que antes ficavam só neste navegador, sem apagar o que já está salvo na conta.
    const projectPins = input.projectPins === undefined ? [] : ids(input.projectPins, 'projetos');
    const teamPins = input.teamPins === undefined ? [] : ids(input.teamPins, 'equipes');
    return write(db, actor.userId, current => ({
      ...current,
      projectPins: [...new Set([...current.projectPins, ...projectPins])].slice(0, PIN_LIMIT),
      teamPins: [...new Set([...current.teamPins, ...teamPins])].slice(0, PIN_LIMIT),
    }));
  }
  throw new HttpError(400, 'Operação de preferências desconhecida.', 'invalid_action');
}
