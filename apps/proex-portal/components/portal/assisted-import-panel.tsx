'use client';
import { useRef, useState, type ChangeEvent } from 'react';
import { Camera, Check, FileInput, LoaderCircle, Paperclip, X } from 'lucide-react';
import { importFields, IMPORT_TEXT_LIMIT, type ImportKind, type ImportPreview } from '@/lib/importer/contracts';
import { validateImportedFields } from '@/lib/importer/parse';
import { MAX_UPLOAD_FILE_BYTES, UPLOAD_LIMIT_LABEL, uploadErrorMessage } from '@/lib/upload-limits';
import styles from './assisted-import-panel.module.css';

type Project = { id: string; name: string; version?: number };
type Item = { id: string; name: string; project_id: string; asset_code?: string };
type Option = { id: string; name?: string; label?: string; acronym?: string; status?: string };
export type AssistedImportProps = {
  kind: ImportKind; projects: Project[]; projectTypes?: Option[]; organizationalUnits?: Option[]; items?: Item[];
  canCreateProject?: boolean; canWrite: (projectId: string) => boolean;
  defaultProjectId?: string; onImported?: (projectId: string) => void | Promise<void>;
};
type Receipt = { projectId: string; itemId?: string; recordId: string };
type PendingFile = { key: string; file: File; sent: boolean; error?: string };
async function post(input: Record<string, unknown> | FormData, url = '/api/imports'): Promise<Record<string, unknown>> {
  const controller = new AbortController(), timer = window.setTimeout(() => controller.abort(), 30000);
  try {
    const multipart = input instanceof FormData;
    const response = await fetch(url, { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal, headers: { ...(!multipart ? { 'Content-Type': 'application/json' } : {}), 'X-Proex-Action': '1' }, body: multipart ? input : JSON.stringify(input) });
    const data = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || !data) throw new Error(typeof data?.error === 'string' ? data.error : 'Não foi possível confirmar a resposta. Repita a mesma operação.');
    return data;
  } catch (error) { if (error instanceof Error && error.name === 'AbortError') throw new Error('A resposta demorou. Repita a mesma operação para conferir o resultado.'); throw error; }
  finally { window.clearTimeout(timer); }
}
const message = (error: unknown) => error instanceof Error ? error.message : 'Não foi possível concluir. Tente novamente.';

