'use client';
import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlarmClock, ArrowLeft, CalendarDays, ChevronUp, LayoutGrid, ListChecks, LoaderCircle, Minus, Pin, Settings2, StickyNote, X, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { communityGet, communityPost, errorText } from './community-api';
import type { ModuleId, PortalModule } from './navigation-model';
import styles from './floating-dock.module.css';
import { DOCK_RESERVE_PROPERTY, dockReserve, fabPlacement } from './dock-reserve';

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
/** Where the dock sits, per person (lib/community/widgets.ts). Defaults are the modes that existed before the choice. */
export type DockLayout = { desktop: 'floating' | 'sidebar'; mobile: 'header' | 'floating' };
const DEFAULT_LAYOUT: DockLayout = { desktop: 'floating', mobile: 'header' };
type MobileView = NonNullable<Dock['open']> | 'launchers' | null;
const mobileWidth = '(max-width: 720px)';
function subscribeToToolbar(listener: () => void) {
  const media = window.matchMedia(mobileWidth);
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}
function mobileToolbar() {
  return window.matchMedia(mobileWidth).matches ? document.querySelector('.pn-shell .p-topbar-actions') : null;
}
const desktopToolbar = () => null;
export function useMobileDockToolbar(beforeChange?: () => void) {
  const subscribeToWidth = useCallback((listener: () => void) => subscribeToToolbar(() => {
    beforeChange?.();
    listener();
  }), [beforeChange]);
  return useSyncExternalStore(subscribeToWidth, mobileToolbar, desktopToolbar);
}
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
  const [layout, setLayout] = useState<DockLayout>(DEFAULT_LAYOUT);
  const [mobileView, setMobileView] = useState<MobileView>(null);
  const launchers = useRef<Record<string, HTMLButtonElement | null>>({}), panel = useRef<HTMLElement>(null), saveTimer = useRef(0), pendingSave = useRef<Dock | null>(null);
  const mobileDialog = useRef<HTMLDialogElement>(null), mobileHeading = useRef<HTMLHeadingElement>(null), mobileTrigger = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const resetToolbar = useCallback(() => {
    const active = document.activeElement;
    const sheet = mobileDialog.current;
    if (sheet?.open || active === mobileTrigger.current || root.current?.contains(active)) {
      sheet?.close();
      document.getElementById('main')?.focus({ preventScroll: true });
    }
    setMobileView(null);
    setExpanded(false);
  }, []);
  const toolbar = useMobileDockToolbar(resetToolbar);
  useEffect(() => { registry.mounted = true; publish(); return () => { registry.mounted = false; publish(); }; }, []);
  useEffect(() => {
    let live = true;
    communityGet<{ dock: Dock; layout?: DockLayout; badges: { reminders: number } }>('/api/community/widgets?view=dock').then(result => {
      if (!live) return; setDock(result.dock); setLayout(result.layout ?? DEFAULT_LAYOUT); setBadges(result.badges); registry.hidden = new Set(result.dock.hidden); publish();
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
  // A layout choice saves on its own (it never travels with the dock state) and is undone if the server refuses it.
  // The radio that was used keeps the focus even though the dock is drawn again in another place.
  const layoutRequests = useRef({ desktop: 0, mobile: 0 });
  const chooseLayout = useCallback((device: keyof DockLayout, value: string) => {
    const previous = layout[device];
    if (previous === value) return;
    const request = ++layoutRequests.current[device];
    setLayout(current => ({ ...current, [device]: value }) as DockLayout);
    // Only the latest choice for this device counts; a late answer from an earlier one is ignored, and a failure
    // undoes only this device, and only if the screen still shows the value that failed.
    communityPost<{ layout: DockLayout }>('/api/community/widgets', { action: 'layout', device, value })
      .then(result => { if (layoutRequests.current[device] === request) setLayout(current => ({ ...current, [device]: result.layout[device] })); })
      .catch(cause => {
        if (layoutRequests.current[device] !== request) return;
        setLayout(current => current[device] === value ? { ...current, [device]: previous } as DockLayout : current);
        toast.error(errorText(cause, 'Não foi possível guardar a posição dos widgets.'));
      });
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`input[name="dock-layout-${device}"][value="${value}"]`)?.focus({ preventScroll: true })));
  }, [layout]);
  const close = useCallback((returnTo?: string) => {
    update(current => ({ ...current, open: null, minimized: false }));
    if (returnTo) window.requestAnimationFrame(() => (launchers.current[returnTo] ?? launchers.current.toggle)?.focus({ preventScroll: true }));
  }, [update]);
  const closeMobile = useCallback(() => {
    mobileDialog.current?.close();
    setMobileView(null);
    // Back to the button that opened the sheet (header or corner); if it stepped aside, to the page.
    window.requestAnimationFrame(() => {
      const trigger = mobileTrigger.current;
      if (trigger && trigger.isConnected && getComputedStyle(trigger).visibility !== 'hidden') trigger.focus({ preventScroll: true });
      else if (!document.activeElement || document.activeElement === document.body) document.getElementById('main')?.focus({ preventScroll: true });
    });
  }, []);
  const roleReady = state.items.some(item => item.shortcut === 'Alt+R');
  useEffect(() => {
    if (!mobileView || !roleReady) return;
    // Close the native sheet before the assistant's shortcut opens its panel.
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'r') closeMobile();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [mobileView, roleReady, closeMobile]);
  useEffect(() => {
    if (toolbar || (!dock?.open && !expanded)) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !(panel.current?.contains(document.activeElement) || Object.values(launchers.current).includes(document.activeElement as HTMLButtonElement))) return;
      event.preventDefault();
      if (dock?.open) close(dock.open); else { setExpanded(false); launchers.current.toggle?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dock?.open, expanded, close, toolbar]);
  // Focus goes into a panel only when the person opened it, never when the page loads with a panel already open.
  const openedByPerson = useRef(false);
  useEffect(() => {
    if (toolbar || !dock?.open || dock.minimized || !openedByPerson.current) return;
    openedByPerson.current = false;
    window.requestAnimationFrame(() => (panel.current?.querySelector<HTMLElement>('[data-side-heading]') ?? panel.current?.querySelector<HTMLElement>('[data-autofocus], button, input, textarea, select, a[href]'))?.focus({ preventScroll: true }));
  }, [dock?.open, dock?.minimized, toolbar]);
  const mobileOpen = !!toolbar && mobileView !== null;
  useEffect(() => {
    const sheet = mobileDialog.current;
    if (!mobileOpen || !sheet) return;
    sheet.showModal();
    return () => { if (sheet.open) sheet.close(); };
  }, [mobileOpen]);
  useEffect(() => { if (mobileOpen) mobileHeading.current?.focus({ preventScroll: true }); }, [mobileView, mobileOpen]);
  // The page keeps room at its end for the dock's resting parts, measured from the screen, so buttons at the
  // end of each desktop page stay clear of Rolê, Widgets and any minimized chip.
  const measure = useCallback(() => {
    const node = root.current;
    if (!node) return;
    const reserve = dockReserve(window.innerHeight, [...node.querySelectorAll<HTMLElement>('[data-dock-anchor]')].map(part => part.getBoundingClientRect()).filter(rect => rect.height > 0).map(rect => rect.top));
    if (reserve !== null) document.documentElement.style.setProperty(DOCK_RESERVE_PROPERTY, `${reserve}px`);
  }, []);
  const sidebar = !toolbar && layout.desktop === 'sidebar';
  const shown = dock !== null && !toolbar && !sidebar;
  useEffect(() => {
    if (!shown) return;
    const html = document.documentElement, observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (root.current) observer?.observe(root.current);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); html.style.removeProperty(DOCK_RESERVE_PROPERTY); };
  }, [shown, measure]);
  useEffect(() => { measure(); });
  if (!dock) return null;
  const toggle = (target: Dock['open']) => { openedByPerson.current = !(dock.open === target && !dock.minimized); update(current => current.open === target && !current.minimized ? { ...current, open: null, minimized: false } : { ...current, open: target, minimized: false }); };
  const items = state.items.filter(item => !dock.hidden.includes(item.id));
  const active = WIDGETS.filter(widget => dock.enabled.includes(widget.id));
  const openWidget = dock.open && dock.open !== 'gallery' ? WIDGETS.find(widget => widget.id === dock.open) : null;
  const panelTitle = dock.open === 'gallery' ? 'Meu espaço' : openWidget?.label ?? '';
  const pinnedModules = pinned.map(moduleId => modules.find(module => module.id === moduleId)).filter((module): module is PortalModule => !!module);
  const reminderBadge = active.some(widget => widget.id === 'reminders') ? badges.reminders : 0;
  const widgetLabel = `Widgets${reminderBadge ? `, ${reminderBadge} ${reminderBadge === 1 ? 'lembrete' : 'lembretes'} para hoje` : ''}`;
  const gallery = <Gallery dock={dock} items={state.items} layout={layout} device={toolbar ? 'mobile' : 'desktop'} onLayout={chooseLayout} onChange={next => update(() => next, true)}/>;
  function widgetBody(target: Dock['open']) {
    if (target === 'gallery') return gallery;
    return <Suspense fallback={<p className={styles.loading}><LoaderCircle className="p-spin" size={16}/>Abrindo…</p>}>
      {target === 'notes' && <NotesWidget/>}
      {target === 'reminders' && <RemindersWidget serverDay={serverDay} onBadge={count => setBadges(current => ({ ...current, reminders: count }))}/>}
      {target === 'calendar' && <CalendarWidget serverDay={serverDay} onOpenCalendar={() => { if (toolbar) closeMobile(); onNavigate('calendar'); }}/>}
      {target === 'demands' && <DemandsWidget serverDay={serverDay}/>}
      {target === 'shortcuts' && <Shortcuts modules={pinnedModules} onNavigate={target => { if (toolbar) closeMobile(); else close(); onNavigate(target); }}/>}
    </Suspense>;
  }
  if (toolbar) {
    const viewingList = mobileView === 'launchers';
    const title = viewingList ? 'Widgets' : mobileView === 'gallery' ? 'Meu espaço' : WIDGETS.find(widget => widget.id === mobileView)?.label;
    return <>
      {layout.mobile === 'floating'
        ? <MobileFab buttonRef={mobileTrigger} label={widgetLabel} badge={reminderBadge} open={mobileOpen} onOpen={() => setMobileView('launchers')}/>
        : createPortal(<button ref={mobileTrigger} type="button" className={styles.mobileTrigger} data-dock-toggle aria-label={widgetLabel} title="Widgets" aria-haspopup="dialog" aria-expanded={mobileOpen} onClick={event => { event.currentTarget.focus({ preventScroll: true }); setMobileView('launchers'); }}>
          <LayoutGrid size={19} aria-hidden="true"/>{reminderBadge > 0 && <span className={styles.badge} aria-hidden="true">{reminderBadge > 9 ? '9+' : reminderBadge}</span>}
        </button>, toolbar)}
      {mobileOpen && <dialog ref={mobileDialog} className={styles.mobileDialog} aria-labelledby={`${id}-mobile-title`} onCancel={event => { event.preventDefault(); closeMobile(); }} onClick={event => { if (event.target === event.currentTarget) closeMobile(); }} onKeyDown={event => {
        if (event.key !== 'Tab') return;
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button, input, textarea, select, a[href], [tabindex="0"]')]
          .filter(control => control.tabIndex >= 0 && !control.matches(':disabled') && control.getClientRects().length > 0);
        const first = controls[0], last = controls.at(-1), current = document.activeElement;
        if (event.shiftKey && (current === first || current === mobileHeading.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && current === last) { event.preventDefault(); first?.focus(); }
      }}>
        <div className={styles.mobileSheet}>
          <header className={styles.panelHead}>
            <h2 id={`${id}-mobile-title`} ref={mobileHeading} tabIndex={-1}>{title}</h2>
            {!viewingList && <button type="button" className={styles.headButton} aria-label="Voltar aos widgets" onClick={() => setMobileView('launchers')}><ArrowLeft size={18} aria-hidden="true"/></button>}
            <button type="button" className={styles.headButton} aria-label="Fechar painel de widgets" onClick={closeMobile}><X size={18} aria-hidden="true"/></button>
          </header>
          <div className={styles.panelBody} key={mobileView}>{viewingList ? <ul className={styles.shortcuts}>
            {items.map(item => <li key={item.id}><button type="button" aria-haspopup="dialog" aria-keyshortcuts={item.shortcut} onClick={() => { closeMobile(); item.onOpen(); }}>
              {item.icon}<span><strong>{item.label}</strong>{item.id === 'role' && <small>Assistente da PROEX</small>}</span>
            </button></li>)}
            {active.map(({ id: widgetId, label, description, icon: Icon }) => <li key={widgetId}><button type="button" onClick={() => setMobileView(widgetId)}><Icon size={18} aria-hidden="true"/><span><strong>{label}</strong><small>{description}</small></span></button></li>)}
            <li><button type="button" onClick={() => setMobileView('gallery')}><Settings2 size={18} aria-hidden="true"/><span><strong>Meu espaço</strong><small>Escolher widgets e posição</small></span></button></li>
          </ul> : widgetBody(mobileView)}</div>
        </div>
      </dialog>}
    </>;
  }
  if (sidebar) {
    return <aside className={styles.sideDock} data-open={dock.open ? 'true' : undefined} aria-label="Widgets">
      {dock.open && <section ref={panel} id={`${id}-panel`} className={styles.sidePanel} aria-labelledby={`${id}-title`} onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); close(dock.open ?? undefined); } }}>
        <header className={styles.panelHead}>
          <h2 id={`${id}-title`} data-side-heading tabIndex={-1}>{panelTitle}</h2>
          <button type="button" className={styles.headButton} aria-label={`Fechar ${panelTitle}`} onClick={() => close(dock.open ?? undefined)}><X size={18}/></button>
        </header>
        <div className={styles.panelBody}>{widgetBody(dock.open)}</div>
      </section>}
      {dock.open && <div className={styles.sideScrim} aria-hidden="true" onClick={() => close(dock.open ?? undefined)}/>}
      <nav className={styles.rail}>
        <ul>
          {items.map(item => <RailButton key={item.id} label={item.label} icon={item.icon} badge={item.badge ?? 0} onClick={() => item.onOpen()} aria-haspopup="dialog" aria-keyshortcuts={item.shortcut}/>)}
          {active.map(widget => { const Icon = widget.icon, badge = widget.id === 'reminders' ? badges.reminders : 0; return <RailButton key={widget.id} register={node => { launchers.current[widget.id] = node; }} label={widget.label} icon={<Icon size={20}/>} badge={badge} onClick={() => toggle(widget.id)} aria-expanded={dock.open === widget.id} aria-controls={dock.open === widget.id ? `${id}-panel` : undefined} data-active={dock.open === widget.id || undefined} aria-label={`${widget.label}${badge ? `, ${badge} ${badge === 1 ? 'lembrete' : 'lembretes'} para hoje ou atrasado` : ''}`}/>; })}
        </ul>
        <ul className={styles.railEnd}><RailButton register={node => { launchers.current.gallery = node; }} label="Meu espaço" icon={<Settings2 size={19}/>} onClick={() => toggle('gallery')} aria-expanded={dock.open === 'gallery'} aria-controls={dock.open === 'gallery' ? `${id}-panel` : undefined} data-active={dock.open === 'gallery' || undefined} aria-label="Meu espaço: escolher widgets e posição"/></ul>
      </nav>
    </aside>;
  }
  return <div ref={root} className={styles.dock}>
    {dock.open && <section ref={panel} id={`${id}-panel`} className={styles.panel} data-minimized={dock.minimized || undefined} data-dock-anchor={dock.minimized || undefined} role="dialog" aria-modal="false" aria-labelledby={`${id}-title`}>
      <header className={styles.panelHead}>
        <h2 id={`${id}-title`}>{panelTitle}</h2>
        <button type="button" className={styles.headButton} aria-label={dock.minimized ? `Expandir ${panelTitle}` : `Minimizar ${panelTitle}`} aria-expanded={!dock.minimized} onClick={() => { if (!dock.minimized) setExpanded(false); update(current => ({ ...current, minimized: !current.minimized })); }}>{dock.minimized ? <ChevronUp size={18}/> : <Minus size={18}/>}</button>
        <button type="button" className={styles.headButton} aria-label={`Fechar ${panelTitle}`} onClick={() => close(dock.open ?? undefined)}><X size={18}/></button>
      </header>
      {!dock.minimized && <div className={styles.panelBody}>{widgetBody(dock.open)}</div>}
    </section>}
    <nav className={styles.launchers} aria-label="Widgets" data-expanded={expanded || undefined}>
      {expanded && <div id={`${id}-stack`} className={styles.stack}>
        {active.map(widget => { const Icon = widget.icon, badge = widget.id === 'reminders' ? badges.reminders : 0; return <div key={widget.id} className={styles.stackItem}><span className={styles.stackLabel} aria-hidden="true">{widget.label}</span><button ref={node => { launchers.current[widget.id] = node; }} type="button" className={styles.launcher} aria-label={`${widget.label}${badge ? `, ${badge} ${badge === 1 ? 'lembrete' : 'lembretes'} para hoje ou atrasado` : ''}`} aria-expanded={dock.open === widget.id} aria-controls={dock.open === widget.id ? `${id}-panel` : undefined} data-active={dock.open === widget.id || undefined} onClick={() => toggle(widget.id)}>
          <Icon size={20}/>{badge > 0 && <span className={styles.badge} aria-hidden="true" title={`${badge} ${badge === 1 ? 'lembrete' : 'lembretes'} para hoje ou atrasado`}>{badge > 9 ? '9+' : badge}</span>}
        </button></div>; })}
        <div className={styles.stackItem}><span className={styles.stackLabel} aria-hidden="true">Meu espaço</span><button ref={node => { launchers.current.gallery = node; }} type="button" className={`${styles.launcher} ${styles.galleryLauncher}`} aria-label="Meu espaço: escolher widgets" aria-expanded={dock.open === 'gallery'} aria-controls={dock.open === 'gallery' ? `${id}-panel` : undefined} data-active={dock.open === 'gallery' || undefined} onClick={() => toggle('gallery')}><Settings2 size={18}/></button></div>
      </div>}
      {items.map(item => <button key={item.id} type="button" className={`${styles.launcher} ${styles.itemLauncher}`} data-dock-anchor aria-label={item.label} aria-haspopup="dialog" aria-keyshortcuts={item.shortcut} title={item.label} onClick={event => { setExpanded(false); event.currentTarget.focus({ preventScroll: true }); item.onOpen(); }}>
        {item.icon}{item.badge ? <span className={styles.badge} aria-hidden="true">{item.badge > 9 ? '9+' : item.badge}</span> : null}
      </button>)}
      <button ref={node => { launchers.current.toggle = node; }} type="button" className={`${styles.launcher} ${styles.toggleLauncher}`} data-dock-anchor data-dock-toggle aria-label={expanded ? 'Recolher widgets' : widgetLabel} title="Widgets" aria-expanded={expanded} aria-controls={expanded ? `${id}-stack` : undefined} data-active={expanded || undefined} onClick={() => setExpanded(value => !value)}>
        {expanded ? <X size={20}/> : <LayoutGrid size={20}/>}{!expanded && reminderBadge > 0 && <span className={styles.badge} aria-hidden="true">{reminderBadge > 9 ? '9+' : reminderBadge}</span>}
      </button>
    </nav>
  </div>;
}

