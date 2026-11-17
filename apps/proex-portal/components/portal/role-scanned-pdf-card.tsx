'use client';

import { FileText, LoaderCircle } from 'lucide-react';
import { formatMicros } from '@/lib/assistant/role-contracts';
import { officialPdfUrl } from '@/lib/assistant/official-pdf-url';
import { PDF_READING_MAX_COST_MICROS, PDF_READING_NOTICE, type RolePdfReadingOffer } from '@/lib/assistant/role-pdf-reading-contracts';
import styles from './role-assistant.module.css';

/**
 * Oferta guardada na mensagem da busca: a pergunta original e a chave de operação ficam fixas,
 * para um toque repetido nunca cobrar duas vezes.
 */
export type RoleScannedPdfOffer = RolePdfReadingOffer & { question: string; key: string; reading?: boolean; done?: boolean; closed?: boolean; error?: string };

/** Confere o formato vindo do servidor: só PDF oficial e custo dentro do teto por leitura. */
export function roleScannedPdfFrom(value: unknown, question: string, key: string): RoleScannedPdfOffer | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const offer = value as Record<string, unknown>;
  if (typeof offer.url !== 'string' || !officialPdfUrl(offer.url) || typeof offer.title !== 'string' || offer.title.length > 300) return undefined;
  if (!Number.isSafeInteger(offer.costMicros) || Number(offer.costMicros) <= 0 || Number(offer.costMicros) > PDF_READING_MAX_COST_MICROS) return undefined;
  return { url: offer.url, title: offer.title, costMicros: Number(offer.costMicros), question, key };
}

/** "Ler com IA": nada sai do portal sem este toque. O aviso diz para onde vai o PDF e o custo máximo. */
export default function RoleScannedPdfCard({ offer, disabled, onRead }: { offer: RoleScannedPdfOffer; disabled: boolean; onRead: () => void }) {
  if (offer.done) return null;
  const cost = formatMicros(offer.costMicros);
  return <section className={styles.operation} aria-label="Ler o PDF escaneado com IA">
    {!offer.closed && <>
      <p className={styles.help}>{`${PDF_READING_NOTICE} Custo máximo: ${cost}.`}</p>
      <div className={styles.reviseActions}>
        <button type="button" className="p-button p-button-primary" disabled={disabled || !!offer.reading} onClick={onRead}>
          {offer.reading ? <LoaderCircle size={16} aria-hidden="true"/> : <FileText size={16} aria-hidden="true"/>}
          {offer.reading ? 'Lendo o PDF com IA…' : `Ler com IA · até ${cost}`}
        </button>
      </div>
    </>}
    {offer.error && <p role="alert" className={styles.error}>{offer.error}</p>}
  </section>;
}
