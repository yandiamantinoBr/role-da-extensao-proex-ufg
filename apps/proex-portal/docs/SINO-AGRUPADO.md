# Sino agrupado por demanda

Incremento sobre `9e8f446`, sem migração ou alteração de e-mail/filas.

O inbox mantém `notifications`, `unread`, `hasMore` e `pending` compatíveis com clientes anteriores. Acrescenta `groups`, `windowLimit=100`, `viewerId`, `today` e `asOf`. Cada grupo contém título, estado, prazo, quantidade de atualizações/não lidas **na janela recente** e a última data dessa janela. Não existe total global de atualizações por demanda. `unread` continua sendo a contagem global completa dos avisos autorizados; pode superar a soma dos grupos visíveis.

As três consultas do inbox usam um único batch somente de leitura, com ACL, conta, organização e destinatário efetivo vigentes em cada SELECT. GET não marca avisos nem cria notificações. Os grupos são derivados das mesmas cem linhas recentes; não há consulta por grupo ou mudança no esquema. O cliente antigo ignora os campos novos; a UI nova também aceita ausência de `groups` e agrupa o array antigo localmente, sem inventar totais fora da janela.

`notification.read` aceita exatamente um seletor: `id`, `taskId` ou `all:true`. `read` continua booleano. Ao abrir um grupo, uma única operação marca todos os avisos próprios e atualmente autorizados daquela demanda, inclusive os anteriores à janela visível. Isso pode reduzir o contador global por uma quantidade maior que a contagem do grupo nesta janela. Outras pessoas/tarefas não são marcadas. Avisos já lidos conservam o `read_at` já registrado; marcar como não lido continua uma ação explícita suportada.

“Pendentes que você acompanha” esclarece que a lista inclui demandas criadas ou recebidas; autoria não é chamada de responsabilidade. O link “Meu trabalho” leva às atribuições explícitas. As contagens pessoais estritas, grants de trabalho e a elegibilidade de e-mail permanecem com sua semântica existente.

A UI mantém atualização moderada de sessenta segundos, pausa em aba oculta, deduplicação e descarte de requisições antigas. Marcação aborta a consulta anterior; uma resposta tardia não restaura contadores anteriores à leitura. Mudança de conta cancela a marcação em curso e respostas com outro `viewerId` são recusadas. Erro de acesso remove os dados do inbox exibido. Prazos vencidos usam `today` do servidor; sem esse campo legado, exibe-se apenas a data absoluta.

Testes sintéticos cobrem janela 100 versus contador global 151, contagem/ordenação por grupo, leitura em um UPDATE, timestamps preservados, seletores incompatíveis, outro usuário/projeto, conta bloqueada, equipe/atribuição removida, revogação antes do SQL, leitura atômica e corridas no cliente. As suítes de e-mail são reexecutadas, sem chamada real, para conferir que as filas não foram alteradas. CUA/build/publicação e revisão independente ficam a cargo do coordenador.
