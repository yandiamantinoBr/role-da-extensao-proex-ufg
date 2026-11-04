'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { KeyRound, LoaderCircle } from 'lucide-react';
import type { CredentialProvider } from '@/lib/assistant/contracts';
import styles from './credential-vault-panel.module.css';

type Entry = { provider: CredentialProvider; label: string; purpose: string; status: 'active' | 'disabled' | 'removed' | 'missing' | 'unavailable'; mask: string | null; createdAt: string | null; createdBy: string | null; updatedAt: string | null; updatedBy: string | null };
type Vault = {
  organizations: { id: string; name: string }[]; organizationId: string | null; revision: number;
  storageReady: boolean; legacyAvailable: boolean; recoverable: boolean; keys: Entry[];
  groqPilot: 'configured' | 'missing' | null;
  reserved: { today: number; month: number; dailyLimit: number };
};
type Decision = { entry: Entry; action: 'save' | 'enable' | 'disable' | 'remove' };
const statusLabels = { active: 'Disponível', disabled: 'Desligada', removed: 'Removida', missing: 'Sem chave', unavailable: 'Indisponível' };
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', maximumFractionDigits: 6 });
const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
const url = '/api/assistant/credentials';

async function api(path: string, signal?: AbortSignal, input?: Record<string, unknown>): Promise<Vault> {
  const response = await fetch(path, {
    credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
    ...(input ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify(input) } : {}),
  });
  const data = await response.json() as (Partial<Vault> & { error?: unknown }) | null;
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Não foi possível acessar o cofre.');
  if (!data || !Array.isArray(data.keys) || !Array.isArray(data.organizations) || !Number.isSafeInteger(data.revision) ||
      typeof data.storageReady !== 'boolean' || !data.reserved ||
      !data.keys.every(entry => entry && Object.hasOwn(statusLabels, entry.status))) {
    throw new Error('A resposta do cofre chegou incompleta. Atualize a consulta.');
  }
  return data as Vault;
}

