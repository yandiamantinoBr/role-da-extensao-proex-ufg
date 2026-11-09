# Onde ficam os dados do Portal PROEX e como passar tudo para a PROEX/UFG

Escrito em 2026-11-09. Lido no código (commit `e37c1f5`), na Vercel, no GitHub e nas notas internas. Este documento não contém chaves, senhas, endereços de e-mail nem dados de pessoas. Onde algo não pôde ser conferido, está escrito **a confirmar**.

Quem lê: a TI da PROEX/UFG e a gestão. As partes 1 e 2 servem a todos; as partes 3 em diante são para quem vai executar.

---

## 1. Resposta curta: os dados ficam só em planilhas?

**Não.** A planilha é uma cópia legível, não o lugar principal.

- **O banco de verdade** é um arquivo SQLite que o portal guarda inteiro dentro de um Postgres do Supabase (esquema `proex`). Projetos, materiais, estoque, empréstimos, equipe, permissões, senhas (só o resumo criptografado), histórico e auditoria estão aqui.
- **As fotos e os termos** ficam na mesma conta do Supabase, na tabela `proex.objects`. Uma cópia privada das fotos e termos vai também para uma pasta do Google Drive.
- **A planilha Google** recebe uma cópia de 35 tabelas, a cada 30 minutos, e deixa corrigir algumas colunas. Ela não guarda senhas, permissões completas, fotos nem o histórico inteiro.
- **Se a planilha sumisse**, o portal continuaria igual. **Se o Supabase sumisse sem cópia**, só restaria a planilha, que está incompleta.

Hoje **tudo isso está em contas pessoais do Yan** (Supabase, Vercel, GitHub e Google). É esse o ponto que a migração resolve.

---

## 2. Versão de uma página para a gestão

**Situação.** O portal funciona bem, mas depende de contas pessoais do Yan em quatro serviços. Se alguma conta for bloqueada, esquecida ou o Yan sair da PROEX, o portal pode parar e os dados ficam presos nela.

**O que existe de proteção hoje.**
- Cópia de segurança completa e criptografada, que o administrador baixa num botão e que também é gerada todo dia e guardada numa pasta privada do Drive (confirmada em 04/11 com 4 arquivos).
- Uma restauração de teste já foi feita com sucesso em 31/10.
- O banco é pequeno (cerca de 0,5 MB), então copiar e migrar é rápido.

**O que falta.**
- Contas institucionais (GitHub, Supabase, Vercel, Google) e, de preferência, um endereço próprio (por exemplo, um subdomínio da UFG).
- A chave que abre as cópias de segurança está só no computador do Yan. É preciso uma segunda guarda institucional.
- Um aviso por e-mail está ligado à conta Google pessoal do Yan, com credencial provisória que vence em **30/11/2026**.

**O que decidir.**
1. Quem será o responsável técnico na PROEX/UFG, e qual conta Google institucional pode executar as rotinas automáticas.
2. Onde hospedar: contas institucionais Vercel + Supabase (a mesma arquitetura de hoje) ou um servidor da UFG (também suportado).
3. Domínio e prazo. **Recomendação: migrar depois do CONPEEX (13/11) e antes de 30/11.**

**Esforço.** Cerca de 1 dia de trabalho técnico para a troca, com preparação das contas antes (dias, dependem da TI). O portal fica **somente em manutenção por 1 a 2 horas** na virada. Estimativas nossas, a confirmar no ensaio.

**Risco principal da migração.** Perder o valor de um segredo (`BETTER_AUTH_SECRET` ou `PROEX_KEYS_SECRET`). Consequência: todos fazem login de novo e as chaves de IA precisam ser cadastradas outra vez. Os dados não se perdem.

---

## 3. Inventário: cada lugar onde há dado ou dependência

Legenda de risco: **Alto** = para o portal ou perde dado; **Médio** = perde um recurso; **Baixo** = incômodo.

### 3.1 Supabase (banco e anexos)

