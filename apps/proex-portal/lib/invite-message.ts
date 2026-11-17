/**
 * Mensagem pronta do convite (17/11): vai pelo WhatsApp (wa.me, sem API nem conta da Meta), pelo e-mail de quem convida
 * (mailto) ou copiada. O link já vem no formato com o código depois do "#", que não chega ao servidor nem aos logs.
 * Puro, sem rede: só monta textos e endereços.
 */
export type InviteMessageInput = { name?: string | null; roleLabel?: string | null; scopeLabel?: string | null; url: string; expiresAt?: string | null };

const expiryFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo', hourCycle: 'h23' });
const clean = (value: string | null | undefined) => String(value ?? '').replace(/\s+/g, ' ').trim();

export const INVITE_EMAIL_SUBJECT = 'Convite para o Portal PROEX UFG';

export function inviteMessage({ name, roleLabel, scopeLabel, url, expiresAt }: InviteMessageInput): string {
  const first = clean(name), scope = clean(scopeLabel), rawRole = clean(roleLabel);
  const role = rawRole ? rawRole.charAt(0).toLocaleLowerCase('pt-BR') + rawRole.slice(1) : '';
  const expiry = expiresAt && Number.isFinite(Date.parse(expiresAt)) ? expiryFormat.format(Date.parse(expiresAt)) : '';
  const what = role && scope ? ` como ${role}, em ${scope}` : role ? ` como ${role}` : scope ? ` em ${scope}` : '';
  return [
    `Olá${first ? `, ${first}` : ''}! Você recebeu um convite para o Portal PROEX UFG${what}.`,
    `Para ativar seu acesso, abra o link${expiry ? ` (vale até ${expiry}, horário de Brasília)` : ''}:`,
    url,
    'O link é pessoal: não o repasse a outras pessoas.',
  ].join('\n');
}

/** Link do WhatsApp sem número: a pessoa escolhe o contato no próprio aplicativo. */
export function whatsappShareHref(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

/** Abre o e-mail de quem convida, com destinatário, assunto e texto prontos. */
export function emailShareHref(email: string | null | undefined, message: string): string {
  const to = clean(email);
  const recipient = /^[^\s@<>?&]+@[^\s@<>?&]+\.[^\s@<>?&]+$/.test(to) ? encodeURIComponent(to).replace(/%40/g, '@') : '';
  return `mailto:${recipient}?subject=${encodeURIComponent(INVITE_EMAIL_SUBJECT)}&body=${encodeURIComponent(message)}`;
}
