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
  /** Pelo menos uma categoria da Agenda legível (a mesma regra que mostra o módulo). */
  calendar?: true;
  /** Pelo menos uma destas capacidades em algum projeto (a regra de módulos como Materiais). */
  anyOf?: string[];
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
        speech: 'Demandas reúne o trabalho de cada projeto, com responsáveis e, quando houver, prazo. Comece pelo campo Projeto: escolha um projeto ou deixe Todos os projetos autorizados. Seguir este tutorial não muda nenhuma demanda.',
        speechMobile: 'Comece pelo campo Projeto: escolha um projeto ou deixe Todos os projetos autorizados. Seguir este tutorial não muda nenhuma demanda.',
        youWillSee: 'O campo Projeto destacado, no alto do módulo.',
        target: '[data-tutorial="demandas-projeto"]', module: 'demands', openLabel: 'Ir para Demandas', requires: { projects: true },
        beforeOpen: 'Clique em Ir para Demandas: o módulo abre com a lista.', beforeOpenMobile: 'Toque em Ir para Demandas: o módulo abre com a lista.',
        labels: ['Projeto', 'Todos os projetos autorizados'],
      },
      {
        id: 'filtros', title: 'Buscar e filtrar',
        speech: 'Buscar acha pelo título ou pelo contexto. Buscar e filtrar abre Estado e Prioridade. Quando houver filtro, Limpar busca e filtros volta a mostrar tudo.',
        youWillSee: 'A busca e o Buscar e filtrar destacados.',
        target: '[data-tutorial="demandas-filtros"]', module: 'demands', openLabel: 'Ir para Demandas', requires: { projects: true },
        labels: ['Buscar', 'Buscar e filtrar', 'Estado', 'Prioridade', 'Limpar busca e filtros'],
      },
      {
        id: 'gerais', title: 'Demandas gerais',
        speech: 'Como você administra uma organização: em Buscar e filtrar, escolha a Organização. O campo Projeto passa a oferecer Somente demandas gerais, para o trabalho que não pertence a um projeto.',
        youWillSee: 'Os filtros destacados: a Organização fica em Buscar e filtrar; Somente demandas gerais aparece no campo Projeto.',
        target: '[data-tutorial="demandas-filtros"]', module: 'demands', openLabel: 'Ir para Demandas', requires: { manageOrganization: true },
        labels: ['Organização', 'Somente demandas gerais'],
      },
      {
        id: 'lista', title: 'A lista',
        speech: 'Cada cartão mostra a situação, a prioridade, o prazo, o projeto e os responsáveis. Clique num cartão para abrir o detalhe.',
        speechMobile: 'Cada cartão mostra a situação, a prioridade, o prazo, o projeto e os responsáveis. Toque num cartão para abrir o detalhe.',
        youWillSee: 'A lista de demandas destacada.',
        missing: 'Nenhuma demanda neste recorte. Troque o projeto ou use Limpar busca e filtros.',
        target: '[data-tutorial="demandas-lista"]', reveal: 'below', module: 'demands', openLabel: 'Ir para Demandas', requires: { projects: true },
        labels: [],
      },
      {
        id: 'detalhe', title: 'O detalhe',
        speech: 'O detalhe mostra a situação e o prazo; Cadastro e responsáveis diz quem cuida dela. No fim, abra Versões da demanda para ver o que mudou; lá dentro, o link Histórico abre tudo em Registros.',
        youWillSee: 'O detalhe da demanda destacado.',
        target: '[data-tutorial="demanda-detalhe"]', module: 'demands', openLabel: 'Ir para Demandas', requires: { projects: true },
        missing: 'Abra uma demanda da lista: o detalhe aparece ao lado.', missingMobile: 'Toque numa demanda da lista: o detalhe aparece logo abaixo dela.',
        labels: ['Cadastro e responsáveis', 'Versões da demanda', 'Histórico'],
      },
      {
        id: 'estados', title: 'Editar e mudar o estado',
        speech: 'Editar demanda muda título, responsáveis, prazo e estado: Aberta, Em andamento, Bloqueada (diga o que falta), Concluída ou Cancelada. Para um leitor responder ao checklist, a gestão usa Autorizar atualizações nesta demanda.',
        speechMobile: 'Editar demanda muda título, responsáveis, prazo e estado: Aberta, Em andamento, Bloqueada (diga o que falta), Concluída ou Cancelada. A gestão pode Autorizar atualizações nesta demanda para um leitor.',
        youWillSee: 'O botão Editar demanda destacado. Um checklist aberto pode impedir Concluída.',
        target: '[data-tutorial="demanda-editar"]', module: 'demands', openLabel: 'Ir para Demandas', requires: { projects: true },
        missing: 'Abra uma demanda. Se Editar demanda não aparecer, você acompanha a demanda e responde só ao que estiver liberado para você.',
        labels: ['Editar demanda', 'Aberta', 'Em andamento', 'Bloqueada', 'Concluída', 'Cancelada', 'Autorizar atualizações nesta demanda'],
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
        id: 'fim', title: 'Tudo certo',
        speech: 'Você já sabe achar, abrir e acompanhar uma demanda. O que você pode mudar depende do seu acesso em cada projeto.',
        youWillSee: 'Concluir fecha o tutorial. Repetir esta parte começa de novo.',
        requires: { projects: true },
        labels: [],
      },
    ],
  },
  {
    id: 'equipes', version: 1, title: 'Equipes', minutes: 3,
    summary: 'Escolher o recorte, abrir uma equipe e ver onde ela atua e como andam as demandas dela.',
    steps: [
      {
        id: 'abrir', title: 'Trabalho em equipe',
        speech: 'Equipes organiza quem faz o trabalho, como TI, Comunicação ou Eventos. Uma equipe pode atuar em mais de um projeto. O que cada pessoa pode abrir vem de Pessoas e acessos, não da equipe.',
        speechMobile: 'Equipes organiza quem faz o trabalho. Uma equipe pode atuar em mais de um projeto. O que cada pessoa pode abrir vem dos acessos, não da equipe.',
        youWillSee: 'O alto do módulo destacado, com Atualizar e, para quem administra, Nova equipe.',
        target: '[data-tutorial="equipes-inicio"]', module: 'work-teams', openLabel: 'Ir para Equipes', requires: { projects: true },
        beforeOpen: 'Clique em Ir para Equipes: o módulo abre com as equipes do recorte.', beforeOpenMobile: 'Toque em Ir para Equipes: o módulo abre com as equipes do recorte.',
        labels: ['Pessoas e acessos'],
      },
      {
        id: 'recorte', title: 'Escolher o recorte',
        speech: 'Escolha a Organização e, em Onde acompanhar, o projeto. Quem administra a organização também pode escolher a Organização inteira. Atuação da equipe separa as que atuam neste projeto, em vários projetos ou sem atuação registrada. Buscar equipe acha pelo nome, projeto ou unidade.',
        speechMobile: 'Escolha a Organização e, em Onde acompanhar, o projeto. Buscar equipe acha pelo nome, projeto ou unidade.',
        youWillSee: 'Os campos do recorte destacados, com Atuação da equipe.',
        target: '[data-tutorial="equipes-filtros"]', module: 'work-teams', openLabel: 'Ir para Equipes', requires: { projects: true },
        labels: ['Organização', 'Onde acompanhar', 'Atuação da equipe', 'Buscar equipe'],
      },
      {
        id: 'nova', title: 'Criar uma equipe',
        speech: 'Como você administra uma organização: Nova equipe cria uma equipe e escolhe os integrantes. Ela poderá receber demandas e responsabilidades nos projetos da organização.',
        youWillSee: 'O botão Nova equipe destacado.',
        target: '[data-tutorial="equipes-nova"]', module: 'work-teams', openLabel: 'Ir para Equipes', requires: { manageOrganization: true },
        missing: 'Nova equipe aparece quando Onde acompanhar está na Organização inteira.',
        labels: ['Nova equipe'],
      },
      {
        id: 'lista', title: 'As equipes',
        speech: 'Cada cartão mostra os integrantes visíveis, as demandas e quantas foram concluídas. Só minhas equipes mostra apenas as suas. Clique num cartão para abrir a equipe.',
        speechMobile: 'Cada cartão mostra os integrantes visíveis, as demandas e quantas foram concluídas. Toque num cartão para abrir a equipe.',
        youWillSee: 'Os cartões das equipes destacados.',
        target: '[data-tutorial="equipes-lista"]', reveal: 'below', module: 'work-teams', openLabel: 'Ir para Equipes', requires: { projects: true },
        missing: 'Nenhuma equipe neste recorte. Troque o projeto em Onde acompanhar ou limpe a busca.',
        labels: ['Só minhas equipes'],
      },
      {
        id: 'atuacao', title: 'Onde a equipe atua',
        speech: 'Projetos com atuação registrada mostra onde a equipe tem demandas ou responsabilidades. A mesma equipe aparece em dois recortes quando atua nos dois.',
        speechMobile: 'Projetos com atuação registrada mostra onde a equipe tem demandas ou responsabilidades.',
        youWillSee: 'O quadro Projetos com atuação registrada destacado.',
        target: '[data-tutorial="equipe-atuacao"]', module: 'work-teams', openLabel: 'Ir para Equipes', requires: { projects: true },
        missing: 'Abra uma equipe da lista: o detalhe aparece abaixo dos cartões.',
        labels: ['Projetos com atuação registrada'],
      },
      {
        id: 'andamento', title: 'Andamento das demandas',
        speech: 'Andamento das demandas conta as demandas da equipe por estado. Clique num estado para filtrar Demandas da equipe, mais abaixo.',
        speechMobile: 'Andamento das demandas conta as demandas da equipe por estado. Toque num estado para filtrar Demandas da equipe, mais abaixo.',
        youWillSee: 'O quadro Andamento das demandas destacado.',
        target: '[data-tutorial="equipe-andamento"]', module: 'work-teams', openLabel: 'Ir para Equipes', requires: { projects: true },
        missing: 'Abra uma equipe da lista: o andamento aparece no detalhe.',
        labels: ['Andamento das demandas', 'Demandas da equipe'],
      },
      {
        id: 'integrantes', title: 'Quem está na equipe',
        speech: 'Integrantes neste recorte mostra só as pessoas ativas com acesso ao contexto escolhido. Num projeto, quem é da equipe mas não tem acesso a ele não aparece.',
        speechMobile: 'Integrantes neste recorte mostra só as pessoas ativas com acesso ao contexto escolhido.',
        youWillSee: 'O quadro Integrantes neste recorte destacado.',
        target: '[data-tutorial="equipe-integrantes"]', module: 'work-teams', openLabel: 'Ir para Equipes', requires: { projects: true },
        missing: 'Abra uma equipe da lista: os integrantes aparecem no detalhe.',
        labels: ['Integrantes neste recorte'],
      },
      {
        id: 'fim', title: 'Tudo certo',
        speech: 'Você já sabe ver quem atua em cada equipe. Para indicar uma equipe em Quem cuida de cada área, use a ficha do projeto.',
        youWillSee: 'Concluir fecha o tutorial. Repetir esta parte começa de novo.',
        requires: { projects: true },
        labels: ['Quem cuida de cada área'],
      },
    ],
  },
  {
    id: 'agenda', version: 1, title: 'Agenda', minutes: 3,
    summary: 'Escolher o período e o contexto, achar um compromisso no mês e baixar o recorte.',
    steps: [
      {
        id: 'abrir', title: 'A Agenda',
        speech: 'A Agenda reúne reservas, atividades e movimentações dos projetos, conforme o seu acesso, sempre no horário de Brasília. Buscar no período acha pelo título, projeto ou local.',
        speechMobile: 'A Agenda reúne reservas, atividades e movimentações, conforme o seu acesso, no horário de Brasília. Buscar no período acha um compromisso.',
        youWillSee: 'O quadro Agenda integrada destacado.',
        target: '[data-tutorial="agenda-inicio"]', module: 'calendar', openLabel: 'Ir para Agenda', requires: { calendar: true },
        beforeOpen: 'Clique em Ir para Agenda: o módulo abre no mês atual.', beforeOpenMobile: 'Toque em Ir para Agenda: o módulo abre no mês atual.',
        labels: ['Agenda integrada', 'Buscar no período'],
      },
      {
        id: 'filtros', title: 'Período e contexto',
        speech: 'Filtrar período e contexto abre Categoria, Unidade responsável, Projeto e as datas. Atualizar consulta refaz a busca com o que você escolheu.',
        speechMobile: 'Filtrar período e contexto abre Categoria, Unidade responsável, Projeto e as datas. Atualizar consulta refaz a busca.',
        youWillSee: 'O Filtrar período e contexto destacado.',
        target: '[data-tutorial="agenda-filtros"]', module: 'calendar', openLabel: 'Ir para Agenda', requires: { calendar: true },
        labels: ['Filtrar período e contexto', 'Categoria', 'Unidade responsável', 'Atualizar consulta'],
      },
      {
        id: 'mes', title: 'O mês',
        speech: 'Cada dia mostra os primeiros compromissos, com a cor da categoria; +N indica que há mais. As setas trocam de mês. Clique num dia para ver os compromissos dele.',
        speechMobile: 'O número em cada dia diz quantos registros ele tem. As setas trocam de mês. Toque num dia, como hoje, destacado.',
        youWillSee: 'O calendário do mês destacado.', youWillSeeMobile: 'O dia de hoje destacado no calendário.',
        missingMobile: 'Volte ao mês atual com as setas, ou toque num dia que tenha número.',
        target: '[data-tutorial="agenda-mes"]', targetMobile: '[data-tutorial="agenda-hoje"]', module: 'calendar', openLabel: 'Ir para Agenda', requires: { calendar: true },
        labels: [],
      },
      {
        id: 'dia', title: 'Os compromissos',
        speech: 'Ao escolher um dia, a lista vira Compromissos de… com os registros dele. Categoria dos compromissos filtra a lista, e Ver todo o período tira a seleção do dia e volta ao período escolhido.',
        speechMobile: 'Ver … compromissos do dia, abaixo do mês, traz você até aqui. Ver todo o período tira a seleção do dia.',
        youWillSee: 'A lista de compromissos destacada.',
        target: '#calendar-day-entries', module: 'calendar', openLabel: 'Ir para Agenda', requires: { calendar: true },
        labels: ['Compromissos de', 'Categoria dos compromissos', 'Ver todo o período'],
      },
      {
        id: 'baixar', title: 'Baixar o recorte',
        speech: 'Baixar compromissos da agenda gera um arquivo com a lista que está na tela. Para levar a outro calendário, use o arquivo .ics, dentro de Filtrar período e contexto: ele inclui cancelamentos.',
        speechMobile: 'Baixar compromissos da agenda gera um arquivo com a lista da tela. O .ics fica em Filtrar período e contexto.',
        youWillSee: 'A Categoria dos compromissos e as opções de download destacadas.',
        target: '[data-tutorial="agenda-baixar"]', module: 'calendar', openLabel: 'Ir para Agenda', requires: { calendar: true },
        labels: ['Baixar compromissos da agenda'],
      },
      {
        id: 'fim', title: 'Tudo certo',
        speech: 'Você já sabe achar um compromisso e voltar ao período. Quando o compromisso tiver link, ele abre a área de origem, se o seu acesso permitir.',
        youWillSee: 'Concluir fecha o tutorial. Repetir esta parte começa de novo.',
        requires: { calendar: true },
        labels: [],
      },
    ],
  },
  {
    id: 'materiais', version: 1, title: 'Materiais', minutes: 3,
    summary: 'Achar um material, entender físico, reservado e disponível e abrir a ficha.',
    steps: [
      {
        id: 'abrir', title: 'O catálogo',
        speech: 'Materiais mostra o catálogo de cada projeto: escolha o projeto no alto ou deixe Todos os projetos. Buscar no catálogo acha pelo nome, patrimônio ou destino; Filtros separa por dono, tipo, categoria e situação. Seguir este tutorial não mexe no estoque.',
        speechMobile: 'Buscar no catálogo acha um material pelo nome, patrimônio ou destino. Filtros separa por dono, tipo, categoria e situação.',
        youWillSee: 'A busca do catálogo destacada.',
        target: '[data-tutorial="materiais-busca"]', module: 'materials', openLabel: 'Ir para Materiais', requires: { anyOf: ['inventory.read', 'inventory.manage', 'inventory.deliver'] },
        beforeOpen: 'Clique em Ir para Materiais: o módulo abre com o catálogo.', beforeOpenMobile: 'Toque em Ir para Materiais: o módulo abre com o catálogo.',
        labels: ['Buscar no catálogo', 'Filtros'],
      },
      {
        id: 'saldo', title: 'Físico, reservado e disponível',
        speech: 'Físico é quanto existe. Reservado já está separado para alguém. Disponível é o que pode ser usado agora, na mesma unidade. Num equipamento emprestado, o físico não muda, mas o disponível cai para 0.',
        speechMobile: 'Físico é quanto existe. Reservado já está separado. Disponível é o que pode ser usado agora.',
        youWillSee: 'A tabela de saldo destacada.', youWillSeeMobile: 'Os cartões dos materiais destacados, com Físico, Reservado e Disponível.',
        target: '[data-tutorial="materiais-saldo"]', module: 'materials', openLabel: 'Ir para Materiais', requires: { anyOf: ['inventory.read', 'inventory.manage', 'inventory.deliver'] },
        missing: 'Nenhum material neste recorte. Troque o projeto ou limpe a busca e os filtros.',
        labels: ['Físico', 'Reservado', 'Disponível'],
      },
      {
        id: 'ficha', title: 'A ficha do material',
        speech: 'Detalhes abre a ficha do material. Na aba Movimentações, o link Histórico mostra tudo em Registros. Feche a ficha para seguir. Quem só consulta o saldo vê Somente consulta de saldo.',
        speechMobile: 'A seta abre a ficha; em Movimentações fica o Histórico. Feche a ficha para seguir. Quem só consulta vê Somente consulta de saldo.',
        youWillSee: 'O botão Detalhes do primeiro material destacado.', youWillSeeMobile: 'A seta do primeiro material destacada.',
        target: '[data-tutorial="materiais-detalhes"]', module: 'materials', openLabel: 'Ir para Materiais', requires: { anyOf: ['inventory.read', 'inventory.manage', 'inventory.deliver'] },
        missing: 'Se a lista estiver vazia, troque o projeto ou limpe a busca. Se aparecer Somente consulta de saldo, o seu acesso mostra só o saldo; a ficha abre para quem consulta materiais no projeto.',
        labels: ['Detalhes', 'Movimentações', 'Somente consulta de saldo'],
      },
      {
        id: 'registrar', title: 'Registrar movimento',
        speech: 'Registrar movimento lança entradas, saídas e ajustes, para um material ou vários de uma vez. Informe quantidade, motivo e, quando o formulário pedir, origem ou referência. Não registre estoque real só para testar.',
        speechMobile: 'Registrar movimento lança entradas, saídas e ajustes. Informe quantidade e motivo. Não registre estoque real só para testar.',
        youWillSee: 'O botão Registrar movimento destacado.',
        target: '[data-tutorial="materiais-registrar"]', module: 'materials', openLabel: 'Ir para Materiais', requires: { capability: 'inventory.manage' },
        missing: 'Registrar movimento aparece para quem gerencia materiais em algum projeto.',
        labels: ['Registrar movimento'],
      },
      {
        id: 'fim', title: 'Tudo certo',
        speech: 'Você já sabe ler o saldo e abrir a ficha. Brindes e kits ficam com quem gerencia as dinâmicas do projeto.',
        youWillSee: 'Concluir fecha o tutorial. Repetir esta parte começa de novo.',
        requires: { anyOf: ['inventory.read', 'inventory.manage', 'inventory.deliver'] },
        labels: [],
      },
    ],
  },
  {
    id: 'dinamicas', version: 1, title: 'Dinâmicas', minutes: 3,
    summary: 'Começar pela ação certa, atender na roleta ou no dado e conferir a retirada de brinde.',
    steps: [
      {
        id: 'atendimento', title: 'Atendimento presencial',
        speech: 'Comece pela ação certa: em Operação presencial, escolha o Evento ativo e abra um atendimento para cada pessoa. Registre o que saiu no dado ou na roleta. Não abra outro para a mesma pessoa. Seguir este tutorial não registra nada.',
        speechMobile: 'Em Operação presencial, escolha o Evento ativo e abra um atendimento por pessoa. Registre o que saiu no dado ou na roleta. O tutorial não registra nada.',
        youWillSee: 'O quadro Atendimento presencial destacado.',
        beforeOpen: 'Clique em Ir para Dinâmicas: o módulo abre com o atendimento e as ações.', beforeOpenMobile: 'Toque em Ir para Dinâmicas: o módulo abre com o atendimento e as ações.',
        target: '[data-tutorial="dinamicas-atendimento"]', module: 'events', openLabel: 'Ir para Dinâmicas', requires: { capability: 'participation.operate' },
        missing: 'Atendimento presencial aparece quando há uma ação ativa no seu acesso.',
        labels: ['Operação presencial', 'Evento ativo', 'Atendimento presencial'],
      },
      {
        id: 'acoes', title: 'As ações',
        speech: 'Em Roleta e dado, cada cartão mostra o projeto, a situação, o local e o horário da ação. Página do evento abre a página pública. Se aparecer Nenhuma dinâmica cadastrada, troque o projeto no alto.',
        speechMobile: 'Cada cartão mostra o projeto, a situação, o local e o horário. Página do evento abre a página pública. Sem dinâmica? Troque o projeto no alto.',
        youWillSee: 'As ações de Roleta e dado destacadas.',
        target: '[data-tutorial="dinamicas-acoes"]', module: 'events', openLabel: 'Ir para Dinâmicas', requires: { anyOf: ['campaigns.manage', 'participation.operate', 'inventory.deliver'] },
        beforeOpen: 'Clique em Ir para Dinâmicas: o módulo abre com as ações.', beforeOpenMobile: 'Toque em Ir para Dinâmicas: o módulo abre com as ações.',
        labels: ['Roleta e dado', 'Página do evento'],
      },
      {
        id: 'situacao', title: 'A situação da ação',
        speech: 'Quem gerencia a ação muda a situação no próprio cartão: Ativo, Pausado ou Encerrado. Encerrar pede confirmação, interrompe novas participações e guarda o histórico; para uma nova ação, crie outro evento.',
        speechMobile: 'No cartão da ação, a situação muda entre Ativo, Pausado e Encerrado. Encerrar pede confirmação.',
        youWillSee: 'A situação da primeira ação destacada.',
        target: '[data-tutorial="dinamicas-situacao"]', module: 'events', openLabel: 'Ir para Dinâmicas', requires: { capability: 'campaigns.manage' },
        missing: 'A situação aparece no cartão das ações que você gerencia.',
        labels: ['Ativo', 'Pausado', 'Encerrado'],
      },
      {
        id: 'retirada', title: 'Retirada de brinde',
        speech: 'Em Retirada de brinde, digite o Código de retirada do Comprovante de brinde que a pessoa mostrar e use Confirmar entrega antes de entregar o material. Um código já entregue é sinalizado.',
        speechMobile: 'Digite o Código de retirada e use Confirmar entrega antes de entregar. Código já entregue é sinalizado.',
        youWillSee: 'O quadro Retirada de brinde destacado.',
        target: '[data-tutorial="dinamicas-retirada"]', module: 'events', openLabel: 'Ir para Dinâmicas', requires: { anyOf: ['participation.operate', 'inventory.deliver'] },
        labels: ['Retirada de brinde', 'Código de retirada', 'Confirmar entrega'],
      },
      {
        id: 'preparar', title: 'Preparar uma dinâmica',
        speech: 'Em Preparar dinâmica, Nova dinâmica cria a ação como rascunho, com projeto, horário e local. Confira as regras e os brindes antes de ativar.',
        speechMobile: 'Nova dinâmica cria a ação como rascunho. Confira as regras e os brindes antes de ativar.',
        youWillSee: 'O quadro Preparar dinâmica destacado.',
        target: '[data-tutorial="dinamicas-preparar"]', module: 'events', openLabel: 'Ir para Dinâmicas', requires: { capability: 'campaigns.manage' },
        missing: 'Preparar dinâmica aparece nos projetos com dinâmicas e brindes ativados.',
        labels: ['Preparar dinâmica', 'Nova dinâmica'],
      },
      {
        id: 'fim', title: 'Tudo certo',
        speech: 'Você já sabe começar pela ação certa. Se a ação não estiver ativa ou fora do horário e o atendimento for recusado, procure a coordenação dela.',
        youWillSee: 'Concluir fecha o tutorial. Repetir esta parte começa de novo.',
        requires: { anyOf: ['campaigns.manage', 'participation.operate', 'inventory.deliver'] },
        labels: [],
      },
    ],
  },
  {
    id: 'emprestimos', version: 1, title: 'Empréstimos', minutes: 4,
    summary: 'Achar um empréstimo, reconhecer a situação, a próxima ação e o histórico.',
    steps: [
      {
        id: 'abrir', title: 'Agenda de empréstimos',
        speech: 'A Agenda de empréstimos mostra as reservas por intervalo. Use Buscar empréstimos, Situação e as datas De e Até para chegar ao cartão, no horário de Brasília. Seguir este tutorial não altera nenhum empréstimo.',
        speechMobile: 'Use Buscar empréstimos, Situação e as datas De e Até para chegar ao cartão. O tutorial não altera nenhum empréstimo.',
        youWillSee: 'A busca e os filtros dos empréstimos destacados.',
        target: '[data-tutorial="emprestimos-filtros"]', module: 'loans', openLabel: 'Ir para Empréstimos', requires: { anyOf: ['loans.read', 'loans.manage', 'loans.checkout'] },
        beforeOpen: 'Clique em Ir para Empréstimos: o módulo abre na Agenda de empréstimos.', beforeOpenMobile: 'Toque em Ir para Empréstimos: o módulo abre na Agenda de empréstimos.',
        labels: ['Agenda de empréstimos', 'Buscar empréstimos', 'Situação'],
      },
      {
        id: 'nova', title: 'Nova reserva',
        speech: 'Nova reserva separa um equipamento por um intervalo, com retirada e devolução previstas. Se aparecer conflito, escolha outro intervalo ou outro equipamento.',
        youWillSee: 'O botão Nova reserva destacado.',
        target: '[data-tutorial="emprestimos-nova"]', module: 'loans', openLabel: 'Ir para Empréstimos', requires: { capability: 'loans.manage' },
        missing: 'Nova reserva aparece nos projetos em que você gerencia empréstimos.',
        labels: ['Nova reserva'],
      },
      {
        id: 'situacoes', title: 'A situação de cada empréstimo',
        speech: 'Cada cartão mostra a situação: Reservado separa o equipamento; Retirado indica que ele saiu; Em atraso pede a devolução; Devolvido encerra a saída; Não retirado e Cancelado encerram antes da saída.',
        speechMobile: 'Reservado separa o equipamento; Retirado indica que saiu; Em atraso pede a devolução; Devolvido encerra. Não retirado e Cancelado encerram antes da saída.',
        youWillSee: 'Os cartões dos empréstimos destacados.',
        target: '[data-tutorial="emprestimos-lista"]', reveal: 'below', module: 'loans', openLabel: 'Ir para Empréstimos', requires: { anyOf: ['loans.read', 'loans.manage', 'loans.checkout'] },
        missing: 'Nenhum empréstimo neste recorte. Troque a Situação ou as datas.',
        labels: ['Reservado', 'Retirado', 'Em atraso', 'Devolvido', 'Não retirado', 'Cancelado'],
      },
      {
        id: 'acao', title: 'A próxima ação',
        speech: 'A próxima ação aparece no cartão: Registrar retirada quando o equipamento sai e Registrar devolução quando ele volta. Para uma reserva que não vai acontecer, use Cancelar reserva. Não altere um empréstimo real só para testar.',
        speechMobile: 'No cartão, Registrar retirada quando o equipamento sai e Registrar devolução quando volta. Não altere um empréstimo real só para testar.',
        youWillSee: 'A próxima ação do primeiro cartão destacada.',
        target: '[data-tutorial="emprestimos-acao"]', module: 'loans', openLabel: 'Ir para Empréstimos', requires: { anyOf: ['loans.manage', 'loans.checkout'] },
        missing: 'A próxima ação aparece nos cartões Reservado ou Retirado.',
        labels: ['Registrar retirada', 'Registrar devolução', 'Cancelar reserva'],
      },
      {
        id: 'historico', title: 'O histórico',
        speech: 'Ver histórico abre o empréstimo em Registros, com reserva, retirada, devolução e ocorrências. Em Detalhes, termos e ocorrências fica o termo, conforme o seu acesso.',
        speechMobile: 'Ver histórico abre o empréstimo em Registros. Em Detalhes, termos e ocorrências fica o termo, conforme o acesso.',
        youWillSee: 'O link Ver histórico do primeiro cartão destacado.',
        target: '[data-tutorial="emprestimos-historico"]', module: 'loans', openLabel: 'Ir para Empréstimos', requires: { anyOf: ['loans.read', 'loans.manage', 'loans.checkout'] },
        missing: 'Nenhum empréstimo neste recorte. Troque a Situação ou as datas.',
        labels: ['Ver histórico', 'Detalhes, termos e ocorrências'],
      },
      {
        id: 'fim', title: 'Tudo certo',
        speech: 'Você já sabe reconhecer a situação, a próxima ação e o histórico de um empréstimo. Quem só consulta encontra os empréstimos em Relatórios, conforme o acesso.',
        youWillSee: 'Concluir fecha o tutorial. Repetir esta parte começa de novo.',
        requires: { anyOf: ['loans.read', 'loans.manage', 'loans.checkout'] },
        labels: ['Relatórios'],
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
  calendar?: boolean;
};
export type ResolvedStep = { id: string; available: boolean; reason?: string };

const inScope = (scope: string[] | null, project: string | null) => scope === null || (project ? scope.includes(project) : scope.length > 0);

/** Quais passos o acesso atual permite. O texto do motivo nunca cita projeto, pessoa ou outra organização. */
export function resolveSteps(chapter: TutorialChapter, access: TutorialAccess): ResolvedStep[] {
  return chapter.steps.map(step => {
    const need = step.requires;
    if (!need) return { id: step.id, available: true };
    if (need.projects && !inScope(access.projectScope, null)) return { id: step.id, available: false, reason: 'Este passo aparece quando sua conta tiver um projeto.' };
    if (need.anyOf && !need.anyOf.some(capability => inScope(access.capabilityScope(capability), null))) return { id: step.id, available: false, reason: 'Seu acesso atual não inclui esta parte.' };
    if (need.calendar && !access.calendar) return { id: step.id, available: false, reason: 'A Agenda não faz parte do seu acesso atual.' };
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
