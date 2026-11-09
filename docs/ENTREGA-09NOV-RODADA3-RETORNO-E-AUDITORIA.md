# Entrega 09/11/2026 · Retorno do Yan sobre a PR42 e auditoria de uso

Branch `claude/acabamento-rodada3-09nov` (Claude Code, sessão "visual-coerencia").

## Retorno do Yan (produção da PR42, ~10h45)

| Pedido | O que foi feito |
|---|---|
| "O Y ficou meio ruimzinho" (saudação) | Saudação em Sora 600 sem espaçamento negativo; títulos em geral passaram de -0,025em para -0,012em. Conferido com o nome sintético "Yara". |
| "Não entendi a bola laranja… a bola azul" | As bolas saíram. Ficou uma faixa fina nas três cores da marca (roxo claro, laranja, aqua) na base do cartão. Escolha: identidade da marca, discreta, sem forma sem sentido. |
| Relatórios "diminuiu aqui" no celular | No celular o gráfico deixa de ser cartão dentro de cartão; eixo até o valor máximo; altura sem espaço vazio; cores da marca no lugar do azul; aviso quando só existe "Sem informação"; "Por página" sem quebra. A coluna de rótulos segue em 1/3 da largura porque um teste fixa essa regra. |
| Acompanhamento da administração | Registros > Histórico ganhou "Prazos e equipe": prazos das demandas concluídas (no prazo, com atraso, sem prazo) e abertas já vencidas, para quem lê demandas; atividade registrada por pessoa (dias com registro e quantidade), só para quem gerencia acessos e só nos projetos que gerencia. |

**Premissa sobre "acesso e frequência":** o portal não guarda histórico de logins (a tabela de sessões só tem sessões vigentes). Por isso a frequência é medida pela atividade registrada (movimentos, demandas, empréstimos, registros), com o aviso "Não é controle de ponto nem de login". Medir login exige decisão de privacidade do Yan e um registro novo.

## Auditoria de uso (sessão de auditoria, 10:44)

| Item | Resultado |
|---|---|
| U8 histórico sem saídas, devoluções e conclusões | Já resolvido pela PR49 (a auditoria foi feita antes dela); teste novo prova saída, consumo, retirada, devolução e conclusão no histórico. |
| U9 "Novembro De 2026" e "28 unidade" | Corrigidos (mês na aba Documentos; plural na ficha do material). |
| U1 movimento longe no celular | Botão "Registrar movimento" ao lado da busca leva ao formulário. |
| U2 movimento começa em Recebimento | A operação começa vazia e é obrigatória, na lista e na ficha do material. |
| U4 devolução escondida | O cartão mostra o botão "Registrar devolução" (ou "Registrar retirada"). |
| U5 sem "Nova demanda" com todos os projetos | Dica: "Para criar uma demanda, escolha um projeto no filtro acima." |
| U6 concluir demanda direto | **Não feito:** muda o fluxo (hoje a conclusão passa pelo formulário com observação). Pergunta para o Yan. |
| U7 aviso de sucesso em outro módulo | O aviso some ao trocar de módulo. |
| U10 "Choose File" | O termo do empréstimo usa o botão "Escolher arquivo". Outros campos de arquivo seguem como estão. |

## Coerência de cores

Uma regra só no portal: roxo = em andamento/informação, aqua = concluído/positivo, laranja = atenção, vermelho só para estado crítico (prazo vencido) com ícone e texto. Aplicada ao Panorama (sem vermelho encostado em verde), "Meu trabalho", gráficos de Registros, Relatórios e selos de Demandas.

## Verificação

- Portal: 1.415 testes (10 do histórico, incluindo prazos e atividade da equipe por perfil), tipos, lint sem erros, `build` e `build:node`, já com as PRs 50–54 da `main`.
- Crítica independente: 8,7 → **9,0**, sem P0/P1. Evidências em `apps/proex-portal/docs/evidencias/2026-11-09-rodada3/`.
- Ensaio no celular: Materiais (ficha abre, filtro, movimento), Demandas, Dinâmicas, Agenda, barra inferior e Registros sem erro nem rolagem lateral.
