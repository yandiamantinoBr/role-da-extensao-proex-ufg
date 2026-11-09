'use client';
import { useEffect, useState } from 'react';
import { CalendarClock, CheckCheck, Heart, Lightbulb, LoaderCircle, Package, PartyPopper, Pause, Play, Power, Sparkles, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import DateField from './date-field';
import { civilDay, communityGet, communityPost, errorText } from './community-api';
import styles from './community.module.css';

type BadgeView = { id: 'closer' | 'helpful' | 'thanks' | 'field'; label: string; hint: string; thisWeek: boolean; times: number };
type State = { enabled: boolean; paused: boolean; pausedUntil: string | null; version: number; week?: string; level?: number; seenLevel?: number; total?: number; nextLevelAt?: number | null; badges?: BadgeView[] };
const API = '/api/community/badges';
/** Provisional marks: plain shapes, clearly labelled, until the communication team delivers the art. */
const SHAPE: Record<BadgeView['id'], string> = { closer: 'circle', helpful: 'hexagon', thanks: 'heart', field: 'square' };
const ICON: Record<BadgeView['id'], LucideIcon> = { closer: CheckCheck, helpful: Lightbulb, thanks: Heart, field: Package };

export function CommunityBadges() {
  const [state, setState] = useState<State | null>(null), [error, setError] = useState(''), [revision, setRevision] = useState(0), [busy, setBusy] = useState(false), [pauseUntil, setPauseUntil] = useState('');
  useEffect(() => {
    let live = true;
    communityGet<State>(API).then(result => { if (live) { setState(result); setError(''); } }).catch(cause => { if (live) setError(errorText(cause, 'Não foi possível abrir seus selos.')); });
    return () => { live = false; };
  }, [revision]);
  async function save(enabled: boolean, pausedUntil: string | null, done: string) {
    if (!state) return; setBusy(true);
    try { await communityPost(API, { action: 'preferences', enabled, pausedUntil, expectedVersion: state.version }); toast.success(done); setPauseUntil(''); setRevision(value => value + 1); }
    catch (cause) { toast.error(errorText(cause)); } finally { setBusy(false); }
  }
  async function seen(level: number) { try { await communityPost(API, { action: 'seen', level }); setRevision(value => value + 1); } catch (cause) { toast.error(errorText(cause)); } }
  if (error) return <p role="alert" className="p-inline-error">{error}</p>;
  if (!state) return <p role="status" className={styles.help}>Abrindo selos…</p>;
  if (!state.enabled) return <section className={`${styles.card} ${styles.single}`}>
    <div className={styles.cardHead}><h2>Selos desligados</h2><p>Você escolheu não ver selos nem níveis. Nada é calculado enquanto estiverem desligados.</p></div>
    <button type="button" className="p-button p-button-primary" disabled={busy} onClick={() => void save(true, null, 'Selos ligados')}><Power size={16}/>Ligar selos</button>
  </section>;
  const levelUp = !state.paused && (state.level ?? 1) > (state.seenLevel ?? 1);
  const progress = state.nextLevelAt ? Math.min(1, ((state.total ?? 0) - ((state.level ?? 1) - 1) * 3) / 3) : 1;
  return <div className={styles.badgesLayout}>
    {levelUp && <p className={styles.celebrate} role="status"><PartyPopper size={20} aria-hidden="true"/><span><strong>Parabéns, nível {state.level}!</strong> Você variou o jeito de contribuir. Sem pressa para o próximo.</span><button type="button" className="p-button p-button-subtle" onClick={() => void seen(state.level ?? 1)}>Ok</button></p>}
    <section className={styles.card} aria-labelledby="badges-level">
      <div className={styles.cardHead}><div><h2 id="badges-level">Seus selos</h2><p>Só você vê. Não há ranking nem comparação com outras pessoas.</p></div></div>
      {state.paused ? <p className={styles.callout}><Pause size={16} aria-hidden="true"/><span>Selos em pausa até {civilDay(state.pausedUntil)}. Nada é contado nesse período.</span></p>
        : <div className={styles.level}><span className={styles.levelNumber}>Nível {state.level}</span><div className={styles.progress} role="progressbar" aria-label="Progresso até o próximo nível" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><span style={{ width: `${Math.round(progress * 100)}%` }}/></div><small>{state.nextLevelAt ? `${state.total} de ${state.nextLevelAt} selos para o próximo nível` : 'Nível máximo'}</small></div>}
      <ul className={styles.badgeGrid}>{(state.badges ?? []).map(badge => { const Icon = ICON[badge.id]; return <li key={badge.id} data-earned={badge.thisWeek || undefined}>
        <span className={styles.mark} data-shape={SHAPE[badge.id]} aria-hidden="true"><Icon size={22}/></span>
        <span className={styles.badgeText}><strong>{badge.label}</strong><small>{badge.hint}</small><small className={styles.badgeStatus}>{badge.thisWeek ? 'Conquistado nesta semana' : 'Ainda não nesta semana'}</small><small>{badge.times} {badge.times === 1 ? 'vez' : 'vezes'} no total</small></span>
      </li>; })}</ul>
      <p className={`${styles.help} ${styles.badgeHelp}`}><Sparkles size={14} aria-hidden="true"/>Arte provisória: os selos definitivos virão da equipe de comunicação.</p>
    </section>
    <section className={styles.card} aria-labelledby="badges-rules">
      <div className={styles.cardHead}><h2 id="badges-rules">Como funciona</h2></div>
      <ul className={styles.rules}>
        <li>No máximo um selo de cada tipo por semana. Fazer mais não dá mais selos.</li>
        <li>Só contam ações em dias úteis, das 7h às 20h. Trabalho fora do horário não é premiado.</li>
        <li>O nível sobe a cada 3 selos, somando semanas diferentes. Constância vale mais que volume.</li>
        <li>Semana de provas, férias ou licença? Pause os selos.</li>
      </ul>
      <div className={styles.manageRow}>
        {state.paused ? <button type="button" className="p-button p-button-subtle" disabled={busy} onClick={() => void save(true, null, 'Selos retomados')}><Play size={16}/>Retomar agora</button>
          : <><label className={styles.field}><span>Pausar até</span><DateField value={pauseUntil} onValueChange={setPauseUntil} disabled={busy} aria-label="Pausar selos até"/></label><button type="button" className="p-button p-button-subtle" disabled={busy || !pauseUntil} onClick={() => void save(true, pauseUntil, 'Selos em pausa')}>{busy ? <LoaderCircle className="p-spin" size={16}/> : <CalendarClock size={16}/>}Pausar</button></>}
        <button type="button" className={styles.textButton} disabled={busy} onClick={() => void save(false, null, 'Selos desligados')}><Power size={15} aria-hidden="true"/>Desligar selos</button>
      </div>
    </section>
  </div>;
}