type RailButtonProps = { label: string; icon: ReactNode; badge?: number; register?(node: HTMLButtonElement | null): void } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { 'data-active'?: boolean };
/** One button of the fixed rail: icon with its name below, always visible. */
function RailButton({ label, icon, badge = 0, register, ...button }: RailButtonProps) {
  return <li><button ref={register} type="button" className={styles.railButton} {...button}>
    <span className={styles.railIcon} aria-hidden="true">{icon}{badge > 0 && <span className={styles.badge}>{badge > 9 ? '9+' : badge}</span>}</span><span className={styles.railLabel}>{label}</span>
  </button></li>;
}

const LAYOUT_CHOICES: { device: keyof DockLayout; legend: string; options: { value: string; label: string; help: string }[] }[] = [
  { device: 'desktop', legend: 'No computador', options: [
    { value: 'floating', label: 'Flutuante', help: 'Um botão no canto abre os widgets por cima da página.' },
    { value: 'sidebar', label: 'Fixo na lateral', help: 'Uma coluna à direita, sempre à vista. A página encolhe para caber.' },
  ] },
  { device: 'mobile', legend: 'No celular', options: [
    { value: 'header', label: 'No cabeçalho', help: 'Botão no topo da tela. Os widgets abrem numa folha de baixo.' },
    { value: 'floating', label: 'Flutuante no canto', help: 'Botão redondo no canto. Some enquanto a página rola e não fica em cima de botões.' },
  ] },
];
function Gallery({ dock, items, layout, device, onLayout, onChange }: { dock: Dock; items: DockItem[]; layout: DockLayout; device: keyof DockLayout; onLayout(device: keyof DockLayout, value: string): void; onChange(next: Dock): void }) {
  return <div className={styles.gallery}>
    <h3 className={styles.galleryHeading}>Posição dos widgets</h3>
    <p className={styles.help}>Uma escolha para o computador e outra para o celular, guardadas na sua conta. Trocar não muda os widgets ligados.</p>
    {LAYOUT_CHOICES.map(choice => <fieldset key={choice.device} className={styles.layoutChoice}>
      <legend>{choice.legend}{choice.device === device && <span className={styles.here}>este aparelho</span>}</legend>
      {choice.options.map(option => <label key={option.value} className={styles.toggle}>
        <input type="radio" name={`dock-layout-${choice.device}`} value={option.value} checked={layout[choice.device] === option.value} onChange={() => onLayout(choice.device, option.value)}/>
        <span><strong>{option.label}</strong><small>{option.help}</small></span>
      </label>)}
    </fieldset>)}
    <h3 className={styles.galleryHeading}>Widgets</h3>
    <p className={styles.help}>Escolha quais widgets aparecem.</p>
    <ul>{WIDGETS.map(widget => { const Icon = widget.icon, on = dock.enabled.includes(widget.id); return <li key={widget.id}><label className={styles.toggle}>
      <input type="checkbox" name={`dock-${widget.id}`} checked={on} onChange={event => onChange({ ...dock, enabled: event.target.checked ? [...dock.enabled, widget.id] : dock.enabled.filter(item => item !== widget.id), open: !event.target.checked && dock.open === widget.id ? null : dock.open })}/>
      <span className={styles.toggleIcon} aria-hidden="true"><Icon size={18}/></span><span><strong>{widget.label}</strong><small>{widget.description}</small></span>
    </label></li>; })}
    {items.map(item => { const shown = !dock.hidden.includes(item.id); return <li key={item.id}><label className={styles.toggle}>
      <input type="checkbox" name={`dock-item-${item.id}`} checked={shown} onChange={event => onChange({ ...dock, hidden: event.target.checked ? dock.hidden.filter(hidden => hidden !== item.id) : [...dock.hidden, item.id] })}/>
      <span className={styles.toggleIcon} aria-hidden="true">{item.icon}</span><span><strong>{item.label}</strong><small>Mostrar em Widgets.{item.shortcut ? ` Atalho ${item.shortcut} continua valendo.` : ''}</small></span>
    </label></li>; })}</ul>
  </div>;
}

