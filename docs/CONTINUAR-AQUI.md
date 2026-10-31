# Continuidade do Portal PROEX

Atualizado em 31/10/2026. Leia AGENTS.md, este guia e a matriz de requisitos. Confirme GitHub/Vercel e git status: checkpoints não são monitoração contínua. Push, PR, merge e deploy de todas as entregas estão permanentemente autorizados por Yan.

## Produção comprovada

- Site: https://proex-gestao.vercel.app/ . V12 na PR #12 e compatibilidade do backup na PR #13.
- SHA atual: 62761e65566e0621f498aae4953e99ff496c07dc. Vercel READY dpl_G5Dr1RFQuJjJxU4K7GbcQQNoF5Bp no mesmo SHA; PR/main aprovados. CI: 645/645 portal e 33/33 jogo na correção. Sessão, catálogo real, Demandas e sino conferidos após V12; asset de backup da correção corresponde ao código local.
- Health canônico 200; URLs geradas antigas V9/V10 retornam 403. Preview não tem credenciais de produção. Não operar o banco atual com código anterior à migração 0008.
- Demandas, prioridades, equipes sobrepostas, conferência por material/tamanho, pendências, sino e relatórios estão publicados. Concessão de tarefa não amplia ACL; conferência não movimenta estoque nem fecha empréstimo. WhatsApp é compartilhamento manual.
- E-mail MailApp e cadastro público estão implementados, mas DESATIVADOS. Remetente/autorizações, aviso aprovado e infraestrutura de envio ainda são gates reais. Não escolher uma conta por ausência de resposta.

## Backup e Sheets reais

- Primeiro formato 2 capturado em 31/10 às 13:19:05 BRT, releitura/ACK 13:19:11; 485.224 bytes. A cópia baixada do Drive privado tem o mesmo SHA-256 do recibo: f13c9a6678d956550b7789e9ee4b928892c1fccc8c3612a944563ed6c12ada50.
- Recuperação física isolada passou: snapshot 270, SQLite 1.183.744 bytes, 1 objeto / 416.503 bytes, 16 migrações, integridade/FK/hashes aprovados; réplica clara temporária removida. Provas privadas em apps/proex-portal/.sites-runtime/production-v12. Localizadores/chaves somente na Vault/AppData, nunca no Git público.
- Apps Script da planilha recebeu Code.gs atual e backup-automatico.gs, sem arquivo MailApp. Gatilho diário às 03h America/Sao_Paulo instalado e consulta confirmou 1 gatilho, recibo válido e nenhum pendente. A primeira execução pelo relógio ainda não aconteceu; não confundir com a captura manual comprovada pela rotina. Privada sob DPAPI local; custódia independente continua pendente.
- Drive real informa inherited=true na própria ACL única user/owner. Correção mantém dono atual, ACL única, pai privado exato e recusa qualquer acesso extra, sharedDrive, atalho ou paginação. Positivo reproduzido antes/depois e negativos/revisão passaram. Diagnóstico temporário retirado; pasta extra vazia criada por seleção incorreta foi movida à lixeira recuperável, pasta configurada preservada.
- Sheets pós-V12 conferido em 31/10 às 16:23:42.193Z: sincronização manual concluída, 34 tabelas / 152 linhas / zero conflitos. Inclui as cinco projeções somente leitura do acompanhamento. Um gatilho de dados e um de anexos preservados; execução automática anterior após V11 foi comprovada em 15:07:06.612Z. Última rodada de anexos não revalidou uma cópia anterior, sem novas falhas; não chamar isso de nova releitura.

## Trabalho atual, dono e próxima ação

Checkout coordenador: v13-coordenacao, base main 62761e6. Não descartar alterações; worktrees e node_modules são compartilhados por junction. Porta 5173 livre após QA final. CUA controla apenas tabs do agente; não usar Playwright externo.

1. mobile_responsivo: worktree v22, R09 novo dataset outflow_details (“Saídas rastreáveis”), mantendo resumo outflows. Ação/finalidade/operador só onde há fonte e acesso, texto livre opt-in, unidades separadas. Root deve acrescentar o dataset à disponibilidade na montagem.
2. revisao_organizacoes: worktree v22-document-ai, R10 IA opcional no importador existente; 0016 aditiva e modelo novo. Flag documentEnabled inicialmente false; mesmos provedores/configuração/quotas, evidência literal verificada, confiança não calibrada=null, prévia/seleção/confirmar/HMAC/CAS preservados. Root integra journal/snapshot/modelo; nenhum projeto fictício.
3. relatorios_datas: R11 diagnóstico explícito de conexão IA, APIs de metadados fixas sem geração/áudio e sem chamadas reais neste desenvolvimento. Novo AssistantConnectionPanel({orgId,revision}) deve ser montado por root só em configuração autorizada. Sem migração, coordenação com R10 em settings/admission.
4. Coordenador: registrar recibos Sheets e V12/backup na Vault/repo/oito chats; integrar commits R09/R10/R11 sem sobreposição, revisar contratos/segurança, testar tipos/lint/suíte/builds/CUA e publicar V13. Banco continua SQLite sobre snapshot CAS no Supabase; não portar SQL para Postgres.

## Evidências e limites

V12: suíte local 643/643 Node26 mais contrato posterior focado; CI 644/644. Correção Drive: CI 645/645, 22 focados, revisão independente. Tipos/lint sem erros (3 avisos antigos), Worker/Node builds passaram. Modelos de 82 tabelas e cadeia 0000–0015 coerentes; migrações ensaiadas no backup real V10 em RAM preservaram 49 tabelas. CUA 375/414/1250 sem overflow, evento→P/M/G com 1 avaria M→revisão alta, PDF/DOCX/XLSX reabertos e PDF renderizado. Build final também confirmou deep link e consentimento próprio persistido/retirado com envio desligado.

Smoke local de Sheets/conflitos e backup de 5,29 MB / 161 chunks com recuperação física passou. Benchmark público local: 100 pedidos, concorrência 10, zero erros, p95 14,47 ms; página de 50 demandas passou de 101 para 1 consulta de versão, zero recargas/commits estáveis. São medições sintéticas locais, não capacidade serverless ou latência Postgres.

Requisitos R01–R22 e achados A01–A28 continuam rastreados. Não declarar tudo concluído: política institucional/retensão, custódia independente, ativação de provedores/público, escolhas de catálogo e demais pendências são distintas de código pronto. R12 já oferece áudio→transcrição revisada→proposta/confirmar no assistente; não espalhar microfones sem necessidade. Nunca ler/imprimir .env/.dev.vars, arquivos de segredo ou valores de chaves.

Leia docs/COBERTURA-DE-REQUISITOS.md e docs/ENTREGA-V12.md. Histórico em docs/ANDAMENTO.md; Vault salva/relida localmente não comprova sincronização em nuvem.
