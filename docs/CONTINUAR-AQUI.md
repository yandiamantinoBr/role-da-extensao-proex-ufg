# Trabalho atual · R23/V14 e ativação de avisos

**Checkpoint mais recente: V14 candidata não publicada.** Código em `v14-interface`, funcional `3fa3222`, último ajuste CSS `0804314`. 755/755 testes em Node 24/26, 33/33 do jogo, tipos/lint sem erros (três avisos antigos), Worker/Node passaram em `3fa3222`. QA e recapturas pontuais confirmaram datas, disponibilidade, botão da planilha, respiro do backup, alvos públicos e cabeçalho de 320 px. CUA foi encerrado por proteção ao não identificar a URL Chrome no Windows; não contornar. QA encerrado. Falta recompilar o último ajuste CSS do fechar 44 px, recapturá-lo, completar a verificação visual/zoom e concluir a nota independente antes de merge/deploy. 200% não foi comprovado. Ler `docs/ENTREGA-V14.md`; o texto anterior abaixo é histórico do trabalho. Última produção ainda `23bbeae`. R21 continua OFF, aguardando a confirmação específica de acesso Google já perguntada.

Em 31/10/2026, após V13, Yan escolheu provisoriamente a conta Google pessoal atual para avisos e pediu auditoria visual de TODO portal com nota independente mínima de 9/10. Última produção comprovada continua 23bbeae/V13. V14 está LOCAL, ainda sem publicação e sem aprovação9. Os detalhes abaixo da V13 permanecem como histórico útil.

- Root integra v14-interface e faz CUA exclusivo em QA sintético, sem gravações de QA em produção. Achados não se limitam a overflow: cascata CSS, contraste, teclado, toque e prioridade do conteúdo.
- relatorios_datas mantém auditoria independente, baseline V13 de 7,0/10, rubrica de 8 dimensões e checklist de 16 famílias em apps/proex-portal/docs/AUDITORIA-DESIGN-V14-PRELIMINAR.md. Só reavaliar após os mesmos contextos/estados no build final.
- revisao_organizacoes: Demandas/sino, login, Início e recorte compartilhado/configurações. mobile_responsivo: projetos, agenda, importação, relatórios, equipe e alvos locais. Não sobrepor arquivos sem coordenação.
- Avisos: remetente salvo OFF no portal, planilha/Apps Script privados separados preparados e menu confirmado. Manifesto limita quatro escopos e não solicita Gmail/Sheets/Drive. Confirmação específica de Google+token de 30 dias+piloto próprio está pendente em pergunta assíncrona. Não emitir token nem habilitar envio antes da resposta. Localizadores e endereço somente na Vault; nenhum segredo no Git.
- QA em 127.0.0.1:5173 iniciado pelo coordenador, somente loopback/dados fictícios. Provas privadas em apps/proex-portal/.sites-runtime/production-v14; mudanças na fonte requer parar QA e rebuild antes de conferir o build final. Não tocar QA antigo cuja exclusão foi rejeitada.

Checkpoint da revisão integrada em 31/10: 749/749 testes Node 24/26 e builds Worker/Node passaram na fonte 186e44f. Onze abas principais foram conferidas nos quatro contextos e estados públicos/importação/IA/patrimônio em QA sintético; PDF/DOCX/XLSX reabertos, PDF renderizado. Novos achados de 320 px, evento público, chave de sincronização e respiro de backup corrigidos localmente até d39e32f, ainda aguardando recompilação/recaptura pontual. Auditoria encontrou também datas/atraso e disponibilidade incorretos no detalhe do projeto; mobile_responsivo corrige DTO/leitura e testes, revisao_organizacoes fará revisão independente. QA anterior encerrado; não chamar esses últimos commits de testados em produção. Repetir suíte completa após integrar a correção da consulta, compilar, conferir os pontos afetados e só então pedir a nota final ao auditor. Notificações repetidas da mesma demanda permanecem melhoria residual registrada; não estão resolvidas.

# Continuidade do Portal PROEX

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
