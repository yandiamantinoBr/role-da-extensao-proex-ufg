'use client';
/* eslint-disable @next/next/no-img-element -- mascote em SVG estático */
import { answerInvite, useTutorials } from './tutorial-store';
import styles from './tutorials.module.css';

/**
 * Convite do Rolê no Início: aparece uma vez por pessoa, dentro da página, sem tomar o foco nem abrir
 * janela. "Agora não" fecha a oferta; Ajuda e tutoriais continua no menu da conta e em Mais.
 */
export default function TutorialInvite() {
  const { data } = useTutorials();
  if (!data || data.invite !== 'new' || Object.keys(data.progress).length) return null;
  return <section className={`p-card ${styles.invite}`} aria-labelledby="tutorial-invite-title">
    <img src="/brand/role-mascote/role-frontal.svg" alt="" width={56} height={102} className={styles.inviteMascot}/>
    <div className={styles.inviteText}>
      <h2 id="tutorial-invite-title">Oi, sou o Rolê. Quer conhecer o Portal?</h2>
      <p>Você pode fazer um tour, escolher um assunto ou voltar quando quiser. Leva uns 3 minutos e não muda seus registros de trabalho.</p>
      <div className={styles.inviteActions}>
        <button type="button" className="p-button p-button-primary" onClick={() => void answerInvite('tour')}>Fazer o tour completo</button>
        <button type="button" className="p-button p-button-subtle" onClick={() => void answerInvite('choose')}>Escolher assunto</button>
        <button type="button" className="p-button p-button-subtle" onClick={() => void answerInvite('later')}>Agora não</button>
      </div>
    </div>
  </section>;
}
