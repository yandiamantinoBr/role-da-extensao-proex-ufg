# Movimentações editáveis, destinos, anexos e filtros de Materiais · 09/11/2026

Pedido do Yan (09/11), a partir do Histórico do Botton azul: desfazer ou corrigir uma distribuição sem perder o registro, saber quem registrou e quem editou, anexar a foto da entrega com o processo CI, excluir foto errada, abrir a página do destino ("Centro de Eventos da UFG") e filtrar o catálogo.

## O que mudou

1. **Corrigir e desfazer sem apagar o passado** (`stock.revise`).
   - Corrigir: o portal anexa uma anulação da versão atual e uma versão nova com os valores certos. Os dois lançamentos ficam ligados ao original em `stock_movement_revisions`, com quem, quando, motivo, antes e depois.
   - Desfazer: anexa só a anulação. O saldo volta pelo mesmo gatilho de sempre.
   - O original continua no histórico, marcado como "Corrigida" ou "Desfeita". A versão nova aparece como "Versão corrigida" e mostra o valor anterior.
   - Só a versão atual pode ser alterada, por quem movimenta o estoque do projeto (`inventory.manage`, conferido de novo no SQL do lote). Tudo é idempotente pela `operationKey`.
   - Equipamentos (empréstimos) e entregas de brinde (`redeem`) ficam de fora: são corrigidos na agenda e na dinâmica.
2. **Origem clara.** Um movimento que veio do Rolê aparece como "Pedido ao Rolê, confirmado por Fulano". A informação vem de `ai_plans.result_json.movementId` ou do prefixo `manual:<pessoa>:ai_`. A correção aparece como "Corrigido por Fulana".
3. **Painel da movimentação.** Ao clicar em uma linha do Histórico, abre um painel com:
   - saldo antes e depois do registro;
   - data, origem, destino, finalidade, processo e pessoa atendida;
   - a cadeia de versões, com as diferenças campo a campo;
   - os anexos;
   - os botões Corrigir e Desfazer.
4. **Anexos de movimentação** (`stock.evidence.prepare` + `/api/records`).
   - Aceita foto JPEG, PNG ou WebP, reduzida no aparelho, ou PDF de até 4 MB.
   - O arquivo fica no mesmo armazenamento privado das fotos dos materiais (`record-attachments/…`, tabela `proex.objects`), então entra no backup.
   - O registro de comprovante fica ligado à movimentação em `stock_movement_records` e não aparece na galeria nem pode virar a foto principal.
5. **Excluir foto ou anexo** (`item.photo.delete`, `stock.attachment.delete`).
   - A exclusão é lógica: grava `record_attachment_deletions` (quem, quando, motivo) e depois `deleted_at`.
   - Um gatilho recusa esconder qualquer anexo sem esse registro. A foto principal precisa ser trocada antes; a única foto pode ser excluída, com aviso.
   - As fotos excluídas aparecem no Histórico, e as trocas de foto principal mostram "Foto excluída".
6. **Destinos como entidades** (`material_destinations`).
   - Tipos: evento, local, unidade, parceiro e outro, por organização. Cada destino tem página própria (`/?module=materials&destinationId=…`), com:
     - link oficial;
     - totais por material, contando só a versão atual;
     - movimentações, incluindo as corrigidas;
     - materiais reservados para o destino;
     - links de volta para cada material.
   - O formulário sugere os destinos existentes. Um nome novo é criado no mesmo lote da movimentação, e um nome repetido, com qualquer combinação de maiúsculas, reaproveita o destino.
   - O destino não dá acesso: a página só lista projetos que a pessoa já consulta.
7. **Posse e filtros.**
   - `items.owner_unit_id`: uma unidade (gabinete, comunicação) pode ser dona. O projeto continua controlando o acesso.
   - `items.event_destination_id`: o evento ou local para onde o material está reservado.
   - Os dois campos ficam no cadastro, com versão e auditoria.
   - O catálogo ganhou filtros por dono, tipo, categoria, situação e foto. Também passou a listar os kits de brinde com quantos podem ser montados.
8. **Relatórios sem contagem dupla.** Relatório de saídas, detalhamento, consumo por unidade, previsão, agenda e gráficos de atividade contam cada cadeia uma vez, pela versão atual (`effectiveMovementSql`). O histórico bruto continua íntegro.

## Migração 0038 (`drizzle/0038_material_movement_revisions.sql`)

- A migração só acrescenta: cinco tabelas, duas colunas nulas em `items` e gatilhos.
- Não altera nenhum saldo, movimento, contexto ou foto existente, nem os brindes do CONPEEX.
- Os gatilhos `item_primary_photo_guard` e `item_primary_photo_attachment_keep` foram recriados. A nova regra protege a foto principal atual e permite esconder uma foto principal antiga, desde que haja registro da exclusão.
- Os 100 Bottons reais lançados pelo Rolê em produção não foram tocados: o Yan decide se corrige pela tela.

## Testes

- `tests/material-movement-revisions.test.mjs` (11 cenários) cobre:
  - correção 100 → 150 e saldo;
  - desfazer, cadeia e lançamentos imutáveis;
  - idempotência e permissão, inclusive revogação no meio do lote;
  - saldo insuficiente e origem do Rolê;
  - destinos, relatórios sem contagem dupla, anexos, exclusão de foto e posse.
- Três testes antigos foram ajustados à nova regra de exclusão, que exige registro: `records`, `sync-attachments` e `material-primary-photo`.

## Contrato para o Rolê

`stock.move` aceita `destinationId` ou `destinationName` + `destinationKind`. As sugestões vêm de `GET /api/materials/destinations?projectId=`. A correção usa `stock.revise`. O contrato foi enviado à sessão do Rolê. O assistente ainda não envia destino nem correção: essa parte é dela.
