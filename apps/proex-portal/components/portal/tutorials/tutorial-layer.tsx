'use client';
/* eslint-disable @next/next/no-img-element -- mascote em SVG estático */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowLeft, ArrowRight, LifeBuoy, Pause, RotateCcw, X } from 'lucide-react';

/** Espaço do topo (cabeçalho fixo do Portal) que o controle destacado não deve ocupar. */
const TOP_GAP = 72;
import type { ModuleId } from '../navigation-model';
import { TUTORIAL_CHAPTERS, chapterById, type TutorialStep } from '@/lib/tutorials/catalog';
import ChapterList from './chapter-list';
import { closeTutorialChooser, finishTutorial, loadTutorials, nextStep, pauseTutorial, previousStep, startChapter, useTutorials } from './tutorial-store';
import styles from './tutorials.module.css';

const MOBILE = '(max-width: 720px)';
const SPOT = 'data-tutorial-spot';

/** O primeiro elemento visível e com tamanho que corresponde ao seletor (o menu do computador e o do celular coexistem; lista vazia não conta). */
export function visibleTarget(selector: string | undefined, root: ParentNode = document): HTMLElement | null {
  if (!selector) return null;
  for (const element of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
    const box = element.getBoundingClientRect();
    if (box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden') return element;
  }
  return null;
}

/** Controle fixo na tela (barra de baixo, cabeçalho): rolar a página não muda a posição dele. */
function pinned(element: HTMLElement): boolean {
  for (let node: HTMLElement | null = element, depth = 0; node && depth < 5; node = node.parentElement, depth++) {
    const position = getComputedStyle(node).position;
    if (position === 'fixed' || position === 'sticky') return true;
  }
  return false;
}

/** Texto do passo para a largura atual. */
export function stepCopy(step: TutorialStep, mobile: boolean) {
  return {
    speech: mobile && step.speechMobile ? step.speechMobile : step.speech,
    youWillSee: mobile && step.youWillSeeMobile ? step.youWillSeeMobile : step.youWillSee,
    target: mobile && step.targetMobile ? step.targetMobile : step.target,
    module: mobile && step.moduleMobile ? step.moduleMobile : step.module,
    openLabel: step.openLabel ?? 'Abrir no Portal',
    beforeOpen: mobile && step.beforeOpenMobile ? step.beforeOpenMobile : step.beforeOpen,
    reveal: step.reveal,
    missing: mobile && step.missingMobile ? step.missingMobile : step.missing,
  };
}

function subscribeMobile(change: () => void) {
  const query = window.matchMedia(MOBILE);
  query.addEventListener('change', change);
  return () => query.removeEventListener('change', change);
}
const useMobile = () => useSyncExternalStore(subscribeMobile, () => window.matchMedia(MOBILE).matches, () => false);

/**
 * Camada dos tutoriais: janela "Ajuda e tutoriais" e cartão guiado. O cartão não é modal: a pessoa
 * continua usando a página, e o controle do passo ganha um contorno. Nada aqui grava dados de trabalho.
 */
export default function TutorialLayer({ modules, tab, projectId, onNavigate }: { modules: ModuleId[]; tab: ModuleId; projectId: string; onNavigate: (id: ModuleId) => void }) {
  const { data, active, chooser, notice } = useTutorials();
  const mobile = useMobile();
  // Resultado da busca do controle, guardado por passo: um passo novo começa sem resultado.
  const [spot, setSpot] = useState<{ key: string; found: boolean | null }>({ key: '', found: null });
  // Há texto escondido abaixo no cartão (tela baixa): a barra de botões ganha uma sombra de aviso.
  const [more, setMore] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null), dialog = useRef<HTMLDivElement>(null), card = useRef<HTMLElement>(null);
  // Depois de "Ir para…", o Portal move o foco para a página nova; o título do cartão o recupera.
  const refocus = useRef(false);

  // Acesso atual: consulta ao montar e a cada troca de projeto.
  useEffect(() => { void loadTutorials(projectId); }, [projectId]);

  // Rota direta (?tutorial=navegacao): abre o capítulo e tira o parâmetro do endereço.
  useEffect(() => {
    const url = new URL(window.location.href), wanted = url.searchParams.get('tutorial');
    if (!wanted) return;
    url.searchParams.delete('tutorial');
    window.history.replaceState(window.history.state, '', url);
    if (chapterById(wanted)) void startChapter(wanted);
  }, []);

  const chapter = active ? chapterById(active.chapterId) : undefined;
  const resolved = active ? data?.chapters.find(entry => entry.id === active.chapterId) : undefined;
  const step = chapter && active ? chapter.steps[active.index] : undefined;
  const copy = step ? stepCopy(step, mobile) : undefined;
  const allowedIndexes = resolved ? resolved.steps.map((entry, index) => entry.available ? index : -1).filter(index => index >= 0) : [];
  const position = active ? allowedIndexes.indexOf(active.index) + 1 : 0;
  const last = position > 0 && position === allowedIndexes.length;
  const moduleAllowed = copy?.module ? modules.includes(copy.module) : false;
  const spotKey = active ? `${active.chapterId}:${active.index}:${tab}:${copy?.target ?? ''}` : '';
  const found = spot.key === spotKey ? spot.found : null;
  /** O controle fica em outro módulo que a pessoa pode abrir: o cartão oferece ir até lá. */
  const goTo = Boolean(copy?.module && moduleAllowed && tab !== copy.module && found !== true);

  // Destaque do controle real. A página pode estar carregando: tenta por até ~2,5 s.
  useEffect(() => {
    if (!copy) return;
    let tries = 0, timer = 0, spotted: HTMLElement | null = null;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const look = () => {
      const target = visibleTarget(copy.target);
      if (target) {
        spotted = target; target.setAttribute(SPOT, '');
        // Rola só se parte do controle estiver escondida: atrás do cabeçalho, do próprio cartão ou fora da tela.
        // Leva o fim do controle para logo acima do cartão, sem passar o começo para baixo do cabeçalho.
        const box = target.getBoundingClientRect(), guide = card.current?.getBoundingClientRect();
        const coversCard = Boolean(guide) && box.left < guide!.right && box.right > guide!.left;
        const limit = coversCard ? guide!.top - 16 : innerHeight - 16;
        const toTop = copy.reveal === 'below' && box.top > TOP_GAP + 8;
        if (!pinned(target) && (toTop || box.top < TOP_GAP || box.bottom > limit)) window.scrollBy({ top: toTop || box.top < TOP_GAP ? box.top - TOP_GAP : Math.min(box.top - TOP_GAP, box.bottom - limit), behavior: reduce ? 'auto' : 'smooth' });
        setSpot({ key: spotKey, found: true }); return;
      }
      if (!copy.target) { setSpot({ key: spotKey, found: null }); return; }
      // Depois de ~1 s (passo com texto próprio) ou ~2,5 s mostra o aviso, mas continua procurando: a pessoa pode abrir a ficha com o cartão aberto.
      const patience = copy.missing ? 4 : 10;
      if (++tries === patience) setSpot({ key: spotKey, found: false });
      timer = window.setTimeout(look, tries < patience ? 250 : 1000);
    };
    timer = window.setTimeout(look, 0);
    return () => { window.clearTimeout(timer); spotted?.removeAttribute(SPOT); };
  }, [spotKey, mobile]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    const timer = window.setTimeout(() => heading.current?.focus({ preventScroll: true }), 400);
    return () => window.clearTimeout(timer);
  }, [tab]);

  useEffect(() => {
    const element = card.current;
    if (!element) return;
    const check = () => setMore(element.scrollTop + element.clientHeight < element.scrollHeight - 4);
    const timer = window.setTimeout(check, 0);
    element.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return () => { window.clearTimeout(timer); element.removeEventListener('scroll', check); window.removeEventListener('resize', check); };
  }, [step?.id, mobile, found]);

  // O título do cartão recebe o foco a cada passo (o anúncio fica com o leitor de tela).
  useEffect(() => { if (step) heading.current?.focus({ preventScroll: true }); }, [step?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Janela de assuntos: Escape fecha e o foco volta para quem abriu; Tab fica dentro dela.
  useEffect(() => {
    if (!chooser) return;
    const timer = window.setTimeout(() => dialog.current?.querySelector<HTMLElement>('button')?.focus(), 0);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') closeTutorialChooser(); };
    document.addEventListener('keydown', escape);
    return () => { window.clearTimeout(timer); document.removeEventListener('keydown', escape); };
  }, [chooser]);

  return <>
    {chooser && <div className={styles.backdrop} onPointerDown={event => { if (event.target === event.currentTarget) closeTutorialChooser(); }}>
      <div ref={dialog} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="tutorial-chooser-title" onKeyDown={event => {
        if (event.key !== 'Tab') return;
        const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled)'));
        const first = focusable[0], end = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); end?.focus(); }
        else if (!event.shiftKey && document.activeElement === end) { event.preventDefault(); first?.focus(); }
      }}>
        <header className={styles.dialogHead}>
          <img src="/brand/role-mascote/role-rosto.svg" alt="" width={40} height={40}/>
          <div><h2 id="tutorial-chooser-title">Ajuda e tutoriais</h2><p>Escolha um assunto. O Rolê mostra só o que o seu acesso permite.</p></div>
          <button type="button" className="p-icon-button" aria-label="Fechar ajuda e tutoriais" onClick={() => closeTutorialChooser()}><X size={18} aria-hidden="true"/></button>
        </header>
        <ChapterList headingLevel={3}/>
      </div>
    </div>}
    {chapter && step && copy && <section ref={card} className={`${styles.guide}${more ? ` ${styles.hasMore}` : ''}`} aria-labelledby="tutorial-step-title" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); pauseTutorial(); } }}>
      <header className={styles.guideHead}>
        <img src="/brand/role-mascote/role-rosto.svg" alt="" width={36} height={36}/>
        <p className={styles.guideContext}><LifeBuoy size={14} aria-hidden="true"/>{chapter.title} · {position} de {allowedIndexes.length}</p>
        <button type="button" className={`p-icon-button ${styles.guideClose}`} aria-label="Pausar o tutorial (continua de onde parou)" title="Pausar o tutorial (continua de onde parou)" onClick={pauseTutorial}><X size={18} aria-hidden="true"/></button>
      </header>
      <h2 id="tutorial-step-title" ref={heading} tabIndex={-1}>{step.title}</h2>
      <p className={styles.speech}>{copy.speech}</p>
      <p className={styles.see}><strong>{found === false && !goTo && copy.missing ? 'Para continuar:' : 'Você verá:'}</strong> {goTo && copy.beforeOpen ? copy.beforeOpen : found === false && !goTo ? (copy.missing ?? 'este controle não está nesta página agora.') : copy.youWillSee}</p>
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {found === false && !goTo && !copy.missing && <p className={styles.muted}>Siga para o próximo passo: este controle aparece quando houver dados ou acesso para ele.</p>}
      <div className={styles.guideActions}>
        {last ? <>
          <button type="button" className={`p-button p-button-primary ${styles.goTo}`} onClick={() => finishTutorial()}>Concluir</button>
          <button type="button" className="p-button p-button-subtle" onClick={() => finishTutorial('repeat')}><RotateCcw size={16} aria-hidden="true"/>Repetir esta parte</button>
          {TUTORIAL_CHAPTERS.length > 1 && <button type="button" className="p-button p-button-subtle" onClick={() => finishTutorial('chooser')}>Ver outros assuntos</button>}
        </> : <>
          {goTo && <button type="button" className={`p-button p-button-primary ${styles.goTo}`} onClick={() => { refocus.current = true; heading.current?.focus({ preventScroll: true }); onNavigate(copy.module!); }}>{copy.openLabel}<ArrowRight size={16} aria-hidden="true"/></button>}
          {position > 1 && <button type="button" className={`p-button p-button-subtle ${styles.compact}`} onClick={previousStep} aria-label="Voltar"><ArrowLeft size={16} aria-hidden="true"/><span className={styles.label}>Voltar</span></button>}
          <button type="button" className="p-button p-button-subtle" onClick={pauseTutorial}><Pause size={16} aria-hidden="true"/>Pausar</button>
          <button type="button" className={`p-button ${goTo ? 'p-button-subtle' : 'p-button-primary'} ${styles.next}`} onClick={nextStep}>{goTo ? 'Pular' : 'Próximo'}<ArrowRight size={16} aria-hidden="true"/></button>
        </>}
      </div>
    </section>}
  </>;
}
