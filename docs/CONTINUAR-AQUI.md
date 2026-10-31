# Continuidade do Portal PROEX

Atualizado em 31/10/2026. Leia `AGENTS.md`, os requisitos e esta nota antes de retomar. Confira o estado vivo: os números abaixo são um checkpoint, não substituem GitHub/Vercel ou `git status`.

## Produção comprovada

- URL: https://proex-gestao.vercel.app/ . V11 publicada pela PR #10; correção de leitura publicada pela PR #11.
- SHA atual: `a46ee63135237954e51635af59ccecbbdb90935c`. Vercel READY `dpl_6Bq7mgvQNo4kjeXBkhCoZg51PpuG`, no mesmo SHA; checks de PR/main aprovados. Sessão autenticada, organizações, health 200 e ausência de erros do portal conferidos.
- Sessões e permissões consultam a versão autoritativa a cada execução. O payload só é recarregado quando mudou. Leituras não regravam o banco. Reprodução, testes e tradeoff de rede: `apps/proex-portal/docs/AUTORIZACAO-E-SNAPSHOT-AUTORITATIVO.md`.
- WAF bloqueia hosts diferentes do canônico. URLs geradas V9/V10 retornam 403; Preview não tem credenciais de produção. Não voltar para código anterior à migração 0008 com o banco atual.
- Sheets automático confirmado após V11: 29 tabelas, 146 linhas, zero conflitos, recibo de 31/10 às 15:07:06.612Z. Anexo: uma cópia confirmada, zero falhas. Isso comprova os instantes registrados, não disponibilidade permanente.
- Backup completo real V10 foi recuperado, copiado para Drive privado e relido com hash idêntico. Custódia da chave e localizadores ficam apenas na Vault/AppData; transferência para gerenciador independente ainda pendente.

## Integração local em andamento

Checkout coordenador: `v12-coordenacao`. Use `git status`, `git log` e `git worktree list` antes de editar. Push, PR, merge e deploy de todas as entregas estão permanentemente autorizados por Yan; não pedir novamente.

- Público opcional: integrado como `d49834e`, painel e modelo em `568abf9`, navegação compatível com o build em `0ca4176`. Modo inicial fechado; aviso aprovado, remetente e verificação de domínio são dependências de ativação. Não houve envio real. Ver `apps/proex-portal/docs/CONTAS-PUBLICAS-DE-PARTICIPANTES.md`.
- Backup diário: `e5f7c3d`, modelo/journal/snapshot em `a54d8fa`. Formato 2 usa somente chave pública no servidor e Apps Script no projeto da planilha, com arquivo adicional de backup. Falta configurar, publicar e comprovar primeira cópia/recuperação automática real. Ver `apps/proex-portal/docs/BACKUP-AUTOMATICO.md`.
- Acompanhamento: backend, UI e sino integrados, inclusive proteção operacional, roster preservado, consulta única e isolamento de respostas tardias. Mount em `a240a5a`, respostas em `f9a1fc9`, links em `498a4e2`. Revisão independente sem P0/P1 pendente. Página de 50 demandas passou de 101 para uma consulta de versão, sem carregar/regravar snapshot estável; medição local sintética, sem estimativa da rede de produção.
- Relatórios: CUA integrado encerrou evento e conferiu P/M/G, com uma avaria M e demanda filha de prioridade alta. PDF, DOCX e XLSX reabertos com três linhas corretas; PDF de duas páginas renderizado e inspecionado. Layouts 375/414/1250 sem overflow; sino móvel dentro da tela. Provas privadas em `.sites-runtime/v12-evidence`. O patch final de respostas tardias e indicador precisa da rodada final de build/smoke.
- E-mail: código `99a7199`, modelo e preferências por organização `d8588ac`. MailApp em projeto Google próprio, token `pne_` restrito à organização, consentimento individual, fila durável e resultado incerto sem reenvio cego. Revisão independente encontrou duplicação de auditoria em ACK concorrente (sem segundo envio); autor corrigindo. Conta remetente ainda não escolhida; manter tudo desativado. Não instalar MailApp no projeto de sincronização nem ampliar OAuth sem resolver esse gate.
- WhatsApp: compartilhamento manual de título/link protegido. Nenhum envio automático ou número foi configurado.

## Agentes e próximos passos

1. `revisao_organizacoes`: R20 concluído; revisão independente do frontend de e-mail em andamento. Porta 5173 livre após QA do root.
2. `mobile_responsivo`: R20 reconferido; revisão independente do backend/GAS R21 e ACK concorrente em andamento.
3. `relatorios_datas`: corrigir ACK concorrente; depois conciliar R01–R22 em matriz documental. Nenhuma mensagem real.
4. Coordenador: concluir gates integrados após os últimos patches, publicar e conferir SHA/fluxos reais sem QA em produção; instalar e comprovar backup diário no projeto Google existente. Nunca instalar o arquivo MailApp nesse mesmo projeto.

Gates: 589/589 Node 26 antes de 0015. Rodada Node 24 com 0015 teve 612/613: apenas uma asserção histórica de dez tabelas ignorava as seis de e-mail; corrigida em `e2a111e` para conferir o inventário real. Nova rodada completa em andamento. Modelos de 82 tabelas e cadeia 0000–0015 passaram sem divergência; migrações 0008–0015 ensaiadas no backup real V10 em RAM preservaram 49 tabelas, integridade OK/FK zero. Smoke HTTP sintético de Sheets/conflitos e backup com 5,29 MB, 161 chunks, recuperação física passou. Não usar estas provas locais para afirmar execução do backup diário ou capacidade serverless.

Nova chave RSA protegida por DPAPI foi ensaiada offline com o conteúdo do backup real V10: formato 2, recuperação física e hashes passaram. Ainda não é prova de execução da rotina diária em produção. Arquivos reais, chaves, capturas e logs privados permanecem fora do Git público.

Requisitos completos R01–R22: `REQUISITOS-E-CONTINUIDADE.md` e nota equivalente da Vault. Histórico de execução: `ANDAMENTO.md`; entregas: `ENTREGA-V9.md`, `ENTREGA-V10.md`, `ENTREGA-V11.md`. Não esquecer privacidade/retenção, custódia institucional, ativação dos provedores e demais achados A01–A28. Arquivo gravado na Vault não comprova sincronização em nuvem.
