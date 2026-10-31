export type LoginMode = 'login' | 'initial' | 'invite' | 'reset' | 'setup';

/** Only known authentication outcomes become public text; never echo provider details. */
export function loginErrorMessage(value: unknown, status: number, mode: LoginMode = 'login'): string {
  const body = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const code = typeof body.code === 'string' ? body.code : '';
  const message = typeof body.error === 'string' ? body.error : typeof body.message === 'string' ? body.message : '';
  if (status === 429 || code === 'rate_limited' || code === 'TOO_MANY_REQUESTS') return 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.';
  if (status >= 500) return 'O acesso está temporariamente indisponível. Tente novamente em instantes.';
  if (status === 401 || ['INVALID_EMAIL_OR_PASSWORD', 'INVALID_PASSWORD', 'USER_NOT_FOUND'].includes(code) || ['Invalid email or password', 'Invalid password'].includes(message)) return 'Identificador ou senha inválidos. Confira os dados e tente novamente.';
  if (code === 'invalid_password' || ['PASSWORD_TOO_SHORT', 'PASSWORD_TOO_LONG'].includes(code)) return 'Use uma senha de 12 a 128 caracteres.';
  if (status === 410 || ['INVALID_TOKEN', 'TOKEN_EXPIRED'].includes(code) || message === 'Convite inválido.') return mode === 'invite' ? 'O convite é inválido, expirou ou foi revogado. Peça outro link.' : 'O link é inválido ou expirou. Peça outro link antes de continuar.';
  if (code === 'invalid_origin') return 'Atualize a página e tente novamente.';
  if (code === 'setup_completed') return 'A configuração inicial já foi concluída. Entre com e-mail e senha.';
  if (code === 'setup_unavailable') return 'A configuração inicial não está disponível neste ambiente.';
  if (code === 'setup_forbidden') return 'Confira o código e o e-mail de configuração ou procure o responsável.';
  if (status === 403 || code === 'EMAIL_NOT_VERIFIED' || code === 'account_blocked') return 'Não foi possível validar seu acesso. Procure a equipe responsável.';
  return mode === 'login' ? 'Não foi possível entrar. Confira os dados e tente novamente.' : 'Não foi possível validar a conta. Confira os dados e o link recebido.';
}
