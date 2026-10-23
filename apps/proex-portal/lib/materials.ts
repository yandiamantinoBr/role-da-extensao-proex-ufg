import { requireCapability, type PortalActor } from './access';
import { HttpError } from './errors';
import { prepareMutation } from './mutations';

type Item = { id: string; project_id: string; name: string; category: string; unit: string; stock: number; reserved: number; condition: string; description: string; low_stock: number; asset_code: string; version: number; updated_at: string };
type Loan = { id: string; project_id: string; item_id: string; status: string; note: string; starts_at: number; ends_at: number; condition_out: string; condition_in: string; checked_out_at: string | null; returned_at: string | null; updated_at: string };
type Movement = { id: string; item_id: string; delta: number; kind: string; note: string; ref_id: string };
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
async function createBatch(db: D1Database, mutation: Awaited<ReturnType<typeof prepareMutation>>, id: string, statements: D1PreparedStatement[]): Promise<string> {
  try { await db.batch([mutation.claimStatement(id), ...statements]); return id; }
  catch (error) { return mutation.recover(error); }
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
  await requireCapability(actor, capability, id);
  const project = await statement(db, 'SELECT id FROM projects WHERE id=?', [id]).first();
  if (!project) throw new HttpError(404, 'Projeto não encontrado.', 'project_not_found');
  return id;
}
function matchingMovement(existing: Movement, item: Item, delta: number, kind: string, note: string) {
  if (existing.item_id !== item.id || existing.delta !== delta || existing.kind !== kind || existing.note !== note) {
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
  if (message.includes('constraint')) {
    throw new HttpError(409, 'A operação conflita com um registro existente. Atualize a página e confira os dados.', 'data_conflict');
  }
  throw error;
}

/** Scoped inventory and equipment mutations. Stock and reservations are maintained by database triggers. */
export async function materialsAction(db: D1Database, actor: PortalActor, action: string, input: any): Promise<Record<string, unknown> | null> {
  if (!['item.create', 'item.update', 'stock.move', 'offer.create', 'loan.create', 'loan.status'].includes(action)) return null;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Envie os dados da operação.', 'invalid_input');
  const now = new Date().toISOString();
  try {
    if (action === 'item.create') {
      const projectId = await requireProject(db, actor, input.projectId, 'inventory.manage');
      const mutation = await prepareMutation(db, actor.userId, action, input);
      if (mutation.existingId) return { item: await itemById(db, mutation.existingId), duplicate: true };
      const name = textValue(input.name, 'o nome do material');
      const category = textValue(input.category, 'a categoria', 30);
      if (!['gift', 'equipment', 'distribution', 'consumption'].includes(category)) throw new HttpError(400, 'Escolha uma categoria válida.', 'invalid_category');
      const unit = textValue(input.unit, 'a unidade', 40);
      const lowStock = integerValue(input.lowStock ?? 0, 'O alerta de estoque');
      if (category === 'equipment' && lowStock > 1) throw new HttpError(400, 'O alerta de um equipamento individual pode ser zero ou uma unidade.', 'equipment_unit');
      const description = textValue(input.description, 'a descrição', 2000, true);
      const assetCode = textValue(input.assetCode, 'a identificação patrimonial', 100, true);
      const id = crypto.randomUUID();
      const createdId = await createBatch(db, mutation, id, [
        statement(db, 'INSERT INTO items (id,project_id,name,category,unit,low_stock,description,asset_code,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [id, projectId, name, category, unit, lowStock, description, assetCode, now, now]),
        auditStatement(db, actor, action, id, projectId, { name, category }, now),
      ]);
      return { item: await itemById(db, createdId), ...(createdId !== id ? { duplicate: true } : {}) };
    }


    if (action === 'item.update') {
      const item = await itemById(db, input.id);
      await requireCapability(actor, 'inventory.manage', item.project_id);
      if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) throw new HttpError(400, 'Informe a versão do material. Atualize a página.', 'invalid_version');
      if (input.expectedVersion !== item.version) throw new HttpError(409, 'O material foi alterado em outra sessão. Atualize a página.', 'item_changed');
      if (input.category !== undefined && input.category !== item.category) throw new HttpError(400, 'A categoria do material não pode ser alterada. Cadastre outro material para essa finalidade.', 'immutable_category');
      if (input.projectId !== undefined && input.projectId !== item.project_id) throw new HttpError(400, 'O projeto do material não pode ser alterado.', 'immutable_project');
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
      const results = await db.batch([
        statement(db, `UPDATE items SET name=?,unit=?,description=?,low_stock=?,condition=?,asset_code=?,version=version+1,updated_at=?
          WHERE id=? AND version=? AND (?='active' OR (reserved=0 AND NOT EXISTS (SELECT 1 FROM loans WHERE item_id=items.id AND status='out')))
          AND EXISTS (SELECT 1 FROM members m WHERE m.user_id=? AND m.revoked_at IS NULL AND m.role IN ('owner','manager','inventory') AND (m.project_id IS NULL OR m.project_id=items.project_id))`,
          [name, unit, description, lowStock, condition, assetCode, now, item.id, input.expectedVersion, condition, actor.userId]),
        statement(db, 'INSERT INTO audit (id,actor_id,project_id,action,entity_id,details,created_at) SELECT ?,?,?,?,?,?,? WHERE changes()=1',
          [crypto.randomUUID(), actor.userId, item.project_id, action, item.id, JSON.stringify({ previousVersion: item.version, condition, assetCode }), now]),
      ]);
      if (results[0].meta.changes !== 1) throw new HttpError(409, 'O material, sua disponibilidade ou seu acesso mudou. Atualize a página.', 'item_changed');
      return { item: await itemById(db, item.id) };
    }

    if (action === 'stock.move') {
      const item = await itemById(db, input.itemId);
      const kind = textValue(input.kind, 'o tipo de movimentação', 20);
      if (!['receive', 'distribute', 'consume', 'adjust'].includes(kind)) throw new HttpError(400, 'Escolha uma movimentação válida.', 'invalid_movement');
      await requireCapability(actor, 'inventory.manage', item.project_id);
      if (typeof input.delta !== 'number' || !Number.isSafeInteger(input.delta) || input.delta === 0 || Math.abs(input.delta) > MAX_QUANTITY) throw new HttpError(400, 'Informe uma quantidade inteira diferente de zero.', 'invalid_quantity');
      const delta = input.delta as number;
      if ((kind === 'receive' && delta < 0) || (['distribute', 'consume'].includes(kind) && delta > 0)) throw new HttpError(400, 'Entradas devem ser positivas; distribuição e consumo devem ser negativos.', 'invalid_quantity');
      const note = textValue(input.note, 'a observação', 2000, kind !== 'adjust');
      const operationKey = textValue(input.operationKey, 'o identificador da operação', 120);
      if (!/^[a-zA-Z0-9_-]{8,120}$/.test(operationKey)) throw new HttpError(400, 'Identificador da operação inválido. Atualize a página.', 'invalid_operation');
      const refId = `manual:${actor.userId}:${operationKey}`;
      const existing = await statement(db, 'SELECT * FROM stock_movements WHERE ref_id=?', [refId]).first<Movement>();
      if (existing) {
        matchingMovement(existing, item, delta, kind, note);
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
        await db.batch([
          statement(db, 'INSERT INTO stock_movements (id,item_id,delta,kind,note,ref_id,actor_id,created_at) VALUES (?,?,?,?,?,?,?,?)', [id, item.id, delta, kind, note, refId, actor.userId, now]),
          auditStatement(db, actor, action, id, item.project_id, { itemId: item.id, delta, kind, note }, now),
        ]);
      } catch (error) {
        // A retried mobile request can race the first request; uniqueness makes it safe.
        const retry = await statement(db, 'SELECT * FROM stock_movements WHERE ref_id=?', [refId]).first<Movement>();
        if (!retry) throw error;
        matchingMovement(retry, item, delta, kind, note);
        return { movement: retry, item: await itemById(db, item.id), duplicate: true };
      }
      return { movement: { id, item_id: item.id, delta, kind, note, ref_id: refId, created_at: now }, item: await itemById(db, item.id) };
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
      const createdId = await createBatch(db, mutation, id, [
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
      const createdId = await createBatch(db, mutation, id, [
        statement(db, 'INSERT INTO loans (id,project_id,item_id,action_name,borrower_name,borrower_contact,starts_at,ends_at,status,note,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [id, projectId, item.id, actionName, borrowerName, borrowerContact, startsAt, endsAt, 'reserved', note, actor.userId, now, now]),
        auditStatement(db, actor, action, id, projectId, { itemId: item.id, startsAt, endsAt, actionName }, now),
      ]);
      return { loan: await statement(db, 'SELECT * FROM loans WHERE id=?', [createdId]).first(), ...(createdId !== id ? { duplicate: true } : {}) };
    }

    const id = textValue(input.id, 'o empréstimo', 100);
    const loan = await statement(db, 'SELECT * FROM loans WHERE id=?', [id]).first<Loan>();
    if (!loan) throw new HttpError(404, 'Empréstimo não encontrado.', 'loan_not_found');
    await requireCapability(actor, 'loans.manage', loan.project_id);
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
    const results = await db.batch([
      // The original reservation note is immutable here. Each stage has its own condition and audit entry.
      statement(db, `UPDATE loans SET status=?,condition_out=?,condition_in=?,checked_out_at=?,returned_at=?,updated_at=? WHERE id=? AND status=?
        AND EXISTS (SELECT 1 FROM members m WHERE m.user_id=? AND m.revoked_at IS NULL AND m.role IN ('owner','manager','loans') AND (m.project_id IS NULL OR m.project_id=loans.project_id)) RETURNING id`,
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
