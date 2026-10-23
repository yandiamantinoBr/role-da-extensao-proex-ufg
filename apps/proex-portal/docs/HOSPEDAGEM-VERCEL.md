# Hospedagem atual: Vercel + Supabase

Endereço de produção: <https://proex-gestao.vercel.app>

| Peça | Onde | Observação |
| --- | --- | --- |
| Site e servidor | Vercel, projeto `proex-gestao` (região São Paulo, `gru1`) | Publica sozinho a cada merge na `main` que altere `apps/proex-portal` |
| Banco de dados e anexos | Supabase, organização **PROEX UFG**, projeto `proex-gestao` (São Paulo) | Plano gratuito; esquema privado `proex` |
| Código | GitHub `yandiamantinoBr/role-da-extensao-proex-ufg` | `vercel.json`, `api/index.mjs` e `platform-node/` |
| Planilha | Google Sheets “Gestão PROEX · Dados e sincronização” | Conector Apps Script (veja `SINCRONIZACAO.md`) |

## Como funciona

O portal foi escrito para o runtime da Cloudflare (banco D1, que é SQLite). Para rodar na Vercel sem reescrever as consultas, o build Node (`pnpm build:node`) troca o módulo `cloudflare:workers` por `platform-node/env.ts`:

- **Banco**: SQLite real (`node:sqlite`) com a mesma interface do D1. O arquivo do banco fica em `proex.sqlite_snapshot` no Postgres do Supabase. Cada transação que altera dados grava o arquivo com controle de versão (compare-and-set). Se duas instâncias gravarem ao mesmo tempo, a segunda recarrega e reexecuta a transação. Nada é sobrescrito. As regras, triggers e verificações do portal são as mesmas do D1.
- **Cópias de segurança**: a cada 6 horas uma versão completa vai para `proex.sqlite_history`, guardada por 60 dias.
- **Anexos** (fotos e termos): tabela privada `proex.objects`, no lugar do R2.
- **Servidor**: uma única função (`api/index.mjs`) sobe o servidor de produção do vinext e encaminha as requisições. Os arquivos estáticos saem direto da CDN da Vercel.
- **Atividade diária**: um cron da Vercel abre o portal todo dia, o que evita a pausa automática de projetos gratuitos inativos do Supabase.

Indicado para a escala da PROEX (equipe e centenas a poucos milhares de registros). Se o banco passar de alguns megabytes ou o uso crescer muito, migre para a hospedagem Cloudflare (`HOSPEDAGEM-PROPRIA.md`), que usa D1 nativamente, com o mesmo código e o mesmo formato de backup.

## Variáveis de ambiente (Vercel → Settings → Environment Variables)

| Nome | Conteúdo |
| --- | --- |
| `PROEX_DATABASE_URL` | Conexão do pooler do Supabase (`postgresql://postgres.<ref>:<senha>@aws-1-sa-east-1.pooler.supabase.com:6543/postgres`) |
| `BETTER_AUTH_SECRET` | Segredo das sessões. Não trocar: isso desconecta todos e invalida convites |
| `BETTER_AUTH_URL` | `https://proex-gestao.vercel.app` (ou o domínio definitivo) |
| `OWNER_EMAIL` | E-mail do primeiro responsável institucional |
| `SETUP_TOKEN` | Código de uso único da configuração inicial |
| `VINEXT_TRUST_PROXY` | `1`: o servidor confia no protocolo e no host informados pela Vercel |

Ao trocar o domínio, atualize `BETTER_AUTH_URL` e publique de novo.

## Primeiro acesso

1. Abra `https://proex-gestao.vercel.app/configuracao-inicial`.
2. Informe o código de configuração (`SETUP_TOKEN`), o e-mail de `OWNER_EMAIL`, seu nome e uma senha de 12 ou mais caracteres.
3. A página deixa de funcionar depois do primeiro uso. Depois disso, convide a equipe em **Equipe**.

## Carregar dados (planilha ou backup)

```bash
cd apps/proex-portal
PROEX_DATABASE_URL="postgresql://…" node scripts/portable-import.mjs planilha.xlsx --out importacao.sql --apply-postgres
```

O importador valida as linhas contra as migrações reais e lista o que foi rejeitado. Ele preserva os IDs, usa `INSERT OR IGNORE`, nunca sobrescreve registros e recalcula os saldos a partir dos movimentos. Use em um banco novo ou para completar dados que ainda não existem.

## Transferir para uma conta institucional

- **Supabase**: em *Project Settings → General → Transfer project*, mova o projeto para uma organização da UFG/PROEX.
- **Vercel**: em *Settings → General → Transfer*, mova o projeto para outra conta ou equipe. Conecte de novo o repositório se ele também mudar de dono.
- **Sem depender de nenhum dos dois**: rode `pnpm build:node` num servidor próprio e inicie com `vinext start`, usando `PROEX_DATA_DIR=/caminho/persistente` no lugar de `PROEX_DATABASE_URL`. O banco passa a ser um arquivo local.

## Limites do plano gratuito (outubro de 2026)

- A Vercel Hobby limita a conta inteira a 100 publicações por dia. A automação do Kino Campus usa a mesma conta e pode esgotar a cota. Nesse caso a publicação do portal espera a janela de 24 h, sem afetar o que já está no ar. Transferir o projeto para uma equipe própria da PROEX resolve.
- O Supabase gratuito pausa projetos sem atividade por uma semana. O cron diário mantém o projeto ativo.
