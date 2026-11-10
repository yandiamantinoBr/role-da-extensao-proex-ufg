import type { PortalActor } from '../access';
import { all, one, uid, iso, type Row } from '../database';
import { HttpError } from '../errors';
import { PROEX_TEAM, PROEX_TEAM_SOURCE } from '../catalog/proex-team';
import { structureWorkspace } from '../institutional-structure/service';
import { GUIDE_SECTION_LABEL, GUIDE_STARTER, LIVE_BLOCKS, starterBySlug, type GuideSection } from './guide-starter';
import { identifier, organizationAuthoritySql, organizationMemberSql, projectAuthoritySql, requireActor, requireOrganizationMember } from './scope';

/*
 * Guia da PROEX: páginas em Markdown simples, editáveis pela administração da organização e por
 * editores que ela designar. Cada gravação cria uma versão com autor; restaurar cria outra versão.
 * Enquanto ninguém editou uma página, ela mostra o conteúdo inicial (guide-starter.ts).
 */

export const GUIDE_BODY_LIMIT = 40000;
export type GuidePage = {
  slug: string; title: string; section: GuideSection; sectionLabel: string; position: number;
  version: number; updatedAt: string | null; updatedBy: string; isStarter: boolean; body: string; markdown: string;
};

/** Editor designado e ainda membro ativo da organização. */
function editorGuard(userId: string, organizationId: string) {
  return { sql: `(EXISTS(SELECT 1 FROM org_guide_editors ge WHERE ge.organization_id=? AND ge.user_id=?) AND ${organizationMemberSql('?', '?')})`,
    values: [organizationId, userId, userId, organizationId, organizationId] };
}
async function canEditGuide(db: D1Database, actor: PortalActor, organizationId: string, owner: boolean): Promise<boolean> {
  if (owner) return true;
  const editor = editorGuard(actor.userId, organizationId);
  return !!await one(db, `SELECT 1 ok WHERE ${editor.sql}`, editor.values);
}
const brDate = (day: string) => day.split('-').reverse().join('/');
const civil = (value: unknown) => { const text = String(value ?? ''); if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text; const time = Date.parse(text); return Number.isFinite(time) ? new Date(time - 3 * 3600_000).toISOString().slice(0, 10) : ''; };
const md = (text: unknown) => String(text ?? '').replace(/[\\*_`#[\]|<>]/g, char => `\\${char}`).replace(/\s+/g, ' ').trim();

/** Blocos vivos: sempre lidos com as permissões de quem está vendo. */
async function liveBlocks(db: D1Database, actor: PortalActor, organizationId: string): Promise<Record<string, string>> {
  const visible = projectAuthoritySql(actor, [], 'p.id');
  const [projects, upcoming, structure] = await Promise.all([
    all(db, `SELECT p.name,COALESCE(t.label,'') tipo,p.lifecycle,p.status FROM projects p LEFT JOIN project_types t ON t.id=p.type_id
      WHERE p.organization_id=? AND ${visible.sql} ORDER BY CASE p.lifecycle WHEN 'active' THEN 0 WHEN 'catalog' THEN 1 ELSE 2 END,p.name LIMIT 80`, [organizationId, ...visible.values]),
    all(db, `SELECT s.title titulo,s.starts_at inicio,p.name projeto FROM project_schedule_items s JOIN projects p ON p.id=s.project_id
      WHERE p.organization_id=? AND s.status<>'cancelled' AND date(s.starts_at,'-3 hours')>=date('now','-3 hours') AND date(s.starts_at,'-3 hours')<=date('now','-3 hours','+180 days') AND ${visible.sql}
      UNION ALL SELECT c.name,c.starts_at,p.name FROM campaigns c JOIN projects p ON p.id=c.project_id
      WHERE p.organization_id=? AND c.status IN ('draft','active') AND date(c.starts_at,'-3 hours')>=date('now','-3 hours') AND date(c.starts_at,'-3 hours')<=date('now','-3 hours','+180 days') AND ${visible.sql}
      ORDER BY 2 LIMIT 40`, [organizationId, ...visible.values, organizationId, ...visible.values]),
    structureWorkspace(db, actor, { organizationId }).catch(() => null),
  ]);
  const lifecycle: Record<string, string> = { active: 'em andamento', past: 'encerrado', catalog: 'catálogo' };
  const nodes = (structure?.nodes ?? []) as Row[];
  const children = (parent: unknown, depth: number): string[] => nodes.filter(node => (node.parent_id ?? null) === (parent ?? null))
    .flatMap(node => [`${'  '.repeat(depth)}- ${md(node.name)}${node.acronym ? ` (${md(node.acronym)})` : ''}`, ...children(node.id, depth + 1)]);
  const tree = children(null, 0);
  const sectors = [...new Set(PROEX_TEAM.map(person => person.sector))];
  return {
    estrutura: tree.length ? tree.join('\n') : '_O organograma ainda não foi cadastrado no portal (Equipes → Estrutura institucional)._',
    programas: projects.length ? projects.map(row => `- ${md(row.name)}${row.tipo ? ` — ${md(row.tipo)}` : ''}${row.lifecycle ? ` · ${lifecycle[String(row.lifecycle)] ?? md(row.lifecycle)}` : ''}${row.status === 'archived' ? ' · arquivado' : ''}`).join('\n') : '_Nenhum projeto visível para você nesta organização._',
    calendario: upcoming.length ? upcoming.map(row => `- ${brDate(civil(row.inicio))} — ${md(row.titulo)} (${md(row.projeto)})`).join('\n') : '_Nenhum marco ou dinâmica nos próximos 180 dias._',
    'equipe-oficial': sectors.map(sector => `## ${md(sector)}\n\n${PROEX_TEAM.filter(person => person.sector === sector).map(person => `- ${md(person.name)}${person.position ? ` — ${md(person.position)}` : ''}${person.contactStatus === 'published' && person.email ? ` · ${person.email}` : ''}`).join('\n')}`).join('\n\n')
      + `\n\nCópia conferida em ${brDate(PROEX_TEAM_SOURCE.verifiedAt)}.`,
  };
}
export function resolveBlocks(body: string, blocks: Record<string, string>): string {
  return body.replace(/\{\{([a-z-]+)\}\}/g, (match, name: string) => blocks[name] ?? match);
}

