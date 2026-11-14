# Google Drive por pessoa e registro de pastas

Escrito em 2026-11-09. Pedido do Yan: as pessoas e o Rolê precisam salvar arquivos nas pastas certas do Drive da PROEX, "sem que aconteça nada de errado". Este documento não contém chaves, e-mails nem dados de pessoas.

## 1. A decisão: cada pessoa conecta a própria conta

| Caminho | Por que não (ou sim) |
|---|---|
| **Conta Google de cada pessoa (OAuth, escolhido)** | O arquivo sai com o nome de quem enviou. Ninguém ganha acesso a pasta que já não tinha: o Drive confere a permissão da própria pessoa. O histórico do Drive e o do portal mostram a mesma autoria. |
| Conta central ou "e-mail do agente" | Uma conta com acesso a todas as pastas vira chave-mestra: quem usa o portal passaria a gravar onde não pode, e a autoria se perde. |
| Conta de serviço | Não tem cota no "Meu Drive" e exige drive compartilhado com a conta adicionada como membro; mesma chave-mestra. |
| Apps Script da planilha (caixa de saída) | Grava com a conta de quem instalou o script (hoje, a do Yan). Serve para o backup, não para envios das pessoas. |

O Rolê não tem conta própria: ele age **com a conexão da pessoa que pediu**, sempre com prévia e confirmação dela.

## 2. Escopo mínimo: `drive.file` com o seletor do Google

Lido na documentação oficial em 2026-11-09:

