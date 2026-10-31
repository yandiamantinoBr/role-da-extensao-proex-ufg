import { Boxes, CalendarDays, ClipboardList, Dices, FileText, FolderKanban, LayoutDashboard, ListChecks, Settings2, Truck, UserRound, UserRoundCheck, Users, type LucideIcon } from 'lucide-react';
export type ModuleId = 'overview' | 'projects' | 'events' | 'materials' | 'loans' | 'team' | 'reports' | 'settings' | 'calendar' | 'records' | 'profile' | 'demands' | 'my-work';
export type PortalModule = {
    id: ModuleId;
    label: string;
    description: string;
    icon: LucideIcon;
};
export const PORTAL_MODULES: PortalModule[] = [
    { id: 'overview', label: 'Início', description: 'Seus atalhos, projetos e próximos passos.', icon: LayoutDashboard },
    { id: 'my-work', label: 'Meu trabalho', description: 'Suas demandas, equipes, responsabilidades e prazos.', icon: UserRoundCheck },
    { id: 'projects', label: 'Projetos', description: 'Áreas de trabalho, identidade e equipe.', icon: FolderKanban },
    { id: 'demands', label: 'Demandas', description: 'Prioridades, responsáveis e conferências da equipe.', icon: ListChecks },
    { id: 'calendar', label: 'Agenda', description: 'Consulte ações, reservas e datas da equipe.', icon: CalendarDays },
    { id: 'materials', label: 'Materiais', description: 'Catálogo, disponibilidade e movimentações.', icon: Boxes },
    { id: 'loans', label: 'Empréstimos', description: 'Reservas, retiradas e devoluções de equipamentos.', icon: Truck },
    { id: 'events', label: 'Dinâmicas', description: 'Roleta, dado, brindes e atendimento nas ações.', icon: Dices },
    { id: 'records', label: 'Registros', description: 'Observações, documentos e ocorrências.', icon: FileText },
    { id: 'team', label: 'Equipe', description: 'Pessoas, convites e permissões de acesso.', icon: Users },
    { id: 'reports', label: 'Relatórios', description: 'Consulte resultados e exporte registros.', icon: ClipboardList },
    { id: 'settings', label: 'Configurações', description: 'Canais e informações institucionais.', icon: Settings2 },
    { id: 'profile', label: 'Conta', description: 'Seu perfil, sua foto e sua senha.', icon: UserRound },
];
export const isModuleId = (value: unknown): value is ModuleId => typeof value === 'string' && PORTAL_MODULES.some(module => module.id === value);
const ROLE_DEFAULTS: Record<string, ModuleId[]> = {
    owner: ['projects', 'demands', 'calendar', 'materials', 'loans', 'team', 'reports'],
    manager: ['projects', 'demands', 'calendar', 'materials', 'loans', 'records'],
    operator: ['events', 'demands', 'calendar', 'records', 'materials', 'projects'],
    inventory: ['materials', 'demands', 'records', 'calendar', 'projects'],
    loans: ['loans', 'demands', 'calendar', 'records', 'projects'],
    viewer: ['reports', 'demands', 'projects', 'calendar', 'records'],
};
export function recommendedModules(role: string, allowed: ModuleId[]): ModuleId[] {
    const candidates = [...(ROLE_DEFAULTS[role] ?? ['projects', 'calendar', 'records']), ...allowed];
    return [...new Set(candidates)].filter(id => id !== 'overview' && id !== 'profile' && allowed.includes(id));
}
