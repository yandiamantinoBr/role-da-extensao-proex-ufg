'use client';
import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AlarmClock, CalendarDays, ChevronUp, LayoutGrid, ListChecks, LoaderCircle, Minus, Pin, Settings2, StickyNote, X, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { communityGet, communityPost, errorText } from './community-api';
import type { ModuleId, PortalModule } from './navigation-model';
import styles from './floating-dock.module.css';

/* ── Registry: other features (the Rolê) put a launcher in the dock without the dock knowing them. ── */
export type DockItem = { id: string; label: string; icon: ReactNode; onOpen(): void; shortcut?: string; badge?: number };
type Registry = { items: Map<string, DockItem>; hidden: Set<string>; mounted: boolean };
const registry: Registry = { items: new Map(), hidden: new Set(), mounted: false };
let snapshot = { items: [] as DockItem[], hidden: [] as string[], mounted: false };
const listeners = new Set<() => void>();
function publish() { snapshot = { items: [...registry.items.values()], hidden: [...registry.hidden], mounted: registry.mounted }; listeners.forEach(listener => listener()); }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const read = () => snapshot;
/**
 * Registers a launcher in the floating dock. `registered` is true while a dock is on the page (then the feature should not
 * draw its own floating button); `hidden` is true when the person hid this launcher in "Meu espaço".
 * The feature keeps owning its panel and shortcut.
 */
export function useDockItem(item: DockItem | null): { registered: boolean; hidden: boolean } {
  const state = useSyncExternalStore(subscribe, read, read);
  const latest = useRef(item);
  useEffect(() => { latest.current = item; });
  const id = item?.id ?? null, label = item?.label, badge = item?.badge, shortcut = item?.shortcut;
  useEffect(() => {
    if (!id) return;
    registry.items.set(id, { id, label: label ?? id, shortcut, badge, icon: latest.current?.icon, onOpen: () => latest.current?.onOpen() });
    publish();
    return () => { registry.items.delete(id); publish(); };
  }, [id, label, badge, shortcut]);
  return { registered: state.mounted, hidden: !!id && state.hidden.includes(id) };
}

/* ── Widgets: each one is its own chunk, fetched only when its panel opens. ── */
type WidgetId = 'notes' | 'reminders' | 'calendar' | 'demands' | 'shortcuts';
type Dock = { enabled: WidgetId[]; open: WidgetId | 'gallery' | null; minimized: boolean; hidden: string[] };
const NotesWidget = lazy(() => import('./dock-personal').then(module => ({ default: module.NotesWidget })));
const RemindersWidget = lazy(() => import('./dock-personal').then(module => ({ default: module.RemindersWidget })));
const CalendarWidget = lazy(() => import('./dock-calendar'));
const DemandsWidget = lazy(() => import('./dock-demands'));
const WIDGETS: { id: WidgetId; label: string; description: string; icon: LucideIcon }[] = [
  { id: 'reminders', label: 'Lembretes', description: 'Datas e horários que você não quer esquecer.', icon: AlarmClock },
  { id: 'notes', label: 'Anotações', description: 'Recados curtos para você mesmo.', icon: StickyNote },
  { id: 'calendar', label: 'Calendário', description: 'Hoje e os próximos 7 dias: agenda e prazos das suas demandas.', icon: CalendarDays },
  { id: 'demands', label: 'Minhas demandas', description: 'Abertas, vencendo hoje e atrasadas, com atalho.', icon: ListChecks },
  { id: 'shortcuts', label: 'Atalhos', description: 'Os módulos que você fixou, a um clique de qualquer página.', icon: Pin },
];

type Props = { userId: string; serverDay: string; modules: PortalModule[]; pinned: ModuleId[]; onNavigate(id: ModuleId): void };

