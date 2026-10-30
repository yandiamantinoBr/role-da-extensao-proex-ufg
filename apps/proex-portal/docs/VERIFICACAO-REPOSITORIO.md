# Verificação do repositório

Os comandos abaixo são locais e devem ser executados em `apps/proex-portal`, com dados sintéticos e sem credenciais de produção:

```sh
npx --yes pnpm@11.25.0 install --frozen-lockfile
npx --yes pnpm@11.25.0 lint
npx --yes pnpm@11.25.0 check:types
npx --yes pnpm@11.25.0 test
npx --yes pnpm@11.25.0 build
npx --yes pnpm@11.25.0 build:node
```

`build` valida a alternativa Worker; `build:node` valida o adaptador usado na Vercel. Registrar apenas um deles não comprova a outra saída. A inspeção visual deve cobrir 375 px e janela de aproximadamente 1250 px, incluindo tabelas com conteúdo longo, formulários e diálogos. Testes locais não comprovam publicação ou estado da planilha.

## Proposta de CI, sem alterar deploy

Em uma futura revisão autorizada dos workflows, incluir um job de verificação para pull requests que alterem `apps/proex-portal`, os testes compartilhados ou o próprio workflow. Usar Node 24, pnpm 11.25.0 e lockfile congelado; executar lint, tipos, testes, build Worker e build Node. O job deve falhar em erros, sem usar segredos de Vercel, Supabase, Google ou dados reais. Saídas de testes não devem incluir dados pessoais.

Manter o deploy em fluxo separado e preservar os gatilhos atuais até revisão explícita. Nenhum workflow ativo foi alterado por esta proposta. A roleta da raiz continua com suas próprias verificações de preservação, tipos, testes e build Pages.

## Tipagem legada

As interfaces SQL anteriores usam linhas dinâmicas. A migração completa para tipos por consulta exige uma revisão própria dos serviços e de seus consumidores. Quando uma exceção `no-explicit-any` for indispensável nessa fronteira, ela deve ficar junto da declaração afetada, com justificativa no código; a regra permanece ativa no restante do projeto. Novos parsers e contratos devem preferir `unknown` e validação explícita.

Em `lib/database.ts`, o tipo legado `Row` centraliza essa exceção; campanha, participação e identificação de resultados da sincronização reutilizam esse contrato existente. Os parsers HTTP/login, a ordenação canônica de mutações/sincronização e a leitura de recibos usam `unknown` com verificação. Não há desativação global da regra.

O fallback de “Editar meu perfil” em `team-person-detail.tsx` preserva a âncora com exceção pontual para `no-html-link-for-pages`: o módulo do painel é lido apenas na inicialização, portanto a navegação precisa recarregar a página quando não há callback. A página não encontrada usa `next/link`, pois navega para outra tela sem depender dessa reinicialização.

## Verificação com Node 24 em 2026-10-30

O Node global desta máquina é 26.12.1. O runtime já instalado do Codex forneceu Node 24.22.1, executado diretamente para conferir a mesma versão principal configurada na produção, sem instalação adicional.

- Node 24.22.1: suíte completa com **321 testes aprovados**, zero falhas, saída 0; TypeScript com `--noEmit --incremental false`, saída 0.
- Node 24.22.1 e Node 26.12.1: `tests/files.test.mjs` isolado com **12 testes aprovados** em cada versão, saída 0.
- Evidência local completa: `apps/proex-portal/.sites-runtime/v9-evidence/testes-node24.txt`; execução isolada em `files-node24.txt` na mesma pasta. Esses arquivos ficam fora do versionamento.

A primeira execução no Node 24 terminou com os 321 casos aprovados e uma falha adicional do processo de `files.test.mjs`: uma rejeição assíncrona `ERR_INVALID_STATE: ReadableStream is already closed`. A causa foi reproduzida sem importar o portal: criar `Request` com `FormData` contendo um arquivo sintético de 10 MiB, ler seu corpo até superar 4 MiB + 64 KiB e cancelar o leitor provoca a rejeição no serializador multipart desse runtime, antes de ele escrever a boundary final.

O ajuste ficou somente no teste de arquivo excedente: ele materializa o multipart em `arrayBuffer` e cria uma nova `Request` com os mesmos cabeçalhos e os bytes recebidos pela rede. A API continua rejeitando o corpo com HTTP 413, sem gravar objetos ou documentos. O caso separado de corpo em chunks continua verificando cancelamento e limite. Nenhum tratamento de erro foi ocultado nem alteração de produção foi necessária para fazer a suíte passar.
