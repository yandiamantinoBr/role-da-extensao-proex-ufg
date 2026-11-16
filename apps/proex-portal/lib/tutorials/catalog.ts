// Catálogo dos tutoriais do Portal (roteiro: docs/ROTEIRO-TUTORIAIS-PROEX.md). Conteúdo roteirizado,
// sem IA: funciona sem chave, consentimento de provedor, widgets ou saldo. Dados puros, usados pela tela
// e pelo servidor. Identificadores de capítulo e de passo são estáveis: mudar o texto não apaga progresso;
// tirar um passo faz quem parou nele retomar no próximo permitido. Suba `version` quando a ordem, a fala
// ou o caminho de um capítulo mudarem.
import type { ModuleId } from '../../components/portal/navigation-model';

/** O que o acesso atual precisa ter para o passo aparecer. Conferido no servidor a cada abertura. */
export type StepRequirement = {
  /** Pelo menos um projeto autorizado. */
  projects?: true;
  /** Capacidade no projeto escolhido (`selected`) ou em algum projeto (`any`, padrão). */
  capability?: string;
  scope?: 'selected' | 'any';
};

export type TutorialStep = {
  id: string;
  title: string;
  /** Fala do Rolê no computador (e no celular, quando não houver `speechMobile`). */
  speech: string;
  speechMobile?: string;
  /** "Você verá": o resultado que a pessoa reconhece na tela. */
  youWillSee: string;
  youWillSeeMobile?: string;
  /** Controle destacado na página (seletor CSS de uma âncora `data-tutorial` ou `id`). */
  target?: string;
  targetMobile?: string;
  /** Módulo onde o controle fica; a tela oferece "Abrir no Portal" fora dele. */
  module?: ModuleId;
  moduleMobile?: ModuleId;
  /** Texto do botão que leva ao módulo do passo (ex.: "Ir para Meus acessos"). */
  openLabel?: string;
  /** "Você verá" enquanto a pessoa ainda não foi ao módulo do passo. */
  beforeOpen?: string;
  beforeOpenMobile?: string;
  requires?: StepRequirement;
  /** Rótulos da interface citados no passo. Um teste confere que existem no código. */
  labels: string[];
};

export type TutorialChapter = {
  id: string;
  version: number;
  title: string;
  summary: string;
  /** Duração aproximada, para o convite. */
  minutes: number;
  steps: TutorialStep[];
};

export const TUTORIAL_INVITE_ID = 'convite';

