// Equipes-modelo da PROEX: papéis, responsabilidades e acessos sugeridos. Dados puros (tela e servidor).
// Aplicar um modelo cria só a equipe, vazia; pessoas e acessos continuam sendo dados à parte.

export type SuggestedAccess = 'owner' | 'manager' | 'operator' | 'inventory' | 'loans' | 'viewer';
export const ACCESS_LABEL: Record<SuggestedAccess, string> = {
  owner: 'Responsável institucional', manager: 'Gestor do projeto', operator: 'Operador de dinâmicas',
  inventory: 'Estoque', loans: 'Empréstimos', viewer: 'Consulta e relatórios',
};
export type TeamTemplate = {
  id: string; name: string; purpose: string;
  roles: { name: string; responsibilities: string[]; access: SuggestedAccess }[];
  routines: string[];
};

export const TEAM_TEMPLATES: readonly TeamTemplate[] = [
  {
    id: 'comunicacao', name: 'Comunicação', purpose: 'Divulgação das ações, artes, site e redes da PROEX.',
    roles: [
      { name: 'Coordenação de comunicação', responsibilities: ['Aprovar peças e textos antes de publicar', 'Manter o calendário editorial alinhado à Agenda'], access: 'manager' },
      { name: 'Design e audiovisual', responsibilities: ['Produzir artes (Canva) e vídeos', 'Registrar o link da arte em Links e documentos do projeto'], access: 'viewer' },
      { name: 'Redes e site', responsibilities: ['Publicar e responder nas redes', 'Atualizar páginas oficiais e notícias'], access: 'viewer' },
    ],
    routines: ['Pauta semanal das ações da Agenda', 'Cobertura de eventos (foto e vídeo)', 'Relatório mensal de publicações'],
  },
  {
    id: 'administrativo', name: 'Administrativo', purpose: 'Rotina do gabinete, processos SEI, compras e patrimônio.',
    roles: [
      { name: 'Coordenação administrativa', responsibilities: ['Acompanhar processos SEI e prazos', 'Autorizar saídas de material e empréstimos'], access: 'manager' },
      { name: 'Apoio administrativo', responsibilities: ['Registrar entradas e saídas de material', 'Conferir termos de empréstimo e devoluções'], access: 'inventory' },
      { name: 'Atendimento', responsibilities: ['Receber pedidos e encaminhar como demanda', 'Atualizar contatos institucionais'], access: 'viewer' },
    ],
    routines: ['Conferência mensal de estoque', 'Revisão dos empréstimos em atraso', 'Arquivo dos documentos do mês'],
  },
  {
    id: 'tecnologia', name: 'Tecnologia/TI', purpose: 'Portal, contas, planilhas e integrações.',
    roles: [
      { name: 'Responsável pelo portal', responsibilities: ['Manter acessos, cópias de segurança e integrações', 'Acompanhar riscos de tecnologia'], access: 'owner' },
      { name: 'Suporte', responsibilities: ['Ajudar a equipe com login e permissões', 'Registrar problemas no retorno à gestão'], access: 'viewer' },
    ],
    routines: ['Conferir a cópia de segurança semanal', 'Revisar quem tem acesso a cada projeto', 'Revisar riscos de tecnologia no mês'],
  },
  {
    id: 'gestao', name: 'Gestão', purpose: 'Planejamento, acompanhamento e decisões da pró-reitoria.',
    roles: [
      { name: 'Direção', responsibilities: ['Definir prioridades e aprovar o plano', 'Acompanhar o painel da gestão'], access: 'owner' },
      { name: 'Coordenações', responsibilities: ['Acompanhar demandas e entregas das equipes', 'Manter riscos e o guia atualizados'], access: 'manager' },
      { name: 'Assessoria', responsibilities: ['Preparar relatórios e prestações de contas', 'Organizar reuniões e registros de decisão'], access: 'viewer' },
    ],
    routines: ['Reunião quinzenal com o painel da gestão', 'Revisão mensal dos riscos', 'Atualização trimestral do guia'],
  },
  {
    id: 'eventos', name: 'Eventos', purpose: 'Planejamento e execução de eventos, estandes e dinâmicas.',
    roles: [
      { name: 'Coordenação do evento', responsibilities: ['Montar cronograma, equipe e lotes de brindes', 'Aprovar a dinâmica antes de ativar'], access: 'manager' },
      { name: 'Equipe de estande', responsibilities: ['Atender o público e operar a dinâmica', 'Registrar entregas e ocorrências'], access: 'operator' },
      { name: 'Logística e materiais', responsibilities: ['Separar lotes e transportar materiais', 'Conferir a contagem depois do evento'], access: 'inventory' },
    ],
    routines: ['Checklist de montagem e desmontagem', 'Conferência pós-evento', 'Relatório do evento (modelo Relatório do CONPEEX)'],
  },
  {
    id: 'bolsistas', name: 'Bolsistas de projeto', purpose: 'Estudantes que executam as ações de um projeto de extensão.',
    roles: [
      { name: 'Orientação do projeto', responsibilities: ['Distribuir demandas e acompanhar prazos', 'Validar relatórios dos bolsistas'], access: 'manager' },
      { name: 'Bolsista', responsibilities: ['Executar as demandas atribuídas', 'Registrar atividades e evidências'], access: 'operator' },
    ],
    routines: ['Plano de atividades no início do edital', 'Registro semanal das atividades', 'Relatório parcial e final'],
  },
];

export const templateById = (id: unknown) => TEAM_TEMPLATES.find(template => template.id === id);
