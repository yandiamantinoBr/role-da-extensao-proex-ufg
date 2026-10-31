# Checkpoint atual · V15 publicada e conferida

[PR #16](https://github.com/yandiamantinoBr/role-da-extensao-proex-ufg/pull/16), candidato fdc2faf, merge funcional 737a14b. Vercel produção dpl_5dsBCaCtGYdqMS6VS26xvzEoYqxd READY no mesmo SHA; CI com 827 testes do portal e 33 do jogo, sem falhas. Revisão independente do incremento: 9,1/10. Sessão, Meu trabalho, material/gestão, Demandas, sino e 320/375 px conferidos em produção; health 200 e hosts antigos 403.

Sheets canônico: 35 tabelas, 170 linhas/zero conflitos às 20:54:33Z e nova conclusão com 173/zero às 21:07:10Z. Backup de 493.313 bytes, SHA-256 93b5a54e…, recuperado em RAM: 86 tabelas, 18 migrações, integridade/FKs/objetos aprovados. Provas em [ENTREGA-V15.md](ENTREGA-V15.md). R21 OFF; custódia externa/primeira execução diária ainda pendentes. Um MCP conectado retornou 27 tabelas/histórico antigo: revalidar a origem antes de usá-lo.

Ler [CONTINUAR-AQUI.md](CONTINUAR-AQUI.md) e a [matriz](COBERTURA-DE-REQUISITOS.md). As seções seguintes são históricas. Publicação/configuração não ativam provedores opcionais.

# Histórico · V13 publicada em 31/10/2026

PR #14, revisão funcional d069c7f, Vercel READY no mesmo SHA. 726/726 testes do portal e 33/33 do jogo no CI; sessão/relatório/Demandas/isolamento conferidos em produção. Sheets automático 34 tabelas/153 linhas/zero conflitos em 16:37:03Z. Primeiro backup RSA real recuperado e gatilho diário instalado; primeira execução pelo relógio e custódia externa continuam pendentes. Remetente/IA/público não foram ativados implicitamente. Guia curto em [CONTINUAR-AQUI.md](CONTINUAR-AQUI.md), requisitos em [COBERTURA-DE-REQUISITOS.md](COBERTURA-DE-REQUISITOS.md) e provas em [ENTREGA-V13.md](ENTREGA-V13.md). Abaixo, histórico preservado.

# Continuidade da execução · 31/10/2026

**Resumo para retomar:** `CONTINUAR-AQUI.md` concentra o estado atual, agentes e próximos passos. As seções abaixo preservam a trilha histórica.

Leia `AGENTS.md` e `REQUISITOS-E-CONTINUIDADE.md`. Push/PR/merge/deploy de todas as versões do Portal PROEX estão autorizados por Yan. Não solicite novamente essa autorização. Não publique dados privados ou segredos.

## Estado mais recente · V11 publicada

Produção V11, PR #10, merge `55bf5f7962ae7862c4a00cbce538179a79f99642`; Vercel READY `dpl_G2MRkbXCSBtPQEtG63p4B3PuvfLm` no mesmo SHA. GitHub/main aprovado. Sessão real, organizações, 11 materiais, PDF/DOCX válidos e health200 conferidos; sem registros de QA ou chamadas pagas. Checkout coordenador agora `v12-coordenacao`, baseado nesse merge. 520 testes Node24/26, tipos/lint/builds e CUA375/414/1250 passaram; migrações no backup real offline preservaram49tabelas. Veja `ENTREGA-V11.md`. WAF bloqueia URLs geradas antigas; não voltar para código anteriorà0008 com banco novo. Sheets/anexos tiveram primeiras execuções automáticas confirmadas em31/10.

Novos requisitos R17–R22 salvos na Vault e no espelho público: acompanhamento/prioridades/checklists, equipes, inbox/sino, e-mail e WhatsApp. Agente `revisao_organizacoes` em worktree `v16-acompanhamento`, migração 0014. Público 0012 com `mobile_responsivo`; backup recorrente 0013 com `relatorios_datas`. Não iniciar edições concorrentes ou confundir trabalho delegado com publicação. As seções anteriores abaixo são histórico e não substituem este estado.

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


## Estado posterior à V10 publicada

- Produção: PR #9, merge `11dbebf`, Vercel READY `dpl_7BsFKBxE5USsAHSm89Zq9tJetdZH`. Relatórios reais PDF/Word e health conferidos. Candidato final 448/448 Node24, tipos/lint/builds/CI aprovados, CUA375/414/1250.
- Backup REAL completo recuperado fisicamente e hashes conferidos; cópia criptografada Drive privada relida idêntica. Localizador da chave DPAPI e recuperação sem imprimir valores estão na Vault. A chave não está no repo; Bitwarden e backup recorrente ainda pendentes.
- Sheets real: completed2026-10-31T14:21:21.016Z, 141 linhas/28 tabelas/0 conflitos; script31/10 e destino Vercel comprovados. Ativação de dados30min/anexos1h executada; instalação e execução automática posterior ainda sendo conferidas.
- WAF do projeto: `rule_proex_canonical_host_isolation_7Qp7ju`, host diferente do canonical → deny; ativo e conferido após propagação. Canonical200, URLs V10/V9 403. Previews têm apenas Corepack, sem banco/auth de produção. **Não publique 0008 se esse isolamento regredir, nem faça rollback para código anterior à 0008 com banco novo.**
- Checkout coordenador agora `v11-coordenacao`, baseado no merge V10. Integrados localmente: org15ff698 (b59 resolvido1bb), UI154a5ac (b98), IA d363cb1 (5a), import org c071286 (841), patrimônio1bf39e4 (85), mapper6678d5f (3fc). Ainda SEM push/deploy da 0008. Falta montar PortalClient/MaterialDrawer, integrar 0011 IA/STT final e compatibilidade backup, reconciliar journal/Drizzle, executar gates e CUA integrado.
- IA/STT/TI por org em worktree v10-importacoes, branch v12-assistente-organizacoes: revisão independente fechou corrida de cota e gravação de plano após revogação; aguarda hash final. Nenhuma chamada paga/conexão real foi realizada. Checar microphone=(self) ao integrar voz.
- Público opcional A05 em branch v14-acesso-publico (worktree v10-acessos), migração0012 reservada; desativado até configuração/aviso/envio verificados. Não foi publicado. Não enviar e-mails reais como QA.
- QA local anterior24999 foi encerrado por processos identificados, mas revisão automática recusou exclusão de sua pasta sintética; preservada. QA44864 foi encerrado por stdin `parar` e sua limpeza normal passou. Scripts/chaves/capturas reais estão em `.sites-runtime` e AppData, ignorados. Não publicar esses arquivos.

## Integração local posterior à V11 · 31/10

Acesso público opcional `933b164` integrado como `d49834e` em `v12-coordenacao`, ainda não publicado. Painel administrativo montado em Configurações, separado de convites da equipe. Modo inicial fechado; aviso aprovado, remetente e verificação de domínio continuam requisitos de ativação. Nenhum email real foi enviado. Revisão independente executou17testes específicos com SDK/SQLite reais; suíte integrada537/537 passou. Depois da reconciliação do modelo,19/19 focados em Node24 e tipos/lint focados passaram. Snapshot0012 tem62tabelas e diffzero com modelo.

A verificação de metadados detectou substituição indevida de delivered_at na tabela histórica entitlements, embora SQL runtime permanecesse intacto. Corrigido antes de publicação, preservando provider_accepted_at apenas no desafio público. Novo teste compara tabelas/colunas/tipos/nullabilidade/FKs do modelo contra migrações reais e exige journal/cadeia completos e diffzero. Não alterar migrações já publicadas para resolver divergência do modelo.

Nova revisão delegada a mobile_responsivo, branch/worktree v17-autorizacao-fresca, base aab2d2f: reproduzir com duas instâncias SnapshotD1 a janela de cache1500ms após revogação/bloqueio/sessão e corrigir leituras de autorização sem regravar snapshots por GET. Medir version/load/commit e preservar leituras públicas eficientes. Resultado é gate antes das próximas publicações. Backup0013 e acompanhamento0014 continuam com agentes respectivos; nenhum outro agente edita portal-client ou relatórios.

### CUA integrado do público e sincronização pós-V11

Build Node/Worker do candidato público passou. CUA do build revelou erros de navegação/prefetch RSC no navegador integrado, ausentes da fixture que substituía adaptadores Next. O fluxo de cadastro/login passou a usar anchors nativos e navegação completa ao sair, preservando o padrão já usado no login. Chrome confirmou login → link público → modo fechado sem formulário → acesso da equipe → login real → Configurações. Prontidão impede abrir cadastro sem aviso/provedor; configuração desabilitada foi salva/relida sem email. Tela pública375px sem overflow. Nenhum erro do portal no Chrome; foi observado erro independente de extensão do navegador, fora do código do portal. Capturas sintéticas em .sites-runtime/v12-evidence. Não confundir esse teste fechado com envio/cadastro público real ativo.

Após publicaçãoV11, novo gatilho do Sheets completou12:07:06.612 BRT (15:07Z),146linhas/29tabelas/0conflitos. A nova aba organizations e recibos no portal/planilha foram conferidos; cópia de anexos segue1confirmada/0falhas. Isso comprova compatibilidade da mudança de organização com a sincronização real nesse instante.

Backup automático612bc090e23524f4541d7ae3c230cb8b5cb14db6 recebeu revisão independente root: crypto híbrido/RSA/AAD/keyId, autorização/ticket/fences, configsession-only, limites, privacidade, DriveACL/readback e contratoGETBearer/POSTsessão.36/36 testes focados independentes passaram. Streaming semContent-Length e >6MiB com hash íntegro. Integração, metadados0013, configuração/cópia/restore real ainda pendentes. Nova frente0015MailApp delegada em paralelo, dependente de0014; envio realOFF enquanto conta/OAuth não definidos.

### Checkpoint integrado · 31/10/2026, 12h30 BRT

Rootv12-coordenacao em63b6037 mais relatórios locais. Acesso público d49834e+568abf9+0ca4176, backuprecorrente e5f7c3d+a54d8fa, backendacompanhamentoeec4156+56d8128, leituraautoritativa63b6037 integrados. Modelos agora db/schema.ts reexporta db/base-schema.ts e db/follow-up-schema.ts sem ciclos; 0014snapshot76tabelas/journal completos e diffzero. Nenhum SQLjápublicado alterado.582/582 testes integrados Node26 passaram,19focadosNode24 e tipos/lintfocados semerros. Backupfixture atualizado com o vínculo real doowner para não simular conta participante nos testes de nãoexportação.

Relatórios novos: Demandas/Prioridades eConferências/Avarias, com escopoSQLigualàárea de acompanhamento, inclusiveorg-wide deadmins e históricoarquivado. Período usa criação emBrasília, prazo/atraso separados; linhas portamanho/material/unidade, contagens ausentes continuamNULL, avaria nãoéquantidadefaltante; quantidades de unidadesdiferentes não produzemtotalúnico. Dados de contato/corpo/observações privados não entram.20testes de relatórios/estados/medidas passaram. Formatos usam exportadores reaisPDF/DOCX/XLSX existentes; CUAcomdadosdeconferência será conferido apósUIintegrada.

Revisão independente adicional de0014 encontrou P1: operacional rebaixado aviewer entre pré-leitura ecommit, comgrantdetarefa sobrevivente, ainda podia encerrar divergência/criar acompanhamento. ProbeSQLite semsleep reproduziu; autor corrigindo guardoperacional dentrobatch e revisor reconferirá. Não publicar0014atéfechar. UI/Sheetsfinal0014 e email0015 ainda em agentes; nenhuma mensagemexterna deQA.

Correção de leiturasfoi isolada naPR#11 https://github.com/yandiamantinoBr/role-da-extensao-proex-ufg/pull/11, headf53fcec2655da302bff08cb551a026f13143d8bf, sobreV11, sem backend0014. CI em andamento. Sete probesindependentes passaram; árvoreintegradamantémversõesautoritatativas, semGETwrite. Isso permite publicá-la sem esperar funcionalidades novas. Produção permaneceV11SHA55bf5f7nestecheckpoint.

Backupnovo foiensaiadoOFFLINE comconteúdo do backuprealV10/snapshot97, convertidoaoformato2:1objeto, SQLite761.856bytes, arquivo cifrado465.984bytes, recuperação física e hashes relidos, zero chamadasexternas e réplicaprópria removida. Não é ainda execução da rotinaautomáticaprodução. A chave pública será configuradaapóspublicação; chaveprivadanuncaservidor/AppsScript/Drive. Custódiaexternaindependente pendente.
