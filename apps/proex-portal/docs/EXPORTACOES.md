# Exportações: onde ficam (R3)

Em 10/11/2026, Yan aprovou concentrar os dados em tabela em **Relatórios**. O bloco "Indicadores das dinâmicas" sai, porque a central reúne esses números. As exportações de Equipes e Registros continuam nas telas de origem até a central oferecer o mesmo recorte.

**Estado** · PR100 em rascunho. A correção de 14/11 foi preparada no ramo `codex/proex-exportacoes-recorte-14nov`.

## A regra

- Em **Relatórios**, a pessoa escolhe as colunas e baixa as linhas do assunto em Excel, PDF, Word ou JSON.
- **Documento montado** (tem capa, texto ou forma própria) continua na tela onde é montado.
- Relatórios aplica as permissões de cada assunto e projeto.

## O que mudou

| Antes | Agora |
|---|---|
| Relatórios → "Indicadores das dinâmicas" (números, "Resultados por evento", "Resumo diário" com botão de baixar) | Sai. O mesmo conteúdo está nos assuntos **Eventos e dinâmicas** e **Dinâmicas por dia** (novo) |
| Relatórios → "Exportar registros completos" (três cartões: participações, materiais, empréstimos) | Sai. Os assuntos **Eventos e dinâmicas**, **Materiais e estoque**, **Movimentações** e **Empréstimos** cobrem os três |
| Registros → "Central de relatórios" + "Baixar registros" | Os três formatos continuam na tela com a categoria e a busca aplicadas às linhas carregadas |
| Equipes → "Exportar demandas da equipe" | Os três formatos continuam na tela com a equipe, a organização, o projeto e o estado selecionados. Em Relatórios, Demandas ganhou a coluna **Equipes** |

Assunto novo, **Dinâmicas por dia**: uma linha por dinâmica, dia e tipo (roleta, dado ou presencial), com participações, tentativas, prêmios entregues e atendimentos assistidos. Cada contagem usa o dia em que aconteceu, no horário de Brasília.

O que deixou de aparecer e não tem substituto: "Visitas históricas" (a coleta já estava suspensa) e "Novos seguidores no Instagram" (nunca foi medido). "Unidades entregues" segue em **Movimentações** e **Saídas institucionais**.

## Endereço de Relatórios

O Portal aceita endereços com assunto e recorte inicial.

`/?module=reports&project=…&report=<assunto>&recorte=1&from=…&to=…&q=…`

- `report` aceita qualquer assunto da central (`REPORT_DATASET_IDS`); valor desconhecido cai em Projetos.
- `recorte=1`, `from`, `to` e `q` valem só na chegada: a tela aplica e tira do endereço. Sem período no link, vale "todo o período".
- Cada data inválida é ignorada. A busca passa por limpeza dos caracteres de controle e fica limitada a 80 caracteres.

## O que continua na própria tela, e por quê

| Onde | O que baixa | Por que fica |
|---|---|---|
| Projeto → Relatório do projeto | Relatório montado (PDF, Word, planilha) | Documento com seções escolhidas, não um assunto da central |
| Gestão → Guia da organização | Guia em Word e PDF | Documento |
| Dinâmicas → Programação | Programação dos turnos | Documento de operação do evento |
| Equipes → Estrutura institucional | Organograma em documento | Documento |
| Equipes → Demandas da equipe | Demandas autorizadas da equipe no projeto e estado escolhidos | A central ainda precisa aceitar a identidade da equipe e o estado |
| Registros → Documentos | Linhas carregadas que atendem à categoria e à busca da tela | A central ainda precisa combinar os dois filtros com a mesma regra |
| Meu trabalho → Resumo destas páginas | Resumo pessoal | Recorte pessoal, sem assunto equivalente |
| Convocações → Lista de presença | Nomes e respostas dos convidados | Dados pessoais com aviso próprio; não há assunto na central. **Decisão pendente** |
| Configurações → Chaves e modelos → Gastos e uso por pessoa | Gastos de IA | Só administração; fora de Relatórios de propósito. **Decisão pendente** |
| Materiais → Consumo por unidade → Histórico | Operações por unidade de origem ou destino | A central filtra pela unidade do projeto, não pela origem ou destino. Fica para a frente "Registrar movimento" (sessão de materiais) |

## Testes

- `tests/report-links.test.mjs` cobre datas inválidas, leitura do recorte e restauração do assunto.
- Os testes de Equipes e Registros cobrem a filtragem exata, inclusive nomes parecidos e a combinação de categoria e busca.
- `tests/reports.test.mjs`: "Dinâmicas por dia" (dia de Brasília, tipo, escopo e permissão) e nomes das equipes nas demandas.
