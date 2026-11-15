'use client';

import { useRef, useState } from 'react';
import { Download, FileText, Pencil } from 'lucide-react';
import { ROLE_DOCUMENT_EXCERPT_LIMIT, ROLE_DOCUMENT_RECORD_LIMIT, ROLE_DOCUMENT_TEXT_LIMIT, roleDocumentText, type RoleDocumentExcerpt, type RoleDocumentPreview } from '@/lib/assistant/role-document-contracts';
import styles from './role-assistant.module.css';

export type RoleDocumentRevision = { title: string; text: string };
type Props = {
  document: RoleDocumentPreview;
  revision?: RoleDocumentRevision;
  disabled: boolean;
  projectName: string;
  canSave: boolean;
  onEdit: (draft: RoleDocumentRevision) => void;
  onAsk: (excerpt: RoleDocumentExcerpt, name: string) => void;
  onCopy: (draft: RoleDocumentRevision, destination: 'download' | 'records') => Promise<void>;
};

export default function RoleDocumentCard({ document, revision, disabled, projectName, canSave, onEdit, onAsk, onCopy }: Props) {
  const [index, setIndex] = useState(0), [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false), [feedback, setFeedback] = useState<{ text: string; failed: boolean } | null>(null);
  const running = useRef(false);
  const part = document.parts[index];
  const draft = revision ?? { title: `${document.name.replace(/\.[^.]+$/, '')} · cópia revisada`, text: roleDocumentText(document.parts) };
  const ready = !!draft.title.trim() && !!draft.text.trim() && draft.text.length <= ROLE_DOCUMENT_TEXT_LIMIT + 1000;
  const blocked = disabled || pending;
  const fitsRecord = draft.text.trim().length <= ROLE_DOCUMENT_RECORD_LIMIT && new TextEncoder().encode(JSON.stringify(draft.text)).byteLength <= 13_000;

  async function save(destination: 'download' | 'records') {
    if (running.current || !ready) return;
    running.current = true; setPending(true); setFeedback(null);
    try {
      await onCopy(draft, destination);
      setFeedback({ text: destination === 'download' ? 'Cópia Word preparada para download.' : 'Texto salvo em Registros do projeto.', failed: false });
    } catch (cause) {
      setFeedback({ text: cause instanceof Error ? cause.message : 'Não foi possível salvar a cópia.', failed: true });
    } finally { running.current = false; setPending(false); }
  }

  return <div className={styles.documentCard}>
    <p className={styles.documentTitle}><FileText size={18} aria-hidden="true"/><strong>{document.name}</strong></p>
    <details>
      <summary>Prévia do texto</summary>
      {document.format === 'pdf' && <label className={styles.editable}><span>Página com texto</span><select value={index} onChange={event => setIndex(Number(event.target.value))}>
        {document.parts.map((page, number) => <option key={page.page} value={number}>Página {page.page}</option>)}
      </select></label>}
      <pre className={styles.documentText} tabIndex={0} aria-label="Texto extraído">{part.text}</pre>
      <button type="button" className="p-button p-button-subtle" disabled={blocked} onClick={() => onAsk({ page: part.page, text: part.text.slice(0, ROLE_DOCUMENT_EXCERPT_LIMIT) }, document.name)}>Perguntar sobre este trecho</button>
    </details>
    <button type="button" className="p-button p-button-subtle" disabled={blocked} aria-expanded={editing} onClick={() => setEditing(value => !value)}>
      <Pencil size={16} aria-hidden="true"/>{editing ? 'Fechar edição' : 'Editar uma cópia'}
    </button>
    {editing && <section className={styles.documentEditor} aria-label="Editar cópia do documento">
      <p className={styles.help}>A cópia usa o texto extraído em uma nova formatação, sem imagens ou layout do original.</p>
      <label className={styles.editable}><span>Título da cópia</span><input value={draft.title} maxLength={160} onChange={event => onEdit({ ...draft, title: event.target.value })} disabled={blocked}/></label>
      <label className={styles.editable}><span>Texto revisado</span><textarea rows={6} value={draft.text} maxLength={ROLE_DOCUMENT_TEXT_LIMIT + 1000} onChange={event => onEdit({ ...draft, text: event.target.value })} disabled={blocked}/></label>
      <div className={styles.reviseActions}>
        <button type="button" className="p-button p-button-primary" disabled={blocked || !ready} onClick={() => void save('download')}><Download size={16} aria-hidden="true"/>Baixar cópia Word</button>
        {canSave && <button type="button" className="p-button p-button-subtle" disabled={blocked || !ready || !fitsRecord} onClick={() => void save('records')}>Salvar texto em Registros</button>}
      </div>
      {canSave && <p className={styles.help}>O texto vai para Registros de {projectName} e fica visível para quem tem acesso. {!fitsRecord && 'O texto é grande para Registros. Baixe a cópia Word ou reduza o texto.'}</p>}
      {pending && <p role="status">Preparando a cópia…</p>}
      {feedback && <p role={feedback.failed ? 'alert' : 'status'}>{feedback.text}</p>}
    </section>}
  </div>;
}
