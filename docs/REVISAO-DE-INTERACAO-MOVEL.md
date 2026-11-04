# Revisão de interação no Portal PROEX · 2026-11-04

A rodada partiu do relato de que uma página não rolava quando o gesto começava numa célula de **Relatórios → Tabela detalhada**. A [PR #27](https://github.com/yandiamantinoBr/role-da-extensao-proex-ufg/pull/27) corrigiu o caso. O público desta revisão é a equipe que consulta e opera o Portal em tela pequena, com toque ou teclado. Os ensaios de interação usam uma sessão local isolada e dados fictícios.

## Correções e evidências

| Fluxo | Antes | Evidência da correção |
| --- | --- | --- |
| Colunas de relatório e opções de responsáveis | O gesto vertical ficava preso no fim da lista ou quando a lista era curta. O painel de colunas podia exceder a largura a 690 px. | Toque emulado a 390 px, com 3 e 14 opções: ao atingir o limite, a página avançou 175 px. Tab alcançou a última opção. O ensaio de largura em 14 tamanhos entre 620 e 1366 px, com menu aberto e recolhido e quatro arranjos de controles, deixou de encontrar o excesso observado. |
| Consulta de relatório | O projeto novo tinha 30 materiais, mas a tela mostrava zero por herdar a unidade e o destaque do projeto anterior. A página também podia ficar fora do início do resultado. | Teste de troca de recorte: página inicial, filtros locais limpos e 30 de 30 linhas exportadas. A busca digitada e as opções de apresentação permanecem. |
| Período do relatório | Projetos e materiais podiam indicar um intervalo de datas sem aplicá-lo ao cadastro e aos saldos atuais. | A tela e os formatos com metadados agora indicam a posição atual para esses assuntos. Os relatórios históricos continuam exibindo o período aplicado. |
| Menu Mais | Escape mantinha a busca antiga. Mudar de largura podia retirar o foco de um formulário, mesmo com o menu fechado. | Ensaios de Escape, reabertura e passagem do limite de largura: foco retorna ao Mais ao fechar, permanece no campo ao redimensionar com a gaveta fechada e vai ao conteúdo quando a gaveta aberta deixa de caber. |
| Links nos avisos | Ctrl/Cmd + clique podia abrir a demanda na aba atual e alterar o estado de leitura. | Teste de clique com modificador preserva a ação do navegador e o estado da caixa. O clique simples mantém a abertura e a marcação. |

Os ensaios não substituem o teste em aparelho físico e leitor de tela. Nenhum dado real foi alterado durante a validação.

## O que verificar nas próximas mudanças

- **Rolagem:** comece o gesto no conteúdo, incluindo célula, opção ou botão. Teste subir, descer e ir para os lados. Use listas curtas e longas; chegue aos limites de um painel. Uma tabela larga no fluxo da página deve rolar para os lados sem prender o gesto vertical. Janelas modais podem conter a rolagem para preservar o fundo; confirme que o botão de saída permanece alcançável.
- **Foco:** abra, feche por botão e Escape, reabra e redimensione enquanto digita. Um menu fechado não deve mover o cursor; depois de fechar um menu aberto, devolva o foco a um controle visível. Links devem manter os gestos do navegador para abrir em outra aba.
- **Consulta:** troque de projeto e período com um filtro local e outra página da tabela ativos. Confira o primeiro conjunto de resultados, a situação de lista vazia e a correspondência entre a tabela e o arquivo exportado. Explique quando um assunto retrata a posição atual e não tem corte por data.
- **Evidência:** registre dimensão, navegador, gesto, resultado observado e limitações. Um teste em emulação mede o comportamento do navegador; a validação no aparelho físico continua separada. Confira que a revisão aprovada é a que foi publicada.

## Próximo recorte: histórico do navegador

A revisão de código mostrou que a troca de módulos usa `replaceState` e o Portal não escuta `popstate`. Uma correção isolada com `pushState` pode deixar a URL e a tela em desacordo. Tratar em rodada própria: Início → Projetos → Demandas deve permitir Voltar e Avançar por módulo; filtros e seleções não devem empilhar entradas. Testar links diretos, recarga, troca rápida, rascunhos e revogação de acesso antes de publicar.
