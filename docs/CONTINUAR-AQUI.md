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
- Acompanhamento: backend `eec4156`; proteção de revisão operacional e projeções Sheets em `640610e`; modelos em `56d8128`. Interface/sino ainda com o agente autor; revisão independente continua. O rebaixamento operacional para viewer com grant de tarefa sobrevivente foi reproduzido e corrigido; aguardar parecer final e UI.
- Relatórios de demandas/conferências: `42ea91f`, com organização/projeto, prioridades, prazos, contagem por material/tamanho/unidade e avarias. Sem contatos, corpo ou observações privadas; campos ausentes continuam ausentes. Falta CUA integrado e exportações com a interface final.
- E-mail: frente 0015 separada, em implementação. MailApp em projeto Google próprio, credencial exclusiva de avisos por organização, consentimento individual, fila durável e resultados incertos sem reenvio cego. Conta remetente ainda não escolhida; manter tudo desativado. Não instalar MailApp no projeto de sincronização e ampliar OAuth sem resolver esse gate.
- WhatsApp: compartilhamento manual de título/link protegido. Nenhum envio automático ou número foi configurado.

## Agentes e próximos passos

1. `revisao_organizacoes`, worktree `v16-acompanhamento`: concluir UI/sino e CUA; enviar commits finais. Ele usa a porta 5173 para QA; coordenar antes de iniciar outro servidor.
2. `mobile_responsivo`, worktree de revisão `v19-revisao-acompanhamento`: fechar revisão adversarial do backend/UI e confirmar correções. A correção de leitura da worktree v17 já foi publicada isoladamente.
3. `relatorios_datas`, worktree `v18-notificacoes-email`: concluir credencial restrita, MailApp, testes e documentação; nenhuma mensagem real.
4. Coordenador: integrar commits sem descartar alterações, montar Demandas e sino, reconciliar schema/journal/snapshots da 0015, executar testes/tipos/lint/builds e CUA 375/414/1250. Validar PDF/DOCX/XLSX e estoque preservado nas conferências. Publicar e conferir SHA/fluxos reais, sem dados de QA na produção.

Última suíte integrada: 582/582 Node 26, antes do último patch de revisão. Depois dele, 32 testes focados passaram. Modelos de 76 tabelas e cadeia 0000–0014 sem divergência. Rodar gates finais após integração da UI/0015; não usar estes números para declarar versões futuras testadas.

Nova chave RSA protegida por DPAPI foi ensaiada offline com o conteúdo do backup real V10: formato 2, recuperação física e hashes passaram. Ainda não é prova de execução da rotina diária em produção. Arquivos reais, chaves, capturas e logs privados permanecem fora do Git público.

Requisitos completos R01–R22: `REQUISITOS-E-CONTINUIDADE.md` e nota equivalente da Vault. Histórico de execução: `ANDAMENTO.md`; entregas: `ENTREGA-V9.md`, `ENTREGA-V10.md`, `ENTREGA-V11.md`. Não esquecer privacidade/retenção, custódia institucional, ativação dos provedores e demais achados A01–A28. Arquivo gravado na Vault não comprova sincronização em nuvem.
