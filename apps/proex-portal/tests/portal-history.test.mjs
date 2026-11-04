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

const { readPortalLocation, commitPortalLocation } = load('portal-history', { './work-navigation': load('work-navigation') });
const origin = 'https://example.test';
const scope = {
    modules: ['overview', 'projects', 'materials', 'calendar', 'reports', 'demands', 'my-work'],
    units: ['unit-a', 'unit-b', '__unassigned__'],
    areas: ['culture', '__none__'],
    canSelectProject: (id, unit, area) => id === 'project-a' && (!unit || unit === 'unit-a') && (!area || area === 'culture'),
    canOpenRecord: record => record.recordId !== 'unknown-item',
};
const read = (query, current = scope) => readPortalLocation(new URLSearchParams(query), current);

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
