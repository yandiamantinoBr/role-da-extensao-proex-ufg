'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { KIND_LABELS, type CatalogProvider } from '@/lib/assistant/model-catalog';
import styles from './credential-vault-panel.module.css';

type Provider = CatalogProvider & { hasKey: boolean };
type View = { stamp: string; catalog: { providers: Provider[] } };
const HINTS: Record<string, string> = {
  nvidia: 'Grátis só para teste: a NVIDIA pode usar o que for enviado. Use apenas dados de exemplo.',
  anthropic: 'Modelos Claude (conversa, fotos e documentos).',
  perplexity: 'Decider: modelo de decisão para teste comparativo com o JEV.',
  nace: 'Drex: modelo de decisão para teste comparativo com o JEV.',
  artificialanalysis: 'Busca as notas dos modelos (aba Modelos → Atualizar notas). Grátis, até 100 consultas por dia.',
};

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Não foi possível acessar as chaves.');
  return data as T;
}

/** Chaves dos provedores cadastrados no catálogo (p:<id>), no mesmo lugar das outras chaves. */
export default function CatalogKeysGroup({ organizationId }: { organizationId: string }) {
  const [view, setView] = useState<View | null>(null), [open, setOpen] = useState<string | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  useEffect(() => { let alive = true; request<View>(`/api/assistant/catalog?organizationId=${encodeURIComponent(organizationId)}`).then(next => { if (alive) setView(next); }).catch(() => { if (alive) setView(null); }); return () => { alive = false; }; }, [organizationId]);
  const providers = (view?.catalog.providers ?? []).filter(provider => provider.keyRef.startsWith('p:'));
  if (!view || !providers.length) return null;

  async function act(body: Record<string, unknown>, done: string) {
    if (!view) return false;
    setBusy(true); setMessage(null);
    try { setView(await request<View>('/api/assistant/catalog', { organizationId, expected: view.stamp, ...body })); setMessage({ error: false, text: done }); return true; }
    catch (cause) { setMessage({ error: true, text: cause instanceof Error ? cause.message : 'Não foi possível salvar.' }); return false; }
    finally { setBusy(false); }
  }
  async function save(event: FormEvent<HTMLFormElement>, provider: Provider) {
    event.preventDefault();
    const form = new FormData(event.currentTarget), secret = String(form.get('secret') ?? '');
    const input = event.currentTarget.elements.namedItem('secret');
    if (input instanceof HTMLInputElement) input.value = '';
    if (await act({ action: 'key.save', providerId: provider.id, label: String(form.get('label') ?? ''), secret }, 'Chave salva. Ela não volta para a tela.')) setOpen(null);
  }

  return <section className={styles.keyGroup} aria-label="Outros provedores">
    <h4 className={styles.keyGroupTitle}>Outros provedores</h4>
    <p className="p-form-help">Provedores do catálogo de modelos. Para cadastrar um provedor novo, use a aba Modelos.</p>
    {message && <p role={message.error ? 'alert' : 'status'} className={message.error ? 'p-inline-error' : styles.note}>{message.text}</p>}
    <ul className={styles.list}>{providers.map(provider => <li key={provider.id} className={styles.entry}>
      <div className={styles.entryTop}><div><h4>{provider.label}</h4><p>{HINTS[provider.id] ?? KIND_LABELS[provider.kind]}</p></div><span className={provider.hasKey ? 'p-badge p-status-active' : 'p-badge'}>{provider.hasKey ? 'Chave pronta' : 'Sem chave'}</span></div>
      {provider.hasKey && provider.key?.mask && <p className={styles.keyDetails}>Chave: <strong>{provider.key.mask}</strong></p>}
      {provider.key?.updatedAt && <p className="p-form-help">Atualizada em {new Date(provider.key.updatedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })} · {provider.key.updatedBy}</p>}
      {open === provider.id ? <form className={styles.form} onSubmit={event => void save(event, provider)} aria-label={`Salvar chave ${provider.label}`}>
        <label className="p-field"><span>Nome da chave</span><input name="label" maxLength={72} defaultValue={provider.key?.label ?? provider.label}/></label>
        <label className="p-field"><span>Chave</span><input name="secret" type="password" autoComplete="off" data-no-draft="true" minLength={12} maxLength={512} required spellCheck={false}/></label>
        <div className={styles.actions}><button type="submit" className="p-button p-button-primary" disabled={busy}>Salvar chave</button><button type="button" className="p-button p-button-subtle" disabled={busy} onClick={() => setOpen(null)}>Cancelar</button></div>
      </form> : <div className={styles.actions}>
        <button type="button" className="p-button p-button-subtle" disabled={busy} onClick={() => setOpen(provider.id)}>{provider.hasKey ? 'Trocar' : 'Cadastrar'}</button>
        {provider.hasKey && <button type="button" className={`p-button p-button-subtle ${styles.danger}`} disabled={busy} onClick={() => { if (window.confirm(`Remover a chave de ${provider.label}? Ela não poderá ser vista de novo.`)) void act({ action: 'key.remove', providerId: provider.id }, 'Chave removida.'); }}>Remover</button>}
      </div>}
    </li>)}</ul>
  </section>;
}
