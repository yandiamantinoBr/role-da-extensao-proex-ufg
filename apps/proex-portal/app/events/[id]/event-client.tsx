'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, CheckCircle2, Copy, Dices, Gift, Camera, LoaderCircle, Settings2, ShieldCheck, Ticket, Volume2, VolumeX, X } from 'lucide-react';
import { BrandMark } from '@/components/theme/brand-mark';
import { ThemeSwitch } from '@/components/theme/theme-switch';
import { SECTORS, targetDice, targetRotation } from '@/lib/roulette';
import { GameAudio } from '@/lib/game-audio';

type SettledResult = 'brinde' | 'super' | 'miss' | 'retry' | 'retry_exhausted';
type Result = SettledResult | 'pending' | 'cancelled';
type Mode = 'wheel' | 'dice' | 'physical';
type Attempt = { id: string; number: number; result: Result; state?: string };
type Entitlement = { id: string; state: string; offer_name?: string | null };
type Participation = { id: string; state: string; modality: string; attempts: Attempt[]; entitlements: Entitlement[] };
type EventData = {
  campaign: { id: string; name: string; project_id: string; location?: string | null; status: string; rules_text?: string | null; retry_limit: number | null; starts_at?: string | null; ends_at?: string | null };
  authenticated: boolean; participation: Participation | null; instagramUrl: string | null; privacyNotice: string | null;
};
const RESULTS: Record<Result, { title: string; text: string; emoji: string }> = {
  brinde: { title: 'O brinde é seu!', text: 'Mostre este resultado à equipe para retirar seu brinde.', emoji: '😁' },
  super: { title: 'Super Brinde!', text: 'Esse rolê merece comemoração. Mostre o comprovante à equipe.', emoji: '😍' },
  miss: { title: 'Valeu pelo rolê!', text: 'Não foi dessa vez. Obrigado por participar e conhecer a extensão da UFG.', emoji: '🙃' },
  retry: { title: 'Tente novamente', text: 'Confira abaixo se o regulamento liberou outra tentativa para você.', emoji: '😎' },
  retry_exhausted: { title: 'Participação concluída', text: 'A face foi Tente novamente. Você chegou ao limite de tentativas previsto neste evento.', emoji: '😎' },
  pending: { title: 'Seu atendimento está reservado', text: 'Mostre o código abaixo à equipe antes de jogar presencialmente. A equipe registrará o resultado e orientará a retirada.', emoji: '🎟️' },
  cancelled: { title: 'Atendimento encerrado', text: 'A equipe encerrou este atendimento sem registrar um lançamento. Se precisar de orientação, procure a equipe no evento.', emoji: '🎟️' },
};
function resultKind(value: unknown): value is Result { return typeof value === 'string' && Object.hasOwn(RESULTS, value); }
function lastAttempt(participation: Participation | null): Attempt | null {
  return participation?.attempts?.reduce<Attempt | null>((last, attempt) => !last || attempt.number > last.number ? attempt : last, null) ?? null;
}
function visualFace(result: SettledResult, attemptId: string): number {
  // Choose only a presentation face. The server has already decided the category.
  // A stable mapping also restores the same face after a page reload.
  if (result === 'brinde') { let hash = 0; for (const character of attemptId) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0; return [0, 2, 5][hash % 3]; }
  return ({ super: 3, miss: 4, retry: 1, retry_exhausted: 1 } as const)[result];
}
function errorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const value = payload as { message?: unknown; error?: unknown };
  // The API exposes a curated public message; arbitrary provider errors stay server-side.
  for (const message of [value.message, value.error]) if (typeof message === 'string' && message.trim() && message.length < 400) return message;
  return fallback;
}
function polar(angle: number, radius: number) { const radians = angle * Math.PI / 180; return [Math.round((300 + Math.cos(radians) * radius) * 1000) / 1000, Math.round((300 + Math.sin(radians) * radius) * 1000) / 1000]; }
function safeInstagram(value: string | null): string | null { try { const url = new URL(value ?? ''); return url.protocol === 'https:' && ['instagram.com', 'www.instagram.com'].includes(url.hostname) ? url.href : null; } catch { return null; } }