export const TUTORIAL_CHAPTERS: readonly TutorialChapter[] = [
  {
    id: 'navegacao', version: 1, title: 'Navegação', minutes: 3,
    summary: 'Voltar ao Início, achar os módulos, fixar atalhos, escolher o projeto e conferir seus acessos.',
    steps: [
      {
        id: 'boas-vindas', title: 'Comece por aqui',
        speech: 'Oi, eu sou o Rolê. Em poucos passos você vai se localizar no Portal. O tour não muda seus registros de trabalho: só mostro onde ficam as coisas.',
        youWillSee: 'Este cartão. Use Próximo para seguir, Voltar para rever e Pausar para continuar outra hora.',
        labels: [],
      },
      {
        id: 'inicio', title: 'O Início',
        speech: 'O Início reúne o seu resumo e o que pede atenção. De qualquer página, volte a ele pelo Início no menu.',
        speechMobile: 'O Início reúne o seu resumo e o que pede atenção. De qualquer página, volte a ele pelo Início na barra de baixo.',
        youWillSee: 'O item Início destacado no menu.',
        youWillSeeMobile: 'O item Início destacado na barra de baixo.',
        target: '[data-tutorial="nav-inicio"]', labels: ['Início'],
      },
      {
        id: 'menu', title: 'Onde ficam os módulos',
        speech: 'No computador, os módulos ficam no menu à esquerda, no grupo Trabalho e, conforme o seu acesso, em Gestão. Recolher menu deixa só os ícones para ganhar espaço.',
        speechMobile: 'No celular, a barra de baixo mostra o Início e três atalhos. Mais abre a lista completa, com uma busca de módulos.',
        youWillSee: 'O menu lateral destacado.', youWillSeeMobile: 'A barra de baixo destacada, com o Mais à direita.',
        target: '[data-tutorial="nav-menu"]', targetMobile: '[data-tutorial="nav-barra"]',
        labels: ['Trabalho', 'Gestão', 'Recolher menu', 'Mais'],
      },
      {
        id: 'fixar', title: 'Fixar atalhos',
        speech: 'Fixe os módulos que você mais usa: eles passam a aparecer em Seus atalhos, no alto do menu. Aqui no Início, clique em Personalizar ou no alfinete ao lado de um módulo.',
        speechMobile: 'Fixe os módulos que você mais usa: eles vão para a barra de baixo. Em Mais, toque no alfinete ao lado do módulo.',
        youWillSee: 'O botão Personalizar do Início destacado. A escolha fica salva na sua conta.',
        youWillSeeMobile: 'O botão Mais destacado. Lá dentro, cada módulo tem um alfinete.',
        target: '[data-tutorial="inicio-personalizar"]', targetMobile: '[data-tutorial="nav-mais"]', module: 'overview', openLabel: 'Ir para o Início', beforeOpen: 'Clique em Ir para o Início: Personalizar fica no quadro de módulos.', beforeOpenMobile: 'Toque em Ir para o Início: Personalizar fica no quadro de módulos.',
        labels: ['Seus atalhos', 'Personalizar', 'Mais'],
      },
      {
        id: 'projeto', title: 'Escolher o projeto',
        speech: 'No campo Projeto, onde está escrito Todos os projetos, escolha um projeto: listas e números passam a mostrar só ele. Para ver tudo de novo, volte para Todos os projetos.',
        youWillSee: 'O campo Projeto destacado no alto da página.',
        target: '#filtro-projeto', module: 'overview', openLabel: 'Ir para o Início', beforeOpen: 'Clique em Ir para o Início: o campo Projeto fica no alto da página.', beforeOpenMobile: 'Toque em Ir para o Início: o campo Projeto fica no alto da página.', requires: { projects: true },
        labels: ['Projeto', 'Todos os projetos'],
      },
      {
        id: 'conta', title: 'O menu da conta',
        speech: 'Seu nome, no alto da página, abre o menu da conta: Minha conta e senha, Atualizar dados e Sair. Ajuda e tutoriais também fica ali.',
        speechMobile: 'A sua foto ou inicial, no alto da página, abre o menu da conta: Minha conta e senha, Atualizar dados e Sair. Ajuda e tutoriais também fica ali.',
        youWillSee: 'O seu nome destacado no alto da página.',
        youWillSeeMobile: 'A sua foto ou inicial destacada no alto da página.',
        target: '[data-tutorial="conta-menu"]',
        labels: ['Minha conta e senha', 'Atualizar dados', 'Ajuda e tutoriais'],
      },
      {
        id: 'meus-acessos', title: 'Meus acessos',
        speech: 'Na sua conta, Meus acessos mostra qual função vale em cada projeto, organização ou ação. Se faltar um acesso, peça a quem enviou o convite ou à coordenação.',
        speechMobile: 'Meus acessos mostra sua função em cada projeto ou ação. Se faltar um acesso, peça a quem enviou o convite ou à coordenação.',
        youWillSee: 'O quadro Meus acessos destacado na sua conta.',
        target: '[data-tutorial="meus-acessos"]', module: 'profile', openLabel: 'Ir para Meus acessos', beforeOpen: 'Clique em Ir para Meus acessos: a sua conta abre com o quadro destacado.', beforeOpenMobile: 'Toque em Ir para Meus acessos: a sua conta abre com o quadro destacado.',
        labels: ['Meus acessos'],
      },
      {
        id: 'fim', title: 'Tudo certo',
        speech: 'Você já sabe se localizar no Portal. Para rever, abra Ajuda e tutoriais no menu da conta.',
        speechMobile: 'Você já sabe se localizar no Portal. Para rever, abra Ajuda e tutoriais no menu da conta ou em Mais.',
        youWillSee: 'Você pode repetir esta parte ou ver outros assuntos.',
        labels: ['Ajuda e tutoriais'],
      },
    ],
  },
];

export const chapterById = (id: unknown) => TUTORIAL_CHAPTERS.find(chapter => chapter.id === id);
export const stepById = (chapter: TutorialChapter, id: unknown) => chapter.steps.find(step => step.id === id);

/** Contexto de acesso usado para decidir os passos. `null` = alcance de toda a organização ou do Portal. */
export type TutorialAccess = {
  projectScope: string[] | null;
  selectedProject: string | null;
  capabilityScope: (capability: string) => string[] | null;
};
export type ResolvedStep = { id: string; available: boolean; reason?: string };

const inScope = (scope: string[] | null, project: string | null) => scope === null || (project ? scope.includes(project) : scope.length > 0);

/** Quais passos o acesso atual permite. O texto do motivo nunca cita projeto, pessoa ou outra organização. */
export function resolveSteps(chapter: TutorialChapter, access: TutorialAccess): ResolvedStep[] {
  return chapter.steps.map(step => {
    const need = step.requires;
    if (!need) return { id: step.id, available: true };
    if (need.projects && !inScope(access.projectScope, null)) return { id: step.id, available: false, reason: 'Este passo aparece quando sua conta tiver um projeto.' };
    if (need.capability) {
      const scope = access.capabilityScope(need.capability);
      const ok = need.scope === 'selected' ? Boolean(access.selectedProject) && inScope(scope, access.selectedProject) : inScope(scope, null);
      if (!ok) return { id: step.id, available: false, reason: need.scope === 'selected' ? 'Seu acesso no projeto escolhido não inclui esta parte.' : 'Seu acesso atual não inclui esta parte.' };
    }
    return { id: step.id, available: true };
  });
}

/**
 * Onde retomar: o passo salvo, se ainda existe e é permitido; senão o próximo permitido depois dele;
 * senão o primeiro permitido. Devolve o índice no capítulo, ou -1 se nada estiver disponível.
 */
export function resumeIndex(chapter: TutorialChapter, resolved: ResolvedStep[], savedStep?: string | null): number {
  const allowed = (index: number) => resolved[index]?.available === true;
  const saved = savedStep ? chapter.steps.findIndex(step => step.id === savedStep) : -1;
  if (saved >= 0) {
    for (let index = saved; index < chapter.steps.length; index++) if (allowed(index)) return index;
  }
  return chapter.steps.findIndex((_, index) => allowed(index));
}
