'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { BarChart3, Boxes, KeyRound, LoaderCircle, Plus, Scale, Trash2 } from 'lucide-react';
import { CAPABILITIES, CAPABILITY_LABELS, KIND_LABELS, compareEstimate, type Capability, type CatalogModel, type CatalogProvider } from '@/lib/assistant/model-catalog';
import { friendlyMicros } from '@/lib/assistant/role-contracts';
import { safeRequest } from '@/lib/assistant/contracts';
import styles from './model-catalog-panel.module.css';

type Provider = CatalogProvider & { hasKey: boolean };
type View = { organizationId: string; stamp: string; catalog: { providers: Provider[]; models: CatalogModel[]; updatedAt: string; updatedBy: string }; refreshed?: { matched: number; total: number } };
type CompareRow = { modelId: string; label: string; provider: string; text: string; ms: number; inputTokens: number; outputTokens: number; usdMicros: number; reservedUsdMicros: number; error: string | null };
const FILTERS: { key: 'all' | Capability; label: string; hint: string }[] = [
  { key: 'all', label: 'Todos', hint: 'Todos os modelos cadastrados.' },
  { key: 'text', label: 'Conversa', hint: 'Usados pelo Rolê e nas comparações.' },
  { key: 'vision', label: 'Foto', hint: 'Leem imagem. Para o Rolê, escolha em Funções e acesso.' },
  { key: 'document', label: 'Documento', hint: 'Extração de campos. A interpretação de documentos do portal segue com o modelo revisado.' },
  { key: 'speech', label: 'Voz', hint: 'Só transcrevem áudio; não servem para conversa nem documento.' },
  { key: 'decision', label: 'Decisão', hint: 'Respondem perguntas fechadas. Em uso: JEV 1.14. Os outros ficam para teste comparativo.' },
];
const usdPerM = (value: number) => `US$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
/** Mensagem típica do Rolê: 1.500 tokens lidos e 400 escritos. */
const perMessage = (model: CatalogModel) => (1500 * model.price.inputPerM + 400 * model.price.outputPerM);
const priceLine = (model: CatalogModel) => model.price.perHour ? `US$ ${model.price.perHour.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })} por hora de áudio` : !model.price.inputPerM && !model.price.outputPerM ? 'Grátis (somente teste)' : `${friendlyMicros(Math.ceil(perMessage(model))).replace(/^m/, 'M')} por mensagem · ${usdPerM(model.price.inputPerM)} lidos e ${usdPerM(model.price.outputPerM)} escritos por milhão de tokens`;
const blankModel = { id: '', providerId: '', model: '', label: '', capabilities: ['text'] as Capability[], inputPerM: '', outputPerM: '', perHour: '', sourceUrl: '', readAt: new Date().toISOString().slice(0, 10), notes: '', testOnly: false };

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Não foi possível acessar o catálogo.');
  return data as T;
}

export default function ModelCatalogPanel({ organizationId }: { organizationId: string }) {
  const [view, setView] = useState<View | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<typeof blankModel & { replaceId?: string } | null>(null);
  const [providerForm, setProviderForm] = useState<{ id: string; label: string; kind: 'openai_chat' | 'anthropic_messages'; baseUrl: string } | null>(null);
  const [filter, setFilter] = useState<'all' | Capability>('all');
  const [compareIds, setCompareIds] = useState<string[]>([]), [prompt, setPrompt] = useState('Resuma em uma frase: saíram 12 canetas touch para a oficina de robótica.'), [compareConsent, setCompareConsent] = useState(false), [results, setResults] = useState<CompareRow[] | null>(null);

  const load = useCallback(async () => {
    try { const next = await request<View>(`/api/assistant/catalog?organizationId=${encodeURIComponent(organizationId)}`); setView(next); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível abrir o catálogo.'); }
  }, [organizationId]);
  useEffect(() => { let alive = true; request<View>(`/api/assistant/catalog?organizationId=${encodeURIComponent(organizationId)}`).then(next => { if (alive) setView(next); }).catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : 'Não foi possível abrir o catálogo.'); }); return () => { alive = false; }; }, [organizationId]);

  const providers = useMemo(() => new Map((view?.catalog.providers ?? []).map(provider => [provider.id, provider])), [view]);
  const chatModels = (view?.catalog.models ?? []).filter(model => model.enabled && model.capabilities.includes('text') && ['openai_chat', 'anthropic_messages'].includes(providers.get(model.providerId)?.kind ?? ''));
  // Mesma conta do servidor (compareEstimate); ele recalcula e recusa se o valor aceito ficar abaixo.
  const compareCost = useMemo(() => compareEstimate(compareIds.flatMap(id => view?.catalog.models.filter(entry => entry.id === id) ?? []), (() => { try { return safeRequest(prompt); } catch { return prompt.trim(); } })()).total, [compareIds, prompt, view]);

  async function act(body: Record<string, unknown>, done: string) {
    if (!view) return;
    setBusy(true); setError(''); setNotice('');
    try { const next = await request<View>('/api/assistant/catalog', { organizationId, expected: view.stamp, ...body }); setView(next); setNotice(next.refreshed ? `Notas atualizadas: ${next.refreshed.matched} modelos encontrados no Artificial Analysis.` : done); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar.'); return false; }
    finally { setBusy(false); }
  }
  async function saveModel(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    const ok = await act({ action: 'model.save', ...(editing.replaceId ? { replaceId: editing.replaceId } : {}), model: { id: editing.id, providerId: editing.providerId, model: editing.model, label: editing.label, capabilities: editing.capabilities, notes: editing.notes, testOnly: editing.testOnly,
      price: { inputPerM: Number(editing.inputPerM || 0), outputPerM: Number(editing.outputPerM || 0), perHour: Number(editing.perHour || 0) }, source: editing.sourceUrl ? { url: editing.sourceUrl, readAt: editing.readAt } : null } }, 'Modelo salvo.');
    if (ok) setEditing(null);
  }
  async function saveProvider(event: FormEvent) {
    event.preventDefault();
    if (providerForm && await act({ action: 'provider.save', provider: providerForm }, 'Provedor salvo. Cole a chave dele para usar.')) setProviderForm(null);
  }
  async function compare() {
    setBusy(true); setError(''); setResults(null);
    try { const data = await request<{ results: CompareRow[] }>('/api/assistant/catalog', { action: 'compare', organizationId, modelIds: compareIds, prompt, consent: true, acceptedCostMicros: compareCost }); setResults(data.results); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível comparar.'); }
    finally { setBusy(false); }
  }
  function edit(model?: CatalogModel) {
    setEditing(model ? { id: model.id, providerId: model.providerId, model: model.model, label: model.label, capabilities: model.capabilities, inputPerM: String(model.price.inputPerM || ''), outputPerM: String(model.price.outputPerM || ''), perHour: String(model.price.perHour || ''), sourceUrl: model.source?.url ?? '', readAt: model.source?.readAt ?? blankModel.readAt, notes: model.notes, testOnly: model.testOnly, replaceId: model.id } : { ...blankModel, providerId: view?.catalog.providers[0]?.id ?? '' });
  }

  if (!view) return <div className={styles.panel}>{error ? <p role="alert" className="p-inline-error">{error}</p> : <p role="status" className={styles.muted}><LoaderCircle size={16} className="p-spin" aria-hidden="true"/> Abrindo o catálogo…</p>}</div>;
  const reference = view.catalog.providers.find(provider => provider.kind === 'reference');
  return <div className={styles.panel}>
    <div className={styles.heading}><span className="p-icon-tile"><Boxes size={20} aria-hidden="true"/></span><div><h3>Modelos</h3><p>Cadastre qualquer modelo por API: escolha o provedor, diga para que ele serve e quanto custa. Nada aqui gasta dinheiro; só a comparação, com custo mostrado antes.</p></div>{!editing && <button type="button" className={`p-button p-button-primary ${styles.headAdd}`} disabled={busy} onClick={() => edit()}><Plus size={16} aria-hidden="true"/>Cadastrar modelo</button>}</div>
    {(error || notice) && <p role={error ? 'alert' : 'status'} className={error ? 'p-inline-error' : styles.notice}>{error || notice}</p>}

    <section className={styles.group} aria-labelledby="models-title">
      <h4 id="models-title">Modelos cadastrados</h4>
      <div className={styles.filters} role="group" aria-label="Mostrar modelos de">{FILTERS.map(option => <button key={option.key} type="button" aria-pressed={filter === option.key} onClick={() => setFilter(option.key)}>{option.label}</button>)}</div>
      <p className={styles.muted}>{FILTERS.find(option => option.key === filter)?.hint}</p>
      {(() => { const list = view.catalog.models.filter(model => filter === 'all' || model.capabilities.includes(filter)); return list.length ? <ul className={styles.models}>{list.map(model => { const provider = providers.get(model.providerId); return <li key={model.id} className={styles.model}>
        <div className={styles.modelTop}><strong>{model.label}{model.testOnly ? ' · somente teste' : ''}</strong><span className={provider?.hasKey ? styles.ok : styles.warn}>{provider?.hasKey ? 'Chave pronta' : 'Sem chave'}</span></div>
        <p className={styles.muted}>{provider?.label ?? 'Provedor removido'} · <code>{model.model}</code></p>
        <p className={styles.chips}>{model.capabilities.map(capability => <span key={capability}>{CAPABILITY_LABELS[capability]}</span>)}</p>
        <p>{priceLine(model)}{model.score ? ` · nota ${model.score.value} (${model.score.source}, ${model.score.readAt.split('-').reverse().join('/')})` : ''}</p>
        {model.notes && <p className={styles.muted}>{model.notes}</p>}
        {model.source && <p className={styles.muted}>Preço: <a href={model.source.url} target="_blank" rel="noreferrer noopener">fonte oficial</a>, lida em {model.source.readAt.split('-').reverse().join('/')}</p>}
        <div className={styles.actions}><button type="button" className="p-button p-button-subtle" disabled={busy} onClick={() => edit(model)}>Editar</button><button type="button" className="p-button p-button-subtle" disabled={busy} onClick={() => { if (window.confirm(`Apagar ${model.label} do catálogo? Esta ação não pode ser desfeita.`)) void act({ action: 'model.delete', modelId: model.id }, 'Modelo apagado.'); }}><Trash2 size={16} aria-hidden="true"/>Apagar</button></div>
      </li>; })}</ul> : <p className={styles.muted}>Nenhum modelo com esta capacidade.</p>; })()}
    </section>

    {editing ? <form className={styles.form} onSubmit={saveModel} aria-label="Modelo do catálogo">
      <h4>{editing.replaceId ? `Editar ${editing.label}` : 'Novo modelo'}</h4>
      <div className={styles.grid}>
        <label className="p-field"><span>Provedor</span><select value={editing.providerId} onChange={event => setEditing({ ...editing, providerId: event.target.value })}>{view.catalog.providers.map(provider => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select></label>
        <label className="p-field"><span>Nome na tela</span><input required maxLength={60} value={editing.label} onChange={event => setEditing({ ...editing, label: event.target.value })}/></label>
        <label className="p-field"><span>Nome exato na API</span><input required maxLength={120} value={editing.model} onChange={event => setEditing({ ...editing, model: event.target.value })} placeholder="ex.: gpt-6-luna"/></label>
        <label className="p-field"><span>Identificador interno</span><input required maxLength={48} pattern="[a-z0-9][a-z0-9-]{1,47}" value={editing.id} onChange={event => setEditing({ ...editing, id: event.target.value.toLowerCase() })} placeholder="ex.: openai-gpt-6-luna"/></label>
        <label className="p-field"><span>Entrada (US$ por milhão de tokens)</span><input inputMode="decimal" value={editing.inputPerM} onChange={event => setEditing({ ...editing, inputPerM: event.target.value.replace(',', '.') })}/></label>
        <label className="p-field"><span>Saída (US$ por milhão de tokens)</span><input inputMode="decimal" value={editing.outputPerM} onChange={event => setEditing({ ...editing, outputPerM: event.target.value.replace(',', '.') })}/></label>
        <label className="p-field"><span>Voz (US$ por hora), se for o caso</span><input inputMode="decimal" value={editing.perHour} onChange={event => setEditing({ ...editing, perHour: event.target.value.replace(',', '.') })}/></label>
        <label className="p-field"><span>Fonte do preço (link oficial)</span><input type="url" value={editing.sourceUrl} onChange={event => setEditing({ ...editing, sourceUrl: event.target.value })} placeholder="https://"/></label>
        <label className="p-field"><span>Data da leitura</span><input type="date" value={editing.readAt} onChange={event => setEditing({ ...editing, readAt: event.target.value })}/></label>
      </div>
      <fieldset className={styles.capabilities}><legend>Para que serve</legend>{CAPABILITIES.map(capability => <label key={capability}><input type="checkbox" checked={editing.capabilities.includes(capability)} onChange={event => setEditing({ ...editing, capabilities: event.target.checked ? [...editing.capabilities, capability] : editing.capabilities.filter(item => item !== capability) })}/>{CAPABILITY_LABELS[capability]}</label>)}</fieldset>
      <label className={styles.check}><input type="checkbox" checked={editing.testOnly} onChange={event => setEditing({ ...editing, testOnly: event.target.checked })}/>Somente teste (grátis, com dados de exemplo). Não pode ser usado pelo Rolê.</label>
      {!editing.testOnly && <p className={styles.muted}>Modelos pagos precisam de preço de entrada e de saída maior que zero, para o custo previsto ser real.</p>}
      {editing.capabilities.includes('speech') && editing.capabilities.length > 1 && <p className={styles.warnText}>Modelos de voz só transcrevem áudio. Confira se ele também faz o resto.</p>}
      <label className="p-field"><span>Observação</span><input maxLength={200} value={editing.notes} onChange={event => setEditing({ ...editing, notes: event.target.value })}/></label>
      <div className={styles.actions}><button type="submit" className="p-button p-button-primary" disabled={busy}>Salvar modelo</button><button type="button" className="p-button p-button-subtle" onClick={() => setEditing(null)}>Cancelar</button></div>
    </form> : null}

    <section className={styles.group} aria-labelledby="providers-title">
      <h4 id="providers-title"><KeyRound size={18} aria-hidden="true"/> Provedores</h4>
      <p className={styles.muted}>A chave de cada provedor fica na aba Chaves. Aqui você cadastra provedores novos, compatíveis com OpenAI ou Anthropic.</p>
      <ul className={styles.models}>{view.catalog.providers.map(provider => <li key={provider.id} className={styles.model}>
        <div className={styles.modelTop}><strong>{provider.label}</strong><span className={provider.hasKey ? styles.ok : styles.warn}>{provider.hasKey ? `Chave pronta${provider.key?.mask ? ` (${provider.key.mask})` : ''}` : 'Sem chave'}</span></div>
        <p className={styles.muted}>{KIND_LABELS[provider.kind]} · {provider.baseUrl.replace('https://', '')}</p>
        {provider.id === 'nvidia' && <p className={styles.warnText}>Grátis só para teste: a NVIDIA pode usar o que for enviado. Use apenas dados sintéticos.</p>}
        {!provider.builtin && <div className={styles.actions}><button type="button" className="p-button p-button-subtle" disabled={busy} onClick={() => { if (window.confirm(`Apagar o provedor ${provider.label}?`)) void act({ action: 'provider.delete', providerId: provider.id }, 'Provedor apagado.'); }}>Apagar provedor</button></div>}
      </li>)}</ul>
      {providerForm ? <form className={styles.form} onSubmit={saveProvider} aria-label="Novo provedor">
        <div className={styles.grid}>
          <label className="p-field"><span>Nome</span><input required maxLength={40} value={providerForm.label} onChange={event => setProviderForm({ ...providerForm, label: event.target.value })} placeholder="ex.: OpenRouter"/></label>
          <label className="p-field"><span>Identificador</span><input required pattern="[a-z0-9][a-z0-9-]{1,47}" value={providerForm.id} onChange={event => setProviderForm({ ...providerForm, id: event.target.value.toLowerCase() })} placeholder="ex.: openrouter"/></label>
          <label className="p-field"><span>Formato da API</span><select value={providerForm.kind} onChange={event => setProviderForm({ ...providerForm, kind: event.target.value as 'openai_chat' | 'anthropic_messages' })}><option value="openai_chat">Compatível com OpenAI</option><option value="anthropic_messages">Anthropic</option></select></label>
          <label className="p-field"><span>Endereço base da API</span><input required type="url" value={providerForm.baseUrl} onChange={event => setProviderForm({ ...providerForm, baseUrl: event.target.value })} placeholder="https://api.exemplo.com/v1"/></label>
        </div>
        <p className={styles.muted}>Só endereços https:// públicos. O portal chama {providerForm.kind === 'anthropic_messages' ? '/v1/messages' : '/chat/completions'} nesse endereço.</p>
        <div className={styles.actions}><button type="submit" className="p-button p-button-primary" disabled={busy}>Salvar provedor</button><button type="button" className="p-button p-button-subtle" onClick={() => setProviderForm(null)}>Cancelar</button></div>
      </form> : <button type="button" className={`p-button p-button-subtle ${styles.add}`} disabled={busy} onClick={() => setProviderForm({ id: '', label: '', kind: 'openai_chat', baseUrl: '' })}><Plus size={16} aria-hidden="true"/>Cadastrar provedor</button>}
    </section>

    {reference && <section className={styles.group} aria-labelledby="aa-title">
      <h4 id="aa-title"><BarChart3 size={18} aria-hidden="true"/> Notas do Artificial Analysis</h4>
      <p className={styles.muted}>Com a chave do Artificial Analysis cadastrada na aba Chaves, o portal busca a nota de inteligência de cada modelo do catálogo. A conta grátis permite 100 consultas por dia; cada atualização usa uma.</p>
      <div className={styles.actions}><button type="button" className="p-button p-button-primary" disabled={busy || !reference.hasKey} onClick={() => void act({ action: 'scores.refresh' }, 'Notas atualizadas.')}>Atualizar notas agora</button>
        <a className="p-button p-button-subtle" href="https://artificialanalysis.ai/leaderboards/models" target="_blank" rel="noreferrer noopener">Abrir o placar</a></div>
      <p className={styles.muted}>Dados de notas: <a href="https://artificialanalysis.ai" target="_blank" rel="noreferrer noopener">Artificial Analysis</a>.</p>
    </section>}

    <section className={styles.group} aria-labelledby="compare-title">
      <h4 id="compare-title"><Scale size={18} aria-hidden="true"/> Comparar modelos</h4>
      <p className={styles.muted}>Envie a mesma pergunta a 2 ou 3 modelos e veja lado a lado a resposta, o custo e o tempo. Use só dados de exemplo.</p>
      {(() => { const ready = chatModels.filter(model => providers.get(model.providerId)?.hasKey), missing = chatModels.length - ready.length; return <>
        <fieldset className={styles.capabilities}><legend>Modelos (2 a 3)</legend>{ready.length ? ready.map(model => <label key={model.id}><input type="checkbox" disabled={!compareIds.includes(model.id) && compareIds.length >= 3} checked={compareIds.includes(model.id)} onChange={event => setCompareIds(event.target.checked ? [...compareIds, model.id] : compareIds.filter(id => id !== model.id))}/>{model.label}{model.testOnly && !/teste/i.test(model.label) ? ' (só teste)' : ''}</label>) : <span className={styles.muted}>Nenhum modelo com chave pronta.</span>}</fieldset>
        {missing > 0 && <p className={styles.muted}>{missing} {missing === 1 ? 'modelo sem chave não aparece' : 'modelos sem chave não aparecem'} aqui. Cadastre a chave na aba Chaves.</p>}
      </>; })()}
      <label className="p-field"><span>Pergunta</span><textarea rows={3} maxLength={2000} value={prompt} onChange={event => setPrompt(event.target.value)}/></label>
      {compareIds.length < 2 ? <p>Escolha 2 ou 3 modelos para ver o custo máximo.</p> : <p><strong>Custo máximo: {friendlyMicros(compareCost)}</strong> para {compareIds.length} modelos.</p>}
      <label className={styles.check}><input type="checkbox" checked={compareConsent} onChange={event => setCompareConsent(event.target.checked)}/>Autorizo enviar esta pergunta aos provedores escolhidos. Não há dados pessoais nela.</label>
      {!busy && (compareIds.length < 2 || !compareConsent || !prompt.trim()) && <p className={styles.muted}>Para comparar: {(items => items.length > 1 ? `${items.slice(0, -1).join(', ')} e ${items.at(-1)}` : items[0])([compareIds.length < 2 ? 'escolha 2 modelos' : '', !prompt.trim() ? 'escreva a pergunta' : '', !compareConsent ? 'marque a autorização' : ''].filter(Boolean))}.</p>}
      <button type="button" className={`p-button p-button-primary ${styles.compareButton}`} disabled={busy || compareIds.length < 2 || !compareConsent || !prompt.trim()} onClick={() => void compare()}>{busy ? 'Comparando…' : 'Comparar agora'}</button>
      {results && <div className={styles.results}>{results.map(row => <article key={row.modelId} className={styles.result}>
        <h5>{row.label}</h5><p className={styles.muted}>{row.provider} · {(row.ms / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s · custou {friendlyMicros(row.usdMicros)}</p>
        {row.error ? <p role="alert" className="p-inline-error">{row.error}</p> : <pre className={styles.answer}>{row.text}</pre>}
      </article>)}</div>}
    </section>
    <p className={styles.muted}>{view.catalog.updatedBy && view.catalog.updatedBy !== 'padrão' ? `Catálogo alterado em ${new Date(view.catalog.updatedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })} por ${view.catalog.updatedBy}.` : 'Catálogo padrão, de 09/11/2026.'} <button type="button" className={styles.link} onClick={() => void load()}>Recarregar lista</button></p>
  </div>;
}
