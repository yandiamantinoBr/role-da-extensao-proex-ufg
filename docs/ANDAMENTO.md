# Continuidade da execução · 31/10/2026

Leia `AGENTS.md` e `REQUISITOS-E-CONTINUIDADE.md`. Push/PR/merge/deploy de todas as versões do Portal PROEX estão autorizados por Yan. Não solicite novamente essa autorização. Não publique dados privados ou segredos.

## Estado conferido

- Produção V9: PR #8, merge `c19b6439cc17d904ff9c183b86291f8faf7d6cfc`, Vercel READY `dpl_cc1uw8tRxd7PgL4jZcDzAvtTDtUQ`, health/cabeçalhos/visão geral/relatórios autenticados/XLSX conferidos. Veja `ENTREGA-V9.md`.
- Checkout coordenador: `v10-coordenacao`, na pasta `C:/Users/yan1n/Documents/Projetos/role-da-extensao-proex-ufg`. `git status` é a fonte para alterações ainda não commitadas.
- Integrados: autorização `e44423e`, acessos `ef22cb3`, sync `cf2b6f6`, importações `0241650` + `df0eb9b`, backup `896b199`. Relatórios PDF/DOCX/saídas e montagem da importação estão no trabalho do coordenador.
- Gates locais integrados: 408/408 testes Node26; tipos e lint sem erros (3 avisos), builds Worker/Node; QA HTTP autenticado/conector e backup de 5.278.357 bytes com recuperação isolada/hashes passaram. Paginação PDF/DOCX renderizada e corrigida; repetição focada17/17 passou após ajuste. Não confundir com backup/recuperação real da produção.
- Planilha global agora privada, owner-only, conferida pela API. Cópia privada anterior à reconexão preservada. URLs/IDs privados e capturas estão na Vault e em `.sites-runtime`, fora do Git público. Última sincronização real confirmada segue25/10; instalação do script/gatilhos e execução automática ainda pendentes. Nunca dizer “sempre sincronizado” sem mecanismo e prova.
- As oito conversas de frentes receberam e concluíram o recebimento da atualização em31/10. Não disparar edições duplicadas no checkout coordenador.

## Trabalho delegado ainda não integrado

- `v11-organizacoes`, worktree `../proex-worktrees/v10-acessos`: migração0008, isolamento de organizações e administração. Revisão independente encontrou recuperação idempotente devolvendo projeto após revogação e catálogo de organizações em ator antigo; correções em andamento. Não publicar antes da revisão e recuperação real do backup. Não confundir organizações com unidades do catálogo UFG.
- `v12-assistente`, worktree `../proex-worktrees/v10-importacoes`: commit `e6ef8c7`, IA/ditado, migração0009 **após0008**, 17 testes e builds aprovados. Montar AssistantPanel. DelegaçãoTI/STTupload ainda parciais; configuração atual só owner da plataforma. Não integrar antes0008. Não enviar documentos reais para IA como QA.
- `v12-equipe-oficial`, worktree `../proex-worktrees/v10-sincronizacao`: catálogo oficial31pessoas,30prefills válidos, uma inconsistência de domínio mantida/desabilitada; componente e TeamPanel em finalização. Root monta Directory+estado. Nenhum convite real deve ser enviado em testes.

## Próximos passos obrigatórios

1. Concluir montagem/revisão e testes do incremento pré0008; publicar PR/merge, conferir SHA Vercel e fluxos autenticados/PDF/DOCX/importação no navegador, incluindo375/414px.
2. Gerar backup completo real e comprovar validação/restauração isolada antes0008. Bitwarden CLI está locked e BWS sem token: não ler valores ou arquivos de autenticação para contornar. Preparar resultado concreto antes de solicitar eventual entrada humana da frase recuperável. Nunca salvá-la na Vault/repo/logs.
3. Atualizar o Apps Script existente com fonte revisada, manter propriedades secretas opacas, verificar destino Vercel, fazer reconexão/sync real preservando legados/conflitos, instalar e verificar execução automática. Não usar plugin PROEX para escrever: destino dele ainda é legado Sites.
4. Após gates acima, integrar0008 e só depois0009; montar organizações e assistente, aplicar privilégio mínimo e testar trocas deIDs/revogação/contasA-B.
5. Continuar TODOS R01–R16 e A01–A28. Patrimônio estruturado, delegaçãoTI, STTupload, público, retenção/privacidade e backup externo recorrente não estão concluídos por um plano/mock/download.
6. Manter Vault Contexto/Plano/Registro e relatório de entrega com implementação/testes/publicação/prova separados. Preservar histórico. Atualização local da Vault não comprova nuvem.

Não executar SINCRONIZAR.cmd, reset/clean/restore destrutivos, env pull ou leitura de segredos. Não alterar Kino. Node24.22.1 já está no runtime empacotado; dependências novas desta entrega pinadas pdf-lib1.17.1/fontkit1.1.1/pdfjs6.4.299, sem chamadas pagas de IA.