export async function guideWorkspace(db: D1Database, rawActor: PortalActor | null, input: Record<string, unknown>) {
  const actor = requireActor(rawActor), organizationId = identifier(input.organizationId, 'a organização');
  const organization = await requireOrganizationMember(db, actor, organizationId);
  const [saved, blocks, canEdit] = await Promise.all([
    all(db, `SELECT g.slug,g.title,g.section,g.body,g.position,g.version,g.updated_at,COALESCE(NULLIF(pr.display_name,''),'') updated_by_name
      FROM org_guide_pages g LEFT JOIN profiles pr ON pr.user_id=g.updated_by WHERE g.organization_id=? ORDER BY g.position,g.slug LIMIT 200`, [organizationId]),
    liveBlocks(db, actor, organizationId),
    canEditGuide(db, actor, organizationId, organization.owner),
  ]);
  const bySlug = new Map(saved.map(row => [String(row.slug), row]));
  const pages: GuidePage[] = [
    ...GUIDE_STARTER.map(starter => {
      const row = bySlug.get(starter.slug);
      const body = row ? String(row.body) : starter.body;
      return { slug: starter.slug, title: row ? String(row.title) : starter.title, section: starter.section, sectionLabel: GUIDE_SECTION_LABEL[starter.section], position: starter.position,
        version: row ? Number(row.version) : 0, updatedAt: row ? String(row.updated_at) : null, updatedBy: row ? String(row.updated_by_name) : '', isStarter: !row, body, markdown: resolveBlocks(body, blocks) };
    }),
    ...saved.filter(row => !starterBySlug(String(row.slug))).map(row => ({ slug: String(row.slug), title: String(row.title), section: row.section as GuideSection, sectionLabel: GUIDE_SECTION_LABEL[row.section as GuideSection],
      position: Number(row.position), version: Number(row.version), updatedAt: String(row.updated_at), updatedBy: String(row.updated_by_name), isStarter: false, body: String(row.body), markdown: resolveBlocks(String(row.body), blocks) })),
  ].sort((a, b) => a.position - b.position || a.slug.localeCompare(b.slug));
  const editors = organization.owner ? await all(db, `SELECT ge.user_id userId,COALESCE(NULLIF(pr.display_name,''),'Integrante') name FROM org_guide_editors ge LEFT JOIN profiles pr ON pr.user_id=ge.user_id
    WHERE ge.organization_id=? ORDER BY name LIMIT 100`, [organizationId]) : [];
  const candidates = organization.owner ? await all(db, `SELECT DISTINCT m.user_id userId,COALESCE(NULLIF(pr.display_name,''),'Integrante') name FROM members m LEFT JOIN profiles pr ON pr.user_id=m.user_id LEFT JOIN portal_users u ON u.user_id=m.user_id
    WHERE m.revoked_at IS NULL AND COALESCE(u.status,'active')='active' AND u.anonymized_at IS NULL AND (m.organization_id=? OR EXISTS(SELECT 1 FROM projects p WHERE p.id=m.project_id AND p.organization_id=?)) ORDER BY name LIMIT 300`, [organizationId, organizationId]) : [];
  return { organization: { id: organizationId, name: organization.name }, canEdit, canManageEditors: organization.owner, pages, editors, candidates, liveBlocks: [...LIVE_BLOCKS] };
}

