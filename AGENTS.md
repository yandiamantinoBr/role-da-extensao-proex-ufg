# Portal PROEX: instruções para agentes

Fale em português simples. Confirme a autorização da conversa antes de ampliar o escopo. Preserve o trabalho existente; nunca use comandos que descartem alterações.

## Contexto

Antes de agir, leia `C:/Users/yan1n/Documents/Vault Yan/AGENTS.md`, `00 Início.md` e, em `20 Áreas/Trabalho/PROEX/Portal PROEX/`, as notas `Portal PROEX.md`, `Portal PROEX - Decisões.md`, `Portal PROEX - Plano.md` e `Portal PROEX - Auditoria.md`. O roteiro está em `Portal PROEX - Prompt para o Codex.md`. Decisões têm precedência sobre contexto e plano; confira a revisão do código descrita nas notas. Instruções explícitas da conversa têm precedência.

## Desenvolvimento

Autorização vigente de Yan em 2026-10-31: push, PR, merge e deploy da V9 e das próximas versões do Portal PROEX estão autorizados. Execute os testes, confira a revisão em produção e registre os resultados sem pedir essa autorização novamente. O escopo completo e os critérios de continuidade estão em `docs/REQUISITOS-E-CONTINUIDADE.md` e na Vault. Os limites anteriores de publicação ficam superados por essa decisão; segredo, isolamento de acesso e preservação de dados continuam obrigatórios.

- O portal fica em `apps/proex-portal`; a raiz preserva o jogo livre. Execute comandos na aplicação correta.
- Use `npx --yes pnpm@11.25.0 install --frozen-lockfile`, sem instalar dependências novas fora do escopo autorizado.
- No portal: `npx --yes pnpm@11.25.0 check:types`, `lint`, `test`, `build` e `build:node`. Rode as verificações adequadas à mudança; `build` e `build:node` geram saídas diferentes.
- A hospedagem atual é Vercel + Supabase. O banco da aplicação continua SQLite, persistido por instantâneos com versão; não porte o SQL para Postgres. Preserve as migrações já aplicadas.
- A porta local é 5173 e também é usada pelo jogo da raiz. Encerre somente processos identificados do portal. Valide layouts em 375 px e em janela de aproximadamente 1250 px, com conteúdo de aproximadamente 950 px; prefira container queries.
- Windows: preserve `core.symlinks=false` e use junctions quando necessário. Não execute os scripts Linux nem `SINCRONIZAR.cmd`; não crie `.sites-runtime/execution-profile.json`.

## Limites

- Repositório público: nenhum segredo, dado pessoal, termo ou assinatura real em código, testes, capturas ou logs. Use dados sintéticos.
- Não leia nem imprima valores de `.dev.vars`, `.env*`, `~/.codex/auth*`, `~/.claude`, `.obsidian/` ou `proex-secrets.env`. Não use `vercel env pull`, `bws secret list`, `bws secret get` nem comandos que imprimam todo o ambiente. O exemplo de ambiente contém somente nomes, sem valores.
- A publicação do Portal PROEX está autorizada conforme o parágrafo acima. Alterações de provedor/Sheets/Drive devem servir ao pedido vigente, preservar acesso mínimo e ser verificadas; não reative workflows legados nem execute rotinas de outro destino. Uma autorização existente não precisa ser pedida novamente.
- Atualize a Vault somente no escopo autorizado e segundo o AGENTS dela. Registre resultados comprovados, pendências e a revisão testada; nunca confunda código local com publicação.
