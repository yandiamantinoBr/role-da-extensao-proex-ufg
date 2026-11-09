'use client';
import { useEffect, useState } from 'react';
import { Database, Info, TriangleAlert } from 'lucide-react';
import { civilDay, communityGet, errorText } from './community-api';
import styles from './community.module.css';

type Report = {
  plan: { bytes: number; alertRatio: number; label: string };
  database: { backend: string; databaseBytes: number | null; snapshotBytes: number | null; historyBytes: number | null; objectBytes: number | null } | null;
  usedRatio: number | null; alert: boolean;
  chat: { images: number; bytes: number; nextExpiry: string | null; retentionDays: number; perOrganizationLimit: number };
  records: { bytes: number };
};
const mb = (bytes: number | null | undefined) => bytes == null ? 'não informado' : bytes > 0 && bytes < 104858 ? 'menos de 0,1 MB' : `${(bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
const images = (count: number) => `${count} ${count === 1 ? 'imagem' : 'imagens'}`;

/** Administration view: space used and the premises currently in force for the community layer (easy to change). */
export function CommunityStorage() {
  const [report, setReport] = useState<Report | null>(null), [error, setError] = useState('');
  useEffect(() => { let live = true; communityGet<Report>('/api/community/storage').then(result => { if (live) setReport(result); }).catch(cause => { if (live) setError(errorText(cause, 'Não foi possível medir o espaço.')); }); return () => { live = false; }; }, []);
  if (error) return <p role="alert" className="p-inline-error">{error}</p>;
  if (!report) return <p role="status" className={styles.help}>Medindo o espaço…</p>;
  const ratio = report.usedRatio, percent = ratio == null ? null : Math.round(ratio * 100);
  return <div className={styles.badgesLayout}>
    <section className={styles.card} aria-labelledby="storage-title">
      <div className={styles.cardHead}><div><h2 id="storage-title">Espaço do banco</h2><p>O plano gratuito tem 500 MB. O portal avisa a partir de {Math.round(report.plan.alertRatio * 100)}%.</p></div></div>
      {report.alert && <p className={styles.celebrate} role="alert"><TriangleAlert size={20} aria-hidden="true"/><span><strong>O banco passou de {Math.round(report.plan.alertRatio * 100)}% do plano.</strong> Revise as fotos das conversas ou peça para mover as fotos para um armazenamento separado.</span></p>}
      {percent == null ? <p className={styles.callout}><Info size={16} aria-hidden="true"/><span>Aqui não dá para medir o tamanho total do banco; isso só aparece no site publicado. Os totais abaixo vêm do próprio portal.</span></p>
        : <div className={styles.level}><span className={styles.levelNumber}>{percent}% usado</span><div className={styles.progress} role="progressbar" aria-label="Espaço usado do plano" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${Math.min(100, percent)}%` }} data-alert={report.alert || undefined}/></div><small>{mb(report.database?.databaseBytes)} de {mb(report.plan.bytes)}</small></div>}
      <dl className={styles.facts}>
        <div><dt>Dados do portal hoje</dt><dd>{mb(report.database?.snapshotBytes)}</dd></div>
        <div><dt>Cópias de segurança (60 dias)</dt><dd>{mb(report.database?.historyBytes)}</dd></div>
        <div><dt>Arquivos guardados</dt><dd>{mb(report.database?.objectBytes)}</dd></div>
        <div><dt>Fotos das conversas</dt><dd>{images(report.chat.images)} · {mb(report.chat.bytes)}</dd></div>
        <div><dt>Anexos de registros</dt><dd>{mb(report.records.bytes)}</dd></div>
        <div><dt>Próxima imagem a expirar</dt><dd>{report.chat.nextExpiry ? civilDay(report.chat.nextExpiry.slice(0, 10)) : '—'}</dd></div>
      </dl>
    </section>
    <section className={styles.card} aria-labelledby="premises-title">
      <div className={styles.cardHead}><h2 id="premises-title"><Database size={18} aria-hidden="true"/>Premissas em uso</h2></div>
      <p className={styles.help}>Combinadas em 09/11/2026 para avançar enquanto não há decisão final. Podem ser trocadas depois.</p>
      <ul className={styles.rules}>
        <li>As fotos das conversas ficam no mesmo lugar protegido das fotos de materiais. Se o espaço apertar, dá para movê-las para um armazenamento separado sem mudar as telas.</li>
        <li>Cada foto é reduzida no próprio aparelho e sai sem localização. Até 1,5 MB, 20 por pessoa por dia e {mb(report.chat.perOrganizationLimit)} por organização.</li>
        <li>As fotos são apagadas depois de {report.chat.retentionDays} dias.</li>
        <li>Há uma conversa para cada projeto, aberta a quem participa dele, e conversas diretas entre pessoas que já trabalham juntas no portal. Não há conversa entre organizações.</li>
        <li>Quem quiser recebe um e-mail avisando que chegou um recado, sem o conteúdo. Para funcionar, o script de avisos da conta Google precisa ser atualizado.</li>
      </ul>
    </section>
  </div>;
}
