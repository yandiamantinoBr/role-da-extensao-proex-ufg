'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronRight, ExternalLink, Menu, PanelLeftClose, PanelLeftOpen, Pin, Search, ShieldCheck, Sparkles, X } from 'lucide-react';
import { BrandMark } from '@/components/theme/brand-mark';
import { recommendedModules, type ModuleId, type PortalModule } from './navigation-model';
type Props = {
    modules: PortalModule[];
    active: ModuleId;
    onNavigate: (id: ModuleId) => void;
    pinned: ModuleId[];
    role: string;
};
export function DesktopSidebar({ modules, active, onNavigate, pinned, collapsed, onToggle }: Props & {
    collapsed: boolean;
    onToggle: () => void;
}) {
    const favorites = modules.filter(module => pinned.includes(module.id));
    const work = modules.filter(module => !['team', 'reports', 'settings', 'profile', 'overview'].includes(module.id) && !pinned.includes(module.id));
    const management = modules.filter(module => ['team', 'reports', 'settings'].includes(module.id) && !pinned.includes(module.id));
    function link(module: PortalModule) {
        const Icon = module.icon;
        return <button type="button" key={module.id} className={`pn-link ${active === module.id ? 'is-active' : ''}`} aria-label={module.label} title={collapsed ? module.label : undefined} aria-current={active === module.id ? 'page' : undefined} onClick={() => onNavigate(module.id)}>
        <Icon size={20}/>
        <span className="pn-link-label">{module.label}</span>{pinned.includes(module.id) && <Pin size={12} className="pn-pin-mark" aria-hidden="true"/>}{active === module.id && !collapsed && <ChevronRight size={14} className="pn-active-chevron" aria-hidden="true"/>}</button>;
    }
    return <aside className={`pn-sidebar ${collapsed ? 'pn-sidebar-compact' : ''}`} aria-label="Navegação do portal">
    <button className="pn-brand" onClick={() => onNavigate('overview')} aria-label="PROEX UFG, ir para o início" title={collapsed ? 'PROEX UFG · Início' : undefined}>
    <BrandMark variant="light" compact={collapsed} emphasis="university"/>
    </button>
    <div className="pn-sidebar-title">
    <strong>Gestão PROEX</strong>
    <span>Seu espaço de trabalho</span>
    </div>
    <button className="pn-collapse" onClick={onToggle} aria-label={collapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'} aria-expanded={!collapsed} title={collapsed ? 'Expandir menu lateral' : undefined}>{collapsed ? <PanelLeftOpen size={19}/> : <PanelLeftClose size={19}/>}<span>{collapsed ? 'Expandir' : 'Recolher menu'}</span>
    </button>
    <nav className="pn-desktop-nav" aria-label="Módulos do portal">{modules.filter(module => module.id === 'overview').map(link)}{favorites.length > 0 && <div className="pn-nav-group">
        <span className="pn-group-label">Seus atalhos</span>{favorites.map(link)}</div>}<div className="pn-nav-group">
    <span className="pn-group-label">Trabalho</span>{work.map(link)}</div>{management.length > 0 && <div className="pn-nav-group">
        <span className="pn-group-label">Gestão</span>{management.map(link)}</div>}<div className="pn-nav-group pn-account-group">{modules.filter(module => module.id === 'profile' && !pinned.includes('profile')).map(link)}</div>
    </nav>
    <div className="pn-sidebar-footer">
    <a href="https://role-da-extensao-ufg.yandiamantinobr.chatgpt.site/" target="_blank" rel="noreferrer" title={collapsed ? 'Abrir a roleta livre' : undefined} aria-label="Abrir a roleta livre em outra aba">
    <Sparkles size={18}/>
    <span>Roleta livre</span>
    <ExternalLink size={13}/>
    </a>
    <p title={collapsed ? 'Acesso por função e projeto' : undefined}>
    <ShieldCheck size={15}/>
    <span>Acesso por função e projeto</span>
    </p>
    </div>
    </aside>;
}
export function MobileNavigation({ modules, active, onNavigate, pinned, role, onTogglePin }: Props & {
    onTogglePin: (id: ModuleId) => void;
}) {
    const [open, setOpen] = useState(false), [query, setQuery] = useState('');
    const dialog = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
    const allowed = modules.map(module => module.id);
    // The bottom bar moves only when the person changes pins or their access changes.
    const candidates = [...pinned, ...recommendedModules(role, allowed)];
    const primary = [...new Set(candidates)].filter(id => id !== 'overview' && id !== 'profile' && allowed.includes(id)).slice(0, 2);
    const primaryIds: ModuleId[] = ['overview', ...primary, 'profile'].filter((id): id is ModuleId => allowed.includes(id as ModuleId));
    const items = primaryIds.map(id => modules.find(module => module.id === id)).filter((module): module is PortalModule => Boolean(module));
    useEffect(() => {
        const desktop = window.matchMedia('(min-width: 721px)');
        const changed = () => { if (desktop.matches) { setOpen(false); setQuery(''); document.getElementById('main')?.focus({ preventScroll: true }); } };
        desktop.addEventListener('change', changed);
        return () => desktop.removeEventListener('change', changed);
    }, []);
    useEffect(() => { if (!open)
        return; const previous = document.body.style.overflow; document.body.style.overflow = 'hidden'; const timer = window.setTimeout(() => dialog.current?.querySelector<HTMLButtonElement>('.pn-drawer-close')?.focus(), 0); const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
    } }; document.addEventListener('keydown', escape); return () => { window.clearTimeout(timer); document.body.style.overflow = previous; document.removeEventListener('keydown', escape); }; }, [open]);
    function close() { setOpen(false); setQuery(''); trigger.current?.focus(); }
    function navigate(id: ModuleId) { onNavigate(id); close(); }
    return <>
    <nav className="pn-mobile-nav" aria-label="Navegação principal no celular">{items.map(({ id, label, icon: Icon }) => <button key={id} className={active === id ? 'is-active' : ''} onClick={() => onNavigate(id)} aria-current={active === id ? 'page' : undefined}>
        <Icon size={20}/>
        <span>{label}</span>
        </button>)}<button ref={trigger} className={open || !primaryIds.includes(active) ? 'is-active' : ''} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} aria-controls="portal-mobile-navigation">
    <Menu size={20}/>
    <span>Mais</span>
    </button>
    </nav>{open && <div className="pn-drawer-backdrop" onPointerDown={event => { if (event.target === event.currentTarget)
            close(); }}>
        <div className="pn-mobile-drawer" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="portal-navigation-title" id="portal-mobile-navigation" onKeyDown={event => { if (event.key !== 'Tab')
            return; const elements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input')); const first = elements[0], last = elements[elements.length - 1]; if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
        }
        else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
        } }}>
        <div className="pn-drawer-heading">
        <div>
        <span>GESTÃO PROEX</span>
        <h2 id="portal-navigation-title">Todos os módulos</h2>
        </div>
        <button className="p-icon-button pn-drawer-close" aria-label="Fechar navegação" onClick={close}>
        <X size={20}/>
        </button>
        </div>
        <label className="pn-module-search">
        <Search size={18}/>
        <span className="visually-hidden">Buscar módulo</span>
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="O que você precisa fazer?"/>
        </label>
        <p className="pn-drawer-help">Fixe seus módulos para encontrá-los no seu início.</p>
        <div className="pn-drawer-modules">{modules.filter(module => `${module.label} ${module.description}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR'))).map(({ id, label, description, icon: Icon }) => <div key={id} className={active === id ? 'is-active' : ''}>
            <button className="pn-drawer-link" onClick={() => navigate(id)} aria-current={active === id ? 'page' : undefined}>
            <span>
            <Icon size={21}/>
            </span>
            <div>
            <strong>{label}</strong>
            <small>{description}</small>
            </div>
            <ArrowRight size={16}/>
            </button>{id !== 'overview' && <button className={`pn-pin-button ${pinned.includes(id) ? 'is-pinned' : ''}`} aria-label={`${pinned.includes(id) ? 'Remover' : 'Fixar'} ${label} ${pinned.includes(id) ? 'dos' : 'nos'} atalhos`} aria-pressed={pinned.includes(id)} onClick={() => onTogglePin(id)}>
                <Pin size={17}/>
                </button>}</div>)}</div>{!modules.some(module => `${module.label} ${module.description}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR'))) && <p className="pn-no-results">Nenhum módulo encontrado. Tente outro nome.</p>}</div>
        </div>}</>;
}
