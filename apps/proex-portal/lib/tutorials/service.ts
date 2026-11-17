import { accessibleProjects, accountBatch, requireLiveAccount, type PortalActor } from '../access';
import { calendarAvailable } from '../calendar';
import { all, iso } from '../database';
import { HttpError } from '../errors';
import { TUTORIAL_CHAPTERS, TUTORIAL_INVITE_ID, chapterById, resolveSteps, resumeIndex, stepById, type ResolvedStep, type TutorialAccess } from './catalog';

/*
 * Tutoriais do Portal: quais passos o acesso atual permite e o progresso pessoal.
 * O acesso é recalculado a cada consulta (abertura do tutorial e troca de projeto), a partir da sessão;
 * nada vem do navegador além do projeto escolhido, que só vale se estiver no alcance da conta.
 * Gravar só toca a linha da própria pessoa e exige conta ativa no momento da gravação.
 */
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
export type InviteState = 'new' | 'dismissed' | 'started';
export type ChapterProgress = { version: number; stepId: string; status: 'in_progress' | 'paused' | 'completed'; completedAt: string | null; updatedAt: string };
export type TutorialWorkspace = {
  chapters: { id: string; version: number; steps: ResolvedStep[]; resumeAt: number; outdated: boolean }[];
  progress: Record<string, ChapterProgress>;
  invite: InviteState;
  project: { selected: boolean; denied: boolean };
};

function actorRequired(actor: PortalActor | null): PortalActor {
  if (!actor) throw new HttpError(401, 'Entre para continuar.', 'unauthenticated');
  return actor;
}
function accessFor(actor: PortalActor, rawProject: unknown): { access: TutorialAccess; denied: boolean } {
  const projectScope = accessibleProjects(actor);
  const asked = typeof rawProject === 'string' && ID.test(rawProject) ? rawProject : null;
  // Projeto vizinho ou de outra organização: tratado como "nenhum projeto escolhido", sem revelar nada.
  const selectedProject = asked && (projectScope === null || projectScope.includes(asked)) ? asked : null;
  const managesOrganization = (actor.organizations ?? []).some(organization => organization.canManage);
  return { access: { projectScope, selectedProject, capabilityScope: capability => accessibleProjects(actor, capability), managesOrganization, calendar: calendarAvailable(actor) }, denied: Boolean(asked && !selectedProject) };
}

async function readProgress(db: D1Database, userId: string) {
  const rows = await all(db, 'SELECT chapter_id,chapter_version,step_id,status,completed_at,updated_at FROM user_tutorials WHERE user_id=? LIMIT 60', [userId]);
  const progress: Record<string, ChapterProgress> = {};
  let invite: InviteState = 'new';
  for (const row of rows) {
    const id = String(row.chapter_id);
    if (id === TUTORIAL_INVITE_ID) { invite = row.status === 'dismissed' ? 'dismissed' : row.status === 'started' ? 'started' : 'new'; continue; }
    if (!chapterById(id) || !['in_progress', 'paused', 'completed'].includes(String(row.status))) continue;
    progress[id] = { version: Number(row.chapter_version), stepId: String(row.step_id), status: row.status as ChapterProgress['status'], completedAt: row.completed_at ? String(row.completed_at) : null, updatedAt: String(row.updated_at) };
  }
  return { progress, invite };
}

export async function tutorialWorkspace(db: D1Database, rawActor: PortalActor | null, input: Record<string, unknown> = {}): Promise<TutorialWorkspace> {
  const actor = actorRequired(rawActor);
  await requireLiveAccount(db, actor.userId);
  const { access, denied } = accessFor(actor, input.projectId);
  const { progress, invite } = await readProgress(db, actor.userId);
  return {
    chapters: TUTORIAL_CHAPTERS.map(chapter => {
      const steps = resolveSteps(chapter, access), saved = progress[chapter.id];
      return { id: chapter.id, version: chapter.version, steps, resumeAt: resumeIndex(chapter, steps, saved?.status === 'completed' ? null : saved?.stepId), outdated: Boolean(saved && saved.version < chapter.version) };
    }),
    progress, invite,
    project: { selected: Boolean(access.selectedProject), denied },
  };
}

const STATUSES = ['in_progress', 'paused', 'completed'] as const;

export async function tutorialAction(db: D1Database, rawActor: PortalActor | null, input: Record<string, unknown>): Promise<TutorialWorkspace> {
  const actor = actorRequired(rawActor), now = iso();
  const action = input.action;
  if (action === 'invite.dismiss' || action === 'invite.start') {
    const status = action === 'invite.dismiss' ? 'dismissed' : 'started';
    await accountBatch(db, actor.userId, [db.prepare(`INSERT INTO user_tutorials(user_id,chapter_id,chapter_version,step_id,status,completed_at,updated_at) VALUES(?,?,1,'',?,NULL,?)
      ON CONFLICT(user_id,chapter_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at`).bind(actor.userId, TUTORIAL_INVITE_ID, status, now)]);
    return tutorialWorkspace(db, actor, input);
  }
  const chapter = chapterById(input.chapterId);
  if (!chapter) throw new HttpError(400, 'Escolha um tutorial válido.', 'invalid_tutorial');
  if (action === 'progress.restart') {
    // Recomeçar zera só o ponto de parada; a data da primeira conclusão fica como histórico.
    await accountBatch(db, actor.userId, [db.prepare(`UPDATE user_tutorials SET step_id='',status='in_progress',chapter_version=?,updated_at=? WHERE user_id=? AND chapter_id=?`).bind(chapter.version, now, actor.userId, chapter.id)]);
    return tutorialWorkspace(db, actor, input);
  }
  if (action !== 'progress.save') throw new HttpError(400, 'Ação inválida.', 'invalid_action');
  const step = stepById(chapter, input.stepId);
  if (!step) throw new HttpError(400, 'Passo do tutorial inválido.', 'invalid_tutorial_step');
  const status = STATUSES.find(value => value === input.status);
  if (!status) throw new HttpError(400, 'Situação do tutorial inválida.', 'invalid_tutorial_status');
  // O passo precisa estar liberado pelo acesso de agora (conta, projeto escolhido e capacidades).
  const { access } = accessFor(actor, input.projectId);
  const allowed = resolveSteps(chapter, access).find(entry => entry.id === step.id);
  if (!allowed?.available) throw new HttpError(409, allowed?.reason ?? 'Este passo não está disponível para o seu acesso agora.', 'tutorial_step_unavailable');
  await accountBatch(db, actor.userId, [db.prepare(`INSERT INTO user_tutorials(user_id,chapter_id,chapter_version,step_id,status,completed_at,updated_at) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(user_id,chapter_id) DO UPDATE SET chapter_version=excluded.chapter_version,step_id=excluded.step_id,status=excluded.status,
      completed_at=COALESCE(user_tutorials.completed_at,excluded.completed_at),updated_at=excluded.updated_at`)
    .bind(actor.userId, chapter.id, chapter.version, step.id, status, status === 'completed' ? now : null, now)]);
  return tutorialWorkspace(db, actor, input);
}
