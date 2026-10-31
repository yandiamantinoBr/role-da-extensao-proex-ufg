'use client';

import { useState } from 'react';
import EmailSettingsPanel from './email-settings-panel';

type Organization = { id: string; name: string; status: string };

export default function OrganizationEmailSettings({ userId, organizations }: {
  userId: string;
  organizations: Organization[];
}) {
  const [selected, setSelected] = useState('');
  const [expanded, setExpanded] = useState(false);
  const active = organizations.filter(organization => organization.status === 'active');
  const organizationId = active.some(organization => organization.id === selected)
    ? selected : active[0]?.id;

  if (!organizationId) return null;

  return <details className="p-card mt-5 min-w-0" onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary className="min-h-11 cursor-pointer py-2 text-lg font-semibold">Avisos por e-mail</summary>
    {expanded && <div className="space-y-4 pt-3" role="region" aria-label="Preferências de e-mail por organização">
    <div>
      <p className="text-sm text-[var(--muted)]">Escolha em quais organizações deseja receber avisos. A equipe precisa configurar a conta remetente antes do primeiro envio.</p>
    </div>
    {active.length > 1 && <label className="block text-sm">Organização dos avisos
      <select value={organizationId} onChange={event => setSelected(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--canvas)] px-3 text-base text-[var(--ink)]">
        {active.map(organization => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
      </select>
    </label>}
    <EmailSettingsPanel key={`${userId}:${organizationId}`} organizationId={organizationId}/>
    </div>}
  </details>;
}
