# V9 · Correções e validação local

Verificação em 30/10/2026, sobre `d7b74f484c9f512e96382e1b2fa66cd9b4466c24`, na branch local `v9-correcoes`. Esta entrega não foi enviada ao GitHub nem publicada. A produção conferida na Vercel permanece na V8, nesse commit, com `/api/health` HTTP 200.

## Comportamento corrigido

- Relatórios de empréstimos convertem início/fim em milissegundos, respeitam os dias de Brasília e calculam atraso numericamente. Retirada futura não aparece atrasada.
- Falhas e respostas perdidas da persistência descartam a cópia SQLite local; a próxima operação recarrega a fonte, preservando idempotência e controle de versão.
- Consultas públicas de eventos deixam de regravar o banco. A interface identifica a contagem de visitas como histórica, com coleta suspensa. O conector autentica antes de limitar chamadas, limpa baldes vencidos em lote e reduz atualizações de `last_used_at`.
- Novos termos e anexos de Registros compartilham o limite de 4 MiB, com margem de 64 KiB para multipart e mensagem útil mesmo quando o provedor retorna 413 em HTML. Downloads antigos permanecem disponíveis.
- Formulários, filtros, seleção de colunas, tabelas e detalhes de materiais se adaptam à largura disponível; campos móveis usam 16 px. Há atalho de teclado para o conteúdo principal.
- Rascunhos de Registros passam a identificar seus campos e ativar no momento de abrir o formulário. Período e vínculos são restaurados. Logout limpa os rascunhos e impede recriação em abas antigas, inclusive quando estavam sem formulário. Identificação e contato do tomador não entram no rascunho.
- O Apps Script preserva campos novos ausentes numa edição de planilha antiga nos serviços que aceitam atualização parcial. Campanhas e tabelas desconhecidas continuam exigindo dados completos.
- Cabeçalhos de segurança foram preparados em `vercel.json`, preservando câmera na própria origem. Sua aplicação no provedor depende da publicação.
- Lint legado corrigido, parsers tipados e documentação de hospedagem/sincronização atualizada; `AGENTS.md`, exemplo de ambiente sem valores e registros V7/V8 incluídos. A proposta de CI está documentada; workflows ativos não foram alterados.

## Evidências

Todos os dados e arquivos de QA são sintéticos. O servidor descartável usa loopback, diretório temporário e ambiente por lista de permissão, sem carregar arquivos de segredos ou acessar produção.

| Verificação | Resultado |
|---|---|
| Suíte completa `node --test tests/*.test.mjs` | 321/321 em Node 26.12.1 e 24.22.1, sem falhas ou testes pulados; uploads 12/12 nas duas versões após ajuste do transporte do teste |
| Tipos, configuração existente do projeto | Sem erros nas duas versões de Node |
| ESLint completo | 0 erros, 4 avisos: navegação de Registros, duas imagens privadas e exportação de ambiente |
| `build` Worker + smoke compilado | Login, identidade, API, logout, revogação e MCP passaram |
| `build:node` | Passou em Node 26 e 24 |
| QA HTTP autenticado | Configuração sintética, projetos, estoque, evento, empréstimo, registro e relatório passaram |
| Conector simulado contra o servidor | Exportação, duas alterações, leitura de retorno, conflito e linha inválida passaram também no QA HTTP com Node 24 |
| Planilha antiga, VM + SQLite real em memória | 4 regressões passaram; expansão de colunas e nova aba conferidas |
| Navegador | 375/414 px e desktop 1250 px; projetos, agenda, materiais, registros e relatórios conferidos; atalho com foco visível e destino `main` validado por teclado no build Node 24 final |
| Rascunho no navegador | Projeto/categoria diferentes do inicial, período, material/empréstimo, limpeza após salvar e logout em três abas conferidos |
| Arquivos no navegador | Anexo PNG sintético enviado e relido; Excel baixado com datas e situação corretas |
| Console do navegador | Sem erros; avisos transitórios de dimensão inicial do Recharts, com gráficos renderizados |
| `git diff --check` | Passou |

Resultados locais detalhados e capturas ficam em `apps/proex-portal/.sites-runtime/v9-evidence/`, ignorados pelo Git. O QA foi encerrado e seu banco temporário removido.

## Benchmarks internos

Comparação reproduzível: `node scripts/benchmark-public-events.mjs`, 100 GETs e 1.000 projetos sintéticos, SQLite real de 1.470.464 bytes, compressão gzip e store remoto simulado em memória, sem rede.

| Medida | V8 | V9 local |
|---|---:|---:|
| Instantâneos persistidos | 100 | 0 |
| Bytes persistidos | 34.507.198 | 0 |
| p50 | 23,969 ms | 0,652 ms |
| p95 | 33,860 ms | 0,892 ms |

QA HTTP do build Node: evento público, 25 amostras, p50 1,36 ms/p95 1,77 ms; painel autenticado, 25 amostras, p50 8,54 ms/p95 10,25 ms. Rajada de 100 consultas públicas com concorrência 10: zero falhas, p95 14,31 ms. São medidas de loopback em um processo; não estimam latência, capacidade serverless ou comportamento distribuído da produção.

Para repetir o fluxo completo após `build:node`: `node scripts/qa-local.mjs --benchmark --sync-smoke --smoke`. Sem `--smoke`, o servidor fica aberto para inspeção; `parar` ou Ctrl+C encerra o QA e limpa seus dados.

## Pendências de publicação e produto

Revisar o commit local e obter autorização específica antes de push, PR, merge ou deploy. Depois da publicação, verificar revisão, cabeçalhos, login, relatórios, anexos e câmera na origem real. Câmera física e aparelhos reais não foram exercitados. A linha Node 24 foi conferida usando o runtime já instalado, sem novas dependências; a causa e o ajuste do teste de multipart estão em `apps/proex-portal/docs/VERIFICACAO-REPOSITORIO.md`. Há build Worker alternativo validado.

A planilha real ainda usa uma estrutura anterior; versão instalada do Apps Script, gatilho e pasta ativa precisam ser conferidos. Publicar o asset `.gs` no portal não instala o código no projeto vinculado à planilha. Duplicidade de projetos e política de compartilhamento continuam registradas na Vault, sem mudanças externas.

Backup fora do Supabase, restauração completa com arquivos, participação pública, perfis institucionais, retenção/LGPD e transferência de contas continuam pendentes das decisões e etapas descritas na Vault. Este pacote reduz falhas e custo de leitura; escritas legítimas ainda persistem o instantâneo completo.
