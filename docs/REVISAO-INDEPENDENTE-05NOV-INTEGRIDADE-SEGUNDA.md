# Revisão de segurança e integridade do delta (somente leitura): `lib/institutional-structure/service.ts`, `drizzle/0029`, `drizzle/0014` e testes

**Resumo:** não há P0 nem P1. Os pontos centrais do delta estão corretos: reafirmação, reativação, no-op real, troca do trigger, rollback, parâmetros vinculados, recibo de versão, repetição idempotente e cerca final. Ficam dois P2, um deles condicional, e alguns P3, principalmente sobre trilha de auditoria e cobertura de testes.

O adaptador D1 de teste é o objeto `db` em `tests/support/work-teams-fixture.mjs:34`. `tests/support/d1-native.mjs` não existe.

## O que foi conferido e está correto

- **Reafirmação de vínculo ativo** (`service.ts:96`): o `ON CONFLICT ... DO UPDATE ... WHERE revoked_at IS NOT NULL` não altera nada quando o vínculo já está ativo, e `changes()` fica 0.
  - Com isso, a atualização de versão com `AND changes()>0` (`:107`) não roda.
  - A auditoria com `WHERE changes()>0` (`:108`) também não grava, porque passa a ler o 0 da atualização de versão.
  - A data de criação, a versão e a contagem de auditoria ficam preservadas. O teste `:144` confirma os três.
- **Reativação:** os valores do `SET` são avaliados sobre a linha antiga. Então o `CASE` usa o `revoked_at` antigo, que não é nulo, e grava `excluded.created_at`, ou seja, a data nova. O teste `:150` confirma.
- **Ordem de `changes()` no batch:** quando `linked:true`, o comando logo antes da atualização de versão é o upsert. Os comandos `SELECT` de guarda não mexem em `changes()`, e o que os triggers alteram não entra na contagem externa. Esse padrão já é usado em mais 4 arquivos de `lib/`.
- **Recibo de versão:** `results[statements.length-2]` é de fato a atualização de versão, e o último comando é a auditoria. A resposta `revision+(applied?1:0)` é coerente, porque a checagem de versão (CAS) na linha `:106` roda na mesma transação.
- **No-op real:** as guardas de status (`:89`) e de desvínculo (`:95`) disparam `structure_no_change`, que vira `structure_unchanged` com 409 (`:63`).
  - A checagem de versão roda antes dessas guardas. Assim, uma requisição com versão desatualizada recebe `structure_conflict`, e só um no-op genuíno recebe `structure_unchanged`. Não há falso conflito de concorrência.
- **Rollback atômico:** quando uma guarda falha, o batch inteiro é desfeito, inclusive o registro da chave de operação.
  - Em seguida, `recover()` não encontra a chave, relança o erro e `translate` o converte corretamente.
  - A ordem de `translate` (autoridade, depois no-change, depois versão) não gera ambiguidade, porque o batch para no primeiro erro.
- **Repetição após resposta perdida:** se a operação já foi confirmada, o reenvio pela linha `:75` devolve `duplicate:true`.
  - Se os dois envios chegam ao mesmo tempo, o segundo falha na checagem de versão, `recover` encontra a chave e devolve `duplicate`.
- **Parâmetros vinculados:** todos os valores usam `bind`. As interpolações de SQL são só constantes (`adapted`, uma condição derivada de `action`, que vem de lista fechada) e fragmentos internos de `authority()`.
- **Cerca de acesso e corridas:** `scopeStatement` é o primeiro comando do batch, então uma revogação antes do commit resulta em 403 sem gravar nada.
  - Depois do commit, `activeScope` (`:111`) esconde o recibo, mas não desfaz a gravação. Isso está documentado no teste `:132-134`.
  - Na leitura, a dupla consulta (`:44-50`) separa mudança de acesso (403) de mudança de conteúdo (409), sem nenhum `await` depois do último snapshot.
- **Trigger:** `followup_team_scope_update` (`0014:96`) bloqueia qualquer `UPDATE OF organization_id`, até com o mesmo valor. A 0029 não tem mais um trigger redundante, e o teste `:149` cobre esse caso.