| Item | Detalhe |
|---|---|
| Conta | Organização "PROEX UFG" no Supabase, região sa-east-1, criada na conta pessoal do Yan (segundo as notas de 30/10). **A confirmar agora:** o conector de leitura desta sessão só enxerga outra organização, então não foi possível reabrir o painel. |
| O que guarda | `proex.sqlite_snapshot` (o banco inteiro, 1 linha com versão), `proex.sqlite_history` (cópia a cada 6 h, mantida 60 dias), `proex.objects` (fotos de materiais e de perfil, termos de empréstimo, anexos de registros). Acesso público fechado (RLS ligado e permissões revogadas para `anon` e `authenticated`). |
| Tamanho | Pequeno: a cópia completa de 04/11 tem cerca de 531 KB. |
| Se a conta sumir | **Alto.** Perde o banco, o histórico de 60 dias e todas as fotos. |
| Cópia de segurança | Botão do portal (parte 5). Cópias nativas do Supabase dependem do plano: **a confirmar no painel**. O histórico de 60 dias fica no mesmo projeto, então não protege contra perder o projeto. |
| Restaurar | Parte 5 e 6.4. |

### 3.2 Vercel (site)

| Item | Detalhe |
|---|---|
| Conta | Time pessoal do Yan, projeto `proex-gestao`. Node 24, região `gru1`, domínio `proex-gestao.vercel.app` (único; não há domínio próprio). Proteção por login da Vercel só em previews. |
| Publicação | Cada merge na `main` do GitHub publica sozinho. Cota de 100 publicações por dia, **dividida com o Kino Campus**. |
| Variáveis (só nomes) | `PROEX_DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `OWNER_EMAIL`, `SETUP_TOKEN`, `PROEX_KEYS_SECRET`, `VINEXT_TRUST_PROXY`, `ENABLE_EXPERIMENTAL_COREPACK`. Todas são do tipo segredo (a Vercel não mostra o valor depois de salvo). |
| Tarefa agendada | `GET /api/health` todo dia às 11:00 UTC, que também evita o Supabase gratuito pausar por inatividade. |
| Se a conta sumir | **Alto.** O site sai do ar; o banco continua no Supabase. |
| Cópia de segurança | O código está no GitHub. Os **valores** das variáveis não podem ser lidos de volta: guardar uma cópia de cada um no cofre de senhas da PROEX (parte 4, passo 0). |
| Restaurar | Criar projeto novo, apontar para o repositório e cadastrar as variáveis. |

### 3.3 GitHub (código)

| Item | Detalhe |
|---|---|
| Conta | `yandiamantinoBr/role-da-extensao-proex-ufg`, repositório **público**. |
| O que guarda | Código do portal (`apps/proex-portal`) e do jogo Rolê da Extensão (raiz, publicado no GitHub Pages). **Nenhum dado nem segredo.** O GitHub não tem segredos cadastrados (conferido). |
| Fluxos | `checks.yml` (testes em PR), `pages.yml` (jogo), `portal-deploy.yml` (alvo Cloudflare, parado: termina avisando que não está configurado), `portal-backup.yml` (aposentado: falha de propósito para não parecer backup). |
| Se a conta sumir | **Médio.** O site continua no ar, mas ninguém consegue mudar o código e a Vercel perde a ligação. Qualquer clone local tem o histórico completo. |
| Cópia de segurança | `git clone --mirror` do repositório. |
| Restaurar | Criar repositório numa organização da UFG/PROEX e enviar o espelho; ou transferir o repositório (parte 4). |

### 3.4 Google (planilhas, Drive, Apps Script, e-mail)

Todas as peças de Apps Script **rodam com a conta de quem as instalou**. Hoje é a conta Google pessoal do Yan.

| Peça | Para que serve | Onde está | Se a conta sumir |
|---|---|---|---|
| Planilha mestre "Gestão PROEX" | Espelho de 35 tabelas, com 12 abas abertas pelo portal | Drive pessoal do Yan, privada | **Médio**: o portal continua, mas a cópia legível e as edições pela planilha param |
| Projeto Apps Script da mestre (3 gatilhos) | Sincronizar dados (30 min), copiar anexos (1 h), backup diário (~03h) | Preso à planilha mestre, conta pessoal | **Alto para o backup diário**: para junto |
| Pasta privada "PROEX · Anexos privados" | Cópia de fotos e termos | "Meu Drive" pessoal do Yan | **Médio**: perde a cópia extra |
| Pasta privada de backups cifrados | Cópias diárias `.proexbackup` | "Meu Drive" pessoal do Yan | **Alto**: é a única cópia fora do Supabase |
| Projeto Apps Script de avisos por e-mail (MailApp) | Avisos automáticos a cada 10 min, limite 50/dia por organização e 3 por pessoa | Projeto privado separado, conta pessoal do Yan. Credencial `pne_` provisória **vence em 30/11/2026** | **Médio**: só param os avisos |
| Planilhas por projeto e por equipe | Visão limitada por projeto ou equipe, com chaves próprias | Arquivos escolhidos por cada gestor. Podem estar em Drives institucionais. | **Baixo** |
| Planilha "CONPEEX 2026 — Controle de brindes" | Controle operacional da equipe | Drive institucional (Equipe PROEC), não do Yan | **Baixo** para este tema; já está no lugar certo |
| Cliente OAuth "Portal PROEX" (Google Drive por pessoa) | Deixa cada pessoa conectar a própria conta e enviar arquivos às pastas registradas (escopo `drive.file`). Variáveis `PROEX_GOOGLE_*` na Vercel | Projeto do Google Cloud na conta do Yan (quando configurado). Os arquivos ficam nos Drives da PROEX, com a autoria de quem enviou | **Médio**: param os envios ao Drive; nada se perde (as pastas e os arquivos não dependem do cliente) |
| Google Calendar | O portal **não** grava no Calendar. Ele só publica um feed `.ics` em `/api/calendar/feed` que cada pessoa assina | Sem conta envolvida | Sem risco de conta |

Cotas do Google dependem do tipo de conta (pessoal ou Workspace): **a confirmar** com a conta institucional.

### 3.5 Fotos e anexos dos materiais

- Ficam em `proex.objects` (Supabase), junto com termos e fotos de perfil. Limites do código: 10 MiB por anexo, 2 MB por foto de perfil.
- Uma cópia privada vai para o Drive pela rotina de anexos (só PDF, PNG, JPEG e WebP). Essa cópia nunca volta ao portal.
- A foto principal de cada material é uma escolha registrada no banco; a imagem em si é um desses objetos.
- **Anexos do chat da comunidade:** a sessão `proex-comunidade` ainda decide onde guardar. **Decisão não registrada até esta data.** Se ficarem em `proex.objects`, entram na cópia de segurança sem mudança.

### 3.6 Provedores de IA e cofre de chaves

- As chaves (DeepSeek, TypeSafe, Deepgram, Groq) são cadastradas em **Configurações → Chaves e modelos** e ficam **cifradas dentro do banco**.
- Quem decifra é a variável `PROEX_KEYS_SECRET` (e `BETTER_AUTH_SECRET` para as chaves antigas, formato v1). **Não recriar `PROEX_KEYS_SECRET`: um valor novo torna as chaves ilegíveis** (precisam ser cadastradas de novo).
- A cópia de segurança leva o cofre cifrado, **mas não leva** esses segredos.
- As contas desses provedores (faturamento e cotas) pertencem a quem criou a chave. **A confirmar** em qual conta cada uma está.
- Risco se faltar: **Médio**. O assistente e a transcrição param até recadastrar chaves.

### 3.7 Login (Better Auth) e e-mails

- Contas, senhas (só o resumo), sessões e convites ficam **no mesmo banco**. Entram na cópia completa.
- `BETTER_AUTH_SECRET` assina sessões e convites. Trocar o valor desloga todos e invalida convites já enviados. `BETTER_AUTH_URL` precisa ser exatamente o endereço do portal (mudar de domínio exige atualizar e republicar).
- O login **não envia e-mail** (não há verificação de e-mail nem recuperação por e-mail no código).
- E-mails que existem: (1) avisos por MailApp, descritos na parte 3.4; (2) e-mail para participantes por um serviço externo (Resend), recurso opcional que **não está configurado em produção** (as variáveis `PUBLIC_PARTICIPANT_EMAIL_*` não existem na Vercel).
- `OWNER_EMAIL` e `SETUP_TOKEN` só servem à configuração inicial; depois do primeiro responsável existir, não criam nada.

### 3.8 Outros pontos

- **ChatGPT Sites** (versão V4 antiga do portal, conta pessoal): **a confirmar** se ainda existe. Se existir, desligar na hora da migração.
- **Cloudflare:** código pronto, nunca usado em produção. Nenhuma conta envolvida hoje.
- **Anotações internas (vault do Yan):** guardam contexto e decisões, não dados do portal. A TI não depende delas para operar.

---

## 4. Guia de migração (passo a passo)

Prepare tudo **antes** do dia da virada e só então congele o portal. Tempos são estimativas para quem já tem as contas.

### Passo 0. Decisões e contas (dias; depende da TI) — sem parada

1. Escolher o **responsável técnico** e uma **conta Google institucional** que ficará dona das rotinas automáticas. Use uma conta de serviço da PROEX, não de uma pessoa, para não parar quando alguém sair.
2. Criar: organização no GitHub, organização no Supabase, time na Vercel (confira se o plano atende ao uso institucional nos termos da Vercel) e, se possível, um domínio. Colocar **todos os segredos num cofre de senhas da PROEX**, com pelo menos duas pessoas com acesso.
3. Copiar para o cofre da PROEX o valor de cada variável da parte 3.2. Os valores não podem ser lidos da Vercel depois de salvos; Yan precisa fornecê-los do seu gerenciador de senhas. Se algum não existir lá, veja a coluna "Se faltar".

| Variável | Se faltar |
|---|---|
| `BETTER_AUTH_SECRET` | Gerar novo (32+ caracteres). Todos fazem login de novo; convites antigos deixam de valer; chaves de IA v1 precisam ser recadastradas. |
| `PROEX_KEYS_SECRET` | Gerar novo. Recadastrar as chaves de IA. |
| `PROEX_DATABASE_URL` | Será criado no destino novo (passo 3). |
| `OWNER_EMAIL`, `SETUP_TOKEN` | Não são usados depois da configuração inicial. |

### Passo 1. Congelar e tirar a cópia final — 30 min, portal em modo "só leitura combinado"

1. Avisar a equipe e **marcar a janela fora dos horários de distribuição do CONPEEX**. Recomendação: depois de 13/11.
2. No Apps Script antigo: **PROEX → Desativar sincronização automática**.
3. No painel **Avisos por e-mail**, desligar o envio.
4. Em **Configurações → Dados e sincronização → Backup completo criptografado → Baixar backup completo protegido**, definir uma frase de 16 a 256 caracteres e baixar o arquivo `.proexbackup`. Guarde a frase no cofre, separada do arquivo.
5. Peça para ninguém editar até o passo 6.

### Passo 2. Teste de restauração — 30 a 60 min — **faça antes de virar a chave**

1. Validação, sem gravar nada: `node scripts/restore-backup.mjs --input arquivo.proexbackup --dry-run`
2. Restauração isolada para inspeção (pasta temporária, dados abertos, apague depois): `node scripts/restore-backup.mjs --input arquivo.proexbackup`
3. Ensaio de importação no destino de teste (parte 6.4). **Só siga para o passo 3 se a conferência bater.**

### Passo 3. Montar o destino — 1 a 2 h

1. **Supabase:** criar projeto novo (região sa-east-1) na organização da PROEX. Anotar o endereço de conexão do pooler (porta 6543) no cofre.
2. **Importar o pacote** (a ferramenta cria o esquema e recusa destino que já tenha dados):
   ```text
   PROEX_TARGET_DATABASE_URL=<endereço do pooler>  node scripts/import-backup-to-postgres.mjs --input arquivo.proexbackup --apply
   ```
   A frase (ou a chave privada, nos arquivos automáticos) é pedida com entrada oculta. Sem `--apply`, só valida e mostra o plano.
3. **GitHub:** transferir o repositório para a organização (Settings → Transfer) ou criar um novo e enviar o espelho. Em repositório novo, o histórico de PRs não vem junto.
4. **Vercel:** criar projeto novo no time institucional, **Root Directory `apps/proex-portal`**, Node 24. Cadastrar: `PROEX_DATABASE_URL` (do passo 3.1), `BETTER_AUTH_SECRET`, `PROEX_KEYS_SECRET`, `BETTER_AUTH_URL` (o endereço **final** do portal), `VINEXT_TRUST_PROXY=1`, `ENABLE_EXPERIMENTAL_COREPACK=1`. Publicar a `main`.
5. **Domínio:** apontar o domínio institucional para o projeto novo (a TI da UFG cria o registro DNS que a Vercel indicar). Enquanto o domínio não estiver pronto, use o endereço `*.vercel.app` do projeto novo e atualize `BETTER_AUTH_URL` quando o domínio entrar.

### Passo 4. Conferir o novo portal antes de abrir — 30 min

- `/api/health` responde `{"ok":true}`.
- A administração geral entra (a mesma senha de antes, se o `BETTER_AUTH_SECRET` foi mantido).
- Conferir contagens: projetos, materiais, estoque, empréstimos e equipe contra o portal antigo. Abrir 3 fotos de materiais e 1 termo.
- Fazer uma gravação de teste (edição simples de uma descrição e voltar) para provar que o banco aceita escrita.

### Passo 5. Google com a conta institucional — 1 a 2 h

1. Criar a **planilha mestre nova** no Drive institucional, vazia. Instalar o conector (colar `Code.gs`, `backup-automatico.gs` e o manifesto, como em `SINCRONIZACAO.md`), gerar uma chave nova no portal novo e **Conectar ao portal**. A primeira sincronização exporta as 35 tabelas do zero.
2. **Anexos:** o portal novo ainda aponta para as cópias na conta antiga e a rotina pula anexos que já têm cópia. Para recopiar na pasta nova, registre a exclusão das cópias antigas pelo procedimento descrito em `SINCRONIZACAO.md` (`proex_sync_attachment_cleanup`). As fotos em si **não** dependem disso: elas continuam no Supabase.
3. **Backup diário:** criar a pasta privada na conta institucional, configurar a chave **pública** nova no portal e guardar a **privada** em duas custódias. Rodar "Executar backup completo agora" e conferir com `restore-backup.mjs --dry-run`.
4. **Avisos por e-mail:** criar o projeto separado na conta institucional, uma credencial `pne_` nova e repetir o piloto próprio. Decida o prazo da credencial (1 a 90 dias).
5. Atualizar os links das abas em **Configurações → Planilha e anexos** para a planilha nova.
6. **Google Drive por pessoa** (só se estiver em uso). Na conta institucional, recriar o projeto do Google Cloud seguindo `docs/GOOGLE-DRIVE.md`, seção 6: ativar Drive API e Picker API, configurar a Google Auth Platform (Interno, se for Workspace da UFG; senão Externo e "Em produção"), escopos `openid`, `userinfo.email` e `drive.file`, cliente Web com a origem e o redirecionamento do **domínio novo** (`https://<domínio>/api/drive/oauth/callback`) e uma chave de API restrita à Picker API. Trocar na Vercel nova as quatro variáveis `PROEX_GOOGLE_CLIENT_ID`, `PROEX_GOOGLE_CLIENT_SECRET` (sensível), `PROEX_GOOGLE_PICKER_API_KEY` e `PROEX_GOOGLE_CLOUD_PROJECT_NUMBER` e publicar. **Efeito:** as conexões antigas pertencem ao cliente antigo e deixam de funcionar; cada pessoa vê "Precisa reconectar" e conecta de novo (um clique) e libera cada pasta outra vez no primeiro envio. O registro de pastas e o histórico de envios ficam no banco e vêm na migração. Depois, apagar o cliente antigo no projeto da conta do Yan. Se `PROEX_KEYS_SECRET` mudar na migração, o efeito é o mesmo: reconectar.

