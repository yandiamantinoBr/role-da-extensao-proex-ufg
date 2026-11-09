# Relatório do projeto (montador)

Pedido do Yan em 09/11/2026: relatório mais extenso, com escolha do que entra, históricos e versões, linha do tempo, observações da equipe e referências no fim (links, planilhas e documentos).

## Onde fica

Projetos → abrir um projeto → seção **Relatório do projeto**, perto do fim da ficha. Aparece para **todas as pessoas que veem o projeto**. Cada seção mostra apenas os dados que a pessoa já pode ver no portal.

## O que dá para escolher

| Seção | O que mostra | Quem vê |
|---|---|---|
| Resumo | Ficha, período, unidade, totais | Quem vê o projeto |
| Equipe | Equipes de trabalho, integrantes, demandas atribuídas | Mesma regra do módulo Equipes |
| Demandas | Totais, gráfico mensal (criadas × concluídas), tabela | Mesma regra de Demandas |
| Materiais e movimentações | Saldo, gráfico mensal, movimentações (inclui "Correção de saldo"); com acesso ao estoque, também correções no cadastro e nomes dos anexos | `inventory.read` ou `reports.read`; correções e anexos só com `inventory.read` |
| Empréstimos | Retiradas, devoluções e atrasos (sem nome ou contato de quem pegou) | `loans.read` ou `reports.read` |
| Agenda | Marcos e atividades do cronograma | Quem vê o projeto |
| Dinâmicas e brindes | Dinâmicas, participações, tentativas, prêmios entregues | `reports.read` ou `campaigns.manage` |
| Linha do tempo | Tudo acima em ordem de data, só com o que a pessoa vê | Combinação das anteriores |
| Históricos e versões do cadastro | Versões do cadastro, links, agenda e editais, com os campos alterados | Quem edita o projeto (igual à ficha) |
| Observações | Texto livre da equipe | Quem vê o projeto |
| Referências | Página oficial, links e documentos, planilha do projeto, planilha mestre (se a pessoa puder abrir), editais e links da agenda | Quem vê o projeto |

Referências ficam **sempre no fim**. As demais seções podem ser reordenadas com as setas.

**Período:** tudo, um mês ou um intervalo. A ficha e o saldo atual dos materiais mostram a posição de hoje; demandas, movimentações, empréstimos, dinâmicas, agenda, registros e versões seguem o período.

**Observações:** o cartão "Observações" recebe o texto geral da equipe; cada seção tem um balão para uma observação própria (até 1.500 caracteres), impressa destacada no fim dela nos quatro formatos.

**Referências:** cada link, planilha ou documento pode ser marcado ou desmarcado; as novas entram marcadas.

**Linha do tempo:** "Marcos" (padrão) mostra agenda, cadastro, empréstimos, registros e dinâmicas, com as demandas resumidas por mês; "Tudo" lista cada demanda (as do mesmo dia viram uma linha). O histórico mostra os campos alterados com nomes de tela e quem salvou ("Por"); os valores antigos não são exibidos.

**Rascunho:** as escolhas ficam no navegador, separadas por pessoa e apagadas ao sair do portal.

**Modelos:** "Completo", "Prestação mensal" e "Relatório do CONPEEX" vêm prontos. Modelos salvos ficam no projeto (tabela `project_report_templates`, migração 0041) e guardam seções, ordem, período, título, observações (gerais e por seção), referências escolhidas e o modo da linha do tempo. Quem vê o projeto pode usar; criar, atualizar ou apagar exige `reports.read` ou edição do projeto. Cada gravação confere a permissão no banco e a versão do modelo; o registro vai para `audit`.

**Cadastrar referências:** quem edita o projeto tem o botão "Cadastrar link, planilha ou documento", que abre o mesmo formulário de "Links e documentos". O tipo (planilha, documento ou link) é deduzido do endereço.

## Arquivos

A prévia, o PDF, o DOCX e o XLSX desenham o **mesmo documento** (`components/portal/project-report/document.ts`): mesmas seções, mesma ordem, mesmas linhas (limite de 400 linhas por tabela e 400 acontecimentos na linha do tempo, com aviso igual nos quatro).

- **PDF:** capa com marcas, sumário com o número da página de cada seção (clicável), cabeçalho e "Página X de Y", gráficos vetoriais, referências com links clicáveis.
- **DOCX:** capa, sumário com links internos, títulos numerados, tabelas com cabeçalho repetido, gráficos nativos do Word, rodapé com "Página X de Y" e referências com hiperlinks.
- **XLSX:** aba "Capa" com sumário clicável, uma aba numerada por seção, gráficos nativos do Excel ligados às células, rodapé de impressão com página, fórmulas neutralizadas.

## Código

- Servidor: `lib/project-report.ts` e `app/api/projects/[id]/report/route.ts` (GET dados + modelos; POST salvar/apagar modelo, mesma origem).
- Catálogo e validação compartilhados: `lib/project-report-config.ts`.
- Tela: `components/portal/project-report/builder.tsx` e `preview.tsx`.
- Arquivos: `components/portal/project-report/pdf.ts` e `ooxml.ts`.
- Testes: `tests/project-report.test.mjs` (permissões por papel, período, modelos, revogação) e `tests/project-report-documents.test.mjs` (ordem, permissões no documento, gráfico, três arquivos). `PROEX_REPORT_OUT=<pasta> node --test tests/project-report-documents.test.mjs` grava os três arquivos sintéticos para abrir.

O componente antigo `ProjectReportExports` (resumo de uma linha) continua em `reports-center.tsx`, sem uso na ficha; pode ser removido numa limpeza.
