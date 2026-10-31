# Auditoria independente de design — V15 / R24

Data: 31/10/2026. **Aceite de design do incremento observado: 9,1/10** (média ponderada 9,11), sem P1/P2 remanescentes demonstrados nas superfícies aceitas. A avaliação abrange Meu trabalho, cartões de Demandas, designação de responsáveis e sino agrupado. Não comprova publicação, migração de produção, certificação WCAG ou nova inspeção completa das dezesseis famílias da V14.

A revisão independente combinou leitura de fonte, inspeção visual dos PNGs locais com dados sintéticos e conferência dos metadados de DOM fornecidos pela coordenação. O revisor não operou CUA, iniciou servidor/build ou alterou fonte/produção nesta etapa. As imagens permanecem privadas em `.sites-runtime/production-v15/`; este documento registra somente critérios e metadados operacionais.

## Rubrica comparável à V14

Os oito pesos são os mesmos da auditoria V14, cuja nota final foi 9,0 (ponderada 9,045). O escopo visual novo é o incremento R24; a nota não representa uma reavaliação automática das famílias que não foram recapturadas.

| Dimensão | Peso | Nota | Fundamentação e limite |
| --- | ---: | ---: | --- |
| Hierarquia e próxima ação | 15% | 9,2 | Contexto, origem da atribuição, métricas e demandas têm ordem reconhecível. “Suas atribuições” evita repetir o h1; Atualizar não estreita mais a descrição em 320 px. Listas pessoais e gestão de responsáveis têm propósitos distintos. |
| Espaçamento e densidade | 10% | 8,9 | Filtros e ações de Demandas preservam 24 px nos quatro contextos medidos. Cartões e fieldsets têm respiro. Seis demandas e seis designações, seguidas pelo gráfico, ainda produzem uma página móvel longa; o primeiro registro exige rolagem após contexto/métricas. |
| Tipografia e legibilidade | 10% | 8,8 | Títulos longos quebram sem invadir a seta; texto operacional e campos são reconhecíveis. Datas, atribuição e alguns auxiliares permanecem em 11–12 px; os nomes nos seletores móveis podem truncar. Não foi testada ampliação real de texto/zoom de 200%. |
| Contraste e temas | 15% | 9,3 | Métricas usam texto/ícones além de âmbar, azul e verde. O sino usa superfície azul escura própria, corrigindo os cartões quase brancos. Os pares inspecionados têm bom contraste; isso não mede cada estado ou par de cor possível. |
| Responsividade e toque | 15% | 9,2 | Central em 320/375/414/1250 px nos dois temas; gerenciador em 375/1250 e amostras de 320. Overflow do cabeçalho e deslocamento da modal foram corrigidos e recapturados. Medições não apontaram controles menores que 44 px nas superfícies novas examinadas. |
| Consistência de componentes | 10% | 9,1 | Sinais compartilhados mantêm estado, prioridade e prazo separados. Cards, disclosure de responsáveis, seleção de pessoas/equipes e ações primária/destrutiva são coerentes. O ícone acima do título do gerenciador e alguns metadados podem receber refinamento posterior. |
| Teclado e semântica | 15% | 9,1 | Botões, labels/legends, aria-pressed, status persistente e confirmação de revogação são explícitos na fonte. A coordenação comprovou navegação Mais→Meu trabalho, métrica por Espaço e Escape com retorno de foco. Não houve execução com leitor de tela pelo revisor. |
| Feedback e estados | 10% | 9,1 | A central explica recorte e totais completos; Demandas identifica resumo da página. O sino agrupa sem confundir a janela de 100 com o total global. Concluída com data passada fica neutra no prazo; revisão/seleção e consequências da revogação são claras. A fotografia não cobre toda combinação de erro, vazio ou conflito. |

Cálculo: `(15×9,2 + 10×8,9 + 10×8,8 + 15×9,3 + 15×9,2 + 10×9,1 + 15×9,1 + 10×9,1) / 100 = 9,11`, apresentado com uma casa decimal. A nota global não implica que todas as dimensões atingiram 9.

## Evidências aceitas

