'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { CalendarClock, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import type { AccountAccess } from '@/lib/account-access';
import styles from './account-access-panel.module.css';

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo',
});

export default function AccountAccessPanel({ userId }: { userId: string }) {
  const heading = useId();
  const [access, setAccess] = useState<AccountAccess | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const request = useRef<AbortController | null>(null);
  const update = () => {
    request.current?.abort();
    setAccess(null);
    setError('');
    setRevision(value => value + 1);
  };

  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      controller.abort();
      setAccess(null);
      setError('');
      setRevision(value => value + 1);
    };
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onPageShow);
    void (async () => {
      try {
        const response = await fetch('/api/account/access', {
          credentials: 'same-origin', cache: 'no-store', signal: controller.signal, headers: { 'X-Proex-Account': userId },
        });
        if (!response.ok) throw new Error(response.status === 401 || response.status === 403
          ? 'Seu acesso mudou. Entre novamente para consultar esta lista.'
          : 'Não foi possível consultar seus acessos. Tente atualizar.');
        const result = await response.json() as AccountAccess;
        if (typeof result.platformAdmin !== 'boolean' || !Array.isArray(result.organizations) || !Number.isFinite(result.checkedAt)) {
          throw new Error('Não foi possível conferir seus acessos. Tente atualizar.');
        }
        if (controller.signal.aborted) return;
        const firstEnd = result.organizations.reduce((earliest, org) => org.events.reduce((end, event) => Math.min(end, Date.parse(event.endsAt)), earliest), Infinity);
        if (Number.isFinite(firstEnd)) expiry = setTimeout(refresh, Math.max(250, Math.min(2147483647, firstEnd - result.checkedAt + 100)));
        setAccess(result);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível consultar seus acessos.');
      }
    })();
    return () => {
      controller.abort();
      if (expiry !== undefined) clearTimeout(expiry);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [revision, userId]);

  const loading = !access && !error;
  return <section className={`p-card ${styles.card}`} aria-labelledby={heading} aria-busy={loading}>
    <header className={styles.header}>
      <div className="p-card-title">
        <span className="p-icon-tile"><ShieldCheck size={19} aria-hidden="true"/></span>
        <div><h2 id={heading}>Meus acessos</h2><p>Veja qual função vale em cada projeto, organização ou ação.</p></div>
      </div>
      <button type="button" className="p-button p-button-subtle" onClick={() => { if (!loading) update(); }} aria-disabled={loading} aria-label="Atualizar meus acessos"><RefreshCw size={16} aria-hidden="true"/>Atualizar</button>
    </header>
    {loading && <p className={styles.notice} role="status"><LoaderCircle size={16} className="p-spin" aria-hidden="true"/>Consultando seus acessos…</p>}
    {error && <p className={styles.notice} role="alert">{error}</p>}
    {access && <>
      {access.platformAdmin && <div className={styles.group}>
        <h3>Administração do Portal</h3><p>Todas as organizações do Portal.</p>
      </div>}
      {access.organizations.map((org, index) => <section key={index} className={styles.group} aria-label={org.name}>
        <div className={styles.orgTitle}><h3>{org.name}</h3>{org.archived && <span className="p-badge">Arquivada</span>}</div>
        {org.work.length > 0 && <dl className={styles.list}>
          {org.work.map((grant, position) => <div key={position}>
            <dt>{grant.project ?? 'Toda a organização'}{grant.archived && <span className="p-badge">Arquivado</span>}</dt>
            <dd>{grant.roles.join(' · ')}</dd>
          </div>)}
        </dl>}
        {org.events.length > 0 && <ul className={styles.events}>
          {org.events.map((event, position) => <li key={position}>
            <CalendarClock size={17} aria-hidden="true"/>
            <div><strong>{event.name}</strong><p>{event.project} · Voluntariado nesta ação</p><p>Até <time dateTime={event.endsAt}>{dateTime.format(new Date(event.endsAt))}</time> (Brasília)</p></div>
          </li>)}
        </ul>}
      </section>)}
      {!access.platformAdmin && !access.organizations.length && <p className={styles.notice} role="status">Sua conta está conectada. Peça acesso à coordenação do projeto ou da ação.</p>}
    </>}
  </section>;
}