/** Floating dock on every page: small launchers in the corner, one suspended panel at a time, state kept per person. */
export default function FloatingDock({ userId, serverDay, modules, pinned, onNavigate }: Props) {
  const id = useId(), state = useSyncExternalStore(subscribe, read, read);
  const [dock, setDock] = useState<Dock | null>(null), [badges, setBadges] = useState({ reminders: 0 }), [expanded, setExpanded] = useState(false);
  const launchers = useRef<Record<string, HTMLButtonElement | null>>({}), panel = useRef<HTMLElement>(null), saveTimer = useRef(0), pendingSave = useRef<Dock | null>(null);
  useEffect(() => { registry.mounted = true; publish(); return () => { registry.mounted = false; publish(); }; }, []);
  useEffect(() => {
    let live = true;
    communityGet<{ dock: Dock; badges: { reminders: number } }>('/api/community/widgets?view=dock').then(result => {
      if (!live) return; setDock(result.dock); setBadges(result.badges); registry.hidden = new Set(result.dock.hidden); publish();
    }).catch(() => { if (live) setDock({ enabled: [], open: null, minimized: false, hidden: [] }); });
    return () => { live = false; };
  }, [userId]);
  // Opening and closing panels saves after a short pause, so quick clicks become one write.
  const flush = useCallback(() => { const next = pendingSave.current; pendingSave.current = null; if (next) communityPost('/api/community/widgets', { action: 'dock', ...next }).catch(cause => toast.error(errorText(cause, 'Não foi possível guardar sua doca.'))); }, []);
  useEffect(() => () => { window.clearTimeout(saveTimer.current); flush(); }, [flush]);
  const dockRef = useRef<Dock | null>(null);
  useEffect(() => { dockRef.current = dock; }, [dock]);
  const update = useCallback((change: (current: Dock) => Dock, immediate = false) => {
    const current = dockRef.current;
    if (!current) return;
    const next = change(current);
    dockRef.current = next; setDock(next);
    registry.hidden = new Set(next.hidden); publish();
    pendingSave.current = next; window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(flush, immediate ? 0 : 1200);
  }, [flush]);
  const close = useCallback((returnTo?: string) => { update(current => ({ ...current, open: null, minimized: false })); if (returnTo) window.requestAnimationFrame(() => launchers.current[returnTo]?.focus()); }, [update]);
  useEffect(() => {
    if (!dock?.open && !expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !(panel.current?.contains(document.activeElement) || Object.values(launchers.current).includes(document.activeElement as HTMLButtonElement))) return;
      event.preventDefault();
      if (dock?.open) close(dock.open); else { setExpanded(false); launchers.current.toggle?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dock?.open, expanded, close]);
  useEffect(() => { if (dock?.open && !dock.minimized) window.requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('[data-autofocus], button, input, textarea, select, a[href]')?.focus()); }, [dock?.open, dock?.minimized]);
  if (!dock) return null;
  const toggle = (target: Dock['open']) => update(current => current.open === target && !current.minimized ? { ...current, open: null, minimized: false } : { ...current, open: target, minimized: false });
  const items = state.items.filter(item => !dock.hidden.includes(item.id));
  const active = WIDGETS.filter(widget => dock.enabled.includes(widget.id));
  const openWidget = dock.open && dock.open !== 'gallery' ? WIDGETS.find(widget => widget.id === dock.open) : null;
  const panelTitle = dock.open === 'gallery' ? 'Meu espaço' : openWidget?.label ?? '';
  const pinnedModules = pinned.map(moduleId => modules.find(module => module.id === moduleId)).filter((module): module is PortalModule => !!module);
  return <div className={styles.dock} data-open={dock.open && !dock.minimized ? 'true' : undefined} data-has-role={items.length > 0 || undefined}>
    {dock.open && !dock.minimized && <div className={styles.scrim} aria-hidden="true" onClick={() => close(dock.open ?? undefined)}/>}
    {dock.open && <section ref={panel} id={`${id}-panel`} className={styles.panel} data-minimized={dock.minimized || undefined} role="dialog" aria-modal="false" aria-labelledby={`${id}-title`}>
      <header className={styles.panelHead}>
        <h2 id={`${id}-title`}>{panelTitle}</h2>
        <button type="button" className={styles.headButton} aria-label={dock.minimized ? `Expandir ${panelTitle}` : `Minimizar ${panelTitle}`} aria-expanded={!dock.minimized} onClick={() => { if (!dock.minimized) setExpanded(false); update(current => ({ ...current, minimized: !current.minimized })); }}>{dock.minimized ? <ChevronUp size={18}/> : <Minus size={18}/>}</button>
        <button type="button" className={styles.headButton} aria-label={`Fechar ${panelTitle}`} onClick={() => close(dock.open ?? undefined)}><X size={18}/></button>
      </header>
      {!dock.minimized && <div className={styles.panelBody}>
        {dock.open === 'gallery' ? <Gallery dock={dock} items={state.items} onChange={next => update(() => next, true)}/>
          : <Suspense fallback={<p className={styles.loading}><LoaderCircle className="p-spin" size={16}/>Abrindo…</p>}>
            {dock.open === 'notes' && <NotesWidget/>}
            {dock.open === 'reminders' && <RemindersWidget serverDay={serverDay} onBadge={count => setBadges(current => ({ ...current, reminders: count }))}/>}
            {dock.open === 'calendar' && <CalendarWidget serverDay={serverDay} onOpenCalendar={() => onNavigate('calendar')}/>}
            {dock.open === 'demands' && <DemandsWidget serverDay={serverDay}/>}
            {dock.open === 'shortcuts' && <Shortcuts modules={pinnedModules} onNavigate={target => { onNavigate(target); close(); }}/>}
          </Suspense>}
      </div>}
    </section>}
    <nav className={styles.launchers} aria-label="Widgets" data-expanded={expanded || undefined}>
      {expanded && <div id={`${id}-stack`} className={styles.stack}>
        {active.map(widget => { const Icon = widget.icon, badge = widget.id === 'reminders' ? badges.reminders : 0; return <div key={widget.id} className={styles.stackItem}><span className={styles.stackLabel} aria-hidden="true">{widget.label}</span><button ref={node => { launchers.current[widget.id] = node; }} type="button" className={styles.launcher} aria-label={`${widget.label}${badge ? `, ${badge} ${badge === 1 ? 'lembrete' : 'lembretes'} para hoje ou atrasado` : ''}`} aria-expanded={dock.open === widget.id} aria-controls={dock.open === widget.id ? `${id}-panel` : undefined} data-active={dock.open === widget.id || undefined} onClick={() => toggle(widget.id)}>
          <Icon size={20}/>{badge > 0 && <span className={styles.badge} aria-hidden="true" title={`${badge} ${badge === 1 ? 'lembrete' : 'lembretes'} para hoje ou atrasado`}>{badge > 9 ? '9+' : badge}</span>}
        </button></div>; })}
        <div className={styles.stackItem}><span className={styles.stackLabel} aria-hidden="true">Meu espaço</span><button ref={node => { launchers.current.gallery = node; }} type="button" className={`${styles.launcher} ${styles.galleryLauncher}`} aria-label="Meu espaço: escolher widgets" aria-expanded={dock.open === 'gallery'} aria-controls={dock.open === 'gallery' ? `${id}-panel` : undefined} data-active={dock.open === 'gallery' || undefined} onClick={() => toggle('gallery')}><Settings2 size={18}/></button></div>
      </div>}
      {items.map(item => <button key={item.id} type="button" className={`${styles.launcher} ${styles.itemLauncher}`} aria-label={`${item.label}${item.shortcut ? ` (${item.shortcut})` : ''}`} title={item.label} onClick={() => item.onOpen()}>
        {item.icon}{item.badge ? <span className={styles.badge} aria-hidden="true">{item.badge > 9 ? '9+' : item.badge}</span> : null}
      </button>)}
      <button ref={node => { launchers.current.toggle = node; }} type="button" className={`${styles.launcher} ${styles.toggleLauncher}`} aria-label={expanded ? 'Recolher widgets' : `Widgets${badges.reminders && active.some(widget => widget.id === 'reminders') ? `, ${badges.reminders} lembretes para hoje` : ''}`} title="Widgets" aria-expanded={expanded} aria-controls={expanded ? `${id}-stack` : undefined} data-active={expanded || undefined} onClick={() => setExpanded(value => !value)}>
        {expanded ? <X size={20}/> : <LayoutGrid size={20}/>}{!expanded && badges.reminders > 0 && active.some(widget => widget.id === 'reminders') && <span className={styles.badge} aria-hidden="true">{badges.reminders > 9 ? '9+' : badges.reminders}</span>}
      </button>
    </nav>
  </div>;
}

