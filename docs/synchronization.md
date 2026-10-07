# Sincronizar Windows, GitHub e ChatGPT Sites

## Identificadores e escopo autorizados

- Site existente: `appgprj_6ac62af904348191af733a95a71534db` (público).
- GitHub público: `yandiamantinoBr/role-da-extensao-proex-ufg`, branch `main`.
- Computador: Book3Ultra; pasta `C:\Users\yan1n\Documents\ChatGPT\PROEX\Role_da_Extensao`.
- O usuário autorizou que todas as edições neste projeto sejam sincronizadas e publicadas nos dois endereços. Preserve o design e as funcionalidades; não recrie o Site nem troque o project_id.

## Windows ↔ GitHub

`scripts/sync-windows.ps1` roda em uma tarefa do Agendador do Windows, a cada 2 minutos e ao entrar no sistema. Ela:

1. Confere o repositório e a branch, espera arquivos recentemente editados terminarem de ser salvos e registra as mudanças locais.
2. Busca `origin/main`, avança a cópia local ou faz uma mesclagem normal quando há edições independentes.
3. Publica os commits locais. Nunca usa force-push. Se houver conflito, aborta apenas a tentativa de mesclagem, preserva os commits de ambos os lados e registra o erro.

Para reinstalar a tarefa: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-sync-windows.ps1`. Para diagnóstico: `.sync/sync.log`, `.sync/last-success.txt` e `Get-ScheduledTaskInfo -TaskName 'Role da Extensao - sincronizar GitHub'`.

## Sites ↔ GitHub (ChatGPT e tarefa na nuvem)

Use os conectores nativos Sites e GitHub. Não salve tokens no código ou em arquivos, não copie o histórico privado do Sites para o GitHub e não dependa do computador Windows estar ligado. O último commit privado com mensagem `GitHub sync: <SHA completo>` registra o commit público cuja árvore de arquivos foi verificada como igual.

1. Leia o Site pelo ID acima e abra seu checkout com o helper de `sites-hosting`, credencial nova e sem archivePath. Preserve o resultado de abertura. Leia `main` pelo conector GitHub; se qualquer acesso necessário estiver bloqueado, informe o impedimento e não declare sincronização.
2. Dentro do checkout limpo, execute `node scripts/sync-github-source.mjs plan`. O script busca o repositório público sem credenciais e calcula uma mesclagem de três vias entre a referência pública anteriormente sincronizada, o GitHub atual e a árvore do Sites. Não publica nada. Conflitos devem ser informados, sem sobrescrever arquivos ou fazer force-push.
3. Se `needsGitHub` e `needsSites` forem falsos, não há arquivos novos a publicar. Se o GitHub avançou mantendo a mesma árvore, pode registrar a nova referência com `mark` e publicar a referência privada quando necessário. Não crie commits públicos sem mudanças.
4. Quando há arquivos novos, execute `node scripts/sync-github-source.mjs apply`. Para enviar mudanças ao GitHub, execute `export`: o arquivo ignorado `.sync/github-export.json` contém a árvore completa em base64 e o parentSha esperado. Verifique que não há credenciais ou arquivos privados.
5. Use `github_create_blob` para os blobs ainda ausentes no GitHub (ou reenvie-os idempotentemente), `github_create_tree` SEM base_tree_sha com todas as entradas, e `github_create_commit` com parent_sha igual ao publicHead do plano. `github_update_ref` deve atualizar somente `main`, sem force, depois de conferir novamente o HEAD. Se houve novo push, recalcule o plano em vez de sobrescrevê-lo. O tree_sha retornado deve coincidir com mergedTree.
6. Após leitura de confirmação do commit público, execute `node scripts/sync-github-source.mjs mark <SHA público confirmado>`. Isso verifica igualdade das árvores e registra a referência no histórico privado. Rode TypeScript e os builds necessários; publique no MESMO Site pelo helper de Sites, usando a abertura, SHA enviado e arquivo de build retornados. Salve a versão e implante para a audiência pública. Confirme o status nativo de sucesso. O workflow GitHub Pages dispara pelo push.
7. Em edições solicitadas no chat, conclua essa mesma sincronização durante o atendimento. A tarefa horária cobre edições feitas fora do chat ou atualizações locais posteriores. Se o Windows estiver online, a tarefa local traz o código publicado; para confirmar imediatamente, execute o script remoto autorizado e leia seu resultado.

O script cria commits intermediários para calcular a mesclagem com apenas ancestrais públicos. A publicação GitHub pelo conector também usa apenas o histórico público. Os commits finais Sites e GitHub podem ter SHAs diferentes; a igualdade é verificada pela árvore dos arquivos.

## Verificação e limites

- Rode `git diff --check`, TypeScript sem emissão e os builds alterados.
- Verifique os confetes em Brinde/Super Brinde, nas duas dinâmicas, com a opção ligada e desligada; a configuração explícita dos confetes funciona mesmo quando o aparelho prefere reduzir movimento.
- Preserve sons, resultados, probabilidades, duração e as marcas. O GitHub Pages precisa do base path do repositório e dos assets relativos.
- A sincronização automática não substitui a resolução de conflitos entre edições incompatíveis. Preserve ambos os lados e informe o usuário quando houver um conflito.
- Computador desligado/sem conexão: nuvem e Pages continuam funcionando; a cópia Windows atualiza quando voltar. A tarefa na nuvem roda a cada hora e o Pages precisa concluir seu build após um push.
