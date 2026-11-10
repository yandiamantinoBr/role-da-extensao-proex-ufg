'use client';

import type { ReactNode } from 'react';
import { CalendarDays, Clock3, Gift, MapPin, ShieldCheck, Ticket } from 'lucide-react';
import PhysicalAttendance from './physical-attendance';
import PendingPrizes from './pending-prizes';
import styles from './volunteer-home.module.css';

// Server projection (portal-data volunteerAccess / physicalTickets / pendingPrizes).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
export type VolunteerAccess = {
  id: string; campaignId: string; campaignName: string; status: string; location: string;
  startsAt: string; campaignEndsAt: string; projectId: string; projectName: string; endsAt: string;
};
const text = (value: unknown) => typeof value === 'string' ? value : '';
export function volunteerAccessFrom(rows: unknown): VolunteerAccess[] {
  return (Array.isArray(rows) ? rows as Row[] : []).filter(row => text(row?.id) && text(row?.campaign_id)).map(row => ({
    id: text(row.id), campaignId: text(row.campaign_id), campaignName: text(row.campaign_name) || 'Ação', status: text(row.status),
    location: text(row.location), startsAt: text(row.starts_at), campaignEndsAt: text(row.campaign_ends_at),
    projectId: text(row.project_id), projectName: text(row.project_name), endsAt: text(row.ends_at),
  }));
}
const DATE_TIME = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Sao_Paulo' });
const DAY = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' });
function moment(iso: string) { const time = Date.parse(iso); return Number.isFinite(time) ? DATE_TIME.format(new Date(time)).replace(',', ' às') : 'data a confirmar'; }
function day(iso: string) { const time = Date.parse(iso); return Number.isFinite(time) ? DAY.format(new Date(time)) : ''; }
function period(start: string, end: string) { const a = day(start), b = day(end); return a && b && a !== b ? `${a} a ${b}` : a || b; }
const STATUS: Record<string, string> = { active: 'Atendimento aberto', paused: 'Atendimento pausado', draft: 'Em preparação', closed: 'Ação encerrada' };

type DeskProps = {
  access: VolunteerAccess[];
  tickets: Row[];
  prizes: Row[];
  mutate: (action: string, payload: Record<string, unknown>) => Promise<Row>;
  /** The prize-code form; rendered by the portal so it shares the same submission handling. */
  redeemForm: ReactNode;
  /** Shown inside the regular portal for people who also belong to a team. */
  compact?: boolean;
};

/** Everything a volunteer can do, and nothing else: the action of the grant, its desk and its prizes. */
export function VolunteerDesk({ access, tickets, prizes, mutate, redeemForm, compact = false }: DeskProps) {
  const ids = new Set(access.map(grant => grant.campaignId));
  const campaigns = access.map(grant => ({ id: grant.campaignId, name: grant.campaignName, status: grant.status, project_id: grant.projectId }));
  const ownTickets = tickets.filter(ticket => ids.has(text(ticket.campaign_id)));
  const ownPrizes = prizes.filter(prize => ids.has(text(prize.campaign_id)));
  const open = access.some(grant => grant.status === 'active');
  return <div className={styles.desk}>
    <section className={styles.grants} aria-label={access.length === 1 ? 'Sua ação' : 'Suas ações'}>
      {access.map(grant => <article key={grant.id} className={styles.grant}>
        <div className={styles.grantTop}>
          <span className={styles.kicker}>{compact ? 'Você também é voluntário(a)' : 'Você é voluntário(a) nesta ação'}</span>
          <span className={grant.status === 'active' ? styles.statusOpen : styles.status}>{STATUS[grant.status] ?? 'Situação a confirmar'}</span>
        </div>
        {compact ? <h2 className={styles.title}>{grant.campaignName}</h2> : <h1 className={styles.title}>{grant.campaignName}</h1>}
        <ul className={styles.facts}>
          {grant.projectName && <li><ShieldCheck size={16} aria-hidden="true"/>{grant.projectName}</li>}
          {grant.location && <li><MapPin size={16} aria-hidden="true"/>{grant.location}</li>}
          {period(grant.startsAt, grant.campaignEndsAt) && <li><CalendarDays size={16} aria-hidden="true"/>{period(grant.startsAt, grant.campaignEndsAt)}</li>}
        </ul>
        <p className={styles.deadline}><Clock3 size={17} aria-hidden="true"/><span>Seu acesso vai até <strong>{moment(grant.endsAt)}</strong> e termina sozinho.</span></p>
        {!compact && <p className={styles.note}>Aqui aparece só o atendimento desta ação. Para trabalhar em outra, peça um novo convite à coordenação.</p>}
      </article>)}
    </section>
    <section className={`p-section ${styles.block}`} aria-label="Atendimento presencial">
      {open ? <PhysicalAttendance simple campaigns={campaigns} tickets={ownTickets} mutate={mutate} initialCampaignId={campaigns.filter(campaign => campaign.status === 'active').length === 1 ? campaigns.find(campaign => campaign.status === 'active')!.id : ''}/>
        : <><div className={styles.blockHead}><span className={styles.blockIcon} aria-hidden="true"><Ticket size={19}/></span><div><h2>Atendimento presencial</h2><p>Registre cada pessoa atendida e o resultado da dinâmica.</p></div></div>
        <p className={styles.waiting}>O atendimento abre quando a coordenação ativar a ação. Atualize esta página na hora do evento.</p></>}
    </section>
    <section className={`p-card ${styles.prizes}`} aria-labelledby="volunteer-prizes-title">
      <div className="p-card-title"><span className="p-icon-tile"><Gift size={21}/></span><div><h3 id="volunteer-prizes-title">Brindes</h3><p>Confirme no portal antes de entregar. Um código já entregue aparece sinalizado.</p></div></div>
      {ownPrizes.length ? <PendingPrizes prizes={ownPrizes} mutate={mutate}/> : <p className={styles.waiting}>Nenhum brinde aguardando entrega.</p>}
      <div className={styles.redeem}>
        <h4>Entregar por código</h4>
        <p>Digite o código que a pessoa apresentar, se ele não estiver na lista acima.</p>
        {redeemForm}
      </div>
    </section>
  </div>;
}
