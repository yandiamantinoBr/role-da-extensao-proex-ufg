# Rolê no CONPEEX: responsabilidade, programação e migração

O projeto que executa uma dinâmica agora pode ser distinto do evento que a recebe. A programação mantém o projeto responsável, registra anfitriões sem conceder acesso e aceita sessões provisórias sem inventar horários. Demandas simples podem mudar de projeto conservando ID, conteúdo, situação, prioridade, prazos, responsáveis e histórico.

## Critério de aceite

Preservar o arquivo de contagem em uso, seus links, abas e linhas; vincular o Rolê como responsável e o CONPEEX como anfitrião; transferir apenas as demandas correspondentes pelo fluxo auditado, depois da publicação. Não ativar jogo, alterar estoque, criar ofertas, inventar responsáveis ou apresentar uma referência manual como sincronização automática. A proposta de três rodadas por dia continua sujeita a confirmação.

## Implementação

- Migração0030: três tabelas novas vazias para planejamento, anfitriões e sessões. Datas civis brasileiras, horas opcionais em propostas, estados com ícones/texto/cor, edição com versão e recuperação de conflito. Projeto arquivado fica somente leitura. Anfitrião exige gestão atual nos dois projetos e não herda dados/ACL.
- Migração0031: recibo imutável de transferência, gestão atual na origem e destino da mesma organização, transação e idempotência. Nenhuma migração aplicada foi editada. O trigger de escopo foi substituído de forma aditiva, conservando suas validações e autorizando a transição apenas com recibo correspondente.
- Transferência inicial abrange demandas simples. Vínculos com campanha, material, empréstimo e checklist bloqueiam a transferência. Atribuições e histórico permanecem; acessos incompatíveis são revogados sem apagar seus registros. Fila de e-mail pendente do contexto antigo é cancelada, entregues/incertas mantidas; novos avisos somente dentro do aplicativo. Não concede papéis nem envia e-mail real nesta operação.
- PDF com identidade PROEX/UFG e resumo, DOCX e XLSX sem botões CSV; projeção explícita de sete campos, fórmulas inertes e duas leituras atuais ao exportar. O PDF de15sessões usa tabela compacta de duas páginasA4; relatórios existentes mantêm seu comportamento padrão.
- Modelo/snapshots/journal reconciliados:108tabelas. Backup integral inclui as quatro tabelas novas; projeção curada da mestre não recebe recibos, histórico privado ou programação automaticamente.

## Verificação local

Composição refinada após6dc7eac: **1.237/1.237 testes**, tipos, builds Worker/Node e smoke autenticado aprovados. Lint:0erros e dois avisos antigos de img. CI42090990830 aprovou a primeira composição; o novo head ainda precisa de CI próprio. Ensaio autenticado descartável passou por criação/edição/conflito, confirmação/realização/desfazer/cancelar/reabrir, vínculo/desvínculo/revínculo,15sessões, downloads dos três formatos e transferência com mesmoID/campos/histórico/estoque.

[Capturas e recibo](evidencias/2026-11-05-role-conpeex/README.md):390/1366px, claro/escuro, sem overflow ou alvo interativo inferior a44px nos painéis. Zero errosJS e zero solicitações externas no ensaio. Os arquivos baixados foram inspecionados localmente; isso não comprova arquivo salvo em produção ou gesto físico Android.

Revisões independentes de segurança corrigiram dados concorrentes não exibidos, edição parcial apagando campos, arquivamento, no-op com auditoria, campos excessivos e corridas entre transferência e delegação. Encerramento semP0/P1/P2; [parecer e limitações](REVISAO-05NOV-ROLE-CONPEEX-SEGURANCA.md). Críticas visuais iniciais6/10 e8/10 foram preservadas e levaram a correções. O horário provisório agora também é marcado como sugerido em PDF/XLSX/DOCX; o teste novo cobre os três arquivos. Nova crítica de aceite em andamento; não atribuir nota9antes do parecer.

## Publicação e operação real

PR37 inicialmente em rascunho. Não confundir os testes locais acima com publicação ou com transferência das nove demandas reais. O recibo final de merge/deploy e da migração será acrescentado após a confirmação. IDs e dados operacionais privados permanecem na Vault.

## Limites e continuidade

O mesmo arquivo de brindes permanece uma referência manual compartilhada, sem alteração de proprietário, acesso ou pasta. A aba auxiliar de programação não comprova entregas nem altera estoque. Integração bidirecional desse arquivo exige mapear colunas, versões e ACL antes de ativar rotinas que poderiam regravar contagens em uso.

O calendário oficial do Espaço Extensão publica Rolê em9–12/11;13/11 permanece proposta interna a confirmar. [Fontes, frentes e modelo operacional](CONPEEX-2026-OPERACAO-E-FONTES.md). Plateia foi lido no perfil de inscrito, sem comprovação de acesso administrativo. Os demais pedidos continuam em REQUISITOS-E-CONTINUIDADE e na Vault; esta entrega não atribui nota global ao site.
