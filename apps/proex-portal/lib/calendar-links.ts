import type { CalendarEntry } from './calendar';

type Target = 'projects' | 'demands' | 'materials' | 'loans' | 'events';
type Destination = { module: Target; href: string; label: string };

export function calendarDestination(entry: CalendarEntry): Destination | null {
  const { projectId, sourceId, sourceKind, parentId } = entry;
  if (!sourceId || (!projectId && sourceKind !== 'deadline')) return null;
  const link = (module: Target, key: string, id: string, label: string): Destination => {
    const params = new URLSearchParams({ module, [key]: id });
    if (projectId) params.set('project', projectId);
    return { module, href: `/?${params}`, label };
  };
  switch (sourceKind) {
    case 'project': return link('projects', 'detailProject', projectId, 'Abrir projeto');
    case 'deadline': return link('demands', 'demandId', sourceId, 'Abrir demanda');
    case 'loan': return link('loans', 'loanId', sourceId, 'Abrir empréstimo');
    case 'campaign': return link('events', 'campaignId', sourceId, 'Abrir dinâmica');
    case 'campaign-session': return parentId ? link('events', 'campaignId', parentId, 'Abrir dinâmica do turno') : null;
    case 'movement': return parentId ? link('materials', 'itemId', parentId, 'Abrir material') : null;
    default: return null;
  }
}
