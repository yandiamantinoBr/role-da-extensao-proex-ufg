# Crítica independente: programação de dinâmica no evento anfitrião e transferência de demanda

**Nota do escopo visível: 6/10.** **Situação: não pronto**, por causa de 5 achados P1.

Abri de fato as 13 imagens pedidas. Todas existem com os nomes informados. No código, li só o trecho de `components/portal/followup-transfer-panel.tsx` que trata da contagem de responsáveis e do texto de confirmação. Não executei nada e não atribuo a mim os testes de 0 erros JS e 0 overflow.

## O que está bom (e não pesou contra a nota)
- **Datas:** seguem o formato brasileiro em tudo (09/11/2026, "Segunda-feira, 9 de novembro de 2026").
- **Situação "Provisória":** usa ícone de círculo tracejado, texto e borda âmbar, então não depende só da cor.
- **Horário vazio:** sessão sem hora aparece como "Horário a confirmar" em itálico, e o editor mostra `--:--` vazio no conflito.
- **Temas:** o claro e o escuro estão equivalentes. O foco em aqua aparece em `Editar` (1366) e no título "Editar sessão" (390, tema escuro).
- **Identidade no PDF:** faixa roxa, linha laranja, as duas marcas PROEX e UFG, rodapé "Página X de 2" e cabeçalho de continuação na página 2.

## Achados

