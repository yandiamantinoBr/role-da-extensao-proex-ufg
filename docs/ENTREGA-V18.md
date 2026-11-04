# V18 · detalhe da demanda

A [PR #19](https://github.com/yandiamantinoBr/role-da-extensao-proex-ufg/pull/19) foi integrada em 04/11/2026 às `13:36:45Z` no commit `de942bf60908a5e67b14e5ff295571928e1959a7`. Vercel `dpl_2dDZyVyN4z8tvMcTLgWg8kybSEKg` READY no mesmo commit. CI aprovou 865 testes do portal e 33 do jogo, com tipos e builds Worker/Node.

Na validação do piloto de e-mail, clicar no cartão de uma demanda já aberta apagava o detalhe. Como a seleção mantinha o mesmo ID, nenhuma consulta era iniciada para recuperá-lo. O cartão permanecia expandido sem conteúdo.

O clique repetido preserva o detalhe e a consulta em andamento. Se uma mudança de endereço está prestes a selecionar outra demanda, o clique mais recente mantém a demanda escolhida e atualiza o endereço. Trocas de demanda ou organização invalidam as respostas anteriores. Uma consulta rejeitada limpa o detalhe até uma resposta válida da mesma demanda.

As regressões cobrem detalhe aberto, consulta em andamento, seleção após criar uma demanda, navegação A → B → A e mudança de organização. Os testes exercitam a mudança de endereço antes e depois de o temporizador enfileirar a seleção, inclusive quando a atualização retorna 403. Os 19 testes focados passaram em Node 24 e 26, além de tipos e lint dos arquivos alterados. A revisão independente confirmou quatro cenários próprios. Em produção, a demanda operacional existente abriu pelo link e permaneceu expandida com seu detalhe visível após clicar novamente no cartão.

O [registro da V17](ENTREGA-V17.md) confirma o piloto, a demanda concluída e as execuções automáticas dos avisos verificadas em 04/11. O suporte a dias inteiros para o cronograma do CONPEEX é uma mudança separada.
