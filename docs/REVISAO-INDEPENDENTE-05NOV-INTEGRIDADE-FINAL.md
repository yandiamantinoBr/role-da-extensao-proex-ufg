# Revisão de acompanhamento: correção do P2-1 (auditoria dos vínculos) e P2-2

**Conclusão:** o P2-1 está resolvido e não encontrei nenhum novo P0, P1 ou P2. Ficam só três observações P3, todas opcionais.

## Escopo e limites
- Li `lib/institutional-structure/service.ts` inteiro, `tests/institutional-structure.test.mjs` (linhas 6, 73–81 e 140–157), `.sites-runtime/security-final-result.json` e `lib/mutations.ts`.
- Para checar privacidade, conferi todas as consultas ao `audit` em `lib/` (`FROM/JOIN audit`): `portal-data.ts:240`, `users.ts:53`, `calendar.ts:115-130`, `privacy.ts` e as demais.
- Não executei testes nem shell, e não vi o `git diff`. A análise é do estado atual dos arquivos.
- **Não verifiquei concorrência real no D1 remoto.** O fixture executa o batch de forma síncrona sobre SQLite. Por isso, a ordem de `changes()` dentro do batch e o `meta.changes` só estão validados pela semântica do SQLite e pelo padrão que o projeto já usa.
- O modo de planejamento estava ativo, mas não havia ferramenta de escrita de plano. A entrega é só este relatório, sem nenhuma alteração.

## P2-1: verificado

**1. O registro de auditoria agora identifica o vínculo** (`service.ts:108`)
- Em `link.save`, o campo `details` grava `{version, kind, nodeId, teamId, linked}`.
- `nodeId` e `teamId` passam por `id()`, e `linked` já foi validado como booleano na linha `:92`.
- Para as demais ações, `details` continua só com `{version, kind}`. O teste `:81` confere esse formato exato para `node.save`, então não houve regressão.

**2. Reafirmar um vínculo já ativo não gera evento**
- O upsert da linha `:96` usa `DO UPDATE ... WHERE revoked_at IS NOT NULL`. Com o vínculo ativo, nada muda e `changes()` fica 0.
- Por isso, a atualização de versão com `AND changes()>0` (`:107`) não roda.
- A auditoria com `WHERE changes()>0` (`:108`) também não grava, porque lê o 0 dessa atualização.
- Testes `:144` e `:153`.

**3. Reativar um vínculo revogado gera um evento**
- O upsert altera 1 linha, a versão sobe e a auditoria grava `linked:true` com `version: before+1`.
- Testes `:150-151`.

**4. Privacidade**
- O registro só contém IDs internos opacos. Não há nomes de equipe ou unidade, e-mails nem contatos.
- Nenhum DTO passou a expor esses dados:
  - O resumo de atividade em `portal-data.ts:240` seleciona apenas `id, project_id, action, created_at`, sem `details` nem `entity_id`.
  - `users.ts:53` lê por `id` de `member.change`.
  - `calendar.ts` agrega por `entity_id`. O `entityId` de `link.save` é um `uid()` aleatório e não colide com empréstimos nem campanhas.
- O workspace (`:55`) continua expondo `links:{nodeId, teamId}`, como já fazia, com a mesma visibilidade filtrada (`visible_nodes` e `visible_teams`). Não há campo novo.
- Não encontrei rota de exportação que leia `audit.details` de ações `structure.*`.

**5. Testes pedidos**
- **Código do no-op:** `:146` e `:148` agora exigem `{status:409, code:'structure_unchanged'}`. Isso pega uma regressão para `structure_conflict`.
- **Chave desfeita no rollback:** em `:157`, um no-op rejeitado é seguido por uma intenção válida com a mesma `operationKey`, que retorna `duplicate:false` e incrementa a versão.
  - O comportamento está correto: `claimStatement` faz parte do batch desfeito. Como nenhuma linha ficou em `mutation_keys`, `find()` não dispara `operation_changed`, mesmo com fingerprint diferente (`mutations.ts:12`).
- **Repetição após resposta perdida:**
  - Na reativação (`:152`), retorna `duplicate:true` e a contagem de auditoria fica em 3.
  - Na reafirmação sem efeito (`:153`), retorna `duplicate:true` e a contagem também fica em 3.
  - Isso funciona porque `claimStatement` não é condicional: a chave é gravada mesmo quando a reafirmação não muda nada, e a repetição vai pelo caminho `existingId` (`:75`).
- **Três eventos true/false/true:** `:151` compara a sequência `{nodeId, teamId, linked}` em ordem de `rowid`.

**6. Sem regressões nos pontos verificados antes**
- A checagem de versão continua antes das guardas, então só um no-op genuíno recebe `structure_unchanged`.
- `results[length-2]` continua sendo a atualização de versão.
- A cerca de escopo segue como primeiro comando do batch, e `activeScope` roda depois do commit e também na repetição.
- O trigger de imutabilidade continua coberto em `:149`.

## P2-2: condicional, encerrado pela evidência do coordenador
Repasso o que o coordenador informou, sem ter verificado de forma independente:
- A 0029 continua sendo uma migration nova, ainda não mesclada.
- A produção canônica é o PR35, sem a 0029.
- Os bancos de QA efêmeros que aplicaram o rascunho da 0029 foram desligados e excluídos normalmente.
- Nenhuma migration persistente de produção foi editada.

Se tudo isso se confirmar, a condição do P2-2 (0029 já aplicada em algum ambiente) não ocorre, e não há P2 pendente. Antes do merge, vale um cuidado: conferir que nenhum D1 de preview ou local que vá continuar existindo registrou a 0029 em `d1_migrations`.

## Observações restantes (P3, não bloqueantes)
1. **A repetição de uma reafirmação sem efeito devolve um `entityId` sem rastro.** A resposta traz `duplicate:true` e um `uid()` que não aparece em nenhum registro de auditoria, e não traz `version`. É inofensivo e coerente com as outras repetições. Só é preciso que o cliente não espere `version` nas respostas com `duplicate:true`, o que já acontecia antes.
2. **O teste de chave desfeita cobre só `node.status`.** O desvínculo sem efeito usa o mesmo mecanismo (guarda mais rollback), mas não tem teste próprio com a mesma chave. A cobertura vem por transitividade.
3. **Não há teste do conjunto de chaves de `details` em `link.save`.** Um assert como o de `assistant.test.mjs:347`, conferindo que as chaves são exatamente `kind, linked, nodeId, teamId, version`, impediria que um nome ou contato fosse incluído por engano no futuro. Hoje o código não faz isso.

## Veredito
- **P0:** nenhum.
- **P1:** nenhum.
- **P2:** nenhum pendente. O P2-1 está corrigido e testado. O P2-2 fica encerrado com base na evidência do coordenador, que não verifiquei.
- **Não validado:** comportamento concorrente real no D1 remoto e semântica exata de `meta.changes` e `changes()` no D1 em produção.