### Passo 6. Virar a chave — 15 min, é aqui que o portal antigo para

1. Anunciar o endereço novo. Se houver domínio institucional, ele passa a apontar para o projeto novo.
2. No portal antigo: revogar todas as chaves `pxs_`, `pxp_`, `pxt_` e `pne_`; no Apps Script antigo, remover os gatilhos.
3. Religar o envio dos avisos e a sincronização no novo.
4. Fazer a **primeira restauração de teste do primeiro backup do novo ambiente** em até 7 dias.

### Passo 7. Encerrar o ambiente antigo — 30 dias depois

- Manter o Supabase e o projeto Vercel antigos **parados** por 30 dias (sem apagar), como plano de volta.
- Depois: baixar uma última cópia, apagar as cópias abertas, desativar o projeto, remover o acesso pessoal e anotar a data no cofre.

### O que cai durante a troca

| Quando | O que para | Duração |
|---|---|---|
| Passo 1 a 6 | Edição no portal (combinado com a equipe); em produção o site pode continuar só para leitura | 1 a 2 h |
| Passo 1 a 5 | Sincronização da planilha e avisos por e-mail | meio dia |
| Passo 6 | Se o `BETTER_AUTH_SECRET` não for o mesmo: todos fazem login de novo; convites antigos deixam de valer | imediato |
| Passo 6 | Link antigo `proex-gestao.vercel.app`, se o projeto antigo for pausado | até o novo domínio |

