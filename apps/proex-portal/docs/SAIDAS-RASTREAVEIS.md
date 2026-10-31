# Saídas rastreáveis — R09

O novo relatório `outflow_details` acrescenta uma linha por distribuição, entrega de prêmio ou retirada de equipamento. O resumo `outflows` mantém sua consulta e seus totais anteriores. Não há migração, escrita em GET ou alteração de saldo neste incremento.

## Fontes verificadas e ausência de dados

| Informação | Fonte efetivamente consultada |
| --- | --- |
| Quantidade distribuída/entregue | Valor absoluto da baixa `stock_movements.delta`, somente `distribute`/`redeem` negativos. Ajustes, consumo, entradas e transferências ficam fora. |
| Ação da distribuição | `activity_groups.title` quando a movimentação tem atividade do mesmo projeto. Sem vínculo: “Não registrada”. |
| Evento do prêmio | Relação interna movimentação → direito → participação → campanha do mesmo projeto. Nenhum direito, tentativa ou identificador de participante é exportado. |
| Retirada/retorno de equipamento | `loans` em `out`/`returned`, material `equipment`. Cada reserva representa um equipamento individual no contrato existente: quantidade 1 na unidade do cadastro, sem converter kits em peças. Reservas e cancelamentos ficam fora. |
| Data efetiva de retirada | `checked_out_at`; na ausência, auditoria válida `loan.status` com estado `out`. A data prevista nunca substitui a data efetiva. Sem ambas as fontes, a data fica ausente. |
| Operador | Autor da movimentação ou auditoria da retirada, associado ao nome atual do perfil quando disponível e autorizado. Não é o beneficiário nem uma atribuição inferida de responsabilidade pela ação. |
| Motivo/observação/condição | Textos dos registros originais, somente com consulta opcional e permissão operacional atual. Não há extração automática de “responsável” a partir do texto. |
| Saldo e unidade | Valores atuais de `items`, explicitamente rotulados como atuais. Não se inventa saldo após a saída nem unidade histórica. Saldos repetidos por registro não são oferecidos como medida de soma nos gráficos. |

Datas e períodos seguem Brasília. Retiradas sem data efetiva aparecem sem filtro de período; um intervalo não as coloca artificialmente no dia da reserva. Nomes/categorias das entidades vinculadas são os cadastrais atuais. A data de retorno registrada é independente da previsão.

## Permissões e textos livres

A leitura de estoque exige `inventory.read` ou `reports.read`; a leitura de empréstimos exige `loans.read` ou `reports.read`, sempre no projeto/organização atual da linha. Cada ramo tem seu próprio guard SQL. Nome do operador e textos livres exigem respectivamente `inventory.read` ou `loans.read` atual. Viewer com apenas `reports.read` não recebe notas nem nomes, mesmo pedindo `includeNotes=1`. Rebaixamento/revogação no await anterior ao SELECT foi testado sem confiar no ator antigo.

Sem `includeNotes`, os campos livres nem entram na projeção. Quando a pessoa operacional opta pela consulta, ainda precisa selecionar as colunas para exportá-las. A interface avisa que observações podem conter dados pessoais; isso não é uma promessa de anonimização por regex. Não são retornados contato/nome de tomador, e-mail/telefone da equipe, CPF, identificadores de conta, chaves de arquivos ou `ref_id` bruto. IDs de movimentação/empréstimo e vínculos de atividade/evento permitem conferir a origem sem revelar códigos de prêmio ou beneficiários.

## Integração, filtros e exportação

Adicionar `outflow_details` a `ReportsCenter.available` quando houver `inventory.read`, `loans.read` ou `reports.read`. `initialDataset` aceita o mesmo ID; não há prop nova. O coordenador mantém a montagem em `portal-client.tsx`.

`GET /api/reports?dataset=outflow_details` reutiliza projeto, organização, unidade organizacional, área e período. Acrescenta `outflowType=all|distribute|redeem|loan`, `returnState=all|not_applicable|out|returned` e `includeNotes=1`. Tipos inválidos, datas inexistentes/invertidas e nomes de dataset de protótipo são rejeitados.

Tela e arquivos usam o mesmo conjunto filtrado, unidade selecionada, colunas e ordenação. Os filtros novos e o opt-in fazem parte da chave da consulta: mudar o recorte desabilita imediatamente a exportação antiga. PDF/DOCX, XLSX, CSV e JSON usam os exportadores existentes; os testes de pacotes, Unicode e seleção continuam passando. Nenhuma coluna livre é padrão, e modelos salvos não reativam a consulta opcional.

A consulta detalhada tem teto de 5.000 linhas e 3 MiB serializados, com margem para o [limite de resposta não transmitida da Vercel](https://vercel.com/docs/functions/limitations). Um recorte que excede o teto retorna `truncated`, aviso visível e “Cobertura: consulta parcial” nos metadados exportados. Refine o recorte; a interface não declara que a parte retornada é o conjunto completo. O resumo anterior mantém seus limites. Paginação completa de grandes históricos continua sendo uma evolução possível.

## Evidência local

654/654 testes completos em Node 24; 34/34 focados de relatórios em Node 26; tipos e lint focados sem erro/aviso. Oito cenários novos SQLite cobrem fontes reais, prêmios sem identidades, retornos, ausência de datas, limites, textos opt-in sob papel atual, A/B, rebaixamento, datas inválidas e GET sem escrita. Dois cenários novos da interface verificam filtros, exportação imediata e seleção deliberada de textos.

Benchmark sintético em memória: 5.106 registros de origem; cinco consultas fizeram cinco leituras SQL e zero gravações. Sem o teto de bytes, 5.000 linhas geraram 5.223.053 bytes. Com o teto, foram retornadas 3.010 linhas / 3.144.827 bytes com marcação de parcial. Uma rodada isolada teve p50 56,38 ms / p95 57,83 ms; concorrência com outras suítes elevou os tempos. Não houve rede nem estimativa de capacidade da Vercel. Builds locais Worker e Node passaram. A montagem no portal e a revisão visual integradas continuam sob coordenação do responsável principal antes da publicação.