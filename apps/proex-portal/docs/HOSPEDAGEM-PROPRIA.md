# Hospedagem própria do portal — alternativa Cloudflare

Estado revisado em 30/10/2026: a hospedagem atual é **Vercel + Supabase**, em [proex-gestao.vercel.app](https://proex-gestao.vercel.app/). Este guia preserva o procedimento da **alternativa Cloudflare**, sem declarar essa alternativa configurada ou publicada. O histórico do ChatGPT Sites também é preservado. Consulte o [guia da hospedagem atual](HOSPEDAGEM-VERCEL.md) e o registro de entrega para identificar a revisão em produção; alterações locais da V9 não comprovam publicação.

O portal mantém estas opções com o mesmo código:

| Onde | Para quê | Quem publica |
| --- | --- | --- |
| **Vercel + Supabase** | Hospedagem atual; build Node e adaptador de persistência | Integração da Vercel com o GitHub |
| **ChatGPT Sites** (`proex-gestao.yandiamantinobr.chatgpt.site`) | Instalação histórica e alternativa | Fluxo do Sites |
| **Cloudflare da PROEX** (este guia) | Alternativa institucional com Workers, D1 e R2 | Workflow do GitHub Actions, quando configurado |

Na hospedagem atual, o banco da aplicação continua **SQLite**: o adaptador Node persiste o arquivo comprimido em `proex.sqlite_snapshot`, no Postgres do Supabase, com controle de versão (compare-and-set). Os anexos privados ficam em `proex.objects`. Isso não converteu as tabelas do domínio para Postgres. A alternativa Cloudflare usa D1 (SQLite) e R2, preservando as consultas e migrações SQLite; dados, identidade, arquivos e recuperação precisam ser transferidos e verificados para a instalação de destino.

## Alternativa Cloudflare: o que a PROEX precisa criar

1. **Conta Cloudflare** com um e-mail institucional (de preferência uma conta da PROEX, não pessoal), em <https://dash.cloudflare.com/sign-up>.
2. **Plano**: avalie os limites de processamento e armazenamento para o uso pretendido. O valor de US$ 5/mês para Workers Paid foi registrado na versão original deste guia; consulte [preços e limites oficiais](https://developers.cloudflare.com/workers/platform/pricing/) antes de contratar.
3. **R2** (fotos e termos): no painel, abra **R2** e ative o serviço. A Cloudflare pede um cartão mesmo para a faixa gratuita (10 GB). Sem R2 o portal funciona, mas anexos ficam indisponíveis.
4. **Token de API**: em **My Profile → API Tokens → Create Token → Edit Cloudflare Workers**, acrescente as permissões **D1: Edit** e **Workers R2 Storage: Edit**. Copie o token, que aparece só uma vez.
5. **Account ID**: aparece na barra lateral da página inicial do painel.

## Alternativa Cloudflare: configuração no GitHub

No repositório, abra **Settings → Environments → New environment**, crie `producao` e cadastre:

**Secrets** (valores ocultos):

| Nome | Valor |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | token criado no passo 4 |
| `CLOUDFLARE_ACCOUNT_ID` | ID da conta |
| `BETTER_AUTH_SECRET` | texto aleatório com 40 ou mais caracteres. **Nunca troque depois**, porque isso encerra todas as sessões e invalida links de convite |
| `OWNER_EMAIL` | e-mail de quem será o primeiro responsável institucional |
| `SETUP_TOKEN` | outro texto aleatório (24 ou mais caracteres), usado uma única vez na configuração inicial |

Gere e guarde os valores secretos em um gerenciador de senhas e cadastre-os diretamente nos campos de Secrets. Não imprima valores em terminal, logs ou documentação.

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

Quando essa alternativa estiver configurada, cada atualização da `main` que altere `apps/proex-portal` aciona o workflow. Sem a configuração necessária, ele apenas registra um aviso e pula a implantação: um resultado verde nesse caso não comprova publicação Cloudflare e não informa o estado da implantação Vercel.

O endereço `*.workers.dev` aparece no fim do log. Se for usar um domínio da UFG, aponte-o em **Workers → proex-gestao → Settings → Domains & Routes** e atualize `PROEX_PUBLIC_URL`.

## Alternativa Cloudflare: primeiro acesso

1. Abra `<endereço>/configuracao-inicial`. O link também aparece na tela de login enquanto ninguém configurou o servidor.
2. Informe o `SETUP_TOKEN`, o mesmo e-mail de `OWNER_EMAIL`, seu nome e uma senha de 12 ou mais caracteres.
3. Pronto: você entra como responsável institucional. A página deixa de funcionar para sempre, mesmo que os segredos continuem configurados. Se quiser, apague o secret `SETUP_TOKEN` no GitHub.
4. Convide a equipe em **Equipe**, com a função e o projeto de cada pessoa.

### Por que a configuração inicial é assim

No Sites a identidade do ChatGPT é colocada pela plataforma. Fora dele, qualquer navegador poderia enviar esses mesmos cabeçalhos. Por isso, na hospedagem própria, o Worker descarta todos os cabeçalhos `oai-authenticated-*` antes de o aplicativo ler a requisição. A única forma de criar o primeiro responsável é a combinação **segredo do servidor + e-mail configurado + inexistência de responsável anterior**.

## Alternativa Cloudflare: trazer dados de outra instalação

Use uma exportação cuja data e leitura de retorno tenham sido verificadas. A planilha é uma projeção operacional; sua configuração e uma sincronização passada não comprovam um gatilho atualmente ativo. Veja [Sincronização](SINCRONIZACAO.md#estado-verificável). Para carregar no banco novo:

1. Na planilha verificada, use **Arquivo → Fazer download → Microsoft Excel (.xlsx)**. Também serve a exportação portátil obtida em **Configurações → Dados e sincronização**. O nome “backup completo” na interface não significa cópia integral de credenciais e objetos privados.
2. No computador, dentro de `apps/proex-portal`:

```bash
node scripts/portable-import.mjs ~/Downloads/planilha.xlsx --out importacao.sql
```

3. Aplique no banco da Cloudflare:

```bash
npx wrangler d1 execute proex-gestao --remote --file importacao.sql
```

O importador valida cada linha contra as migrações reais (tipos, regras e vínculos) antes de gerar o SQL e nunca sobrescreve registros existentes (`INSERT OR IGNORE`). Pessoas, permissões, auditoria e credenciais **não** são copiadas: a equipe é convidada de novo no portal novo. Saldos entram como estavam e continuam sendo alterados só por movimentações.

Fotos e termos não estão nas células da planilha. Na hospedagem atual são objetos privados do Supabase; na alternativa Cloudflare ficam no R2. Uma cópia pode existir na pasta privada do Drive quando o fluxo de anexos tiver sido concluído e verificado; ter a pasta configurada não comprova a cópia. Confira IDs, hashes, tamanhos e acesso no destino.

Na revisão local V9, novos envios de PDF, JPEG, PNG e WebP têm limite de **4 MiB por arquivo (4.194.304 bytes)**, mostrado como “4 MB”. O limite vale para entrada: anexos legados maiores não são excluídos nem bloqueados nos downloads autorizados. A revisão publicada deve ser conferida antes de atribuir esse limite ao ambiente em produção.

## Backup e recuperação

- **Hospedagem atual, Vercel + Supabase**: durante uma gravação de instantâneo, o adaptador inclui uma versão em `proex.sqlite_history` se não houver outra nas últimas seis horas, mantendo até 60 dias. A cópia depende de uma gravação; não é um agendamento independente. Ela está no mesmo Supabase e não inclui uma cópia externa dos objetos privados. Exige estratégia de backup externo e restauração verificada.
- **Saúde do serviço**: `/api/health` faz uma consulta ao banco; o cron configurado para essa rota verifica disponibilidade. Resposta bem-sucedida não cria backup, não exporta arquivos e não testa restauração.
- **Alternativa Cloudflare**: o workflow **Backup do banco do portal** agenda exportação do D1 e criptografa o SQL como `.sql.enc`, com retenção de 30 dias no GitHub. Ele depende de configuração própria; sem ela, pula exportação e geração de artefato. Resultado verde sem artefato não comprova backup e esse workflow não copia o Supabase nem o R2.
- **Pelo portal e pela planilha**: a exportação portátil e a projeção Google ajudam na portabilidade dos dados permitidos, mas não são backup integral de credenciais e anexos. Uma sincronização verificada comprova aquela execução, não a existência de um gatilho ativo.

Uma recuperação precisa verificar separadamente o banco, os objetos privados, as permissões e a revisão do código. Registre o arquivo gerado e a restauração testada antes de declarar um backup operacional.

## Trocar de conta, de hospedagem ou de banco

- **Outra conta Cloudflare**: após configurar a alternativa de destino, restaure de forma privada o SQL do backup criptografado e importe-o com `wrangler d1 execute --file`. Confira também os objetos do R2 e as permissões; o SQL não os inclui.
- **Outro banco SQLite** (Turso, arquivo local, DB Browser): o `.sql` exportado é SQLite padrão.
- **Supabase como armazenamento de instantâneos**: já é a arquitetura atual com o build Node; o SQL do aplicativo continua sendo SQLite. Uma conversão futura das tabelas do domínio para **PostgreSQL** exige adaptar e testar consultas, restrições e transações. A exportação portátil ou a planilha, sozinhas, não fazem essa conversão.
- **Excel Online**: abra o `.xlsx` baixado da planilha, ou o backup JSON pelo Power Query. A chave de sincronização e a API `/api/sync/connector` permitem automatizar também pelo Power Automate.

## Desenvolvimento local da alternativa Cloudflare

Os comandos abaixo preservam o fluxo local D1/R2 desta alternativa. Para o build Node da hospedagem atual, consulte o [README do portal](../README.md) e o [guia Vercel](HOSPEDAGEM-VERCEL.md).

```bash
pnpm install
pnpm db:migrate:local            # cria/atualiza o banco local em .wrangler/state
node scripts/portable-import.mjs dados.json --apply-local   # opcional: carrega dados
pnpm dev                         # http://127.0.0.1:5173
```

Para simular a hospedagem própria localmente, crie `.dev.vars` (ignorado pelo Git) com `PROEX_STANDALONE=1`, `BETTER_AUTH_URL=http://127.0.0.1:5173`, `BETTER_AUTH_SECRET`, `OWNER_EMAIL` e `SETUP_TOKEN`, e abra `/configuracao-inicial`.
