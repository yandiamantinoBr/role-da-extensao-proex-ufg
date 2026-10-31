import { getActor, requireCapability, type PortalActor } from '../access';
import { all, one } from '../database';
import { HttpError } from '../errors';
import { materialsAction } from '../materials';
import { prepareMutation } from '../mutations';
import { projectAction } from '../projects';
import { createRecord } from '../records';
import { MODALITY_TYPE_KEYS } from '../extension-catalog';
import { importFields, type ImportFileProvenance, type ImportKind, type ImportPreview, type ImportReview } from './contracts';
import { normalizedLabel, parseImportDocument, validateImportedFields } from './parse';
import { importDigest, readImportReview, signImportReview } from './review';
import { readPublicSigaa } from './sigaa';

function optionalId(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) throw new HttpError(400, 'Escolha um cadastro válido no portal.', 'import_target');
  return value;
}
export async function authorizeImportTarget(db: D1Database, actor: PortalActor | null, kind: ImportKind, projectId: string | null, itemId: string | null) {
  if (!actor) throw new HttpError(401, 'Entre para importar um cadastro.', 'unauthenticated');
  const current = await getActor(db, actor);
  if (!current) throw new HttpError(403, 'Seu acesso ao portal mudou. Entre novamente.', 'import_forbidden');
  if (!projectId) { if (kind !== 'project' || itemId) throw new HttpError(400, 'Escolha o projeto responsável pelo bem.', 'import_target'); requireCapability(current, 'projects.manage', null); return null; }
  requireCapability(current, kind === 'asset' ? 'inventory.manage' : 'campaigns.manage', projectId);
  const project = await one(db, 'SELECT id,name,version FROM projects WHERE id=?', [projectId]);
  if (!project) throw new HttpError(404, 'Projeto não encontrado.', 'project_not_found');
  if (itemId && (kind !== 'asset' || !await one(db, 'SELECT id FROM items WHERE id=? AND project_id=?', [itemId, projectId]))) throw new HttpError(400, 'O bem deve pertencer ao projeto escolhido.', 'project_mismatch');
  return project;
}
function documentUrl(value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 500) throw new HttpError(400, 'Use uma URL HTTPS de até 500 caracteres para a fonte.', 'import_source_url');
  let url: URL; try { url = new URL(value); } catch { throw new HttpError(400, 'Informe um endereço HTTPS válido para a fonte.', 'import_source_url'); }
  if (url.protocol !== 'https:' || url.username || url.password || Array.from(url.searchParams.keys()).some(key => /token|signature|secret|password|credential|api.?key/i.test(key)) || /token|signature|secret|password/i.test(url.hash)) throw new HttpError(400, 'A fonte deve usar HTTPS sem credenciais ou links temporários de acesso.', 'import_source_url');
  return url.href;
}
const modalityKey = (value: string) => ({ programa: 'program', projeto: 'project', curso: 'course', evento: 'event', prestacaodeservico: 'service', prestacaodeservicos: 'service' } as Record<string, string>)[normalizedLabel(value)] ?? MODALITY_TYPE_KEYS[value];
export async function previewImport(db: D1Database, actor: PortalActor | null, input: Record<string, unknown>, secret: string, fetcher?: typeof fetch, sourceFile?: ImportFileProvenance): Promise<ImportPreview> {
  if (input.kind !== 'project' && input.kind !== 'asset') throw new HttpError(400, 'Escolha projeto ou bem patrimonial.', 'import_kind');
  const kind = input.kind, projectId = optionalId(input.projectId), itemId = optionalId(input.itemId);
  const project = await authorizeImportTarget(db, actor, kind, projectId, itemId);
  let content: string, format: string, url: string | undefined, externalId: string | undefined;
  if (input.sourceMode === 'sigaa') {
    if (kind !== 'project') throw new HttpError(400, 'O SIGAA público importa informações de projetos.', 'import_source');
    const source = await readPublicSigaa(input.sourceUrl, fetcher); content = source.content; url = source.url; externalId = source.externalId; format = 'html';
  } else if (input.sourceMode === 'document' || input.sourceMode === 'manual') {
    if (typeof input.content !== 'string') throw new HttpError(400, 'Informe o conteúdo textual do documento.', 'import_document');
    content = input.content; format = input.sourceMode === 'manual' ? 'json' : String(input.format); url = documentUrl(input.sourceUrl);
  } else throw new HttpError(400, 'Escolha uma fonte de importação.', 'import_source');
  const candidates = parseImportDocument(kind, content, format);
  if (kind === 'project') {
    const [units, types] = await Promise.all([all(db, "SELECT id,name,acronym FROM organizational_units WHERE status='active'"), all(db, "SELECT id,key,label FROM project_types WHERE status='active'")]);
    for (const candidate of candidates) {
      const unit = candidate.fields.unitName ? units.filter(row => [row.name, row.acronym].some(value => normalizedLabel(String(value)) === normalizedLabel(candidate.fields.unitName))) : [];
      if (unit.length === 1) candidate.suggestedUnitId = unit[0].id;
      const key = modalityKey(candidate.fields.modality ?? ''), type = types.filter(row => row.key === key);
      if (type.length === 1) candidate.suggestedTypeId = type[0].id;
      if (candidate.fields.unitName && !candidate.suggestedUnitId) candidate.warnings.push('Confira e selecione a unidade correspondente no portal.');
      if (candidate.fields.modality && !candidate.suggestedTypeId) candidate.warnings.push('Confira e selecione o tipo de iniciativa correspondente no portal.');
    }
  }
  const now = Date.now();
  const review: ImportReview = { version: 1, actorId: actor!.userId, kind, projectId, itemId, expectedVersion: kind === 'project' && project ? project.version : null,
    provenance: { kind: input.sourceMode, label: sourceFile ? `${sourceFile.fileFormat.toUpperCase()} informado · texto extraído` : input.sourceMode === 'sigaa' ? 'SIGAA Público / UFG' : input.sourceMode === 'manual' ? 'Cadastro manual conferido' : 'Documento textual informado', ...(url ? { url } : {}), ...(externalId ? { externalId } : {}), sha256: sourceFile?.sha256 ?? await importDigest(content), ...(sourceFile ? { textSha256: await importDigest(content), fileFormat: sourceFile.fileFormat, extraction: sourceFile.extraction, ...(sourceFile.pages ? { pages: sourceFile.pages } : {}) } : {}), retrievedAt: new Date(now).toISOString() }, candidates, expiresAt: now + 15 * 60000 };
  const { actorId: _actorId, ...publicReview } = review; void _actorId;
  return { ...publicReview, reviewToken: await signImportReview(secret, review) };
}
export async function applyImport(db: D1Database, actor: PortalActor | null, input: Record<string, unknown>, secret: string) {
  if (!actor) throw new HttpError(401, 'Entre para importar um cadastro.', 'unauthenticated');
  if (input.confirmed !== true) throw new HttpError(400, 'Confira a prévia e confirme os campos antes de salvar.', 'import_confirmation_required');
  const review = await readImportReview(secret, input.reviewToken, actor.userId);
  await authorizeImportTarget(db, actor, review.kind, review.projectId, review.itemId);
  const candidate = review.candidates.find(row => row.key === input.candidateKey);
  const allowed = new Set(importFields(review.kind).map(field => field.key)), edits = input.edits ?? {};
  if (!edits || typeof edits !== 'object' || Array.isArray(edits) || Object.keys(edits).some(key => !allowed.has(key))) throw new HttpError(400, 'Revise somente os campos operacionais da prévia.', 'import_fields');
  const values: Record<string, unknown> = { ...candidate?.fields, ...edits };
  if (!candidate || !Array.isArray(input.selectedFields) || !input.selectedFields.length || input.selectedFields.some(key => typeof key !== 'string' || !Object.hasOwn(values, key))) throw new HttpError(400, 'Selecione os campos da prévia que deseja importar.', 'import_fields');
  const selected = new Set(input.selectedFields as string[]);
  if (Array.from(selected).some(key => !allowed.has(key))) throw new HttpError(400, 'Um dos campos não pode ser importado.', 'import_fields');
  const checked = validateImportedFields(review.kind, Object.fromEntries(Array.from(selected, key => [key, values[key]])));
  if (Object.keys(checked.problems).length) throw new HttpError(400, 'Há campos inválidos selecionados. Corrija a fonte ou desmarque esses campos.', 'import_fields');
  const fields = checked.fields;
  if ((selected.has('name') && !fields.name) || (!review.projectId && !fields.name) || (review.kind === 'asset' && !review.itemId && !fields.name)) throw new HttpError(400, 'Selecione um nome válido para o cadastro.', 'import_name');
  if (typeof input.operationKey !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(input.operationKey)) throw new HttpError(400, 'Atualize a importação para gerar uma operação válida.', 'invalid_operation');
  const operationKey = input.operationKey, nativeFields = Object.fromEntries(importFields(review.kind).filter(field => !field.metadata && selected.has(field.key)).map(field => [field.key, fields[field.key]]));
  let projectId = review.projectId, itemId = review.itemId;
  if (review.kind === 'project') {
    const payload: Record<string, unknown> = { ...nativeFields, operationKey: `${operationKey}-entity`, ...(projectId ? { id: projectId, expectedVersion: review.expectedVersion } : {}) };
    if (selected.has('unitName') && input.unitId) payload.unitId = optionalId(input.unitId);
    if (selected.has('modality') && input.typeId) payload.typeId = optionalId(input.typeId);
    if (input.saveOfficialUrl === true && review.provenance.url) payload.officialUrl = review.provenance.url;
    const action = `project.${projectId ? 'update' : 'create'}`;
    if (!projectId && review.provenance.url) {
      const mutation = await prepareMutation(db, actor.userId, action, payload);
      if (!mutation.existingId && await one(db, 'SELECT p.id FROM projects p LEFT JOIN project_links l ON l.project_id=p.id WHERE p.official_url=? OR l.url=? LIMIT 1', [review.provenance.url, review.provenance.url])) throw new HttpError(409, 'Esta fonte já está vinculada a um projeto. Escolha o cadastro existente para atualizar.', 'import_duplicate');
    }
    const result = await projectAction(db, actor, action, payload); projectId = result?.id;
    if (!projectId) throw new HttpError(500, 'Não foi possível confirmar o projeto importado.', 'import_result');
    if (review.provenance.url && !await one(db, 'SELECT id FROM project_links WHERE project_id=? AND url=?', [projectId, review.provenance.url])) await projectAction(db, actor, 'project.link.create', { projectId, label: `${review.provenance.label}${review.provenance.externalId ? ` · ação ${review.provenance.externalId}` : ''} · ${review.provenance.retrievedAt.slice(0, 10)}`, url: review.provenance.url, kind: 'official', operationKey: `${operationKey}-source` });
  } else if (!itemId) {
    const payload = { ...nativeFields, projectId, category: 'equipment', unit: nativeFields.unit || 'unidade', lowStock: 0, operationKey: `${operationKey}-entity` };
    const mutation = await prepareMutation(db, actor.userId, 'item.create', payload);
    if (!mutation.existingId && fields.assetCode && await one(db, 'SELECT id FROM items WHERE project_id=? AND asset_code=? LIMIT 1', [projectId, fields.assetCode])) throw new HttpError(409, 'Este patrimônio já está cadastrado no projeto. Escolha o bem existente para anexar a conferência.', 'import_duplicate');
    const result = await materialsAction(db, actor, 'item.create', payload), item = result?.item as Record<string, unknown> | undefined;
    itemId = typeof item?.id === 'string' ? item.id : null;
    if (!itemId) throw new HttpError(500, 'Não foi possível confirmar o bem importado.', 'import_result');
  }
  const metadata = importFields(review.kind).filter(field => (field.metadata || review.kind === 'asset' && review.itemId) && selected.has(field.key)).map(field => `${field.label}: ${fields[field.key]}`);
  const revised = importFields(review.kind).filter(field => selected.has(field.key) && Object.hasOwn(edits, field.key) && String(values[field.key]) !== candidate.fields[field.key]).map(field => field.label);
  const body = [`Fonte: ${review.provenance.label}`, ...(review.provenance.url ? [`Referência: ${review.provenance.url}`] : []), ...(review.provenance.externalId ? [`Identificador externo: ${review.provenance.externalId}`] : []), `Conferida em: ${review.provenance.retrievedAt}`, `SHA-256 do conteúdo consultado: ${review.provenance.sha256}`, ...(review.provenance.textSha256 ? [`SHA-256 do texto extraído: ${review.provenance.textSha256}`] : []), ...(review.provenance.extraction ? [`Extração: ${review.provenance.extraction === 'browser-pdf' ? 'PDF no navegador; texto revisado pela pessoa, sem comparação automática com as páginas no servidor' : review.provenance.extraction === 'server-docx' ? 'Corpo principal word/document.xml, sem paginação fixa' : 'Arquivo textual UTF-8'}`] : []), ...(review.provenance.pages ? [`Páginas usadas na extração do navegador: ${review.provenance.pages.join(', ')}`] : []), `Campos selecionados: ${importFields(review.kind).filter(field => selected.has(field.key)).map(field => field.label).join(', ')}`, ...(revised.length ? [`Campos ajustados manualmente na prévia: ${revised.join(', ')}`] : []), ...metadata,
    ...(review.kind === 'asset' ? [review.itemId ? 'A conferência foi vinculada ao bem existente; seus metadados e estoque não foram alterados.' : 'Bem individual cadastrado com saldo zero. A entrada física deve ser conferida e registrada em Materiais.'] : [])].join('\n');
  const receipt = await createRecord(db, actor, { projectId, kind: review.kind === 'asset' ? 'material' : 'project', ...(itemId ? { itemId } : {}), title: 'Fonte e conferência do cadastro importado', body, occurredAt: review.provenance.retrievedAt, operationKey: `${operationKey}-receipt` });
  return { ok: true, projectId, itemId, recordId: receipt.id, stockChanged: false, source: review.provenance.label };
}
