/** Same contract as the portal's own mutate (POST /api/portal); the server checks permission and scope again. */
export async function portalAction(action: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('Você está sem conexão. Reconecte e tente de novo.');
  const response = await fetch('/api/portal', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify({ action, ...payload }) })
    .catch(() => { throw new Error('A conexão caiu. Tente de novo: o mesmo pedido não é registrado duas vezes.'); });
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !body || body.error) {
    const error = body?.error, text = typeof error === 'string' ? error : typeof (error as { message?: unknown } | undefined)?.message === 'string' ? String((error as { message: string }).message) : '';
    throw new Error(text && text.length < 300 && !/SQLITE|D1_|JSON|<html/i.test(text) ? text : 'Não foi possível concluir. Tente de novo.');
  }
  return body;
}

export type InviteEmailState = 'checking' | 'off' | 'ready' | 'sending-request' | 'queued' | 'sent' | 'error';
/** Maps the queue row status to what the screen says. */
export function inviteEmailStateOf(available: boolean, status: string | null): InviteEmailState {
  if (status === 'accepted' || status === 'accepted_attested') return 'sent';
  if (status && status !== 'cancelled' && status !== 'closed_unconfirmed') return 'queued';
  return available ? 'ready' : 'off';
}
export const INVITE_EMAIL_OFF = 'O envio por e-mail ainda não está ligado nesta organização. Use o WhatsApp, a mensagem ou o QR abaixo.';
