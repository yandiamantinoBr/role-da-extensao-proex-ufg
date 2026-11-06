# Avisos de estoque na campainha

Migração0034 mantém episódios de baixo estoque e recibos individuais no banco. Não envia e-mail, não cria conta/convite e não altera a planilha ou o livro de movimentações.

## Quando nasce e termina

- Disponível = saldo físico menos quantidade reservada. Abrir episódio exige cruzamento real de **acima do mínimo** para **no mínimo ou abaixo** em uma nova movimentação manual do Portal, ou ajuste do mínimo no cadastro. Equipamentos e materiais inativos são excluídos.
- Cadastro inicial zerado, leitura da página e instalação da migração não criam avisos. Registros já baixos permanecem apenas nos indicadores visuais até uma recuperação e um novo cruzamento.
- Um índice permite só um episódio aberto por material. Repetir a mesma movimentação ou continuar consumindo abaixo do mínimo não repete o aviso.
- Reposição, redução do mínimo ou liberação real de reserva que deixe o disponível acima do mínimo resolve o episódio. Desativar o material também resolve. O próximo cruzamento recebe novo identificador e novos recibos.
- Criar uma reserva, por si só, não abre episódio neste primeiro incremento. Liberá-la pode resolver um episódio já aberto; isso é uma recuperação de disponibilidade, não uma entrada física.
- Entrega de prêmio libera reserva e depois registra a saída no mesmo batch. Esse saldo intermediário não é reposição. O gatilho reconhece entrega `consumed`/`delivered` ainda sem sua linha `prize:*`; o movimento de resgate não é uma movimentação manual geradora de episódio. O disponível líquido não cria nem resolve aviso nessa transição.

Os gatilhos usam OLD/NEW reais da transação. Não dependem de um saldo lido antes do batch e não alteram a ordem das instruções de auditoria/sincronização dos serviços existentes. Rollback da movimentação também desfaz o episódio.

## Quem recebe

Consulta dinâmica exige, simultaneamente:

1. Conta ativa, já ativada e não anonimizada.
2. Acesso vigente de leitura de materiais ao projeto.
3. Designação explícita e vigente para o material, área de materiais ou projeto, diretamente ou por equipe ativa da mesma organização.

Cargo, pré-cadastro, autoria da movimentação e função de administrador não substituem a designação. Remover acesso/designação ou bloquear a conta oculta imediatamente o aviso nas novas consultas. Sobreposição entre equipes não duplica episódios.

## Recibos e API privada

- `GET /api/material-attention?includeDismissed=false&before=<sequence>`: até seis avisos, totais autorizados e limite da próxima página. Sem filtro de usuário fornecido pelo cliente.
- `POST /api/material-attention`: `{action: 'read' | 'dismiss' | 'restore', episodeIds: [...], operationKey}`. Até seis episódios, apenas do usuário autenticado e com elegibilidade novamente conferida no batch.
- Marcar lido, dispensar e reexibir altera somente o recibo daquele usuário. “Ler esta página” usa os identificadores consultados; avisos que chegarem depois não são marcados por acidente.
- Dispensa não resolve o problema de estoque para a equipe. Recuperação resolve o episódio; seu registro e os recibos anteriores permanecem preservados.
- As ações são idempotentes e auditadas sem títulos ou contatos na auditoria geral. Recibos são privados. Todas as respostas, inclusive erros, são `private, no-store`.

`MaterialAttentionInbox` recebe `userId`, `onUnreadChange?` e `onOpenMaterial?`. Atualiza ao montar, ao recuperar foco e no evento `proex:material-attention-changed`. A campainha integra o contador e o caminho de abertura do material. A consulta é repetida antes de confirmar uma gravação na interface.

## Verificação do incremento

18 testes próprios cobrem gatilhos, API, ACL, recibos, interfaces e transições tardias. O ensaio de entrega usa `participation.ticket` → `participation.physical` → `prize.redeem` reais, com e sem episódio prévio. O conjunto final com diretório, rastreio e paridade Drizzle/SQL passou 49 testes. Tipos e lint focal passaram. Publicação, testes no navegador do build final e migração real dependem do recibo da coordenação; este documento descreve implementação local, não comprova deploy.
