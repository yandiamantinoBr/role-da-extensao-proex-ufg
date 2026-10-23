import { Boxes, CalendarDays, ClipboardList, FileText, FolderKanban, LayoutDashboard, Settings2, Truck, UserRound, Users, type LucideIcon } from 'lucide-react';
export type ModuleId = 'overview' | 'projects' | 'events' | 'materials' | 'loans' | 'team' | 'reports' | 'settings' | 'calendar' | 'records' | 'profile';
export type PortalModule = {
    id: ModuleId;
    label: string;
    description: string;
    icon: LucideIcon;
};
export const PORTAL_MODULES: PortalModule[] = [
    { id: 'overview', label: 'Início', description: 'Seu contexto, seus atalhos e próximos passos.', icon: LayoutDashboard },
    { id: 'projects', label: 'Projetos', description: 'Áreas de trabalho, identidade e equipe.', icon: FolderKanban },
    { id: 'calendar', label: 'Agenda', description: 'Consulte ações, reservas e datas da equipe.', icon: CalendarDays },
    { id: 'materials', label: 'Materiais', description: 'Catálogo, disponibilidade e movimentações.', icon: Boxes },
    { id: 'loans', label: 'Empréstimos', description: 'Reservas, retiradas e devoluções de equipamentos.', icon: Truck },
    { id: 'events', label: 'Eventos', description: 'Campanhas e atendimento em cada ação.', icon: CalendarDays },
    { id: 'records', label: 'Registros', description: 'Observações, documentos e ocorrências.', icon: FileText },
    { id: 'team', label: 'Equipe', description: 'Pessoas, convites e permissões de acesso.', icon: Users },
    { id: 'reports', label: 'Relatórios', description: 'Consulte resultados e exporte registros.', icon: ClipboardList },
    { id: 'settings', label: 'Configurações', description: 'Canais e informações institucionais.', icon: Settings2 },
    { id: 'profile', label: 'Conta', description: 'Seu perfil, sua foto e sua senha.', icon: UserRound },
];
export const isModuleId = (value: unknown): value is ModuleId => typeof value === 'string' && PORTAL_MODULES.some(module => module.id === value);
const ROLE_DEFAULTS: Record<string, ModuleId[]> = {
    owner: ['projects', 'calendar', 'materials', 'loans', 'team', 'reports'],
    manager: ['projects', 'calendar', 'materials', 'loans', 'records'],
    operator: ['events', 'calendar', 'records', 'materials', 'projects'],
    inventory: ['materials', 'records', 'calendar', 'projects'],
    loans: ['loans', 'calendar', 'records', 'projects'],
    viewer: ['reports', 'projects', 'calendar', 'records'],
};
export function recommendedModules(role: string, allowed: ModuleId[]): ModuleId[] {
    const candidates = [...(ROLE_DEFAULTS[role] ?? ['projects', 'calendar', 'records']), ...allowed];
    return [...new Set(candidates)].filter(id => id !== 'overview' && id !== 'profile' && allowed.includes(id));
}
