'use client';

import { useRef, useState, type FormEvent } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import { useFormDraft, DraftNotice } from './use-form-draft';

// Campaign projections and mutation responses are validated by the server.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
type Props = { projects: Row[]; offers: Row[]; initial?: Row; defaultProject?: string; mutate: (action: string, payload: Record<string, unknown>) => Promise<Row> };
function localDate(value: unknown) {
  if (!value) return '';
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) return '';
  const part = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}T${part(date.getHours())}:${part(date.getMinutes())}`;
}

export default function CampaignForm({ projects, offers, initial, defaultProject, mutate }: Props) {
  const [projectId, setProjectId] = useState(String(initial?.project_id ?? initial?.projectId ?? defaultProject ?? projects[0]?.id ?? ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const key = useRef<string | null>(null), formRef = useRef<HTMLFormElement>(null);
  const editing = Boolean(initial?.id);
  const draft = useFormDraft(formRef, `campaign:${initial?.id ?? 'new'}:${initial?.version ?? 0}`);
  const scopedOffers = offers.filter(o => (o.project_id ?? o.projectId) === projectId);
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving) return;
    const form = event.currentTarget; const values = new FormData(form);
    setSaving(true); setError(''); key.current ??= crypto.randomUUID();
    try {
      const date = (name: string) => values.get(name) ? new Date(String(values.get(name))).toISOString() : null;
      await mutate(editing ? 'campaign.update' : 'campaign.create', {
        ...(editing ? { id: initial?.id, expectedVersion: initial?.version } : { projectId }),
        name: values.get('name'), location: values.get('location'), startsAt: date('startsAt'), endsAt: date('endsAt'),
        retryLimit: values.get('retryLimit') !== '' ? Number(values.get('retryLimit')) : null,
        rulesText: values.get('rulesText'), brindeOfferId: values.get('brindeOfferId') || null,
        superOfferId: values.get('superOfferId') || null, operationKey: key.current,
      });
      key.current = null;
      draft.clear();
      if (!editing) form.reset();
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível salvar o evento.'); }
    finally { setSaving(false); }
  }
  return <form ref={formRef} className="p-form" onSubmit={send} onChange={() => { if (!saving) key.current = null; }}><DraftNotice draft={draft}/><fieldset disabled={saving}>
    <div className="p-form-grid">
      {!editing && <label className="p-field"><span>Projeto</span><select name="projectId" required value={projectId} onChange={e => setProjectId(e.target.value)}><option value="">Selecione o projeto</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
      <label className="p-field"><span>Nome do evento</span><input name="name" required maxLength={120} defaultValue={initial?.name ?? ''} placeholder="Nome da ação ou do evento" /></label>
      <label className="p-field"><span>Local</span><input name="location" maxLength={200} defaultValue={initial?.location ?? ''} placeholder="Unidade, escola ou espaço" /></label>
      <label className="p-field"><span>Quando sair Tente novamente</span><select name="retryLimit" defaultValue={initial?.retry_limit ?? initial?.retryLimit ?? ''}><option value="">Definir antes de ativar</option><option value="0">Sem repetição; Tente novamente encerra</option><option value="1">Conceder até 1 repetição</option><option value="2">Conceder até 2 repetições</option><option value="3">Conceder até 3 repetições</option></select><small>A regra precisa ser decidida pela equipe e publicada ao participante.</small></label>
      <label className="p-field"><span>Início</span><input name="startsAt" type="datetime-local" required defaultValue={localDate(initial?.starts_at ?? initial?.startsAt)} /></label>
      <label className="p-field"><span>Fim</span><input name="endsAt" type="datetime-local" required defaultValue={localDate(initial?.ends_at ?? initial?.endsAt)} /></label>
      <label className="p-field"><span>Oferta de Brinde</span><select name="brindeOfferId" defaultValue={initial?.brinde_offer_id ?? initial?.brindeOfferId ?? ''}><option value="">Definir antes de ativar</option>{scopedOffers.filter(o => o.kind === 'brinde').map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
      <label className="p-field"><span>Oferta de Super Brinde</span><select name="superOfferId" defaultValue={initial?.super_offer_id ?? initial?.superOfferId ?? ''}><option value="">Definir antes de ativar</option>{scopedOffers.filter(o => o.kind === 'super').map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
    </div>
    <label className="p-field"><span>Regras e orientação de retirada</span><textarea name="rulesText" rows={4} maxLength={4000} defaultValue={initial?.rules_text ?? initial?.rulesText ?? ''} placeholder="Regras aprovadas pela equipe para esta campanha" /><small>Descreva limite, repetições, privacidade e retirada. Evite dados pessoais. Os horários usam o fuso deste aparelho.</small></label>
    <p className="p-form-help">Regras e ofertas podem ser revisadas enquanto o evento estiver em rascunho. Após ativar, esses dados ficam preservados para manter o histórico.</p>
    <div className="p-form-footer">{error && <p className="p-inline-error" role="alert">{error}</p>}<button className="p-button p-button-primary" type="submit">{saving ? <LoaderCircle size={17} className="p-spin" /> : <Check size={17} />}{saving ? 'Salvando…' : editing ? 'Salvar alterações' : 'Salvar rascunho'}</button></div>
  </fieldset></form>;
}
