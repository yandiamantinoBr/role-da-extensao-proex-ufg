# Entrega V6 — portabilidade, planilha ligada e hospedagem própria

> **Produção:** <https://proex-gestao.vercel.app> (Vercel + Supabase, organização “PROEX UFG”). Guia: `apps/proex-portal/docs/HOSPEDAGEM-VERCEL.md`.

Data: 23/10/2026. Branch `feat/proex-v6-portabilidade`, construída sobre o checkpoint V5 (`feat/proex-v5`), que estava incompleto quando o Codex atingiu o limite de uso. A versão publicada no ChatGPT Sites continua sendo a V4 até uma nova publicação.

## O que mudou

| Pedido | Como ficou |
| --- | --- |
| Repositório no GitHub que faça o deploy | `.github/workflows/portal-deploy.yml` publica `apps/proex-portal` numa conta Cloudflare (Workers + D1 + R2) a cada merge na `main`. Ele cria o banco e o bucket, aplica só as migrações pendentes e grava os segredos. Sem segredos configurados, o fluxo apenas avisa. Guia: `apps/proex-portal/docs/HOSPEDAGEM-PROPRIA.md`. |
| Não depender da conta pessoal nem do ChatGPT | Em hospedagem própria (`PROEX_STANDALONE=1`), o Worker descarta cabeçalhos de identidade do Sites. O primeiro responsável é criado em `/configuracao-inicial` com `SETUP_TOKEN` + `OWNER_EMAIL` e só enquanto nunca houve responsável. O fluxo do Sites (`/acesso-inicial`) continua intacto. |
| Ligado a uma planilha Google | Conector Apps Script (`public/integracoes/proex-planilha.gs`), instalado na própria planilha e de qualquer conta Google. Menu PROEX: conectar, sincronizar agora, sincronização automática a cada 30 min e cópia de anexos. Usa o mesmo protocolo portátil, as mesmas abas e as mesmas bases do Codex, então a planilha existente é aproveitada. |
| Chave de acesso para a planilha | `sync_tokens` (migração 0006): chave `pxs_…` mostrada uma vez, só o hash é guardado, até 5 ativas por pessoa, validade de 1 ano, revogação imediata. A chave age como o responsável que a criou, e o papel é revalidado a cada chamada. Gestão em Configurações → Dados e sincronização. |
| Imagens no banco de dados | Fotos e termos continuam privados no R2 e são copiados pelo conector para a pasta privada “PROEX · Anexos privados” no Drive, com hash, tamanho e recibo conferidos pelo servidor. |
| Migrar para outro lugar | Backup completo (JSON) pelo portal; backup diário do D1 em `.sql` pelo GitHub (`portal-backup.yml`); importador `scripts/portable-import.mjs` que lê `.xlsx` (Google/Excel) ou JSON, valida contra as migrações reais e gera SQL idempotente. |
| Projetos internos e externos | Campo `scope` (`internal` = conduzido pela PROEX; `external` = unidade acadêmica, órgão ou parceiro), com formulário, abas de filtro com contagem, selo nos cartões, coluna editável na planilha e indicador no início. O acesso continua por projeto: um bolsista de projeto externo só vê o próprio projeto. |
| Visual e funcionalidade | Indicadores reais no destaque do início (projetos internos/externos, materiais com saldo baixo, empréstimos em atraso); subtítulo correto em cada módulo; painel de sincronização reorganizado em passos. |

## Verificação

- `pnpm check:types`: sem erros.
- `pnpm test`: 283 testes passando, incluindo os novos de configuração inicial, chaves de sincronização, importador (inclusive `.xlsx`) e abrangência. Também foram corrigidos três testes da V5 que falhavam (expectativa desatualizada e compatibilidade com Windows).
- `pnpm build` e `tests/password-auth-worker-smoke.mjs` (Worker compilado, incluindo MCP) passando.
- Portal local em modo hospedagem própria: configuração inicial, cabeçalhos forjados recusados em `/acesso-inicial`, `/api/account` e `/mcp`, chave inválida recusada no conector.
- `scripts/apps-script-harness.mjs` executou o `.gs` real contra o portal local: exportação de todas as tabelas, edição de célula aplicada com controle de versão, entrada de estoque pela aba Operações, conflito detectado e registrado, cópia de foto para o Drive com recibo aceito.
- Dados reais da planilha (10 projetos, 4 tipos, 10 links, 4 editais, 11 materiais) importados num banco local pelo importador.

## Revisão independente e correções (V6.1)

Uma revisão independente do código encontrou 16 pontos. Todos foram corrigidos:

- **Backup**: o backup do D1 só é gerado criptografado (`BACKUP_PASSPHRASE`), porque o repositório é público.
- **Conector**: a chave fica nas propriedades do usuário que conectou. A pasta de anexos é criada no Meu Drive e conferida contra compartilhamento. As execuções respeitam o limite de tempo do Apps Script. Cada aba grava sua própria base de comparação. As edições enviam a linha completa (campanhas exigem isso). Valores inválidos viram conflito com o conteúdo desejado, em vez de nulo silencioso. O retorno das operações é localizado pela chave. Uma linha inválida não trava as demais. Abas editadas durante a sincronização não são sobrescritas.
- **Importador**: linhas inválidas são listadas e nunca descartadas em silêncio. Campos omitidos por privacidade recebem um marcador de importação. Os saldos são recalculados pelos movimentos.
- **Deploy Cloudflare**: `PROEX_STANDALONE` também está no `wrangler.jsonc`. A ausência de R2 falha o deploy. Os segredos ficam visíveis só no passo de deploy.
- **Configuração inicial**: a credencial órfã é removida se o vínculo falhar, e o limite de tentativas é por IP.
- **Interface**: aviso sobre quem pode editar a planilha; o botão legado da rotina do Codex foi mantido.
- **Testes**: um teste de chave intermitente foi corrigido; há testes do adaptador Node (concorrência entre instâncias).

## O que ainda depende de ação humana

1. **Revisar e mesclar** a PR na `main`.
2. **Escolher a hospedagem**:
   - *Cloudflare própria*: criar a conta institucional e configurar os segredos no GitHub (guia `HOSPEDAGEM-PROPRIA.md`). Depois, importar a planilha atual com o importador.
   - *Continuar no Sites*: publicar esta revisão pelo fluxo do Sites (Codex). A migração 0006 é aditiva.
3. **Instalar o conector** na planilha `Gestão PROEX · Dados e sincronização` (Extensões → Apps Script) apontando para o portal que estiver com esta versão. A V4 publicada no Sites não tem `/api/sync/connector`.
4. Itens de negócio que continuam pendentes desde a V4: estoque real, composição dos kits, regras de “Tente novamente”/“Super Super Brinde”, aviso de privacidade, verificação de seguidores do Instagram (sem API pública adequada) e envio automático de e-mails.
