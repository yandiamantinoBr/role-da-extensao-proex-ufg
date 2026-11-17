/**
 * Confirmação do rascunho de demanda do Rolê. A criação é a mesma da tela de Demandas
 * (followupAction 'task.create'), com permissão conferida de novo e chave de operação idempotente.
 * A assinatura do rascunho só confere pessoa, projeto e validade; campos editados pela pessoa valem.
 * A auditoria de task.create registra source:'role_draft'.
 */
import type { PortalActor } from '../access';
import { HttpError } from '../errors';
import { followupAction } from '../follow-up/service';
import { verifyTaskDraft } from './crypto';

export async function confirmRoleTaskDraft(db: D1Database, actor: PortalActor | null, input: Record<string, unknown>, secret: string | undefined, now = Date.now()) {
  if (!actor) throw new HttpError(401, 'Entre para acompanhar as demandas.', 'unauthenticated');
  if (!secret) throw new HttpError(503, 'O portal precisa da configuração de segurança para confirmar rascunhos do Rolê.', 'assistant_unavailable');
  const { roleDraft, ...task } = input;
  if (task.action !== 'task.create') throw new HttpError(400, 'Escolha uma operação válida.', 'followup_action');
  await verifyTaskDraft(secret, roleDraft, actor.userId, typeof task.projectId === 'string' ? task.projectId : '', now);
  return followupAction(db, actor, 'task.create', task, { source: 'role_draft' });
}
