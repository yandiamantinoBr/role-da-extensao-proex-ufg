'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, FilePlus2, LoaderCircle, MessageSquarePlus, RefreshCw, Save, Trash2 } from 'lucide-react';
import {
  defaultReportConfig, normalizeReportConfig, periodRange, REFERENCE_TYPE_LABEL, REPORT_NOTES_LIMIT, REPORT_SECTION_NOTE_LIMIT, REPORT_SECTIONS, REPORT_TEMPLATE_NAME_LIMIT, REPORT_TITLE_LIMIT,
  starterTemplates, type ReportConfig, type ReportPeriod, type ReportSectionId,
} from '@/lib/project-report-config';
import DateField from '../date-field';
import ExportFormats, { type DocumentFormat } from '../export-formats';
import { download } from '../report-export';
import { projectBrandFor } from '../reports-center';
import { personalDraftKey } from '../use-form-draft';
import { buildReportDocument, sectionAvailable, type ReportData } from './document';
import { toReportDocx, toReportXlsx } from './ooxml';
import ReportPreview from './preview';
import styles from './project-report.module.css';

type Template = { id: string; name: string; version: number; config: ReportConfig };
type Payload = ReportData & { permissions: { canSaveTemplates: boolean; canAddReferences: boolean }; templates: Template[] };
type Props = { projectId: string; projectName?: string; officialUrl?: string; refreshKey?: string; onAddReference?: () => void };

const DRAFT_KEY = 'project-report:';
const MONTH_NAMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
function today(): string { return new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10); }
function recentMonths(): { value: string; label: string }[] {
  const [year, month] = today().split('-').map(Number), months: { value: string; label: string }[] = [];
  for (let offset = 1; offset >= -23; offset--) {
    const date = new Date(Date.UTC(year, month - 1 + offset, 1)), value = date.toISOString().slice(0, 7);
    months.push({ value, label: `${MONTH_NAMES[date.getUTCMonth()]} de ${date.getUTCFullYear()}` });
  }
  return months;
}
// Rascunho separado por pessoa e apagado ao sair (mesmo escopo dos formulários do portal).
function readDraft(projectId: string): ReportConfig {
  try { const key = personalDraftKey(DRAFT_KEY + projectId), raw = key ? window.localStorage.getItem(key) : null; if (raw) return normalizeReportConfig(JSON.parse(raw)); } catch { /* rascunho opcional */ }
  return defaultReportConfig();
}
function errorMessage(body: unknown, fallback: string): string {
  const value = body && typeof body === 'object' ? (body as Record<string, unknown>).error ?? (body as Record<string, unknown>).message : null;
  const detail = value && typeof value === 'object' && 'message' in value ? (value as { message?: unknown }).message : value;
  return typeof detail === 'string' && detail ? detail : fallback;
}
function slug(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'projeto';
}

