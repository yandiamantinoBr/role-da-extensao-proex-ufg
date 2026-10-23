'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';
import { Check, KeyRound, LoaderCircle, ShieldCheck, Trash2 } from 'lucide-react';

type IdentifierSettings = { username: string | null; cpfConfigured: boolean; cpfHint: string | null; suggestedUsername: string | null; privacyNotice: string };
type Kind = 'username' | 'cpf';

async function jsonResponse(response: Response): Promise<Record<string, unknown>> {
 const body = await response.json().catch(() => ({})) as Record<string, unknown>;
 if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error.slice(0, 500) : 'Não foi possível concluir. Atualize a página e tente novamente.');
 return body;
}
async function readIdentifiers(signal?: AbortSignal): Promise<IdentifierSettings> {
 const body = await jsonResponse(await fetch('/api/account?action=identifiers', { credentials: 'same-origin', cache: 'no-store', signal }));
 if (typeof body.cpfConfigured !== 'boolean' || typeof body.privacyNotice !== 'string') throw new Error('Atualize a página para recuperar as formas de entrada.');
 return { username: typeof body.username === 'string' ? body.username : null, cpfConfigured: body.cpfConfigured, cpfHint: typeof body.cpfHint === 'string' ? body.cpfHint : null, suggestedUsername: typeof body.suggestedUsername === 'string' ? body.suggestedUsername : null, privacyNotice: body.privacyNotice };
}
async function accountMutation(body: Record<string, unknown>) {
 return jsonResponse(await fetch('/api/account', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify(body) }));
}

function IdentifierForm({ kind, settings, disabled, onUpdated }: { kind: Kind; settings: IdentifierSettings; disabled: boolean; onUpdated(): Promise<void> }) {
 const prefix = useId(), isCpf = kind === 'cpf', configured = isCpf ? settings.cpfConfigured : !!settings.username;
 const [value, setValue] = useState(isCpf ? '' : settings.username || '');
 const [password, setPassword] = useState(''), [acknowledged, setAcknowledged] = useState(false);
 const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
 useEffect(() => { if (!isCpf) setValue(settings.username || ''); }, [isCpf, settings.username]);
 async function save(remove = false) {
  if (busy || disabled) return;
  setError(''); setMessage('');
  if (!password) { setError('Confirme sua senha atual para continuar.'); return; }
  if (!remove && !acknowledged) { setError('Leia o aviso e marque a opção para continuar.'); return; }
  if (!remove && !value.trim()) { setError(isCpf ? 'Informe o CPF que deseja usar como atalho.' : 'Escolha seu nome de usuário.'); return; }
  setBusy(true);
  try {
   await accountMutation({ action: remove ? 'identifiers.remove' : 'identifiers.update', kind, ...(remove ? {} : { value, acknowledged: true }), currentPassword: password });
   await onUpdated(); setAcknowledged(false);
   setMessage(remove ? 'Atalho removido. Você pode continuar entrando com seu e-mail e senha.' : 'Forma de entrada atualizada. Use a mesma senha da sua conta.');
  } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar esta forma de entrada.'); }
  finally { setPassword(''); if (isCpf) setValue(''); setBusy(false); }
 }
 function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void save(); }
 return <section aria-labelledby={`${prefix}-title`} style={{ paddingTop: 24, marginTop: 24, borderTop: '1px solid var(--line)' }}>
  <h3 id={`${prefix}-title`} style={{ margin: '0 0 10px' }}>{isCpf ? 'CPF como atalho (opcional)' : 'Nome de usuário (opcional)'}</h3>
  <p className="p-form-help">{isCpf ? 'Você pode continuar usando somente e-mail e senha. Cadastrar o CPF é uma escolha sua e não substitui a senha.' : 'Escolha um nome curto para entrar com a mesma senha. Este nome vale apenas neste portal.'}</p>
  {isCpf && configured && <p className="p-form-help"><ShieldCheck size={16} aria-hidden="true" /> {settings.cpfHint || 'CPF cadastrado (oculto)'}</p>}
  <form className="p-form" onSubmit={submit}>
   <fieldset disabled={disabled || busy}>
    <div className="p-form-grid">
     <label className="p-field"><span>{isCpf ? configured ? 'Substituir o CPF cadastrado' : 'CPF' : 'Nome de usuário'}</span><input type="text" autoComplete="off" inputMode={isCpf ? 'numeric' : 'text'} autoCapitalize="none" spellCheck={false} maxLength={isCpf ? 14 : 60} minLength={isCpf ? undefined : 3} pattern={isCpf ? undefined : '[A-Za-z0-9][A-Za-z0-9._-]{2,59}'} value={value} onChange={event => { setValue(event.target.value); setMessage(''); }} placeholder={isCpf ? '000.000.000-00' : settings.suggestedUsername || 'seu.nome'} aria-describedby={`${prefix}-help`} /><small id={`${prefix}-help`}>{isCpf ? 'O número não será mostrado novamente. O campo é limpo após o envio.' : 'De 3 a 60 caracteres: letras sem acento, números, ponto, hífen ou sublinhado. A sugestão não é reservada.'}</small></label>
     <label className="p-field"><span>Confirme sua senha atual</span><input type="password" autoComplete="current-password" maxLength={128} value={password} onChange={event => { setPassword(event.target.value); setMessage(''); }} /></label>
    </div>
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, margin: '18px 0', fontSize: 14 }}><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} style={{ marginTop: 3, flexShrink: 0 }} /><span>Li o aviso e quero cadastrar {isCpf ? 'o CPF' : 'este nome de usuário'} como forma opcional de localizar minha conta.</span></label>
    <div className="p-form-footer" style={{ gap: 10, flexWrap: 'wrap' }}><button className="p-button p-button-primary" type="submit">{busy ? <LoaderCircle size={16} className="p-spin" /> : <Check size={16} />}{busy ? 'Salvando…' : isCpf ? 'Salvar CPF opcional' : 'Salvar nome de usuário'}</button>{configured && <button className="p-button p-button-subtle" type="button" onClick={() => void save(true)}><Trash2 size={16} />Remover atalho</button>}</div>
   </fieldset>
   {error && <p className="p-inline-error" role="alert">{error}</p>}{message && <p role="status" style={{ color: 'var(--success-ink)' }}>{message}</p>}
  </form>
 </section>;
}

