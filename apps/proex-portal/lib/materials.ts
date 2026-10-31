import { memberProjectScopeSql, accessibleProjects, requireCapability, requireLiveCapability, capabilityBatch, projectAuthoritySql, type PortalActor } from './access';
import { HttpError } from './errors';
import { prepareMutation } from './mutations';

type Item = { id: string; project_id: string; name: string; category: string; unit: string; stock: number; reserved: number; condition: string; description: string; low_stock: number; asset_code: string; version: number; updated_at: string; category_id: string | null };
type Loan = { id: string; project_id: string; item_id: string; status: string; note: string; starts_at: number; ends_at: number; condition_out: string; condition_in: string; checked_out_at: string | null; returned_at: string | null; updated_at: string };
type Movement = { id: string; item_id: string; delta: number; kind: string; note: string; ref_id: string; group_id: string | null };
type MaterialCategory = { id: string; project_id: string; label: string; label_key: string; core_kind: string; description: string; status: string; version: number; created_at: string; updated_at: string };
const CORE_KINDS = ['gift', 'equipment', 'distribution', 'consumption'];
const MAX_QUANTITY = 1_000_000;

function textValue(value: unknown, label: string, maximum = 200, optional = false): string {
  if (value === undefined || value === null) {
    if (optional) return '';
    throw new HttpError(400, `Informe ${label}.`, 'invalid_input');
  }
  if (typeof value !== 'string') throw new HttpError(400, `Informe ${label} como texto.`, 'invalid_input');
  const result = value.trim();
  if ((!optional && !result) || result.length > maximum) {
    throw new HttpError(400, `${label} deve ter ${optional ? 'até' : 'entre 1 e'} ${maximum} caracteres.`, 'invalid_input');
  }
  return result;
}
function integerValue(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > MAX_QUANTITY) {
    throw new HttpError(400, `${label} deve ser um número inteiro entre ${minimum} e ${MAX_QUANTITY}.`, 'invalid_quantity');
  }
  return value;
}
function timestampValue(value: unknown, label: string): number {
  const raw = textValue(value, label, 40);
  // An explicit time zone avoids interpreting an operator's phone time as server time.
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(raw)) {
    throw new HttpError(400, `${label} deve conter data, horário e fuso horário.`, 'invalid_date');
  }
  const time = Date.parse(raw);
  const datePart = raw.slice(0, 10);
  const [year, month, day] = datePart.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (!Number.isFinite(time) || year < 2000 || year > 2200 || month < 1 || month > 12 || day < 1 || day > daysInMonth) {
    throw new HttpError(400, `${label} não é uma data válida.`, 'invalid_date');
  }
  return time;
}
function statement(db: D1Database, sql: string, values: (string | number | null)[] = []): D1PreparedStatement {
  return db.prepare(sql).bind(...values);
}
function auditStatement(db: D1Database, actor: PortalActor, action: string, entityId: string, projectId: string, details: Record<string, unknown>, now: string) {
  return statement(db, 'INSERT INTO audit (id,actor_id,project_id,action,entity_id,details,created_at) VALUES (?,?,?,?,?,?,?)',
    [crypto.randomUUID(), actor.userId, projectId, action, entityId, JSON.stringify(details), now]);
}
async function createBatch(db: D1Database, actor:PortalActor, projectId:string, capability:string, mutation: Awaited<ReturnType<typeof prepareMutation>>, id: string, statements: D1PreparedStatement[], additionalCapabilities: string[]=[]): Promise<string> {
  const assertions=additionalCapabilities.map(cap=>{requireCapability(actor,cap,projectId);const live=projectAuthoritySql(actor,[cap],'?');return db.prepare(`SELECT CASE WHEN ${live.sql} THEN 1 ELSE json_extract('[]','portal_authority_changed') END`).bind(...live.values,projectId);});
  try { await capabilityBatch(db,actor,capability,projectId,[...assertions,mutation.claimStatement(id), ...statements]); return id; }
  catch (error) { if(error instanceof HttpError&&error.status===403)throw error;return mutation.recover(error); }
}
async function offerById(db: D1Database, id: string) {
  const offer = await statement(db, 'SELECT * FROM offers WHERE id=?', [id]).first<Record<string, unknown>>();
  if (!offer) throw new HttpError(404, 'Oferta não encontrada.', 'offer_not_found');
  const components = (await statement(db, 'SELECT item_id AS itemId,quantity FROM offer_components WHERE offer_id=? ORDER BY item_id', [id]).all()).results ?? [];
  return { ...offer, components };
}
async function itemById(db: D1Database, id: unknown): Promise<Item> {
  const itemId = textValue(id, 'o material', 100);
  const item = await statement(db, 'SELECT * FROM items WHERE id=?', [itemId]).first<Item>();
  if (!item) throw new HttpError(404, 'Material não encontrado.', 'item_not_found');
  return item;
}
async function requireProject(db: D1Database, actor: PortalActor, projectId: unknown, capability: Parameters<typeof requireCapability>[1]): Promise<string> {
  const id = textValue(projectId, 'o projeto', 100);
  await requireLiveCapability(db, actor, capability, id);
  const project = await statement(db, 'SELECT id FROM projects WHERE id=?', [id]).first();
  if (!project) throw new HttpError(404, 'Projeto não encontrado.', 'project_not_found');
  return id;
}
function matchingMovement(existing: Movement, item: Item, delta: number, kind: string, note: string, groupId: string | null) {
  if (existing.item_id !== item.id || existing.delta !== delta || existing.kind !== kind || existing.note !== note || (existing.group_id ?? null) !== groupId) {
    throw new HttpError(409, 'Esta operação já foi usada para outra movimentação. Atualize a página e tente novamente.', 'operation_conflict');
  }
}
function translateDatabaseError(error: unknown): never {
  if (error instanceof HttpError) throw error;
  const message = String(error).toLowerCase();
  if (message.includes('loan_checkout_window')) throw new HttpError(409, 'A retirada só pode ser registrada dentro do período reservado.', 'loan_checkout_window');
  if (message.includes('loan_overlap') || message.includes('loan_conflict') || message.includes('loan_unavailable') || message.includes('loan_overdue') || message.includes('equipment_unavailable')) {
    throw new HttpError(409, 'O equipamento já está reservado, emprestado ou com devolução pendente. Confira a agenda.', 'loan_conflict');
  }
  if (message.includes('insufficient_stock') || message.includes('items_quantities_check') || message.includes('stock_underflow') || message.includes('stock_reserved')) {
    throw new HttpError(409, 'O saldo disponível mudou. Atualize o estoque antes de continuar.', 'insufficient_stock');
  }
  if (message.includes('items_equipment_single_check')) {
    throw new HttpError(409, 'Cada equipamento representa um bem individual e pode ter saldo de apenas uma unidade.', 'equipment_unit');
  }
  if (message.includes('material_categories.project_id') || message.includes('material_categories_label_unique')) throw new HttpError(409, 'Já existe uma categoria com esse nome neste projeto.', 'category_exists');
  if (message.includes('material_category_mismatch')) throw new HttpError(409, 'A categoria precisa estar ativa e corresponder ao projeto e ao tipo do material.', 'category_mismatch');
  if (message.includes('group_project_mismatch')) throw new HttpError(409, 'A ação precisa pertencer ao projeto do material.', 'group_mismatch');
  if (message.includes('constraint')) {
    throw new HttpError(409, 'A operação conflita com um registro existente. Atualize a página e confira os dados.', 'data_conflict');
  }
  throw error;
}