### Lista de conferência

- [ ] Responsável técnico e conta Google institucional definidos
- [ ] Organizações GitHub, Supabase e Vercel criadas; cofre de senhas com 2 pessoas
- [ ] Segredos da parte 3.2 copiados para o cofre (ou decisão de gerar novos)
- [ ] Janela de migração marcada fora do CONPEEX e fora das janelas de distribuição
- [ ] Backup final baixado; frase no cofre; `--dry-run` aprovado
- [ ] Ensaio de importação em projeto de teste aprovado
- [ ] Supabase novo criado; importação com `--apply` concluída
- [ ] Vercel nova publicada; `/api/health` ok; login e conferência de contagens ok
- [ ] Planilha mestre e conector novos; primeira sincronização `verified`
- [ ] Backup diário novo configurado; chave privada em 2 custódias; um `--dry-run` do primeiro arquivo
- [ ] Avisos por e-mail novos com credencial da conta institucional
- [ ] Se o Google Drive por pessoa estiver em uso: cliente OAuth institucional criado, variáveis `PROEX_GOOGLE_*` trocadas, um envio de teste conferido e o cliente antigo apagado
- [ ] Chaves antigas revogadas; gatilhos antigos removidos
- [ ] Domínio apontando para o projeto novo; `BETTER_AUTH_URL` conferido
- [ ] Ambiente antigo parado, mantido 30 dias e depois encerrado

