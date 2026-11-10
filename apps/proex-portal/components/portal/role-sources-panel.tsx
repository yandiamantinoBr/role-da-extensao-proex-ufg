'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Globe2, Trash2 } from 'lucide-react';
import styles from './role-sources-panel.module.css';

type Post = { id: string; url: string; postedAt: string; caption: string; addedBy: string };
type Sources = { refreshedAt: string | null; pages: { id: string; label: string; url: string; fetchedAt: string | null; ok: boolean }[]; posts: Post[] };
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : 'ainda não';
const day = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC' });

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !data) throw new Error(data?.error ?? 'Não foi possível carregar as fontes do Rolê.');
  return data;
}

/** Fontes oficiais que o Rolê consulta: cópia diária das páginas públicas e publicações do Instagram coladas pela comunicação. */
export default function RoleSourcesPanel({ organizationId }: { organizationId: string }) {
  const [data, setData] = useState<{ key: string; value: Sources | null; error: string } | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  useEffect(() => {
    let alive = true;
    request<Sources>(`/api/assistant/sources?organizationId=${encodeURIComponent(organizationId)}`).then(value => { if (alive) setData({ key: organizationId, value, error: '' }); }).catch(error => { if (alive) setData({ key: organizationId, value: null, error: error instanceof Error ? error.message : 'Fontes indisponíveis.' }); });
    return () => { alive = false; };
  }, [organizationId]);
  const sources = data?.key === organizationId ? data.value : null;
  const okPages = sources?.pages.filter(page => page.ok).length ?? 0;

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget, fields = new FormData(form);
    setBusy(true); setMessage(null);
    try {
      const { posts } = await request<{ posts: Post[] }>('/api/assistant/sources', { action: 'add', organizationId, url: fields.get('url'), postedAt: fields.get('postedAt'), caption: fields.get('caption') });
      setData(current => current?.value ? { ...current, value: { ...current.value, posts } } : current); form.reset();
      setMessage({ error: false, text: 'Publicação cadastrada. O Rolê já pode citá-la.' });
    } catch (error) { setMessage({ error: true, text: error instanceof Error ? error.message : 'Não foi possível salvar.' }); }
    finally { setBusy(false); }
  }
  async function remove(post: Post) {
    if (!window.confirm('Tirar esta publicação das fontes do Rolê?')) return;
    setBusy(true); setMessage(null);
    try { const { posts } = await request<{ posts: Post[] }>('/api/assistant/sources', { action: 'remove', organizationId, id: post.id }); setData(current => current?.value ? { ...current, value: { ...current.value, posts } } : current); }
    catch (error) { setMessage({ error: true, text: error instanceof Error ? error.message : 'Não foi possível remover.' }); }
    finally { setBusy(false); }
  }

  return <section className={styles.panel} aria-labelledby="role-sources-title">
    <div className={styles.heading}><Globe2 size={20} aria-hidden="true"/><div><h4 id="role-sources-title">Fontes oficiais do Rolê</h4><p>O Rolê cita estas fontes com link e data. Nada aqui gera custo de IA.</p></div></div>
    {data?.error && <p className="p-inline-error" role="alert">{data.error}</p>}
    {sources && <>
      <div className={styles.block}>
        <h5>Páginas públicas da PROEX e do CONPEEX</h5>
        <p className={styles.muted}>Copiadas uma vez por dia (título, resumo curto e links), respeitando o robots.txt de cada site. Última cópia: {when(sources.refreshedAt)}{sources.refreshedAt ? ` · ${okPages} de ${sources.pages.length} páginas copiadas` : ''}.</p>
        <details><summary>Ver as {sources.pages.length} páginas da lista</summary><ul className={styles.pages}>{sources.pages.map(page => <li key={page.id}><a href={page.url} target="_blank" rel="noopener noreferrer">{page.label} ↗</a><span className={page.ok ? styles.ok : styles.warn}>{page.ok ? `copiada ${when(page.fetchedAt)}` : page.fetchedAt ? 'última tentativa falhou' : 'ainda não copiada'}</span></li>)}</ul></details>
      </div>
      <div className={styles.block}>
        <h5>Publicações do Instagram</h5>
        <p className={styles.muted}>Cole o link da publicação e um resumo da legenda. O portal não raspa o Instagram. A integração oficial (posts recentes e métricas) fica desligada até a comunicação autorizar a conta profissional.</p>
        {message && <p role={message.error ? 'alert' : 'status'} className={message.error ? 'p-inline-error' : styles.note}>{message.text}</p>}
        <form className={styles.form} onSubmit={event => void add(event)}>
          <label className="p-field"><span>Link da publicação</span><input name="url" type="url" required placeholder="https://www.instagram.com/p/…" maxLength={120} disabled={busy}/></label>
          <label className="p-field"><span>Data da publicação</span><input name="postedAt" type="date" required disabled={busy}/></label>
          <label className={`p-field ${styles.wide}`}><span>Resumo da legenda</span><textarea name="caption" required minLength={10} maxLength={500} rows={2} placeholder="Ex.: Rolê da Extensão no CONPEEX, roleta com brindes no Centro de Eventos." disabled={busy}/></label>
          <button type="submit" className="p-button p-button-primary" disabled={busy}>Cadastrar publicação</button>
        </form>
        {sources.posts.length === 0 ? <p className={styles.muted}>Nenhuma publicação cadastrada ainda.</p> : <ul className={styles.posts}>{sources.posts.map(post => <li key={post.id}>
          <div><a href={post.url} target="_blank" rel="noopener noreferrer">{day(post.postedAt)} ↗</a><p>{post.caption}</p><small>Cadastrada por {post.addedBy}</small></div>
          <button type="button" className={`p-button p-button-subtle ${styles.remove}`} disabled={busy} onClick={() => void remove(post)} aria-label={`Remover publicação de ${day(post.postedAt)}`}><Trash2 size={16} aria-hidden="true"/>Remover</button>
        </li>)}</ul>}
      </div>
    </>}
  </section>;
}
