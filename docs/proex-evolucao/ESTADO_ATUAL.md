# Estado atual da evolução PROEX

Atualizado em 20/10/2026. Branch: `feat/proex-portal`. Leia a [ADR 0002](ADRS/0002-portal-nativo-sites.md) e o [manual do portal](../../apps/proex-portal/README.md).

## Entrega operacional

Portal publicado: https://proex-gestao.yandiamantinobr.chatgpt.site

- Site novo, banco D1 e armazenamento R2 privado separados da roleta livre.
- Login ChatGPT, primeiro responsável vinculado à conta proprietária, convites por link, revogação e permissões por projeto.
- Painel responsivo: projetos, campanhas, materiais, ofertas compostas, estoque auditado, empréstimos com conflitos e anexos privados, equipe e relatórios CSV.
- Participação única por conta/evento entre roleta, dado e presencial; reservas e entrega única no servidor. Atendimento assistido sem conta com tíquete explicitamente separado. Retomada e cancelamento auditado de pendências.
- Política de repetição configurável de zero a três; regras preservadas após ativar. Rascunhos editáveis. Nenhuma regra de Super Super Brinde foi criada.
- Métricas por projeto/dia/campanha, sem fingir visitantes únicos ou seguidores verificados.

A versão livre continua no Site anterior e no Pages. Main permanece em `f905f0d78371dc4a8784cce27bdbc7ef6fa88103`; nenhuma alteração foi mesclada nela. Baseline de 12 arquivos preservado. A automação antiga continua desabilitada; sincronização Windows não foi reativada.

## Verificação

Portal: 50 testes reproduzíveis com SQLite real e migrações, TypeScript e build Worker passaram. Incluem concorrência, idempotência, saldo, isolamento de projetos, convites, último responsável, cancelamento e relatórios. Migrações aplicadas localmente e publicação nativa concluída. Revisão visual desktop e em iframe de 390 pixels, com dados locais de QA, sem login simulado na publicação. A versão hospedada respondeu HTTP 200 na entrada e 401 nos endpoints de gestão/exportação/anexos sem autenticação; a consulta de evento inexistente respondeu 404 pelo banco. Não houve teste em aparelho físico nem prova de login de visitante/entrega hospedada; a conta proprietária deve entrar pelo fluxo nativo normal.

Fundação/jogo livre: 33 testes e TypeScript passaram; proteção dos 12 arquivos passou novamente. O núcleo anterior em `lib/proex/access` permanece como trabalho independente; o runtime novo usa `apps/proex-portal/lib/access.ts`.

## Limites explícitos

Login Google/e-mail direto, envio automático de e-mails, verificação Meta de seguimento, sincronização automática Sheets, SEI/SIGAA e contribuições financeiras de alimentação não estão ativos. Não há credencial de instituição nesses serviços configurada para o portal. Consulte a ADR antes de retomar essas integrações.

A equipe precisa preencher saldos reais, ofertas, regulamentos e aviso de privacidade antes de ativar campanhas. Catálogo visual, Super Super Brinde, composição definitiva do planner, guarda dos dados e fluxo para menores continuam decisões institucionais. Produção não recebeu dados de demonstração nem histórico fabricado.

## Continuidade

Fonte publicada do portal: `e146d849e3f7ca87c471841a27f429b22c216905`, project_id `appgprj_6ad777bf0b288191a60d90401ac71d25`. O código público está em `apps/proex-portal`, sem histórico privado ou segredos. Validar código, escopos e regras; usar migrações novas; publicar no mesmo Site. Uma PR não substitui uma publicação verificada.