function Shortcuts({ modules, onNavigate }: { modules: PortalModule[]; onNavigate(id: ModuleId): void }) {
  if (!modules.length) return <p className={styles.help}>Você ainda não fixou módulos. Fixe pelo alfinete em “Para começar”, no Início.</p>;
  return <ul className={styles.shortcuts}>{modules.map(module => { const Icon = module.icon; return <li key={module.id}><button type="button" onClick={() => onNavigate(module.id)}><Icon size={18} aria-hidden="true"/><span><strong>{module.label}</strong><small>{module.description}</small></span></button></li>; })}</ul>;
}

/*
 * Phone, "Flutuante no canto": one round button above the bottom bar. It never covers what can be used:
 * - while the page scrolls it fades away, and it never takes a tap meant for the page;
 * - when scrolling stops it looks for a free spot from its home upward and hides if there is none;
 * - it hides while a text field has focus (keyboard) and while the notification center is open;
 * - the end of each page keeps room for its home position, so the last buttons are always reachable.
 */
function MobileFab({ buttonRef, label, badge, open, onOpen }: { buttonRef: React.RefObject<HTMLButtonElement | null>; label: string; badge: number; open: boolean; onOpen(): void }) {
  useEffect(() => {
    const button = buttonRef.current;
    if (!button) return;
    const html = document.documentElement;
    let settle = 0, frame = 0;
    const editing = () => { const active = document.activeElement; return !!active && active !== button && (active.matches('input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea, select, [contenteditable="true"]')); };
    const place = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const nav = document.querySelector('.pn-mobile-nav');
        const navTop = nav ? nav.getBoundingClientRect().top : window.innerHeight;
        html.style.setProperty('--dock-fab-nav', `${Math.max(0, Math.round(window.innerHeight - navTop))}px`);
        const size = button.offsetHeight || 52, right = window.innerWidth - 14, homeBottom = navTop - 12;
        const reserve = dockReserve(window.innerHeight, [homeBottom - size]);
        if (reserve !== null) html.style.setProperty(DOCK_RESERVE_PROPERTY, `${reserve}px`);
        // While a sheet or dialog is open the button is hidden by CSS; keep its spot, so closing returns the focus to it.
        if (document.querySelector('dialog[open]')) return;
        if (editing()) { button.dataset.state = 'away'; return; }
        const area = { left: right - size, right, bottom: homeBottom, size, limit: Math.round(window.innerHeight * 0.4) };
        // First an empty spot close to home (so it doesn't jump around); otherwise any spot without a control.
        const shift = fabPlacement({ ...area, limit: Math.min(area.limit, 160), blocked: (x, y) => blockedAt(x, y, button, true) }) ?? fabPlacement({ ...area, blocked: (x, y) => blockedAt(x, y, button, false) });
        if (shift === null) { button.dataset.state = 'away'; return; }
        button.style.setProperty('--dock-fab-shift', `${shift}px`);
        button.dataset.state = 'shown';
      });
    };
    const onScroll = () => { button.dataset.state = 'away'; window.clearTimeout(settle); settle = window.setTimeout(place, 180); };
    const onFocus = () => { window.clearTimeout(settle); settle = window.setTimeout(place, 60); };
    // Page changes (lists loading, a section opening): place again, at most every half second even if changes keep coming.
    let pendingSince = 0;
    const onChange = () => { const now = Date.now(); if (!pendingSince) pendingSince = now; window.clearTimeout(settle); settle = window.setTimeout(() => { pendingSince = 0; place(); }, now - pendingSince > 500 ? 0 : 250); };
    const main = document.getElementById('main');
    const observer = typeof MutationObserver === 'undefined' || !main ? null : new MutationObserver(onChange);
    observer?.observe(main!, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'hidden', 'aria-expanded', 'class'] });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    window.visualViewport?.addEventListener('resize', onScroll);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', onFocus);
    place();
    return () => {
      window.clearTimeout(settle); window.cancelAnimationFrame(frame); observer?.disconnect();
      window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); window.visualViewport?.removeEventListener('resize', onScroll);
      document.removeEventListener('focusin', onFocus); document.removeEventListener('focusout', onFocus);
      html.style.removeProperty(DOCK_RESERVE_PROPERTY); html.style.removeProperty('--dock-fab-nav');
    };
  }, [buttonRef]);
  return <button ref={buttonRef} type="button" className={styles.mobileFab} data-dock-toggle data-state="away" aria-label={label} title="Widgets" aria-haspopup="dialog" aria-expanded={open} onClick={event => { event.currentTarget.focus({ preventScroll: true }); onOpen(); }}>
    <LayoutGrid size={21} aria-hidden="true"/>{badge > 0 && <span className={styles.badge} aria-hidden="true">{badge > 9 ? '9+' : badge}</span>}
  </button>;
}

const INTERACTIVE = 'a[href], button, input, select, textarea, summary, label, [role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="switch"], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';
const hasOwnText = (element: Element) => [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && !!node.textContent?.trim()) || element.matches('img, svg, canvas, video, picture');
/**
 * True when something sits at this point of the screen: always a control the person can use; with `strict`, also text,
 * numbers and images (so the button prefers empty space). The button itself and the bottom bar don't count.
 */
function blockedAt(x: number, y: number, self: HTMLElement, strict: boolean) {
  for (const element of document.elementsFromPoint(x, y)) {
    if (element === self || self.contains(element) || element.closest('.pn-mobile-nav')) continue;
    if (element.closest(INTERACTIVE)) return true;
    if (strict && hasOwnText(element)) return true;
    if (strict && element.matches('main, body, html')) return false;
  }
  return false;
}
