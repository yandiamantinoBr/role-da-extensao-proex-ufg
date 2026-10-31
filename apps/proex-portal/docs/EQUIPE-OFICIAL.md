# Referência pública da equipe PROEX

O catálogo local de `lib/catalog/proex-team.ts` foi conferido em **31/10/2026** contra a página oficial [Equipe PROEX](https://proex.ufg.br/p/equipe-proex), que informa atualização em **05/10/2026 às 16:43**. Ele contém 31 pessoas publicadas diretamente nessa página. As equipes das estruturas vinculadas apontadas por links têm listas próprias e não foram incorporadas.

São usados somente nomes, setores, atuação ou designação profissional quando expressamente informada, e-mails institucionais publicados e metadados de fonte. Não foram copiados telefones, fotos ou biografias. Campos de atuação ausentes permanecem vazios; não se deduz cargo pelo nome, pela posição na lista ou pelo endereço de e-mail.

O componente `OfficialTeamDirectory` pesquisa localmente por nome, setor, atuação e e-mail, sem requisitar o site durante o uso. A data de verificação é exibida e a interface declara que a lista não é consultada ao vivo. Atualizar a referência exige nova conferência da fonte e revisão do arquivo; o catálogo não é uma integração automática de identidades.

Na linha de Nathália Rezende Magalhães, a fonte publica o domínio `discete.ufg.br`. O texto foi preservado, marcado para conferência e excluído do preenchimento de convites. Não foi inventado um endereço substituto. Para Heliza Mábily, usa-se apenas seu próprio endereço publicado; o contato de outro integrante entre parênteses não é tratado como se fosse dela.

## Preenchimento de convite

O componente recebe `onSelect(selection)`; a escolha contém apenas ID da referência, nome, e-mail, URL e data da fonte, além de uma chave local de seleção. `TeamPanel` recebe `officialSuggestion` e `onClearOfficialSuggestion`. O catálogo não cria usuários, não envia mensagens, não gera convites nem chama APIs ao selecionar uma pessoa.

O nome aparece como referência de conferência, sem ser enviado no pedido de convite ou gravado como perfil. O próprio integrante define seu perfil na ativação. E-mail e cargo não estabelecem identidade nem autoridade. O preenchimento aceita somente endereços explicitamente publicados e habilitados no catálogo, nos domínios `ufg.br` e `discente.ufg.br`; essa verificação não concede função ou acesso.

Após selecionar, **projeto e função começam vazios e são obrigatórios**. O fluxo oficial exige um projeto específico, sem alternativa de acesso global, e não restaura rascunhos antigos de projeto ou função. Só o envio explícito do formulário pode chamar a operação existente de convite, sujeita à autorização no servidor. Convites manuais continuam aceitando pessoas externas; o domínio delas não determina papel.
