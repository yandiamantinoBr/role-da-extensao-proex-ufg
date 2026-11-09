import { ArrowRight, CalendarDays, Dices, FolderKanban, Gift } from 'lucide-react';
import styles from './dynamics-explainer.module.css';

const LIST_LIMIT = 8;

export type DynamicLink = { id: string; name: string; status: string; projectId: string; projectName: string; hosts: { id: string; name: string }[] };

/**
 * Explica na própria página o que é uma dinâmica e a que projeto e evento cada uma pertence.
 * Pedido do Yan (09/11/2026): "ainda estou confuso em relação à aba da dinâmica".
 */
export default function DynamicsExplainer({ dynamics, onOpenProject }: { dynamics: DynamicLink[]; onOpenProject?: (projectId: string) => void }) {
  const project = (id: string, name: string) => onOpenProject
    ? <button type="button" className={styles.link} onClick={() => onOpenProject(id)}>{name}<ArrowRight size={13} aria-hidden="true"/></button>
    : <strong>{name}</strong>;
  return <details className={styles.box} open>
    <summary><Dices size={18} aria-hidden="true"/>O que é uma dinâmica?</summary>
    <div className={styles.body}>
      <ol className={styles.steps}>
        <li><Gift size={17} aria-hidden="true"/><span><strong>É uma atividade com brindes</strong>: roleta, dado ou atendimento presencial, com regras e limite de participação.</span></li>
        <li><FolderKanban size={17} aria-hidden="true"/><span><strong>Pertence a um projeto</strong>: o projeto organiza a dinâmica, e os brindes saem do estoque dele.</span></li>
        <li><CalendarDays size={17} aria-hidden="true"/><span><strong>Pode acontecer dentro de um evento</strong>: o evento anfitrião é onde o público participa, sem mudar quem organiza.</span></li>
      </ol>
      {dynamics.length > 0 && <div className={styles.current}>
        <h3>Dinâmicas que você acompanha</h3>
        <ul>{dynamics.slice(0, LIST_LIMIT).map(item => <li key={item.id}>
          <span className={styles.name}>{item.name}</span>
          <span className={styles.relation}>do projeto {project(item.projectId, item.projectName)}{item.hosts.length > 0 && <> · no evento {item.hosts.map((host, index) => <span key={host.id}>{index > 0 && ', '}{project(host.id, host.name)}</span>)}</>}</span>
        </li>)}</ul>
        {dynamics.length > LIST_LIMIT && <p className={styles.more}>E mais {dynamics.length - LIST_LIMIT} na lista abaixo.</p>}
      </div>}
    </div>
  </details>;
}
