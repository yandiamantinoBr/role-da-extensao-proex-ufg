export const projectAccessRoleLabels: Record<string, string> = {
  manager: 'Gestor de projeto',
  operator: 'Operador de evento',
  inventory: 'Responsável por materiais',
  loans: 'Responsável por empréstimos',
  viewer: 'Leitor de relatórios',
};

export function accessRoleLabel(role: string, organizationId: string | null | undefined): string {
  if (role === 'owner') return organizationId === null ? 'Administração do Portal' : 'Administração da organização';
  return projectAccessRoleLabels[role] ?? 'Integrante';
}

type NamedScope = { id: string; name: string };
export function accessScopeLabel(
  role: string,
  projectId: string | null,
  organizationId: string | null | undefined,
  projects: readonly NamedScope[],
  organizations: readonly NamedScope[],
): string {
  if (projectId) return projects.find(project => project.id === projectId)?.name || 'Projeto';
  if (role === 'owner' && organizationId === null) return 'Todas as organizações do Portal';
  return organizations.find(organization => organization.id === organizationId)?.name || 'Organização';
}

export function projectAccessHref(projectId: string): string {
  return `?module=team&project=${encodeURIComponent(projectId)}`;
}
