'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AudioLines, History, KeyRound, LoaderCircle, ScanText, ShieldCheck } from 'lucide-react';
import { PROVIDERS, credentialProviders, type CredentialProvider } from '@/lib/assistant/contracts';
import AssistantAdministrationPanel from './assistant-administration-panel';
import styles from './credential-vault-panel.module.css';

type Entry = { provider: CredentialProvider; label: string; purpose: string; status: 'active' | 'disabled' | 'removed' | 'missing' | 'unavailable'; mask: string | null; createdAt: string | null; createdBy: string | null; updatedAt: string | null; updatedBy: string | null };
type HistoryEntry = { action: 'save' | 'disable' | 'enable' | 'remove' | 'recover' | 'reencrypted' | 'test'; provider: CredentialProvider | null; mask: string | null; outcome: string | null; at: string; actor: string };
type Vault = {
  history?: HistoryEntry[];
  organizations: { id: string; name: string }[]; organizationId: string | null; revision: number;
  storageReady: boolean; legacyAvailable: boolean; recoverable: boolean; keys: Entry[];
  groqPilot: 'configured' | 'missing' | null;
  reserved: { today: number; month: number; dailyLimit: number };
};
type Decision = { entry: Entry; action: 'save' | 'enable' | 'disable' | 'remove' | 'test' };
const statusLabels = { active: 'Pronta', disabled: 'Desligada', removed: 'Removida', missing: 'Sem chave', unavailable: 'Indisponível' };
const providerLabels = { deepseek: 'DeepSeek', openai: 'OpenAI', typesafe: 'TypeSafe', deepgram: 'Deepgram', groq: 'Groq' };
const models = { deepseek: PROVIDERS.deepseek.model, openai: PROVIDERS.openai.model, typesafe: PROVIDERS.typesafe.model, deepgram: 'Nova-3', groq: 'whisper-large-v3-turbo' };
const submitLabels = { save: 'Salvar chave', enable: 'Religar chave', disable: 'Desligar chave', remove: 'Remover chave', test: 'Testar agora' };
const order: CredentialProvider[] = ['deepseek', 'groq', 'typesafe', 'deepgram', 'openai'];
const recommended: Partial<Record<CredentialProvider, string>> = { deepseek: 'Recomendado para o Rolê', groq: 'Recomendado para voz' };
/** Preços oficiais lidos em 09/11/2026; detalhes e fontes em docs/ROLE-ASSISTENTE.md. */
const prices: Record<CredentialProvider, string> = {
  deepseek: 'Cerca de US$ 0,001 por mensagem do Rolê. Pré-pago, sem cota grátis.',
  groq: 'Voz: US$ 0,04 por hora de áudio. Conversa: cerca de US$ 0,0005 por mensagem.',
  typesafe: 'Cerca de US$ 0,00006 por decisão. Acesso antecipado.',
  deepgram: 'US$ 0,0043 por minuto de áudio. Crédito inicial de US$ 200.',
  openai: 'Alternativa paga, sem cota grátis. Use só se as outras falharem.',
};
const outcomeLabels: Record<string, string> = { authenticated: 'chave aceita', rejected: 'chave recusada', rate_limited: 'limite do provedor', timeout: 'sem resposta a tempo', cancelled: 'cancelado', unavailable: 'provedor indisponível', invalid_response: 'resposta inesperada', pending: 'em andamento' };
const historyLabels: Record<HistoryEntry['action'], string> = { save: 'Chave salva', disable: 'Chave desligada', enable: 'Chave religada', remove: 'Chave removida', recover: 'Cofre recriado', reencrypted: 'Chaves cifradas de novo', test: 'Teste' };
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', maximumFractionDigits: 6 });
const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
const url = '/api/assistant/credentials';

class VaultRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function api(path: string, signal?: AbortSignal, input?: Record<string, unknown>): Promise<Vault> {
  const response = await fetch(path, {
    credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
    ...(input ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify(input) } : {}),
  });
  const data = await response.json() as (Partial<Vault> & { error?: unknown }) | null;
  if (!response.ok) throw new VaultRequestError(response.status, typeof data?.error === 'string' ? data.error : 'Não foi possível acessar o cofre.');
  if (!data || !Array.isArray(data.keys) || !Array.isArray(data.organizations) || !Number.isSafeInteger(data.revision) ||
      typeof data.storageReady !== 'boolean' || !data.reserved ||
      !data.keys.every(entry => entry && credentialProviders.includes(entry.provider) && Object.hasOwn(statusLabels, entry.status))) {
    throw new Error('A resposta do cofre chegou incompleta. Atualize a consulta.');
  }
  return data as Vault;
}

