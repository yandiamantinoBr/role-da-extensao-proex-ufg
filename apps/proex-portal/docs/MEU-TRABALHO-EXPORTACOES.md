# Exportações de Meu trabalho

Brief de 05/11/2026: levar o resumo autorizado das páginas atuais em PDF, XLSX ou DOCX, com identidade institucional e escopo verificável. PDF, XLSX e DOCX são os formatos principais. A cópia pessoal em Markdown fica em uma opção secundária; seu helper anterior foi substituído pela mesma projeção reduzida dos demais formatos. Nenhuma migração, alteração do Google ou dado de produção faz parte desta entrega.

## Uso e conteúdo

Abra [Meu trabalho](https://proex-gestao.vercel.app/?module=my-work), escolha contexto, origem, estado e as páginas desejadas. **Resumo destas páginas** oferece PDF, XLSX e DOCX. Cada arquivo contém até seis demandas e seis designações, conforme as duas páginas atuais. Ele não representa todas as atribuições. O XLSX é um arquivo de resumo; não é a planilha sincronizada do projeto. Em **Outras opções → Para a sua Vault (.md)** há uma cópia pessoal adicional, com texto literal escapado para Markdown/Obsidian e sem HTML, embeds ou links inseridos pelo Portal. A preferência pelos três formatos principais não retira essa integração pessoal. Não há botão CSV.

Todas as saídas compartilham seis campos: tipo, registro, contexto, estado, prioridade e prazo. “Designação” identifica uma responsabilidade contínua. Os metadados preservam contexto dos filtros, origem, estado das demandas, intervalos, deslocamento de cada lista, limite de seis, totais de todas as páginas antes do filtro de estado e horários da consulta/geração em Brasília. Demandas e designações permanecem unidades separadas.

O PDF usa as marcas PROEX/UFG, a paleta institucional, métricas das páginas atuais, título, cabeçalhos e numeração. DOCX e XLSX usam os geradores existentes, com identificação institucional, metadados e campos estruturados. O Word é editável; o Excel tem cabeçalho fixo, filtro e aba sobre o recorte.

## Permissões e consistência

O clique faz uma consulta nova à mesma URL e aos mesmos filtros/deslocamentos da tela, com sessão e sem cache. A resposta precisa confirmar usuário, contexto e escopo de cada linha. Somente uma projeção nova com os seis campos permitidos chega ao gerador: nenhum ID, URL, nota, corpo, contato ou nome de responsável é exportado. Quando `target.canOpen` é falso, a linha inteira vira **Registro de acesso restrito**, sem nome, contexto ou demais detalhes.

Markdown passa pelas mesmas duas leituras e guardas dos três formatos principais; todos os botões compartilham a admissão de um único pedido por vez. Uma finalização tardia não pode liberar os botões de outro pedido. A preparação de PDF pode aguardar recursos locais. Após gerar o artefato, outra consulta à mesma URL confirma novamente autorização e conteúdo. O resumo, totais, privacidade, filtros ou paginação alterados impedem o download e atualizam a lista. O horário da consulta não participa da comparação de conteúdo. A guarda imediatamente anterior ao download confere componente montado, contexto ativo da tela, época e cancelamento. Trocar conta, filtro ou contexto, atualizar, receber mudança de demanda ou desmontar o componente invalida o pedido anterior. Nenhum resultado tardio pode baixar a lista antiga.

As duas leituras validam acesso nos respectivos instantes; não prometem impedir uma revogação externa posterior ao download. Os arquivos já baixados ficam sob o controle de quem os recebeu.

## Qualidade do PDF e aprendizado reutilizável

A primeira amostra de 12 registros ocupava três páginas, quebrava “Acompanhamento” no meio da palavra e reservava a primeira página para metadados. A revisão pediu mais espaço para Registro/Contexto sem diminuir fonte. O resumo passou a usar “Designação”, cinco linhas de metadados com os mesmos dados e pesos explícitos de coluna. A amostra final ocupa duas páginas A4, com três registros na primeira e nove na continuação.

`ReportPdfPresentation.columnWeights` é opcional e não altera os pesos anteriores dos demais relatórios. O gerador rejeita tamanho incorreto, NaN, valores negativos/fora da faixa e proporções desequilibradas. O cálculo de paginação agora reserva o cabeçalho e a primeira linha juntos; células maiores que a página continuam em blocos, sem laço infinito. Há regressão de linha mais alta que a área útil, preservação de ambos os extremos e limites de páginas.

Na tela móvel, os números de um intervalo usam espaços indivisíveis para não deixar o total sozinho na linha seguinte. As capturas seguem viewport normal e espera das transições, distinguindo cabeçalho fixo e avisos temporários de problemas de composição.

Na cópia Markdown, o escape inclui `&`: sem isso, uma entidade digitada como texto pode ser apresentada com outro conteúdo. Os testes comparam as seis células com os demais formatos e conferem HTML, links, embeds Obsidian, fences, tabelas, controles bidi e entidades literais, sem decodificação recursiva.

## Evidências e limites

- Revisão independente de fontes: nenhum P1/P2 encontrado no recorte das exportações. Os testes executam o componente real para revogação nas duas leituras, troca de conta/filtro durante a consulta ou geração, desmontagem, usuário incorreto e mudança de privacidade. Projeção/serialização usam testes próprios de pacotes DOCX/XLSX e PDF real com marcas e texto Unicode. A cópia da Vault também é testada com sintaxe hostil de Markdown/Obsidian e respostas tardias.
- O lote final aprovou **59/59 testes focais**: estado do painel e gerenciador, serviço de Meu trabalho, projeção, formatos reais, paginação PDF e Markdown. Tipos, lint e build Node foram aprovados. A revisão de Markdown encerrou a falha intermediária de fidelidade das entidades antes deste lote final.
- A bancada autenticada descartável em `127.0.0.1:5186` usa oito demandas e sete designações sintéticas. Os quatro downloads reais (três principais e Vault) contêm seis e seis; cada clique foi observado fazendo exatamente duas consultas novas. O PDF baixado confirmou duas páginas; os pacotes não continham nome de responsável, nota interna ou ID do projeto. Doze capturas cobrem visão geral, exportações e Vault em 390/1366 px, claro/escuro. Não houve transbordamento horizontal, botão visível do painel menor que 44 px, erro JavaScript ou requisição externa do navegador.
- A crítica independente marcou **9,0/10 para o recorte da interface observado** e **9,2/10 para as duas páginas do PDF sintético final**. A recaptura com a opção Vault manteve a nota da interface. Não são notas do portal inteiro nem de todos os possíveis textos. O P3 residual é manter a faixa inteira indivisível: o total deixou de ficar sozinho, mas o navegador ainda pode quebrar depois do traço em “1–6”. Um `span` com `white-space:nowrap` é uma melhoria futura de apresentação; não afeta o escopo ou o download.
- DOCX e XLSX tiveram integridade/conteúdo dos pacotes e XML conferidos. O renderer nativo Word está indisponível; não há certificação visual de Word/Excel nesta entrega. As verificações finais de publicação e registro na Vault ficam com o coordenador.
- A QA revelou botões pequenos de fechar avisos do Sonner. O coordenador tratou o componente global separadamente em `b1c158f`; ele não faz parte da nota ou das fontes deste recorte.

As capturas, downloads sintéticos, renderizações e resultados locais ficam em `.sites-runtime/qa-my-work/`, excluídos do Git. Os testes reproduzíveis estão em `tests/my-work-panel-state.test.mjs`, `tests/my-work-export.test.mjs`, `tests/my-work-markdown.test.mjs`, `tests/my-work.test.mjs` e `tests/report-documents.test.mjs`.
