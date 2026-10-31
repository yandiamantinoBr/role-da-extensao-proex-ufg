# Agenda privada: interoperabilidade e continuidade

Checkpoint local de 31/10/2026, baseado em `3608f55`. Publicação e nova assinatura no Google ainda precisam ser verificadas pelo coordenador. Nenhuma URL privada, credencial ou conteúdo de agenda real foi usado nestes testes.

## Problema observado e diagnóstico

O usuário relatou a mensagem “Unable to add calendar. Check the URL.” ao usar o botão de assinatura de Projetos e eventos. A causa específica da rejeição pelo Google ainda não foi demonstrada. O `cid` anterior fazia round-trip correto de uma URL sintética; isso não comprova um contrato oficial de assinatura para esse parâmetro.

Um GET anônimo com token deliberadamente inexistente chegou ao endpoint canônico e respondeu 404 JSON `calendar_feed_unavailable`, sem redirecionamento de login. Esse diagnóstico não comprova acesso pelos servidores do Google nem valida o link real.

## Correções locais

- O botão abre a tela **Do URL** indicada pela [ajuda oficial do Google](https://support.google.com/calendar/answer/37100?hl=pt-BR). A pessoa copia a URL HTTPS privada, abre essa tela na conta desejada, cola e confirma. Abrir a tela não conclui a assinatura. Não há novo OAuth nem edição do portal pelo Google.
- O ICS deixa de anunciar `METHOD:PUBLISH`: ele é uma projeção de leitura, sem organizador ou transação iTIP. O corpo passa a corresponder ao MIME `text/calendar; charset=utf-8`, sem parâmetro `method`. Referências: [RFC 5545, §3.7.2](https://www.rfc-editor.org/rfc/rfc5545.html#section-3.7.2) e [§8.1](https://www.rfc-editor.org/rfc/rfc5545.html#section-8.1).
- Uma agenda sem eventos contém um `VTIMEZONE` UTC exato, com `STANDARD` de deslocamento zero, em vez de um `VCALENDAR` sem componentes. Isso atende à estrutura da [RFC 5545, §3.6](https://www.rfc-editor.org/rfc/rfc5545.html#section-3.6) sem inventar eventos ou disponibilidade. Os horários dos eventos continuam UTC e a preferência de exibição continua Brasília. Aceitação de zero eventos no Google ainda requer teste real.
- Antes de liberar a projeção de um feed, uma consulta SQL fresca confirma novamente hash do bearer, validade, revogação, conta ativa e autoridade atual. Um feed geral exige owner da plataforma; owner local não o substitui. Registros ligados a empréstimos exigem `loans.read` fresco tanto na consulta quanto na verificação final dos registros emitidos.

O bearer continua aleatório, somente seu hash fica no banco, e a URL aparece apenas na criação. Não há dependência de cookie no feed. A resposta mantém `private, no-store`, `no-referrer`, `nosniff` e `noindex, nofollow`. Os limites de período, quantidade de registros, assinaturas e expiração não foram ampliados. Revogar bloqueia novas consultas; o provedor pode conservar cópias já recebidas.

## Provas e próximo gate

Os testes sintéticos executam os módulos e as rotas reais com SQLite em memória e todas as migrações. Cobrem ICS vazio/preenchido, CRLF e dobramento UTF-8, anonimato com bearer, escopos A/B, expiração, revogação durante a última consulta, bloqueio da conta, perda de owner global e perda de `loans.read`. O teste do componente verifica criação, cópia explícita da URL, abertura da tela oficial e ausência de link fabricado após erro.

O coordenador deve conferir o GET real sem cookie registrando somente status, tipo e tamanho de resposta, quantidade de componentes e eventual código de erro; não registrar URL, bearer ou conteúdo. Depois deve testar **Do URL** na conta autorizada, confirmar exibição e eventual atualização de um dado permitido. Conferir também expiração/revogação com fixture apropriada. O agendamento de atualização pertence ao Google e não tem prazo garantido pelo portal. Se a rejeição persistir, preservar os metadados seguros e investigar transporte/conteúdo sem tornar a agenda pública ou afrouxar a ACL.
