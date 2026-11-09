# Níveis de brinde e foto principal do material

Pedido de Yan em 2026-11-09, durante o 23º CONPEEX. Migração aditiva `0035_prize_tiers_and_primary_photos`.

## Níveis de brinde por dinâmica

- Três níveis: **Brinde**, **Super** e **Super Super**. A pessoa escolhe **uma** opção do nível que saiu.
- Uma opção é um brinde ou kit do projeto (tabela `offers`). Um conjunto, como três bótons de cores diferentes, é uma opção só, com vários materiais.
- O nível é configuração da dinâmica (`campaign_prize_tiers`). Fica no painel **Níveis de brinde**, dentro do cartão da dinâmica, em Dinâmicas.
- Quem gerencia dinâmicas no projeto (responsável ou gestor) muda o nível num seletor, cria uma opção nova ou tira uma opção da dinâmica. Os demais papéis do projeto só consultam. Dinâmica encerrada fica somente leitura.
- Cada mudança entra em `campaign_prize_history`, que não aceita edição nem exclusão. O painel mostra quem mudou, quando, o nível anterior e o novo. Também vai para `audit`.
- **Nada disso mexe em estoque, reservas, códigos de retirada ou entregas.** Há teste com entrega real antes e depois das mudanças.

### Premissa do Super Super

- A roleta e o dado do portal continuam com seis faces: 3 Brinde, 1 Super, 1 Tente novamente e 1 Não foi.
- Super Super é uma parte dos resultados Super, decidida na hora por um sorteio extra visível (com 25%, um dado de 4 faces, por exemplo).
- Premissa padrão: **25%** dos resultados Super viram Super Super (1 em 4), a mesma hipótese da simulação de 06/11. O painel mostra o selo “Premissa padrão, ainda não confirmada” até alguém salvar um valor. O valor vai de 0 a 100 e cada mudança entra no histórico.
- Chances por pessoa, com até 1 repetição e 25%: Brinde 58,3% (7/12), Super 14,6%, Super Super 4,9%, sem brinde 22,2%. São estimativas para separar os lotes, não promessas.
- A roleta ainda não faz o sorteio extra sozinha, e o motor de participação continua com uma oferta Brinde e uma Super. Essa decisão segue pendente com Yan.

### API

`GET /api/prize-tiers?campaignId=…` e `POST /api/prize-tiers` com `tier.set`, `percent.set` ou `option.create`. A rota exige a mesma origem, `X-Proex-Action: 1`, `expectedVersion` (controle de concorrência) e `operationKey` (repetição segura).

## Foto principal do material

- Na aba **Fotos** da ficha, quem administra o estoque usa **Usar câmera** ou **Escolher foto**. O portal mostra a foto principal de hoje ao lado da nova e só salva quando a pessoa escolhe **Usar como foto principal** ou **Só adicionar à galeria**.
- Avisos contra foto acidental, sem bloquear: imagem muito escura (frame de webcam), quase lisa ou com pouca resolução.
- Uma foto antiga da galeria também pode virar a principal (**Usar como foto principal**, com confirmação).
- A troca é um registro novo em `item_primary_photos`, que não aceita edição nem exclusão. Fotos citadas no histórico não podem ser escondidas nem apagadas. Fotos antigas continuam na galeria.
- A aba **Histórico** mostra “Trocas da foto principal” com miniaturas antes e depois, autor e data, para quem pode ver o material.
- Antes da primeira escolha, vale a ordem antiga: a foto mais nova é a principal. Depois de uma escolha, enviar outra foto não troca a principal. “Só adicionar à galeria” num material sem escolha fixa antes a foto atual, para ela não ser trocada sem querer.

## Testes

`tests/prize-tiers.test.mjs`, `tests/prize-tiers-route.test.mjs` e `tests/material-primary-photo.test.mjs` cobrem níveis, premissa, histórico, permissão negada, revogação durante a gravação, imutabilidade e entregas inalteradas.
