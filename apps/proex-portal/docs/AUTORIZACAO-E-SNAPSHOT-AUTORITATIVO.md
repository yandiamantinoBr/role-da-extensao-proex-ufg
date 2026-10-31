# Leituras autoritativas do SnapshotD1 — V17

Correção local sobre `aab2d2f`, branch `v17-autorizacao-fresca`, em 31/10/2026. Não altera produção, PostgreSQL, tabelas, migrações, formato de snapshot ou interfaces de permissões.

## Problema e reprodução

O adaptador Node/Vercel mantinha um TTL de leitura de 1.500 ms. Um SQL que consulta a concessão atual ainda podia ler o SQLite antigo desse processo, mesmo depois de outra instância publicar a revogação. A mesma janela afetava o resolvedor canônico de sessão e uma nova consulta de autorização depois de aguardar armazenamento/provedor.

`tests/snapshot-authority.test.mjs` usa dois SnapshotD1 reais, um store CAS sintético compartilhado, SQLite migrado, Better Auth/Drizzle reais, resolvedor canônico, relatórios e rota de anexo. O cache de A é aquecido, B confirma a alteração e só então A tenta ler. O TTL antigo recebe valor grande para impedir expiração acidental; não há sleeps ou relógio substituído.

Antes da correção, os seis testes iniciais falharam:

| Cenário | Resultado anterior | Resultado corrigido |
| --- | --- | --- |
| B revoga vínculo; A consulta `getActor` | A conservava o vínculo | A lê zero vínculos |
| B bloqueia conta; A resolve sessão | A autenticava a conta antiga | Conta bloqueada rejeitada |
| B apaga sessão SDK; A resolve cookie | Sessão ainda era aceita | Sessão nula |
| B revoga durante o await de objeto privado | Fence devolvia HTTP 200 e corpo | HTTP 403, sem devolver o corpo |
| Metadado remoto indisponível | A devolvia cache aquecido | A consulta falha, sem fallback privado |
| Cem leituras sem mudança | Zero consultas de versão | Cem consultas, zero downloads/commits |

Um sétimo caso verifica `reportRows` diretamente com o ator antigo: o SQL de escopo deve negar o projeto revogado mesmo sem atualizar previamente o objeto do ator.

## Decisão

Toda chamada de `execute`, incluindo SELECT, `first`, `all`, `raw`, `run` e batch, consulta `store.version()` antes de executar o SQL. Se a versão coincide, usa o SQLite já carregado. Se mudou, baixa/descompacta somente o snapshot novo. Se consultar a versão falha, não devolve autorização a partir da cópia antiga.

Não há parser de SQL ou exceções por nome de tabela para decidir se a autoridade precisa ser atualizada. O classificador SQL anterior continua apenas para metadados de resultado; ele não controla mais a consistência das leituras. O quarto argumento numérico do construtor permanece aceito por compatibilidade com ferramentas antigas, mas é ignorado e não reabilita TTL. `withSession()` continua usando a mesma consistência autoritativa.

O mecanismo de lock local, transação SQLite, retries por compare-and-set, recuperação de commit incerto e histórico de migrações permanece igual. Uma leitura sem alteração não chama `store.commit`, não gera uma gravação fictícia e não regrava o snapshot remoto. A aplicação inicial de migrações mantém o comportamento anterior.

Isso fornece um ponto de leitura autoritativo por execução/batch. Não cancela retroativamente uma leitura já iniciada nem cria uma transação distribuída sobre várias chamadas e awaits. A consulta final depois de um await passa a verificar novamente a versão, sem mudanças em cada serviço. Um batch de leituras compartilha uma única verificação e um único snapshot para aquele lote.

## Medição sintética

`scripts/benchmark-snapshot-authority.mjs` compara o código anterior de `aab2d2f` com o atual usando SQLite/gzip reais e dois adaptadores. O store de metadados/payload é em memória, sem rede ou credenciais. São mil projetos sintéticos, mil operações por cenário e um snapshot de 638.976 bytes, comprimido em 300.605 bytes na execução registrada.

| Cenário de A | Antes: version/load/commit | Depois: version/load/commit |
| --- | --- | --- |
| Mil SELECTs, versão igual | 0 / 0 / 0 | 1.000 / 0 / 0 |
| Mil batches de dois SELECTs, versão igual | 0 / 0 / 0 | 1.000 / 0 / 0 |
| Leitura após B revogar | 0 / 0 / 0; acesso indevido | 1 / 1 / 0; acesso negado |

A alteração de B produz o commit de revogação esperado; A não grava nada em nenhum dos cenários de leitura. Quando a versão não muda, nenhum byte de payload é baixado. Depois da alteração há um único download de 300.605 bytes, seguido de reutilização da versão conferida.

No ensaio local registrado, SELECT individual teve p50 de 0,068 → 0,069 ms e p95 de 0,115 → 0,120 ms. O batch teve p95 de 0,115 → 0,122 ms. **São medidas de CPU/SQLite com store em memória, não latência ou capacidade de produção.** Cada verificação acrescentará o RTT real da consulta leve de versão no backend. O custo pode ser reduzido agrupando leituras independentes em batches; não se deve voltar a usar TTL em autenticação/fences para ocultar esse custo.

A versão pertence ao snapshot inteiro: uma gravação de outra instância, mesmo em outra tabela, pode exigir baixar esse snapshot antes da próxima leitura. Carga com muitas gravações pode, portanto, custar mais rede/descompactação que o cenário estável medido. Este patch preserva o modelo existente e prioriza a autoridade atual; não transforma o snapshot em um banco remoto por linha.

## Verificação e integração

Os testes focados cobrem também CAS entre instâncias, rollback, aplicação única de migrações e recuperação após erro/resposta perdida de commit. Logs e JSON locais, ignorados pelo Git, estão em `.sites-runtime/snapshot-authority-before.log`, `snapshot-authority-after.log` e `snapshot-authority-benchmark.json`.

A suíte completa desta base passou em 527/527 casos no Node 24.22.1. Os 13 casos focados (sete novos e seis existentes de adaptador/persistência) passaram no Node 26.12.1. A verificação de tipos e o build Node passaram; lint terminou com zero erros e três avisos anteriores. A mudança é específica do adaptador Node; o D1 nativo do alvo Worker não foi alterado.

Comandos locais:

```text
pnpm exec node --test tests/snapshot-authority.test.mjs tests/platform-node.test.mjs
pnpm exec node scripts/benchmark-snapshot-authority.mjs
```

O coordenador integra este patch ao restante das frentes e confere checks/SHA final. Não foram alterados `portal-client.tsx`, telas de relatórios, provedores, banco remoto ou dados reais. Não houve navegação de interface nesta tarefa.