---

## 5. Exportação completa: o que já existe

**Já existe.** Não foi preciso criar botão.

| Recurso | Onde | Para quê |
|---|---|---|
| **Backup completo criptografado** | Configurações → Dados e sincronização → "Baixar backup completo protegido". Só administração geral. | Pacote `.proexbackup` com **tudo**: banco inteiro (inclui contas, permissões, auditoria e cofre cifrado) e todos os anexos privados. AES-256-GCM, frase de 16 a 256 caracteres. Máximo de 64 MiB. |
| Backup completo diário | Configurações → Dados e sincronização → "Backup completo diário fora do provedor" | Mesmo conteúdo, cifrado com chave pública e gravado na pasta privada do Drive. |
| Validar e restaurar para inspeção | `node scripts/restore-backup.mjs --input arquivo.proexbackup [--dry-run]` | Confere o pacote. A restauração vai para uma pasta temporária, nunca para produção. |
| **Importar num Postgres novo** (novo em 09/11) | `node scripts/import-backup-to-postgres.mjs --input arquivo.proexbackup [--apply]` | Carrega o pacote num Supabase ou Postgres **novo e vazio**. Recusa destino com dados. Reconfere tudo na mesma transação e só então confirma. |
| Exportação portátil (JSON) e planilha | Configurações → Dados e sincronização | **Não é o backup completo.** Só dados de negócio; não leva contas, permissões, auditoria nem anexos. Útil para análise e para o importador parcial `portable-import.mjs`. |

