import { projectAuthoritySql, type PortalActor } from '../access';
import { iso, uid } from '../database';
import { HttpError } from '../errors';
import { id, onlyKeys } from '../follow-up/contracts';
import { prepareMutation } from '../mutations';
import { folderAudienceSql } from './folders';

type Context = { projectId: string; scheduleItemId: string };
type MediaFolder = { id: string; name: string };
export type ActivityMediaFolderView = Context & {
  viewerId: string;
  version: number;
  selected: MediaFolder | null;
  unavailable: boolean;
  folders: MediaFolder[];
  truncated: boolean;
};

const LIMIT = 100;
const DRIVE_FOLDER_ID = /^[A-Za-z0-9_-]{10,200}$/;
const denied = () => new HttpError(404, 'Pasta de vídeos indisponível neste contexto.', 'activity_media_unavailable');

function contextOf(input: Record<string, unknown>): Context {
  return { projectId: id(input.projectId)!, scheduleItemId: id(input.scheduleItemId)! };
}

function signedIn(actor: PortalActor | null): asserts actor is PortalActor {
  if (!actor) throw new HttpError(401, 'Entre no Portal para consultar a pasta da atividade.', 'unauthenticated');
}

function contextQuery(actor: PortalActor, context: Context) {
  const authority = projectAuthoritySql(actor, ['campaigns.manage'], 'p.id');
  return {
    sql: `SELECT s.id, p.id project_id, o.id organization_id FROM project_schedule_items s
      JOIN projects p ON p.id = s.project_id JOIN organizations o ON o.id = p.organization_id
      WHERE s.id = ? AND p.id = ? AND p.status = 'active' AND o.status = 'active' AND ${authority.sql}`,
    values: [context.scheduleItemId, context.projectId, ...authority.values],
  };
}

// Organization-wide management folders are valid elsewhere, but an activity needs its own project folder.
const eligibleFolder = `f.project_id = scope.project_id AND f.organization_id = scope.organization_id
  AND f.audience = 'managers' AND f.status = 'active' AND ${folderAudienceSql('f')}`;

export async function activityMediaFolder(db: D1Database, actor: PortalActor | null, input: Record<string, unknown>): Promise<ActivityMediaFolderView> {
  signedIn(actor);
  const context = contextOf(input), scope = contextQuery(actor, context);
  const row = await db.prepare(`WITH scope AS (${scope.sql}), choices AS (
      SELECT f.id, f.name FROM google_drive_folders f JOIN scope WHERE ${eligibleFolder}
      ORDER BY CASE WHEN f.id = (SELECT folder_id FROM schedule_item_media_folders WHERE schedule_item_id = scope.id) THEN 0 ELSE 1 END,
        f.name COLLATE NOCASE, f.id LIMIT ${LIMIT + 1}
    )
    SELECT COALESCE(link.version,0) version, link.folder_id selected_id,
      (SELECT json_group_array(json_object('id',id,'name',name)) FROM choices) folders
    FROM scope LEFT JOIN schedule_item_media_folders link ON link.schedule_item_id = scope.id`)
    .bind(...scope.values, actor.userId).first<{ version: number; selected_id: string | null; folders: string }>();
  if (!row) throw denied();
  const all = JSON.parse(row.folders) as MediaFolder[];
  const selected = all.find(folder => folder.id === row.selected_id) ?? null;
  return { ...context, viewerId: actor.userId, version: row.version, selected,
    unavailable: row.selected_id !== null && selected === null, folders: all.slice(0, LIMIT), truncated: all.length > LIMIT };
}

export async function activityMediaFolderUrl(db: D1Database, actor: PortalActor | null, input: Record<string, unknown>): Promise<string> {
  signedIn(actor);
  const scope = contextQuery(actor, contextOf(input));
  const row = await db.prepare(`WITH scope AS (${scope.sql})
    SELECT f.drive_folder_id FROM scope JOIN schedule_item_media_folders link ON link.schedule_item_id = scope.id
    JOIN google_drive_folders f ON f.id = link.folder_id WHERE ${eligibleFolder}`)
    .bind(...scope.values, actor.userId).first<{ drive_folder_id: string }>();
  if (!row || !DRIVE_FOLDER_ID.test(row.drive_folder_id)) throw denied();
  return `https://drive.google.com/drive/folders/${encodeURIComponent(row.drive_folder_id)}`;
}

export async function saveActivityMediaFolder(db: D1Database, actor: PortalActor | null, input: Record<string, unknown>): Promise<ActivityMediaFolderView> {
  signedIn(actor);
  onlyKeys(input, ['projectId', 'scheduleItemId', 'folderId', 'expectedVersion', 'operationKey']);
  const context = contextOf(input), scope = contextQuery(actor, context);
  if (!await db.prepare(scope.sql).bind(...scope.values).first()) throw denied();
  const version = input.expectedVersion;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) {
    throw new HttpError(400, 'Atualize a pasta antes de salvar.', 'activity_media_version');
  }
  const folderId = input.folderId === null ? null : id(input.folderId)!;
  const mutation = await prepareMutation(db, actor.userId, 'activity.media-folder.save', input);
  if (mutation.existingId) return activityMediaFolder(db, actor, context);

  const statements = [
    db.prepare(`SELECT CASE WHEN EXISTS(${scope.sql}) THEN 1 ELSE json_extract('[]','activity_media_denied') END`).bind(...scope.values),
    ...(folderId ? [db.prepare(`WITH scope AS (${scope.sql})
      SELECT CASE WHEN EXISTS(SELECT 1 FROM google_drive_folders f JOIN scope WHERE f.id = ? AND ${eligibleFolder})
      THEN 1 ELSE json_extract('[]','activity_media_denied') END`).bind(...scope.values, folderId, actor.userId)] : []),
    mutation.claimStatement(context.scheduleItemId),
    db.prepare(`SELECT CASE WHEN COALESCE((SELECT version FROM schedule_item_media_folders WHERE schedule_item_id = ?),0) = ?
      THEN 1 ELSE json_extract('[]','activity_media_conflict') END`).bind(context.scheduleItemId, version),
    db.prepare(`INSERT INTO schedule_item_media_folders(schedule_item_id,folder_id,version,updated_at) VALUES(?,?,1,?)
      ON CONFLICT(schedule_item_id) DO UPDATE SET folder_id=excluded.folder_id,version=schedule_item_media_folders.version+1,updated_at=excluded.updated_at`)
      .bind(context.scheduleItemId, folderId, iso()),
    db.prepare(`INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at)
      VALUES(?,?,?,?,?,?,?)`).bind(uid(), actor.userId, context.projectId, folderId ? 'activity.media-folder.link' : 'activity.media-folder.unlink',
      context.scheduleItemId, '{}', iso()),
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    const message = String(error);
    if (message.includes('activity_media_denied')) throw denied();
    if (message.includes('activity_media_conflict')) throw new HttpError(409, 'A pasta mudou. Atualize para conferir a alteração.', 'activity_media_conflict');
    await mutation.recover(error);
  }
  return activityMediaFolder(db, actor, context);
}
