// Conteúdo inicial do Guia da PROEX. Só informação institucional e pública, com fontes e datas.
// Blocos vivos ({{estrutura}}, {{programas}}, {{calendario}}, {{equipe-oficial}}) são preenchidos
// na hora com os dados do portal que a pessoa pode ver. Onde há dúvida: "_a confirmar_".

export type GuideSection = 'organizacao' | 'processos' | 'referencias';
export type StarterPage = { slug: string; title: string; section: GuideSection; position: number; body: string };
export const GUIDE_SECTION_LABEL: Record<GuideSection, string> = { organizacao: 'Como a PROEX se organiza', processos: 'Processos recorrentes', referencias: 'Referências' };
export const LIVE_BLOCKS = ['estrutura', 'programas', 'calendario', 'equipe-oficial'] as const;
export type LiveBlock = typeof LIVE_BLOCKS[number];

const CATALOG = 'catálogo institucional do portal, verificado em 23/10/2026';

export const GUIDE_STARTER: readonly StarterPage[] = [
  { slug: 'estrutura', title: 'Estrutura organizacional', section: 'organizacao', position: 1, body: `# Estrutura organizacional

A Pró-Reitoria de Extensão (PROEX) é o órgão da UFG que coordena as ações de extensão. Em 2026 a antiga PROEC passou a se chamar PROEX, e a cultura foi para a Secretaria de Artes e Cultura (SEACULT) (CONSUNI 355/2026).

## Organograma no portal

{{estrutura}}

## Setores públicos da PROEX

Segundo a página oficial "Equipe PROEX", a pró-reitoria se organiza em: Pró-Reitoria de Extensão; Pró-Reitoria Adjunta e Diretoria de Extensão; Diretoria de Articulação e Logística; Coordenações (Administrativa, Eventos Institucionais, Ações de Extensão e Acompanhamento de Editais); Gabinete; Revista UFG; e a Equipe Executiva da Cultura (ExeCult). _A divisão de atribuições entre coordenações está a confirmar._

Fontes: [Equipe PROEX](https://proex.ufg.br/p/equipe-proex) (atualizada em 05/10/2026, verificada em 31/10/2026); estrutura da UFG na Portaria SIG nº 3115/2026 (${CATALOG}).
` },
  { slug: 'programas-e-projetos', title: 'Programas e projetos', section: 'organizacao', position: 2, body: `# Programas e projetos

Na UFG, a extensão se organiza em modalidades (CONSUNI 39/2020): **programa** (ao menos 3 projetos, de 3 a 10 anos), **projeto** (de 1 a 5 anos), **curso** (no mínimo 8 horas), **evento** e **prestação de serviço**. Cada ação tem uma área temática (FORPROEX).

## Programas da gestão 2026–2029

- UFG nos Parques
- UFG em Todo Lugar
- UFG com a Escola

## Projetos conduzidos pela PROEX

- Rolê da Extensão: mediação itinerante entre a UFG e a sociedade, com brindes, folders e dinâmicas (roleta e dado).
- Curta o Câmpus.

## Cadastrados no portal

{{programas}}

Fontes: [Programas de Extensão 2026–2029](https://proex.ufg.br/p/62169-programas-de-extensao-2026-2029), [Programas 2022–2025](https://proex.ufg.br/p/60604-programas-de-extensao-2022-2025), [Rolê da Extensão](https://proex.ufg.br/p/60194-role-da-extensao) (${CATALOG}).
` },
  { slug: 'processos-conpeex', title: 'CONPEEX', section: 'processos', position: 10, body: `# CONPEEX

O Congresso de Pesquisa, Ensino e Extensão (CONPEEX) é o evento anual da UFG que reúne as três áreas. A PROEX organiza o espaço da extensão e leva ações como o Rolê da Extensão. O 23º CONPEEX acontece de 9 a 13 de novembro de 2026.

## Passo a passo no portal

1. Criar ou abrir o projeto do evento e a dinâmica (em rascunho).
2. Registrar as entradas reais de brindes e montar os lotes por período (demandas "Preparar lote").
3. Definir os níveis de brinde e conferir a cobertura de estoque antes de ativar.
4. Durante o evento: operar a dinâmica e registrar entregas e ocorrências.
5. Depois: conferência de estoque (checklist), registro das sobras e relatório do projeto (modelo "Relatório do CONPEEX").

## A confirmar

- Responsável pela programação do Espaço Extensão em cada edição: _a confirmar_.
- Prazo para inscrição de ações no espaço: _a confirmar_.

Fontes: [23º CONPEEX](https://23conpeex.plateia.ufg.br/) (${CATALOG}).
` },
  { slug: 'processos-ufg-nos-parques', title: 'UFG nos Parques', section: 'processos', position: 11, body: `# UFG nos Parques

Programa de extensão da gestão 2026–2029 que leva ações da UFG a parques e espaços públicos, inclusive no interior (ex.: Mossâmedes, setembro de 2026).

## Passo a passo no portal

1. Cadastrar a ação na Agenda do projeto, com local e data.
2. Criar as demandas de preparação (transporte, materiais, equipe) e atribuir às equipes.
3. Separar materiais e equipamentos (empréstimo, quando retornável).
4. Registrar a ação realizada com fotos e a contagem de público, se houver.

## A confirmar

- Calendário das próximas edições e cidades: _a confirmar_.
- Quem aprova a participação de cada unidade: _a confirmar_.

Fontes: [Programa UFG nos Parques 2026–2029](https://proex.ufg.br/p/62476-programa-ufg-nos-parques-gestao-2026-2029) (${CATALOG}).
` },
  { slug: 'processos-editais', title: 'Editais e bolsas', section: 'processos', position: 12, body: `# Editais e bolsas

A PROEX publica editais de fomento e bolsas, como o PROBEC (Programa de Bolsas de Extensão e Cultura). As ações de extensão são registradas no SIGAA.

## Fluxo de uma ação no SIGAA

1. Cadastro em andamento.
2. Submetido (análise da CAEX da unidade).
3. Aguardando aprovação do diretor.
4. Aguardando avaliação da PROEX.
5. Em execução.

Relatório parcial anual e relatório final. Quem atrasa o relatório mais de 60 dias fica impedido de cadastrar novas ações.

## No portal

Editais ficam em "Editais e chamadas" de cada projeto, com referência, situação e prazos. A equipe de bolsistas pode usar o modelo de equipe "Bolsistas de projeto".

Fontes: [Editais PROEX](https://proex.ufg.br/p/editais-proex), [Edital PROBEC 2026–2027](https://proex.ufg.br/p/59892-edital-proec-n-05-2026-programa-de-bolsas-de-extensao-e-cultura-probec-2026-2027), [Manual da Extensão](https://proex.ufg.br/p/40155-manual-da-extensao) (${CATALOG}).
` },
  { slug: 'processos-emprestimos', title: 'Empréstimos de equipamentos', section: 'processos', position: 13, body: `# Empréstimos de equipamentos

Equipamentos retornáveis (caixas de som, projetores, tendas) são emprestados para ações de extensão.

## Passo a passo no portal

1. Cada equipamento é cadastrado como um bem individual, no projeto dono.
2. Reserve o período (o portal impede conflito de datas).
3. Na retirada, registre a condição e o termo; na devolução, a condição de retorno.
4. Empréstimos em atraso aparecem em Empréstimos e no painel da gestão.

## A confirmar

- Quem pode autorizar empréstimo para fora da UFG: _a confirmar_.
- Prazo máximo de empréstimo: _a confirmar_.

Fontes: manual de operação do portal (com a equipe de TI).
` },
  { slug: 'processos-brindes', title: 'Brindes e materiais de divulgação', section: 'processos', position: 14, body: `# Brindes e materiais de divulgação

Brindes (bottons, squeezes, canetas, agendas) e folders são distribuídos nas ações, muitas vezes por meio de dinâmicas como a roleta do Rolê.

## Passo a passo no portal

1. Registrar a entrada real no estoque (com a fonte da quantidade).
2. Montar as opções de brinde (Brinde, Super) e os níveis da dinâmica.
3. Toda saída passa por uma movimentação (distribuição, consumo ou ajuste); corrigir nunca apaga o lançamento original.
4. Depois de cada evento, conferir a contagem e registrar avarias.

Fontes: manual de operação e glossário do portal (com a equipe de TI).
` },
  { slug: 'processos-comunicacao', title: 'Comunicação', section: 'processos', position: 15, body: `# Comunicação

A divulgação das ações usa artes no Canva, o site oficial e as redes da PROEX.

## Passo a passo no portal

1. Cadastrar o link da arte (Canva) ou da publicação (site, Instagram) em Links e documentos do projeto, escolhendo o canal.
2. Usar a Agenda como pauta: cada ação com data vira uma demanda de divulgação.
3. Registrar a cobertura (fotos e vídeos) em Registros.

## A confirmar

- Quem aprova peças antes da publicação: _a confirmar_.
- Prazo mínimo de pedido de arte: _a confirmar_.

Fontes: portal (Links e documentos, canais de comunicação).
` },
  { slug: 'calendario', title: 'Calendário institucional', section: 'referencias', position: 20, body: `# Calendário institucional

Próximos marcos e eventos cadastrados nos projetos que você pode ver.

{{calendario}}

O calendário acadêmico oficial da UFG fica no site da universidade: _link a confirmar_.
` },
  { slug: 'contatos', title: 'Contatos', section: 'referencias', position: 21, body: `# Contatos

Equipe publicada pela própria PROEX na página oficial. A lista é uma cópia conferida; em caso de dúvida, vale a página oficial.

{{equipe-oficial}}

Fonte: [Equipe PROEX](https://proex.ufg.br/p/equipe-proex) (atualizada em 05/10/2026, verificada em 31/10/2026).
` },
  { slug: 'glossario', title: 'Glossário', section: 'referencias', position: 22, body: `# Glossário

- **PROEX**: Pró-Reitoria de Extensão da UFG (antiga PROEC).
- **Ação de extensão**: programa, projeto, curso, evento ou prestação de serviço registrado no SIGAA.
- **CAEX**: comissão de extensão da unidade, que analisa as ações antes da PROEX.
- **ACEx**: curricularização da extensão; no mínimo 10% da carga horária do curso.
- **PROBEC**: programa de bolsas de extensão e cultura.
- **CONPEEX**: congresso anual de pesquisa, ensino e extensão da UFG.
- **Projeto (no portal)**: escopo de quase tudo: materiais, demandas, agenda e relatórios.
- **Equipe (no portal)**: grupo de trabalho para dividir demandas; não dá acesso.
- **Demanda**: tarefa com prazo, prioridade e responsáveis.
- **Dinâmica**: ação com o público que distribui brindes (roleta, dado).
- **Movimentação**: entrada ou saída de estoque; corrigir não apaga o original.
- **Risco**: algo que pode dar errado, com probabilidade, impacto, dono e plano de mitigação.

Fontes: guia de extensão e glossário do portal, com a equipe de TI (${CATALOG}).
` },
];

export const starterBySlug = (slug: string) => GUIDE_STARTER.find(page => page.slug === slug);