Detalhes técnicos em [BACKUP-COMPLETO.md](BACKUP-COMPLETO.md) e [BACKUP-AUTOMATICO.md](BACKUP-AUTOMATICO.md).

### O que o pacote não leva

- Os segredos da Vercel (`BETTER_AUTH_SECRET`, `PROEX_KEYS_SECRET` etc.). Guardá-los à parte, no cofre.
- A coleção `sqlite_history` (cópias antigas de 60 dias).
- As chaves das contas nos provedores de IA (só o valor cifrado delas, ilegível sem `PROEX_KEYS_SECRET`).
- A configuração do Apps Script, os gatilhos e as chaves de sincronização: refazer no destino (passo 5).

### Limites da importação nova

- Destino precisa ser **vazio**. Para trocar um ambiente que já tem dados, use um projeto novo.
- A importação cria o esquema usando `supabase/proex-storage.sql`. Num Postgres que **não** é Supabase, crie antes os papéis `anon` e `authenticated` (o script do esquema revoga permissões deles).
- Pacotes gerados por uma instalação em **disco** guardam os anexos só pelo identificador, sem o caminho original. A importação grava o banco, pula esses anexos e **informa quantos pulou**. Pacotes gerados pelo Supabase, como os de hoje, trazem o caminho.
- O endereço do destino vai numa variável de ambiente (`PROEX_TARGET_DATABASE_URL`), nunca como argumento. O script recusa rodar se o ambiente tiver `PROEX_DATABASE_URL`, `DATABASE_URL`, `PROEX_DATA_DIR` ou `VERCEL`, para não apontar para produção por engano.
- O teste automático usa um destino simulado. O adaptador SQL real foi verificado uma vez contra um Postgres de verdade rodando em memória (PGlite): importou 4 objetos e a versão 7, e recusou a segunda importação. **Ainda não foi ensaiado no Supabase real.** Faça o ensaio do passo 2.3 num projeto de teste.