export default function AccountIdentityPanel({ hasPassword }: { hasPassword: boolean }) {
 const prefix = useId(), [settings, setSettings] = useState<IdentifierSettings | null>(null);
 const [notice, setNotice] = useState(''), [loading, setLoading] = useState(true), [error, setError] = useState('');
 const [privacyPassword, setPrivacyPassword] = useState(''), [privacyAcknowledged, setPrivacyAcknowledged] = useState(false), [privacyBusy, setPrivacyBusy] = useState(false), [privacyError, setPrivacyError] = useState(''), [privacyMessage, setPrivacyMessage] = useState('');
 async function refresh() { const latest = await readIdentifiers(); setSettings(latest); }
 useEffect(() => {
  const controller = new AbortController();
  void readIdentifiers(controller.signal).then(value => { if (!controller.signal.aborted) setSettings(value); }, cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível recuperar as formas de entrada.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
  void fetch('/api/account?action=privacy', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal }).then(jsonResponse).then(body => { if (!controller.signal.aborted && typeof body.notice === 'string') setNotice(body.notice); }).catch(() => { /* Identity settings remain usable if the privacy notice cannot load. */ });
  return () => controller.abort();
 }, []);
 async function requestPrivacy(event: FormEvent<HTMLFormElement>) {
  event.preventDefault(); if (privacyBusy || !hasPassword) return;
  setPrivacyError(''); setPrivacyMessage('');
  if (!privacyPassword || !privacyAcknowledged) { setPrivacyError('Confirme sua senha e leia o aviso para enviar a solicitação.'); return; }
  setPrivacyBusy(true);
  try { await accountMutation({ action: 'privacy.request', currentPassword: privacyPassword }); setPrivacyMessage('Solicitação registrada para análise da administração. Seu acesso continua ativo até a conclusão do atendimento.'); setPrivacyAcknowledged(false); }
  catch (cause) { setPrivacyError(cause instanceof Error ? cause.message : 'Não foi possível enviar sua solicitação.'); }
  finally { setPrivacyPassword(''); setPrivacyBusy(false); }
 }
 return <section className="p-card" aria-labelledby={`${prefix}-title`} style={{ padding: 'clamp(18px,4vw,30px)', marginTop: 24 }}>
  <h2 id={`${prefix}-title`} style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 10px' }}><KeyRound size={22} aria-hidden="true" />Entrada e privacidade</h2>
  <p className="p-form-help">Seu e-mail e sua senha continuam funcionando. Os atalhos abaixo são opcionais e não alteram suas permissões.</p>
  {!hasPassword && <p className="p-form-help">Configure sua senha de acesso antes de cadastrar atalhos ou enviar uma solicitação. <a href="/acesso-inicial" className="p-text-link">Configurar senha</a></p>}
  {loading && <p role="status"><LoaderCircle size={18} className="p-spin" /> Carregando formas de entrada…</p>}
  {error && <p className="p-inline-error" role="alert">{error}</p>}
  {settings && <><p className="p-form-help" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{settings.privacyNotice}</p><IdentifierForm kind="username" settings={settings} disabled={!hasPassword || privacyBusy} onUpdated={refresh} /><IdentifierForm kind="cpf" settings={settings} disabled={!hasPassword || privacyBusy} onUpdated={refresh} /></>}
  <section aria-labelledby={`${prefix}-privacy`} style={{ paddingTop: 24, marginTop: 24, borderTop: '1px solid var(--line)' }}>
   <h3 id={`${prefix}-privacy`} style={{ margin: '0 0 10px' }}>Solicitar anonimização da conta</h3>
   <p className="p-form-help" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{notice || 'Você pode pedir à administração a remoção dos dados de identificação da sua conta. O atendimento preserva o histórico operacional necessário e os totais dos relatórios.'}</p>
   <form className="p-form" onSubmit={requestPrivacy}><fieldset disabled={!hasPassword || privacyBusy}>
    <label className="p-field" style={{ maxWidth: 420 }}><span>Senha atual</span><input type="password" autoComplete="current-password" required maxLength={128} value={privacyPassword} onChange={event => setPrivacyPassword(event.target.value)} /></label>
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, margin: '18px 0', fontSize: 14 }}><input type="checkbox" required checked={privacyAcknowledged} onChange={event => setPrivacyAcknowledged(event.target.checked)} style={{ marginTop: 3, flexShrink: 0 }} /><span>Li o aviso e quero solicitar o atendimento da administração. Entendo que a conclusão encerra meu acesso à conta.</span></label>
    <button type="submit" className="p-button p-button-subtle">{privacyBusy ? <LoaderCircle size={16} className="p-spin" /> : <ShieldCheck size={16} />}{privacyBusy ? 'Enviando…' : 'Enviar solicitação'}</button>
   </fieldset>{privacyError && <p role="alert" className="p-inline-error">{privacyError}</p>}{privacyMessage && <p role="status" style={{ color: 'var(--success-ink)' }}>{privacyMessage}</p>}</form>
  </section>
 </section>;
}
