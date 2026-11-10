# Proteger a planilha mestre

Decisão do Yan em 10/11/2026: a planilha mestre só pode ser editada pela administração geral.

**Por quê:** quem pode editar a planilha também pode editar o script dela. Esse script roda com a chave da administração do portal. Na prática, um editor da planilha conseguiria agir como administrador.

**O que o portal já faz** (a partir da PR desta decisão):
- antes de aplicar qualquer edição vinda da planilha, o script informa ao portal quem tem permissão de edição no arquivo;
- se houver alguém fora da administração geral, o portal **não aplica as edições** e a aba Conflitos mostra `sync_editors_not_admin`;
- a cópia do portal para a planilha continua normalmente.

Essa conferência protege contra um compartilhamento feito por engano. Contra alguém mal-intencionado que já seja editor, ela não basta, porque essa pessoa poderia mudar o script. **A proteção de verdade é a permissão no Google**, nos passos abaixo.

## Passo a passo (cerca de 10 minutos)

### 1. Quem pode editar

1. Abra a planilha mestre (o link está em **Configurações → Planilha Google** no portal).
2. Clique em **Compartilhar**, no canto de cima.
3. Na lista de pessoas, deixe como **Editor** apenas as contas da administração geral do portal. Para as demais, troque para **Leitor** ou clique em **Remover acesso**.
4. Em **Acesso geral**, deixe **Restrito**. Nunca use "Qualquer pessoa com o link".
5. Clique na engrenagem ⚙ no alto da janela de compartilhamento e **desmarque "Editores podem mudar as permissões e compartilhar"**.
6. Clique em **Salvar** ou **Concluído**.

**Atenção ao e-mail:** cada conta Google que fica como editora precisa ser **o mesmo e-mail** da pessoa no portal, com papel de administração geral. Se não for, o portal não reconhece a conta e recusa as edições, e a aba Conflitos avisa.

### 2. Atualizar o script (uma vez)

1. Na planilha, abra **Extensões → Apps Script**.
2. Apague o conteúdo do arquivo principal e cole o novo `proex-planilha.gs`. Ele fica em `apps/proex-portal/public/integracoes/proex-planilha.gs` no repositório, e o portal também o oferece para download.
3. Clique em **Salvar** (ícone de disquete).
4. Volte à planilha e use **PROEX → Sincronizar agora**. Na primeira vez, o Google pode pedir para autorizar de novo. A permissão é a mesma de antes: ler a lista de pessoas do próprio arquivo pelo Drive.

**Como conferir:** a aba **Controle** deve terminar com a situação `completed`. Se aparecer `conflict` e a aba **Conflitos** mostrar `sync_editors_not_admin`, há alguém fora da administração com permissão de edição. Volte ao passo 1.

### 3. Proteger as abas contra digitação por engano (opcional, recomendado)

Isto não muda quem pode editar o arquivo. Só evita digitar sem querer nas colunas cinzas, que são as que o portal calcula.

1. Abra **Dados → Proteger páginas e intervalos**.
2. Clique em **Adicionar uma página ou um intervalo → Página** e escolha uma aba de sistema, por exemplo `stock_movements`, `members` ou `Controle`.
3. Em **Definir permissões**, escolha **Mostrar um aviso ao editar este intervalo**. O aviso basta, porque só a administração edita.
4. Repita para as abas que não têm coluna creme no cabeçalho, ou seja, as que não são editáveis.

## Se algo der errado

- **A sincronização parou de aplicar edições.** Leia a aba Conflitos. Com `sync_editors_not_admin`, ajuste o compartilhamento (passo 1).
- **Um conflito antigo continua aparecendo.** Em **Configurações → Planilha Google → Revisar conflitos**, confira o valor oficial e clique em **Marcar como resolvido**. Isso não altera nenhum dado; só tira o aviso.
- **Quer voltar ao script antigo.** O script antigo continua aceito, mas sem a conferência de editores; o portal marca essas edições como "não verificadas". Não é recomendado.
