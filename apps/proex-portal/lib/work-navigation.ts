export type WorkRecordModule = 'projects' | 'materials' | 'loans' | 'events';
export type WorkRecordSelection = { module: WorkRecordModule; projectId: string; recordId: string };
const fields = { projects: 'detailProject', materials: 'itemId', loans: 'loanId', events: 'campaignId' } as const;
const validId = (value: string | null): value is string => !!value && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);

/** URL hints select a visible record; domain APIs still decide authorization. */
export function workRecordFromParams(params: URLSearchParams): WorkRecordSelection | null {
 const requestedModule = params.get('module'), projectId = params.get('project');
 if (!requestedModule || !Object.hasOwn(fields, requestedModule) || !validId(projectId)) return null;
 const key = requestedModule as WorkRecordModule, recordId = params.get(fields[key]);
 if (!validId(recordId) || key === 'projects' && recordId !== projectId) return null;
 return { module: key, projectId, recordId };
}
export function writeWorkRecordParams(params: URLSearchParams, selection: WorkRecordSelection | null, module: string, projectId: string) {
 for (const key of Object.values(fields)) params.delete(key);
 if (selection && selection.module === module && selection.projectId === projectId) params.set(fields[selection.module], selection.recordId);
}
