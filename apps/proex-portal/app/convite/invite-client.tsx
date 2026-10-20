'use client';
import { useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, KeyRound, LoaderCircle, ShieldCheck } from 'lucide-react';

export default function InviteClient({ token, signedIn, signInHref }: { token: string; signedIn: boolean; signInHref: string }) {
  const [busy, setBusy] = useState(false), [accepted, setAccepted] = useState(false), [error, setError] = useState('');
  const lock = useRef(false);
  async function accept() {
    if (!signedIn || !token || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const response = await fetch('/api/portal', { method: 'POST', credentials: 'same-origin', referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify({ action: 'invite.accept', token }) });
      const payload = await response.json().catch(() => null) as { error?: unknown; message?: unknown; code?: unknown } | null;
      if (!response.ok) {
        const code = typeof payload?.code === 'string' ? payload.code : ''; 
        const messages: Record<string, string> = { email_mismatch: 'Este convite foi enviado a outro e-mail. Entre com a conta correspondente ou peça à equipe um novo convite.', expired: 'Este convite expirou. Peça um novo convite ao responsável.', revoked: 'Este convite foi cancelado. Consulte o responsável da equipe.', already_accepted: 'Este convite já foi utilizado. Se você já o aceitou, entre no painel para consultar seu acesso.', unauthenticated: 'Entre na sua conta antes de aceitar o convite.', not_found: 'Não foi possível localizar este convite. Confira o link com o responsável.' };
        throw new Error(messages[code] ?? (typeof payload?.error === 'string' && payload.error.length < 400 ? payload.error : typeof payload?.message === 'string' && payload.message.length < 400 ? payload.message : 'Não foi possível aceitar o convite. Confira a conta usada ou procure o responsável.'));
      }
      setAccepted(true);
      // Hide the one-use credential after the server confirms acceptance.
      window.history.replaceState(null, '', '/convite');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'A conexão foi interrompida. Você pode tentar novamente ou consultar o painel.'); }
    finally { setBusy(false); lock.current = false; }
  }
  return <main className="proex-event pe-invitation"><header className="pe-top"><a className="pe-brand" href="https://proex.ufg.br/" target="_blank" rel="noreferrer"><img src="/brand/proex.png" alt="PROEX"/><span/><img src="/brand/ufg-white.png" alt="Universidade Federal de Goiás"/></a><span className="pe-invite-badge"><ShieldCheck size={16}/> Acesso da equipe</span></header><section className="pe-invite-card"><div className={`pe-invite-icon ${accepted ? 'pe-invite-success' : ''}`}>{accepted ? <CheckCircle2 size={32}/> : <KeyRound size={30}/>}</div><span className="pe-eyebrow">GESTÃO PROEX</span><h1>{accepted ? 'Boas-vindas à equipe!' : token ? 'Seu próximo rolê começa aqui.' : 'Confira o link do convite'}</h1><p>{accepted ? 'Seu acesso foi registrado. O painel mostrará os projetos e as ações que você pode administrar.' : token ? 'Você recebeu um convite para colaborar com a PROEX. Entre com a conta vinculada ao e-mail que recebeu o convite.' : 'Este endereço não contém um convite válido. Peça o link completo ao responsável da equipe.'}</p>{accepted ? <a className="pe-play" href="/">Abrir meu painel <ArrowRight size={20}/></a> : token ? signedIn ? <><div className="pe-invite-notice"><ShieldCheck size={20}/><span>O acesso será validado no momento do aceite. Ele se limita às permissões definidas pelo responsável.</span></div><button className="pe-play" disabled={busy} onClick={() => void accept()}>{busy ? <><LoaderCircle className="pe-loader" size={20}/> Validando convite…</> : <>Aceitar convite <ArrowRight size={20}/></>}</button></> : <><a className="pe-play" href={signInHref} target="_top" referrerPolicy="no-referrer">Entrar para aceitar <ArrowRight size={20}/></a><p className="pe-invite-small">A entrada desta versão usa a conta ChatGPT. Aceitar o convite não concede acesso ao código ou a outros projetos.</p></> : <a className="pe-secondary" href="/">Ir para o início <ArrowRight size={16}/></a>}{error && <p className="pe-error" role="alert">{error}</p>}<a className="pe-back-link" href="/">Voltar ao início</a></section><footer className="pe-footer"><span>Pró-Reitoria de Extensão · Universidade Federal de Goiás</span></footer></main>;
}