- `drive.file` é **não sensível** e permite "criar arquivos novos no Drive" e mexer nos arquivos "que a pessoa compartilha com o app pelo Google Picker". Não exige a verificação longa dos escopos sensíveis ou restritos. [Escolher escopos da Drive API](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- `files.create` aceita `drive.file`; a pasta de destino vai em `parents`, e `supportsAllDrives=true` habilita drives compartilhados. [files.create](https://developers.google.com/drive/api/reference/rest/v3/files/create)
- O seletor permite escolher pastas (`DocsView.setSelectFolderEnabled`), mostrar drives compartilhados (`setEnableDrives`) e limitar a vista a um id (`setFileIds`). [DocsView](https://developers.google.com/workspace/drive/picker/reference/picker.docsview)
- O blog oficial de desenvolvedores do Google descreve exatamente este uso: com o Picker escolhendo o destino, o app só precisa de `drive.file` para gravar na pasta escolhida ("Selecting Upload Destinations with the Picker API", 2013).

**Ressalva honesta:** as páginas de referência atuais não dizem, com todas as letras, que escolher uma *pasta* no seletor libera *criar arquivos dentro dela*. O blog oficial diz, e é o uso comum, mas a confirmação final é o teste de aceite da seção 6, que depende da configuração do Yan. Se o teste falhar, a alternativa de menor escopo é pedir `drive` só para a administração (escopo restrito, exige verificação e o OK do Yan); **nada disso foi feito**.

Consequência prática do `drive.file`: a liberação vale **por pessoa e por app**. Quando a administração cadastra uma pasta, só a conta dela fica liberada. Cada pessoa precisa, no primeiro envio, abrir o seletor já filtrado na pasta registrada e clicar em **Selecionar** (um clique). O portal guarda essa confirmação; se a pessoa trocar de conta Google, confirma de novo.

## 3. Como funciona na tela

**Conta › Google Drive** (cada pessoa)
- Conectar conta Google (abre o Google; volta para o portal). Trocar de conta.
- **Desconectar deste portal**: apaga a autorização guardada. **Desconectar e revogar no Google**: pede ao Google para cancelar a autorização e só então apaga. Se o Google não responder, nada é apagado e a tela avisa.
- Pastas que a pessoa pode usar, com "Liberar no Google" nas que ainda não confirmou.
- Os próprios envios recentes, com link para abrir no Drive.

**Configurações › Dados e cópias › Pastas do Drive** (administração)
- Cadastrar pasta: escolher no Google, dar nome, finalidade, unidade (opcional), projeto (opcional) e **quem pode usar**: toda a organização, a equipe de um projeto ou só gestão (donos e gestores).
- Editar, arquivar (ninguém envia mais; o histórico fica) e reativar. Edição confere a versão para não sobrescrever o trabalho de outra pessoa.
- Histórico de envios da organização: quem, o quê, para qual pasta, se foi pelo Rolê, link.

**Enviar ao Drive** (botão ao lado de cada foto de material, anexo de registro e termo de empréstimo)
1. Escolher a pasta (o portal sugere pelo projeto, pela unidade e pelas palavras do pedido; se houver dúvida, pergunta) e o nome do arquivo.
2. Conferir: pasta, nome, origem, conta que vai enviar.
3. Confirmar. O link do Drive aparece na hora e o envio vai para o histórico.

## 4. Para o Rolê (`POST /api/drive/save`)

A mesma função atende a tela e o Rolê; o campo `via` diferencia. Todas as chamadas exigem `X-Proex-Action: 1` e a mesma origem.

| `action` | Entrada | Saída |
|---|---|---|
| `options` | `source`, `hint` (o pedido da pessoa) | `connection` (`status`, `href` para conectar), `folders` (com `confirmedByMe`), `suggestion` (`folderId`, `reason`, `ask`), `fileName` |
| `prepare` | `source`, `folderId`, `fileName`, `via: 'role'` | `planToken` (10 min, preso à pessoa) e `preview` |
| `apply` | `planToken` (JSON) ou, para foto mandada no chat, multipart com `action=apply`, `planToken` e `file` | `upload` com `webViewLink` |

- `source`: `{kind:'record_attachment'|'loan_document', id}` ou `{kind:'upload', name, mime, bytes, sha256, projectId?}`. Tipos aceitos: PDF, JPG, PNG, WebP, até 4 MB.
- Quando `suggestion.ask` vier preenchido, o Rolê **pergunta** em vez de escolher. Mesmo com sugestão, a pessoa confirma a prévia.
- **O `planToken` nunca vai para o modelo.** Quem chama `apply` é o clique da pessoa no cartão do Rolê (na tela), nunca a resposta do modelo; assim um texto injetado num anexo não consegue confirmar um envio sozinho. O campo `via` só descreve o caminho e não dá permissão.
- Erros que pedem ação da pessoa (`drive_connect_required`, `drive_reconnect_required`, `drive_folder_confirm_required`) trazem `href` com o endereço da tela certa.
- Códigos que o Rolê deve tratar: `drive_connect_required` e `drive_reconnect_required` (mandar para Conta › Google Drive), `drive_folder_confirm_required` (liberar a pasta na tela), `drive_permission_denied` (a conta da pessoa não grava ali), `drive_folder_public` (pasta aberta a qualquer pessoa com o link: bloqueada), `drive_plan_invalid` (preparar de novo).
- Não existe ação de apagar, mover ou compartilhar no Drive.

Código: `lib/google-drive/save.ts`; rota: `app/api/drive/save/route.ts`.

## 5. Segurança

- **Token de atualização** cifrado com AES-GCM, chave derivada de `PROEX_KEYS_SECRET` (o mesmo cofre da central de chaves, com domínio próprio) e preso à pessoa e à conta Google. Durante a rotação, `PROEX_KEYS_PREVIOUS_SECRET` ainda abre. Nunca vai para tela, resposta, log ou auditoria; um teste varre banco, respostas e cabeçalhos procurando os tokens sintéticos.
- **Token de acesso** do servidor: pedido na hora de cada envio, nunca guardado. O seletor do Google usa uma autorização curta que o navegador pede direto ao Google; ela não passa pelo servidor.
- **OAuth**: PKCE S256, `state` aleatório, verificador e pessoa num cookie cifrado de 10 minutos (`HttpOnly`, `Secure`, `SameSite=Lax`, caminho `/api/drive/oauth`). A volta confere mesma pessoa, mesmo navegador e se a caixa do Drive foi marcada; se não foi, revoga o que veio e não guarda nada. O resultado volta num cookie curto, não na URL.
- **Revogado no Google** (pela pessoa em myaccount.google.com, troca de senha, 6 meses sem uso, limite de 100 autorizações por conta): a próxima tentativa recebe `invalid_grant`; o portal apaga o envelope, marca "Precisa reconectar" e derruba as confirmações de pasta.
- **Permissões**: quem pode usar a pasta é conferido em SQL junto com a linha da pasta, a cada leitura e a cada envio; quem não pode, recebe "não encontrada". A origem do arquivo é lida com a mesma permissão da tela que a mostra. Entre a prévia e a confirmação, tudo é conferido de novo (pessoa, pasta, arquivo, tamanho, tipo, hash).
- **Pasta aberta demais**: se a pasta estiver aberta a "qualquer pessoa com o link" ou a todo o domínio, o cadastro e o envio são recusados. Se o Google não mostrar com quem a pasta está compartilhada, o cadastro é recusado (use uma conta que gerencia a pasta). Limite: em drive compartilhado o Google mostra só os ids das permissões, e o compartilhamento com o domínio inteiro pode não aparecer; a administração confere isso no cadastro.
- **Fronteira de projeto**: arquivo de um projeto não vai para a pasta de outro projeto; termo de empréstimo (dados pessoais) só vai para a pasta do próprio projeto ou para uma pasta "Só gestão". Sem permissão de leitura, o anexo aparece como "não encontrado", igual a um id inexistente.
- **Configuração errada não apaga nada**: só a resposta `invalid_grant` do Google marca a conexão como revogada. Cliente OAuth errado (`invalid_client`, 401) ou `PROEX_KEYS_SECRET` trocado sem o anterior viram erro de configuração, e as conexões continuam guardadas.
- **Privacidade**: anonimizar a conta apaga a conexão (e-mail Google e permissão cifrada) e as confirmações de pasta; o histórico de envios fica, sem o e-mail.
- **Meu Drive x drive compartilhado**: em pasta do "Meu Drive", o arquivo fica na conta de quem enviou (inclusive se a pessoa sair da equipe). Prefira pastas de drive compartilhado da PROEX; a tela da administração avisa quando não é.
- **Envio duplo**: o plano é reservado no banco antes de falar com o Google; duas confirmações simultâneas geram um arquivo só.

## 6. Configurar no Google Cloud (para o Yan; o agente não cria nem aceita termos)

Hoje o cliente OAuth fica na conta do Yan; a seção 3.4 de `MIGRACAO-PARA-PROEX.md` explica como a PROEX recria.

1. Em [console.cloud.google.com](https://console.cloud.google.com), escolha ou crie um projeto (ex.: "Portal PROEX").
2. **APIs e serviços › Biblioteca**: ative **Google Drive API** e **Google Picker API**.
3. **Google Auth Platform** (antiga "Tela de permissão OAuth"):
   - *Branding*: nome "Portal PROEX", e-mail de suporte, domínio `proex-gestao.vercel.app` (ou o definitivo).
   - *Público*: **Externo** se a conta for pessoal; **Interno** se o projeto estiver numa conta Workspace da UFG (só contas da UFG conectam). Em Externo, **publique o app ("Em produção")**: em "Teste", as autorizações vencem em 7 dias. Como os escopos são não sensíveis, publicar não exige a verificação longa.
   - *Acesso a dados*: adicione `openid`, `.../auth/userinfo.email` e `.../auth/drive.file`. Nenhum outro.
4. **Clientes › Criar cliente › Aplicativo da Web**:
   - Origens JavaScript autorizadas: `https://proex-gestao.vercel.app`
   - URIs de redirecionamento autorizados: `https://proex-gestao.vercel.app/api/drive/oauth/callback`
   - Guarde o **ID do cliente** e a **chave secreta** direto no cofre de senhas.
5. **APIs e serviços › Credenciais › Criar chave de API**: restrinja a chave à **Google Picker API**. A chave é pública por natureza (vai para o navegador). O portal envia `Referrer-Policy: no-referrer`; se o seletor recusar a chave com restrição por site, mantenha só a restrição por API.
6. Anote o **número do projeto** (Painel do projeto › Informações do projeto). O seletor usa esse número para liberar os arquivos ao app.
7. Na Vercel (projeto do portal, ambiente Production), crie as variáveis e publique de novo:

| Variável | Valor | Tipo |
|---|---|---|
| `PROEX_GOOGLE_CLIENT_ID` | ID do cliente | comum |
| `PROEX_GOOGLE_CLIENT_SECRET` | chave secreta do cliente | **sensível** |
| `PROEX_GOOGLE_PICKER_API_KEY` | chave de API do passo 5 | comum |
| `PROEX_GOOGLE_CLOUD_PROJECT_NUMBER` | número do passo 6 | comum |

`PROEX_KEYS_SECRET` já existe e não deve ser recriado. Sem as quatro variáveis, a tela mostra "Ainda não disponível" e nada é enviado.

**Teste de aceite (depois de configurar):**
1. Conta › Google Drive › Conectar. Conferir "Conectada como …".
2. Configurações › Pastas do Drive › Cadastrar pasta num **drive compartilhado** da PROEX.
3. Com outra pessoa da equipe: conectar, abrir uma foto de material › Enviar ao Drive › Liberar no Google › Conferir › Confirmar. Abrir o link e ver o arquivo na pasta, com essa pessoa como autora. **Este passo confirma a ressalva da seção 2.**
4. Em myaccount.google.com › Segurança › Apps de terceiros, remover o acesso do "Portal PROEX". Tentar enviar de novo: o portal deve pedir para reconectar.
5. Testar com uma conta sem permissão de edição na pasta: deve aparecer "Sua conta Google não tem permissão para gravar nesta pasta".

## 7. Limites

- Arquivos de até 4 MB (o mesmo limite dos anexos do portal); envio em uma requisição.
- O seletor abre uma janela do Google: o navegador precisa permitir janelas do portal.
- O portal não lista o conteúdo das pastas nem lê arquivos que a pessoa não enviou por ele.
- Movimentações de estoque com anexos próprios entram quando a frente de movimentações publicar o tipo (ponto de encaixe em `resolveSource`).

## 8. Testes

`tests/google-drive.test.mjs` (Google simulado): cofre e rotação; OAuth com PKCE, estado, outra pessoa, recusa e caixa do Drive desmarcada; servidor sem configuração; **token revogado** (no meio e na hora do envio); desconectar e revogar, inclusive Google fora do ar; cadastro recusando não-admin, pasta pública, sem permissão, lixeira, não-pasta e pasta não liberada; quem pode usar; confirmação com outra pasta e com outra conta; sugestão e pergunta; envio completo com histórico e sem duplicar; **permissão negada** (anexo, Drive 403, acesso revogado entre prévia e confirmação); foto do chat do Rolê com hash; rotas sem segredo e volta do Google sem código na URL.

## 9. Pasta de vídeos da atividade

Em **Configurações › Pastas do Drive**, a administração cadastra a pasta com o projeto correto e o público **Só gestão**. Na ficha do projeto, a gestão abre **Cronograma › Registros e fotos › Vídeos da atividade**, escolhe a pasta e salva. O nome da pasta passa a abrir o Google Drive em nova aba. A conta Google aberta no navegador precisa ter acesso concedido no Drive. A abertura usa a própria sessão do Google e dispensa conceder ao Portal uma autorização adicional para arquivos.

O Portal conserva uma referência por atividade. A auditoria da atividade registra vínculo e remoção com autoria e data. A pasta e seus arquivos são administrados no Drive. O vínculo do Portal fica na base operacional, fora da planilha, de relatórios, dos links comuns do projeto e da agenda pública. Para mudar de instalação com a planilha, recadastre as pastas e vincule-as de novo às atividades.

Testes em `tests/google-drive.test.mjs` cobrem escopo de projeto e organização, perfis, falsificação de IDs, mudança de pasta ou de acesso durante uma operação, concorrência de edição, repetição sem duplicar, retirada do vínculo e redirecionamento privado sem revelar o ID do Drive na lista.
