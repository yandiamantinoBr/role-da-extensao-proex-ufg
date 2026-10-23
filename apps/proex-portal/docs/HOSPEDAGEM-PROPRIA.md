# Hospedagem própria do portal (GitHub → Cloudflare)

O portal pode funcionar em dois lugares, com o mesmo código:

| Onde | Para quê | Quem publica |
| --- | --- | --- |
| **ChatGPT Sites** (`proex-gestao.yandiamantinobr.chatgpt.site`) | Versão atual, criada pelo Codex | Codex, pelo fluxo do Sites |
| **Cloudflare da PROEX** (este guia) | Versão institucional, independente de conta pessoal e do ChatGPT | GitHub Actions, automaticamente a cada atualização da `main` |

A Cloudflare é a escolha natural porque o Sites já roda sobre a mesma tecnologia (Workers, banco **D1**, que é SQLite, e arquivos no **R2**). Nada no código precisa ser reescrito: o mesmo banco, as mesmas migrações e os mesmos testes valem para os dois lugares.

## O que a PROEX precisa criar (uma vez)

1. **Conta Cloudflare** com um e-mail institucional (de preferência uma conta da PROEX, não pessoal), em <https://dash.cloudflare.com/sign-up>.
2. **Plano**: o gratuito serve para testar. Para uso diário recomenda-se o **Workers Paid** (US$ 5/mês na data deste guia): o plano gratuito limita o processamento de cada página a poucos milissegundos, e páginas maiores do painel podem ser interrompidas. Confira os valores atuais em <https://developers.cloudflare.com/workers/platform/pricing/>.
3. **R2** (fotos e termos): no painel, abra **R2** e ative o serviço. A Cloudflare pede um cartão mesmo para a faixa gratuita (10 GB). Sem R2 o portal funciona, mas anexos ficam indisponíveis.
4. **Token de API**: em **My Profile → API Tokens → Create Token → Edit Cloudflare Workers**, acrescente as permissões **D1: Edit** e **Workers R2 Storage: Edit**. Copie o token, que aparece só uma vez.
5. **Account ID**: aparece na barra lateral da página inicial do painel.

## O que configurar no GitHub (uma vez)

No repositório, abra **Settings → Environments → New environment**, crie `producao` e cadastre:

**Secrets** (valores ocultos):

| Nome | Valor |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | token criado no passo 4 |
| `CLOUDFLARE_ACCOUNT_ID` | ID da conta |
| `BETTER_AUTH_SECRET` | texto aleatório com 40 ou mais caracteres. **Nunca troque depois**, porque isso encerra todas as sessões e invalida links de convite |
| `OWNER_EMAIL` | e-mail de quem será o primeiro responsável institucional |
| `SETUP_TOKEN` | outro texto aleatório (24 ou mais caracteres), usado uma única vez na configuração inicial |

Para gerar textos aleatórios, rode no terminal:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

**Variables** (visíveis):

| Nome | Valor |
| --- | --- |
| `PROEX_PUBLIC_URL` | endereço final do portal, por exemplo `https://proex-gestao.<sua-conta>.workers.dev` ou um domínio da UFG |
| `PROEX_WORKER_NAME` | opcional; padrão `proex-gestao` |
| `PROEX_D1_NAME` / `PROEX_R2_BUCKET` | opcionais; padrões `proex-gestao` e `proex-gestao-arquivos` |

Depois, em **Actions → Publicar portal PROEX (hospedagem própria) → Run workflow**. O fluxo:

1. instala, confere tipos e roda toda a suíte de testes;
2. cria o banco D1 e o bucket R2, se ainda não existirem;
3. aplica somente as migrações pendentes (o histórico fica no próprio banco);
4. publica o Worker com a marca de hospedagem própria (`PROEX_STANDALONE=1`);
5. grava os segredos no Worker.

A partir daí, cada merge na `main` que altere `apps/proex-portal` publica de novo. Sem os segredos o fluxo só avisa e termina, sem quebrar nada.

O endereço `*.workers.dev` aparece no fim do log. Se for usar um domínio da UFG, aponte-o em **Workers → proex-gestao → Settings → Domains & Routes** e atualize `PROEX_PUBLIC_URL`.