function Gallery({ dock, items, onChange }: { dock: Dock; items: DockItem[]; onChange(next: Dock): void }) {
  return <div className={styles.gallery}>
    <p className={styles.help}>Ligue só o que ajuda no seu dia. Os widgets ficam no canto, em todas as páginas, e abrem por cima do conteúdo.</p>
    <ul>{WIDGETS.map(widget => { const Icon = widget.icon, on = dock.enabled.includes(widget.id); return <li key={widget.id}><label className={styles.toggle}>
      <input type="checkbox" name={`dock-${widget.id}`} checked={on} onChange={event => onChange({ ...dock, enabled: event.target.checked ? [...dock.enabled, widget.id] : dock.enabled.filter(item => item !== widget.id), open: !event.target.checked && dock.open === widget.id ? null : dock.open })}/>
      <span className={styles.toggleIcon} aria-hidden="true"><Icon size={18}/></span><span><strong>{widget.label}</strong><small>{widget.description}</small></span>
    </label></li>; })}
    {items.map(item => { const shown = !dock.hidden.includes(item.id); return <li key={item.id}><label className={styles.toggle}>
      <input type="checkbox" name={`dock-item-${item.id}`} checked={shown} onChange={event => onChange({ ...dock, hidden: event.target.checked ? dock.hidden.filter(hidden => hidden !== item.id) : [...dock.hidden, item.id] })}/>
      <span className={styles.toggleIcon} aria-hidden="true">{item.icon}</span><span><strong>{item.label}</strong><small>Mostrar o botão {item.label === 'Rolê' ? 'do Rolê' : `de ${item.label}`} no canto.{item.shortcut ? ` Atalho ${item.shortcut} continua valendo.` : ''}</small></span>
    </label></li>; })}</ul>
  </div>;
}

function Shortcuts({ modules, onNavigate }: { modules: PortalModule[]; onNavigate(id: ModuleId): void }) {
  if (!modules.length) return <p className={styles.help}>Você ainda não fixou módulos. Fixe pelo alfinete em “Para começar”, no Início.</p>;
  return <ul className={styles.shortcuts}>{modules.map(module => { const Icon = module.icon; return <li key={module.id}><button type="button" onClick={() => onNavigate(module.id)}><Icon size={18} aria-hidden="true"/><span><strong>{module.label}</strong><small>{module.description}</small></span></button></li>; })}</ul>;
}