| Superfície | Evidência | Resultado observado |
| --- | --- | --- |
| Meu trabalho | Oito `accepted-my-work-{320,375,414,1250}-{light,dark}.png`, revisão `5b4fb91`; `visual-proof-accepted.json`. | Cabeçalho sem barra horizontal, descrição compacta e origem direta/equipe identificável. Desktop completo contém listas e distribuição por módulo. Em 320, PNG/clientWidth/scrollWidth são 305; em 375, 360; em 414, 399; em 1250, 1235. A diferença para innerWidth decorre da scrollbar clássica e não deve ser ignorada nas medições. |
| Demandas | `accepted-demands-1250-{light,dark}.png`, `accepted-demands-375-dark.png` e `release-demands-cards-375-{light,dark}.png`, revisões `5b4fb91`/`6674d37`. | Estado carregado mostra 14 demandas no resumo da página, métricas e cartão. Título, responsáveis, prioridade e prazo permanecem separados; cards móveis quebram texto sem corte. As amostras complementares `final-demands-cards-375-*` mostram títulos mais longos e múltiplos responsáveis; não substituem as recapturas aceitas. |
| Concluídas | `release-my-work-completed-cards-375-light.png`, `6674d37`; `keyboard-proof.json`. | Métrica Concluídas selecionada, lista de 2 resultados, estado verde, prioridade alta vermelha e data antiga neutra. Filtrar a lista preserva os totais completos. |
| Responsáveis no material | Quatro `release-material-manager-{375,1250}-{light,dark}.png`, mais `release-material-manager-320-light.png` e `release-material-manager-fields-320-light.png`; `release-proof.json`, `6674d37`. | Modal móvel começa em x=0 e termina em clientWidth: 360 em 375 e 305 em 320. Desktop vai de x=415 a 1235, aproximadamente 820 px. Pessoas/equipes, seleção, aviso de ausência de concessão de acesso e ações de salvar/revogar são legíveis. A faixa horizontal de abas tem rolagem própria e não é overflow do corpo. |
| Sino agrupado | Quatro `release-bell-{375,1250}-{light,dark}.png`; `release-proof.json`, `6674d37`. | Popup dentro da largura útil: em 375, x=12/right=348, com clientWidth 360. Título, total de não lidas, ação global e contagens da janela estão explícitos. Cartões escuros agora usam fundo RGB(29,48,77) e texto RGB(196,220,255). |
| Espaço e foco | `gap-and-bell-proof.json` e `keyboard-proof.json`, complementados pela reconferência de Escape relatada pela coordenação em `6674d37`. | Separação filtros→ações de 24 px e sino de 44×44 nos quatro contextos. Mais por Espaço→Meu trabalho por Enter; Concluídas por Espaço; Escape do sino retorna ao gatilho. Escape da modal aberta por URL retorna ao main; quando aberta pelo catálogo retorna ao botão de origem. São execuções da coordenação, não CUA independente do revisor. |

O novo `release-proof.json` contém 14 registros, revisão `6674d37`, com clientWidth/scrollWidth e retângulos dos overlays, sem usar a comparação incorreta somente com innerWidth. Os estados anteriores não são promovidos a prova final por terem nome “final” ou “loaded”. Em particular, `accepted-my-work-completed-375-light.png` mostra responsabilidades e não prova visualmente Concluídas; `accepted-demands-375-light.png` e `release-demands-loaded-375-light.png` ainda exibem “Carregando demandas…” na imagem lida. O aceite do estado carregado usa os cartões efetivamente carregados citados acima.

Os tons das métricas foram conferidos a partir dos valores de foreground/background do DOM: claro, warning 6,85:1, info 8,72:1 e success 7,13:1; escuro, 11,28:1, 11,82:1 e 12,66:1. O azul de sinal compartilhado no escuro, também adotado no sino, tem aproximadamente 9,50:1. Esses cálculos pontuais não equivalem a auditoria normativa integral.

## Achados encerrados durante a revisão

| Achado | Antes | Correção e prova |
| --- | --- | --- |
| P2 — overflow real de 4 px em 320 | A primeira coleta comparava scrollWidth 309 a innerWidth 320; a PNG e a área útil tinham 305 px, com barra horizontal visível. | `5b4fb91` corrigiu o seletor do ícone decorativo dentro de span no tema. Recapturas têm clientWidth=scrollWidth=305, sem esconder overflow para simular correção. |
| P2 — modal do material deslocada | A largura de 100vw incluiu a scrollbar, levando a modal de 375 px para x=-15 em área útil de 360; a aba esquerda ficava cortada. | Overlay `6674d37` usa a largura útil; recapturas em 375 e 320 mostram x=0 e right=clientWidth. Não é uma alegação retroativa de que essa condição já havia sido testada na V14. |
| P2 — grupos não lidos ignoravam tema escuro | Classes fixas bg-blue-50/text-slate-950 mantinham grandes cartões claros dentro do popup escuro. | Variante escura em `6674d37`, recapturada em 375/1250, preserva legibilidade sem dominar a central com superfície quase branca. |
| Melhoria — cabeçalho denso | H1/h2 repetiam “Meu trabalho”; Atualizar fazia a descrição ocupar cinco linhas estreitas em 320. | “Suas atribuições”, descrição curta e grid estreito; oito recapturas `5b4fb91` aprovadas. |

## Limites e melhorias seguintes

Não há novo P1/P2 demonstrado que bloqueie o aceite de design das superfícies acima. Permanecem oportunidades de tornar auxiliares de 11–12 px mais confortáveis, mostrar melhor o nome completo do projeto selecionado e aproximar o resumo por módulo das listas em páginas muito longas. A faixa de abas da modal exige rolagem horizontal em telas estreitas; a captura de 320 confirma os campos, mas não todos os formulários/abas existentes.

A revisão técnica independente anterior do sino passou 75 testes focados e sete probes adicionais, incluindo janela versus total, destinatário próprio, revogação e respostas antigas, com dados sintéticos. Isso complementa o aceite; imagens não provam ACL, segurança da migração ou resultado de escrita. A coordenação responde pelos gates de testes/builds/migração e pela verificação real de publicação. Nenhum e-mail, OAuth, configuração de provedor ou dado de produção foi acionado para esta crítica.

Zoom real de 200%, leitores de tela, dispositivos físicos e todas as combinações de conteúdo/erro não foram comprovados nesta etapa. A evidência em 320 px e a semântica da fonte são úteis, mas não substituem esses testes. As demais famílias mantêm o parecer V14 como referência histórica; não se declara uma nova nota individual para cada uma sem nova evidência.