export async function guideHistory(db: D1Database, rawActor: PortalActor | null, input: Record<string, unknown>) {
  const actor = requireActor(rawActor), organizationId = identifier(input.organizationId, 'a organização'), slug = identifier(input.slug, 'a página');
  await requireOrganizationMember(db, actor, organizationId);
  return { versions: await all(db, `SELECT v.version,v.title,v.author_name author,v.note,v.created_at createdAt,length(v.body) size FROM org_guide_page_versions v JOIN org_guide_pages g ON g.id=v.page_id
    WHERE g.organization_id=? AND g.slug=? ORDER BY v.version DESC LIMIT 100`, [organizationId, slug]) };
}

function pageText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') throw new HttpError(400, `Informe ${label}.`, 'invalid_guide_text');
  const text = value.replace(/\r\n?/g, '\n');
  if (!text.trim() || text.length > max) throw new HttpError(400, `${label[0].toUpperCase()}${label.slice(1)} precisa ter de 1 a ${max.toLocaleString('pt-BR')} caracteres.`, 'invalid_guide_text');
  return text;
}

export async function guideAction(db: D1Database, rawActor: PortalActor | null, input: Record<string, unknown>) {
  const actor = requireActor(rawActor), organizationId = identifier(input.organizationId, 'a organização');
  const organization = await requireOrganizationMember(db, actor, organizationId);
  const now = iso(), owner = organizationAuthoritySql(actor, organizationId);
  const authorRow = await one(db, `SELECT COALESCE(NULLIF(display_name,''),'Integrante') name FROM profiles WHERE user_id=?`, [actor.userId]);
  const author = String(authorRow?.name ?? 'Integrante');
  // Guarda final, avaliada na própria escrita: responsável da organização ou editor designado ainda ativo.
  const editor = editorGuard(actor.userId, organizationId);
  const writeGuard = `((${owner.sql}) OR ${editor.sql})`, guardValues = [...owner.values, ...editor.values];

  if (input.action === 'editors.add' || input.action === 'editors.remove') {
    if (!organization.owner) throw new HttpError(403, 'Só a administração da organização designa editores do guia.', 'guide_editors_forbidden');
    const userId = identifier(input.userId, 'a pessoa');
    const write = input.action === 'editors.add'
      ? db.prepare(`INSERT OR IGNORE INTO org_guide_editors(organization_id,user_id,granted_by,created_at) SELECT ?,?,?,? WHERE (${owner.sql}) AND ${organizationMemberSql('?', '?')}`).bind(organizationId, userId, actor.userId, now, ...owner.values, userId, organizationId, organizationId)
      : db.prepare(`DELETE FROM org_guide_editors WHERE organization_id=? AND user_id=? AND (${owner.sql})`).bind(organizationId, userId, ...owner.values);
    await db.batch([write, db.prepare(`INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) SELECT ?,?,NULL,?,?,?,? WHERE changes()=1`).bind(uid(), actor.userId, `guide.${input.action}`, userId, JSON.stringify({ organizationId }), now)]);
    return guideWorkspace(db, actor, { organizationId });
  }

  if (input.action !== 'save' && input.action !== 'restore') throw new HttpError(400, 'Ação inválida.', 'invalid_action');
  if (!await canEditGuide(db, actor, organizationId, organization.owner)) throw new HttpError(403, 'Seu acesso permite ler o guia, mas não editar.', 'guide_forbidden');
  const slug = identifier(input.slug, 'a página');
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) throw new HttpError(400, 'Endereço de página inválido.', 'invalid_guide_slug');
  const starter = starterBySlug(slug);
  const current = await one(db, 'SELECT id,version,section,position FROM org_guide_pages WHERE organization_id=? AND slug=?', [organizationId, slug]);
  let title: string, body: string, note: string;
  if (input.action === 'restore') {
    if (!current) throw new HttpError(404, 'Página sem histórico.', 'guide_not_found');
    const version = Number(input.version);
    const old = await one(db, 'SELECT title,body FROM org_guide_page_versions WHERE page_id=? AND version=?', [current.id, version]);
    if (!old) throw new HttpError(404, 'Versão não encontrada.', 'guide_version_not_found');
    title = String(old.title); body = String(old.body); note = `Restaurada a versão ${version}`;
  } else {
    title = pageText(input.title, 'o título', 160).replace(/\s+/g, ' ').trim();
    body = pageText(input.body, 'o texto', GUIDE_BODY_LIMIT);
    note = typeof input.note === 'string' ? input.note.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
  }
  const expected = Number(input.expectedVersion ?? 0);
  if (!Number.isSafeInteger(expected) || expected < 0) throw new HttpError(400, 'Atualize a página e tente de novo.', 'invalid_version');
  if ((current ? Number(current.version) : 0) !== expected) throw new HttpError(409, 'Outra pessoa salvou esta página antes. Atualize para ver a versão nova; seu texto continua no editor.', 'guide_conflict');
  const section = (current?.section ?? starter?.section ?? 'referencias') as GuideSection;
  if (!current && !starter) throw new HttpError(404, 'Página não encontrada.', 'guide_not_found');
  const pageId = current ? String(current.id) : uid(), next = expected + 1;
  const write = current
    ? db.prepare(`UPDATE org_guide_pages SET title=?,body=?,version=?,updated_by=?,updated_at=? WHERE id=? AND version=? AND ${writeGuard}`).bind(title, body, next, actor.userId, now, pageId, expected, ...guardValues)
    : db.prepare(`INSERT INTO org_guide_pages(id,organization_id,slug,title,section,body,position,version,updated_by,created_at,updated_at) SELECT ?,?,?,?,?,?,?,1,?,?,? WHERE ${writeGuard}`)
      .bind(pageId, organizationId, slug, title, section, body, starter?.position ?? 99, actor.userId, now, now, ...guardValues);
  let results: D1Result[];
  try {
    results = await db.batch([
      write,
      db.prepare(`INSERT INTO org_guide_page_versions(id,page_id,organization_id,version,title,body,author_id,author_name,note,created_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE changes()=1`)
        .bind(uid(), pageId, organizationId, next, title, body, actor.userId, author, note, now),
      db.prepare(`INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) SELECT ?,?,NULL,?,?,?,? WHERE EXISTS(SELECT 1 FROM org_guide_page_versions WHERE page_id=? AND version=?)`)
        .bind(uid(), actor.userId, `guide.${input.action}`, pageId, JSON.stringify({ organizationId, slug, version: next }), now, pageId, next),
    ]);
  } catch (error) {
    if (String(error).includes('UNIQUE')) throw new HttpError(409, 'Outra pessoa salvou esta página antes. Atualize e tente de novo.', 'guide_conflict');
    throw error;
  }
  if (results[0].meta.changes !== 1) throw new HttpError(409, 'A página mudou ou seu acesso mudou. Atualize e tente de novo.', 'guide_conflict');
  return guideWorkspace(db, actor, { organizationId });
}

/** Mesmo conteúdo do guia para o assistente Rolê: Markdown resolvido com as permissões de quem pergunta. */
export async function guideForAssistant(db: D1Database, actor: PortalActor | null, organizationId: string) {
  const workspace = await guideWorkspace(db, actor, { organizationId });
  return workspace.pages.map(page => ({ slug: page.slug, title: page.title, section: page.sectionLabel, updatedAt: page.updatedAt, version: page.version, markdown: page.markdown }));
}
