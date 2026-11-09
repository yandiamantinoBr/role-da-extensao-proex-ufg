'use client';
import { useState, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import styles from './export-formats.module.css';

export type DocumentFormat = 'pdf' | 'xlsx' | 'docx';

/** Ordem pedida pelo Yan: planilha, documento e PDF. */
export const DOCUMENT_FORMATS = ['xlsx', 'docx', 'pdf'] as const satisfies readonly DocumentFormat[];

export const FORMAT_META: Record<DocumentFormat, { name: string; extension: string; spoken: string }> = {
  xlsx: { name: 'Planilha', extension: 'XLSX', spoken: 'planilha XLSX' },
  docx: { name: 'Documento', extension: 'DOCX', spoken: 'documento DOCX' },
  pdf: { name: 'PDF', extension: 'PDF', spoken: 'PDF' },
};

/** Texto visível do botão; o nome acessível começa por ele para o controle por voz (WCAG 2.5.3). */
export const visibleName = (format: DocumentFormat) => format === 'pdf' ? 'PDF' : `${FORMAT_META[format].name} ${FORMAT_META[format].extension}`;

/** Ícones genéricos, sem marca: folha verde com grade, folha azul com linhas e folha vermelha com faixa. */
export function FormatIcon({ format, size = 22 }: { format: DocumentFormat; size?: number }) {
  const page = <path d="M5 2.75h9.2L19 7.55V20a1.25 1.25 0 0 1-1.25 1.25H5A1.25 1.25 0 0 1 3.75 20V4A1.25 1.25 0 0 1 5 2.75Z" className={styles.page} />;
  const fold = <path d="M14 2.9v3.85c0 .7.55 1.25 1.25 1.25h3.6" className={styles.fold} />;
  return <svg className={`${styles.icon} ${styles[format]}`} width={size} height={size} viewBox="0 0 23 24" aria-hidden="true" focusable="false">
    {page}{fold}
    {format === 'xlsx' && <g className={styles.mark}><rect x="6.5" y="10.5" width="9.5" height="7.5" rx=".6" fill="none" /><path d="M6.5 13h9.5M6.5 15.5h9.5M10 10.5V18" /></g>}
    {format === 'docx' && <g className={styles.mark}><path d="M6.75 11h9M6.75 13.5h9M6.75 16h6" /></g>}
    {format === 'pdf' && <g><rect x="2" y="12.25" width="14.5" height="6.5" rx="1.4" className={styles.band} /><text x="9.25" y="17.15" textAnchor="middle" className={styles.bandText}>PDF</text></g>}
  </svg>;
}

/** Lance quando a falha já foi mostrada por quem chamou: o componente não repete o aviso nem anuncia sucesso. */
export class ExportHandledError extends Error { constructor() { super('Exportação não concluída.'); this.name = 'ExportHandledError'; } }

/** Baixa um arquivo gerado no servidor, mostrando a mensagem da API quando o pedido for recusado. */
export async function downloadFromServer(url: string, fallbackName: string): Promise<void> {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: unknown; message?: unknown } | null;
    const detail = body?.error && typeof body.error === 'object' && 'message' in body.error ? (body.error as { message?: unknown }).message : body?.error ?? body?.message;
    throw new Error(typeof detail === 'string' && detail ? detail : 'Não foi possível preparar o arquivo. Tente novamente.');
  }
  const disposition = response.headers.get('Content-Disposition') || '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] || fallbackName;
  const blob = await response.blob();
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob); link.download = name;
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

type Props = {
  onExport: (format: DocumentFormat) => void | Promise<void>;
  disabled?: boolean;
  /** Nome do grupo para leitores de tela e texto visível quando `title` existe. */
  label?: string;
  formats?: readonly DocumentFormat[];
  /** Mostra o rótulo acima dos botões. */
  showLabel?: boolean;
  /** Botões extras (JSON, imprimir) ao lado dos três formatos. */
  children?: ReactNode;
  className?: string;
  /** Desligue quando `onExport` já avisa o resultado por conta própria. */
  announce?: boolean;
  /** Três ladrilhos lado a lado (ícone em cima), para cartões estreitos. */
  tiles?: boolean;
};

export default function ExportFormats({ onExport, disabled, label = 'Baixar recorte', formats = DOCUMENT_FORMATS, showLabel = false, children, className, announce = true, tiles = false }: Props) {
  const [busy, setBusy] = useState<DocumentFormat | null>(null), [error, setError] = useState('');
  async function run(format: DocumentFormat) {
    if (busy) return;
    setBusy(format); setError('');
    try {
      await onExport(format);
      if (announce) toast.success(`${FORMAT_META[format].name} (${FORMAT_META[format].extension}) preparado para download`);
    } catch (cause) {
      if (cause instanceof ExportHandledError) return;
      setError(cause instanceof Error ? cause.message : 'Não foi possível preparar o arquivo. Tente novamente.');
      if (announce) toast.error('O arquivo não foi preparado. Confira o aviso junto às exportações.');
    } finally { setBusy(null); }
  }
  return <div className={`${styles.root}${className ? ` ${className}` : ''}`}>
    {showLabel && <p className={styles.caption}>{label}</p>}
    <div role="group" aria-label={label} className={`${styles.group}${tiles ? ` ${styles.tiles}` : ''}`}>
      {formats.map(format => <button key={format} type="button" className={styles.button} data-format={format} disabled={disabled || !!busy} aria-busy={busy === format || undefined}
        onClick={() => void run(format)} aria-label={`${visibleName(format)} — ${label}`}>
        {busy === format ? <LoaderCircle size={20} className="p-spin" aria-hidden="true" /> : <FormatIcon format={format} />}
        <span className={styles.text}><span>{FORMAT_META[format].name}</span>{format !== 'pdf' && <small>{FORMAT_META[format].extension}</small>}</span>
      </button>)}
      {children}
    </div>
    {error && <p className="p-inline-error" role="alert">{error}</p>}
  </div>;
}