function inventoryAuthorization(projectSql: string): string {
  return `EXISTS(SELECT 1 FROM members m WHERE m.user_id=? AND m.revoked_at IS NULL AND m.role IN ('owner','manager','inventory') AND ${memberProjectScopeSql("m",projectSql)}) AND NOT EXISTS(SELECT 1 FROM portal_users u WHERE u.user_id=? AND (u.status!='active' OR u.activation_pending!=0 OR u.anonymized_at IS NOT NULL))`;
}
function conditionalAudit(db: D1Database, actor: PortalActor, action: string, entityId: string, projectId: string, details: Record<string, unknown>, now: string) {
  return statement(db, 'INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) SELECT ?,?,?,?,?,?,? WHERE changes()=1', [crypto.randomUUID(), actor.userId, projectId, action, entityId, JSON.stringify(details), now]);
}
function versionStatement(db: D1Database, actor: PortalActor, entityType: 'item' | 'category', entityId: string, projectId: string, version: number, snapshot: Record<string, unknown>, now: string, conditional = false) {
  return statement(db, `INSERT INTO entity_versions(id,entity_type,entity_id,project_id,version,snapshot_json,actor_id,created_at) SELECT ?,?,?,?,?,?,?,?${conditional ? ' WHERE changes()=1' : ''}`, [crypto.randomUUID(), entityType, entityId, projectId, version, JSON.stringify(snapshot), actor.userId, now]);
}
async function metadataSnapshot(db: D1Database, type: 'item' | 'category', id: string, projectId: string, version: unknown): Promise<Record<string, unknown>> {
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) throw new HttpError(400, 'Escolha uma versão válida do cadastro.', 'invalid_version');
  const row = await statement(db, 'SELECT snapshot_json FROM entity_versions WHERE entity_type=? AND entity_id=? AND project_id=? AND version=?', [type, id, projectId, version]).first<{ snapshot_json: string }>();
  if (!row) throw new HttpError(404, 'Esta versão do cadastro não foi encontrada.', 'version_not_found');
  const parsed: unknown = JSON.parse(row.snapshot_json);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new HttpError(409, 'A versão não contém um cadastro válido.', 'invalid_snapshot');
  const allowed = type === 'item' ? ['name','category','unit','lowStock','description','assetCode','categoryId','condition'] : ['label','description','status','coreKind'];
  return Object.fromEntries(Object.entries(parsed).filter(([key]) => allowed.includes(key)));
}
async function categoryById(db: D1Database, id: string): Promise<MaterialCategory> {
  const category = await statement(db, 'SELECT * FROM material_categories WHERE id=?', [id]).first<MaterialCategory>();
  if (!category) throw new HttpError(404, 'Categoria não encontrada.', 'category_not_found');
  return category;
}
async function assignedCategory(db: D1Database, categoryId: unknown, projectId: string, coreKind: string, previousId?: string | null): Promise<string | null> {
  if (categoryId === null || categoryId === undefined || categoryId === '') return null;
  const category = await categoryById(db, textValue(categoryId, 'a categoria', 100));
  if (category.project_id !== projectId || category.core_kind !== coreKind || (category.status !== 'active' && category.id !== previousId)) throw new HttpError(400, 'Escolha uma categoria ativa deste projeto com o mesmo tipo de controle.', 'category_mismatch');
  return category.id;
}
async function assignedGroup(db: D1Database, groupId: unknown, projectId: string): Promise<string | null> {
  if (!groupId) return null;
  const id = textValue(groupId, 'a ação', 100);
  if (!await statement(db, 'SELECT id FROM activity_groups WHERE id=? AND project_id=?', [id, projectId]).first()) throw new HttpError(400, 'A ação precisa pertencer ao projeto do material.', 'group_mismatch');
  return id;
}

