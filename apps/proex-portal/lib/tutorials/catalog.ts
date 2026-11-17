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
  /** Administra pelo menos uma organização (ex.: demandas gerais). */
  manageOrganization?: true;
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
  /** `below`: leva o controle ao alto da tela, para mostrar também o que vem logo depois dele (ex.: o primeiro cartão de uma lista). */
  reveal?: 'below';
  /** Texto no lugar de "este controle não está nesta página" (ex.: "Abra um projeto…"). */
  missing?: string;
  missingMobile?: string;
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
        youWillSee: 'Concluir fecha o tutorial. Repetir esta parte começa de novo.',
        labels: ['Ajuda e tutoriais'],
      },
    ],
  },
  {
    id: 'meu-trabalho', version: 1, title: 'Meu trabalho', minutes: 3,
    summary: 'Encontrar o que chegou para você e para suas equipes, com prazos e responsabilidades.',
    steps: [
      {
        id: 'abrir', title: 'O que chegou para você',
        speech: 'Meu trabalho reúne as demandas atribuídas a você e às suas equipes, nos projetos que você pode ver. Seguir este tutorial não muda nada no seu trabalho.',
        youWillSee: 'O título Suas atribuições, no alto do módulo.',
        target: '[data-tutorial="trabalho-inicio"]', module: 'my-work', openLabel: 'Ir para Meu trabalho',
        beforeOpen: 'Clique em Ir para Meu trabalho: o módulo abre com as suas atribuições.', beforeOpenMobile: 'Toque em Ir para Meu trabalho: o módulo abre com as suas atribuições.',
        labels: ['Meu trabalho', 'Suas atribuições'],
      },
      {
        id: 'projeto', title: 'Um projeto ou todos',
        speech: 'No campo Projeto, escolha um projeto para ver só o trabalho dele. A primeira opção, Todos os projetos, mostra tudo de novo.',
        youWillSee: 'O campo Projeto destacado, acima das atribuições.',
        target: '[data-tutorial="trabalho-projeto"]', module: 'my-work', openLabel: 'Ir para Meu trabalho', requires: { projects: true },
        labels: ['Projeto', 'Todos os projetos'],
      },
      {
        id: 'origem', title: 'De onde veio a tarefa',
        speech: 'Diretas são as demandas com o seu nome. Por equipe são as que chegaram para uma equipe sua. Todas junta as duas. Cada cartão diz a origem: Atribuição direta, Pela sua equipe ou Direta e pela equipe.',
        speechMobile: 'Diretas têm o seu nome; Por equipe chegaram a uma equipe sua; Todas junta as duas. Se veio pelos dois caminhos, o cartão diz Direta e pela equipe.',
        youWillSee: 'Os botões Todas, Diretas e Por equipe destacados.',
        target: '[data-tutorial="trabalho-origem"]', module: 'my-work', openLabel: 'Ir para Meu trabalho',
        labels: ['Todas', 'Diretas', 'Por equipe', 'Atribuição direta', 'Pela sua equipe', 'Direta e pela equipe'],
      },
      {
        id: 'totais', title: 'O que pede atenção',
        speech: 'Os quadros somam suas demandas no projeto e na origem escolhidos, inclusive as que não cabem na lista. Clique em Atenção, Prazo hoje, Em andamento ou Concluídas para ver só essas na lista de Demandas.',
        speechMobile: 'Os quadros somam suas demandas no projeto e na origem escolhidos. Toque em Atenção, Prazo hoje, Em andamento ou Concluídas para ver só essas na lista de Demandas.',
        youWillSee: 'Os quatro quadros de totais destacados.',
        target: '[data-tutorial="trabalho-totais"]', module: 'my-work', openLabel: 'Ir para Meu trabalho',
        labels: ['Atenção', 'Prazo hoje', 'Em andamento', 'Concluídas'],
      },
      {
        id: 'demandas', title: 'Abrir uma demanda',
        speech: 'Cada cartão mostra a situação, a prioridade, o prazo e os responsáveis. Clique no título para abrir a demanda. Lista vazia? Escolha Todas no Estado da lista ou troque o projeto.',
        speechMobile: 'Cada cartão mostra a situação, a prioridade, o prazo e os responsáveis. Toque no título para abrir a demanda. Lista vazia? Escolha Todas no Estado da lista ou troque o projeto.',
        youWillSee: 'O título Demandas e o Estado da lista destacados. Quando houver demandas, os cartões aparecem logo abaixo.',
        target: '[data-tutorial="trabalho-demandas"]', reveal: 'below', module: 'my-work', openLabel: 'Ir para Meu trabalho',
        labels: ['Estado da lista', 'Demandas'],
      },
      {
        id: 'responsabilidades', title: 'Responsabilidades',
        speech: 'Responsabilidades mostram quem cuida de uma frente contínua num projeto, como materiais ou empréstimos: você ou uma equipe sua. Não têm prazo como uma demanda e não mudam o que você pode abrir: isso vem dos seus acessos.',
        youWillSee: 'A lista Responsabilidades destacada, abaixo das demandas.',
        target: '[data-tutorial="trabalho-responsabilidades"]', module: 'my-work', openLabel: 'Ir para Meu trabalho',
        labels: ['Responsabilidades'],
      },
      {
        id: 'fim', title: 'Tudo certo',
        speech: 'Você já sabe encontrar o seu trabalho. Se alguém acabou de atribuir algo a você, use Atualizar, ao lado de Suas atribuições.',
        youWillSee: 'O botão Atualizar destacado. Concluir fecha o tutorial; Repetir esta parte começa de novo.',
        target: '[data-tutorial="trabalho-atualizar"]', module: 'my-work', openLabel: 'Ir para Meu trabalho',
        labels: ['Atualizar', 'Suas atribuições'],
      },
    ],
  },
  {
    id: 'projetos', version: 1, title: 'Projetos', minutes: 4,
    summary: 'Achar um projeto, fixá-lo e abrir a ficha com cronograma, materiais e documentos.',
    steps: [
      {
        id: 'abrir', title: 'Os seus projetos',
        speech: 'Projetos reúne os programas e projetos que você pode ver, organizados por unidade. Seguir este tutorial não muda nada nos projetos.',
        youWillSee: 'O título Projetos da equipe destacado, acima da lista.',
        target: '[data-tutorial="projetos-inicio"]', module: 'projects', openLabel: 'Ir para Projetos',
        beforeOpen: 'Clique em Ir para Projetos: o módulo abre com a lista de projetos.', beforeOpenMobile: 'Toque em Ir para Projetos: o módulo abre com a lista de projetos.',
        labels: ['Projetos'],
      },
      {
        id: 'buscar', title: 'Achar um projeto',
        speech: 'Em Buscar projeto, escreva o nome, a sigla ou a unidade. Refinar projetos filtra por unidade, área, modalidade e situação. Os botões logo abaixo separam projetos internos e externos.',
        youWillSee: 'A busca e o Refinar projetos destacados.',
        target: '[data-tutorial="projetos-filtros"]', module: 'projects', openLabel: 'Ir para Projetos', requires: { projects: true },
        labels: ['Buscar projeto', 'Refinar projetos'],
      },
      {
        id: 'fixar', title: 'Fixar um projeto',
        speech: 'O alfinete de cada cartão fixa o projeto: ele sobe para Fixados, no alto da lista, e aparece no menu lateral. Clique de novo para desafixar.',
        speechMobile: 'O alfinete de cada cartão fixa o projeto: ele sobe para Fixados, no alto da lista. Toque de novo para desafixar.',
        youWillSee: 'O alfinete do primeiro cartão destacado.',
        target: '[data-tutorial="projetos-fixar"]', module: 'projects', openLabel: 'Ir para Projetos', requires: { projects: true },
        labels: ['Fixados'],
      },
      {
        id: 'acessar', title: 'Abrir a ficha',
        speech: 'Acessar projeto abre a ficha com materiais, documentos e cronograma. Clique em Acessar projeto em um cartão para seguir.',
        speechMobile: 'Acessar projeto abre a ficha com materiais, documentos e cronograma. Toque em Acessar projeto em um cartão para seguir.',
        youWillSee: 'O Acessar projeto do primeiro cartão destacado.',
        target: '[data-tutorial="projetos-acessar"]', module: 'projects', openLabel: 'Ir para Projetos', requires: { projects: true },
        missing: 'Você já está numa ficha. Siga para o próximo passo.',
        labels: ['Acessar projeto'],
      },
      {
        id: 'materiais', title: 'Materiais e atividades',
        speech: 'Materiais e atividades reúne materiais, dinâmicas, empréstimos e registros do projeto, conforme o seu acesso.',
        youWillSee: 'O quadro Materiais e atividades destacado.',
        target: '#project-operations', module: 'projects', openLabel: 'Ir para Projetos', requires: { projects: true },
        missing: 'Abra um projeto com Acessar projeto. Se esta parte não aparecer na ficha, o seu acesso não inclui materiais, dinâmicas, empréstimos nem registros deste projeto.',
        labels: ['Materiais e atividades'],
      },
      {
        id: 'links', title: 'Links e documentos',
        speech: 'Links e documentos guarda páginas, relatórios, editais e arquivos de referência do projeto.',
        youWillSee: 'O quadro Links e documentos destacado.',
        target: '[data-tutorial="projeto-links"]', module: 'projects', openLabel: 'Ir para Projetos', missing: 'Abra um projeto com Acessar projeto: esta parte fica na ficha.', missingMobile: 'Abra um projeto com Acessar projeto: esta parte fica na ficha.', requires: { projects: true },
        labels: ['Links e documentos'],
      },
      {
        id: 'cronograma', title: 'Cronograma',
        speech: 'Mais abaixo na ficha, Cronograma mostra as datas importantes e as próximas atividades do projeto. Quem pode editar a ficha vê o botão Atividade para incluir uma.',
        youWillSee: 'O quadro Cronograma destacado na ficha.',
        target: '#project-timeline', module: 'projects', openLabel: 'Ir para Projetos', missing: 'Abra um projeto com Acessar projeto: esta parte fica na ficha.', missingMobile: 'Abra um projeto com Acessar projeto: esta parte fica na ficha.', requires: { projects: true },
        labels: ['Cronograma', 'Atividade'],
      },
      {
        id: 'voltar', title: 'Voltar à lista',
        speech: 'Todos os projetos volta à lista. Os atalhos da ficha, como Meu trabalho e Demandas, abrem esses módulos já neste projeto. Usar este projeto nos outros módulos, no fim da ficha, leva ao Início com este projeto escolhido.',
        speechMobile: 'Todos os projetos volta à lista. Os atalhos da ficha, como Demandas, abrem esses módulos já neste projeto.',
        youWillSee: 'O botão Todos os projetos destacado, no alto da ficha.',
        target: '[data-tutorial="projeto-voltar"]', module: 'projects', openLabel: 'Ir para Projetos', missing: 'Abra um projeto com Acessar projeto: esta parte fica na ficha.', missingMobile: 'Abra um projeto com Acessar projeto: esta parte fica na ficha.', requires: { projects: true },
        labels: ['Todos os projetos', 'Usar este projeto nos outros módulos'],
      },
      {
        id: 'fim', title: 'Tudo certo',
        speech: 'Você já sabe achar um projeto e abrir a ficha. Editar projeto só aparece para quem pode alterar a ficha; o resto também depende do seu acesso naquele projeto.',
        youWillSee: 'Concluir fecha o tutorial. Repetir esta parte começa de novo.',
        labels: ['Editar projeto'],
      },
    ],
  },
  {
    id: 'demandas', version: 1, title: 'Demandas', minutes: 4,
    summary: 'Escolher o projeto, filtrar, abrir uma demanda e entender estados, edição e histórico.',
    steps: [
      {
        id: 'abrir', title: 'Demandas da equipe',
        speech: 'Demandas reúne o trabalho com responsável e prazo. Comece pelo campo Projeto: escolha um projeto ou deixe Todos os projetos autorizados. Seguir este tutorial não muda nenhuma demanda.',
        youWillSee: 'O campo Projeto destacado, no alto do módulo.',
        target: '[data-tutorial="demandas-projeto"]', module: 'demands', openLabel: 'Ir para Demandas', requires: { projects: true },
        beforeOpen: 'Clique em Ir para Demandas: o módulo abre com a lista.', beforeOpenMobile: 'Toque em Ir para Demandas: o módulo abre com a lista.',
        labels: ['Demandas', 'Projeto', 'Todos os projetos autorizados'],
      },
      {
        id: 'filtros', title: 'Buscar e filtrar',
        speech: 'Buscar acha pelo título. Buscar e filtrar abre Estado e Prioridade. Quando houver filtro, Limpar busca e filtros volta a mostrar tudo.',
        youWillSee: 'A busca e o Buscar e filtrar destacados.',
        target: '[data-tutorial="demandas-filtros"]', module: 'demands', openLabel: 'Ir para Demandas', requires: { projects: true },
        labels: ['Buscar', 'Buscar e filtrar', 'Estado', 'Prioridade', 'Limpar busca e filtros'],
      },
      {
        id: 'lista', title: 'A lista',
        speech: 'Cada linha mostra a situação, a prioridade e o prazo. Clique numa demanda para abrir o detalhe.',
        speechMobile: 'Cada linha mostra a situação, a prioridade e o prazo. Toque numa demanda para abrir o detalhe.',
        youWillSee: 'O título da lista destacado. Quando houver demandas, elas aparecem logo abaixo.',
        target: '[data-tutorial="demandas-lista"]', reveal: 'below', module: 'demands', openLabel: 'Ir para Demandas', requires: { projects: true },
        labels: [],
      },
      {
        id: 'detalhe', title: 'O detalhe',
        speech: 'O detalhe mostra o andamento, os responsáveis e o checklist. O link Histórico abre as mudanças desta demanda em Registros.',
        youWillSee: 'O detalhe da demanda destacado.',
        target: '[data-tutorial="demanda-detalhe"]', module: 'demands', openLabel: 'Ir para Demandas', requires: { projects: true },
        missing: 'Abra uma demanda da lista: o detalhe aparece ao lado.', missingMobile: 'Toque numa demanda da lista: o detalhe aparece logo abaixo dela.',
        labels: ['Histórico'],
      },
      {
        id: 'estados', title: 'Editar e mudar o estado',
        speech: 'Editar demanda muda título, responsáveis, prazo e estado: Aberta, Em andamento, Bloqueada (diga o que falta), Concluída ou Cancelada.',
        youWillSee: 'O botão Editar demanda destacado.',
        target: '[data-tutorial="demanda-editar"]', module: 'demands', openLabel: 'Ir para Demandas', requires: { projects: true },
        missing: 'Abra uma demanda. Se Editar demanda não aparecer, você acompanha a demanda e responde só ao que estiver liberado para você.',
        labels: ['Editar demanda', 'Aberta', 'Em andamento', 'Bloqueada', 'Concluída', 'Cancelada'],
      },
      {
        id: 'nova', title: 'Criar uma demanda',
        speech: 'Para criar, escolha um projeto e use Nova demanda: informe o título, o responsável e o prazo.',
        youWillSee: 'O botão Nova demanda destacado.',
        target: '[data-tutorial="demandas-acoes"]', module: 'demands', openLabel: 'Ir para Demandas', requires: { projects: true },
        missing: 'Nova demanda aparece depois de escolher um projeto em que você pode criar demandas.',
        labels: ['Nova demanda'],
      },
      {
        id: 'gerais', title: 'Demandas gerais',
        speech: 'Como você administra uma organização: em Buscar e filtrar, escolha a Organização. O campo Projeto passa a oferecer Somente demandas gerais, para o trabalho que não pertence a um projeto.',
        youWillSee: 'O campo Projeto destacado.',
        target: '[data-tutorial="demandas-projeto"]', module: 'demands', openLabel: 'Ir para Demandas', requires: { manageOrganization: true },
        labels: ['Organização', 'Somente demandas gerais'],
      },
      {
        id: 'fim', title: 'Tudo certo',
        speech: 'Você já sabe achar, abrir e acompanhar uma demanda. O que você pode mudar depende do seu acesso em cada projeto.',
        youWillSee: 'Concluir fecha o tutorial. Repetir esta parte começa de novo.',
        requires: { projects: true },
        labels: [],
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
  managesOrganization?: boolean;
};
export type ResolvedStep = { id: string; available: boolean; reason?: string };

const inScope = (scope: string[] | null, project: string | null) => scope === null || (project ? scope.includes(project) : scope.length > 0);

/** Quais passos o acesso atual permite. O texto do motivo nunca cita projeto, pessoa ou outra organização. */
export function resolveSteps(chapter: TutorialChapter, access: TutorialAccess): ResolvedStep[] {
  return chapter.steps.map(step => {
    const need = step.requires;
    if (!need) return { id: step.id, available: true };
    if (need.projects && !inScope(access.projectScope, null)) return { id: step.id, available: false, reason: 'Este passo aparece quando sua conta tiver um projeto.' };
    if (need.manageOrganization && !access.managesOrganization) return { id: step.id, available: false, reason: 'Este passo é para quem administra uma organização.' };
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
