# V18 · detalhe da demanda

Na validação do piloto de e-mail, clicar no cartão de uma demanda já aberta apagava o detalhe. Como a seleção mantinha o mesmo ID, nenhuma consulta era iniciada para recuperá-lo. O cartão permanecia expandido sem conteúdo.

O clique repetido preserva o detalhe e a consulta em andamento. Se uma mudança de endereço está prestes a selecionar outra demanda, o clique mais recente mantém a demanda escolhida e atualiza o endereço. Trocas de demanda ou organização continuam invalidando as respostas anteriores.

As regressões cobrem detalhe aberto, consulta em andamento, seleção após criar uma demanda, navegação A → B → A e mudança de organização. Os testes exercitam a mudança de endereço antes e depois de o temporizador enfileirar a seleção, com o detalhe carregado e com consulta ativa. Os 18 testes focados passaram em Node 24 e 26, além de tipos e lint dos arquivos alterados.

O [registro da V17](ENTREGA-V17.md) confirma o piloto, a demanda concluída e as execuções automáticas dos avisos verificadas em 04/11. O suporte a dias inteiros para o cronograma do CONPEEX é uma mudança separada.