/** Scoped inventory and equipment mutations. Stock and reservations are maintained by database triggers. */
export async function materialsAction(db: D1Database, actor: PortalActor, action: string, input: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  if (!['item.create', 'item.update', 'stock.move', 'offer.create', 'loan.create', 'loan.status', 'material.category.create', 'material.category.update', 'material.category.restore', 'item.restore', 'activity.group.create'].includes(action)) return null;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Envie os dados da operação.', 'invalid_input');
  const now = new Date().toISOString();
  try {
    if (action === 'material.category.create' || action === 'material.category.update' || action === 'material.category.restore') {
      const previous = action !== 'material.category.create' ? await categoryById(db, textValue(input.id, 'a categoria', 100)) : null;
      const projectId = await requireProject(db, actor, previous?.project_id ?? input.projectId, 'inventory.manage');
      if (action === 'material.category.restore' && previous) input = { ...await metadataSnapshot(db, 'category', previous.id, projectId, input.restoreVersion), id: previous.id, expectedVersion: input.expectedVersion, restoreVersion: input.restoreVersion };
      const label = textValue(input.label ?? previous?.label, 'o nome da categoria', 100).normalize('NFKC').replace(/\s+/g, ' ');
      const labelKey = label.toLocaleLowerCase('pt-BR');
      const description = textValue(input.description ?? previous?.description, 'a descrição', 1000, true);
      if (previous) {
        if (typeof input.expectedVersion !== 'number' || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) throw new HttpError(400, 'Atualize a categoria antes de editar.', 'invalid_version');
        if (input.expectedVersion !== previous.version) throw new HttpError(409, 'A categoria mudou em outra sessão. Atualize a página.', 'category_changed');
        if ((input.coreKind !== undefined && input.coreKind !== previous.core_kind) || (input.projectId !== undefined && input.projectId !== previous.project_id)) throw new HttpError(400, 'O comportamento e o projeto da categoria são permanentes. Crie outra categoria para essa finalidade.', 'immutable_category_core');
        const status = textValue(input.status ?? previous.status, 'a situação da categoria', 20);
        if (!['active', 'archived'].includes(status)) throw new HttpError(400, 'Escolha categoria ativa ou arquivada.', 'invalid_status');
        const snapshot = { label, description, status, coreKind: previous.core_kind };
        const result = await capabilityBatch(db,actor,'inventory.manage',projectId,[
          statement(db, `UPDATE material_categories SET label=?,label_key=?,description=?,status=?,version=version+1,updated_at=? WHERE id=? AND version=? AND ${inventoryAuthorization('material_categories.project_id')}`, [label, labelKey, description, status, now, previous.id, input.expectedVersion, actor.userId, actor.userId]),
          versionStatement(db, actor, 'category', previous.id, projectId, previous.version + 1, snapshot, now, true),
          conditionalAudit(db, actor, action, previous.id, projectId, { version: previous.version + 1, status, ...(action === 'material.category.restore' ? { restoredFromVersion: input.restoreVersion } : {}) }, now),
        ]);
        if (result[0].meta.changes !== 1) throw new HttpError(409, 'A categoria ou seu acesso mudou. Atualize a página.', 'category_changed');
        return { category: await categoryById(db, previous.id) };
      }
      const coreKind = textValue(input.coreKind, 'o comportamento da categoria', 30);
      if (!CORE_KINDS.includes(coreKind)) throw new HttpError(400, 'Escolha um tipo de controle válido.', 'invalid_category');
      const mutation = await prepareMutation(db, actor.userId, action, input);
      if (mutation.existingId) return { category: await categoryById(db, mutation.existingId), duplicate: true };
      const id = crypto.randomUUID();
      const createdId = await createBatch(db, actor, projectId, 'inventory.manage', mutation, id, [
        statement(db, `INSERT INTO material_categories(id,project_id,label,label_key,core_kind,description,status,version,created_at,updated_at) VALUES(?,CASE WHEN ${inventoryAuthorization('?')} THEN ? ELSE NULL END,?,?,?,?,'active',1,?,?)`, [id, actor.userId, projectId, actor.userId, projectId, label, labelKey, coreKind, description, now, now]),
        versionStatement(db, actor, 'category', id, projectId, 1, { label, description, status: 'active', coreKind }, now),
        auditStatement(db, actor, action, id, projectId, { label, coreKind }, now),
      ]);
      return { category: await categoryById(db, createdId), ...(createdId !== id ? { duplicate: true } : {}) };
    }
    if (action === 'activity.group.create') {
      const kind = textValue(input.kind, 'o tipo de ação', 20);
      if (!['donation', 'loan', 'mixed'].includes(kind)) throw new HttpError(400, 'Escolha doação, empréstimo ou ação combinada.', 'invalid_group');
      const projectId = await requireProject(db, actor, input.projectId, kind === 'loan' ? 'loans.manage' : 'inventory.manage');
      if (kind === 'mixed') requireCapability(actor, 'loans.manage', projectId);
      const title = textValue(input.title, 'o nome da ação', 160), note = textValue(input.note, 'a observação', 2000, true);
      const occurredAt = new Date(timestampValue(input.occurredAt, 'A data da ação')).toISOString();
      const mutation = await prepareMutation(db, actor.userId, action, input);
      if (mutation.existingId) return { group: await statement(db, 'SELECT id,project_id,title,kind,occurred_at FROM activity_groups WHERE id=?', [mutation.existingId]).first(), duplicate: true };
      const id = crypto.randomUUID();
      const createdId = await createBatch(db, actor, projectId, kind==='loan'?'loans.manage':'inventory.manage', mutation, id, [statement(db, 'INSERT INTO activity_groups(id,project_id,title,occurred_at,kind,note,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)', [id, projectId, title, occurredAt, kind, note, actor.userId, now]), auditStatement(db, actor, action, id, projectId, { kind }, now)],kind==='mixed'?['loans.manage']:[]);
      return { group: await statement(db, 'SELECT id,project_id,title,kind,occurred_at FROM activity_groups WHERE id=?', [createdId]).first() };
    }
    if (action === 'item.create') {
      const projectId = await requireProject(db, actor, input.projectId, 'inventory.manage');
      const mutation = await prepareMutation(db, actor.userId, action, input);
      if (mutation.existingId) return { item: await itemById(db, mutation.existingId), duplicate: true };
      const name = textValue(input.name, 'o nome do material');
      const customCategory = input.categoryId ? await categoryById(db, textValue(input.categoryId, 'a categoria', 100)) : null;
      const category = textValue(input.category ?? customCategory?.core_kind, 'a categoria', 30);
      const categoryId = await assignedCategory(db, customCategory?.id ?? null, projectId, category);
      if (!['gift', 'equipment', 'distribution', 'consumption'].includes(category)) throw new HttpError(400, 'Escolha uma categoria válida.', 'invalid_category');
      const unit = textValue(input.unit, 'a unidade', 40);
      const lowStock = integerValue(input.lowStock ?? 0, 'O alerta de estoque');
      if (category === 'equipment' && lowStock > 1) throw new HttpError(400, 'O alerta de um equipamento individual pode ser zero ou uma unidade.', 'equipment_unit');
      const description = textValue(input.description, 'a descrição', 2000, true);
      const assetCode = textValue(input.assetCode, 'a identificação patrimonial', 100, true);
      const id = crypto.randomUUID();
      const createdId = await createBatch(db, actor, projectId, 'inventory.manage', mutation, id, [
        statement(db, 'INSERT INTO items (id,project_id,name,category,unit,low_stock,description,asset_code,created_at,updated_at,category_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [id, projectId, name, category, unit, lowStock, description, assetCode, now, now, categoryId]),
        versionStatement(db, actor, 'item', id, projectId, 1, { name, category, unit, lowStock, description, assetCode, categoryId, condition: 'active' }, now),
        auditStatement(db, actor, action, id, projectId, { name, category }, now),
      ]);
      return { item: await itemById(db, createdId), ...(createdId !== id ? { duplicate: true } : {}) };
    }


    if (action === 'item.update' || action === 'item.restore') {
      const item = await itemById(db, input.id);
      await requireLiveCapability(db, actor, 'inventory.manage', item.project_id);
      if (action === 'item.restore') input = { ...await metadataSnapshot(db, 'item', item.id, item.project_id, input.restoreVersion), id: item.id, expectedVersion: input.expectedVersion, restoreVersion: input.restoreVersion };
      if (typeof input.expectedVersion !== 'number' || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) throw new HttpError(400, 'Informe a versão do material. Atualize a página.', 'invalid_version');
      if (input.expectedVersion !== item.version) throw new HttpError(409, 'O material foi alterado em outra sessão. Atualize a página.', 'item_changed');
      if (input.category !== undefined && input.category !== item.category) throw new HttpError(400, 'A categoria do material não pode ser alterada. Cadastre outro material para essa finalidade.', 'immutable_category');
      if (input.projectId !== undefined && input.projectId !== item.project_id) throw new HttpError(400, 'O projeto do material não pode ser alterado.', 'immutable_project');
      const categoryId = input.categoryId === undefined ? item.category_id : await assignedCategory(db, input.categoryId || null, item.project_id, item.category, item.category_id);
      const name = textValue(input.name ?? item.name, 'o nome do material');
      const unit = textValue(input.unit ?? item.unit, 'a unidade', 40);
      const description = textValue(input.description ?? item.description, 'a descrição', 2000, true);
      const lowStock = integerValue(input.lowStock ?? item.low_stock, 'O alerta de estoque');
      if (item.category === 'equipment' && lowStock > 1) throw new HttpError(400, 'O alerta de um equipamento individual pode ser zero ou uma unidade.', 'equipment_unit');
      const condition = textValue(input.condition ?? item.condition, 'a condição', 30);
      if (!['active', 'maintenance', 'inactive'].includes(condition)) throw new HttpError(400, 'Escolha uma condição válida.', 'invalid_condition');
      const assetCode = textValue(input.assetCode ?? item.asset_code, 'a identificação patrimonial', 100, true);
      if (condition !== 'active') {
        if (item.reserved > 0) throw new HttpError(409, 'Há unidades prometidas em brindes. Conclua ou cancele as reservas antes de desativar o material.', 'item_reserved');
        const out = await statement(db, "SELECT id FROM loans WHERE item_id=? AND status='out' LIMIT 1", [item.id]).first();
        if (out) throw new HttpError(409, 'Registre a devolução antes de colocar o equipamento em manutenção ou desativá-lo.', 'asset_in_use');
      }
      const results = await capabilityBatch(db,actor,'inventory.manage',item.project_id,[
        statement(db, `UPDATE items SET name=?,unit=?,description=?,low_stock=?,condition=?,asset_code=?,category_id=?,version=version+1,updated_at=?
          WHERE id=? AND version=? AND (?='active' OR (reserved=0 AND NOT EXISTS (SELECT 1 FROM loans WHERE item_id=items.id AND status='out')))
          AND ${inventoryAuthorization('items.project_id')}`,
          [name, unit, description, lowStock, condition, assetCode, categoryId, now, item.id, input.expectedVersion, condition, actor.userId, actor.userId]),
        versionStatement(db, actor, 'item', item.id, item.project_id, item.version + 1, { name, category: item.category, unit, description, lowStock, condition, assetCode, categoryId }, now, true),
        conditionalAudit(db, actor, action, item.id, item.project_id, { previousVersion: item.version, condition, assetCode, ...(action === 'item.restore' ? { restoredFromVersion: input.restoreVersion } : {}) }, now),
      ]);
      if (results[0].meta.changes !== 1) throw new HttpError(409, 'O material, sua disponibilidade ou seu acesso mudou. Atualize a página.', 'item_changed');
      return { item: await itemById(db, item.id) };
    }

    if (action === 'stock.move') {
      const item = await itemById(db, input.itemId);
      const kind = textValue(input.kind, 'o tipo de movimentação', 20);
      if (!['receive', 'distribute', 'consume', 'adjust'].includes(kind)) throw new HttpError(400, 'Escolha uma movimentação válida.', 'invalid_movement');
      await requireLiveCapability(db, actor, 'inventory.manage', item.project_id);
      if (typeof input.delta !== 'number' || !Number.isSafeInteger(input.delta) || input.delta === 0 || Math.abs(input.delta) > MAX_QUANTITY) throw new HttpError(400, 'Informe uma quantidade inteira diferente de zero.', 'invalid_quantity');
      const delta = input.delta as number;
      if ((kind === 'receive' && delta < 0) || (['distribute', 'consume'].includes(kind) && delta > 0)) throw new HttpError(400, 'Entradas devem ser positivas; distribuição e consumo devem ser negativos.', 'invalid_quantity');
      const note = textValue(input.reason ?? input.note, 'o motivo da movimentação', 2000, kind !== 'adjust');
      const groupId = await assignedGroup(db, input.groupId, item.project_id);
      const operationKey = textValue(input.operationKey, 'o identificador da operação', 120);
      if (!/^[a-zA-Z0-9_-]{8,120}$/.test(operationKey)) throw new HttpError(400, 'Identificador da operação inválido. Atualize a página.', 'invalid_operation');
      const refId = `manual:${actor.userId}:${operationKey}`;
      const existing = await statement(db, 'SELECT * FROM stock_movements WHERE ref_id=?', [refId]).first<Movement>();
      if (existing) {
        matchingMovement(existing, item, delta, kind, note, groupId);
        return { movement: existing, item, duplicate: true };
      }
      if (item.category === 'equipment' && ['distribute', 'consume'].includes(kind)) throw new HttpError(400, 'Registre a saída de equipamento na área de empréstimos.', 'equipment_movement');
      if (item.condition !== 'active' && kind !== 'adjust') throw new HttpError(409, 'O material está indisponível para movimentação.', 'item_inactive');
      if (item.stock + delta < item.reserved) throw new HttpError(409, 'A saída supera o saldo disponível. Há unidades reservadas ou saldo insuficiente.', 'insufficient_stock');
      if (item.category === 'equipment' && item.stock + delta > 1) throw new HttpError(400, 'Cadastre cada equipamento como um bem individual, com uma unidade.', 'equipment_unit');
      if (item.category === 'equipment' && delta < 0) {
        const activeLoan = await statement(db, "SELECT id FROM loans WHERE item_id=? AND status IN ('reserved','out') LIMIT 1", [item.id]).first();
        if (activeLoan) throw new HttpError(409, 'Cancele as reservas ou registre a devolução antes de retirar este equipamento do estoque.', 'asset_in_use');
      }
      const id = crypto.randomUUID();
      try {
        await capabilityBatch(db,actor,'inventory.manage',item.project_id,[
          statement(db, 'INSERT INTO stock_movements (id,item_id,delta,kind,note,ref_id,actor_id,created_at,group_id) VALUES (?,?,?,?,?,?,?,?,?)', [id, item.id, delta, kind, note, refId, actor.userId, now, groupId]),
          auditStatement(db, actor, action, id, item.project_id, { itemId: item.id, delta, kind, note }, now),
        ]);
      } catch (error) {
        if(error instanceof HttpError&&error.status===403)throw error;
        // A retried mobile request can race the first request; uniqueness makes it safe.
        const retry = await statement(db, 'SELECT * FROM stock_movements WHERE ref_id=?', [refId]).first<Movement>();
        if (!retry) throw error;
        matchingMovement(retry, item, delta, kind, note, groupId);
        return { movement: retry, item: await itemById(db, item.id), duplicate: true };
      }
      return { movement: { id, item_id: item.id, delta, kind, note, ref_id: refId, group_id: groupId, created_at: now }, item: await itemById(db, item.id) };
    }

    if (action === 'offer.create') {
      const projectId = await requireProject(db, actor, input.projectId, 'inventory.manage');
      const mutation = await prepareMutation(db, actor.userId, action, input);
      if (mutation.existingId) return { offer: await offerById(db, mutation.existingId), duplicate: true };
      const name = textValue(input.name, 'o nome do brinde');
      const kind = textValue(input.kind, 'a classificação', 20);
      if (!['brinde', 'super'].includes(kind)) throw new HttpError(400, 'Escolha brinde ou super brinde.', 'invalid_offer');
      if (!Array.isArray(input.components) || input.components.length < 1 || input.components.length > 20) throw new HttpError(400, 'Inclua de 1 a 20 materiais na composição.', 'invalid_components');
      const seen = new Set<string>();
      const components: { itemId: string; quantity: number }[] = [];
      for (const component of input.components) {
        if (!component || typeof component !== 'object') throw new HttpError(400, 'Composição inválida.', 'invalid_components');
        const item = await itemById(db, component.itemId);
        if (item.project_id !== projectId) throw new HttpError(400, 'Todos os materiais do brinde devem pertencer ao mesmo projeto.', 'project_mismatch');
        if (item.category !== 'gift' || item.condition !== 'active') throw new HttpError(400, 'Use materiais ativos da categoria brinde.', 'invalid_components');
        if (seen.has(item.id)) throw new HttpError(400, 'Um material foi incluído mais de uma vez na composição.', 'duplicate_component');
        seen.add(item.id);
        components.push({ itemId: item.id, quantity: integerValue(component.quantity, 'A quantidade por brinde', 1) });
      }
      const id = crypto.randomUUID();
      const createdId = await createBatch(db, actor, projectId, 'inventory.manage', mutation, id, [
        statement(db, 'INSERT INTO offers (id,project_id,name,kind,active) VALUES (?,?,?,?,1)', [id, projectId, name, kind]),
        ...components.map(component => statement(db, 'INSERT INTO offer_components (offer_id,item_id,quantity) VALUES (?,?,?)', [id, component.itemId, component.quantity])),
        auditStatement(db, actor, action, id, projectId, { name, kind, components }, now),
      ]);
      return { offer: await offerById(db, createdId), ...(createdId !== id ? { duplicate: true } : {}) };
    }

    if (action === 'loan.create') {
      const projectId = await requireProject(db, actor, input.projectId, 'loans.manage');
      const mutation = await prepareMutation(db, actor.userId, action, input);
      if (mutation.existingId) return { loan: await statement(db, 'SELECT * FROM loans WHERE id=?', [mutation.existingId]).first(), duplicate: true };
      const item = await itemById(db, input.itemId);
      if (item.project_id !== projectId) throw new HttpError(400, 'O equipamento deve pertencer ao projeto selecionado.', 'project_mismatch');
      if (item.category !== 'equipment' || item.condition !== 'active' || item.stock !== 1) throw new HttpError(409, 'Selecione um equipamento individual ativo e com entrada de uma unidade registrada no estoque.', 'equipment_unavailable');
      const groupId = await assignedGroup(db, input.groupId, projectId);
      const actionName = textValue(input.actionName, 'o nome da ação');
      const borrowerName = textValue(input.borrowerName, 'o nome de quem recebe');
      const borrowerContact = textValue(input.borrowerContact, 'o contato de quem recebe', 200, true);
      const startsAt = timestampValue(input.startsAt, 'A retirada');
      const endsAt = timestampValue(input.endsAt, 'A devolução');
      if (endsAt <= startsAt) throw new HttpError(400, 'A devolução deve ocorrer depois da retirada.', 'invalid_interval');
      const note = textValue(input.note, 'a observação', 2000, true);
      const conflict = await statement(db, `SELECT id FROM loans WHERE item_id=? AND status IN ('reserved','out') AND ((starts_at<? AND ends_at>?) OR (status='out' AND ends_at<=?)) LIMIT 1`, [item.id, endsAt, startsAt, Date.now()]).first();
      if (conflict) {
        // The winning identical request may have committed while this request checked the agenda.
        const duplicateId = await mutation.recover(new HttpError(409, 'O equipamento já está reservado nesse período ou tem devolução pendente.', 'loan_conflict'));
        return { loan: await statement(db, 'SELECT * FROM loans WHERE id=?', [duplicateId]).first(), duplicate: true };
      }
      const id = crypto.randomUUID();
      const createdId = await createBatch(db, actor, projectId, 'loans.manage', mutation, id, [
        statement(db, 'INSERT INTO loans (id,project_id,item_id,action_name,borrower_name,borrower_contact,starts_at,ends_at,status,note,created_by,created_at,updated_at,group_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [id, projectId, item.id, actionName, borrowerName, borrowerContact, startsAt, endsAt, 'reserved', note, actor.userId, now, now, groupId]),
        auditStatement(db, actor, action, id, projectId, { itemId: item.id, startsAt, endsAt, actionName }, now),
      ]);
      return { loan: await statement(db, 'SELECT * FROM loans WHERE id=?', [createdId]).first(), ...(createdId !== id ? { duplicate: true } : {}) };
    }

    const id = textValue(input.id, 'o empréstimo', 100);
    const loan = await statement(db, 'SELECT * FROM loans WHERE id=?', [id]).first<Loan>();
    if (!loan) throw new HttpError(404, 'Empréstimo não encontrado.', 'loan_not_found');
    await requireLiveCapability(db, actor, 'loans.manage', loan.project_id);
    const status = textValue(input.status, 'a situação', 20);
    if (!['out', 'returned', 'cancelled'].includes(status)) throw new HttpError(400, 'Escolha uma situação válida.', 'invalid_status');
    if (loan.status === status) return { loan, duplicate: true };
    if (!((loan.status === 'reserved' && (status === 'out' || status === 'cancelled')) || (loan.status === 'out' && status === 'returned'))) {
      throw new HttpError(409, 'Esta mudança não é permitida. Cancele uma reserva ou registre retirada e depois devolução.', 'invalid_transition');
    }
    const note = textValue(input.note, 'a observação', 2000, true);
    const conditionOut = status === 'out' ? textValue(input.conditionOut ?? input.note, 'a condição na retirada', 2000, true) : loan.condition_out;
    const conditionIn = status === 'returned' ? textValue(input.conditionIn ?? input.note, 'a condição na devolução', 2000, true) : loan.condition_in;
    if (status === 'out' && (loan.starts_at > Date.now() || loan.ends_at <= Date.now())) throw new HttpError(409, 'A retirada só pode ser registrada dentro do período reservado.', 'loan_checkout_window');
    const checkedOutAt = status === 'out' ? now : loan.checked_out_at;
    const returnedAt = status === 'returned' ? now : loan.returned_at;
    const results = await capabilityBatch(db,actor,'loans.manage',loan.project_id,[
      // The original reservation note is immutable here. Each stage has its own condition and audit entry.
      statement(db, `UPDATE loans SET status=?,condition_out=?,condition_in=?,checked_out_at=?,returned_at=?,updated_at=? WHERE id=? AND status=?
        AND EXISTS (SELECT 1 FROM members m WHERE m.user_id=? AND m.revoked_at IS NULL AND m.role IN ('owner','manager','loans') AND ${memberProjectScopeSql("m","loans.project_id")}) RETURNING id`,
        [status, conditionOut, conditionIn, checkedOutAt, returnedAt, now, id, loan.status, actor.userId]),
      statement(db, 'INSERT INTO audit (id,actor_id,project_id,action,entity_id,details,created_at) SELECT ?,?,?,?,?,?,? WHERE changes()=1', [crypto.randomUUID(), actor.userId, loan.project_id, action, id, JSON.stringify({ previous: loan.status, status, note, ...(status === 'out' ? { conditionOut } : status === 'returned' ? { conditionIn } : {}) }), now]),
    ]);
    if (!results[0].results?.length) {
      const latest = await statement(db, 'SELECT * FROM loans WHERE id=?', [id]).first<Loan>();
      if (latest?.status === status) return { loan: latest, duplicate: true };
      throw new HttpError(409, 'Outra pessoa atualizou este empréstimo. Atualize a página.', 'loan_changed');
    }
    return { loan: await statement(db, 'SELECT * FROM loans WHERE id=?', [id]).first() };
  } catch (error) {
    translateDatabaseError(error);
  }
}

async function inventoryRead(db: D1Database, actor: PortalActor | null, projectId: string): Promise<void> {
  requireCapability(actor, 'inventory.read', projectId);
  const allowed = await statement(db, `SELECT id FROM members m WHERE m.user_id=? AND m.revoked_at IS NULL AND m.role IN ('owner','manager','inventory') AND ${memberProjectScopeSql("m","?")} AND NOT EXISTS(SELECT 1 FROM portal_users u WHERE u.user_id=m.user_id AND (u.status!='active' OR u.activation_pending!=0 OR u.anonymized_at IS NOT NULL)) LIMIT 1`, [actor!.userId, projectId]).first();
  if (!allowed) throw new HttpError(403, 'Seu acesso ao catálogo mudou. Atualize a página.', 'access_changed');
}
export async function listMaterialCategories(db: D1Database, actor: PortalActor | null, projectId?: unknown): Promise<MaterialCategory[]> {
  if (!actor) throw new HttpError(401, 'Entre para acessar o catálogo.', 'unauthenticated');
  const selected = projectId ? textValue(projectId, 'o projeto', 100) : null;
  if (selected) await inventoryRead(db, actor, selected);
  const scope = accessibleProjects(actor, 'inventory.read');
  if (scope !== null && !scope.length) return [];
  const params: (string | number | null)[] = [];
  const where = selected ? 'c.project_id=?' : scope === null ? '1=1' : `c.project_id IN (${scope.map(() => '?').join(',')})`;
  if (selected) params.push(selected); else if (scope) params.push(...scope);
  params.push(actor.userId, actor.userId);
  return (await statement(db, `SELECT c.* FROM material_categories c WHERE ${where} AND EXISTS(SELECT 1 FROM members m WHERE m.user_id=? AND m.revoked_at IS NULL AND m.role IN ('owner','manager','inventory') AND ${memberProjectScopeSql("m","c.project_id")}) AND NOT EXISTS(SELECT 1 FROM portal_users u WHERE u.user_id=? AND (u.status!='active' OR u.activation_pending!=0 OR u.anonymized_at IS NOT NULL)) ORDER BY c.status,c.label,c.id`, params).all<MaterialCategory>()).results ?? [];
}
export async function materialDetail(db: D1Database, actor: PortalActor | null, itemId: unknown, options: { before?: unknown; limit?: unknown } = {}): Promise<Record<string, unknown>> {
  if (!actor) throw new HttpError(401, 'Entre para acessar o material.', 'unauthenticated');
  const item = await itemById(db, itemId);
  await inventoryRead(db, actor, item.project_id);
  const requestedLimit = options.limit === undefined || options.limit === null ? 50 : Number(options.limit);
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) throw new HttpError(400, 'Limite de histórico inválido.', 'invalid_limit');
  const limit = Math.min(requestedLimit, 100);
  let before: string | null = null, beforeId: string | null = null;
  if (options.before) {
    const cursor = textValue(options.before, 'a posição do histórico', 200).split('|');
    before = new Date(timestampValue(cursor[0], 'O início do histórico')).toISOString();
    if (cursor.length > 2 || (cursor[1] && !/^[A-Za-z0-9_-]{1,100}$/.test(cursor[1]))) throw new HttpError(400, 'Posição do histórico inválida.', 'invalid_cursor');
    beforeId = cursor[1] || null;
  }
  const movementRows = (await statement(db, `SELECT m.id,m.delta,m.kind,m.note AS reason,m.created_at,m.group_id,g.title AS group_title,
    COALESCE(NULLIF(p.display_name,''),'Equipe') AS actor_name FROM stock_movements m LEFT JOIN profiles p ON p.user_id=m.actor_id
    LEFT JOIN activity_groups g ON g.id=m.group_id AND g.project_id=? WHERE m.item_id=?${before ? beforeId ? ' AND (m.created_at<? OR (m.created_at=? AND m.id<?))' : ' AND m.created_at<?' : ''} ORDER BY m.created_at DESC,m.id DESC LIMIT ?`, [item.project_id, item.id, ...(before ? beforeId ? [before, before, beforeId] : [before] : []), limit + 1]).all<Record<string, unknown>>()).results ?? [];
  const photos = (await statement(db, `SELECT a.id,a.name,a.mime,a.size,a.caption,a.attachment_role,a.created_at,r.id AS record_id,r.title
    FROM record_attachments a JOIN records r ON r.id=a.record_id AND r.project_id=a.project_id
    WHERE r.item_id=? AND r.project_id=? AND r.loan_id IS NULL AND r.kind IN ('material','maintenance','distribution','consumption') AND a.deleted_at IS NULL
    AND a.mime IN ('image/jpeg','image/png','image/webp') ORDER BY a.display_order,a.created_at DESC,a.id LIMIT 100`, [item.id, item.project_id]).all<Record<string, unknown>>()).results ?? [];
  const activeLoans = (await statement(db, `SELECT id,status,starts_at,ends_at FROM loans WHERE item_id=? AND project_id=? AND status IN ('reserved','out') ORDER BY starts_at LIMIT 100`, [item.id, item.project_id]).all<{ id: string; status: string; starts_at: number; ends_at: number }>()).results ?? [];
  const clock = Date.now(), blocking = activeLoans.find(loan => loan.status === 'out' || (loan.starts_at <= clock && loan.ends_at > clock));
  let canManage = false;
  try { requireCapability(actor, 'inventory.manage', item.project_id); canManage = true; } catch { /* Read-only catalog role. */ }
  const versions = canManage ? (await statement(db, "SELECT id,version,created_at FROM entity_versions WHERE entity_type='item' AND entity_id=? AND project_id=? ORDER BY version DESC LIMIT 30", [item.id, item.project_id]).all()).results ?? [] : [];
  return {
    item, category: item.category_id ? await categoryById(db, item.category_id) : null,
    categories: await listMaterialCategories(db, actor, item.project_id), movements: movementRows.slice(0, limit),
    photos: photos.map(photo => ({ ...photo, url: `/api/records/files/${photo.id}` })),
    availability: { physical: item.stock, prizeReserved: item.reserved, available: item.category === 'equipment' ? (item.condition === 'active' && item.stock === 1 && !blocking ? 1 : 0) : item.stock - item.reserved, equipmentState: item.category === 'equipment' ? blocking?.status ?? item.condition : null, nextReservations: activeLoans.map(loan => ({ id: loan.id, status: loan.status, starts_at: loan.starts_at, ends_at: loan.ends_at })) },
    permissions: { canManage, canUploadPhotos: canManage }, versions,
    historyTruncated: movementRows.length > limit,
    nextCursor: movementRows.length > limit ? `${movementRows[limit - 1].created_at}|${movementRows[limit - 1].id}` : null,
  };
}