function CredentialVaultPanel({organizationId,onChanged}: {organizationId?:string;onChanged?:()=>void}) {
  const [localSelection, setLocalSelection] = useState('');
  const selection=organizationId??localSelection;
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<{ scope: string; vault: Vault } | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [receipt, setReceipt] = useState('');
  const decisionForm = useRef<HTMLFormElement>(null);
  const decisionTrigger = useRef<HTMLButtonElement>(null);
  const receiptRef = useRef<HTMLParagraphElement>(null);
  const active=useRef(true),mutation=useRef<AbortController|null>(null);
  useEffect(()=>{active.current=true;return()=>{active.current=false;mutation.current?.abort();};},[]);
  const vault = data?.scope === selection ? data.vault : null;
  useEffect(() => {
    const controller = new AbortController();
    api(selection ? url + '?' + new URLSearchParams({ organizationId: selection }) : url, controller.signal)
      .then(result => { if (!controller.signal.aborted) setData({ scope: selection, vault: result }); })
      .catch(error => { if (!controller.signal.aborted) { setData(null);setDecision(null);setFailure(error instanceof Error ? error.message : 'Não foi possível acessar o cofre.'); } });
    return () => controller.abort();
  }, [selection, refresh]);

  useEffect(() => { if (decision) decisionForm.current?.focus(); }, [decision]);
  useEffect(() => { if (receipt) receiptRef.current?.focus(); }, [receipt]);

  function choose(entry: Entry, action: Decision['action'], trigger: HTMLButtonElement) {
    decisionTrigger.current = trigger;
    setFailure('');
    setReceipt('');
    setDecision({entry, action});
  }

  function cancelDecision() {
    setDecision(null);
    setFailure('');
    decisionTrigger.current?.focus();
  }

  function reload() {
    setData(null);
    setDecision(null);
    setFailure('');
    setReceipt('');
    setRefresh(current => current + 1);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!decision || !vault?.organizationId || !vault.storageReady || busy) return;
    const form = event.currentTarget, fields = new FormData(form);
    const { entry, action } = decision;
    if (action === 'test') { await testKey(entry); return; }
    const input = { action, organizationId: vault.organizationId, provider: entry.provider, expectedRevision: vault.revision,
      ...(action === 'save' ? { label: fields.get('label'), secret: fields.get('credentialValue'),
        ...(fields.get('replaceUnavailable') === 'on' ? { replaceUnavailable: true } : {}) } : {}) };
    const secret = form.elements.namedItem('credentialValue');
    if (secret instanceof HTMLInputElement) secret.value = '';
    setBusy(true);
    setFailure('');
    setReceipt('');
    try {
      const controller=new AbortController();mutation.current?.abort();mutation.current=controller;
      const result = await api(url, controller.signal, input);
      if(!active.current||controller.signal.aborted)return;
      if (result.organizationId !== vault.organizationId) throw new Error('A organização mudou. Atualize a consulta.');
      setData({ scope: selection, vault: result });
      setDecision(null);
      setReceipt(action === 'save' ? 'Credencial salva.' : action === 'remove' ? 'Credencial removida.' : action === 'enable' ? 'Chave religada. Ligue as funções em “Funções e acesso”.' : 'Credencial desligada.');
      onChanged?.();
    } catch (error) {
      if(!active.current||mutation.current?.signal.aborted)return;
      if (error instanceof VaultRequestError && (error.status === 401 || error.status === 403)) {
        setData(null);
        setDecision(null);
      }
      const message = error instanceof Error ? error.message : 'Não foi possível atualizar a credencial.';
      setFailure(action === 'save' ? message + ' Digite a chave novamente antes de tentar.' : message);
    } finally { if(active.current)setBusy(false); }
  }

  async function testKey(entry: Entry) {
    if (!vault?.organizationId) return;
    setBusy(true); setFailure(''); setReceipt('');
    try {
      const controller = new AbortController(); mutation.current?.abort(); mutation.current = controller;
      const response = await fetch('/api/assistant/connection', { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' },
        body: JSON.stringify({ organizationId: vault.organizationId, provider: entry.provider, expectedRevision: vault.revision, operationKey: crypto.randomUUID(), consent: true }) });
      const data = await response.json() as { outcome?: string; error?: string };
      if (!active.current || controller.signal.aborted) return;
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Não foi possível testar a chave.');
      setDecision(null);
      setReceipt(`Teste de ${providerLabels[entry.provider]}: ${outcomeLabels[String(data.outcome)] ?? 'resultado registrado'}. Custo: US$ 0,00.`);
      setRefresh(current => current + 1);
    } catch (error) {
      if (!active.current) return;
      setFailure(error instanceof Error ? error.message : 'Não foi possível testar a chave.');
    } finally { if (active.current) setBusy(false); }
  }

  const lastTest = (provider: CredentialProvider) => vault?.history?.find(item => item.action === 'test' && item.provider === provider);
  const entries = vault ? [...vault.keys].sort((a, b) => order.indexOf(a.provider) - order.indexOf(b.provider)) : [];

  return <div className={styles.panel}>
    <div className={styles.heading}>
      <span className="p-icon-tile"><KeyRound size={20} aria-hidden="true"/></span>
      <div><h3>Chaves dos provedores</h3><p>Só a administração geral vê esta área. Depois de salva, a chave nunca mais aparece: fica só o nome, o começo e os quatro últimos caracteres.</p></div>
    </div>
    <ol className={styles.steps} aria-label="Como ligar a inteligência artificial">
      <li><strong>1. Cole a chave</strong><span>Copie no site do provedor e cole aqui.</span></li>
      <li><strong>2. Teste</strong><span>Grátis: só confere se o provedor aceita a chave.</span></li>
      <li><strong>3. Ligue as funções</strong><span>Em “Funções e acesso”, escolha o que usar e o limite por dia.</span></li>
    </ol>
    {failure && !decision && <p role="alert" className="p-inline-error">{failure}</p>}
    {receipt && <p ref={receiptRef} tabIndex={-1} role="status" className={styles.note}>{receipt}</p>}
    {!vault && !failure && <p role="status" className={styles.loading}><LoaderCircle size={16} className="p-spin" aria-hidden="true"/>Consultando o cofre…</p>}
    {failure && !decision && <button type="button" className="p-button p-button-subtle" disabled={busy} onClick={reload}>Atualizar consulta</button>}
    {vault && <>
      {organizationId===undefined&&<label className="p-field"><span>Organização</span><select value={vault.organizationId ?? ''} disabled={busy || !vault.organizations.length} onChange={event => {
        setDecision(null); setFailure(''); setReceipt(''); setLocalSelection(event.target.value);
      }}>{vault.organizations.length ? vault.organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>) : <option value="">Nenhuma organização ativa</option>}</select></label>}
      {!vault.storageReady && <div className={styles.note} role="status"><strong>Cadastro de chaves indisponível neste ambiente</strong><p>A administração precisa configurar o segredo dedicado do cofre no servidor. As chaves já existentes podem continuar conforme os ajustes; cadastrar, trocar ou remover fica bloqueado até essa preparação.</p><details><summary>Orientação para a administração técnica</summary><p>Defina PROEX_KEYS_SECRET no ambiente do portal, com segredo próprio e diferente do login. Em uma rotação, use também PROEX_KEYS_PREVIOUS_SECRET até concluir a migração verificada. Os valores não devem aparecer em notas, capturas ou campos de outros serviços.</p></details></div>}
      {vault.organizationId && <ul className={styles.list}>{entries.map(entry => <li className={styles.entry} key={entry.provider}>
        <div className={styles.entryTop}><span className="p-icon-tile">{entry.provider==='groq'||entry.provider==='deepgram'?<AudioLines size={20} aria-hidden="true"/>:entry.provider==='typesafe'?<ShieldCheck size={20} aria-hidden="true"/>:<ScanText size={20} aria-hidden="true"/>}</span><div><h4>{entry.label}</h4><p>{entry.purpose}</p></div><span className={entry.status === 'active' ? 'p-badge p-status-active' : 'p-badge'}>{statusLabels[entry.status]}</span></div>
        {recommended[entry.provider] && <p className={styles.recommended}>{recommended[entry.provider]}</p>}
        <p className={styles.model}>{providerLabels[entry.provider]} · {models[entry.provider]}</p>
        <p className={styles.price}>{prices[entry.provider]}</p>
        {(entry.mask||entry.status==='active')&&<p className={styles.keyDetails}>{entry.mask || 'Chave legada sem dica cadastrada'}</p>}
        {entry.createdAt && <p className="p-form-help">Cadastrada em {date.format(new Date(entry.createdAt))} · {entry.createdBy}</p>}
        {entry.updatedAt && entry.updatedAt !== entry.createdAt && <p className="p-form-help">Atualizada em {date.format(new Date(entry.updatedAt))} · {entry.updatedBy}</p>}
        {(() => { const test = lastTest(entry.provider); return test && entry.status === 'active' ? <p className={test.outcome === 'authenticated' ? styles.testOk : styles.testWarn}>Último teste: {outcomeLabels[test.outcome ?? ''] ?? 'registrado'} · {date.format(new Date(test.at))}</p> : null; })()}
        {vault.storageReady && <div className={styles.actions}>
          {entry.status === 'active' && <button className="p-button p-button-primary" type="button" disabled={busy} aria-label={`Testar chave ${providerLabels[entry.provider]}`} onClick={event => choose(entry, 'test', event.currentTarget)}>Testar</button>}
          <button className="p-button p-button-subtle" type="button" disabled={busy} aria-label={`${entry.status === 'active' || entry.status === 'disabled' ? 'Trocar' : 'Cadastrar'} chave ${providerLabels[entry.provider]}`} onClick={event => choose(entry, 'save', event.currentTarget)}>{entry.status === 'active' || entry.status === 'disabled' ? 'Trocar' : 'Cadastrar'}</button>
          {entry.status === 'active' && <button className="p-button p-button-subtle" type="button" disabled={busy} aria-label={`Desligar chave ${providerLabels[entry.provider]}`} onClick={event => choose(entry, 'disable', event.currentTarget)}>Desligar</button>}
          {entry.status === 'disabled' && <button className="p-button p-button-subtle" type="button" disabled={busy} aria-label={`Religar chave ${providerLabels[entry.provider]}`} onClick={event => choose(entry, 'enable', event.currentTarget)}>Religar</button>}
          {(entry.status === 'active' || entry.status === 'disabled') && <button className="p-button p-button-subtle" type="button" disabled={busy} aria-label={`Remover chave ${providerLabels[entry.provider]}`} onClick={event => choose(entry, 'remove', event.currentTarget)}>Remover</button>}
        </div>}
        {decision?.entry.provider === entry.provider && <form ref={decisionForm} tabIndex={-1} aria-label={`${submitLabels[decision.action]} ${providerLabels[entry.provider]}`} className={styles.form} onSubmit={submit} key={decision.action}>
          {decision.action === 'save' ? <>
            <label className="p-field"><span>Nome da credencial</span><input name="label" required maxLength={72} defaultValue={entry.label}/></label>
            <label className="p-field"><span>Nova chave</span><input name="credentialValue" type="password" autoComplete="off" data-no-draft="true" minLength={12} maxLength={512} spellCheck={false} disabled={busy} required/></label>
            {vault.recoverable && <label className={styles.confirm}><input name="replaceUnavailable" type="checkbox" required/>Recriar o cofre desta organização. Vou cadastrar novamente as outras chaves. As funções afetadas serão desligadas.</label>}
            <p className="p-form-help">Cole somente a chave. Ela é cifrada no servidor e não volta para esta tela.</p>
          </> : decision.action === 'test' ? <>
            <p><strong>Custo previsto: US$ 0,00.</strong> O portal pede ao provedor apenas a lista de modelos, para saber se a chave é aceita. Nenhum texto é gerado.</p>
            <p className="p-form-help">Há um limite de testes por hora para proteger a conta. O resultado entra no histórico abaixo.</p>
          </> : <p>{decision.action === 'remove' ? 'O valor cifrado desta credencial será retirado do cofre e as funções que a usam serão desligadas.' : decision.action === 'disable' ? 'As funções que usam esta chave serão desligadas. A credencial cifrada fica guardada para uso posterior.' : 'A credencial volta a ficar disponível. As funções permanecem conforme os ajustes da organização.'}</p>}
          {failure && <p role="alert" className="p-inline-error">{failure}</p>}
          <div className={styles.actions}><button className={`p-button ${decision.action === 'remove' ? 'p-button-danger' : 'p-button-primary'}`} type="submit" disabled={busy}>{busy ? 'Salvando…' : submitLabels[decision.action]}</button><button className="p-button p-button-subtle" type="button" disabled={busy} onClick={cancelDecision}>Cancelar</button>{failure && <button type="button" className="p-button p-button-subtle" disabled={busy} onClick={reload}>Atualizar consulta</button>}</div>
        </form>}
      </li>)}</ul>}
      <dl className={styles.metrics} aria-label="Gasto previsto da organização">
        <div><dt>Previsto hoje</dt><dd>{currency.format(vault.reserved.today / 1_000_000)}</dd></div>
        <div><dt>Limite por dia</dt><dd>{currency.format(vault.reserved.dailyLimit / 1_000_000)}</dd></div>
        <div><dt>Previsto no mês</dt><dd>{currency.format(vault.reserved.month / 1_000_000)}</dd></div>
      </dl>
      <p className="p-form-help">O portal guarda o teto de cada chamada antes de enviá-la; o gasto real costuma ser menor. Ao atingir o limite por dia, novas chamadas ficam para o dia seguinte.</p>
      {vault.organizationId && <section className={styles.history} aria-labelledby="vault-history-title">
        <h4 id="vault-history-title"><History size={18} aria-hidden="true"/>Histórico das chaves</h4>
        {vault.history?.length ? <ol>{vault.history.map((item, index) => <li key={`${item.at}-${index}`}>
          <span><strong>{historyLabels[item.action]}{item.provider ? ` · ${providerLabels[item.provider]}` : ''}</strong>{item.mask ? ` (${item.mask})` : ''}{item.action === 'test' && item.outcome ? `: ${outcomeLabels[item.outcome] ?? item.outcome}` : ''}</span>
          <small>{date.format(new Date(item.at))} · {item.actor}</small>
        </li>)}</ol> : <p className="p-form-help">Nada registrado ainda. Cada cadastro, troca, teste, desligamento e remoção aparece aqui, sem o valor da chave.</p>}
      </section>}
      {vault.groqPilot && <p className={styles.note}>Compatibilidade do piloto Groq · {vault.groqPilot === 'configured' ? 'Credencial do servidor disponível apenas para esta organização' : 'Credencial pendente no servidor'}. A seleção explícita Groq usa a chave do cofre e não recorre a essa alternativa.</p>}
    </>}
  </div>;
}

