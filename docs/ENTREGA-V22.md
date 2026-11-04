# V22 · Relatórios com identidade visual e central de avisos

## Critérios de aceite

Quem acompanha um projeto deve conseguir ver o recorte e os totais antes de baixar. O documento precisa identificar a PROEX/UFG, usar a marca de projeto de fonte comprovada, mostrar números e rótulos legíveis, distinguir zero de campo ausente e preservar as permissões da consulta. A revisão inclui prévia em claro e escuro a 390 e 1366 px, PDF A4 reaberto e renderizado, ficha única e paginação de recortes maiores.

Quem acompanha demandas deve conseguir limpar sua caixa de avisos e ocultar uma pendência pessoalmente. Novos avisos precisam continuar visíveis e o histórico da demanda e a entrega por e-mail preservam suas regras. Revisar a autorização de cada ação, a repetição e a concorrência.

As referências de design são as capturas fornecidas e o [processo do VGP](https://vgp-site.vercel.app/). A referência editorial usa a ordem identidade, recorte, indicadores e detalhamento. O portal usa seus próprios ativos e cores.

## Reconciliação de branches

Em 04/11/2026, a PR #22 já estava integrada, com a V21 READY. O commit local de diagnóstico `d03c25b` tem patch equivalente em `main`. A consulta ao remoto mostrava `main` e duas branches antigas. As pontas de `feat/proex-v5` (`e04f158`) e `v13-coordenacao` (`23bbeae`) eram ancestrais de `main`, sem PR aberto. As duas referências foram removidas do GitHub com verificação do SHA esperado. As worktrees locais e os históricos de PR foram preservados.

## Continuidade

A rodada de qualidade fica concentrada em relatório, avisos e operação do CONPEEX. A área de chaves, a triagem JEV, o acabamento mais amplo e a entrada Google têm aceites separados. A migração de segredos exige ensaio com dados sintéticos e configuração própria. Chamadas a provedores dependem de configuração explícita, consentimento, cota e estimativa antes de ativar.

### Próximos aceites

| Frente | Situação verificada | Próximo aceite |
| --- | --- | --- |
| CONPEEX e operação | Agenda de 9 a 13/11, nove demandas registradas e planilha de contagem vinculada na V20/V21. | Confirmar saldos e responsáveis de cada lote com a equipe. Separar a conferência de qualquer alteração real de estoque. |
| V23 · Credenciais e modelos | Diagnóstico de conexão já integrado. DeepSeek, TypeSafe e Deepgram usam configuração por organização. Groq é um piloto delimitado por ambiente. | Implementar ponte de leitura v1/v2 com chave independente, recifra retomável e proteção contra gravação concorrente. Entregar painel de administração com metadados e ACL, sem devolver segredos. |
| V24 · JEV e custos | Cota por organização mede reservas. | Triagem de urgência e importância com explicação e revisão humana. Separar reserva, estimativa, uso medido por modelo e cobrança confirmada. |
| V25 · Acabamento e conta Google | Marca móvel e atalhos por projeto já implementados. | Revisar telas restantes e validar login com vínculo explícito por convite e preservação dos escopos. Conferir com aparelhos físicos e leitor de tela. |
| Comunicação e integrações | Registro de publicações por projeto na V21. Sheets e backup operam por rotinas próprias. | Validar Drive institucional, permissões de exportação Docs/Sheets, links de designs e captação de publicações por fonte. Preservar o fluxo de proposta com aprovação para qualquer ação de IA. Tratar a exportação Markdown pessoal, o compartilhamento pelo usuário e a automação WhatsApp como fluxos distintos. |

A triagem comparou as notas da Vault com os fluxos atuais. O diagnóstico existente consulta metadados de conexão. Teste com inferência é um aceite separado, com carga sintética, consentimento, limite e registro de uso. O segredo de login ainda protege propostas e replays de voz/documentos; a migração de chaves de provedores precisa preservar esses fluxos. O retorno após a primeira gravação v2 exige uma versão que leia ambos os formatos.
