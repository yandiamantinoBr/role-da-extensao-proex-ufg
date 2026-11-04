# Revisão da Agenda e triagem dos módulos

Revisão de 04/11/2026, partindo do merge `249bdaa`. A bancada usou um banco descartável com materiais, empréstimo, dinâmica e registro fictícios. O Chrome de teste abriu em perfil separado, com solicitações externas bloqueadas.

## Agenda

Quem chega pela ficha do projeto precisa encontrar os compromissos desse projeto de imediato. Quem toca ou ativa um dia precisa ver a lista do dia e conseguir voltar à grade pelo teclado ou pelo toque.

- A rota `/?module=calendar&project=…` agora usa o projeto autorizado como recorte. A unidade também acompanha a navegação quando definida. Um recorte só por unidade exige escolher um projeto para criar uma assinatura. Categoria e datas continuam configuráveis na Agenda.
- Área temática e unidade não informada são filtros dos outros módulos. A Agenda usa unidades cadastradas e compatíveis com sua consulta.
- O download `.ics` usa os mesmos filtros da consulta. As regras de acesso do servidor e o formato de assinatura continuam os existentes.
- Selecionar um dia leva o foco ao título da lista. **Ver todo o período** limpa a seleção e devolve o foco ao dia de origem. A quantidade de registros é anunciada e aparece na grade móvel sem depender dos pontos de cor.
- No tema escuro, os marcadores agora usam as cores dos tokens de tema. No build anterior, roxo e azul tinham contrastes de aproximadamente 1,42:1 e 2,69:1 sobre o fundo do cartão.

No build candidato, o Chrome confirmou a consulta e o link `.ics` com projeto e unidade. Limpar o projeto manteve a unidade na URL e na consulta. O toque a 390 px e o teclado a 1366 px focaram o título, trouxeram o primeiro compromisso à tela e retornaram ao botão do dia ao limpar a seleção. Os dois temas passaram em cada largura, sem rolagem horizontal da página. A largura medida do botão do dia a 390 px passou de 44,28 a 46,28 px. O primeiro compromisso ficou visível a 158 px do topo no celular e a 164 px no desktop.

O build Node, a verificação de tipos, o lint focal e 33 testes de Agenda, ficha de projeto e regras de calendário passaram. O ensaio foi local e não usou Google Calendar real.

A revisão independente do recorte atribuiu **9,1/10** às capturas verificadas e confirmou o fechamento do problema de recorte por unidade. Contagens e marcadores continuam compactos e os títulos da grade desktop podem ser truncados. A lista exibe o texto completo. Aparelhos de 320 px e leitor de tela não foram avaliados nesta rodada.

## Triagem dos 13 módulos

No build anterior à correção, os 13 módulos abriram em 390 × 844 e 1366 × 920, em claro e escuro, com 52 verificações de título, tema, alertas visíveis e largura. Nenhuma página excedeu a largura da janela. A revisão por captura se concentrou em Agenda, Materiais, Empréstimos e Registros. Em 390 px, uma tabela de Materiais e duas de Relatórios ainda tiveram rolagem dentro de seus contêineres.

| Módulo | Achado e próximo critério de aceite |
| --- | --- |
| Materiais | No celular, o catálogo fica abaixo do cartão de acompanhamento e das ferramentas de assistente e importação. Na janela ampla, o cartão de cadastro patrimonial termina colado ao título de Materiais e estoque. Priorizar consulta e saldo disponível na primeira área útil, agrupar ferramentas administrativas e conferir o espaço entre cartão e seção. |
| Empréstimos | A retirada e seu estado aparecem no cartão. **Reservar equipamento** fica depois da lista e seus detalhes. Acrescentar um atalho de criação no cabeçalho quando houver permissão e preservar a revisão da disponibilidade no formulário. |
| Registros | **Novo registro** desmonta o disparador e abre o formulário abaixo dos filtros sem mover o foco. Ao fechar, o foco também não é restituído. As contagens no gráfico mensal só aparecem no hover. Levar o foco ao título do formulário, devolver ao disparador e exibir as contagens também por toque e teclado. |

A triagem foi feita como responsável institucional, com a base sintética e os estados que ela oferece. O resultado é de abertura e geometria, com leitura visual concentrada nas quatro telas. A cobertura completa por papéis, estados de erro, interações secundárias e aparelhos físicos continua em revisões próprias.