| # | Sev. | Imagem / arquivo | Problema | Correção exata |
|---|---|---|---|---|
| 1 | **P1** | 1366-light-conflict.png | Dois avisos aparecem ao mesmo tempo e se contradizem: "Alteração não confirmada" e "Sessão adicionada e conferida". Eles ainda cobrem a coluna direita do aviso de conflito, que fica cortada em "Observação conco…". | Ao abrir um conflito, apagar o aviso de sucesso anterior. Mover os avisos para baixo à direita, ou abaixo do cabeçalho, sem cobrir o editor. |
| 2 | **P1** | 1366-light-conflict.png | O aviso de conflito tem duas colunas difíceis de comparar. Só diz "revise antes de salvar", sem ação clara. "Salvar alterações" aparece em lilás apagado, parecendo desativado, sem explicar por quê. | Usar uma coluna só, com a tabela "Seu rascunho × Versão atual" por campo. Incluir os botões "Usar versão atual" e "Manter meu rascunho". Se Salvar estiver bloqueado, explicar o motivo logo abaixo dele. |
| 3 | **P1** | 1366-dark-transfer.png + `followup-transfer-panel.tsx:123-124` | O texto "A contagem acima considera apenas atribuições individuais" fala de uma contagem que não aparece quando é 0 (linha 123 só mostra se houver alguém). O técnico fica sem saber se alguém perde acesso. | Quando for 0, mostrar "Nenhum responsável individual perde acesso ao destino." Trocar a linha 124 por: "Atenção: integrantes de equipe e o autor só continuam vendo se tiverem acesso a [destino]." |
| 4 | **P1** | 1366-dark-transfer-history.png | A "Versão 2" do histórico mostra só o motivo. Não diz de qual projeto para qual, nem quem moveu. Não há prova visual de que os responsáveis foram mantidos. | Mostrar "Transferida de **Projeto QA descartável** para **Evento anfitrião QA** por [nome] · motivo: …" e a lista de responsáveis antes e depois. |
| 5 | **P1** | programacao-compacta-1.png | O PDF não cita o evento anfitrião, que é o assunto da tela. Os títulos são genéricos: "RELATÓRIO DO PROJETO" e "Registros do relatório". O título principal é o projeto, não a programação. | Rótulo de cima: "PROGRAMAÇÃO DA DINÂMICA". Título: "Evento QA local". Subtítulo: "Responsável: Projeto QA descartável". Nova linha "Projeto(s) anfitrião(ões)" em "Sobre o recorte". Trocar "Registros do relatório" por "Sessões". |
| 6 | P2 | 1366-dark-transfer.png | A confirmação é vaga ("acessos antigos podem deixar de valer"). Ela não confirma uma mudança de acesso concreta. | Na caixa de confirmação, nomear o efeito: "Pessoas só do projeto de origem (N) deixarão de ver esta demanda". Repetir o nome do destino no botão: "Mover para Evento anfitrião QA". |
| 7 | P2 | programacao-compacta-1/2.png | A tabela repete a data em todas as linhas e não separa por dia nem mostra o dia da semana. "Início: A confirmar / Fim: A confirmar" gasta 2 linhas. "versão 25" é jargão interno. | Fazer uma linha de subtítulo por dia ("Segunda-feira, 09/11/2026"). Trocar a coluna por "Sessão 1 · Rodada 2 QA". Usar uma linha só, "Horário a confirmar". Tirar "· versão 25". |
| 8 | P2 | 1366-light-planning.png | "Cancelar sessão" e "Desvincular" (1366-light-hosts.png) têm borda tracejada e parecem desativados. "Cancelar sessão" fica sozinho numa linha. As ações ficam desalinhadas entre cartões (y≈627 contra 631). | Usar borda contínua, texto e ícone em cor de perigo. Montar o cartão em coluna flex com `margin-top:auto` no grupo de ações. Deixar as três ações na mesma linha no desktop. |
| 9 | P2 | 390-light-planning.png / 390-dark-planning.png | No celular, 15 sessões com 3 botões cada viram uma rolagem muito longa, e não dá para ir direto a um dia. | Transformar cada dia em `<details>` recolhível com contagem ("3 sessões · 3 provisórias"), ou pôr atalhos fixos por dia no topo da lista. |
| 10 | P2 | 390-light-editor.png | A ajuda "Deixe início e fim em branco…" fica abaixo da Observação, longe dos campos de hora, e cortada pela barra inferior. "Ordem no dia" ocupa meia largura e deixa um buraco à direita. | Mover a ajuda para logo abaixo de Início/Fim e ligá-la com `aria-describedby`. Pôr "Ordem no dia" na mesma linha da Data, ou em largura total. |
| 11 | P2 | 390/1366-light-planning.png | Pode haver ambiguidade no critério "horas provisórias ficam vazias": a Sessão 1 é "Provisória" e mostra 18:00 às 19:30. | Se o critério é "provisória sem hora", bloquear horário quando a situação for Provisória. Se é só "hora desconhecida fica vazia", deixar isso explícito na regra e no QA. |
| 12 | P2 | 1366-dark-transfer-history.png / 1366-dark-transfer.png | A coluna esquerda mostra "Carregando demandas…" com um grande vazio. O aviso cobre o chip do projeto ("Evento anfitriã…") e um botão do cabeçalho ("…ar"). | Mostrar um esqueleto de 3 a 5 cartões enquanto carrega. Posicionar os avisos fora da área do título do detalhe. |
| 13 | P3 | 390-dark-planning.png vs 1366-dark-transfer.png | No tema escuro, o botão principal muda de estilo: "Adicionar sessão" é lilás claro com texto roxo e "Mover demanda" é roxo médio com texto branco. | Usar um único estilo de botão principal no escuro (o de "Mover demanda") nas duas telas. |
| 14 | P3 | 1366-light-planning.png | "Página do evento" e o seletor "Ativo" têm texto de cerca de 11px. O aqua da marca só aparece como anel de foco. | Subir o texto para pelo menos 14px. Usar o aqua também em um estado, por exemplo um selo "Confirmada". |
| 15 | P3 | 390-light-planning.png | Texto truncado ou estranho: "inclusive a divisão do dia em três rodadas. Cada sessão só vale como programada depois de confirmada". "consultado em 05/11/2026" vem sem hora, e o PDF tem hora. | Trocar por: "Proposta de organização. Sessões provisórias não são compromisso até serem confirmadas." Usar "consultado em 05/11/2026 às 16:08". |

## Limitações
- **Transferência no celular:** não há captura em 390px, então não avaliei. Este é o maior buraco de evidência.
- **"Abre somente ao solicitar":** não há captura do painel fechado. Não pude confirmar.
- **"Não muda estoque" e a manutenção de ID e responsáveis:** só vi texto dizendo isso, não um estado antes e depois.
- **Alvos de 44px:** estimei pelo olho nas capturas. Não medi, porque não usei DOM nem ferramentas.
- **Outros formatos:** o XLSX e o DOCX não foram avaliados. Do PDF, vi só as duas imagens de páginas.

A nota vale só para esse escopo, não para o site todo.