export default function AssistedImportPanel({ kind, projects, projectTypes = [], organizationalUnits = [], items = [], canCreateProject = false, canWrite, defaultProjectId, onImported }: AssistedImportProps) {
  const permitted = projects.filter(project => canWrite(project.id));
  const [open, setOpen] = useState(false), [projectId, setProjectId] = useState(defaultProjectId ?? (kind === 'asset' || !canCreateProject ? permitted[0]?.id ?? '' : ''));
  const [itemId, setItemId] = useState(''), [sourceMode, setSourceMode] = useState(kind === 'project' ? 'sigaa' : 'manual');
  const [format, setFormat] = useState('text'), [sourceUrl, setSourceUrl] = useState(''), [content, setContent] = useState('');
  const [sourceFile, setSourceFile] = useState<File | null>(null), [edits, setEdits] = useState<Record<string, string>>({}), [showMissing, setShowMissing] = useState(false);
  const [manual, setManual] = useState<Record<string, string>>({}), [preview, setPreview] = useState<ImportPreview | null>(null), [candidateIndex, setCandidateIndex] = useState(0);
  const [selected, setSelected] = useState<string[]>([]), [unitId, setUnitId] = useState(''), [typeId, setTypeId] = useState(''), [saveOfficialUrl, setSaveOfficialUrl] = useState(false);
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [receipt, setReceipt] = useState<Receipt | null>(null);
  const [files, setFiles] = useState<PendingFile[]>([]), operation = useRef<string | null>(null);
  const [readingFile, setReadingFile] = useState(false), fileReadEpoch = useRef(0);
  const inputId = `import-${kind}`, candidate = preview?.candidates[candidateIndex];
  const editableFields = { ...candidate?.fields, ...edits }, checkedFields = candidate ? validateImportedFields(kind, editableFields) : null;
  const problems: Record<string, string> = { ...checkedFields?.problems, ...(candidate && !editableFields.name ? { name: 'Informe o nome ou título antes de selecionar este campo.' } : {}) };
  const validDestination = projectId ? permitted.some(project => project.id === projectId) : kind === 'project' && canCreateProject;
  const available = kind === 'project' ? canCreateProject || permitted.length > 0 : permitted.length > 0;
  const contextDiffers = defaultProjectId !== undefined && defaultProjectId !== projectId;
  if (!available) return null;
  function resetReview() { setPreview(null); setReceipt(null); setConfirmed(false); setError(''); setEdits({}); setShowMissing(false); operation.current = null; }
  function chooseCandidate(next: ImportPreview, index: number) {
    const row = next.candidates[index]; setCandidateIndex(index); setSelected(importFields(kind).filter(field => row.fields[field.key] && !row.problems[field.key]).map(field => field.key));
    setUnitId(row.suggestedUnitId ?? ''); setTypeId(row.suggestedTypeId ?? ''); setConfirmed(false); setEdits({}); setShowMissing(false); operation.current = null;
  }
  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (!file) return;
    const epoch = ++fileReadEpoch.current;
    resetReview(); setSourceFile(null); setContent(''); setReadingFile(true);
    try {
      const extension = file.name.split('.').pop()?.toLowerCase(), binary = extension === 'pdf' || extension === 'docx', next = extension === 'json' ? 'json' : ['csv', 'tsv'].includes(extension ?? '') ? 'csv' : ['html', 'htm'].includes(extension ?? '') ? 'html' : extension === 'txt' || binary ? 'text' : null;
      if (file.size > (binary ? MAX_UPLOAD_FILE_BYTES : IMPORT_TEXT_LIMIT)) throw new Error(binary ? `Use um documento de até ${UPLOAD_LIMIT_LABEL}.` : 'Use um documento textual de até 256 KiB.');
      if (!next) throw new Error('Use PDF, DOCX, TXT, HTML, JSON ou CSV.');
      const nextContent = binary ? '' : await file.text();
      if (epoch !== fileReadEpoch.current) return;
      setSourceFile(file); setContent(nextContent); setFormat(next);
    } catch (error) { if (epoch === fileReadEpoch.current) setError(error instanceof Error ? error.message : 'Não foi possível ler este arquivo.'); }
    finally { if (epoch === fileReadEpoch.current) setReadingFile(false); }
  }
  async function prepare() {
    if (busy || readingFile) return;
    if (sourceMode === 'document' && !sourceFile && !content.trim()) { setError('Selecione um documento válido ou informe o conteúdo antes de preparar a prévia.'); return; }
    setBusy(true); setError(''); setConfirmed(false); operation.current = null;
    try {
      let value: Record<string, unknown>;
      if (sourceMode === 'document' && sourceFile) {
        const body = new FormData(); body.set('file', sourceFile); body.set('kind', kind); body.set('projectId', projectId); body.set('itemId', kind === 'asset' ? itemId : ''); body.set('sourceUrl', sourceUrl);
        if (sourceFile.name.toLowerCase().endsWith('.pdf')) { const { extractPdfText } = await import('./import-pdf-text'); const extracted = await extractPdfText(sourceFile); body.set('extractedText', extracted.text); body.set('pageCount', String(extracted.pageCount)); }
        value = await post(body, '/api/imports/document');
      } else value = await post({ action: 'preview', kind, projectId, itemId: kind === 'asset' ? itemId : '', sourceMode, sourceUrl, format, content: sourceMode === 'manual' ? JSON.stringify(manual) : content });
      if (typeof value.reviewToken !== 'string' || !Array.isArray(value.candidates) || !value.candidates.length) throw new Error('A prévia não pôde ser confirmada.');
      const next = value as ImportPreview; setPreview(next); chooseCandidate(next, 0); setSaveOfficialUrl(!projectId && !!next.provenance.url);
    } catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  async function apply() {
    if (!preview || !candidate || !confirmed || busy) return;
    setBusy(true); setError(''); operation.current ??= crypto.randomUUID();
    try {
      const value = await post({ action: 'apply', reviewToken: preview.reviewToken, candidateKey: candidate.key, selectedFields: selected, edits, unitId, typeId, saveOfficialUrl, confirmed: true, operationKey: operation.current });
      if (typeof value.projectId !== 'string' || typeof value.recordId !== 'string') throw new Error('A confirmação ficou incompleta. Repita a mesma operação.');
      setReceipt(value as Receipt);
    } catch (error) { setError(`${message(error)} Se a conexão falhou, repita sem alterar a seleção para conferir uma gravação que possa já ter ocorrido.`); } finally { setBusy(false); }
  }
  function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; setError('');
    if (files.length + chosen.length > 10) { setError('Envie até dez arquivos por conferência. Outros arquivos podem ser enviados em Registros.'); return; }
    const invalid = chosen.find(file => !['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > MAX_UPLOAD_FILE_BYTES);
    if (invalid) { setError(`Use fotos PNG, JPEG, WebP ou PDF de até ${UPLOAD_LIMIT_LABEL} por arquivo.`); return; }
    setFiles(previous => [...previous, ...chosen.map(file => ({ key: crypto.randomUUID(), file, sent: false }))]);
  }
  async function sendFiles() {
    if (!receipt || busy) return; setBusy(true); setError('');
    try {
      for (const entry of files.filter(file => !file.sent)) {
        const controller = new AbortController(), timer = window.setTimeout(() => controller.abort(), 30000);
        try {
          const body = new FormData(); body.set('recordId', receipt.recordId); body.set('operationKey', entry.key); body.set('file', entry.file);
          const response = await fetch('/api/records', { method: 'POST', credentials: 'same-origin', signal: controller.signal, headers: { 'X-Proex-Action': '1' }, body });
          const result = await response.json().catch(() => null) as Record<string, unknown> | null, attachment = result?.attachment as Record<string, unknown> | undefined;
          if (!response.ok || typeof attachment?.id !== 'string') throw new Error(uploadErrorMessage(response.status, result?.error, 'O envio não foi confirmado. Tente novamente com o mesmo arquivo.'));
          setFiles(previous => previous.map(file => file.key === entry.key ? { ...file, sent: true, error: undefined } : file));
        } catch (error) { setFiles(previous => previous.map(file => file.key === entry.key ? { ...file, error: message(error) } : file)); }
        finally { window.clearTimeout(timer); }
      }
    } finally { setBusy(false); }
  }
  async function finish() {
    if (!receipt || busy) return; setBusy(true);
    try { await onImported?.(receipt.projectId); setOpen(false); resetReview(); setFiles([]); }
    catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  const name = kind === 'project' ? 'projeto' : 'bem patrimonial';
  return <section className={`p-card ${styles.panel}`}>
    <div className="p-row-between"><div><h3><FileInput size={19}/> Importar {name}</h3><p className="p-form-help">Confira dados e fonte antes de salvar. {kind === 'asset' ? 'Fotos e documentos ficam no registro privado do bem.' : 'A fonte pública não cria contas nem concede acesso.'}</p></div><button type="button" className="p-button p-button-subtle" disabled={busy || !!receipt} onClick={() => { setOpen(value => !value); setError(''); }}>{open ? <X size={16}/> : <FileInput size={16}/>}<span>{open ? 'Fechar' : 'Abrir importação'}</span></button></div>
    {open && <div className={styles.body}>
      {!receipt && <>
        {contextDiffers && <p className="p-form-help" role="status">O filtro geral mostra {defaultProjectId ? projects.find(project => project.id === defaultProjectId)?.name ?? 'outro projeto' : 'todos os projetos'}. Esta importação continua destinada a <strong>{projectId ? projects.find(project => project.id === projectId)?.name ?? 'projeto selecionado' : 'novo projeto'}</strong>. A prévia e os arquivos foram preservados; confira o destino antes de confirmar.</p>}
        {!preview ? <fieldset disabled={busy || readingFile} className={styles.fieldset}>
          <div className="p-form-grid"><label className="p-field"><span>{kind === 'project' ? 'Destino dos dados' : 'Projeto responsável'}</span><select value={projectId} onChange={event => { setProjectId(event.target.value); setItemId(''); resetReview(); }}>{kind === 'project' && canCreateProject && <option value="">Criar novo projeto</option>}{permitted.map(project => <option key={project.id} value={project.id}>{kind === 'project' ? 'Atualizar: ' : ''}{project.name}</option>)}</select></label>
          {kind === 'asset' && <label className="p-field"><span>Cadastro do bem</span><select value={itemId} onChange={event => { setItemId(event.target.value); resetReview(); }}><option value="">Cadastrar novo equipamento individual</option>{items.filter(item => item.project_id === projectId).map(item => <option key={item.id} value={item.id}>Conferência e anexos: {item.name}{item.asset_code ? ` · ${item.asset_code}` : ''}</option>)}</select></label>}
          <label className="p-field"><span>Fonte dos dados</span><select value={sourceMode} onChange={event => { setSourceMode(event.target.value); setSourceFile(null); setSourceUrl(''); resetReview(); }}>{kind === 'project' && <option value="sigaa">SIGAA Público / UFG</option>}{kind === 'asset' && <option value="manual">Preencher dados do bem</option>}<option value="document">Arquivo ou documento textual</option></select></label></div>
          {sourceMode === 'sigaa' ? <label className="p-field"><span>Número da ação ou link público do SIGAA/UFG</span><input value={sourceUrl} maxLength={500} onChange={event => setSourceUrl(event.target.value)} placeholder="Número da ação ou link público"/><small>A consulta lê uma ação. Caso o sistema exija verificação humana, use o documento textual.</small></label> : sourceMode === 'manual' ? <div className="p-form-grid">{importFields('asset').map(field => <label className="p-field" key={field.key}><span>{field.label}{field.metadata ? ' · registro de conferência' : ''}</span>{field.key === 'description' ? <textarea rows={3} maxLength={field.maximum} value={manual[field.key] ?? ''} onChange={event => setManual(previous => ({ ...previous, [field.key]: event.target.value }))}/> : <input value={manual[field.key] ?? ''} maxLength={field.maximum} onChange={event => setManual(previous => ({ ...previous, [field.key]: event.target.value }))}/>}</label>)}</div> : <>
            <label className="p-field"><span>Documento · PDF/DOCX até {UPLOAD_LIMIT_LABEL}; texto até 256 KiB</span><input type="file" accept=".pdf,.docx,.txt,.html,.htm,.json,.csv,.tsv" onChange={event => void readFile(event)}/>{sourceFile && <small>Selecionado: {sourceFile.name}</small>}</label>
            {sourceFile && /\.(?:pdf|docx)$/i.test(sourceFile.name) ? <p className="p-form-help">O texto será extraído para a prévia. PDF: até cinquenta páginas com texto selecionável. Revise e complete os campos que não forem identificados; imagens e documentos digitalizados não passam por OCR.</p> : <><label className="p-field"><span>Formato do texto</span><select value={format} onChange={event => { setFormat(event.target.value); setSourceFile(null); }}><option value="text">Texto com campos identificados</option><option value="html">HTML salvo da consulta</option><option value="json">JSON</option><option value="csv">CSV / TSV</option></select></label><label className="p-field"><span>Conteúdo do documento</span><textarea rows={8} maxLength={IMPORT_TEXT_LIMIT} value={content} onChange={event => { setContent(event.target.value); setSourceFile(null); }} placeholder={kind === 'project' ? 'Título: Projeto de demonstração\nÁrea temática: Comunicação\nUnidade proponente: PROEX' : 'Nome: Equipamento de demonstração\nTombamento: 000123\nMarca: Marca informada'}/></label></>}
            <label className="p-field"><span>Link de referência do documento · opcional</span><input type="url" maxLength={500} value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} placeholder="https://..."/></label>
          </>}
          <p className="p-form-help">Use dados operacionais. Contatos, CPF, credenciais, contas e permissões não são importados. Cada documento admite até vinte registros, confirmados um por vez.</p>
          {kind === 'asset' && <p className="p-form-help">{itemId ? 'O bem existente receberá uma conferência com os dados selecionados e anexos. O cadastro e seu saldo permanecem como estão.' : 'O equipamento será cadastrado com saldo zero. Após a conferência física, registre a entrada em Materiais.'}</p>}
          {!validDestination && <p className="p-inline-error">Escolha um projeto disponível para sua conta antes de preparar a prévia.</p>}
          {readingFile && <p className="p-form-help" role="status">Lendo o documento selecionado…</p>}
          <button type="button" className="p-button p-button-primary" disabled={busy || readingFile || !validDestination} onClick={() => void prepare()}>{busy || readingFile ? <LoaderCircle size={16} className="p-spin"/> : <FileInput size={16}/>} Preparar prévia</button>
        </fieldset> : candidate && <>
          <div className={styles.source}><strong>{preview.provenance.label}</strong><span>Destino: {preview.projectId ? projects.find(project => project.id === preview.projectId)?.name ?? 'Projeto selecionado' : 'Novo projeto'}{preview.itemId ? ' · conferência de bem existente' : kind === 'asset' ? ' · novo equipamento individual' : ''}</span>{preview.provenance.url && <a className="p-text-link" href={preview.provenance.url} target="_blank" rel="noopener noreferrer">Abrir fonte</a>}<small>Consulta: {new Date(preview.provenance.retrievedAt).toLocaleString('pt-BR')} · confirmação válida por 15 minutos</small></div>
          {preview.candidates.length > 1 && <label className="p-field"><span>Registro a conferir</span><select disabled={busy} value={candidateIndex} onChange={event => chooseCandidate(preview, Number(event.target.value))}>{preview.candidates.map((row, index) => <option key={row.key} value={index}>{index + 1}. {row.fields.name || 'Nome não identificado'}</option>)}</select></label>}
          {Array.from(new Set([...candidate.warnings, ...(checkedFields?.warnings ?? [])])).map(warning => <p className="p-form-help" key={warning}>{warning}</p>)}
          {preview.provenance.pages && <p className="p-form-help">PDF: páginas {preview.provenance.pages[0]} a {preview.provenance.pages.at(-1)} usadas na extração do navegador.</p>}
          <p className="p-form-help">{kind === 'project' && projectId ? 'Os campos selecionados substituem os atuais no projeto escolhido.' : 'Somente os campos selecionados serão salvos.'} Campos identificados como conferência ficam em Registros.</p>
          <div className={styles.fields}>{importFields(kind).filter(field => showMissing || editableFields[field.key] !== undefined || field.key === 'name').map(field => <div className={styles.field} key={field.key} data-invalid={!!problems[field.key]}><label htmlFor={`${inputId}-${field.key}`}><input id={`${inputId}-${field.key}`} type="checkbox" checked={selected.includes(field.key)} disabled={busy} onChange={event => { setSelected(previous => event.target.checked ? [...previous, field.key] : previous.filter(key => key !== field.key)); setConfirmed(false); operation.current = null; }}/><span>{field.label}{field.metadata ? <small>Registro de conferência</small> : null}</span></label><div><label className="p-field"><span className={styles.srOnly}>Valor de {field.label.toLowerCase()}</span>{['description', 'funding'].includes(field.key) ? <textarea rows={3} disabled={busy} maxLength={field.maximum} value={editableFields[field.key] ?? ''} onChange={event => { setEdits(previous => ({ ...previous, [field.key]: event.target.value })); setSelected(previous => previous.includes(field.key) ? previous : [...previous, field.key]); setConfirmed(false); operation.current = null; }}/> : <input disabled={busy} maxLength={field.maximum} value={editableFields[field.key] ?? ''} placeholder="Não encontrado; complete se houver informação na fonte" onChange={event => { setEdits(previous => ({ ...previous, [field.key]: event.target.value })); setSelected(previous => previous.includes(field.key) ? previous : [...previous, field.key]); setConfirmed(false); operation.current = null; }}/>}</label>{problems[field.key] && <p className="p-inline-error">{problems[field.key]}</p>}</div></div>)}</div>
          {!showMissing && <button type="button" className="p-button p-button-subtle" disabled={busy} onClick={() => setShowMissing(true)}>Completar campos não encontrados</button>}
          {kind === 'project' && <div className="p-form-grid">{selected.includes('unitName') && <label className="p-field"><span>Unidade correspondente no portal</span><select disabled={busy} value={unitId} onChange={event => { setUnitId(event.target.value); setConfirmed(false); operation.current = null; }}><option value="">Preservar atual / definir depois</option>{organizationalUnits.filter(unit => unit.status !== 'archived').map(unit => <option key={unit.id} value={unit.id}>{unit.acronym ? `${unit.acronym} · ` : ''}{unit.name}</option>)}</select></label>}{selected.includes('modality') && <label className="p-field"><span>Tipo correspondente no portal</span><select disabled={busy} value={typeId} onChange={event => { setTypeId(event.target.value); setConfirmed(false); operation.current = null; }}><option value="">Preservar atual / definir depois</option>{projectTypes.filter(type => type.status !== 'archived').map(type => <option key={type.id} value={type.id}>{type.label}</option>)}</select></label>}</div>}
          {kind === 'project' && preview.provenance.url && <label className={styles.confirm}><input type="checkbox" disabled={busy} checked={saveOfficialUrl} onChange={event => { setSaveOfficialUrl(event.target.checked); setConfirmed(false); operation.current = null; }}/> Usar esta fonte como página oficial do projeto</label>}
          <label className={styles.confirm}><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)}/> Conferi a fonte, o destino e os campos selecionados e autorizo salvar este registro.</label>
          <div className={styles.actions}><button type="button" className="p-button p-button-primary" disabled={busy || !confirmed || !selected.length || selected.some(key => !!problems[key])} onClick={() => void apply()}>{busy ? <LoaderCircle size={16} className="p-spin"/> : <Check size={16}/>} Confirmar e salvar</button><button type="button" className="p-button p-button-subtle" disabled={busy} onClick={resetReview}>Voltar à fonte</button></div>
        </>}
      </>}
      {receipt && <div className={styles.saved} role="status"><h4><Check size={18}/> Cadastro e fonte registrados</h4><p>{kind === 'asset' ? 'O saldo não foi alterado. Fotos e documentos serão vinculados ao registro privado deste bem.' : 'A fonte e a conferência ficaram no histórico do projeto.'}</p>
        <div className={styles.actions}><label className="p-button p-button-subtle"><Paperclip size={16}/> Fotos e documentos<input className={styles.fileInput} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" multiple disabled={busy} onChange={addFiles}/></label><label className="p-button p-button-subtle"><Camera size={16}/> Tirar foto<input className={styles.fileInput} type="file" accept="image/*" capture="environment" disabled={busy} onChange={addFiles}/></label></div><p className="p-form-help">Até {UPLOAD_LIMIT_LABEL} por arquivo. Para documentos oficiais de patrimônio, confira os procedimentos da DLOG e mantenha o registro no sistema institucional.</p>
        {sourceFile?.name.toLowerCase().endsWith('.pdf') && !files.some(entry => entry.file === sourceFile) && <button type="button" className="p-button p-button-subtle" disabled={busy} onClick={() => setFiles(previous => [...previous, { key: crypto.randomUUID(), file: sourceFile, sent: false }])}>Adicionar PDF fonte aos anexos privados</button>}
        {files.length > 0 && <ul className={styles.files}>{files.map(entry => <li key={entry.key}><span>{entry.file.name}</span><small>{entry.sent ? 'Enviado' : entry.error || 'Aguardando envio'}</small>{!entry.sent && <button type="button" className="p-icon-button" disabled={busy} aria-label={`Remover ${entry.file.name}`} onClick={() => setFiles(previous => previous.filter(file => file.key !== entry.key))}><X size={14}/></button>}</li>)}</ul>}
        <div className={styles.actions}>{files.some(file => !file.sent) && <button type="button" className="p-button p-button-primary" disabled={busy} onClick={() => void sendFiles()}>{busy && <LoaderCircle size={16} className="p-spin"/>} Enviar arquivos pendentes</button>}<button type="button" className="p-button p-button-subtle" disabled={busy || files.some(file => !file.sent)} onClick={() => void finish()}>Concluir e atualizar lista</button></div>
      </div>}
      {error && <p className="p-inline-error" role="alert">{error}</p>}
    </div>}
  </section>;
}