---

## 6. Como fazer cópia de segurança e restaurar cada peça

### 6.1 Banco e anexos (Supabase)
Botão de backup completo, ou o arquivo diário do Drive. Restaurar: passo 2 e 3.2.

### 6.2 Código e site (GitHub e Vercel)
`git clone --mirror` do repositório; o projeto da Vercel se recria com o repositório e as variáveis do cofre.

### 6.3 Planilhas e Drive
`Arquivo → Fazer download → .xlsx` da mestre guarda uma foto dela. Para o ambiente novo, uma planilha nova se enche sozinha pela sincronização (passo 5), então ela não precisa de restauração.

### 6.4 Ensaio de restauração (antes de virar a chave)
1. Crie um projeto de teste no Supabase (ou use um Postgres descartável).
2. Importe o pacote com `--apply`.
3. Publique um projeto de teste na Vercel apontando para ele, com **outros** segredos (nunca os de produção).
4. Entre como administrador, confira contagens e fotos. Se `BETTER_AUTH_SECRET` for diferente, o login funciona com a senha, mas convites antigos deixam de valer.
5. Apague o ambiente de teste e anote data, versão do código (SHA) e responsável.

---

## 7. Riscos atuais

| Risco | Efeito | Ação |
|---|---|---|
| Quatro serviços em contas pessoais do Yan | Bloqueio ou saída do Yan para o portal e trava os dados | Esta migração |
| Credencial `pne_` provisória vence em **2026-11-30** | Avisos por e-mail param | Renovar até 30/11 ou migrar antes |
| Chave privada do backup só no computador do Yan (DPAPI do Windows) | Perder o computador deixa os backups ilegíveis | Segunda custódia institucional |
| Valores dos segredos da Vercel não são legíveis | Sem cópia no cofre, perdem-se sessões, convites e chaves de IA | Passo 0.3 |
| Última restauração comprovada: 31/10. Novo ensaio pendente | Backup não ensaiado é só uma esperança | Passo 2 |
| Gatilhos do Google ligados a uma conta | Se a conta parar, para sincronização, cópia de anexos e backup diário | Conta institucional de serviço |
| Sem domínio próprio | Mudar de projeto muda o endereço e quebra links | Domínio institucional |
| Cotas: 100 publicações/dia na Vercel dividido com o Kino Campus; Supabase gratuito tem limite de espaço e pausa por inatividade (a tarefa diária evita a pausa); limites do Apps Script por tipo de conta | Publicação ou serviço bloqueados em dia de pico | Confirmar plano e cotas da conta institucional |
| Sem alerta de backup ausente | Falha silenciosa | Alguém conferir o Drive toda semana até haver alerta |
| Vercel gratuita para projeto institucional | Pode contrariar os termos do plano pessoal | **A confirmar** com a TI e a Vercel |
| ChatGPT Sites antigo (V4) | Cópia desatualizada de um portal antigo | Confirmar e desligar |

