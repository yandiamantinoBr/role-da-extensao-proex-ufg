import classification from './catalog/extensao-classificacao';
import units from './catalog/ufg-unidades-2026';

// Classificação das ações de extensão usada pela UFG (CONSUNI 39/2020, FORPROEX).
// Dados puros: usados pelo servidor (validação) e pela interface (formulários e filtros).
export type Option = { key: string; label: string };
export const THEMATIC_AREAS: Option[] = classification.areasTematicas.map(area => ({ key: area.key, label: area.label }));
export const EXTENSION_LINES: (Option & { description: string })[] = classification.linhasDeExtensao.map(line => ({ key: line.key, label: line.label, description: line.description }));
/** Modalidades adotadas pela UFG; "produto" não é modalidade na UFG. */
export const MODALITIES: (Option & { definition: string })[] = classification.modalidades
  .filter(modality => (modality as { ufgAdopted?: boolean }).ufgAdopted !== false)
  .map(modality => ({ key: modality.key, label: modality.label.replace(/\s*\(.*\)$/, ''), definition: modality.definition }));
/** Chave do tipo de projeto (project_types.key) correspondente a cada modalidade. */
export const MODALITY_TYPE_KEYS: Record<string, string> = { programa: 'program', projeto: 'project', curso: 'course', evento: 'event', prestacao_servico: 'service' };
export const UNIT_GROUP_ORDER: string[] = [...units.groupOrder];
export type CatalogUnit = { key: string; name: string; acronym: string; kind: 'proex' | 'academic' | 'agency' | 'external'; group: string; campus: string; officialUrl: string; uncertain?: boolean };
export const UFG_UNITS = units.units as unknown as CatalogUnit[];
export const CATALOG_VERIFIED_AT = units.verifiedAt;

export const areaLabel = (key: unknown) => THEMATIC_AREAS.find(area => area.key === key)?.label ?? '';
export const lineLabel = (key: unknown) => { const line = EXTENSION_LINES.find(item => item.key === key); return line ? `${line.key} · ${line.label}` : ''; };
export function isThematicArea(value: unknown): value is string { return value === '' || THEMATIC_AREAS.some(area => area.key === value); }
export function isExtensionLine(value: unknown): value is string { return value === '' || EXTENSION_LINES.some(line => line.key === value); }

/** Agrupa unidades por grupo institucional, na ordem oficial, para selects com <optgroup>. */
export function groupUnits<T extends { group_label?: string | null; name: string }>(rows: T[]): { group: string; units: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) { const group = row.group_label || 'Outras unidades e parceiros'; groups.set(group, [...(groups.get(group) ?? []), row]); }
  const rank = (group: string) => { const index = UNIT_GROUP_ORDER.indexOf(group); return index < 0 ? UNIT_GROUP_ORDER.length : index; };
  return [...groups.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b, 'pt-BR'))
    .map(([group, list]) => ({ group, units: list.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')) }));
}
