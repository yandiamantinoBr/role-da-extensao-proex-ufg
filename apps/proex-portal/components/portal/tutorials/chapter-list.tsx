'use client';
import { CheckCircle2, Play, RotateCcw } from 'lucide-react';
import { TUTORIAL_CHAPTERS } from '@/lib/tutorials/catalog';
import { startChapter, useTutorials } from './tutorial-store';
import styles from './tutorials.module.css';

/** Assuntos que entram nos próximos capítulos (roteiro de 15/11). Só texto: nada aqui abre telas. */
export const UPCOMING_TOPICS: string[] = [];

const day = (iso: string | null) => iso ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' }).format(new Date(iso)) : '';

/** Lista de capítulos com a situação de cada um. Usada na janela "Ajuda e tutoriais" e na Conta. */
export default function ChapterList({ headingLevel = 3 }: { headingLevel?: 2 | 3 }) {
  const { data, loading, error, active } = useTutorials();
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  if (!data && loading) return <p className={styles.muted} role="status">Carregando os tutoriais…</p>;
  if (!data) return <p className={styles.muted} role="alert">{/acesso mudou|Entre/i.test(error) ? 'Os tutoriais ficam disponíveis quando a sua conta estiver ativa.' : error || 'Os tutoriais não abriram agora. Tente de novo em instantes.'}</p>;
  // Só os assuntos com passos para o acesso atual; os outros entram numa nota única.
  const stepsOf = (id: string) => data.chapters.find(entry => entry.id === id)?.steps.filter(step => step.available).length ?? 0;
  const visible = TUTORIAL_CHAPTERS.filter(chapter => stepsOf(chapter.id) > 0 || active?.chapterId === chapter.id);
  const hidden = TUTORIAL_CHAPTERS.length - visible.length;
  return <div className={styles.list}>
    <ul className={styles.chapters}>
      {visible.map(chapter => {
        const state = data.chapters.find(entry => entry.id === chapter.id), progress = data.progress[chapter.id];
        const total = stepsOf(chapter.id);
        const stopped = progress && progress.status !== 'completed' && progress.stepId ? chapter.steps.find(step => step.id === progress.stepId) : undefined;
        const finished = Boolean(progress?.completedAt) && active?.chapterId !== chapter.id;
        return <li key={chapter.id} className={styles.chapter}>
          <div className={styles.chapterText}>
            <Heading>{chapter.title}</Heading>
            <p>{chapter.summary}</p>
            <p className={styles.meta}>
              {total} {total === 1 ? 'passo' : 'passos'} · cerca de {chapter.minutes} min
              {finished && <span className={styles.done}><CheckCircle2 size={14} aria-hidden="true"/>Concluído em {day(progress!.completedAt)}{state?.outdated ? ' · com novidades' : ''}</span>}
              {stopped && active?.chapterId !== chapter.id && <span>Parou em “{stopped.title}”</span>}
            </p>
          </div>
          <div className={styles.chapterActions}>
            {active?.chapterId === chapter.id ? <span className={styles.now}>Em andamento agora</span> : total === 0 ? <span className={styles.muted}>Sem passos para o seu acesso agora.</span> : stopped
              ? <><button type="button" className="p-button p-button-primary" onClick={() => void startChapter(chapter.id)}><Play size={16} aria-hidden="true"/>Retomar</button>
                <button type="button" className="p-button p-button-subtle" onClick={() => void startChapter(chapter.id, { restart: true })}><RotateCcw size={16} aria-hidden="true"/>Recomeçar</button></>
              : <button type="button" className="p-button p-button-primary" onClick={() => void startChapter(chapter.id, { restart: finished })}>{finished ? <><RotateCcw size={16} aria-hidden="true"/>Repetir</> : <><Play size={16} aria-hidden="true"/>Começar</>}</button>}
          </div>
        </li>;
      })}
    </ul>
    {hidden > 0 && <p className={styles.muted}>{hidden === 1 ? 'Um assunto aparece quando o seu acesso incluir o módulo dele.' : `${hidden} assuntos aparecem quando o seu acesso incluir os módulos deles.`}</p>}
    {UPCOMING_TOPICS.length > 0 && <p className={styles.upcoming}><strong>Próximos assuntos:</strong> {UPCOMING_TOPICS.join(', ')}. Eles entram aqui conforme ficarem prontos.</p>}
    <p className={styles.muted}>Os tutoriais funcionam sem IA e não gravam nada no seu trabalho: só lembram onde você parou.</p>
  </div>;
}
