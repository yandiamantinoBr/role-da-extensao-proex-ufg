'use client';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Bold, Check, ChevronDown, Heading2, History, Link2, List, LoaderCircle, Pencil, UserPlus, X } from 'lucide-react';
import ExportFormats, { type DocumentFormat } from '../export-formats';
import { download } from '../report-export';
import { toReportDocx } from '../project-report/ooxml';
import { managementGet, managementPost } from './api';
import { guideDocument, linkHost, parseMarkdown, type Inline } from './markdown';
import styles from './management.module.css';

type Page = { slug: string; title: string; section: string; sectionLabel: string; position: number; version: number; updatedAt: string | null; updatedBy: string; isStarter: boolean; body: string; markdown: string };
type Workspace = { organization: { id: string; name: string }; canEdit: boolean; canManageEditors: boolean; pages: Page[]; editors: { userId: string; name: string }[]; candidates: { userId: string; name: string }[]; liveBlocks: string[] };
type Version = { version: number; title: string; author: string; note: string; createdAt: string; size: number };

function InlineView({ parts }: { parts: Inline[] }) {
  return <>{parts.map((part, index) => {
    let node: ReactNode = part.text;
    if (part.italic) node = <em>{node}</em>;
    if (part.bold) node = <strong>{node}</strong>;
    const host = linkHost(part);
    if (part.href) node = <><a href={part.href} target="_blank" rel="noopener noreferrer">{node}</a>{host && <small className={styles.linkHost}> ({host})</small>}</>;
    return <Fragment key={index}>{node}</Fragment>;
  })}</>;
}
export function MarkdownView({ source }: { source: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return <div className={styles.md}>{blocks.map((block, index) => {
    if (block.type === 'h1') return <h3 key={index}><InlineView parts={block.inline}/></h3>;
    if (block.type === 'h2') return <h4 key={index}><InlineView parts={block.inline}/></h4>;
    if (block.type === 'h3') return <h5 key={index}><InlineView parts={block.inline}/></h5>;
    if (block.type === 'p') return <p key={index}><InlineView parts={block.inline}/></p>;
    if (block.type !== 'list') return null;
    const List = block.ordered ? 'ol' : 'ul';
    return <List key={index}>{block.items.map((item, position) => <li key={position} style={item.depth ? { marginLeft: item.depth * 18 } : undefined}><InlineView parts={item.inline}/></li>)}</List>;
  })}</div>;
}
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const LIVE_LABEL: Record<string, string> = { estrutura: 'organograma', programas: 'projetos', calendario: 'próximos marcos', 'equipe-oficial': 'equipe oficial' };
type Format = { label: string; icon: ReactNode; apply: (selected: string) => string };
const FORMATS: Format[] = [
  { label: 'Título de seção', icon: <Heading2 size={16} aria-hidden="true"/>, apply: selected => `\n## ${selected || 'Nova seção'}\n` },
  { label: 'Negrito', icon: <Bold size={16} aria-hidden="true"/>, apply: selected => `**${selected || 'texto'}**` },
  { label: 'Lista', icon: <List size={16} aria-hidden="true"/>, apply: selected => (selected || 'item').split('\n').map(line => `- ${line.replace(/^\s*[-*]\s+/, '')}`).join('\n') },
  { label: 'Link', icon: <Link2 size={16} aria-hidden="true"/>, apply: selected => `[${selected || 'texto do link'}](https://)` },
];

export default function GuidePanel({ organizationId }: { organizationId: string }) {
  const [data, setData] = useState<Workspace | null>(null), [error, setError] = useState(''), [slug, setSlug] = useState('estrutura');
  const [editing, setEditing] = useState<{ title: string; body: string; note: string; preview: boolean } | null>(null);
  const [saving, setSaving] = useState(false), [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [history, setHistory] = useState<Version[] | null>(null), [editorPick, setEditorPick] = useState('');
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    managementGet<Workspace>({ view: 'guide', organizationId }, controller.signal).then(setData).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível abrir o guia.'); });
    return () => controller.abort();
  }, [organizationId]);
  const page = data?.pages.find(entry => entry.slug === slug) ?? data?.pages[0];
  const sections = useMemo(() => { const groups: { label: string; pages: Page[] }[] = []; for (const entry of data?.pages ?? []) { const last = groups.at(-1); if (last?.label === entry.sectionLabel) last.pages.push(entry); else groups.push({ label: entry.sectionLabel, pages: [entry] }); } return groups; }, [data]);

  function format(entry: Format) {
    const area = bodyRef.current;
    if (!area || !editing) return;
    const start = area.selectionStart, end = area.selectionEnd, text = entry.apply(editing.body.slice(start, end));
    setEditing({ ...editing, body: editing.body.slice(0, start) + text + editing.body.slice(end) });
    requestAnimationFrame(() => { area.focus(); area.setSelectionRange(start, start + text.length); });
  }
  function open(next: string) { if (editing && !window.confirm('Sair da edição sem salvar?')) return; setSlug(next); setEditing(null); setHistory(null); setMessage(null); }
  async function run(payload: Record<string, unknown>, success: string) {
    setSaving(true); setMessage(null);
    try { const next = await managementPost<Workspace>({ organizationId, ...payload }); setData(next); setEditing(null); setHistory(null); setMessage({ tone: 'ok', text: success }); return true; }
    catch (cause) { setMessage({ tone: 'error', text: cause instanceof Error ? cause.message : 'Não foi possível salvar.' }); return false; }
    finally { setSaving(false); }
  }
  async function loadHistory() {
    if (!page) return;
    try { setHistory((await managementGet<{ versions: Version[] }>({ view: 'guide-history', organizationId, slug: page.slug })).versions); }
    catch (cause) { setMessage({ tone: 'error', text: cause instanceof Error ? cause.message : 'Não foi possível abrir o histórico.' }); }
  }
  async function exportGuide(format: DocumentFormat) {
    if (!data) throw new Error('Espere o guia carregar.');
    const doc = guideDocument(data.organization.name, data.pages);
    const blob = format === 'pdf' ? await (await import('../project-report/pdf')).toReportPdf(doc) : toReportDocx(doc);
    download(`guia-${data.organization.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')}-${doc.generatedIso.slice(0, 10)}.${format}`, blob);
  }

  if (error) return <div className={styles.errorBox} role="alert"><p>{error}</p></div>;
  if (!data || !page) return <p className={styles.loading}><LoaderCircle size={18} className="p-spin" aria-hidden="true"/>Abrindo o guia…</p>;
  const reviewed = data.pages.filter(entry => !entry.isStarter).length;
  const editorsBox = data.canManageEditors && <details className={styles.editorsBox}>
    <summary>Quem pode editar o guia ({data.editors.length ? `administração e mais ${data.editors.length}` : 'só a administração'})<ChevronDown size={18} aria-hidden="true"/></summary>
    <p className={styles.help}>A administração edita sempre. Designe outras pessoas da organização; quem perde o vínculo deixa de editar.</p>
    {data.editors.length > 0 && <ul className={styles.history}>{data.editors.map(editor => <li key={editor.userId}>{editor.name}<button type="button" className="p-icon-button" aria-label={`Tirar ${editor.name} da edição`} onClick={() => void run({ action: 'guide.editors.remove', userId: editor.userId }, `${editor.name} não edita mais o guia.`)}><X size={15} aria-hidden="true"/></button></li>)}</ul>}
    <div className={styles.pickRow}><label className="p-field"><span>Pessoa da organização</span><select value={editorPick} onChange={event => setEditorPick(event.target.value)}><option value="">Escolha…</option>{data.candidates.filter(person => !data.editors.some(editor => editor.userId === person.userId)).map(person => <option key={person.userId} value={person.userId}>{person.name}</option>)}</select></label>
      <button type="button" className={`p-button p-button-subtle ${styles.centered}`} disabled={!editorPick || saving} title={editorPick ? undefined : 'Escolha uma pessoa acima'} onClick={() => void run({ action: 'guide.editors.add', userId: editorPick }, 'Editor designado.').then(ok => { if (ok) setEditorPick(''); })}><UserPlus size={16} aria-hidden="true"/>Designar</button></div>
  </details>;
  return <div className={styles.root}>
    <div className={styles.guideTop}>
      <div className={styles.guideIntro}>
        <p className={styles.help}>Como a {data.organization.name} funciona: estrutura, programas, processos, calendário, contatos e glossário. {data.canEdit ? 'Você pode editar; cada gravação vira uma versão com autor.' : 'Leitura: a edição é da administração e de quem ela designar.'}</p>
        <p className={styles.progress}><span className={styles.progressBar} aria-hidden="true"><i style={{ width: `${Math.round(reviewed / data.pages.length * 100)}%` }}/></span>{reviewed} de {data.pages.length} páginas revisadas pela equipe</p>
      </div>
      <ExportFormats label="Baixar o guia completo" showLabel formats={['docx', 'pdf']} onExport={exportGuide}/>
    </div>
    <div className={styles.guide}>
      <nav className={styles.guideNav} aria-label="Páginas do guia">
        <label className={`p-field ${styles.navSelect}`}><span>Página</span><select value={page.slug} onChange={event => open(event.target.value)}>{sections.map(group => <optgroup key={group.label} label={group.label}>{group.pages.map(entry => <option key={entry.slug} value={entry.slug}>{entry.title}{entry.isStarter ? '' : ' (revisada)'}</option>)}</optgroup>)}</select></label>
        {sections.map(group => <div key={group.label} className={styles.navGroup}><h3>{group.label}</h3><ul>{group.pages.map(entry => <li key={entry.slug}><button type="button" aria-current={entry.slug === page.slug ? 'page' : undefined} onClick={() => open(entry.slug)}>{entry.title}{entry.isStarter ? <span className={styles.srOnly}> (conteúdo inicial)</span> : <span className={styles.reviewedMark} title="Revisada pela equipe"><Check size={14} aria-hidden="true"/><span className={styles.srOnly}> revisada</span></span>}</button></li>)}</ul></div>)}
      </nav>
      <article className={styles.article} aria-labelledby="guide-page-title">
        <div className={styles.articleHead}>
          <p id="guide-page-title">{page.sectionLabel} · {page.isStarter ? 'conteúdo inicial, ainda não revisado pela equipe' : `versão ${page.version}${page.updatedBy ? ` por ${page.updatedBy}` : ''}, ${when(page.updatedAt)}`}</p>
          <div className={styles.actions}>
            {!page.isStarter && <button type="button" className="p-button p-button-subtle" onClick={() => history ? setHistory(null) : void loadHistory()} aria-expanded={!!history}><History size={16} aria-hidden="true"/>{history ? 'Fechar histórico' : 'Histórico'}</button>}
            {data.canEdit && !editing && <button type="button" className="p-button p-button-primary" onClick={() => { setEditing({ title: page.title, body: page.body, note: '', preview: false }); setMessage(null); }}><Pencil size={16} aria-hidden="true"/>Editar página</button>}
          </div>
        </div>
        {message && <p className={message.tone === 'ok' ? styles.ok : 'p-inline-error'} role={message.tone === 'ok' ? 'status' : 'alert'}>{message.text}</p>}
        {history && <section aria-label="Versões desta página"><ul className={styles.history}>{history.map(version => <li key={version.version}><span><strong>Versão {version.version}</strong> · {version.author} · {when(version.createdAt)}{version.note ? ` · ${version.note}` : ''}</span>
          {data.canEdit && version.version !== page.version && <button type="button" className="p-button p-button-subtle" disabled={saving} onClick={() => { if (window.confirm(`Restaurar a versão ${version.version}? Isso cria uma versão nova; nada é apagado.`)) void run({ action: 'guide.restore', slug: page.slug, version: version.version, expectedVersion: page.version }, `Versão ${version.version} restaurada.`); }}>Restaurar</button>}</li>)}</ul></section>}
        {editing ? <form className={styles.editor} onSubmit={event => { event.preventDefault(); void run({ action: 'guide.save', slug: page.slug, title: editing.title, body: editing.body, note: editing.note, expectedVersion: page.version }, 'Página salva. A versão anterior continua no histórico.'); }}>
          <label className="p-field"><span>Título</span><input value={editing.title} maxLength={160} onChange={event => setEditing({ ...editing, title: event.target.value })} required/></label>
          <div className={styles.editorBar}>
            <div className={styles.actions} role="tablist" aria-label="Modo do editor">
              <button type="button" role="tab" aria-selected={!editing.preview} className={`p-button ${editing.preview ? 'p-button-subtle' : 'p-button-primary'}`} onClick={() => setEditing({ ...editing, preview: false })}>Escrever</button>
              <button type="button" role="tab" aria-selected={editing.preview} className={`p-button ${editing.preview ? 'p-button-primary' : 'p-button-subtle'}`} onClick={() => setEditing({ ...editing, preview: true })}>Ver como fica</button>
            </div>
            {!editing.preview && <div className={styles.formatBar} role="toolbar" aria-label="Formatação">{FORMATS.map(entry => <button key={entry.label} type="button" className="p-icon-button" aria-label={entry.label} title={entry.label} onClick={() => format(entry)}>{entry.icon}</button>)}</div>}
          </div>
          {editing.preview ? <MarkdownView source={editing.body}/> : <label className="p-field"><span>Texto</span>
            <textarea ref={bodyRef} value={editing.body} maxLength={40000} onChange={event => setEditing({ ...editing, body: event.target.value })} aria-describedby="guide-help"/></label>}
          {!editing.preview && <details id="guide-help" className={styles.helpBox}><summary>Ajuda de formatação<ChevronDown size={16} aria-hidden="true"/></summary>
            <ul className={styles.help}><li><code>## Seção</code> cria um título; <code>- item</code> cria uma lista; <code>**texto**</code> deixa em negrito; <code>_texto_</code> em itálico.</li>
              <li>Links: <code>[texto](https://endereço)</code>. Só endereços com https.</li>
              <li>Listas automáticas do portal (atualizam sozinhas): {data.liveBlocks.map(name => <Fragment key={name}><code>{`{{${name}}}`}</code> ({LIVE_LABEL[name] ?? name}) </Fragment>)}</li>
              <li>Marque dúvidas com <code>_a confirmar_</code>.</li></ul></details>}
          <label className="p-field"><span>O que mudou (opcional)</span><input value={editing.note} maxLength={300} placeholder="Ex.: atualizei os responsáveis do CONPEEX" onChange={event => setEditing({ ...editing, note: event.target.value })}/></label>
          <div className={styles.actions}><button type="submit" className="p-button p-button-primary" disabled={saving}>{saving && <LoaderCircle size={15} className="p-spin" aria-hidden="true"/>}Salvar versão</button><button type="button" className="p-button p-button-subtle" onClick={() => setEditing(null)}>Cancelar</button></div>
        </form> : <>
          {page.isStarter && <p className={styles.starter}>Conteúdo inicial montado com fontes públicas e com o próprio portal. Itens marcados <em>a confirmar</em> precisam da revisão da equipe.</p>}
          <MarkdownView source={page.markdown}/>
          {page.updatedAt && <p className={styles.help}>Última revisão em {when(page.updatedAt).slice(0, 10)}.</p>}
        </>}
        {editorsBox}
      </article>
    </div>
  </div>;
}