export default function CredentialVaultSettings({ groupClass, bodyClass, canManageKeys=false }: { groupClass: string; bodyClass: string; canManageKeys?:boolean }) {
  const [opened, setOpened] = useState(false);
  const [configurationRevision,setConfigurationRevision]=useState(0),[vaultRevision,setVaultRevision]=useState(0);
  const group = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (window.location.hash !== '#ai-credentials') return;
    const frame = window.requestAnimationFrame(() => {
      if (!group.current) return;
      group.current.open = true;
      group.current.querySelector('summary')?.focus({preventScroll:true});
      group.current.scrollIntoView({block:'start'});
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  return <details ref={group} id="ai-credentials" className={`${groupClass} ${styles.anchor}`} onToggle={event => setOpened(event.currentTarget.open)}>
    <summary><strong>Chaves e modelos</strong><small>Cadastro, funções, acesso, limites e diagnóstico de IA em um só lugar.</small></summary>
    {opened && <div className={bodyClass}><AssistantAdministrationPanel canManageKeys={canManageKeys} refreshKey={configurationRevision} onChanged={()=>setVaultRevision(value=>value+1)} renderCredentials={(organizationId,configurationBusy)=><fieldset disabled={configurationBusy} className={styles.credentialsGroup}><CredentialVaultPanel key={`${organizationId}:${vaultRevision}`} organizationId={organizationId} onChanged={()=>setConfigurationRevision(value=>value+1)}/></fieldset>}/></div>}
  </details>;
}
