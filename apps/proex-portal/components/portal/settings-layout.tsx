'use client';
import type { ReactNode } from 'react';
import styles from '@/app/settings-groups.module.css';

export type SettingsIndexItem = { id: string; label: string };

/** Abre o grupo pedido e leva até ele. Só acontece por clique: nada rola a página sozinho. */
export function openSettingsGroup(id: string) {
  const element = document.getElementById(id);
  if (!element) return;
  if (element instanceof HTMLDetailsElement) element.open = true;
  element.querySelector('summary')?.focus({ preventScroll: true });
  // Espera o grupo aberto desenhar o conteúdo: antes disso a página pode não ter altura para chegar até ele.
  const behavior: ScrollBehavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => element.scrollIntoView({ block: 'start', behavior })));
}

/** Índice curto no topo de Configurações, com os grupos que este perfil pode usar. */
export function SettingsIndex({ items, intro }: { items: SettingsIndexItem[]; intro: ReactNode }) {
  return <div className={styles.intro}>
    <p>{intro}</p>
    {items.length > 1 && <nav aria-label="Grupos de configurações" className={styles.index}>
      {items.map(item => <button key={item.id} type="button" className={styles.indexLink} onClick={() => openSettingsGroup(item.id)}>{item.label}</button>)}
    </nav>}
  </div>;
}

/** Título de uma tarefa (ex.: "Dados e cópias") acima dos grupos que a compõem. */
export function SettingsSection({ title, description, children, show = true }: { title: string; description: string; children: ReactNode; show?: boolean }) {
  if (!show) return null;
  const id = `settings-section-${title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return <section className={styles.section} aria-labelledby={id}>
    <header className={styles.sectionHeader}><h2 id={id}>{title}</h2><p>{description}</p></header>
    {children}
  </section>;
}