## P2

**P2-1 — Não dá para reconstruir o histórico dos vínculos.** Evidências:
- Em `link.save`, o `entityId` é um `uid()` aleatório (`:76`).
- A auditoria grava só `{version, kind}` (`:108`).
- A reativação sobrescreve `created_at` e limpa `revoked_at` (`:96`).

Resultado: não é possível saber qual equipe foi vinculada ou desvinculada de qual unidade, nem quando aconteceram vínculos anteriores.

Correção: incluir `nodeId`, `teamId` e `linked` em `details`, ou usar um `entityId` determinístico como `${nodeId}:${teamId}`. Outra opção é uma tabela de eventos de vínculo só de inserção.

**P2-2 (condicional) — Migration 0029 editada no lugar.** O git status mostra `drizzle/0029_institutional_structure.sql` modificado.
- Se a 0029 já foi aplicada em algum D1 (local, preview ou produção), a edição não roda de novo e os ambientes divergem.
- Neste caso a divergência é funcionalmente inofensiva, porque o trigger removido duplicava o da 0014. Mas não consigo ver o diff completo para confirmar que essa foi a única mudança.

Correção: confirmar que a 0029 nunca foi aplicada. Se foi, criar uma 0030 com `DROP TRIGGER IF EXISTS ...`.

## P3

1. **Testes não verificam o código do erro** (`tests/...:146` e `:148`): só checam `{status:409}`. Uma regressão para `structure_conflict` passaria despercebida. Use `{status:409, code:'structure_unchanged'}`. Também faltam testes para:
   - reenvio com a mesma `operationKey` depois de um no-op com 409 (deve funcionar, porque a chave foi desfeita);
   - repetição da reafirmação após resposta perdida;
   - presença de auditoria na reativação.
2. **A resposta da reafirmação não indica que nada mudou** (`:112`): devolve `duplicate:false` com a versão sem incremento. O cliente só percebe comparando versões. Sugiro um campo `unchanged:true`. A assimetria (reafirmar dá 200, desvincular algo já desvinculado dá 409) parece intencional, mas não está explícita no contrato.
3. **Reafirmar quando a equipe ou unidade foi arquivada dá erro:** o `BEFORE INSERT` (`0029:49-50`) também dispara no upsert. Reafirmar um vínculo ativo com equipe ou unidade arquivada retorna `structure_relationship` 409 em vez de no-op. É aceitável, desde que seja intencional.
4. **Inconsistência na política de no-op:** `node.save` e `source.save` com valores idênticos ainda incrementam a versão e gravam auditoria.
5. **`CASE` redundante** (`:96`): por causa do `WHERE revoked_at IS NOT NULL`, ele sempre resulta em `excluded.created_at`. Pode ser simplificado.
6. **Fidelidade do adaptador de teste:** o fixture usa `BEGIN` deferido e executa de forma síncrona. O teste "concurrent writes" (`:121-123`) na prática roda em sequência e não prova concorrência no D1. O `meta.changes` vem de `SELECT changes()` e só aproxima o D1.
7. **Interface:** nenhum cliente diferencia `structure_unchanged` de `structure_conflict` (busca sem resultados). Hoje só a mensagem do servidor muda.

## Limites desta revisão

- Não executei shell nem testes, e não vi o `git diff`. A análise é sobre o estado atual dos arquivos, sem comparar linha a linha com a versão anterior.
- Não conferi o comportamento real do D1 (persistência de `changes()` entre comandos do batch, semântica de `meta.changes`, isolamento entre requisições concorrentes). Me apoiei na semântica do SQLite e no padrão que o projeto já usa.
- Não sei se a 0029 já foi aplicada em algum ambiente.
- Não li `organizationOwnerSql`, `memberProjectScopeSql`, `contracts.ts` nem as rotas HTTP que chamam o serviço, além das linhas citadas.
- Não li arquivos de ambiente, autenticação ou externos.
- O modo de planejamento estava ativo, mas não havia ferramenta de escrita do arquivo de plano disponível. Por isso a entrega é este relatório, sem nenhuma alteração no repositório.
