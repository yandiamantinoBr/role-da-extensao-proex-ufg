'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Check, KeyRound, LoaderCircle, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import styles from './profile-panel.module.css';

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
  const [cpfValue, setCpfValue] = useState('');
  const [usernameDraft, setUsernameDraft] = useState<{ base: string | null; value: string } | null>(null);
  const value = isCpf ? cpfValue : usernameDraft?.base === settings.username ? usernameDraft.value : settings.username || '';
  const [password, setPassword] = useState(''), [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const pending = useRef(false);
  function changeValue(next: string) {
    if (isCpf) setCpfValue(next); else setUsernameDraft({ base: settings.username, value: next });
    setMessage('');
  }
  async function save(remove = false) {
    if (pending.current || disabled) return;
    setError(''); setMessage('');
    if (!password || password.length > 128) { setError('Confirme sua senha atual para continuar.'); return; }
    if (!remove && !acknowledged) { setError('Leia o aviso e marque a opção para continuar.'); return; }
    if (!remove && !value.trim()) { setError(isCpf ? 'Informe o CPF que deseja usar como atalho.' : 'Escolha seu nome de usuário.'); return; }
    pending.current = true; setBusy(true);
    try {
      await accountMutation({ action: remove ? 'identifiers.remove' : 'identifiers.update', kind, ...(remove ? {} : { value, acknowledged: true }), currentPassword: password });
      await onUpdated(); setUsernameDraft(null); setAcknowledged(false);
      setMessage(remove ? 'Atalho removido. Você pode continuar entrando com seu e-mail e senha.' : 'Forma de entrada atualizada. Use a mesma senha da sua conta.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar esta forma de entrada.'); }
    finally { setPassword(''); if (isCpf) setCpfValue(''); pending.current = false; setBusy(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void save(); }
  return <details className={styles.disclosure}>
    <summary><span className={styles.summaryTitle}>{isCpf ? <ShieldCheck size={19} aria-hidden="true" /> : <KeyRound size={19} aria-hidden="true" />}{isCpf ? 'CPF como atalho' : 'Nome de usuário'}<span className={styles.tag}>{configured ? 'Cadastrado' : 'Opcional'}</span></span></summary>
    <div className={styles.disclosureBody}>
      <p className={styles.help}>{isCpf ? 'Você pode usar somente e-mail e senha. Cadastrar o CPF é uma escolha sua e não substitui a senha.' : 'Escolha um nome curto para entrar com a mesma senha. Este nome vale apenas neste portal.'}</p>
      {configured && <p className={styles.notice}>{isCpf ? settings.cpfHint || 'CPF cadastrado (oculto)' : `Nome atual: ${settings.username}`}</p>}
      <form className={styles.form} onSubmit={submit}>
        <fieldset disabled={disabled || busy}>
          <div className={styles.grid}>
            <label className={styles.field}><span>{isCpf ? configured ? 'Novo CPF para substituir o atual' : 'CPF' : 'Nome de usuário'}</span><input type="text" autoComplete="off" inputMode={isCpf ? 'numeric' : 'text'} autoCapitalize="none" spellCheck={false} maxLength={isCpf ? 14 : 60} minLength={isCpf ? undefined : 3} pattern={isCpf ? undefined : '[A-Za-z0-9][A-Za-z0-9._-]{2,59}'} value={value} onChange={event => changeValue(event.target.value)} placeholder={isCpf ? '000.000.000-00' : settings.suggestedUsername || 'seu.nome'} aria-describedby={`${prefix}-help`} /><small id={`${prefix}-help`}>{isCpf ? 'O número não será mostrado novamente. Este campo é limpo após qualquer envio.' : 'De 3 a 60 caracteres: letras sem acento, números, ponto, hífen ou sublinhado. A sugestão não é reservada.'}</small></label>
            <label className={styles.field}><span>Confirme sua senha atual</span><input type="password" autoComplete="current-password" maxLength={128} value={password} onChange={event => { setPassword(event.target.value); setMessage(''); }} /></label>
          </div>
          <label className={styles.choice}><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} aria-describedby={`${prefix}-consent`} /><span id={`${prefix}-consent`}>Li o aviso de privacidade e quero cadastrar {isCpf ? 'o CPF' : 'este nome de usuário'} como forma opcional de localizar minha conta.</span></label>
          <div className={styles.actions}><button className="p-button p-button-primary" type="submit">{busy ? <LoaderCircle size={16} className="p-spin" aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}{busy ? 'Salvando…' : isCpf ? 'Salvar CPF opcional' : 'Salvar nome de usuário'}</button>{configured && <button className="p-button p-button-subtle" type="button" onClick={() => void save(true)}><Trash2 size={16} aria-hidden="true" />Remover atalho</button>}</div>
        </fieldset>
        {error && <p className={styles.error} role="alert">{error}</p>}{message && <p className={styles.success} role="status">{message}</p>}
      </form>
    </div>
  </details>;
}

export default function AccountIdentityPanel({ hasPassword }: { hasPassword: boolean }) {
  const prefix = useId(), [settings, setSettings] = useState<IdentifierSettings | null>(null);
  const [notice, setNotice] = useState(''), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [privacyPassword, setPrivacyPassword] = useState(''), [privacyAcknowledged, setPrivacyAcknowledged] = useState(false), [privacyBusy, setPrivacyBusy] = useState(false), [privacyError, setPrivacyError] = useState(''), [privacyMessage, setPrivacyMessage] = useState('');
  const privacyPending = useRef(false);
  async function refresh() { const latest = await readIdentifiers(); setSettings(latest); }
  async function retry() {
    setLoading(true); setError('');
    try { await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível recuperar as formas de entrada.'); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    void readIdentifiers(controller.signal).then(value => { if (!controller.signal.aborted) setSettings(value); }, cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível recuperar as formas de entrada.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    void fetch('/api/account?action=privacy', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal }).then(jsonResponse).then(body => { if (!controller.signal.aborted && typeof body.notice === 'string') setNotice(body.notice); }).catch(() => { /* The fallback notice still explains the request. */ });
    return () => controller.abort();
  }, []);
  async function requestPrivacy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (privacyPending.current || !hasPassword) return;
    setPrivacyError(''); setPrivacyMessage('');
    if (!privacyPassword || !privacyAcknowledged) { setPrivacyError('Confirme sua senha e leia o aviso para enviar a solicitação.'); return; }
    privacyPending.current = true; setPrivacyBusy(true);
    try { await accountMutation({ action: 'privacy.request', currentPassword: privacyPassword }); setPrivacyMessage('Solicitação registrada para análise da administração. Seu acesso continua ativo até a conclusão do atendimento.'); setPrivacyAcknowledged(false); }
    catch (cause) { setPrivacyError(cause instanceof Error ? cause.message : 'Não foi possível enviar sua solicitação.'); }
    finally { setPrivacyPassword(''); privacyPending.current = false; setPrivacyBusy(false); }
  }
  return <section className={`${styles.card} ${styles.identityRoot}`} aria-labelledby={`${prefix}-title`}>
    <div className={styles.sectionHeading}><KeyRound size={23} aria-hidden="true" /><div><h3 id={`${prefix}-title`}>Entrada e privacidade</h3><p>Os atalhos abaixo são opcionais. Seu e-mail e sua senha continuam funcionando.</p></div></div>
    {!hasPassword && <p className={styles.notice}>Configure sua senha antes de cadastrar atalhos ou enviar uma solicitação. <a href="/acesso-inicial" className="p-text-link">Configurar senha</a></p>}
    {loading && <p role="status" className={styles.busy}><LoaderCircle size={18} className="p-spin" aria-hidden="true" />Carregando formas de entrada…</p>}
    {error && <div className={styles.notice}><p className={styles.error} role="alert">{error}</p><button type="button" className={`p-text-link ${styles.retry}`} onClick={() => void retry()}><RefreshCw size={15} aria-hidden="true" />Tentar novamente</button></div>}
    {settings && <>
      <p className={styles.privacyText}>{settings.privacyNotice}</p>
      <div><IdentifierForm kind="username" settings={settings} disabled={!hasPassword || privacyBusy} onUpdated={refresh} /><IdentifierForm kind="cpf" settings={settings} disabled={!hasPassword || privacyBusy} onUpdated={refresh} /></div>
    </>}
    <details className={styles.disclosure}>
      <summary><span className={styles.summaryTitle}><ShieldCheck size={19} aria-hidden="true" />Solicitar anonimização da conta</span></summary>
      <div className={styles.disclosureBody}>
        <p className={styles.privacyText}>{notice || 'Você pode pedir à administração a remoção dos dados de identificação da sua conta. O atendimento preserva o histórico operacional necessário e os totais dos relatórios.'}</p>
        <form className={styles.form} onSubmit={requestPrivacy}>
          <fieldset disabled={!hasPassword || privacyBusy}>
            <div className={styles.grid}><label className={styles.field}><span>Senha atual</span><input type="password" autoComplete="current-password" required maxLength={128} value={privacyPassword} onChange={event => setPrivacyPassword(event.target.value)} /></label></div>
            <label className={styles.choice}><input type="checkbox" required checked={privacyAcknowledged} onChange={event => setPrivacyAcknowledged(event.target.checked)} /><span>Li o aviso e quero solicitar o atendimento da administração. Entendo que a conclusão encerra meu acesso à conta.</span></label>
            <div className={styles.actions}><button type="submit" className="p-button p-button-subtle">{privacyBusy ? <LoaderCircle size={16} className="p-spin" aria-hidden="true" /> : <ShieldCheck size={16} aria-hidden="true" />}{privacyBusy ? 'Enviando…' : 'Enviar solicitação'}</button></div>
          </fieldset>
          {privacyError && <p role="alert" className={styles.error}>{privacyError}</p>}{privacyMessage && <p role="status" className={styles.success}>{privacyMessage}</p>}
        </form>
      </div>
    </details>
  </section>;
}