## Primeiro acesso

1. Abra `<endereço>/configuracao-inicial`. O link também aparece na tela de login enquanto ninguém configurou o servidor.
2. Informe o `SETUP_TOKEN`, o mesmo e-mail de `OWNER_EMAIL`, seu nome e uma senha de 12 ou mais caracteres.
3. Pronto: você entra como responsável institucional. A página deixa de funcionar para sempre, mesmo que os segredos continuem configurados. Se quiser, apague o secret `SETUP_TOKEN` no GitHub.
4. Convide a equipe em **Equipe**, com a função e o projeto de cada pessoa.

### Por que a configuração inicial é assim

No Sites a identidade do ChatGPT é colocada pela plataforma. Fora dele, qualquer navegador poderia enviar esses mesmos cabeçalhos. Por isso, na hospedagem própria, o Worker descarta todos os cabeçalhos `oai-authenticated-*` antes de o aplicativo ler a requisição. A única forma de criar o primeiro responsável é a combinação **segredo do servidor + e-mail configurado + inexistência de responsável anterior**.

## Trazer os dados do Sites (ou de qualquer backup)

Os dados atuais estão espelhados na planilha Google. Para carregar no banco novo:

1. Na planilha, use **Arquivo → Fazer download → Microsoft Excel (.xlsx)**. Também serve o backup completo baixado em **Configurações → Dados e sincronização** de qualquer instalação.
2. No computador, dentro de `apps/proex-portal`:

```bash
node scripts/portable-import.mjs ~/Downloads/planilha.xlsx --out importacao.sql
```

3. Aplique no banco da Cloudflare:

```bash
npx wrangler d1 execute proex-gestao --remote --file importacao.sql
```

O importador valida cada linha contra as migrações reais (tipos, regras e vínculos) antes de gerar o SQL e nunca sobrescreve registros existentes (`INSERT OR IGNORE`). Pessoas, permissões, auditoria e credenciais **não** são copiadas: a equipe é convidada de novo no portal novo. Saldos entram como estavam e continuam sendo alterados só por movimentações.

Fotos e termos não estão na planilha (são privados). Eles ficam na pasta do Drive “PROEX · Anexos privados” quando o conector da planilha está ativo, ou podem ser reenviados nos registros.

## Backup

- **Automático**: o fluxo **Backup do banco do portal** exporta o D1 todo dia como `.sql` (SQLite padrão) e guarda 30 dias como artefato privado do GitHub.
- **Pelo portal**: **Configurações → Dados e sincronização → Baixar backup completo**.
- **Planilha Google**: cópia legível, atualizada pelo conector (veja `SINCRONIZACAO.md`).

## Trocar de conta, de hospedagem ou de banco

- **Outra conta Cloudflare**: configure os segredos do novo ambiente, rode o deploy e importe o último backup `.sql` com `wrangler d1 execute --file`.
- **Outro banco SQLite** (Turso, arquivo local, DB Browser): o `.sql` exportado é SQLite padrão.
- **PostgreSQL/Supabase**: os dados migram pelo backup JSON ou pela planilha, mas o código usa SQL do SQLite/D1 em vários serviços. Trocar o banco do aplicativo exige adaptar e testar essas consultas. É uma migração planejada, não uma troca de variável.
- **Excel Online**: abra o `.xlsx` baixado da planilha, ou o backup JSON pelo Power Query. A chave de sincronização e a API `/api/sync/connector` permitem automatizar também pelo Power Automate.

## Desenvolvimento local

```bash
pnpm install
pnpm db:migrate:local            # cria/atualiza o banco local em .wrangler/state
node scripts/portable-import.mjs dados.json --apply-local   # opcional: carrega dados
pnpm dev                         # http://127.0.0.1:5173
```

Para simular a hospedagem própria localmente, crie `.dev.vars` (ignorado pelo Git) com `PROEX_STANDALONE=1`, `BETTER_AUTH_URL=http://127.0.0.1:5173`, `BETTER_AUTH_SECRET`, `OWNER_EMAIL` e `SETUP_TOKEN`, e abra `/configuracao-inicial`.
