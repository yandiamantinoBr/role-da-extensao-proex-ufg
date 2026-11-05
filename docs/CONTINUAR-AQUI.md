# Continuar Portal PROEX

## Publicação confirmada e próxima composição · 05/11/2026

PR #33 publicada: merge `c8182d2e4b34f99033b861daa8064e12f1e2d937`, Vercel `dpl_7vA9LLPkEtiJoewFzEThQAfiKqFy` READY. CI `42030415419`: 1003 testes do Portal, tipos, builds Worker/Node e autenticação aprovados. Chrome autenticado confirmou versão no rodapé, cartão do CONPEEX abrindo a ficha, calendário em português no mês atual e campo `05/11/2026`, além do feedback com versão. Nenhuma demanda/aviso de QA foi criada em produção.

PR #34 publicada em `bd36d084ce475c6f43fc765b2f36ebded6594193`, Vercel `dpl_HfBiVwe913M2kuWawJc2jNjc1y3o` READY, domínio canônico conferido. CI final42037080311 aprovado, funcional1072/1072 e builds. Saúde200, raiz exige login, novas APIs privadas401/no-store, aposentados403. Chrome indisponível (`Debugger unattached`); inspeção visual autenticada pós-deploy ainda não realizada. [Evidências e limites](ENTREGA-05NOV-IA-E-EQUIPES.md).

`PROEX_KEYS_SECRET` continua ausente: a revisão automática bloqueou o provisionamento antes da execução; não contornar a rejeição ou apresentar o cofre como pronto. Usuário informou Bitwarden desbloqueado, CLI continuou bloqueada; abertura do aplicativo pela ferramenta também foi impedida. Nenhum segredo foi lido ou criado nessas tentativas.

Frentes seguintes isoladas: OpenAI texto/cofre0027, Meu trabalho PDF/DOCX/XLSX e Sheets equipe + projeto0028. Nenhuma chave ou modelo real foi usado. As solicitações de organograma formal e migração institucional seguem na fila; a pesquisa e IDs privados estão na Vault.

## Primeira entrega da rodada · 05/11/2026

PR #33, branch `codex/proex-evolucao-05nov`: filtros/datas brasileiras, favoritos/gráfico de projetos, origem da demanda, planilha exclusiva por projeto, versão/feedback e PDF/DOCX/XLSX em Registros e Resumo diário. [Resultado, testes e limites](ENTREGA-05NOV-UX-E-SHEETS.md) e [fila completa](RODADA-05NOV-UX-E-PLANILHAS.md). Não confundir esta branch com produção antes do recibo de merge/deploy.

Agentes mantêm frentes separadas de MCP pessoal (0024), Groq no cofre (0025) e checklist de atividade (0026). Integrar e gerar snapshots em ordem após os respectivos testes. Não ler segredos, usar dados reais em QA ou iniciar chamadas pagas. A instalação do script por projeto é uma etapa própria no Google; preservar script/gatilhos da mestre.


## Voltar e Avançar entre os módulos · 04/11/2026

Cada troca de módulo preserva uma etapa no histórico do navegador. Mudanças nos filtros de contexto atualizam a etapa atual. A volta a um endereço antigo respeita os acessos atuais e os rascunhos automáticos guardam a digitação feita imediatamente antes da saída. [Reprodução e testes](NAVEGACAO-PORTAL.md).

## Cadastro de materiais no Sheets e revisão dos módulos · 04/11/2026

