import type { ModuleId } from '../components/portal/navigation-model';
import { MY_WORK_STATUSES, type MyWorkStatus } from './my-work/contracts';
import { workRecordFromParams, writeWorkRecordParams, type WorkRecordSelection } from './work-navigation';
import { isReportDataset, type ReportDatasetId } from './report-links';
import { TASK_PRIORITIES, TASK_STATES, type DemandReportFilter } from './follow-up/contracts';

export type PortalLocation = {
    tab: ModuleId;
    project: string;
    unit: string;
    area: string;
    demand: string;
    record: WorkRecordSelection | null;
    /** Conjunto aberto em Relatórios (o botão "Exportar" das outras telas escolhe um). */
    report: ReportDatasetId;
    demandReport?: Omit<DemandReportFilter,'search'> & { needsSearch:boolean; unavailable?:boolean };
    recordsView?: 'history' | 'documents';
    recordsScheduleItemId?: string;
    demandsScheduleItemId?: string;
    workStatus?: MyWorkStatus;
    organization?: string;
    /** Registros: histórico de um assunto só (`history=item:<id>`), vindo do atalho "Ver histórico" das fichas. */
    history?: string;
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

const HISTORY_SUBJECT = /^(item|loan|task|campaign):[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

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
    const demandReportRequested=tab==='reports'&&params.get('report')==='demands'&&params.get('taskFilter')==='1';
    const demandReportOrganization=demandReportRequested&&organizationId&&scope.canSelectOrganization?.(organizationId,project)?organizationId:'';
    const record = workRecordFromParams(params);
    const scheduleCandidate = params.get('scheduleItemId') || '';
    const scheduleItemId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(scheduleCandidate) ? scheduleCandidate : '';
    return {
        tab, project, unit, area,
        demand: tab === 'demands' ? demand : '',
        ...(tab === 'demands' && scheduleItemId ? { demandsScheduleItemId: scheduleItemId } : {}),
        record: record?.module === tab && record.projectId === project && scope.canOpenRecord(record) ? record : null,
        report: tab === 'reports' && isReportDataset(params.get('report')) ? params.get('report') as ReportDatasetId : 'projects',
        ...(demandReportRequested ? {demandReport:{
            organizationId:demandReportOrganization,
            generalOnly:params.get('taskScope')==='organization',
            status:TASK_STATES.find(value=>value===params.get('taskState'))??'all' as const,
            priority:TASK_PRIORITIES.find(value=>value===params.get('taskPriority'))??'all' as const,
            needsSearch:params.get('taskSearch')==='1',
            unavailable:params.get('taskUnavailable')==='1'||Boolean(organizationId&&!demandReportOrganization)||Boolean(projectId&&!project)||(params.get('taskScope')==='organization'&&(!demandReportOrganization||Boolean(projectId))),
        }} : {}),
        ...(tab === 'records' && params.get('view') === 'documents' ? {
            recordsView: 'documents' as const,
            ...(project && scheduleItemId ? { recordsScheduleItemId: scheduleItemId } : {}),
        } : {}),
        workStatus: tab === 'my-work' ? MY_WORK_STATUSES.find(value => value === params.get('workStatus')) ?? 'pending' : 'pending',
        organization,
        history: tab === 'records' && HISTORY_SUBJECT.test(params.get('history') || '') ? params.get('history')! : '',
    };
}

export function writePortalLocation(params: URLSearchParams, route: PortalLocation) {
    const demandReport=route.tab==='reports'&&route.report==='demands'?route.demandReport:undefined;
    for (const [key, value] of Object.entries({
        module: route.tab === 'overview' ? '' : route.tab,
        project: route.project,
        unit: route.unit,
        area: route.area,
        demandId: route.tab === 'demands' ? route.demand : '',
        report: route.tab === 'reports' && route.report !== 'projects' && isReportDataset(route.report) ? route.report : '',
        ...(route.tab === 'records' || params.get('view') === 'documents'
            ? { view: route.tab === 'records' && route.recordsView === 'documents' ? 'documents' : '' } : {}),
        scheduleItemId: route.tab === 'demands' ? route.demandsScheduleItemId || ''
            : route.tab === 'records' && route.recordsView === 'documents' ? route.recordsScheduleItemId || '' : '',
        workStatus: route.tab === 'my-work' && route.workStatus && MY_WORK_STATUSES.includes(route.workStatus) && route.workStatus !== 'pending' ? route.workStatus : '',
        organizationId: demandReport?.organizationId || (route.tab === 'my-work' || route.tab === 'overview' ? route.organization || '' : ''),
        taskFilter: demandReport?'1':'',
        taskScope: demandReport?.generalOnly?'organization':'',
        taskState: demandReport?.status==='all'?'':demandReport?.status??'',
        taskPriority: demandReport?.priority==='all'?'':demandReport?.priority??'',
        taskSearch: demandReport?.needsSearch?'1':'',
        taskUnavailable: demandReport?.unavailable?'1':'',
        history: route.tab === 'records' ? route.history || '' : '',
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