export default function EventClient({ eventId, signedIn, signInHref }: { eventId: string; signedIn: boolean; signInHref: string }) {
  const [data, setData] = useState<EventData | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [spinning, setSpinning] = useState(false);
  const [mode, setMode] = useState<Mode>('wheel'), [result, setResult] = useState<Attempt | null>(null);
  const [error, setError] = useState(''), [acknowledged, setAcknowledged] = useState(false), [settings, setSettings] = useState(false);
  const [wheelSeconds, setWheelSeconds] = useState(12), [diceSeconds, setDiceSeconds] = useState(6), [sound, setSound] = useState(true), [progress, setProgress] = useState(0), [copied, setCopied] = useState(false);
  const wheelRef = useRef<HTMLDivElement>(null), diceRef = useRef<HTMLDivElement>(null);
  const wheelAngle = useRef(0), diceAngle = useRef({ x: 0, y: 0 });
  const audio = useRef<GameAudio | null>(null), animation = useRef<Animation | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null), progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lock = useRef(false), operation = useRef<string | null>(null), alive = useRef(true);
  const dialogRef = useRef<HTMLElement>(null);
  const endpoint = `/api/events/${encodeURIComponent(eventId)}`;

  const position = useCallback((attempt: Attempt | null, selectedMode: Mode) => {
    if (!attempt || !resultKind(attempt.result) || attempt.result === 'pending' || attempt.result === 'cancelled' || selectedMode === 'physical') return;
    const face = visualFace(attempt.result, attempt.id);
    const rotation = (360 - face * 60) % 360;
    const orientation = targetDice({ x: 0, y: 0 }, face);
    if (selectedMode === 'wheel') { wheelAngle.current = rotation; if (wheelRef.current) wheelRef.current.style.transform = `rotate(${rotation}deg)`; }
    else { diceAngle.current = orientation; if (diceRef.current) diceRef.current.style.transform = `rotateX(${orientation.x}deg) rotateY(${orientation.y}deg)`; }
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(endpoint, { cache: 'no-store', signal, credentials: 'same-origin' });
    const payload = await response.json().catch(() => null) as EventData | null;
    if (!response.ok) throw new Error(errorMessage(payload, 'Não foi possível carregar o evento. Tente atualizar.'));
    if (!payload?.campaign?.id || typeof payload.authenticated !== 'boolean') throw new Error('O evento não está disponível. Procure a equipe.');
    const current = payload as EventData;
    if (alive.current) {
      setData(current);
      const previous = lastAttempt(current.participation);
      if (previous && resultKind(previous.result)) {
        setResult(previous);
        const previousMode = current.participation?.modality === 'dice' ? 'dice' : current.participation?.modality === 'wheel' ? 'wheel' : current.participation?.modality === 'physical' ? 'physical' : null;
        if (previousMode) setMode(previousMode);
      }
    }
    return current;
  }, [endpoint]);

  useEffect(() => {
    alive.current = true; const controller = new AbortController();
    const loadTimer = window.setTimeout(() => { void refresh(controller.signal).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Não foi possível carregar o evento.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); }, 0);
    const visibility = () => audio.current?.setVisible(!document.hidden);
    document.addEventListener('visibilitychange', visibility);
    return () => { alive.current = false; window.clearTimeout(loadTimer); controller.abort(); animation.current?.cancel(); if (timer.current) clearTimeout(timer.current); if (progressTimer.current) clearInterval(progressTimer.current); audio.current?.stop(); document.removeEventListener('visibilitychange', visibility); };
  }, [refresh]);
  useEffect(() => { if (!spinning) position(result, mode); }, [result, mode, spinning, position]);
  useEffect(() => { audio.current?.unlock(sound, 55); }, [sound]);
  useEffect(() => {
    if (!settings) return;
    const previous = document.activeElement;
    dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { if (previous instanceof HTMLElement) previous.focus(); };
  }, [settings]);

  const authenticated = data?.authenticated ?? signedIn;
  const campaign = data?.campaign;
  const participation = data?.participation;
  const policyReady = Number.isInteger(campaign?.retry_limit) && (campaign?.retry_limit ?? -1) >= 0 && (campaign?.retry_limit ?? 4) <= 3;
  const stateReady = !participation || ['ready', 'retry_ready'].includes(participation.state);
  const active = campaign?.status === 'active';
  const noticeReady = Boolean(campaign?.rules_text?.trim() && data?.privacyNotice?.trim());
  const eligible = authenticated && active && policyReady && noticeReady && stateReady;
  const canPlay = eligible && acknowledged && !busy;
  const entitlement = participation?.entitlements?.find(item => item.state !== 'cancelled' && item.state !== 'expired') ?? null;
  const instagramUrl = safeInstagram(data?.instagramUrl ?? null);
  const resultInfo = result && resultKind(result.result) ? RESULTS[result.result] : null;
  const pendingPhysical = participation?.modality === 'physical' && participation.state === 'physical_pending';
  const receiptCode = entitlement?.id ?? (pendingPhysical ? lastAttempt(participation ?? null)?.id : null);

  async function draw() {
    if (!canPlay || lock.current) return;
    lock.current = true; setBusy(true); setError(''); setCopied(false);
    if (mode !== 'physical') { audio.current ??= new GameAudio(); audio.current.unlock(sound, 55); audio.current.setVisible(!document.hidden); }
    operation.current ??= crypto.randomUUID();
    let received: { attempt: Attempt; participation?: Participation; entitlement?: Entitlement | null };
    try {
      const response = await fetch(endpoint, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify({ action: 'draw', modality: mode, operationKey: operation.current }) });
      const payload = await response.json().catch(() => null) as { attempt?: Attempt; participation?: Participation; entitlement?: Entitlement | null } | null;
      if (!response.ok) throw new Error(errorMessage(payload, 'Não foi possível confirmar sua participação. Atualize para consultar o estado antes de tentar novamente.'));
      if (!payload?.attempt?.id || !resultKind(payload.attempt.result)) throw new Error('A confirmação recebida não pôde ser apresentada. Atualize para consultar seu resultado.');
      received = { attempt: payload.attempt, participation: payload.participation, entitlement: payload.entitlement }; operation.current = null;
      if (!alive.current) return;
      setData(current => current ? { ...current, participation: received.participation ?? { id: current.participation?.id ?? '', state: received.attempt.result === 'pending' ? 'physical_pending' : 'completed', modality: mode, attempts: [received.attempt], entitlements: received.entitlement ? [received.entitlement] : [] } } : current);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'A conexão foi interrompida. Atualize para consultar sua participação.');
      try { await refresh(); } catch { /* Preserve original error and the operation key for a safe retry. */ }
      lock.current = false; setBusy(false); return;
    }
    const attempt = received.attempt;
    const savedMode = received.participation?.modality;
    const presentationMode: Mode = savedMode === 'wheel' || savedMode === 'dice' || savedMode === 'physical' ? savedMode : mode;
    setMode(presentationMode);
    if (attempt.result === 'pending' || attempt.result === 'cancelled' || presentationMode === 'physical') {
      setResult(attempt); setSpinning(false); setBusy(false); lock.current = false;
      return;
    }
    const settledResult = attempt.result, selectedMode = presentationMode;
    const face = visualFace(settledResult, attempt.id), seconds = selectedMode === 'wheel' ? wheelSeconds : diceSeconds;
    const element = selectedMode === 'wheel' ? wheelRef.current : diceRef.current;
    setResult(null); setSpinning(true); setProgress(0);
    const start = performance.now(); let frames: Keyframe[], target: string;
    if (selectedMode === 'wheel') {
      const from = wheelAngle.current, to = targetRotation(from, face, seconds), delta = to - from;
      target = `rotate(${to}deg)`; wheelAngle.current = to;
      frames = [{ transform: `rotate(${from}deg)`, offset: 0, easing: 'cubic-bezier(.55,0,.8,.6)' }, { transform: `rotate(${from + delta * .12}deg)`, offset: .18, easing: 'linear' }, { transform: `rotate(${from + delta * .8}deg)`, offset: .65, easing: 'cubic-bezier(.08,.5,.12,1)' }, { transform: target, offset: 1 }];
    } else {
      const from = diceAngle.current, to = targetDice(from, face); target = `rotateX(${to.x}deg) rotateY(${to.y}deg) rotateZ(0deg)`; diceAngle.current = to;
      frames = [{ transform: `rotateX(${from.x}deg) rotateY(${from.y}deg) rotateZ(0deg)`, offset: 0, easing: 'ease-in' }, { transform: `rotateX(${from.x + 500}deg) rotateY(${from.y + 660}deg) rotateZ(18deg)`, offset: .25, easing: 'linear' }, { transform: `rotateX(${to.x - 160}deg) rotateY(${to.y - 180}deg) rotateZ(-12deg)`, offset: .72, easing: 'ease-out' }, { transform: `rotateX(${to.x + 12}deg) rotateY(${to.y - 8}deg) rotateZ(3deg)`, offset: .92, easing: 'ease-out' }, { transform: target, offset: 1 }];
    }
    let finished = false;
    const finish = () => {
      if (finished || !alive.current) return; finished = true;
      if (element) { element.style.transition = 'none'; element.style.transform = target; }
      animation.current?.cancel(); animation.current = null;
      if (timer.current) clearTimeout(timer.current); if (progressTimer.current) clearInterval(progressTimer.current);
      timer.current = null; progressTimer.current = null; audio.current?.stop();
      setResult(attempt); setProgress(100); setSpinning(false); setBusy(false); lock.current = false;
      audio.current?.result(settledResult === 'retry_exhausted' ? 'retry' : settledResult, selectedMode);
      void refresh().catch(() => { if (alive.current) setError('Seu resultado foi registrado. A atualização do comprovante está pendente; tente atualizar.'); });
    };
    if (!element) { finish(); return; }
    let soundFrames = frames;
    try { animation.current = element.animate(frames, { duration: seconds * 1000, fill: 'forwards', easing: 'linear' }); animation.current.onfinish = finish; }
    catch { element.style.transition = `transform ${seconds}s cubic-bezier(.2,.1,.1,1)`; element.getBoundingClientRect(); element.style.transform = target; soundFrames = [{ ...frames[0], offset: 0, easing: 'cubic-bezier(.2,.1,.1,1)' }, { ...frames[frames.length - 1], offset: 1 }]; }
    audio.current?.follow(selectedMode, soundFrames, seconds, () => typeof animation.current?.currentTime === 'number' ? animation.current.currentTime / 1000 : (performance.now() - start) / 1000);
    progressTimer.current = setInterval(() => setProgress(Math.min(99, (performance.now() - start) / (seconds * 10))), 150);
    timer.current = setTimeout(finish, seconds * 1000 + 100);
  }

  async function update() { setLoading(true); setError(''); try { await refresh(); } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível atualizar.'); } finally { setLoading(false); } }
  async function copyCode() { if (!receiptCode) return; try { await navigator.clipboard.writeText(receiptCode); setCopied(true); } catch { setError('Não foi possível copiar. Você pode mostrar o código à equipe.'); } }

  return <main className="proex-event">
    <header className="pe-top"><a className="pe-brand" href="https://proex.ufg.br/" target="_blank" rel="noreferrer" aria-label="Conheça a PROEX UFG"><BrandMark variant="auto" /></a><div className="pe-header-actions"><ThemeSwitch /><Link className="pe-team-link" href="/">Área da equipe <ArrowRight size={15}/></Link></div></header>
    <section className="pe-heading"><span className="pe-eyebrow">UMA CONEXÃO COM A UFG</span><h1>Rolê da <em>Extensão</em><span aria-hidden="true">😎</span></h1><p>{campaign?.name ?? 'Vamos viver esse rolê?'}</p>{campaign?.location && <span className="pe-location">{campaign.location}</span>}</section>
    {loading && !data ? <section className="pe-message" aria-live="polite"><LoaderCircle className="pe-loader"/><h2>Preparando o rolê</h2><p>Estamos consultando as informações do evento.</p></section> : !data ? <section className="pe-message"><span className="pe-big-emoji" aria-hidden="true">🔎</span><h2>Não encontramos este evento</h2><p>{error || 'Confira o link ou procure a equipe do Rolê da Extensão.'}</p><button className="pe-secondary" onClick={update}>Tentar carregar novamente</button></section> : <>
      <div className="pe-event-meta"><span><ShieldCheck size={16}/> Participação oficial</span><span>Uma participação por conta neste evento</span></div>
      <div className="pe-workspace">
        <section className="pe-game" aria-label="Escolha e apresentação da dinâmica">
          <div className="pe-tabs" role="group" aria-label="Escolha a dinâmica"><button aria-pressed={mode === 'wheel'} disabled={busy || Boolean(participation)} onClick={() => setMode('wheel')}><span aria-hidden="true">◉</span> Roleta</button><button aria-pressed={mode === 'dice'} disabled={busy || Boolean(participation)} onClick={() => setMode('dice')}><Dices size={18}/> Dado</button><button aria-pressed={mode === 'physical'} disabled={busy || Boolean(participation)} onClick={() => setMode('physical')}><Ticket size={18}/> Presencial</button></div>
          {mode === 'wheel' ? <div className={`pe-wheel-stage ${spinning ? 'pe-is-spinning' : ''}`}><div className="pe-wheel-ring"/><div className="pe-wheel-pointer" aria-hidden="true"/><div className="pe-wheel-rotor" ref={wheelRef}><svg viewBox="0 0 600 600" className="pe-wheel" role="img" aria-label="Seis setores: três Brindes, Tente novamente, Super Brinde e Não foi dessa vez">{SECTORS.map((sector, index) => {
            const a = -120 + index * 60, b = a + 60, from = polar(a, 282), to = polar(b, 282), center = a + 30;
            return <g key={sector.id}><path d={`M300 300 L${from[0]} ${from[1]} A282 282 0 0 1 ${to[0]} ${to[1]} Z`} fill={sector.color} stroke="white" strokeWidth="4"/><g transform={`translate(${polar(center, 172).join(' ')}) rotate(${index * 60})`} fill={sector.ink}><text className="pe-sector-emoji" y="-23" textAnchor="middle">{sector.emoji}</text>{sector.lines.map((line, n) => <text key={line} className="pe-sector-label" y={27 + n * 30} textAnchor="middle">{line}</text>)}</g></g>;
          })}<circle cx="300" cy="300" r="282" fill="none" stroke="white" strokeWidth="9"/></svg></div><div className="pe-wheel-hub" aria-hidden="true">🎁<small>ROLÊ</small></div></div> : mode === 'dice' ? <div className="pe-dice-stage"><div className="pe-dice-scene"><div className="pe-dice-camera"><div className="pe-dice-cube" ref={diceRef}>{SECTORS.map((sector, index) => <div className={`pe-dice-face pe-face-${index}`} key={sector.id} style={{ background: sector.color, color: sector.ink }}><small className="pe-face-number">{index + 1}/6</small><span aria-hidden="true">{sector.emoji}</span><strong>{sector.label}</strong><small className="pe-face-brand">ROLÊ DA EXTENSÃO</small></div>)}</div></div></div><div className="pe-dice-shadow"/></div> : <div className="pe-physical-stage"><div className="pe-physical-ticket"><span className="pe-physical-icon" aria-hidden="true">🎟️</span><span className="pe-eyebrow">O ROLÊ É AQUI</span><h2>Jogar presencialmente</h2><p>Reserve sua participação e encontre a equipe no evento.</p><div className="pe-physical-steps"><span><b>1</b> Confirme seu atendimento</span><span><b>2</b> Mostre o código à equipe</span><span><b>3</b> Jogue com a orientação da equipe</span></div><small>A reserva usa a mesma participação da roleta e do dado online.</small></div></div>}
          {mode !== 'physical' && <div className="pe-stage-actions"><button className="pe-minimal" disabled={busy} onClick={() => setSettings(true)}><Settings2 size={16}/> Tempo e som</button><button className="pe-minimal" onClick={() => setSound(value => !value)} aria-label={sound ? 'Desativar som' : 'Ativar som'}>{sound ? <Volume2 size={17}/> : <VolumeX size={17}/>} {sound ? 'Som ligado' : 'Sem som'}</button></div>}
        </section>
        <section className="pe-control" aria-label="Participação e resultado">
          <div className={`pe-result ${result?.result === 'super' ? 'pe-result-super' : ''}`} aria-live="polite" aria-atomic="true"><span className="pe-result-emoji" aria-hidden="true">{spinning ? mode === 'wheel' ? '🤞' : '🎲' : resultInfo?.emoji ?? (mode === 'physical' ? '👋' : '🍀')}</span><span className="pe-eyebrow">{spinning ? 'SEGURA A EMOÇÃO' : pendingPhysical ? 'SEU ATENDIMENTO' : resultInfo ? 'SEU RESULTADO' : 'SEU PRÓXIMO ROLÊ'}</span><h2>{spinning ? mode === 'wheel' ? 'A roleta tá girando!' : 'O dado tá rolando!' : resultInfo?.title ?? (mode === 'physical' ? 'Bora encontrar a equipe?' : 'A sorte tá no rolê.')}</h2><p>{spinning ? 'Sua participação já foi registrada. Agora é torcer!' : resultInfo?.text ?? (mode === 'physical' ? 'Confirme aqui antes de jogar. Seu código ficará disponível para o atendimento.' : 'Escolha sua dinâmica e descubra sua surpresa.')}</p>{spinning && <div className="pe-progress" role="progressbar" aria-label="Progresso da animação" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }}/></div>}</div>
          {!authenticated ? <div className="pe-entry"><a className="pe-play" href={signInHref} target="_top">Entrar para participar <ArrowRight size={20}/></a><p>Você entrará com o e-mail e a senha do seu cadastro. Sem conta ou sem celular? A equipe pode orientar o atendimento presencial.</p></div> : <>
            {eligible && !busy && <label className="pe-check"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)}/><span>Li as regras deste evento e o aviso de privacidade abaixo.</span></label>}
            {eligible || busy ? <button className="pe-play" disabled={!canPlay} onClick={() => void draw()}>{busy ? <><LoaderCircle className="pe-loader" size={20}/>{spinning ? 'SORTEANDO…' : 'CONFIRMANDO…'}</> : result ? <>{mode === 'physical' ? 'Reservar tentativa autorizada' : 'Usar tentativa autorizada'} <ArrowRight size={20}/></> : <><span aria-hidden="true">{mode === 'wheel' ? '🎡' : mode === 'dice' ? '🎲' : '🎟️'}</span>{mode === 'wheel' ? 'GIRAR ROLETA' : mode === 'dice' ? 'LANÇAR O DADO' : 'RESERVAR ATENDIMENTO'}</>}</button> : <div className="pe-status"><CheckCircle2 size={19}/><span>{pendingPhysical ? 'Sua reserva foi registrada. Aguarde a orientação da equipe para jogar presencialmente.' : !active ? campaign?.status === 'paused' ? 'As participações estão pausadas. Procure a equipe.' : 'Este evento não está recebendo participações.' : !policyReady || !noticeReady ? 'A equipe está finalizando as regras e o aviso de privacidade deste evento.' : 'Sua participação neste evento já foi registrada.'}</span></div>}
            {entitlement && !spinning && <div className="pe-receipt"><div><Gift size={18}/><strong>{entitlement.state === 'delivered' ? 'Brinde entregue' : 'Comprovante de brinde'}</strong></div><p>{entitlement.state === 'delivered' ? 'A retirada já foi confirmada pela equipe.' : 'Mostre este código à equipe. A entrega será confirmada uma única vez.'}</p><code>{entitlement.id}</code><button className="pe-minimal" onClick={() => void copyCode()}>{copied ? <Check size={15}/> : <Copy size={15}/>} {copied ? 'Código copiado' : 'Copiar código'}</button></div>}
            {pendingPhysical && !entitlement && receiptCode && <div className="pe-receipt"><div><Ticket size={18}/><strong>Código do atendimento</strong></div><p>Mostre à equipe antes de jogar. Este comprovante reserva a participação; o resultado será registrado no atendimento.</p><code>{receiptCode}</code><button className="pe-minimal" onClick={() => void copyCode()}>{copied ? <Check size={15}/> : <Copy size={15}/>} {copied ? 'Código copiado' : 'Copiar código'}</button></div>}
          </>}
          {error && <p className="pe-error" role="alert">{error}</p>}
          {!busy && <button className="pe-refresh" disabled={loading} onClick={() => void update()}>{loading ? 'Atualizando…' : 'Atualizar minha participação'}</button>}
        </section>
      </div>
      <section className="pe-information" aria-label="Regras e privacidade"><details><summary>Como funciona este evento <span>+</span></summary><div><p>{campaign?.rules_text || 'O regulamento ainda não foi publicado. A participação ficará indisponível até a equipe concluir essa configuração.'}</p><p>A roleta, o dado e o atendimento presencial compartilham o mesmo limite de participação por conta. A modalidade fica definida na primeira participação. Atualizar a página recupera seu registro; não concede outra tentativa.</p></div></details><details><summary>Seu registro e sua privacidade <span>+</span></summary><div><p>{data.privacyNotice || 'Antes de começar, a equipe precisa publicar o aviso de privacidade aplicável a este evento.'}</p><p>A ciência deste aviso é separada de qualquer autorização para receber divulgação ou usar sua imagem. Se precisar de ajuda, procure a equipe.</p></div></details>{instagramUrl && <a className="pe-instagram" href={instagramUrl} target="_blank" rel="noreferrer"><Camera size={19}/><span>Conheça a PROEX no Instagram<small>Seguir o perfil é opcional neste fluxo.</small></span><ArrowRight size={18}/></a>}</section>
    </>}
    <footer className="pe-footer"><span>Extensão conecta a universidade e a sociedade.</span><a href="https://role-da-extensao-ufg.yandiamantinobr.chatgpt.site/" target="_blank" rel="noreferrer">Conhecer a versão livre <ArrowRight size={14}/></a></footer>
    {settings && <div className="pe-dialog-backdrop" onClick={() => setSettings(false)}><section ref={dialogRef} className="pe-dialog" role="dialog" aria-modal="true" aria-labelledby="pe-settings-title" onClick={e => e.stopPropagation()} onKeyDown={e => {
      if (e.key === 'Escape') { e.preventDefault(); setSettings(false); }
      if (e.key !== 'Tab') return;
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href]');
      if (!controls?.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }}><div className="pe-dialog-heading"><div><span className="pe-eyebrow">DO SEU JEITO</span><h2 id="pe-settings-title">Tempo e som</h2></div><button className="pe-icon" aria-label="Fechar configurações" onClick={() => setSettings(false)}><X size={20}/></button></div><p>Esses ajustes mudam a apresentação, sem alterar o resultado ou as chances.</p><label className="pe-range">🎡 Roleta <strong>{wheelSeconds} s</strong><input aria-label="Tempo da roleta em segundos" type="range" min="3" max="30" value={wheelSeconds} onChange={e => setWheelSeconds(Number(e.target.value))}/></label><label className="pe-range">🎲 Super Dado <strong>{diceSeconds} s</strong><input aria-label="Tempo do dado em segundos" type="range" min="2" max="20" value={diceSeconds} onChange={e => setDiceSeconds(Number(e.target.value))}/></label><label className="pe-check"><input type="checkbox" checked={sound} onChange={e => setSound(e.target.checked)}/><span>Ativar efeitos sonoros</span></label><button className="pe-play" onClick={() => setSettings(false)}>Pronto, bora participar!</button></section></div>}
  </main>;
}
