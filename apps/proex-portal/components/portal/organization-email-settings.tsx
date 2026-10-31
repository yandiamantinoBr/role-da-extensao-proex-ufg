'use client';

import { useState } from 'react';
import EmailSettingsPanel from './email-settings-panel';

type Organization = { id: string; name: string; status: string };

export default function OrganizationEmailSettings({ userId, organizations }: {
  userId: string;
  organizations: Organization[];
}) {
  const [selected, setSelected] = useState('');
  const active = organizations.filter(organization => organization.status === 'active');
  const organizationId = active.some(organization => organization.id === selected)
    ? selected : active[0]?.id;

  if (!organizationId) return null;

  return <section className="p-card mt-5 min-w-0 space-y-4" aria-label="Preferências de e-mail por organização">
    <div>
      <h2 className="text-lg font-semibold">Avisos por e-mail</h2>
      <p className="text-sm text-[var(--muted)]">Escolha em quais organizações deseja receber avisos. A equipe precisa configurar a conta remetente antes do primeiro envio.</p>
    </div>
    {active.length > 1 && <label className="block text-sm">Organização dos avisos
      <select value={organizationId} onChange={event => setSelected(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--canvas)] px-3 text-base text-[var(--ink)]">
        {active.map(organization => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
      </select>
    </label>}
    <EmailSettingsPanel key={`${userId}:${organizationId}`} organizationId={organizationId}/>
  </section>;
}