- **Uso:** na planilha mestre, abra **PROEX → Cadastrar material**. O registro entra no Portal com saldo zero e a próxima sincronização traz a linha para **Materiais**. Use as células em creme para editar. [Operação, cuidados e teste nos dois sentidos](../apps/proex-portal/docs/SINCRONIZACAO.md#atalhos-de-materiais-e-permissões-do-drive).
- **Verificação:** publicação na Vercel, instalação do `.gs` vinculado e execução do gatilho são marcos independentes. Rode `node scripts/qa-local.mjs --sync-smoke` em `apps/proex-portal` depois de construir a aplicação para testar o fluxo com base descartável; não use materiais de teste na mestre.
- **Interface:** [auditoria dos 13 módulos e da Agenda](QA-AGENDA-E-MODULOS.md). Próximos recortes: catálogo de Materiais em telas estreitas, navegação Voltar entre módulos e testes mais profundos por papel e com leitor de tela.

## Histórico · V23 e V24 publicadas

PR #26 integrou `bed5b69496f22f6ba18a89dce98c05938a4d989e` e ficou READY na Vercel. O CI aprovou 922 testes do portal e 33 do jogo. [Entrega V23/V24](ENTREGA-V23-V24.md) reúne o caminho para cadastrar chaves, as evidências do cofre e a classificação das demandas. O segredo dedicado está pendente no ambiente. O JEV em produção depende de ativação própria. [Login Google](V25-LOGIN-GOOGLE.md) registra os testes exigidos antes do piloto.

As PRs #24 e #25 corrigiram os cartões de projetos no Início, a escolha da atualização de empréstimo, a lista de ocultadas e os marcos da Agenda no relatório. [Revisão de fluxos](ENTREGA-V22.md#revisão-de-fluxos-após-a-v22--04112026)

A [revisão de interação](REVISAO-DE-INTERACAO-MOVEL.md) registra o caso de rolagem da PR #27 e os critérios de teste para gestos, foco, mudanças de recorte e exportação.

O [acabamento de Demandas e exportações](ACABAMENTO-DEMANDAS-E-EXPORTACOES.md) detalha o fluxo de edição móvel, a troca dos downloads CSV por XLSX e o acesso a planilhas vinculadas, além da alternativa de teclado para os gráficos.

Os [atalhos para abas do Google Sheets](../apps/proex-portal/docs/SINCRONIZACAO.md#atalhos-de-materiais-e-permissões-do-drive) usam a planilha mestre já conectada e separam a base sincronizada do recorte baixado em XLSX. O teste de edição manual usa `qa-local.mjs --sync-smoke` com dados descartáveis.

## Histórico · V22 publicada

Em 04/11/2026, PR #23 integrada em `51fedadfdc27ab7f05059ad6276b871d64f0e15e`, Vercel `dpl_2ei6jUVH2CgbRbVwvAdG9cXcuWiS` READY. CI 899 portal + 33 jogo. Ficha do CONPEEX baixada e renderizada em produção. Avisos e Pendentes têm ações pessoais e feedback de concorrência. A migração 0019 mantém 35 projeções Sheets. O GitHub remoto voltou a ter somente `main`. [Entrega V22](ENTREGA-V22.md).

Para continuar, comece pelos aceites V23–V25 no fim da seção de continuidade da V22. Preserve as decisões e a fila de integrações da Vault. As próximas entregas têm validações próprias de custo, acesso, identidade e operação.

## Histórico · V21 publicada

Em 04/11/2026, a PR #22 integrou `dcac2edfd633e599c538ad8a929b50bc002b39fa`, READY na Vercel. CI com 884 testes do portal e 33 do jogo. Comunicação por projeto, gráficos de Demandas e exportação direta foram conferidos no CONPEEX em produção. Groq está disponível como opção de configuração para um piloto, testado por simulação. [Entrega V21](ENTREGA-V21.md).

## Histórico · V20 publicada

Em 04/11/2026, a PR #21 integrou a V20 em `e4b528c`, READY na Vercel. A marca mobile volta ao Início, o resumo prioriza o recorte selecionado e Meu trabalho exporta as páginas exibidas em Markdown. Foram verificadas nove demandas do CONPEEX em produção e o link da planilha de contagem e lotes no Drive institucional Equipe PROEC. [Entrega V20](ENTREGA-V20.md).

A verificação a 375 e 1250 px foi feita depois na bancada local V21. [Entrega V21](ENTREGA-V21.md).

## Histórico · V19 publicada

Em 04/11/2026, a PR #20 integrou a V19 em `bf662b4d271e65ca3c50cde2ebcbe09b7170a758`, READY na Vercel. O CI aprovou 871 testes do portal e 33 do jogo. A atividade oficial do 23º CONPEEX aparece de 9 a 13 de novembro na Agenda, como dia inteiro. A V18 corrigiu a seleção repetida da mesma demanda, conferida em produção ao reabrir o cartão pela demanda do piloto. [Entrega V19](ENTREGA-V19.md), [entrega V18](ENTREGA-V18.md).

## Histórico · V17 publicada e operação verificada em 04/11

Em 31/10/2026, a PR #18 integrou a V17 em `f77736262089c97aab226f956fd622ae3b407ad4`, Vercel `dpl_9FpsCmBEfQPeTZ8q9j8TmTxETivG` READY. CI com 854 testes do portal e 33 do jogo. O piloto próprio chegou à caixa de entrada, seu link abriu a demanda e ela foi concluída. O gatilho único de dez minutos está instalado. Em 04/11, o histórico do Google confirmou quatro execuções automáticas concluídas, entre 09:42 e 10:12. Credencial ativa até 30/11. Leia [ENTREGA-V17.md](ENTREGA-V17.md) para os limites, escopos e provas.

Em 04/11, a aba Controle confirmou **35 tabelas verificadas** às `13:09:15.920Z`, conector 2026-10-31. O Apps Script de dados registrou as execuções automáticas de sincronização às 10:05:47, anexos às 09:53:32 e backup às 03:53:52, todas concluídas. A pasta privada continha cópias de 01 a 04/11. A de 04/11 foi criada às `06:53:58.114Z`, tem 531.305 bytes e somente o proprietário tem acesso. A restauração física confirmada continua a de 31/10. Metadados privados na Vault. Uma sincronização manual posterior ao cadastro V19 confirmou a linha do CONPEEX e 35 tabelas às `13:46:02.449Z`. A assinatura no Google Calendar está ativa e ainda aguardava a coleta do novo marco na conferência pós-cadastro. [Entrega V19](ENTREGA-V19.md).

## Histórico · V16 publicada

Em 31/10/2026, [PR #17](https://github.com/yandiamantinoBr/role-da-extensao-proex-ufg/pull/17) integrada: merge funcional `f8c3718abcb654b0b8b06679fe8dfba87cf6deff`; Vercel `dpl_GsN2Q4ZZJGH8foUMmtTzcXBREsAf` READY nesse SHA. CI: 838 testes do portal e 33 do jogo, sem falhas; tipos/builds Worker e Node aprovados, lint sem erros e três avisos anteriores. QA 375/1250 sem overflow. O botão da agenda segue o fluxo oficial Do URL, com ICS passivo conforme e verificação fresca de acesso. [ENTREGA-V16.md](ENTREGA-V16.md) traz provas e limites. O usuário já tem a assinatura criada no Google; a fonte consultada durante a V16 retornava zero registros no horizonte da assinatura. Não criar compromissos fictícios para preenchê-la.

Durante a V16, conta, organização e credencial restrita de 30 dias foram conectadas no projeto privado. O servidor ainda estava desligado enquanto a V17 preparava o piloto próprio e o feedback da cópia. A execução confirmada está no checkpoint da V17 acima.

## Histórico · V15 publicada

Em 31/10/2026, PR #16 integrada: candidato fdc2faf, merge funcional `737a14bf2b3d68c7c0bf19c090a15150c45ffe32`. Vercel `dpl_5dsBCaCtGYdqMS6VS26xvzEoYqxd` READY nesse SHA. CI: 827/827 testes do portal e 33/33 do jogo. Código local main e GitHub conferidos. Commits posteriores apenas documentais preservam a versão funcional; verificar o SHA corrente no GitHub/Vercel antes de continuar. Push, PR, merge e deploy permanecem autorizados; regras de segredos e dados continuam em AGENTS.md.

[ENTREGA-V15.md](ENTREGA-V15.md) registra Meu trabalho, responsabilidades explícitas, CAS/histórico, sinais, sino agrupado, testes, revisão independente de 9,1/10 e conferência real. Migração 0017 aplicada; 86 tabelas de aplicação e 35 projeções Sheets. A projeção de designações é somente leitura, sem responsáveis/histórico. SQLite/Supabase existentes preservados. Backup publicado recuperado em RAM: 86 tabelas, journal com 18 migrações, integridade/FKs/objetos aprovados. Custódia independente da máquina ainda não comprovada.

Sheets canônico: 35 tabelas, 170 linhas/zero conflitos e depois 173 linhas/zero. **Conector de IA divergente:** um MCP desta sessão respondeu 27 tabelas e histórico de 25/10. Revalidar destino/esquema antes de usar essa conexão para escrita; portal canônico e planilha respondem 35. O gerenciamento consultado não expõe edição desse endpoint privado. Isso não é uma falha da sincronização canônica.

Na entrega V15, R21 estava preparado e OFF, esperando confirmação Google específica; esse bloqueio de autorização foi superado pela resposta posterior registrada no topo. IA/STT, público, custódia externa e decisões institucionais permanecem na [matriz R01–R24](COBERTURA-DE-REQUISITOS.md). Não gravar exemplos de QA em produção nem presumir atribuição por autoria/cargo/tomador. Zoom de 200%, leitor de tela e aparelhos físicos não foram comprovados. [Parecer visual](../apps/proex-portal/docs/AUDITORIA-DESIGN-V15.md).

## Histórico de retomadas anteriores

**Retomada histórica: V14 aprovada para publicação; R24 em implementação V15 isolada.** Builds do candidato c35140a e recaptura do último fechar44 concluídos nos quatro contextos, teclado/foco aprovados. Rubrica independente final9,0/10 nos estados observados (9,045 ponderada), mesmos oito pesos; zoom 200% permanece não comprovado, sem certificação WCAG. Parecer final atualizado e nenhum novo bloqueador visual demonstrado. Falta CI do descendente documental, merge da PR15, Vercel READY no mesmo SHA e conferência real. Não tocar janela nativa bloqueada; o navegador interno funcionou neste novo turno sem contorno. R24: backend de responsabilidades/Meu trabalho (0017), UI isolada e sinais visuais em três worktrees próprias; nada disso deve entrar na V14 por acidente. Produção ainda23bbeae até comprovação. Os checkpoints abaixo são históricos; ler primeiro docs/ENTREGA-V14.md.

**Checkpoint histórico: V14 candidata não publicada.** Código em `v14-interface`, funcional `3fa3222`, último ajuste CSS `0804314`. 755/755 testes em Node 24/26, 33/33 do jogo, tipos/lint sem erros (três avisos antigos), Worker/Node passaram em `3fa3222`. QA e recapturas pontuais confirmaram datas, disponibilidade, botão da planilha, respiro do backup, alvos públicos e cabeçalho de 320 px. CUA foi encerrado por proteção ao não identificar a URL Chrome no Windows; não contornar. QA encerrado. Falta recompilar o último ajuste CSS do fechar 44 px, recapturá-lo, completar a verificação visual/zoom e concluir a nota independente antes de merge/deploy. 200% não foi comprovado. Ler `docs/ENTREGA-V14.md`; o texto anterior abaixo é histórico do trabalho. Última produção ainda `23bbeae`. R21 continua OFF, aguardando a confirmação específica de acesso Google já perguntada.

Em 31/10/2026, após V13, Yan escolheu provisoriamente a conta Google pessoal atual para avisos e pediu auditoria visual de TODO portal com nota independente mínima de 9/10. Última produção comprovada continua 23bbeae/V13. V14 está LOCAL, ainda sem publicação e sem aprovação9. Os detalhes abaixo da V13 permanecem como histórico útil.

- Root integra v14-interface e faz CUA exclusivo em QA sintético, sem gravações de QA em produção. Achados não se limitam a overflow: cascata CSS, contraste, teclado, toque e prioridade do conteúdo.
- relatorios_datas mantém auditoria independente, baseline V13 de 7,0/10, rubrica de 8 dimensões e checklist de 16 famílias em apps/proex-portal/docs/AUDITORIA-DESIGN-V14-PRELIMINAR.md. Só reavaliar após os mesmos contextos/estados no build final.
- revisao_organizacoes: Demandas/sino, login, Início e recorte compartilhado/configurações. mobile_responsivo: projetos, agenda, importação, relatórios, equipe e alvos locais. Não sobrepor arquivos sem coordenação.
- Avisos: remetente salvo OFF no portal, planilha/Apps Script privados separados preparados e menu confirmado. Manifesto limita quatro escopos e não solicita Gmail/Sheets/Drive. Confirmação específica de Google+token de 30 dias+piloto próprio está pendente em pergunta assíncrona. Não emitir token nem habilitar envio antes da resposta. Localizadores e endereço somente na Vault; nenhum segredo no Git.
- QA em 127.0.0.1:5173 iniciado pelo coordenador, somente loopback/dados fictícios. Provas privadas em apps/proex-portal/.sites-runtime/production-v14; mudanças na fonte requer parar QA e rebuild antes de conferir o build final. Não tocar QA antigo cuja exclusão foi rejeitada.

Checkpoint da revisão integrada em 31/10: 749/749 testes Node 24/26 e builds Worker/Node passaram na fonte 186e44f. Onze abas principais foram conferidas nos quatro contextos e estados públicos/importação/IA/patrimônio em QA sintético; PDF/DOCX/XLSX reabertos, PDF renderizado. Novos achados de 320 px, evento público, chave de sincronização e respiro de backup corrigidos localmente até d39e32f, ainda aguardando recompilação/recaptura pontual. Auditoria encontrou também datas/atraso e disponibilidade incorretos no detalhe do projeto; mobile_responsivo corrige DTO/leitura e testes, revisao_organizacoes fará revisão independente. QA anterior encerrado; não chamar esses últimos commits de testados em produção. Repetir suíte completa após integrar a correção da consulta, compilar, conferir os pontos afetados e só então pedir a nota final ao auditor. Notificações repetidas da mesma demanda permanecem melhoria residual registrada; não estão resolvidas.

# Histórico de continuidade · V12/V13 em 31/10/2026

Atualizado em 31/10/2026. Leia AGENTS.md, este guia e a matriz de requisitos. Confirme GitHub/Vercel e git status: checkpoints não são monitoração contínua. Push, PR, merge e deploy de todas as entregas estão permanentemente autorizados por Yan.

## Produção comprovada

- Site: https://proex-gestao.vercel.app/ . V13 publicada na PR #14; V12 e compatibilidade do backup são histórico nas PRs #12/#13.
- Revisão funcional V13: d069c7f280881f946e801fd9a956dad86379fcdf; Vercel READY dpl_3KvAbcFCHoaJp61GsjuxBS6N7GBD no mesmo SHA. Candidato f202903, PR/main aprovados: 726/726 portal e 33/33 jogo. Sessão real, Demandas/sino, novo relatório e padrão documental OFF conferidos após deploy, sem QA ou chamadas de provedores em produção. Commits posteriores só de documentação mantêm o mesmo código; consultar GitHub/Vercel para o SHA corrente.
- Health canônico 200; URLs geradas antigas V9/V10 retornam 403. Preview não tem credenciais de produção. Não operar o banco atual com código anterior à migração 0008.
- Demandas, prioridades, equipes sobrepostas, conferência por material/tamanho, pendências, sino e relatórios estão publicados. Concessão de tarefa não amplia ACL; conferência não movimenta estoque nem fecha empréstimo. WhatsApp é compartilhamento manual.
- E-mail MailApp e cadastro público estão implementados, mas DESATIVADOS. Remetente pessoal provisório escolhido em 31/10 e salvo com envio OFF; instalação separada e autorização Google ainda pendentes. Aviso aprovado e infraestrutura da entrada pública têm gates próprios. Não escolher uma conta por ausência de resposta.

## Backup e Sheets reais

- Primeiro formato 2 capturado em 31/10 às 13:19:05 BRT, releitura/ACK 13:19:11; 485.224 bytes. A cópia baixada do Drive privado tem o mesmo SHA-256 do recibo: f13c9a6678d956550b7789e9ee4b928892c1fccc8c3612a944563ed6c12ada50.
- Recuperação física isolada passou: snapshot 270, SQLite 1.183.744 bytes, 1 objeto / 416.503 bytes, 16 migrações, integridade/FK/hashes aprovados; réplica clara temporária removida. Provas privadas em apps/proex-portal/.sites-runtime/production-v12. Localizadores/chaves somente na Vault/AppData, nunca no Git público.
- Apps Script da planilha recebeu Code.gs atual e backup-automatico.gs, sem arquivo MailApp. Gatilho diário às 03h America/Sao_Paulo instalado e consulta confirmou 1 gatilho, recibo válido e nenhum pendente. A primeira execução pelo relógio ainda não aconteceu; não confundir com a captura manual comprovada pela rotina. Privada sob DPAPI local; custódia independente continua pendente.
- Drive real informa inherited=true na própria ACL única user/owner. Correção mantém dono atual, ACL única, pai privado exato e recusa qualquer acesso extra, sharedDrive, atalho ou paginação. Positivo reproduzido antes/depois e negativos/revisão passaram. Diagnóstico temporário retirado; pasta extra vazia criada por seleção incorreta foi movida à lixeira recuperável, pasta configurada preservada.
- Sheets pós-V12: execução automática concluída em 31/10 às 16:37:03.006Z, 34 tabelas / 153 linhas / zero conflitos. Inclui as cinco projeções somente leitura do acompanhamento. Um gatilho de dados e um de anexos preservados; execução automática anterior após V11 foi comprovada em 15:07:06.612Z. Última rodada de anexos não revalidou uma cópia anterior, sem novas falhas; não chamar isso de nova releitura.

## V13 publicada e próxima ação

Checkout coordenador atual: v14-interface, sobre a produção documental 23bbeae (revisão funcional V13 d069c7f). R09, R10 e R11 integrados, revisados por agentes diferentes e conferidos em CUA. Revisões específicas estão em apps/proex-portal/docs. Fonte congelada; últimos commits são testes e documentação. Não abrir frentes concorrentes sobre arquivos compartilhados.

- R09: “Saídas rastreáveis” mostra ação, quantidade, operador autorizado e retorno; reservas/agendamentos não contam como saída, textos livres exigem opt-in, CSV parcial tem nome explícito.
- R10: IA opcional no importador de projetos/patrimônios, evidências literais por campo, revisão e confirmação. documentEnabled começa false. Confiança sem calibração permanece nula; não há OCR/envio binário ou saldo automático. 0016 é aditiva.
- R11: painel montado só em configuração autorizada com revisão salva; consentimento próprio para metadados, sem geração/transcrição automática. Troca de organização/revisão desmonta o diagnóstico. Chaves/provedores reais não foram usados.
- Autoridade é conferida depois dos awaits de configuração/decifragem, antes de cada envio IA/STT e ao devolver/reaplicar resultados. Mudança de identidade recarrega a interface antes de aplicar novo snapshot.

Suítes finais: 726/726 em Node24 e Node26, tipos/lint sem erros (3 avisos antigos), Worker e Node builds aprovados. PR #14 e deploy de produção concluídos, conferência autenticada e isolamento aprovados. Coordenador mantém a trilha de registro na Vault e oito chats. Próximas ações reais: concluir autorização/instalação do remetente pessoal provisório já escolhido, configurar provedores pelo responsável, testar em aparelhos físicos, comprovar primeira execução diária e custodiar as chaves fora da máquina. Não ativar serviços por ausência de resposta; consultar docs/ENTREGA-V13.md e a matriz.

## Evidências e limites

V12: suíte local 643/643 Node26 mais contrato posterior focado; CI 644/644. Correção Drive: CI 645/645, 22 focados, revisão independente. Tipos/lint sem erros (3 avisos antigos), Worker/Node builds passaram. V13: modelos de 83 tabelas e cadeia 0000–0016 coerentes; migração 0016 ensaiada no backup RSA real V12 em RAM preservou as 82 tabelas originais, integridade OK/FK zero. Histórico V12: migrações ensaiadas no backup real V10 em RAM preservaram 49 tabelas. CUA 375/414/1250 sem overflow, evento→P/M/G com 1 avaria M→revisão alta, PDF/DOCX/XLSX reabertos e PDF renderizado. Build final também confirmou deep link e consentimento próprio persistido/retirado com envio desligado.

Smoke local de Sheets/conflitos e backup de 5,29 MB / 161 chunks com recuperação física passou. Benchmark público local: 100 pedidos, concorrência 10, zero erros, p95 14,47 ms; página de 50 demandas passou de 101 para 1 consulta de versão, zero recargas/commits estáveis. São medições sintéticas locais, não capacidade serverless ou latência Postgres.

Requisitos R01–R22 e achados A01–A28 continuam rastreados. Não declarar tudo concluído: política institucional/retensão, custódia independente, ativação de provedores/público, escolhas de catálogo e demais pendências são distintas de código pronto. R12 já oferece áudio→transcrição revisada→proposta/confirmar no assistente; não espalhar microfones sem necessidade. Nunca ler/imprimir .env/.dev.vars, arquivos de segredo ou valores de chaves.

Leia docs/COBERTURA-DE-REQUISITOS.md e docs/ENTREGA-V13.md; V12 é histórico em docs/ENTREGA-V12.md. Histórico em docs/ANDAMENTO.md; Vault salva/relida localmente não comprova sincronização em nuvem.


## Verificações em continuidade - 05/11

A reconsulta Google Calendar da assinatura existente PROEX · Projetos e eventos,9–13/11, retornou zero eventos às10h54 de Brasília. Coleta ainda pendente; não criar cópia ou revogar link para esconder a lacuna. A conexão de inventário dos chats não devolveu resultado e foi encerrada sem envio; não declarar comunicação das novas entregas aos oito chats. A próxima composição recebeu snapshot0027, nove colunas/PK/FK preservadas e rollback sob falha.26focais passaram. Rodada ampla1094/1095 teve falso positivo antigo na busca de prefixo CPF de três dígitos em UUID/timestamp; f4b744d agora valida as duas formas completas e JSON exato de auditoria. Focal passou; repetir integrado depois das novas mudanças, sem registrar100% antecipadamente.
