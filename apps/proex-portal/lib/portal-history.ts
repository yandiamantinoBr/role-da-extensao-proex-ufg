import type { ModuleId } from '../components/portal/navigation-model';
import { MY_WORK_STATUSES, type MyWorkStatus } from './my-work/contracts';
import { workRecordFromParams, writeWorkRecordParams, type WorkRecordSelection } from './work-navigation';

export type PortalLocation = {
    tab: ModuleId;
    project: string;
    unit: string;
    area: string;
    demand: string;
    record: WorkRecordSelection | null;
    report: 'projects' | 'demands';
    recordsView?: 'history' | 'documents';
    recordsScheduleItemId?: string;
    workStatus?: MyWorkStatus;
    organization?: string;
};

type Scope = {
    modules: readonly ModuleId[];
    units: readonly string[];
    areas: readonly string[];
    canSelectProject: (project: string, unit: string, area: string) => boolean;
    canOpenRecord: (record: WorkRecordSelection) => boolean;
    canSelectOrganization?: (organization: string, project: string) => boolean;
};

/**
 * P6 (revisão de 09/11): o módulo pedido no endereço que a pessoa não pode abrir. readPortalLocation troca esse
 * pedido por Início; esta função diz qual foi, para a tela explicar em vez de voltar em silêncio.
 */
export function deniedPortalModule(params: URLSearchParams, resolved: PortalLocation, known: readonly string[]): string | null {
    const asked = params.get('module');
    return asked && asked !== 'overview' && resolved.tab === 'overview' && known.includes(asked) ? asked : null;
}

export function readPortalLocation(params: URLSearchParams, scope: Scope): PortalLocation {
    const candidate = params.get('demandId') || '';
    const demand = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(candidate) ? candidate : '';
    const requested = params.get('module') || (demand ? 'demands' : 'overview');
    const tab = scope.modules.find(module => module === requested);
    if (!tab) return { tab: 'overview', project: '', unit: '', area: '', demand: '', record: null, report: 'projects' };

    const unitId = params.get('unit') || '';
    const areaId = params.get('area') || '';
    const supportsUnit = tab !== 'my-work' && (tab !== 'calendar' || unitId !== '__unassigned__');
    const unit = supportsUnit && scope.units.includes(unitId) ? unitId : '';
    const area = tab !== 'my-work' && tab !== 'calendar' && scope.areas.includes(areaId) ? areaId : '';
    const projectId = params.get('project') || '';
    const project = projectId && scope.canSelectProject(projectId, unit, area) ? projectId : '';
    const organizationId = params.get('organizationId') || '';
    const organization = (tab === 'my-work' || tab === 'overview') && organizationId && scope.canSelectOrganization?.(organizationId, project) ? organizationId : '';
    const record = workRecordFromParams(params);
    const scheduleItemId = params.get('scheduleItemId') || '';
    return {
        tab, project, unit, area,
        demand: tab === 'demands' ? demand : '',
        record: record?.module === tab && record.projectId === project && scope.canOpenRecord(record) ? record : null,
        report: tab === 'reports' && params.get('report') === 'demands' ? 'demands' : 'projects',
        ...(tab === 'records' && params.get('view') === 'documents' ? {
            recordsView: 'documents' as const,
            ...(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(scheduleItemId) ? { recordsScheduleItemId: scheduleItemId } : {}),
        } : {}),
        workStatus: tab === 'my-work' ? MY_WORK_STATUSES.find(value => value === params.get('workStatus')) ?? 'pending' : 'pending',
        organization,
    };
}

export function writePortalLocation(params: URLSearchParams, route: PortalLocation) {
    for (const [key, value] of Object.entries({
        module: route.tab === 'overview' ? '' : route.tab,
        project: route.project,
        unit: route.unit,
        area: route.area,
        demandId: route.tab === 'demands' ? route.demand : '',
        report: route.tab === 'reports' && route.report === 'demands' ? 'demands' : '',
        ...(route.tab === 'records' || params.get('view') === 'documents'
            ? { view: route.tab === 'records' && route.recordsView === 'documents' ? 'documents' : '' } : {}),
        scheduleItemId: route.tab === 'records' && route.recordsView === 'documents' ? route.recordsScheduleItemId || '' : '',
        workStatus: route.tab === 'my-work' && route.workStatus && MY_WORK_STATUSES.includes(route.workStatus) && route.workStatus !== 'pending' ? route.workStatus : '',
        organizationId: route.tab === 'my-work' || route.tab === 'overview' ? route.organization || '' : '',
    })) {
        if (value) params.set(key, value);
        else params.delete(key);
    }
    writeWorkRecordParams(params, route.record, route.tab, route.project);
}

export function portalLocationKey(route: PortalLocation) {
    const params = new URLSearchParams();
    writePortalLocation(params, route);
    return params.toString();
}

export function commitPortalLocation(history: Pick<History, 'state' | 'pushState' | 'replaceState'>, href: string, route: PortalLocation, push: boolean) {
    const url = new URL(href);
    writePortalLocation(url.searchParams, route);
    if (push) url.hash = '';
    if (url.href !== href) history[push ? 'pushState' : 'replaceState'](history.state, '', url);
}
