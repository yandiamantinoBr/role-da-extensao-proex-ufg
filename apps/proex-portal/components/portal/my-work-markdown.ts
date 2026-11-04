import {priorityLabels, stateLabels} from '@/lib/follow-up/contracts';
import type {MyWorkResponse} from '@/lib/my-work/contracts';

const targetModules = {projects: 'projects', materials: 'materials', loans: 'loans', campaigns: 'events'} as const;
const recordKeys = {demands: 'demandId', projects: 'detailProject', materials: 'itemId', loans: 'loanId', events: 'campaignId'} as const;
const recordId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

function literal(value: string) {
  return value.replace(/\s+/gu, ' ').replace(/\p{Cc}|\p{Bidi_Control}/gu, '').trim()
    .replace(/[\\`*{}\[\]<>()#+.!_~|^=$:%/@-]/g, '\\$&');
}

function portalLink(origin: string, href: string | null, module: keyof typeof recordKeys) {
  if (!href?.startsWith('/?') || /[\\\s#]/.test(href)) return '';
  const url = new URL(href, origin);
  if (url.origin !== origin || url.pathname !== '/' || !['https:', 'http:'].includes(url.protocol)) return '';
  const recordKey = recordKeys[module];
  const query = new URLSearchParams({module});
  const seen = new Set<string>();
  for (const [key, value] of url.searchParams) {
    if (seen.has(key)) return '';
    seen.add(key);
    if (key === 'module' && value === module) continue;
    if ((key !== 'project' && key !== recordKey) || !recordId.test(value)) return '';
    query.set(key, value);
  }
  if (!seen.has('module') || !query.has(module === 'demands' ? recordKey : 'project')) return '';
  return ` · [Abrir no portal](<${origin}/?${query}>)`;
}

export function myWorkMarkdown(data: MyWorkResponse, origin: string) {
  const taskLines = data.tasks.items.map(task => {
    const date = task.due_at && /^\d{4}-\d{2}-\d{2}$/.test(task.due_at) ? ` · Prazo ${task.due_at}` : '';
    return `- ${literal(task.title) || 'Demanda'} · ${stateLabels[task.status]} · Prioridade ${priorityLabels[task.priority].toLowerCase()}${date}${portalLink(origin, task.href, 'demands')}`;
  });
  const responsibilityLines = data.responsibilities.items.map(row => {
    const {target} = row;
    if (!target.canOpen) return '- Designação ativa · Registro de acesso restrito';
    const name = literal(target.name ?? '') || 'Registro designado';
    return `- ${name} · Designação ativa${portalLink(origin, target.href, targetModules[row.area])}`;
  });
  return [
    '# Meu trabalho · Portal PROEX',
    '',
    'Cópia das páginas exibidas na consulta. Os links exigem acesso ao portal.',
    `Consulta: ${new Date(data.asOf).toISOString()}`,
    '',
    `## Demandas (${taskLines.length} de ${data.tasks.total})`,
    '',
    ...(taskLines.length ? taskLines : ['Nenhuma demanda nesta página.']),
    '',
    `## Responsabilidades (${responsibilityLines.length} de ${data.responsibilities.total})`,
    '',
    ...(responsibilityLines.length ? responsibilityLines : ['Nenhuma responsabilidade nesta página.']),
    '',
  ].join('\n');
}
