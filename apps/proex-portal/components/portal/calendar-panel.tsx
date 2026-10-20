'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Copy, Download, ExternalLink, Link2, LoaderCircle, RefreshCw, ShieldCheck, X } from 'lucide-react';
import type { CalendarCategory, CalendarEntry } from '@/lib/calendar';

type Feed = { id: string; category: CalendarCategory; project_id: string | null; project_name: string | null; created_at: string; expires_at: string; revoked_at: string | null };
type CalendarData = { entries: CalendarEntry[]; feeds: Feed[]; availableCategories: CalendarCategory[] };
const labels: Record<CalendarCategory, string> = { loans: 'Empréstimos', materials: 'Materiais', projects: 'Projetos e eventos', consumption: 'Consumo' };
const colors: Record<CalendarCategory, string> = { loans: '#54216C', materials: '#CE5F18', projects: '#19669C', consumption: '#307A55' };
const weekday = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const timeZone = 'America/Sao_Paulo';
function civilDay(value: string | Date): string { return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)); }
function monthRange(value: string): { from: string; to: string } { const first = `${value.slice(0, 7)}-01`, end = new Date(`${first}T12:00:00Z`); end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0); return { from: first, to: end.toISOString().slice(0, 10) }; }
function inDay(event: CalendarEntry, day: string): boolean {
  const start = Date.parse(`${day}T00:00:00-03:00`), end = start + 86400000;
  return event.allDay ? event.startsAt <= day && event.endsAt > day : Date.parse(event.startsAt) < end && Date.parse(event.endsAt) > start;
}
function prettyDay(day: string): string { return new Intl.DateTimeFormat('pt-BR', { timeZone, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${day}T12:00:00Z`)); }
function when(event: CalendarEntry): string {
  if (event.allDay) return `${prettyDay(event.startsAt)} · Dia inteiro`;
  const format = new Intl.DateTimeFormat('pt-BR', { timeZone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return `${format.format(new Date(event.startsAt))} → ${format.format(new Date(event.endsAt))}`;
}

export default function CalendarPanel({ projects: sourceProjects }: { projects: Record<string, unknown>[] }) {
  const projects = useMemo(() => sourceProjects.filter(project => typeof project.id === 'string' && typeof project.name === 'string')
    .map(project => ({ id: project.id as string, name: project.name as string })), [sourceProjects]);
  const initial = useMemo(() => monthRange(civilDay(new Date())), []);
  const [from, setFrom] = useState(initial.from), [to, setTo] = useState(initial.to);
  const [category, setCategory] = useState('all'), [projectId, setProjectId] = useState('');
  const [data, setData] = useState<CalendarData | null>(null), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [error, setError] = useState(''), [reload, setReload] = useState(0), [selectedDay, setSelectedDay] = useState('');
  const [feedCategory, setFeedCategory] = useState<CalendarCategory>('projects'), [createdFeed, setCreatedFeed] = useState<{ id: string; feedUrl: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const query = useMemo(() => new URLSearchParams({ from, to, category, ...(projectId ? { projectId } : {}) }).toString(), [from, to, category, projectId]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    fetch(`/api/calendar?${query}`, { cache: 'no-store', signal: controller.signal }).then(async response => {
      const result = await response.json() as CalendarData & { error?: string }; if (!response.ok) throw new Error(result.error || 'Não foi possível consultar a agenda.');
      setData(result); setFeedCategory(current => result.availableCategories.includes(current) ? current : result.availableCategories[0]);
    }).catch(e => { if (e.name !== 'AbortError') { setError(e.message); setData(null); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, reload]);
  async function mutate(action: string, payload: Record<string, unknown>) {
    if (saving) return; setSaving(true); setError('');
    try {
      const response = await fetch('/api/calendar', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify({ action, ...payload }) });
      const result = await response.json() as { id: string; feedUrl: string; expiresAt: string; error?: string }; if (!response.ok) throw new Error(result.error || 'Não foi possível salvar.');
      if (action === 'feed.create') { setCreatedFeed(result); setCopied(false); }
      if (action === 'feed.revoke' && createdFeed?.id === payload.id) setCreatedFeed(null);
      setReload(value => value + 1);
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível salvar.'); }
    finally { setSaving(false); }
  }
  const displayMonth = /^\d{4}-\d{2}-\d{2}$/.test(from) ? from.slice(0, 7) : initial.from.slice(0, 7);
  function shiftMonth(delta: number) { const date = new Date(`${displayMonth}-01T12:00:00Z`); date.setUTCMonth(date.getUTCMonth() + delta); const next = monthRange(date.toISOString().slice(0, 10)); setFrom(next.from); setTo(next.to); setSelectedDay(''); }
  const monthStart = new Date(`${displayMonth}-01T12:00:00Z`), monthEnd = new Date(monthStart); monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1); monthEnd.setUTCDate(0);
  const cells = [...Array(monthStart.getUTCDay()).fill(null), ...Array.from({ length: monthEnd.getUTCDate() }, (_, i) => `${displayMonth}-${String(i + 1).padStart(2, '0')}`)];
  const entries = data?.entries ?? [], shown = selectedDay ? entries.filter(event => inDay(event, selectedDay)) : entries;
  const today = civilDay(new Date());
  const activeFeeds = data?.feeds.filter(feed => !feed.revoked_at && Date.parse(feed.expires_at) > Date.now()) ?? [];
  const googleUrl = createdFeed ? `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(createdFeed.feedUrl)}` : '';

  return <div className="p-calendar-panel" style={{ display: 'grid', gap: 20 }}>
    <div className="p-card">
      <div className="p-card-title"><span className="p-icon-tile"><CalendarDays size={21} /></span><div><h3>Agenda integrada</h3><p>Reservas, eventos e registros reais, em horário de Brasília.</p></div></div>
      <div className="p-form-grid">
        <label className="p-field"><span>Categoria</span><select value={category} onChange={e => { setCategory(e.target.value); setSelectedDay(''); }}><option value="all">Todas as categorias permitidas</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="p-field"><span>Projeto</span><select value={projectId} onChange={e => { setProjectId(e.target.value); setSelectedDay(''); }}><option value="">Todos os projetos permitidos</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
        <label className="p-field"><span>De</span><input type="date" value={from} onChange={e => { setFrom(e.target.value); setSelectedDay(''); }} /></label>
        <label className="p-field"><span>Até</span><input type="date" value={to} min={from} onChange={e => { setTo(e.target.value); setSelectedDay(''); }} /></label>
      </div>
      <div className="p-inline" style={{ flexWrap: 'wrap', marginTop: 12 }}><button type="button" className="p-button p-button-subtle" onClick={() => setReload(value => value + 1)} disabled={loading}><RefreshCw size={16} />Atualizar</button><a className="p-button p-button-subtle" href={`/api/calendar?${query}&format=ics`}><Download size={16} />Baixar este período (.ics)</a></div>
      {error && <p className="p-inline-error" role="alert">{error}</p>}
      <p className="p-form-help">Materiais e consumo mostram movimentações já registradas. O saldo do estoque não cria compromissos futuros. Documentos, contatos e observações internas ficam no portal.</p>
    </div>

    <section className="p-card" aria-label="Visão mensal da agenda" aria-busy={loading}>
      <div className="p-card-title" style={{ justifyContent: 'space-between', gap: 8 }}><button type="button" className="p-button p-button-subtle" aria-label="Mês anterior" onClick={() => shiftMonth(-1)}><ChevronLeft size={18} /></button><h3 style={{ textTransform: 'capitalize', textAlign: 'center' }}>{new Intl.DateTimeFormat('pt-BR', { timeZone, month: 'long', year: 'numeric' }).format(monthStart)}</h3><button type="button" className="p-button p-button-subtle" aria-label="Próximo mês" onClick={() => shiftMonth(1)}><ChevronRight size={18} /></button></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,minmax(0,1fr))', gap: 4 }}>
        {weekday.map(day => <span key={day} style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-secondary)', padding: '8px 0' }}>{day}</span>)}
        {cells.map((day, index) => {
          if (!day) return <span key={`empty-${index}`} />;
          const dayEntries = entries.filter(event => inDay(event, day));
          return <button type="button" key={day} onClick={() => setSelectedDay(current => current === day ? '' : day)} aria-pressed={selectedDay === day} aria-label={`${prettyDay(day)}, ${dayEntries.length} registros`} style={{ minHeight: 68, padding: '8px 2px', borderRadius: 12, border: `1px solid ${selectedDay === day ? 'var(--brand-ink)' : 'var(--line)'}`, background: selectedDay === day ? 'var(--surface-soft)' : 'var(--surface)', color: 'var(--ink)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, font: 'inherit' }}><strong style={{ fontSize: 14, borderBottom: day === today ? '2px solid #CE5F18' : undefined }}>{Number(day.slice(-2))}</strong><span style={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'center' }}>{[...new Set(dayEntries.map(event => event.category))].map(kind => <span key={kind} style={{ width: 6, height: 6, borderRadius: 8, background: colors[kind] }} />)}</span>{dayEntries.length > 0 && <small style={{ fontSize: 10 }}>{dayEntries.length}</small>}</button>;
        })}
      </div>
      <div className="p-inline" style={{ flexWrap: 'wrap', marginTop: 14, gap: 12 }}>{Object.entries(labels).map(([key, label]) => <small key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: 8, background: colors[key as CalendarCategory] }} />{label}</small>)}</div>
    </section>

    <section className="p-card" aria-label="Lista de compromissos">
      <div className="p-card-title"><div><h3>{selectedDay ? prettyDay(selectedDay) : 'Agenda do período'}</h3><p>{loading ? 'Consultando registros…' : `${shown.length} registro(s)`}</p></div>{selectedDay && <button type="button" className="p-button p-button-subtle" onClick={() => setSelectedDay('')}><X size={15} />Ver período</button>}</div>
      {loading ? <p className="p-form-help"><LoaderCircle size={17} className="p-spin" /> Carregando agenda…</p> : !shown.length ? <p className="p-form-help">Nenhum registro neste intervalo e nos projetos permitidos. Cadastre uma reserva, evento ou movimentação para vê-los aqui.</p> : <div style={{ display: 'grid', gap: 10 }}>{shown.map(event => <article key={event.uid} style={{ borderLeft: `4px solid ${colors[event.category]}`, background: 'var(--surface-soft)', padding: '12px 14px', borderRadius: 10 }}><small style={{ color: 'var(--brand-ink)', fontWeight: 700 }}>{labels[event.category]}</small><h4 style={{ margin: '5px 0', overflowWrap: 'anywhere', textDecoration: event.status === 'CANCELLED' ? 'line-through' : undefined }}>{event.title}</h4><p style={{ margin: '4px 0', fontSize: 13 }}>{when(event)}</p><p style={{ margin: '4px 0', fontSize: 13, color: 'var(--text-secondary)' }}>{event.projectName}{event.location ? ` · ${event.location}` : ''}{event.status === 'CANCELLED' ? ' · Cancelado / arquivado' : ''}</p></article>)}</div>}
    </section>

    <section className="p-card">
      <div className="p-card-title"><span className="p-icon-tile"><Link2 size={20} /></span><div><h3>Acompanhar no Google Calendar</h3><p>Assinatura de consulta, separada por categoria e projeto.</p></div></div>
      <p className="p-form-help">O Google consulta este link e decide quando atualizar. Alterações no Google não mudam o portal. Importar o arquivo .ics cria uma cópia; assinar a URL permite consultar atualizações. A agenda mostra um ano passado e um ano futuro.</p>
      <div className="p-form-grid"><label className="p-field"><span>Categoria da assinatura</span><select value={feedCategory} onChange={e => setFeedCategory(e.target.value as CalendarCategory)}>{(data?.availableCategories ?? []).map(value => <option key={value} value={value}>{labels[value]}</option>)}</select></label><div className="p-field"><span>Escopo</span><p style={{ margin: '10px 0' }}>{projects.find(project => project.id === projectId)?.name || 'Todos os projetos — exige permissão geral'}</p></div></div>
      <button type="button" className="p-button p-button-primary" disabled={saving || !data?.availableCategories.length} onClick={() => void mutate('feed.create', { category: feedCategory, projectId: projectId || null })}>{saving ? <LoaderCircle size={16} className="p-spin" /> : <Link2 size={16} />}Gerar link de assinatura</button>
      {createdFeed && <div style={{ marginTop: 18, padding: 16, background: 'var(--surface-soft)', borderRadius: 14 }}><p><ShieldCheck size={17} /> Este link permite consultar a categoria escolhida. Guarde-o com cuidado; ele aparece somente agora e pode ser revogado abaixo.</p><label className="p-field"><span>URL privada de assinatura</span><input readOnly value={createdFeed.feedUrl} onFocus={e => e.target.select()} /></label><div className="p-inline" style={{ flexWrap: 'wrap' }}><button type="button" className="p-button p-button-subtle" onClick={() => void navigator.clipboard.writeText(createdFeed.feedUrl).then(() => setCopied(true)).catch(() => setError('Selecione o link e copie pelo menu do aparelho.'))}><Copy size={15} />{copied ? 'Copiado' : 'Copiar link'}</button><a className="p-button p-button-primary" href={googleUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} />Abrir no Google Calendar</a></div><p className="p-form-help">No computador, use a conta Google do responsável e confirme a assinatura. Se necessário: Outras agendas → + → Do URL. Cole o link acima. Depois a agenda pode aparecer no aplicativo do celular. Validade até {prettyDay(createdFeed.expiresAt.slice(0, 10))}.</p></div>}
      <div style={{ marginTop: 22 }}><h4>Minhas assinaturas ativas ({activeFeeds.length})</h4>{!activeFeeds.length ? <p className="p-form-help">Nenhuma assinatura ativa. Gere uma por categoria que deseja acompanhar.</p> : activeFeeds.map(feed => <div key={feed.id} className="p-inline" style={{ justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}><span><strong>{labels[feed.category]}</strong><small style={{ display: 'block' }}>{feed.project_name || 'Todos os projetos'} · Expira em {prettyDay(feed.expires_at.slice(0, 10))}</small></span><button type="button" className="p-button p-button-subtle" disabled={saving} onClick={() => void mutate('feed.revoke', { id: feed.id })}>Revogar link</button></div>)}</div>
      <p className="p-form-help">Ao revogar, novas consultas deixam de funcionar. O Google pode manter cópias já recebidas; remova a assinatura também no Calendar. Para recuperar um link perdido, revogue o antigo e gere outro.</p>
    </section>
  </div>;
}
