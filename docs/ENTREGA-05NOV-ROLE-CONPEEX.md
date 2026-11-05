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

Head funcionaldc5796e: **1.237/1.237 testes**, tipos, builds Worker/Node e smoke autenticado aprovados. Lint:0erros e dois avisos antigos de img. CI42090990830 aprovou a primeira composição; CI42094055194 aprovou o head finaldc5796e. Ensaio autenticado descartável passou por criação/edição/conflito, confirmação/realização/desfazer/cancelar/reabrir, vínculo/desvínculo/revínculo,15sessões, downloads dos três formatos e transferência com mesmoID/campos/histórico/estoque.

[Capturas e recibo](evidencias/2026-11-05-role-conpeex/README.md):390/1366px, claro/escuro, sem overflow ou alvo interativo inferior a44px nos painéis. Zero errosJS e zero solicitações externas no ensaio. Os arquivos baixados foram inspecionados localmente; isso não comprova arquivo salvo em produção ou gesto físico Android.

Revisões independentes de segurança corrigiram dados concorrentes não exibidos, edição parcial apagando campos, arquivamento, no-op com auditoria, campos excessivos e corridas entre transferência e delegação. Encerramento semP0/P1/P2; [parecer e limitações](REVISAO-05NOV-ROLE-CONPEEX-SEGURANCA.md). Críticas visuais iniciais6/10 e8/10 foram preservadas e levaram a correções. O horário provisório agora também é marcado como sugerido em PDF/XLSX/DOCX; o teste novo cobre os três arquivos. [Aceite independente](REVISAO-05NOV-ROLE-CONPEEX-DESIGN-ACEITE.md):9/10, semP0/P1/P2 no escopo inspecionado. P3cosméticos e limites constam do parecer.

## Publicação e operação real — 2026-11-05

PR37 integrada em **5ad7025d58a7d3351edc301377c72079ed0cb961**, Vercel **dpl_FnF94q2dLgVWgLgVyo1993UUcawo READY** no mesmo SHA, alias oficial confirmado. Chrome autenticado exibiu5ad7025 e confirmou a nova interface. Saúde200/no-store; novas APIs com consulta bem formada sem sessão401/no-store. Consulta sem os argumentos necessários retorna400, sem dados.

As nove demandas operacionais foram transferidas pela interface normal, com o mesmo ID e os valores dos campos comparados antes/depois. Todas conservaram a versão1 e receberam a versão2 de transferência. As duas atribuições existentes foram mantidas; não se modificou estoque, prioridade, prazo ou situação, não se apagaram registros nem se enviou e-mail real. Os registros anteriores do destino foram preservados. Contagens continuaram no mesmo arquivo e aba em uso.

A dinâmica foi criada em rascunho sob Rolê e vinculada ao CONPEEX anfitrião. Quinze sessões permanecem provisórias, com início/fim vazios e notas de planejamento. Sexta13/11 é explicitamente condicional. A janela legada do rascunho usa extremos oficiais9–12/11 e deverá ser revista se a operação de sexta for confirmada; não representa atividade contínua. Ofertas e repetição não foram definidas; nenhum jogo foi ativado. Recarregar confirmou a persistência.

A mestre foi atualizada pelo menu PROEX→Sincronizar agora, sem instalação, nova credencial ou mudança de permissões. Releitura confirmou **35tabelas**, verified/completed em **19:45:23.914Z**, nove demandas com projetoRolê/versão2 e a campanha draft. Essa conferência não ativa integração do arquivo manual de contagem nem projeta automaticamente a programação nova. [Recibo sem dados pessoais](evidencias/2026-11-05-role-conpeex/production-verification.json). IDs, campos reais, arquivo e capturas de produção permanecem somente na Vault/espaço privado.

## Limites e continuidade

O mesmo arquivo de brindes permanece uma referência manual compartilhada, sem alteração de proprietário, acesso ou pasta. A aba auxiliar de programação não comprova entregas nem altera estoque. Integração bidirecional desse arquivo exige mapear colunas, versões e ACL antes de ativar rotinas que poderiam regravar contagens em uso.

O calendário oficial do Espaço Extensão publica Rolê em9–12/11;13/11 permanece proposta interna a confirmar. [Fontes, frentes e modelo operacional](CONPEEX-2026-OPERACAO-E-FONTES.md). Plateia foi lido no perfil de inscrito, sem comprovação de acesso administrativo. Os demais pedidos continuam em REQUISITOS-E-CONTINUIDADE e na Vault; esta entrega não atribui nota global ao site.
