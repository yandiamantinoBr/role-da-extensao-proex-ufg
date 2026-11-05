# Revisão independente de segurança · PR36 · candidato anterior

Parecer somente leitura via Claude Code, revisão c2d0937. Não é aceite do código posterior nem do portal inteiro. Capturas usadas são sintéticas e não entram no repositório público. As limitações de inspeção fazem parte do parecer.

# Revisão independente: segurança, isolamento e concorrência (head c2d0937)

**Resultado: não encontrei P0, P1 ou P2 abertos.** Achei só itens P3: um de UX/semântica, dois de integridade de auditoria e um de defesa em profundidade. Nenhum deles mostra vazamento ou ampliação de ACL. Esta conclusão vale apenas para o que li (lista abaixo). Não executei nada.

## O que verifiquei, sem achados

- **ACL de escrita:** `structureAction` exige `authority(…, NULL, write)`, que só passa para quem é dono da organização, dentro e fora do batch (`service.ts:64,97`). Gerente de projeto, vínculo com equipe e delegação de IA não autorizam. Isso é testado em `institutional-structure.test.mjs:16-35`.
- **Vínculo com unidade não amplia ACL:** `institutional_team_links` só aparece no serviço, na migração e no schema (busca no repositório). Não é usado em `authority`, `my-work` nem `follow-up`.
- **Leitura de equipes por quem só lê o projeto** (`service.ts:26-30`): só mostra equipes de que a pessoa é membro ou atribuídas a tarefas do projeto sob `authority`. Isso bate com `follow-up/service.ts:52`, onde o detalhe da tarefa exige apenas `authority`. Não vi vazamento.
- **CAS/replay:**
  - A versão é conferida dentro do `db.batch`.
  - A `scope` da chave de operação usa ator + ação + chave. A impressão digital do payload inclui `organizationId` e `expectedVersion` (`mutations.ts:11`).
  - Um replay só devolve `duplicate` depois de checar `activeScope` de novo (`service.ts:68,100`).
  - Revogação após o commit impede o replay (teste `:127`).
- **SQL:** os valores de entrada são todos parametrizados. A ordem dos `?` em `activeScope`, `scopeStatement` e na leitura (5 parâmetros) está correta. `statusSql` e `countSelect` só interpolam valores de `choices` ou do relógio do servidor.
- **Triggers** (`0029:38-57`): cobrem ciclo, profundidade 8, limite de 200 nós e 500 vínculos, pai inativo, vínculo entre organizações e arquivamento com dependentes. O limite de profundidade do cliente (`institutional-structure-api.ts:17`) bate com o do servidor.
- **Resposta antiga:**
  - O servidor faz uma leitura dupla e compara (`service.ts:44-45`).
  - O resumo pessoal tira dois instantâneos com proveniência e compara os grants com `actor.members` (`summary.ts:49-57`).
  - No cliente, há geração/epoch + `AbortController` + chave de contexto (`institutional-structure-panel.tsx:38-66`, `personal-work-summary.tsx:22-36`). A exportação tem uma leitura final antes do download (`panel.tsx:77-80`), e a impressão digital ignora só `asOf`.
  - `portal-client.tsx:530` limpa a organização pessoal que não combina com o projeto escolhido. Se ainda assim passar, o servidor responde 403, ou seja, falha fechado.

## Achados (todos P3)

**P3-1. Edição comum durante a leitura parece perda de acesso** (`service.ts:45`)
- **Problema:** qualquer diferença entre as duas leituras retorna `403 structure_access_changed`. O cliente (`panel.tsx:52`) trata 401/403 como revogação: apaga os dados e mostra erro de acesso. Uma edição concorrente legítima vira, portanto, mensagem de "acesso mudou".
- **Tipo:** demonstrado por leitura do código. O teste `institutional-structure.test.mjs:96`, caso `node-edit`, fixa hoje o 403.
- **Correção:** quando as leituras divergirem, chamar `activeScope` de novo. Se ainda houver acesso, devolver `409 structure_changed`, e o cliente não deve limpar os dados num 409.
- **Teste:** caso `node-edit` esperando 409; caso `membership` continua esperando 403.

**P3-2. Operações sem efeito geram versão e auditoria** (`service.ts:82,87`)
- **Problema:** desvincular um par que não existe, ou mudar `node.status` para o status atual, incrementa a versão e grava auditoria `structure.*` sem nenhuma mudança real.
- **Tipo:** demonstrado por leitura; não há teste para isso.
- **Correção:** no batch, colocar um guarda que exige o vínculo ativo (para desvincular) ou `status!=?` (para status), seguindo o padrão `json_extract('[]',…)`. Se o guarda falhar, responder 409/404.
- **Teste:** desvincular duas vezes não deve mudar `version` nem a contagem de auditoria.

**P3-3. Reafirmar um vínculo sobrescreve a data original** (`service.ts:87`)
- **Problema:** `ON CONFLICT … DO UPDATE SET created_at=excluded.created_at` troca o `created_at` também quando o vínculo já estava ativo, e a data original se perde.
- **Correção:** usar `created_at=CASE WHEN institutional_team_links.revoked_at IS NULL THEN institutional_team_links.created_at ELSE excluded.created_at END`.
- **Teste:** reafirmar um vínculo ativo deve manter o `created_at`.

**P3-4. Mudança de organização de uma equipe não é bloqueada** (`0029:53-57`)
- **Tipo:** hipótese, não demonstrada.
- **Problema:** nenhuma trigger impede mudar `followup_teams.organization_id`, e não achei código que faça isso. Um vínculo ativo continuaria existindo entre organizações diferentes. A leitura já filtra por organização (`service.ts:27,36`), então não há vazamento.
- **Correção:** trigger `BEFORE UPDATE OF organization_id ON followup_teams` com `RAISE(ABORT)`.
- **Teste:** um UPDATE nativo deve falhar.

## O que não inspecionei

- `contracts.ts` inteiro (só os tipos e o template), `db/institutional-structure-schema.ts` e `drizzle/meta`.
- `meu-trabalho-panel.tsx` e `components/portal/my-work-api.ts` (`workApi`).
- A linha 782 de `portal-client.tsx` e o restante do arquivo além dos handlers citados.
- `lib/access.ts` (`getActor`), `organizationOwnerSql`/`memberProjectScopeSql` e `responsibilityRead`/`responsibilities/scope`.
- Os testes `personal-work-summary-ui`, `portal-scope-controls` e `portal-history` (li só os títulos dos testes de estrutura, de resumo e de exportação, e os corpos de `institutional-structure.test.mjs:1-135`).

Não verifiquei a CI70 nem a execução local dos 1185 testes. Não modifiquei arquivos e não criei arquivo de plano, porque as ferramentas permitidas eram só leitura.
