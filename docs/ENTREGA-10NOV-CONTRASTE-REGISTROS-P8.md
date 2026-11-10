# Entrega 10/11/2026 · Contraste no escuro, nomes na linha do tempo e explicação ao bolsista

Sessão de aparência e Registros, branch `claude/contraste-registros-10nov`. O pedido veio da coordenadora, com as propostas aprovadas pelo Yan em 10/11 ("Sim, seguir todas").

## O que mudou

1. **Botão lilás no tema escuro, corrigido no token.**
   - Os botões sutis e de ícone usam duas variáveis novas, `--button-subtle-bg` e `--button-subtle-border`; a cor do texto continua a mesma. Também mudou o contorno de campos e chips no escuro (`--control-border`).
   - Medido em Materiais, tema escuro, sobre o cartão `#241b2e`:

     | | Antes | Depois | Mínimo |
     |---|---|---|---|
     | Contorno do botão | 2,05:1 | **3,69:1** | 3:1 |
     | Texto | 9,48:1 | **8,76:1** | 4,5:1 |
     | Contorno do primário (sem mudança) | — | 3,97:1 | 3:1 |

   - A varredura de texto de todos os botões, nos módulos, no tema escuro, não achou falha.
2. **Linha do tempo de Registros sem nome partido.**
   - A PR89 tinha protegido só o título do acontecimento.
   - Agora também ficam inteiros, mudando de linha como um bloco: o nome do tipo ("Entrada de estoque", "Demanda concluída", "Configuração de IA alterada"), cada nome nos acontecimentos agrupados, com a vírgula junto, o "e mais N" e o detalhe (quantidade ou prioridade).
   - Em 390 e 1366 px, nenhum nome de tipo nem nome agrupado ocupa duas linhas.
   - Em 320 px, só os títulos mais longos que a linha inteira quebram, e sempre entre palavras.
3. **P8: explicação para quem não cria registro.**
   - Quem pode consultar Registros mas não tem nenhuma permissão de criar vê um aviso no topo de Registros, nas duas abas. Hoje são o bolsista de dinâmica (operador) e o leitor.
   - O aviso: "Você consulta os registros, mas não cria registros novos." Em seguida, diz o que fazer (abrir uma demanda para quem coordena o projeto, que faz o registro) e traz o botão **Abrir demanda**.
   - **A regra de permissão não mudou.** A tela só lê as permissões que já recebia. A lista de permissões que deixam criar registro vem do próprio formulário (`RECORD_CAPABILITIES`).

## Verificação

- Portal: 1.532 testes passaram, incluindo os 2 novos de `tests/records-ask-ui.test.mjs`. Tipos, lint (0 erros), `build` e `build:node` passaram.
- QA local sintético (127.0.0.1, porta própria). Capturas em 390 e 1366 px, claro e escuro, de Registros, Materiais, linha do tempo e aviso P8, em `apps/proex-portal/docs/evidencias/2026-11-10-contraste-registros/`. Sem erro de página nem rolagem lateral.
- Aviso P8 conferido com permissões de operador simuladas no navegador: aparece nas duas abas, some o "Novo registro", e o botão abre Demandas. Com a conta dona, o aviso não aparece.

## Não verificado

- Celular físico e leitor de tela.
- Conta real de bolsista em produção: a conferência em produção é só leitura, sem login.

## Plano para depois de 14/11

R1 (Histórico único, "Ver histórico" e "Cronograma") e R4 (Responsáveis nas fichas): `docs/PLANO-R1-R4-HISTORICO-E-RESPONSAVEIS.md`.