export default function ProjectReportBuilder({ projectId, projectName, officialUrl, refreshKey = '', onAddReference }: Props) {
  // Montado só no cliente (a ficha do projeto carrega depois da página); `key` troca por projeto.
  const [config, setConfig] = useState<ReportConfig>(() => typeof window === 'undefined' ? defaultReportConfig() : readDraft(projectId));
  const [templateKey, setTemplateKey] = useState('');
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const [naming, setNaming] = useState(false), [templateName, setTemplateName] = useState(''), [saving, setSaving] = useState(false);
  const [templateMessage, setTemplateMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const range = periodRange(config.period);
  const from = range?.from ?? '', to = range?.to ?? '';
  const months = useMemo(() => recentMonths(), []);
  const starters = useMemo(() => starterTemplates(today()), []);
  const sectionRefs = useRef(new Map<string, HTMLButtonElement | null>());

  useEffect(() => {
    try { const key = personalDraftKey(DRAFT_KEY + projectId); if (key) window.localStorage.setItem(key, JSON.stringify(config)); } catch { /* sem armazenamento local */ }
  }, [config, projectId]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true); setError('');
      try {
        const query = new URLSearchParams(from ? { from, to } : {});
        const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/report?${query}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
        const body = await response.json().catch(() => null) as Partial<Payload> | null;
        // Acesso retirado: some com os dados antigos em vez de continuar mostrando e baixando.
        if ([401, 403, 404].includes(response.status) && !controller.signal.aborted) setPayload(null);
        if (!response.ok || !body || typeof body !== 'object' || !body.project || !body.sections) throw new Error(errorMessage(body, 'Não foi possível carregar os dados do relatório.'));
        if (!controller.signal.aborted) setPayload(body as Payload);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os dados do relatório.');
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 250);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [projectId, from, to, refreshKey, reload]);

  const brand = projectBrandFor(projectId, payload?.project.name ?? projectName, payload?.project.officialUrl ?? officialUrl);
  // Só monta o documento quando os dados correspondem ao período escolhido (evita rótulo de um período com dados de outro).
  const current = !!payload && payload.period.from === (from || null) && payload.period.to === (to || null);
  const doc = useMemo(() => payload && current ? buildReportDocument(payload, config, new Date(payload.generatedAt)) : null, [payload, config, current]);
  const busy = loading && !current;
  const saved = payload?.templates ?? [];
  const selectedSaved = templateKey.startsWith('saved:') ? saved.find(template => `saved:${template.id}` === templateKey) : undefined;
  const canSave = Boolean(payload?.permissions.canSaveTemplates);
  const referenceRows = payload?.sections.references.rows ?? [];
  const [openNotes, setOpenNotes] = useState<Set<ReportSectionId>>(() => new Set());
  const toggleNote = (id: ReportSectionId, open: boolean) => setOpenNotes(current => { const next = new Set(current); if (open) next.add(id); else next.delete(id); return next; });

  function update(change: Partial<ReportConfig>) { setConfig(current => ({ ...current, ...change })); }
  function setPeriod(period: ReportPeriod) { update({ period }); }
  function setSectionNote(id: ReportSectionId, text: string) { setConfig(current => ({ ...current, sectionNotes: { ...current.sectionNotes, [id]: text } })); }
  function toggleReference(url: string, include: boolean) {
    setConfig(current => ({ ...current, excludedReferences: include ? current.excludedReferences.filter(entry => entry !== url) : [...current.excludedReferences, url] }));
  }
  function toggle(id: ReportSectionId, on: boolean) { update({ sections: config.sections.map(section => section.id === id ? { ...section, on } : section) }); }
  function move(id: ReportSectionId, direction: -1 | 1) {
    const sections = [...config.sections], index = sections.findIndex(section => section.id === id), target = index + direction;
    if (target < 0 || target >= sections.length - 1 || id === 'references') return;
    [sections[index], sections[target]] = [sections[target], sections[index]];
    update({ sections });
    const title = REPORT_SECTIONS.find(section => section.id === id)!.title;
    setAnnouncement(`${title} agora é a ${target + 1}ª seção.`);
    window.requestAnimationFrame(() => {
      const same = sectionRefs.current.get(`${id}:${direction}`), other = sectionRefs.current.get(`${id}:${-direction}`);
      (same && !same.disabled ? same : other)?.focus();
    });
  }
  function applyTemplate(key: string) {
    setTemplateKey(key); setNaming(false); setConfirmDelete(false); setTemplateMessage(null);
    if (key.startsWith('starter:')) { const starter = starters.find(entry => `starter:${entry.name}` === key); if (starter) setConfig({ ...starter.config, notes: config.notes, sectionNotes: config.sectionNotes }); }
    else if (key.startsWith('saved:')) { const template = saved.find(entry => `saved:${entry.id}` === key); if (template) { setConfig(template.config); setOpenNotes(new Set()); } }
  }
  async function templateRequest(body: Record<string, unknown>, success: string) {
    setSaving(true); setTemplateMessage(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/report`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => null) as { templates?: Template[]; id?: string } | null;
      if (!response.ok || !result || !Array.isArray(result.templates)) throw new Error(errorMessage(result, 'Não foi possível salvar o modelo.'));
      const templates = result.templates;
      setPayload(current => current ? { ...current, templates } : current);
      setTemplateKey(result.id ? `saved:${result.id}` : '');
      setNaming(false); setConfirmDelete(false); setTemplateName('');
      setTemplateMessage({ tone: 'ok', text: success });
    } catch (cause) {
      setTemplateMessage({ tone: 'error', text: cause instanceof Error ? cause.message : 'Não foi possível salvar o modelo.' });
    } finally { setSaving(false); }
  }

  async function exportFile(format: DocumentFormat) {
    if (!doc) throw new Error('Espere a prévia terminar de carregar e tente de novo.');
    if (!doc.sections.length) throw new Error('Marque ao menos uma seção antes de baixar.');
    const blob = format === 'pdf' ? await (await import('./pdf')).toReportPdf(doc, { projectBrand: brand }) : format === 'docx' ? toReportDocx(doc) : toReportXlsx(doc);
    download(`relatorio-${slug(doc.projectName)}-${doc.generatedIso.slice(0, 10)}.${format}`, blob);
  }

  const order = config.sections;
  return <section className={`p-card ${styles.root}`} id="project-report" aria-labelledby="project-report-title">
    <header className={styles.masthead}>
      <span className={styles.kicker}>Relatório do projeto</span>
      <h3 id="project-report-title">Monte o relatório</h3>
      <p>Escolha as seções, a ordem, o período e as observações. A prévia mostra exatamente o que vai para a planilha, o documento e o PDF.</p>
      <a className={styles.jump} href="#project-report-output">Ver prévia e baixar <ArrowDown size={15} aria-hidden="true"/></a>
    </header>
    <div className={styles.layout}>
      <form className={styles.controls} onSubmit={event => event.preventDefault()} aria-label="Opções do relatório">
        <fieldset className={styles.group}>
          <legend>Modelo</legend>
          <label className="p-field"><span>Começar de</span>
            <select value={templateKey} onChange={event => applyTemplate(event.target.value)}>
              <option value="">Personalizado</option>
              <optgroup label="Sugestões">{starters.map(entry => <option key={entry.name} value={`starter:${entry.name}`}>{entry.name}</option>)}</optgroup>
              {saved.length > 0 && <optgroup label="Salvos neste projeto">{saved.map(entry => <option key={entry.id} value={`saved:${entry.id}`}>{entry.name}</option>)}</optgroup>}
            </select>
          </label>
          {canSave ? <div className={styles.templateActions}>
            {selectedSaved && !naming && <button type="button" className="p-button p-button-subtle" disabled={saving} onClick={() => void templateRequest({ action: 'save', id: selectedSaved.id, expectedVersion: selectedSaved.version, name: selectedSaved.name, config }, `Modelo “${selectedSaved.name}” atualizado.`)}><Save size={16} aria-hidden="true"/>Atualizar “{selectedSaved.name}”</button>}
            {!naming && <button type="button" className="p-button p-button-subtle" disabled={saving} onClick={() => { setNaming(true); setTemplateName(''); setTemplateMessage(null); }}><FilePlus2 size={16} aria-hidden="true"/>Salvar como novo modelo</button>}
            {selectedSaved && !naming && !confirmDelete && <button type="button" className="p-button p-button-subtle" disabled={saving} onClick={() => setConfirmDelete(true)}><Trash2 size={16} aria-hidden="true"/>Apagar</button>}
          </div> : <p className={styles.help}>Seu acesso permite usar os modelos salvos, mas não criar ou mudar modelos.</p>}
          {naming && <div className={styles.inlineForm}>
            <label className="p-field"><span>Nome do modelo</span><input value={templateName} maxLength={REPORT_TEMPLATE_NAME_LIMIT} placeholder="Ex.: Prestação mensal" autoFocus
              onKeyDown={event => { if (event.key === 'Escape') setNaming(false); if (event.key === 'Enter') { event.preventDefault(); if (templateName.trim()) void templateRequest({ action: 'save', name: templateName, config }, `Modelo “${templateName.trim()}” salvo.`); } }}
              onChange={event => setTemplateName(event.target.value)}/></label>
            <div className={styles.inlineActions}>
              <button type="button" className="p-button p-button-primary" disabled={saving || !templateName.trim()} onClick={() => void templateRequest({ action: 'save', name: templateName, config }, `Modelo “${templateName.trim()}” salvo.`)}>{saving && <LoaderCircle size={15} className="p-spin" aria-hidden="true"/>}Salvar modelo</button>
              <button type="button" className="p-button p-button-subtle" onClick={() => setNaming(false)}>Cancelar</button>
            </div>
            <p className={styles.help}>O modelo guarda seções, ordem, período, título e observações. Quem vê este projeto pode usá-lo.</p>
          </div>}
          {confirmDelete && selectedSaved && <div className="p-inline-confirm">
            <p>Apagar o modelo “{selectedSaved.name}”? Os relatórios já baixados não mudam.</p>
            <div className="p-inline"><button type="button" className="p-button p-button-danger" disabled={saving} onClick={() => void templateRequest({ action: 'delete', id: selectedSaved.id, expectedVersion: selectedSaved.version }, 'Modelo apagado.')}>Apagar modelo</button><button type="button" className="p-button p-button-subtle" onClick={() => setConfirmDelete(false)}>Cancelar</button></div>
          </div>}
          {templateMessage && <p className={templateMessage.tone === 'ok' ? styles.ok : 'p-inline-error'} role={templateMessage.tone === 'ok' ? 'status' : 'alert'}>{templateMessage.text}</p>}
        </fieldset>

        <fieldset className={styles.group}>
          <legend>Período</legend>
          <div className={styles.segmented} role="radiogroup" aria-label="Recorte de tempo">
            {([['all', 'Tudo'], ['month', 'Um mês'], ['range', 'Intervalo']] as const).map(([mode, label]) => <label key={mode} className={config.period.mode === mode ? styles.segmentActive : undefined}>
              <input type="radio" name={`report-period-${projectId}`} value={mode} checked={config.period.mode === mode}
                onChange={() => setPeriod(mode === 'all' ? { mode } : mode === 'month' ? { mode, month: today().slice(0, 7) } : { mode, from: `${today().slice(0, 7)}-01`, to: today() })}/>{label}
            </label>)}
          </div>
          {config.period.mode === 'month' && <label className="p-field"><span>Mês</span>
            <select value={config.period.month} onChange={event => setPeriod({ mode: 'month', month: event.target.value })}>
              {!months.some(month => month.value === (config.period as { month: string }).month) && <option value={config.period.month}>{config.period.month}</option>}
              {months.map(month => <option key={month.value} value={month.value}>{month.label}</option>)}
            </select></label>}
          {config.period.mode === 'range' && <div className={styles.dates}>
            <label className="p-field"><span>De</span><DateField aria-label="Data inicial do relatório" value={config.period.from} max={config.period.to} onValueChange={value => { if (value && config.period.mode === 'range') setPeriod({ mode: 'range', from: value, to: value > config.period.to ? value : config.period.to }); }}/></label>
            <label className="p-field"><span>Até</span><DateField aria-label="Data final do relatório" value={config.period.to} min={config.period.from} onValueChange={value => { if (value && config.period.mode === 'range') setPeriod({ mode: 'range', from: value < config.period.from ? value : config.period.from, to: value }); }}/></label>
          </div>}
          <p className={styles.help}>A ficha do projeto e o saldo dos materiais são sempre os de hoje. O resto segue o período escolhido.</p>
        </fieldset>

        <fieldset className={styles.group}>
          <legend>Capa</legend>
          <label className="p-field"><span>Título do relatório</span><textarea rows={2} className={styles.titleField} value={config.title} maxLength={REPORT_TITLE_LIMIT} placeholder="Relatório do projeto" onChange={event => update({ title: event.target.value.replace(/\s*\n\s*/g, ' ') })}/></label>
        </fieldset>

        <fieldset className={styles.group}>
          <legend>Seções e ordem</legend>
          <p className={styles.help}>Marque o que entra e use as setas para mudar a ordem. O balão abre uma observação da equipe no fim da seção.</p>
          <ol className={styles.sections}>
            {order.map((section, index) => {
              const meta = REPORT_SECTIONS.find(entry => entry.id === section.id)!;
              const blocked = payload ? !sectionAvailable(payload, section.id) : false, last = section.id === 'references', on = section.on && !blocked;
              const noteOpen = openNotes.has(section.id), note = config.sectionNotes[section.id] ?? '', canNote = on && section.id !== 'notes' && section.id !== 'references';
              const ids = `report-section-${projectId}-${section.id}`;
              return <li key={section.id} className={`${styles.sectionRow} ${on ? styles.sectionOn : ''}`}>
                <div className={styles.sectionHead}>
                  <label className={styles.sectionCheck}>
                    <input type="checkbox" checked={on} disabled={blocked} aria-labelledby={ids} aria-describedby={`${ids}-hint`} onChange={event => toggle(section.id, event.target.checked)}/>
                    <span><strong id={ids}>{meta.title}</strong><small id={`${ids}-hint`}>{blocked ? 'Seu acesso não inclui estes dados' : meta.hint}</small></span>
                  </label>
                  {last ? <span className={styles.pill}>Sempre no fim</span> : <span className={styles.moveButtons}>
                    {canNote && <button type="button" className={`p-icon-button ${note ? styles.noteFilled : ''}`} aria-expanded={noteOpen} aria-controls={`${ids}-note`} aria-label={`${note ? 'Editar' : 'Escrever'} observação em ${meta.title}`} onClick={() => toggleNote(section.id, !noteOpen)}><MessageSquarePlus size={16} aria-hidden="true"/></button>}
                    <button type="button" className="p-icon-button" ref={element => { sectionRefs.current.set(`${section.id}:-1`, element); }} disabled={index === 0} aria-label={`Subir ${meta.title}`} onClick={() => move(section.id, -1)}><ArrowUp size={16} aria-hidden="true"/></button>
                    <button type="button" className="p-icon-button" ref={element => { sectionRefs.current.set(`${section.id}:1`, element); }} disabled={index >= order.length - 2} aria-label={`Descer ${meta.title}`} onClick={() => move(section.id, 1)}><ArrowDown size={16} aria-hidden="true"/></button>
                  </span>}
                </div>
                {on && section.id === 'notes' && <label className={`p-field ${styles.sectionBody}`}><span>Texto das observações</span>
                  <textarea rows={5} value={config.notes} maxLength={REPORT_NOTES_LIMIT} placeholder="Contexto, resultados, justificativas e próximos passos. Deixe uma linha em branco entre parágrafos." onChange={event => update({ notes: event.target.value })}/>
                  <small>{config.notes.length.toLocaleString('pt-BR')} de {REPORT_NOTES_LIMIT.toLocaleString('pt-BR')} caracteres</small>
                </label>}
                {on && section.id === 'references' && <div className={styles.sectionBody}>
                  {referenceRows.length ? <ul className={styles.referencePicker} aria-label="Referências do relatório">
                    {referenceRows.map(row => { const url = String(row.url), type = REFERENCE_TYPE_LABEL[String(row.tipo) as keyof typeof REFERENCE_TYPE_LABEL] ?? 'Link'; return <li key={url}>
                      <label><input type="checkbox" checked={!config.excludedReferences.includes(url)} onChange={event => toggleReference(url, event.target.checked)}/><span><strong>{String(row.titulo)}</strong><small>{type} · {String(row.origem)}</small></span></label>
                    </li>; })}
                  </ul> : <p className={styles.help}>Nenhum link, planilha ou documento vinculado ainda.</p>}
                  {payload?.permissions.canAddReferences && onAddReference && <button type="button" className="p-button p-button-subtle" onClick={onAddReference}><FilePlus2 size={16} aria-hidden="true"/>Cadastrar link, planilha ou documento</button>}
                </div>}
                {on && section.id === 'timeline' && <div className={styles.sectionBody}>
                  <div className={styles.miniSegmented} role="radiogroup" aria-label="O que a linha do tempo mostra">
                    {([['milestones', 'Marcos'], ['all', 'Tudo']] as const).map(([mode, text]) => <label key={mode} className={config.timeline === mode ? styles.segmentActive : undefined}><input type="radio" name={`report-timeline-${projectId}`} checked={config.timeline === mode} onChange={() => update({ timeline: mode })}/>{text}</label>)}
                  </div>
                  <small className={styles.help}>{config.timeline === 'milestones' ? 'Agenda, cadastro, empréstimos e registros; demandas resumidas por mês.' : 'Inclui cada demanda criada e concluída.'}</small>
                </div>}
                {canNote && noteOpen && <div className={styles.sectionBody} id={`${ids}-note`}>
                  <label className="p-field"><span>Observação da equipe em {meta.title}</span>
                    <textarea rows={3} value={note} maxLength={REPORT_SECTION_NOTE_LIMIT} autoFocus placeholder="Aparece destacada no fim desta seção." onChange={event => setSectionNote(section.id, event.target.value)}/>
                  </label>
                  <div className={styles.inlineActions}>
                    <button type="button" className="p-button p-button-subtle" onClick={() => toggleNote(section.id, false)}>Pronto</button>
                    {note && <button type="button" className="p-button p-button-subtle" onClick={() => { setSectionNote(section.id, ''); toggleNote(section.id, false); }}><Trash2 size={15} aria-hidden="true"/>Remover observação</button>}
                  </div>
                </div>}
                {canNote && !noteOpen && note && <p className={styles.noteSnippet}>“{note.length > 90 ? `${note.slice(0, 90).trimEnd()}…` : note}”</p>}
              </li>;
            })}
          </ol>
          <p className={styles.srOnly} role="status" aria-live="polite">{announcement}</p>
        </fieldset>
      </form>

      <div className={styles.output} id="project-report-output" tabIndex={-1}>
        <div className={styles.exportBar}>
          <div>
            <h4>Baixar o relatório</h4>
            <p title={doc?.period}>{busy || (!doc && !error) ? 'Atualizando a prévia…' : doc ? `${doc.sections.length} ${doc.sections.length === 1 ? 'seção' : 'seções'} · ${doc.period}` : 'Prévia indisponível'}</p>
          </div>
          <ExportFormats label="Baixar relatório do projeto" disabled={!doc || !doc.sections.length} onExport={exportFile}/>
        </div>
        {doc && doc.unavailable.length > 0 && <p className={styles.notice}>Fora do relatório por falta de acesso: {doc.unavailable.join(', ')}.</p>}
        {error && <div className={styles.errorBox} role="alert"><p>{error}</p><button type="button" className="p-button p-button-subtle" onClick={() => setReload(value => value + 1)}><RefreshCw size={16} aria-hidden="true"/>Tentar de novo</button></div>}
        <div className={styles.previewFrame} aria-busy={busy}>
          {doc ? <><ReportPreview doc={doc} brand={brand}/><a className={styles.backToExport} href="#project-report-output">Baixar o relatório <ArrowUp size={15} aria-hidden="true"/></a></> : !error && <p className={styles.loadingBox}><LoaderCircle size={20} className="p-spin" aria-hidden="true"/>Carregando os dados do projeto…</p>}
        </div>
      </div>
    </div>
  </section>;
}
