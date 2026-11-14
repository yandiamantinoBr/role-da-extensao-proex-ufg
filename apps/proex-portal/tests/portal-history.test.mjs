import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, dependencies = {}) {
    const compiledModule = { exports: {} };
    const source = readFileSync(new URL(`../lib/${file}.ts`, import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(compiled, { module: compiledModule, exports: compiledModule.exports, URL, URLSearchParams, require: name => dependencies[name] });
    return compiledModule.exports;
}

const { readPortalLocation, commitPortalLocation, deniedPortalModule } = load('portal-history', { './work-navigation': load('work-navigation'), './my-work/contracts': load('my-work/contracts'), './report-links': load('report-links', { './civil-date': load('civil-date') }), './follow-up/contracts':load('follow-up/contracts',{'../errors':load('errors')}) });
const { dashboardLoginDestination, loginHref, safeLoginDestination } = load('login-destination', { './report-links': load('report-links', { './civil-date': load('civil-date') }) });
const origin = 'https://example.test';
const scope = {
    modules: ['overview', 'projects', 'materials', 'calendar', 'reports', 'demands', 'my-work', 'records'],
    units: ['unit-a', 'unit-b', '__unassigned__'],
    areas: ['culture', '__none__'],
    canSelectProject: (id, unit, area) => id === 'project-a' && (!unit || unit === 'unit-a') && (!area || area === 'culture'),
    canOpenRecord: record => record.recordId !== 'unknown-item',
    canSelectOrganization: (organization, project) => organization === 'org-a' && (!project || project === 'project-a'),
};
const read = (query, current = scope) => readPortalLocation(new URLSearchParams(query), current);

test('demand reports retain their enumerated filters across login and reload, while lexical search stays private',()=>{
    const params={module:'reports',report:'demands',taskFilter:'1',taskState:'blocked',taskPriority:'high',taskScope:'organization',organizationId:'org-a',taskSearch:'1',privateTerm:'private-synthetic'};
    const url=new URL(safeLoginDestination(dashboardLoginDestination(params)),origin);
    assert.doesNotMatch(url.href,/private-synthetic/);
    const route=read(url.search);
    assert.deepEqual({...route.demandReport},{status:'blocked',priority:'high',generalOnly:true,organizationId:'org-a',needsSearch:true,unavailable:false});
    const unavailable=read(url.search,{...scope,canSelectOrganization:()=>false});
    assert.equal(unavailable.demandReport.unavailable,true);
    assert.equal(read('module=reports&report=demands&taskFilter=1&taskScope=organization').demandReport.unavailable,true);
});
test('signing in preserves the shared activity, demand or project; access is resolved for that account', () => {
    const afterLogin = params => {
        const login = new URL(loginHref(dashboardLoginDestination(params)), origin);
        assert.equal(login.pathname, '/login');
        return safeLoginDestination(login.searchParams.get('returnTo'));
    };
    const activity = afterLogin({module:'records', project:'project-a', view:'documents', scheduleItemId:'activity-sparks', token:'private', unknown:'no'});
    assert.equal(activity, '/?module=records&project=project-a&view=documents&scheduleItemId=activity-sparks');
    assert.equal(read(new URL(activity, origin).search).recordsScheduleItemId, 'activity-sparks');
    const restricted = read(new URL(activity, origin).search, {...scope, canSelectProject: () => false});
    assert.equal(restricted.project, '');
    assert.equal(restricted.recordsScheduleItemId, undefined);
    const demand = afterLogin({module:['demands', 'settings'], project:'project-a', demandId:'front-a', scheduleItemId:'activity-sparks'});
    assert.equal(read(new URL(demand, origin).search).demand, 'front-a');
    const project = afterLogin({module:'projects', project:'project-a', detailProject:'project-a'});
    assert.equal(read(new URL(project, origin).search).record.recordId, 'project-a');
    const report = new URL(afterLogin({module:'reports', recorte:'1', from:'2026-11-09', to:'2026-11-13', q:'Rolê da Extensão'}), origin);
    assert.equal(report.searchParams.get('from'), '2026-11-09');
    assert.equal(report.searchParams.get('to'), '2026-11-13');
    assert.equal(report.searchParams.get('q'), 'Rolê da Extensão');
    assert.equal(loginHref(dashboardLoginDestination({ token:'private' })), '/login');
});

test('login refuses external or actionable URLs and preserves the existing public activity entry', () => {
    for (const unsafe of [
        'https://outside.example', '//outside.example', '/\\outside.example', '/\t/outside.example', '/%5coutside.example',
        '/api/account', '/login', '/events/../api', '/events/id\n', '/convite?token=private', ['/?module=records'],
    ]) assert.equal(safeLoginDestination(unsafe), '/');
    assert.equal(safeLoginDestination('/?module=records%0A&returnTo=https://outside.example&token=private'), '/');
    assert.equal(safeLoginDestination('/events/activity-2026'), '/events/activity-2026');
    assert.equal(safeLoginDestination('/participante'), '/participante');
});

test('a project documents link survives reload and selecting another module clears its view',()=>{
    const href=origin+'/?module=records&view=documents&project=project-a&scheduleItemId=activity-sparks';
    const documents=read(new URL(href).search);
    assert.equal(documents.recordsView,'documents');
    assert.equal(documents.project,'project-a');
    assert.equal(documents.recordsScheduleItemId,'activity-sparks');
    let location;
    const history={state:null,pushState(_state,_title,url){location=url.href;},replaceState(_state,_title,url){location=url.href;}};
    commitPortalLocation(history,href,{...documents,tab:'projects'},true);
    assert.equal(new URL(location).searchParams.get('view'),null);
    assert.equal(new URL(location).searchParams.get('scheduleItemId'),null);
    assert.equal(read('module=records&view=unknown').recordsView,undefined);
});

test('activity fronts preserve the selected commitment without carrying it into general modules',()=>{
    const fronts=read('module=demands&project=project-a&scheduleItemId=sparks&demandId=front-a');
    assert.equal(fronts.demandsScheduleItemId,'sparks');
    assert.equal(fronts.demand,'front-a');
    assert.equal(read('module=demands&scheduleItemId=foo/bar').demandsScheduleItemId,undefined);
    assert.equal(read('module=overview&scheduleItemId=sparks').demandsScheduleItemId,undefined);
    let location;
    const history={state:null,pushState(_state,_title,url){location=url.href;}};
    const href=origin+'/?module=demands&project=project-a&scheduleItemId=sparks&demandId=front-a';
    commitPortalLocation(history,href,{...fronts,tab:'projects'},true);
    assert.equal(new URL(location).searchParams.get('scheduleItemId'),null);
});

test('module navigation retains each view, replaces filter edits, and restores both directions', () => {
    const entries = [origin + '/'];
    const routerState = { frameworkState: true };
    let position = 0;
    const history = {
        state: routerState,
        pushState(state, _title, url) {
            assert.equal(state, routerState);
            entries.splice(++position, Infinity, url.href);
        },
        replaceState(state, _title, url) {
            assert.equal(state, routerState);
            entries[position] = url.href;
        },
    };
    const commit = (query, push) => commitPortalLocation(history, entries[position], read(query), push);
    const restore = current => read(new URL(entries[position]).searchParams, current);

    commit('module=projects', true);
    commit('module=projects&project=project-a&unit=unit-a&detailProject=project-a', true);
    commit('module=calendar&project=project-a&unit=unit-a', true);
    commit('module=calendar&project=project-a', false);
    commit('module=calendar&project=project-a&unit=unit-a', false);
    commit('module=calendar&project=project-a&unit=unit-a', true);
    assert.equal(entries.length, 4);

    position--;
    const project = restore();
    assert.equal(project.record?.recordId, 'project-a');
    assert.equal(project.unit, 'unit-a');
    commitPortalLocation(history, entries[position], project, false);
    assert.equal(entries.length, 4, 'traversal must preserve Forward');
    position++;
    assert.equal(restore().tab, 'calendar');
    assert.equal(restore().project, 'project-a');
});

test('personal status and organization links survive reload and Back, validate scopes and leave unrelated draft state intact', () => {
    const entries=[origin+'/?draft=keep'], history={state:{draft:'keep'},pushState(_state,_title,url){entries.push(url.href);},replaceState(_state,_title,url){entries[entries.length-1]=url.href;}};
    const commit=query=>commitPortalLocation(history,entries.at(-1),read(query),true);
    commit('module=my-work&project=project-a&organizationId=org-a&workStatus=attention&unit=unit-a&area=culture');
    let restored=read(new URL(entries.at(-1)).searchParams);
    assert.equal(restored.workStatus,'attention');assert.equal(restored.organization,'org-a');assert.equal(restored.project,'project-a');assert.equal(restored.unit,'');assert.equal(restored.area,'');
    assert.equal(new URL(entries.at(-1)).searchParams.get('draft'),'keep');assert.deepEqual(history.state,{draft:'keep'});
    commit('module=my-work&project=project-a&organizationId=org-a&workStatus=due_today');
    assert.equal(read(new URL(entries.at(-1)).searchParams).workStatus,'due_today');
    restored=read(new URL(entries.at(-2)).searchParams);assert.equal(restored.workStatus,'attention');
    assert.equal(read('module=my-work&workStatus=bogus&organizationId=org-b').workStatus,'pending');assert.equal(read('module=my-work&organizationId=org-b').organization,'');
    const demand=read('module=demands&demandId=task-a&workStatus=attention&organizationId=org-a');assert.equal(demand.demand,'task-a');assert.equal(demand.workStatus,'pending');assert.equal(demand.organization,'');
    commitPortalLocation(history,entries.at(-1),demand,false);const params=new URL(entries.at(-1)).searchParams;assert.equal(params.get('demandId'),'task-a');assert.equal(params.has('workStatus'),false);assert.equal(params.has('organizationId'),false);assert.equal(params.get('draft'),'keep');
});

test('traversal validates the snapshot again and removes stale selections without reviving permissions', () => {
    const oldEntry = 'module=materials&project=project-a&unit=unit-a&itemId=item-a';
    assert.equal(read(oldEntry).record?.recordId, 'item-a');
    const restricted = read(oldEntry, { ...scope, modules: ['overview', 'projects'] });
    assert.equal(restricted.tab, 'overview');
    assert.equal(restricted.project, '');
    assert.equal(restricted.unit, '');
    assert.equal(restricted.record, null);
    assert.equal(read(oldEntry, { ...scope, canSelectProject: () => false }).project, '');
    assert.equal(read(oldEntry.replace('item-a', 'unknown-item')).record, null);
    assert.equal(read('module=projects&project=project-a&unit=unit-b&detailProject=project-a').record, null);
});

test('direct demand, report and calendar routes accept only fields meaningful in their module', () => {
    assert.equal(read('demandId=task-a').tab, 'demands');
    assert.equal(read('demandId=task-a').demand, 'task-a');
    assert.equal(read('demandId=%2F%2Foutside').tab, 'overview');
    assert.equal(read('module=reports&report=demands').report, 'demands');
    assert.equal(read('module=calendar&report=demands&area=culture&unit=__unassigned__').report, 'projects');
    const calendar = read('module=calendar&project=project-a&area=culture&unit=__unassigned__');
    assert.equal(calendar.project, 'project-a');
    assert.equal(calendar.area, '');
    assert.equal(calendar.unit, '');
});

test('a link to a module outside the access is read as Início but still reports which module was denied (P6)', () => {
    const known = ['overview', 'projects', 'materials', 'calendar', 'reports', 'demands', 'my-work', 'settings', 'team'];
    const params = new URLSearchParams('module=settings');
    const resolved = read('module=settings');
    assert.equal(resolved.tab, 'overview', 'sem permissão, o endereço leva ao Início');
    assert.equal(deniedPortalModule(params, resolved, known), 'settings', 'e a tela sabe qual módulo explicar');
    assert.equal(deniedPortalModule(new URLSearchParams('module=materials'), read('module=materials'), known), null, 'módulo permitido não gera aviso');
    assert.equal(deniedPortalModule(new URLSearchParams(''), read(''), known), null);
    assert.equal(deniedPortalModule(new URLSearchParams('module=overview'), read('module=overview'), known), null);
    assert.equal(deniedPortalModule(new URLSearchParams('module=inexistente'), read('module=inexistente'), known), null, 'nome desconhecido não vira aviso');
});