function CredentialVaultPanel() {
  const [selection, setSelection] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<{ scope: string; vault: Vault } | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [receipt, setReceipt] = useState('');
  const vault = data?.scope === selection ? data.vault : null;
  useEffect(() => {
    const controller = new AbortController();
    api(selection ? url + '?' + new URLSearchParams({ organizationId: selection }) : url, controller.signal)
      .then(result => { if (!controller.signal.aborted) setData({ scope: selection, vault: result }); })
      .catch(error => { if (!controller.signal.aborted) setFailure(error instanceof Error ? error.message : 'Não foi possível acessar o cofre.'); });
    return () => controller.abort();
  }, [selection, refresh]);

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
    const input = { action, organizationId: vault.organizationId, provider: entry.provider, expectedRevision: vault.revision,
      ...(action === 'save' ? { label: fields.get('label'), secret: fields.get('credentialValue'),
        ...(fields.get('replaceUnavailable') === 'on' ? { replaceUnavailable: true } : {}) } : {}) };
    const secret = form.elements.namedItem('credentialValue');
    if (secret instanceof HTMLInputElement) secret.value = '';
    setBusy(true);
    setFailure('');
    setReceipt('');
    try {
      const result = await api(url, undefined, input);
      if (result.organizationId !== vault.organizationId) throw new Error('A organização mudou. Atualize a consulta.');
      setData({ scope: selection, vault: result });
      setDecision(null);
      setReceipt(action === 'save' ? 'Credencial salva.' : action === 'remove' ? 'Credencial removida.' : action === 'enable' ? 'Credencial liberada para configuração.' : 'Credencial desligada.');
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Não foi possível atualizar a credencial.');
    } finally { setBusy(false); }
  }

  return <div className={styles.panel}>
    <div className={styles.heading}>
      <span className="p-icon-tile"><KeyRound size={20} aria-hidden="true"/></span>
      <div><h3>Cofre de credenciais</h3><p>Controle as chaves por organização. Modelos, funções e limites continuam em Conta → Assistente com revisão.</p></div>
    </div>
    {failure && <p role="alert" className="p-inline-error">{failure}</p>}
    {receipt && <p role="status" className={styles.note}>{receipt}</p>}
    {!vault && !failure && <p role="status" className={styles.loading}><LoaderCircle size={16} className="p-spin" aria-hidden="true"/>Consultando o cofre…</p>}
    {failure && <button type="button" className="p-button p-button-subtle" disabled={busy} onClick={reload}>Atualizar consulta</button>}
    {vault && <>
      <label className="p-field"><span>Organização</span><select value={vault.organizationId ?? ''} disabled={busy || !vault.organizations.length} onChange={event => {
        setDecision(null); setFailure(''); setReceipt(''); setSelection(event.target.value);
      }}>{vault.organizations.length ? vault.organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>) : <option value="">Nenhuma organização ativa</option>}</select></label>
      {!vault.storageReady && <p className={styles.note}>{vault.legacyAvailable ? 'O segredo do cofre está pendente no ambiente. O cadastro atual continua em Conta → Assistente com revisão → Configurar IA.' : 'O segredo do cofre precisa ser conferido no ambiente para permitir alterações.'}</p>}
      <dl className={styles.metrics} aria-label="Reservas da organização">
        <div><dt>Reserva hoje</dt><dd>{currency.format(vault.reserved.today / 1_000_000)}</dd></div>
        <div><dt>Teto diário</dt><dd>{currency.format(vault.reserved.dailyLimit / 1_000_000)}</dd></div>
        <div><dt>Reserva no mês</dt><dd>{currency.format(vault.reserved.month / 1_000_000)}</dd></div>
      </dl>
      <p className="p-form-help">As reservas são estimativas de uso agregado da organização. O cofre não faz chamadas aos provedores.</p>
      {vault.groqPilot && <p className={styles.note}>Piloto Groq · {vault.groqPilot === 'configured' ? 'Credencial configurada no servidor' : 'Credencial pendente no servidor'}.</p>}
      {vault.organizationId && <ul className={styles.list}>{vault.keys.map(entry => <li className={styles.entry} key={entry.provider}>
        <div className={styles.entryTop}><div><h4>{entry.label}</h4><p>{entry.purpose}</p></div><span className={entry.status === 'active' ? 'p-badge p-status-active' : 'p-badge'}>{statusLabels[entry.status]}</span></div>
        <p className={styles.keyDetails}>{entry.mask || (entry.status === 'active' ? 'Chave legada sem dica cadastrada' : 'Sem dica cadastrada')}</p>
        {entry.createdAt && <p className="p-form-help">Cadastrada em {date.format(new Date(entry.createdAt))} · {entry.createdBy}</p>}
        {entry.updatedAt && entry.updatedAt !== entry.createdAt && <p className="p-form-help">Atualizada em {date.format(new Date(entry.updatedAt))} · {entry.updatedBy}</p>}
        {vault.storageReady && <div className={styles.actions}>
          <button className="p-button p-button-subtle" type="button" disabled={busy} onClick={() => setDecision({ entry, action: 'save' })}>{entry.status === 'active' || entry.status === 'disabled' ? 'Trocar' : 'Cadastrar'}</button>
          {entry.status === 'active' && <button className="p-button p-button-subtle" type="button" disabled={busy} onClick={() => setDecision({ entry, action: 'disable' })}>Desligar</button>}
          {entry.status === 'disabled' && <button className="p-button p-button-subtle" type="button" disabled={busy} onClick={() => setDecision({ entry, action: 'enable' })}>Liberar</button>}
          {(entry.status === 'active' || entry.status === 'disabled') && <button className="p-button p-button-subtle" type="button" disabled={busy} onClick={() => setDecision({ entry, action: 'remove' })}>Remover</button>}
        </div>}
        {decision?.entry.provider === entry.provider && <form className={styles.form} onSubmit={submit} key={decision.action}>
          {decision.action === 'save' ? <>
            <label className="p-field"><span>Nome da credencial</span><input name="label" required maxLength={72} defaultValue={entry.label}/></label>
            <label className="p-field"><span>Nova chave</span><input name="credentialValue" type="password" autoComplete="off" minLength={12} maxLength={512} spellCheck={false} disabled={busy} required/></label>
            {vault.recoverable && <label className={styles.confirm}><input name="replaceUnavailable" type="checkbox" required/>Substituir as credenciais indisponíveis desta organização. As funções afetadas serão desligadas.</label>}
          </> : <p>{decision.action === 'remove' ? 'O valor cifrado desta credencial será retirado do cofre e as funções que a usam serão desligadas.' : decision.action === 'disable' ? 'As funções que usam esta chave serão desligadas. A credencial cifrada fica guardada para uso posterior.' : 'A credencial volta a ficar disponível. As funções permanecem conforme os ajustes da organização.'}</p>}
          <div className={styles.actions}><button className="p-button p-button-primary" type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Confirmar'}</button><button className="p-button p-button-subtle" type="button" disabled={busy} onClick={() => setDecision(null)}>Cancelar</button></div>
        </form>}
      </li>)}</ul>}
    </>}
  </div>;
}

export default function CredentialVaultSettings({ groupClass, bodyClass }: { groupClass: string; bodyClass: string }) {
  const [opened, setOpened] = useState(false);
  return <details id="ai-credentials" className={groupClass} onToggle={event => setOpened(event.currentTarget.open)}>
    <summary><strong>Chaves e modelos</strong><small>Credenciais, permissões e limites dos provedores de IA.</small></summary>
    {opened && <div className={bodyClass}><CredentialVaultPanel/></div>}
  </details>;
}
