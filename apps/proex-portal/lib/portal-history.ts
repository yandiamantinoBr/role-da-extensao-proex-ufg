import type { ModuleId } from '../components/portal/navigation-model';
import { workRecordFromParams, writeWorkRecordParams, type WorkRecordSelection } from './work-navigation';

export type PortalLocation = {
    tab: ModuleId;
    project: string;
    unit: string;
    area: string;
    demand: string;
    record: WorkRecordSelection | null;
    report: 'projects' | 'demands';
};

type Scope = {
    modules: readonly ModuleId[];
    units: readonly string[];
    areas: readonly string[];
    canSelectProject: (project: string, unit: string, area: string) => boolean;
    canOpenRecord: (record: WorkRecordSelection) => boolean;
};

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
    const record = workRecordFromParams(params);
    return {
        tab, project, unit, area,
        demand: tab === 'demands' ? demand : '',
        record: record?.module === tab && record.projectId === project && scope.canOpenRecord(record) ? record : null,
        report: tab === 'reports' && params.get('report') === 'demands' ? 'demands' : 'projects',
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
