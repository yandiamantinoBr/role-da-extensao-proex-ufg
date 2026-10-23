'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Camera, Check, ClipboardList, ExternalLink, FilePlus2, ImagePlus, LoaderCircle, Paperclip, Plus, RefreshCw, Search, Trash2, Upload } from 'lucide-react';

type Row = Record<string, unknown>;
type Kind = 'observation' | 'maintenance' | 'distribution' | 'consumption' | 'project' | 'material' | 'loan';
type Attachment = { id: string; name: string; mime: string; size: number };
type Entry = {
  id: string; project_id: string; kind: Kind; title: string; body: string; occurred_at: string;
  starts_at: string | null; ends_at: string | null; item_id: string | null; loan_id: string | null;
  attachments: Attachment[];
};
type Props = {
  projects: Row[]; items: Row[]; loans: Row[];
  canWrite?(capability: string, projectId: string): boolean;
};
type Filters = { projectId: string; from: string; to: string };
type UploadEntry = { key: string; file: File; status: 'pending' | 'sending' | 'done' | 'error' | 'uncertain'; uncertain: boolean; error?: string };
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const kinds: { value: Kind; label: string; capability: string }[] = [
  { value: 'observation', label: 'Observação geral', capability: 'campaigns.manage' },
  { value: 'maintenance', label: 'Manutenção e condição', capability: 'inventory.manage' },
  { value: 'distribution', label: 'Distribuição institucional', capability: 'inventory.manage' },
  { value: 'consumption', label: 'Consumo interno', capability: 'inventory.manage' },
  { value: 'project', label: 'Atividade do projeto', capability: 'campaigns.manage' },
  { value: 'material', label: 'Registro de material', capability: 'inventory.manage' },
  { value: 'loan', label: 'Registro de empréstimo', capability: 'loans.manage' },
];
const kindLabel = (kind: Kind) => kinds.find(value => value.value === kind)?.label ?? kind;
const text = (row: Row, key: string) => typeof row[key] === 'string' ? row[key] as string : '';
const noWrite = () => false;
function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(date) : 'Data indisponível';
}
function localNow(): string {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function toIso(value: string, label: string): string {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) throw new Error(`Informe uma data válida para ${label}.`);
  return date.toISOString();
}
function sizeLabel(size: number): string {
  return size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.ceil(size / 1024))} KB`;
}
class RequestFailure extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}
function confirmedRejection(error: unknown): boolean {
  return error instanceof RequestFailure && error.status !== undefined && [400, 401, 403, 404, 405, 413, 415, 422].includes(error.status);
}
async function requestJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const controller = new AbortController(), timeout = window.setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, { ...init, credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) throw new RequestFailure(typeof body?.error === 'string' ? body.error : 'Não foi possível concluir a solicitação.', response.status);
    if (!body) throw new RequestFailure('A resposta não pôde ser confirmada. Tente novamente.');
    return body;
  } catch (error) {
    if (error instanceof RequestFailure) throw error;
    throw new RequestFailure('A conexão não confirmou o envio. Verifique sua rede e tente novamente.');
  } finally { window.clearTimeout(timeout); }
}
function asEntry(value: unknown): Entry {
  if (!value || typeof value !== 'object') throw new Error('Atualize a consulta para recuperar os registros.');
  const entry = value as Entry;
  if (typeof entry.id !== 'string' || typeof entry.project_id !== 'string' || typeof entry.title !== 'string'
    || typeof entry.body !== 'string' || typeof entry.occurred_at !== 'string' || !kinds.some(kind => kind.value === entry.kind)
    || !Array.isArray(entry.attachments)) throw new Error('Atualize a consulta para recuperar os registros.');
  return entry;
}
function attachmentValue(value: unknown): Attachment {
  if (!value || typeof value !== 'object') throw new RequestFailure('O envio ainda não pôde ser confirmado. Tente novamente.');
  const attachment = value as Attachment;
  if (typeof attachment.id !== 'string' || typeof attachment.name !== 'string' || typeof attachment.mime !== 'string' || typeof attachment.size !== 'number') throw new RequestFailure('O envio ainda não pôde ser confirmado. Tente novamente.');
  return attachment;
}
function fileProblem(file: File): string | null {
  if (!file.size || file.size > MAX_FILE_BYTES) return `${file.name}: escolha um arquivo de até 10 MB, com conteúdo.`;
  const accepted = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
  if (!accepted.includes(file.type.toLowerCase()) && !((!file.type || file.type === 'application/octet-stream') && /\.(pdf|jpe?g|png|webp)$/i.test(file.name))) return `${file.name}: use PDF, JPEG, PNG ou WebP. Converta fotos HEIC antes de enviar.`;
  return null;
}

function AttachmentQueue({ recordId, onAttachment, onPendingChange }: {
  recordId: string; onAttachment(attachment: Attachment): void; onPendingChange?(pending: boolean): void;
}) {
  const [entries, setEntries] = useState<UploadEntry[]>([]), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const entriesRef = useRef<UploadEntry[]>([]), busyRef = useRef(false);
  const cameraRef = useRef<HTMLInputElement>(null), galleryRef = useRef<HTMLInputElement>(null);
  const pending = entries.some(entry => entry.status !== 'done');
  useEffect(() => {
    if (!pending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pending]);
  function update(next: UploadEntry[]) {
    entriesRef.current = next; setEntries(next); onPendingChange?.(next.some(entry => entry.status !== 'done'));
  }
  function choose(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []); event.target.value = '';
    if (busyRef.current) return;
    const next = [...entriesRef.current], problems: string[] = [];
    for (const file of files) {
      const problem = fileProblem(file);
      if (problem) { problems.push(problem); continue; }
      if (next.some(entry => entry.file.name === file.name && entry.file.size === file.size && entry.file.lastModified === file.lastModified && entry.file.type === file.type)) continue;
      next.push({ key: crypto.randomUUID(), file, status: 'pending', uncertain: false });
    }
    update(next); setError(problems.slice(0, 3).join(' ')); setMessage('');
  }
  async function upload() {
    if (busyRef.current || !entriesRef.current.some(entry => entry.status !== 'done')) return;
    busyRef.current = true; setBusy(true); setError(''); setMessage('');
    try {
      for (const entry of [...entriesRef.current]) {
        if (entry.status === 'done') continue;
        update(entriesRef.current.map(value => value.key === entry.key ? { ...value, status: 'sending', error: undefined } : value));
        try {
          const form = new FormData();
          form.set('recordId', recordId); form.set('operationKey', entry.key); form.set('file', entry.file);
          const result = await requestJson('/api/records', { method: 'POST', headers: { 'X-Proex-Action': '1' }, body: form });
          const attachment = attachmentValue(result.attachment);
          if (result.recordId !== recordId) throw new RequestFailure('O envio ainda não pôde ser confirmado. Tente novamente.');
          update(entriesRef.current.map(value => value.key === entry.key ? { ...value, status: 'done', uncertain: false, error: undefined } : value));
          onAttachment(attachment);
        } catch (cause) {
          const uncertain = entry.uncertain || !confirmedRejection(cause);
          const detail = cause instanceof Error ? cause.message : 'Não foi possível enviar o anexo.';
          update(entriesRef.current.map(value => value.key === entry.key ? { ...value, status: uncertain ? 'uncertain' : 'error', uncertain, error: detail } : value));
          setError(uncertain ? `${detail} Use “Tentar os envios pendentes” para confirmar o mesmo arquivo sem duplicá-lo.` : detail);
          return;
        }
      }
      setMessage('Todos os anexos desta seleção foram confirmados.');
    } finally { busyRef.current = false; setBusy(false); }
  }
  return <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
    <p className="p-form-help">Fotografe um termo ou escolha arquivos. PDF, JPEG, PNG e WebP, até 10 MB por arquivo. O acesso fica restrito às permissões do registro.</p>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button type="button" className="p-button p-button-subtle" disabled={busy} onClick={() => cameraRef.current?.click()}><Camera size={17} aria-hidden="true" />Usar câmera</button>
      <button type="button" className="p-button p-button-subtle" disabled={busy} onClick={() => galleryRef.current?.click()}><ImagePlus size={17} aria-hidden="true" />Galeria ou PDF</button>
    </div>
    <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={choose} />
    <input ref={galleryRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp" multiple hidden onChange={choose} />
    {!!entries.length && <ul style={{ padding: 0, margin: '14px 0', listStyle: 'none', display: 'grid', gap: 8 }} aria-label="Fila de anexos">
      {entries.map(entry => <li key={entry.key} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12, display: 'flex', gap: 10, alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}><strong style={{ fontSize: 14 }}>{entry.file.name}</strong><small style={{ display: 'block', color: 'var(--text-secondary)', marginTop: 4 }}>{sizeLabel(entry.file.size)} · {entry.status === 'done' ? 'Envio confirmado' : entry.status === 'sending' ? 'Enviando…' : entry.status === 'uncertain' ? 'Aguardando confirmação' : entry.status === 'error' ? 'Envio recusado' : 'Aguardando envio'}</small>{entry.error && <small style={{ display: 'block', color: 'var(--danger)', marginTop: 5 }}>{entry.error}</small>}{entry.uncertain && <small className="p-form-help" style={{ display: 'block' }}>Repita o envio nesta tela para confirmar se o arquivo foi salvo.</small>}</div>
        {entry.status === 'done' ? <Check size={19} aria-label="Confirmado" style={{ flexShrink: 0, color: 'var(--success-ink)' }} /> : entry.status === 'sending' ? <LoaderCircle size={19} className="p-spin" aria-label="Enviando" style={{ flexShrink: 0 }} /> : !entry.uncertain && <button type="button" className="p-button p-button-subtle" aria-label={`Remover ${entry.file.name} da seleção`} disabled={busy} onClick={() => { update(entriesRef.current.filter(value => value.key !== entry.key)); setError(''); }}><Trash2 size={16} /></button>}
      </li>)}
    </ul>}
    {pending && <button type="button" className="p-button p-button-primary" disabled={busy} onClick={() => void upload()}>{busy ? <LoaderCircle size={17} className="p-spin" /> : <Upload size={17} />}{busy ? 'Enviando anexos…' : entries.some(entry => entry.status === 'error' || entry.status === 'uncertain') ? 'Tentar os envios pendentes' : 'Enviar anexos selecionados'}</button>}
    {pending && <p className="p-form-help">Mantenha esta tela aberta até confirmar os envios. A seleção e a recuperação ficam neste aparelho enquanto esta tela estiver aberta; recarregar a página perde a fila.</p>}
    {error && <p className="p-inline-error" role="alert">{error}</p>}
    {message && <p role="status" style={{ color: 'var(--success-ink)' }}>{message}</p>}
  </div>;
}

export default function RecordsPanel({ projects: sourceProjects, items, loans, canWrite = noWrite }: Props) {
  const projects = useMemo(() => sourceProjects.filter(project => text(project, 'id') && text(project, 'name')).map(project => ({ id: text(project, 'id'), name: text(project, 'name') })), [sourceProjects]);
  const writableProjects = projects.filter(project => kinds.some(kind => canWrite(kind.capability, project.id)));
  const [records, setRecords] = useState<Entry[]>([]), [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true), [readError, setReadError] = useState(''), [reload, setReload] = useState(0);
  const [filterProject, setFilterProject] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState('');
  const [filters, setFilters] = useState<Filters>({ projectId: '', from: '', to: '' });
  const [category, setCategory] = useState(''), [search, setSearch] = useState('');
  const [open, setOpen] = useState(false), [projectId, setProjectId] = useState(''), [kind, setKind] = useState<Kind>('observation');
  const [title, setTitle] = useState(''), [body, setBody] = useState(''), [occurredAt, setOccurredAt] = useState('');
  const [hasInterval, setHasInterval] = useState(false), [startsAt, setStartsAt] = useState(''), [endsAt, setEndsAt] = useState('');
  const [itemId, setItemId] = useState(''), [loanId, setLoanId] = useState('');
  const [saving, setSaving] = useState(false), [unconfirmed, setUnconfirmed] = useState(false), [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState<Entry | null>(null), [savedPending, setSavedPending] = useState(false);
  const [attachmentPending, setAttachmentPending] = useState<Record<string, boolean>>({});
  const existingPending = Object.values(attachmentPending).some(Boolean);
  const savingRef = useRef(false), attempt = useRef<{ payload: Record<string, unknown>; uncertain: boolean } | null>(null);
  const query = useMemo(() => new URLSearchParams({ limit: '100', ...(filters.projectId ? { projectId: filters.projectId } : {}), ...(filters.from ? { from: filters.from } : {}), ...(filters.to ? { to: filters.to } : {}) }).toString(), [filters]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/records?${query}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal }).then(async response => {
      const result = await response.json() as { records?: unknown[]; truncated?: boolean; error?: string };
      if (!response.ok) throw new Error(result.error || 'Não foi possível consultar os registros.');
      if (!Array.isArray(result.records)) throw new Error('Não foi possível ler a lista de registros.');
      return { records: result.records.map(asEntry), truncated: result.truncated === true };
    }).then(result => {
      if (controller.signal.aborted) return;
      setRecords(result.records); setTruncated(result.truncated); setReadError(''); setLoading(false);
    }, (cause: unknown) => {
      if (controller.signal.aborted) return;
      setRecords([]); setTruncated(false); setReadError(cause instanceof Error ? cause.message : 'Não foi possível consultar os registros.'); setLoading(false);
    });
    return () => controller.abort();
  }, [query, reload]);
  useEffect(() => {
    if (!unconfirmed && !savedPending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unconfirmed, savedPending]);
  function refresh() {
    if (existingPending) return;
    setLoading(true); setReadError(''); setReload(value => value + 1);
  }
  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (existingPending) return;
    try {
      const start = from ? toIso(`${from}T00:00:00`, 'o início do período') : '';
      let end = '';
      if (to) { const next = new Date(`${to}T00:00:00`); next.setDate(next.getDate() + 1); end = toIso(next.toISOString(), 'o fim do período'); }
      if (start && end && end <= start) throw new Error('A data final deve ser igual ou posterior à inicial.');
      setLoading(true); setReadError(''); setFilters({ projectId: filterProject, from: start, to: end }); setReload(value => value + 1);
    } catch (cause) { setReadError(cause instanceof Error ? cause.message : 'Confira o período informado.'); }
  }
  function begin() {
    if (savingRef.current || unconfirmed || savedPending || existingPending || !writableProjects.length) return;
    const nextProject = writableProjects.find(project => project.id === filterProject)?.id ?? writableProjects[0].id;
    setProjectId(nextProject); setKind(kinds.find(value => canWrite(value.capability, nextProject))!.value);
    setTitle(''); setBody(''); setOccurredAt(localNow()); setHasInterval(false); setStartsAt(''); setEndsAt(''); setItemId(''); setLoanId('');
    setSaved(null); setSavedPending(false); setSaveError(''); setUnconfirmed(false); attempt.current = null; setOpen(true);
  }
  const allowedKinds = kinds.filter(value => canWrite(value.capability, projectId));
  const projectItems = items.filter(item => text(item, 'project_id') === projectId);
  const projectLoans = loans.filter(loan => text(loan, 'project_id') === projectId);
  const allowLoanLink = canWrite('loans.manage', projectId) && (kind === 'loan' || canWrite('campaigns.manage', projectId));
  function changeProject(id: string) {
    setProjectId(id); setItemId(''); setLoanId('');
    if (!kinds.some(value => value.value === kind && canWrite(value.capability, id))) setKind(kinds.find(value => canWrite(value.capability, id))?.value ?? 'observation');
  }
  function changeKind(value: Kind) {
    setKind(value);
    if (!(canWrite('loans.manage', projectId) && (value === 'loan' || canWrite('campaigns.manage', projectId)))) setLoanId('');
  }
  function canAttach(record: Entry): boolean {
    const capability = kinds.find(value => value.value === record.kind)?.capability;
    return !!capability && canWrite(capability, record.project_id) && (!record.loan_id || record.kind === 'loan' || (canWrite('loans.manage', record.project_id) && canWrite('campaigns.manage', record.project_id)));
  }
  function attach(recordId: string, attachment: Attachment) {
    const update = (record: Entry): Entry => record.id !== recordId ? record : { ...record, attachments: [...record.attachments.filter(value => value.id !== attachment.id), attachment] };
    setRecords(current => current.map(update)); setSaved(current => current ? update(current) : current);
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current || saved) return;
    setSaveError('');
    if (existingPending) { setSaveError('Confirme os anexos pendentes na lista antes de criar o registro.'); return; }
    if (!attempt.current) {
      try {
        if (!allowedKinds.some(value => value.value === kind)) throw new Error('Escolha um projeto e uma categoria que você possa administrar.');
        const occurrence = toIso(occurredAt, 'a ocorrência');
        const start = hasInterval ? toIso(startsAt, 'o início da atividade') : null, end = hasInterval ? toIso(endsAt, 'o fim da atividade') : null;
        if (start && end && end < start) throw new Error('O fim da atividade deve ocorrer no mesmo horário ou depois do início.');
        attempt.current = { uncertain: false, payload: { action: 'create', operationKey: crypto.randomUUID(), projectId, kind, title, body, occurredAt: occurrence, startsAt: start, endsAt: end, itemId: itemId || null, loanId: allowLoanLink ? loanId || null : null } };
      } catch (cause) { setSaveError(cause instanceof Error ? cause.message : 'Confira o formulário.'); return; }
    }
    savingRef.current = true; setSaving(true); setUnconfirmed(true);
    const currentAttempt = attempt.current;
    try {
      const result = await requestJson('/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify(currentAttempt.payload) });
      const record = asEntry(result.record);
      if (record.id !== result.id) throw new RequestFailure('A confirmação do registro não pôde ser lida. Tente novamente.');
      setSaved(record); setUnconfirmed(false); attempt.current = null; refresh();
    } catch (cause) {
      const uncertain = currentAttempt.uncertain || !confirmedRejection(cause);
      currentAttempt.uncertain = uncertain;
      if (!uncertain) { attempt.current = null; setUnconfirmed(false); }
      const detail = cause instanceof Error ? cause.message : 'Não foi possível salvar o registro.';
      setSaveError(uncertain ? `${detail} Os dados foram preservados. Confirme o mesmo registro pelo botão abaixo, sem criar outra cópia.` : detail);
    } finally { savingRef.current = false; setSaving(false); }
  }
  const normalizedSearch = search.trim().toLocaleLowerCase('pt-BR');
  const shown = records.filter(record => (!category || record.kind === category) && (!normalizedSearch || `${record.title} ${record.body}`.toLocaleLowerCase('pt-BR').includes(normalizedSearch)));
  const projectName = (id: string) => projects.find(project => project.id === id)?.name ?? 'Projeto';
  const itemName = (id: string | null) => { const item = items.find(value => text(value, 'id') === id); return item ? text(item, 'name') : ''; };
  function entryDetails(record: Entry) {
    return <>
      <p className="p-form-help" style={{ margin: '6px 0' }}>{projectName(record.project_id)} · {dateTime(record.occurred_at)} (Brasília)</p>
      {record.body && <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.6 }}>{record.body}</p>}
      {(record.starts_at || record.item_id || record.loan_id) && <dl style={{ margin: '12px 0', fontSize: 13, display: 'grid', gap: 8 }}>
        {record.starts_at && record.ends_at && <div><dt style={{ fontWeight: 700 }}>Período da atividade</dt><dd style={{ margin: '3px 0 0' }}>{dateTime(record.starts_at)} → {dateTime(record.ends_at)} (Brasília)</dd></div>}
        {record.item_id && <div><dt style={{ fontWeight: 700 }}>Material vinculado</dt><dd style={{ margin: '3px 0 0' }}>{itemName(record.item_id) || 'Material do projeto'}</dd></div>}
        {record.loan_id && <div><dt style={{ fontWeight: 700 }}>Empréstimo vinculado</dt><dd style={{ margin: '3px 0 0', overflowWrap: 'anywhere' }}>#{record.loan_id}</dd></div>}
      </dl>}
      {!!record.attachments.length && <ul style={{ listStyle: 'none', margin: '14px 0 0', padding: 0, display: 'grid', gap: 8 }} aria-label={`Anexos de ${record.title}`}>
        {record.attachments.map(attachment => <li key={attachment.id}><a className="p-text-link" href={`/api/records/files/${encodeURIComponent(attachment.id)}`} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, overflowWrap: 'anywhere', minHeight: 36 }}><Paperclip size={15} style={{ flexShrink: 0 }} aria-hidden="true" /><span>{attachment.name} <small>({sizeLabel(attachment.size)})</small></span><ExternalLink size={13} style={{ flexShrink: 0 }} aria-hidden="true" /><span className="sr-only"> — abre em nova aba ou baixa o arquivo</span></a></li>)}
      </ul>}
    </>;
  }

  return <div style={{ display: 'grid', gap: 20 }}>
    <section className="p-card" aria-labelledby="records-title">
      <div className="p-row-between" style={{ gap: 16, flexWrap: 'wrap', marginBottom: 20 }}><div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><span className="p-icon-tile"><ClipboardList size={22} aria-hidden="true" /></span><div><h2 id="records-title" style={{ margin: '0 0 5px', fontSize: 21 }}>Registros e documentos</h2><p className="p-form-help" style={{ margin: 0 }}>Histórico dos projetos, materiais e empréstimos, com anexos privados.</p></div></div>{!!writableProjects.length && !open && <button type="button" className="p-button p-button-primary" onClick={begin} disabled={existingPending}><Plus size={17} />Novo registro</button>}</div>
      <form onSubmit={applyFilters}>
        <div className="p-form-grid">
          <label className="p-field"><span>Projeto</span><select value={filterProject} onChange={event => setFilterProject(event.target.value)}><option value="">Todos os projetos permitidos</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          <label className="p-field"><span>Data inicial</span><input type="date" min="2000-01-01" max="2200-12-31" value={from} onChange={event => setFrom(event.target.value)} /></label>
          <label className="p-field"><span>Data final (inclusive)</span><input type="date" min={from || '2000-01-01'} max="2200-12-31" value={to} onChange={event => setTo(event.target.value)} /></label>
        </div>
        <p className="p-form-help">O filtro por dias e o formulário usam o fuso deste aparelho. As datas da lista aparecem no horário de Brasília.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button type="submit" className="p-button p-button-primary" disabled={loading || existingPending}><Search size={16} />Consultar período</button><button type="button" className="p-button p-button-subtle" disabled={loading || existingPending} onClick={refresh}><RefreshCw size={16} />Atualizar consulta</button></div>
        {existingPending && <p role="status" className="p-form-help">Confirme os anexos na lista antes de consultar outro período ou criar um novo registro.</p>}
      </form>
      {readError && <p className="p-inline-error" role="alert">{readError}</p>}
    </section>

    {open && <section className="p-card" aria-labelledby="record-create-title">
      <div className="p-row-between" style={{ flexWrap: 'wrap', gap: 12, marginBottom: 16 }}><h3 id="record-create-title" style={{ margin: 0 }}>{saved ? 'Registro salvo · adicionar anexos' : '1. Criar registro'}</h3>{!unconfirmed && !saving && !savedPending && <button type="button" className="p-button p-button-subtle" onClick={() => { setOpen(false); setSaved(null); setSaveError(''); }}>{saved ? 'Concluir' : 'Fechar formulário'}</button>}</div>
      {saved ? <div>
        <p role="status" style={{ color: 'var(--success-ink)', display: 'flex', alignItems: 'center', gap: 8 }}><Check size={18} aria-hidden="true" />Registro confirmado. Os anexos são enviados na próxima etapa.</p>
        <span className="p-badge">{kindLabel(saved.kind)}</span><h4 style={{ margin: '10px 0 0', overflowWrap: 'anywhere' }}>{saved.title}</h4>{entryDetails(saved)}
        {canAttach(saved) && <AttachmentQueue key={saved.id} recordId={saved.id} onAttachment={attachment => attach(saved.id, attachment)} onPendingChange={setSavedPending} />}
        <div style={{ marginTop: 20 }}><button type="button" className="p-button p-button-subtle" disabled={savedPending || existingPending} onClick={begin}><FilePlus2 size={17} />Criar outro registro</button>{savedPending && <p className="p-form-help">Confirme os anexos pendentes ou remova da seleção os arquivos que ainda não foram enviados.</p>}</div>
      </div> : <form className="p-form" onSubmit={create}>
        <p className="p-form-help">Descreva a ocorrência e salve. Depois, anexe fotos ou documentos ao registro confirmado. Este histórico não movimenta estoque nem altera reservas.</p>
        <fieldset disabled={saving || unconfirmed}>
          <div className="p-form-grid"><label className="p-field"><span>Projeto</span><select required value={projectId} onChange={event => changeProject(event.target.value)}>{writableProjects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label className="p-field"><span>Categoria</span><select required value={kind} onChange={event => changeKind(event.target.value as Kind)}>{allowedKinds.map(value => <option key={value.value} value={value.value}>{value.label}</option>)}</select></label></div>
          <label className="p-field"><span>Título</span><input required maxLength={160} value={title} onChange={event => setTitle(event.target.value)} placeholder="Ex.: devolução e conferência da caixa de som" /></label>
          <label className="p-field"><span>Descrição e observações</span><textarea rows={5} maxLength={6000} value={body} onChange={event => setBody(event.target.value)} placeholder="Registre apenas as informações necessárias para a equipe." /></label>
          <label className="p-field"><span>Data e hora da ocorrência</span><input type="datetime-local" required min="2000-01-01T00:00" max="2200-12-31T23:59" value={occurredAt} onChange={event => setOccurredAt(event.target.value)} /></label>
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', minHeight: 44 }}><input type="checkbox" checked={hasInterval} onChange={event => setHasInterval(event.target.checked)} />Informar período de uma atividade</label>
          {hasInterval && <div className="p-form-grid"><label className="p-field"><span>Início da atividade</span><input type="datetime-local" required min="2000-01-01T00:00" max="2200-12-31T23:59" value={startsAt} onChange={event => setStartsAt(event.target.value)} /></label><label className="p-field"><span>Fim da atividade</span><input type="datetime-local" required min={startsAt || '2000-01-01T00:00'} max="2200-12-31T23:59" value={endsAt} onChange={event => setEndsAt(event.target.value)} /></label></div>}
          <div className="p-form-grid"><label className="p-field"><span>Material vinculado (opcional)</span><select value={itemId} disabled={!!loanId} onChange={event => setItemId(event.target.value)}><option value="">Sem vínculo com material</option>{projectItems.map(item => <option key={text(item, 'id')} value={text(item, 'id')}>{text(item, 'name') || 'Material'}</option>)}</select></label>{allowLoanLink && <label className="p-field"><span>Empréstimo vinculado (opcional)</span><select value={loanId} onChange={event => { const selected = projectLoans.find(loan => text(loan, 'id') === event.target.value); setLoanId(event.target.value); if (selected) setItemId(text(selected, 'item_id')); }}><option value="">Sem vínculo com empréstimo</option>{projectLoans.map(loan => <option key={text(loan, 'id')} value={text(loan, 'id')}>{itemName(text(loan, 'item_id')) || 'Equipamento'} · {text(loan, 'starts_at') ? dateTime(text(loan, 'starts_at')) : `#${text(loan, 'id').slice(0, 12)}`}</option>)}</select></label>}</div>
        </fieldset>
        {unconfirmed && <p role="status" className="p-form-help">{saving ? 'Enviando o registro…' : 'A confirmação está pendente. O próximo envio repete os mesmos dados e a mesma operação.'} Mantenha esta tela aberta para recuperar a confirmação.</p>}
        {saveError && <p className="p-inline-error" role="alert">{saveError}</p>}
        <div className="p-form-footer"><button type="submit" className="p-button p-button-primary" disabled={saving || existingPending}>{saving ? <LoaderCircle size={17} className="p-spin" /> : unconfirmed ? <RefreshCw size={17} /> : <Check size={17} />}{saving ? 'Confirmando registro…' : unconfirmed ? 'Confirmar o mesmo registro' : 'Salvar registro e continuar'}</button></div>
      </form>}
    </section>}

    <section className="p-card" aria-labelledby="records-list-title" aria-busy={loading}>
      <div className="p-row-between" style={{ gap: 12, flexWrap: 'wrap', marginBottom: 18 }}><div><h3 id="records-list-title" style={{ margin: '0 0 6px' }}>Histórico consultado</h3><p className="p-form-help" style={{ margin: 0 }}>{loading ? 'Consultando registros…' : `${shown.length} de ${records.length} registros carregados`}</p></div></div>
      <div className="p-form-grid" style={{ marginBottom: 16 }}><label className="p-field"><span>Categoria nos resultados</span><select value={category} disabled={existingPending} onChange={event => setCategory(event.target.value)}><option value="">Todas as categorias</option>{kinds.map(value => <option key={value.value} value={value.value}>{value.label}</option>)}</select></label><label className="p-field"><span>Buscar no título e na descrição carregados</span><input type="search" value={search} disabled={existingPending} onChange={event => setSearch(event.target.value)} placeholder="Digite uma palavra" /></label></div>
      {truncated && <p role="status" className="p-form-help" style={{ borderLeft: '3px solid var(--brand-ink)', paddingLeft: 12 }}>Há mais registros neste período. A consulta mostra até 100; restrinja o projeto ou as datas para encontrar os demais. A busca e a categoria filtram somente os resultados carregados.</p>}
      {loading ? <p role="status" className="p-form-help"><LoaderCircle size={18} className="p-spin" style={{ verticalAlign: 'middle', marginRight: 8 }} />Carregando histórico…</p> : readError ? <p className="p-form-help">Corrija a consulta ou tente atualizar para recuperar o histórico.</p> : !shown.length ? <div className="p-empty"><ClipboardList size={28} aria-hidden="true" /><p>Nenhum registro encontrado nos filtros e acessos atuais.</p></div> : <div style={{ display: 'grid', gap: 14 }}>{shown.map(record => <article key={record.id} style={{ border: '1px solid var(--line)', borderRadius: 16, padding: 'clamp(14px,3vw,22px)', background: 'var(--surface-soft)' }}><span className="p-badge">{kindLabel(record.kind)}</span><h4 style={{ margin: '10px 0 0', fontSize: 17, overflowWrap: 'anywhere' }}>{record.title}</h4>{entryDetails(record)}{canAttach(record) && record.id !== saved?.id && <details style={{ marginTop: 16 }}><summary style={{ cursor: 'pointer', color: 'var(--brand-ink)', minHeight: 44, display: 'flex', alignItems: 'center', gap: 8 }}><Paperclip size={16} aria-hidden="true" />Adicionar documentos ou fotos</summary><AttachmentQueue recordId={record.id} onAttachment={attachment => attach(record.id, attachment)} onPendingChange={pending => setAttachmentPending(current => ({ ...current, [record.id]: pending }))} /></details>}</article>)}</div>}
      <p className="p-form-help" style={{ marginBottom: 0, marginTop: 20 }}>Os documentos abrem com sua sessão e permissões atuais. Evite dados pessoais desnecessários nas descrições e nos anexos.</p>
    </section>
  </div>;
}
