'use client';

import { FileText, LoaderCircle } from 'lucide-react';
import { formatMicros, friendlyMicros } from '@/lib/assistant/role-contracts';
import { officialPdfUrl } from '@/lib/assistant/official-pdf-url';
import { PDF_READING_MAX_COST_MICROS, PDF_READING_NOTICE, type RolePdfReadingOffer } from '@/lib/assistant/role-pdf-reading-contracts';
import styles from './role-assistant.module.css';

/**
 * Oferta guardada na mensagem da busca: a pergunta original, a oferta assinada e a chave de operação ficam
 * fixas, para um toque repetido nunca cobrar duas vezes. errorId muda a cada erro e move o foco para o aviso.
 */
export type RoleScannedPdfOffer = RolePdfReadingOffer & { question: string; key: string; reading?: boolean; done?: boolean; closed?: boolean; error?: string; errorId?: string };

/** Confere o formato vindo do servidor: só PDF oficial, custo dentro do teto por leitura e oferta assinada. */
export function roleScannedPdfFrom(value: unknown, question: string, key: string): RoleScannedPdfOffer | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const offer = value as Record<string, unknown>;
  if (typeof offer.url !== 'string' || !officialPdfUrl(offer.url) || typeof offer.title !== 'string' || offer.title.length > 300) return undefined;
  if (!Number.isSafeInteger(offer.costMicros) || Number(offer.costMicros) <= 0 || Number(offer.costMicros) > PDF_READING_MAX_COST_MICROS) return undefined;
  if (!Number.isSafeInteger(offer.expiresAt) || typeof offer.signature !== 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(offer.signature) || offer.signature.length > 3000) return undefined;
  return { url: offer.url, title: offer.title, costMicros: Number(offer.costMicros), expiresAt: Number(offer.expiresAt), signature: offer.signature, question, key };
}

/** Leva o foco ao aviso de erro quando ele aparece (o key muda a cada erro). */
const focusOnMount = (node: HTMLElement | null) => { node?.focus(); };

/** "Ler com IA": nada sai do portal sem este toque. O aviso diz o que vai, para onde e o custo máximo. */
export default function RoleScannedPdfCard({ offer, disabled, onRead }: { offer: RoleScannedPdfOffer; disabled: boolean; onRead: () => void }) {
  if (offer.done) return null;
  const alert = offer.error ? <p key={offer.errorId ?? offer.error} ref={focusOnMount} tabIndex={-1} role="alert" className={styles.error}>{offer.error}</p> : null;
  // Recusa definitiva: só o motivo, sem caixa dentro de caixa.
  if (offer.closed) return alert;
  return <section className={`${styles.operation} ${styles.pdfReading}`} aria-label="Ler o PDF escaneado com IA">
    <p className={styles.operationTitle}><FileText size={16} aria-hidden="true"/>Ler o PDF escaneado com IA</p>
    <p className={styles.sendsTo}>{PDF_READING_NOTICE}</p>
    <p className={styles.sendsTo}><strong>{`Custo máximo: ${friendlyMicros(offer.costMicros)}.`}</strong> Nada é enviado até você tocar no botão.</p>
    <div className={styles.reviseActions}>
      {/* Lendo: aria-disabled mantém o contraste do botão; o toque é ignorado. */}
      <button type="button" className="p-button p-button-primary" disabled={disabled && !offer.reading} aria-disabled={offer.reading ? 'true' : undefined}
        onClick={() => { if (!offer.reading) onRead(); }}>
        {offer.reading && <LoaderCircle size={16} className="p-spin" aria-hidden="true"/>}
        {offer.reading ? 'Lendo o PDF com IA…' : `Ler com IA · até ${formatMicros(offer.costMicros)}`}
      </button>
    </div>
    {alert}
  </section>;
}
