# Exportações: onde ficam (R3)

Decisão do Yan em 10/11/2026 ("Sim, seguir todas"), item R3 da revisão geral: **Exportar** fica concentrado em **Relatórios**. Nas outras telas, o botão "Exportar" abre Relatórios já filtrado. O bloco "Indicadores das dinâmicas" sai, porque repete a central.

**Estado:** implementado em ramo (`claude/r3-exportar-em-relatorios`), em PR rascunho. Não entra na `main` antes de 14/11/2026, depois da distribuição do CONPEEX.

## A regra

- **Dado em tabela** (linhas de um assunto: registros, demandas, movimentações, dinâmicas) sai **só por Relatórios**. É lá que a pessoa confere o recorte, escolhe colunas e baixa em Excel, PDF, Word ou JSON.
- **Documento montado** (tem capa, texto ou forma própria) continua na tela onde é montado.
- As permissões não mudam: Relatórios mostra a cada pessoa só os assuntos e projetos que ela já podia ver.

## O que mudou

| Antes | Agora |
|---|---|
| Relatórios → "Indicadores das dinâmicas" (números, "Resultados por evento", "Resumo diário" com botão de baixar) | Sai. O mesmo conteúdo está nos assuntos **Eventos e dinâmicas** e **Dinâmicas por dia** (novo) |
| Relatórios → "Exportar registros completos" (três cartões: participações, materiais, empréstimos) | Sai. Os assuntos **Eventos e dinâmicas**, **Materiais e estoque**, **Movimentações** e **Empréstimos** cobrem os três |
| Registros → "Central de relatórios" + "Baixar registros" | Um botão **Exportar**, que abre Relatórios em **Registros**, com o projeto, o período e a busca da tela |
| Equipes → "Exportar demandas da equipe" | Um botão **Exportar**, que abre Relatórios em **Demandas**, com o nome da equipe na busca. Demandas ganhou a coluna **Equipes** |

Assunto novo, **Dinâmicas por dia**: uma linha por dinâmica, dia e tipo (roleta, dado ou presencial), com participações, tentativas, prêmios entregues e atendimentos assistidos. Cada contagem usa o dia em que aconteceu, no horário de Brasília.

O que deixou de aparecer e não tem substituto: "Visitas históricas" (a coleta já estava suspensa) e "Novos seguidores no Instagram" (nunca foi medido). "Unidades entregues" segue em **Movimentações** e **Saídas institucionais**.

## Como o botão funciona

`components/portal/export-link.tsx` monta o endereço com `reportHref` (`lib/report-links.ts`):

`/?module=reports&project=…&report=<assunto>&recorte=1&from=…&to=…&q=…`

- `report` aceita qualquer assunto da central (`REPORT_DATASET_IDS`); valor desconhecido cai em Projetos.
- `recorte=1`, `from`, `to` e `q` valem só na chegada: a tela aplica e tira do endereço. Sem período no link, vale "todo o período".
- Datas inválidas e texto de busca com mais de 80 caracteres ou caracteres de controle são descartados.
- Quem não tem o assunto em Relatórios continua com o botão antigo da tela (hoje só acontece em Registros, para perfis sem leitura de relatórios, estoque ou empréstimos).

## O que continua na própria tela, e por quê

| Onde | O que baixa | Por que fica |
|---|---|---|
| Projeto → Relatório do projeto | Relatório montado (PDF, Word, planilha) | Documento com seções escolhidas, não um assunto da central |
| Gestão → Guia da organização | Guia em Word e PDF | Documento |
| Dinâmicas → Programação | Programação dos turnos | Documento de operação do evento |
| Equipes → Estrutura institucional | Organograma em documento | Documento |
| Meu trabalho → Resumo destas páginas | Resumo pessoal | Recorte pessoal, sem assunto equivalente |
| Convocações → Lista de presença | Nomes e respostas dos convidados | Dados pessoais com aviso próprio; não há assunto na central. **Decisão pendente** |
| Configurações → Chaves e modelos → Gastos e uso por pessoa | Gastos de IA | Só administração; fora de Relatórios de propósito. **Decisão pendente** |
| Materiais → Consumo por unidade → Histórico | Operações por unidade de origem ou destino | A central filtra pela unidade do projeto, não pela origem ou destino. Fica para a frente "Registrar movimento" (sessão de materiais) |

## Não fazer

- Não criar botão novo de "Baixar" com exportador próprio para dado em tabela: use `ExportLink` e, se faltar o assunto, acrescente-o em `lib/reports.ts` e em `reports-center.tsx`.
- Não remover a rota `/api/export`: ela segue no ar para quem tiver link antigo; só a tela deixou de apontar para ela.

## Testes

- `tests/report-links.test.mjs`: endereço do botão, validação, ida e volta do assunto, e guarda contra a volta dos blocos antigos.
- `tests/reports.test.mjs`: "Dinâmicas por dia" (dia de Brasília, tipo, escopo e permissão) e nomes das equipes nas demandas.
