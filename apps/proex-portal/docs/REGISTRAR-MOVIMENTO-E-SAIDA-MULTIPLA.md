# Registrar movimento pela ficha e saída de vários materiais · 11/11/2026

> **Merge a partir de 14/11.** Esta mudança mexe na tela de movimentação, em uso na distribuição do CONPEEX até 13/11. Até lá, fica em ramo e em PR rascunho. Nada foi testado em produção com estoque real.

Origem: revisão geral de 09/11 (itens **R5** e **P9**), aprovada pelo Yan em 10/11 ("Sim, seguir todas").

## R5 · "Registrar movimento" abre a ficha

**Antes:** havia quatro formas de movimentar estoque.

| Caminho | Situação |
|---|---|
| Formulário no fim da página Materiais | **Removido.** Era o único que gravava sem passar pela ficha e usava o campo `note` |
| Ficha do material → Movimentar | **É o caminho único** para um material. Tem histórico, corrigir, desfazer e anexos |
| Ficha do projeto → Movimentar | Já abria a ficha do material; continua igual |
| Assistente Rolê | Não mudou nesta entrega (fica com a sessão do Rolê) |

**Agora:** o botão **Registrar movimento** (no topo do catálogo e no fim da página) abre um diálogo com dois modos.

1. **Um material:** busca pelo nome e abre a ficha direto em Movimentar.
2. **Vários de uma vez:** a saída conjunta descrita abaixo.

A tela passou a enviar sempre `reason` como motivo. O servidor continua aceitando `note`, porque a planilha de projeto e o Rolê ainda usam esse nome.

## P9 · Saída de vários materiais de uma vez

- **Onde:** Registrar movimento → Vários de uma vez.
- **Para quê:** entrega ou uso em que vários materiais saem juntos, com o mesmo destino e o mesmo motivo. Recebimento e correção de contagem continuam na ficha de cada material.
- **Como preencher:** projeto (se houver mais de um), o que aconteceu, de 2 a 30 linhas de material e quantidade, destino (opcional), origem ou processo (opcional) e o motivo.
- **Tudo ou nada:** se uma linha falha (saldo insuficiente, material indisponível, equipamento), nenhuma é gravada, e a mensagem diz qual material travou.
- **Depois de gravar:** a tela lista o que saiu, com "Abrir ficha" em cada material. Cada linha é uma movimentação comum: aparece no histórico do material, na página do destino e em Registros, e pode ser corrigida ou desfeita sozinha.

### No servidor

- Ação `stock.move.many`, em `lib/materials.ts`. Entrada: `kind` (`distribute` ou `consume`), `lines` (`itemId` e `quantity`), `reason`, os campos de destino e de contexto de `stock.move` e `operationKey`.
- **Regras:**
  - todas as linhas são do mesmo projeto, e quem grava precisa de `inventory.manage` nele;
  - a permissão é conferida de novo dentro da gravação (`capabilityBatch`);
  - equipamento não entra (a saída dele é empréstimo);
  - o mesmo material não se repete.
- **Uma transação só:** as movimentações, o contexto, o vínculo com o destino e a auditoria vão num único lote. Se o saldo mudar entre a conferência e a gravação, o gatilho do banco aborta o lote inteiro.
- **Repetição segura:** cada linha recebe a referência `manual:<pessoa>:<operationKey>:<n>`. Um reenvio com os mesmos dados devolve a mesma saída. Com dados diferentes (outra quantidade, outro motivo, outro destino, menos linhas), a resposta é 409 `operation_conflict`.
- **Resposta perdida (celular no estande):** se o servidor não responde, a tela guarda o pedido exatamente como foi enviado e trava os campos. O botão vira **Conferir se foi registrada** e reenvia o mesmo pedido, sem conferir o saldo da tela. Se a saída já tinha sido gravada, ela não se repete; se não tinha, é gravada agora. Sem isso, a tela mostraria o saldo já descontado, a pessoa baixaria a quantidade e sairia uma segunda entrega.
- **Permissão antes de qualquer resposta:** quem não gerencia o estoque de todos os projetos citados recebe 403, e não fica sabendo quais materiais são do mesmo projeto.
- **Chave do assistente recusada:** chave começando com `ai_` dá 400, porque o histórico usa esse prefixo para dizer "feito pelo Rolê".
- **Auditoria:** uma linha `stock.move` por movimentação, com `batchId`, e uma linha `stock.move.many` para a saída inteira (linhas, unidades e ids).
- **Sem migração.** Nenhuma tabela nova.
- **Também corrigido:** o erro `stock_unavailable` do gatilho de saldo agora vira 409 "O saldo disponível mudou", também na movimentação simples.

## Testes

`tests/material-outflow-many.test.mjs`:
- uma operação com três materiais, o mesmo destino e o mesmo processo; desfazer uma linha não mexe nas outras;
- tudo ou nada em cada validação, sem deixar destino criado;
- saldo que muda no meio desfaz todas as linhas;
- reenvio idempotente e conflito com dados diferentes;
- permissão por projeto, conferida de novo na gravação;
- o destino faz parte da operação confirmada, a chave `ai_` é recusada, quem é de fora não descobre projetos e duas requisições iguais gravam uma vez;
- a página não grava mais movimento por conta própria.

## Revisão independente (11/11)

Uma revisão de código independente não achou problema grave no servidor (autorização, atomicidade, idempotência e saldo conferidos). Os achados foram corrigidos nesta entrega:

| Achado | Gravidade | O que foi feito |
|---|---|---|
| Reenvio depois de resposta perdida podia virar saída em dobro | Média | A tela reenvia o mesmo pedido e trava os campos até o servidor responder |
| O navegador podia fechar o diálogo durante o salvamento | Baixa | O diálogo trata o evento de fechamento |
| Reenvio com outro destino era aceito | Baixa | Vira 409; a resposta repetida também informa o destino |
| Chave `ai_` marcava a saída como feita pelo Rolê | Baixa | Recusada nesta ação |
| A ordem dos erros revelava o projeto de um material | Baixa | A permissão é conferida primeiro |
| Muitas leituras por operação | Baixa | Uma consulta para os materiais e uma validação de contexto por saída |
| Foco e anúncio do resultado, plural da unidade, projeto com um só material, lista cortada sem aviso | Baixa | Corrigidos |

Ficou anotado, fora desta entrega: a movimentação simples (`stock.move`) também aceita reenvio com outro destino e chave `ai_` de quem chama a API direto. É anterior a esta mudança.

## Fora desta entrega

- O Rolê continua como caminho próprio de movimentação. A unificação dos assistentes é o item R6, da sessão do Rolê.
- O histórico não agrupa visualmente as linhas de uma mesma saída. O `batchId` fica na auditoria, se for preciso agrupar depois.
