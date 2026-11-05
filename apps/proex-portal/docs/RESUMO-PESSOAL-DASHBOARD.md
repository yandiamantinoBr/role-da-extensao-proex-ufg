# Resumo pessoal no início

Estado2026-11-05: entregue na PR36, mergeb94814c, CI42077711627 com1196testes e dois alvos aprovados, Chrome autenticado conferido. Pareceres e limites atuais em `docs/ENTREGA-05NOV-RESUMO-E-ESTRUTURA.md` na raiz. Os checkpoints de implementação abaixo são históricos; o escopo completo continua aberto para ativações externas e refinamentosP3.

## Objetivo e contrato · 2026-11-05

Para quem entra no portal para saber o que precisa fazer: mostrar totais pessoais pequenos e links para o filtro correspondente em Meu trabalho. O quadro de alertas de estoque, empréstimos e dinâmicas tem outro escopo e deve ser identificado como operacional.

`GET /api/my-work/summary` usa a sessão atual, aceita somente `organizationId` e `projectId` opcionais e devolve resposta privada, sem cache. A lista permitida contém versão, identidade do destinatário para rejeitar respostas antigas, horário/dia de Brasília, escopo, seis totais de demandas e quantidade de designações ativas. Não contém títulos, textos livres, nomes, contatos, IDs de demandas, páginas ou listas. Nenhum campo é acrescentado ao DTO global do portal.

Os predicados e os agregados foram extraídos do serviço de Meu trabalho para `lib/my-work/queries.ts`, sem mudar suas condições: atribuição direta ou por equipe, acesso vigente à organização/projeto, conta ativa e `COUNT(DISTINCT ...)`. Ser de uma equipe não concede acesso. Uma atribuição direta e duas equipes na mesma demanda contam uma vez.

O serviço executa duas leituras em lote, com três consultas cada. A segunda é a última operação assíncrona: repete os totais e a prova interna das concessões, organizações, projetos e vínculos ativos. A identidade e as concessões capturadas pelo serviço de sessão são comparadas com a primeira leitura. Perda parcial de acesso, mesmo sobrando outro projeto autorizado, descarta toda a resposta com 403. Mudança de atribuições/totais entre leituras devolve 409. Esses estados não são convertidos em zero pendências. A prova interna nunca sai na resposta.

O escopo pessoal usa organização/projeto quando informados. Unidade e área temática não reduzem as atribuições pessoais. Os cartões Atenção, Prazo hoje, Pendentes e Em andamento podem se sobrepor; não são partes de uma soma ou percentual.

## Verificação do backend

- 9 testes focais novos: equivalência com Meu trabalho, duas organizações, projetos diferentes, deduplicação, vazio autorizado, sessão ausente, revogação parcial no último lote, conta/organização/concessão/afiliação/projeto alterados, mudança de atribuição, contrato estrito e HTTP privado.
- 16 testes antigos de Meu trabalho repetidos após a extração dos predicados, sem mudança de comportamento.
- Ensaio sintético em SQLite em memória: 182 demandas, seis instruções SELECT, resposta de 302 bytes, nenhuma escrita; 6,52 ms na rodada observada. Não mede rede ou produção e não é promessa de latência.
- A implementação não cria auditoria, recibo, notificação, credencial, disparo de e-mail ou chamada Google/IA.

## Próxima etapa deste recorte

Ligar os cartões aos filtros validados de Meu trabalho no histórico/URL; distinguir erro, carregamento e zero; mostrar última consulta; descartar respostas antigas por conta/contexto; atualizar por eventos/foco/virada do dia sem consulta periódica persistente. Conferir 375/390/1366 px, dois temas, teclado, navegação Voltar/reload e revisão independente antes da integração. A primeira entrega deste documento é de backend; não comprova interface ou produção.


## Interface integrada · 2026-11-05

Os cartões já estão ligados ao Início e aos filtros validados de Meu trabalho. Exibem traço durante consulta ou erro, quatro totais com ícones e cores semânticas nos dois temas, recorte e última consulta em Brasília. Status sobrevive à URL/recarga e ao histórico; filtro direto/equipe permanece independente. Eventos, foco e mudança do dia atualizam o resumo sem polling persistente.

A retomada pelo histórico recebeu época nova de leitura para não reapresentar a resposta antiga de um status já visitado. Cancelamento em layout e comparação da chave atual protegem respostas e exportações. A suíte focal de resumo/navegação passou 45 testes. No navegador local, seis contextos (375/390/1366 px, dois temas), 24 aberturas por cartão e recarga/Voltar/Avançar passaram. Quatro cartões em desktop e dois por linha no mobile, alvos de pelo menos44px medidos e zero overflow/erroJS. Erro403 de transporte simulado não exibiu zero. São provas sintéticas locais; revisão independente final e produção ainda pendentes.