---

## 8. Perguntas para quando puder

1. Quem na PROEX/UFG será o **responsável técnico** e quem será o **segundo guardião** do cofre de segredos e das chaves de backup?
2. A UFG fornece **Google Workspace** institucional que permita Apps Script com serviços externos (envio de e-mail, chamadas HTTP)? Existe uma conta de serviço da PROEX?
3. Haverá um **subdomínio da UFG** para o portal (por exemplo `portal.proex.ufg.br`)? Quem faz o DNS?
4. Preferência de hospedagem: **Vercel + Supabase** em contas institucionais (o que existe hoje) ou **servidor da UFG** com Node e disco (também suportado)?
5. Quem paga os planos (Vercel, Supabase, provedores de IA) e qual é o orçamento?
6. A PROEX tem política de **retenção** e **LGPD** para dados de participantes, empréstimos e fotos de perfil? Quanto tempo guardar backups?
7. `PROEX_KEYS_SECRET` e `BETTER_AUTH_SECRET` estão no gerenciador de senhas do Yan? As chaves de IA estão em quais contas?
8. O site do ChatGPT Sites (V4) ainda existe? Pode ser desligado?
9. Para os anexos do chat da comunidade: qual foi a decisão de armazenamento (sessão `proex-comunidade`)?
10. Qual data de virada? Sugerimos depois de 13/11 e antes de 30/11.

---

## 9. Fontes e limites desta leitura

- Código no commit `e37c1f5` (`platform-node/store.ts`, `supabase/proex-storage.sql`, `lib/platform.ts`, `app/api/backup`, `scripts/*.mjs`, `public/integracoes/*.gs`, `vercel.json`).
- Vercel (leitura): projeto, domínios e **nomes** das variáveis, sem valores. GitHub (leitura): visibilidade, workflows e ausência de segredos.
- Supabase: **não reconferido nesta rodada**; dados da organização e região vêm das notas de 30/10.
- Google (planilhas, Apps Script, Drive): descrito pelo código e por conferências anteriores registradas pela coordenação; **não foi reaberto o painel do Google** nesta rodada.
- Tempos e esforços são estimativas.
