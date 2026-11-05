# Conexões pessoais MCP e mapa dos provedores — 05/11/2026

## O que existe

O `/mcp` anterior pertence ao ChatGPT Sites: tem doze ferramentas de sincronização, catálogo e anexos, com identidade nativa do Sites e exigência de mantenedor geral nos serviços. Em Vercel/standalone, `getChatGPTUser()` retorna `null`. Esse endpoint permanece preservado; não é uma conexão geral de qualquer IA com todo o portal.

O novo **`/api/mcp`** atende consultas pessoais limitadas, sem depender do Sites. Ele usa o mesmo banco e os serviços normais do portal, com uma credencial própria para cada pessoa. Não reutiliza chave da planilha, Google, IA, chave mestra ou sessão do navegador como credencial MCP.

## Onde configurar

Na **Conta → Conectar uma IA ao meu trabalho**. Link após publicação: [abrir conexões pessoais](https://proex-gestao.vercel.app/?tab=profile#mcp-connections).

1. Dê um nome à conexão, escolha os tipos de consulta e marque explicitamente os projetos.
2. Gere e copie a credencial exibida uma vez. Ela fica somente na memória da página; não entra em rascunho, armazenamento Web ou resposta posterior da listagem.
3. No cliente de sua confiança, use a URL `https://proex-gestao.vercel.app/api/mcp` e o cabeçalho `Authorization: Bearer SUA_CREDENCIAL`.
4. Consulte a compatibilidade do cliente. A implementação abaixo é de **MCP 2026-07-28**. Ela não implementa OAuth, cadastro dinâmico de clientes nem negociação de protocolos antigos.
5. Para encerrar o acesso, revogue a conexão na mesma seção. Se perdeu a credencial, revogue e gere outra.

O link acima depende da integração e publicação do coordenador; um commit local não comprova disponibilidade em produção.

## Credencial e autorização

- Prefixo de propósito `pxm_` e 32 bytes criptograficamente aleatórios. Apenas SHA-256 é salvo; o valor original não é recuperável pelo servidor.
- Validade padrão de 7 dias, máximo de 30; limite de 20 conexões ativas e 20 emissões por pessoa em 24 horas. A listagem prioriza todas as ativas antes do histórico recente. Revogar não reinicia esse limite.
- De 1 a 20 projetos explicitamente selecionados, sem wildcard ou autorização global automática. Escopos permitidos: `project.summary` e `tasks.read`.
- A emissão/listagem/revogação pertencem exclusivamente à pessoa da sessão canônica. Escritas de gerenciamento exigem origem da própria aplicação, JSON e `X-Proex-Action: 1`.
- Cada consulta relê credencial, validade/revogação, conta ativa, vínculos e acesso aos projetos **antes e depois** da leitura. Não aceita identidade informada por cabeçalho nativo do Sites, e-mail, cookie ou argumentos da ferramenta.
- Emissão e revogação geram auditoria sem a credencial ou seu hash. Consultas não atualizam `lastUsed`, não escrevem auditoria de leitura e não provocam uma gravação do snapshot inteiro a cada chamada.
- Credenciais pessoais e metadados MCP não são tabelas portáveis para Sheets/Drive. Backups administrativos seguem as proteções existentes do banco.

## Ferramentas e recursos deste corte

| Ferramenta | Escopo | Argumentos | Resultado |
|---|---|---|---|
| `proex_project_summary` | `project.summary` | `projectId` obrigatório | Ficha mínima: identificação, descrição, datas, situação, unidade, modalidade e versão |
| `proex_tasks_list` | `tasks.read` | `projectId`; `offset` entre 0 e 50000; `limit` entre 1 e 25, padrão 25 | Identificação, título, estado, urgência, importância, prazo e versão; paginação |

Recursos: `proex://projects/{id}/summary` e `proex://projects/{id}/tasks`. Somente projetos e escopos da conexão aparecem na listagem. O recurso de demandas contém as primeiras 25; a ferramenta oferece paginação.

As projeções não incluem contatos, documentos de pessoas, corpo das demandas, anexos, outros módulos ou versões históricas. Textos institucionais continuam sendo dados não confiáveis para instrução de modelos. O usuário deve evitar inserir segredos em títulos ou descrições.

Nenhuma ferramenta deste endpoint altera dados operacionais, realiza geração de IA, envia notificações ou dispara sincronização mestre. As ferramentas globais existentes de sync continuam apenas no endpoint anterior, com seus controles originais.

## Transporte e contrato

Implementa POST HTTP sem sessão de protocolo, resposta JSON e `resultType: "complete"`. Não exige nem aceita handshake `initialize`; GET e DELETE retornam 405. Não anuncia SSE, assinaturas, elicitação, prompts, sampling ou outras capacidades não implementadas.

Cada chamada contém `params._meta` com:

```json
{
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {}
}
```

Cabeçalhos obrigatórios: `Content-Type: application/json`, `Accept: application/json, text/event-stream`, `MCP-Protocol-Version: 2026-07-28`, `Mcp-Method` igual ao método do corpo e, para `tools/call` ou `resources/read`, `Mcp-Name` igual ao nome/URI. A codificação Base64 sentinel de `Mcp-Name` é decodificada antes da comparação. O corpo tem limite de 8 KiB.

Exemplo de corpo para uma consulta de projeto (substitua o ID observado; não invente IDs):

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "proex_project_summary",
    "arguments": { "projectId": "ID_DO_PROJETO_AUTORIZADO" },
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {}
    }
  }
}
```

Erros: `-32700` para JSON inválido; `-32600` para envelope inválido; `-32602` para argumentos/metadados inválidos; `-32020` para cabeçalhos divergentes; `-32022` com versões suportadas para versão não suportada; `-32601`/HTTP 404 para método ausente. Falhas de autenticação/autorização retornam HTTP 401/403 e códigos de aplicação fora do intervalo reservado ao MCP. Respostas privadas usam `no-store`, `nosniff` e `no-referrer`.

### Compatibilidade antiga e OAuth

Foi avaliada a separação entre versões: 2025-11-25 usa `initialize`, enquanto 2026-07-28 leva versão e capacidades em cada requisição e remove o GET stream. Um adaptador anterior pode compartilhar exatamente a mesma credencial, allowlist e autorização, mas exige testes com o SDK/harness pretendido. Este corte **não anuncia** essa compatibilidade sem ensaio real.

Bearer manual é a estratégia de autenticação personalizada deste piloto. OAuth 2.1 e descoberta de servidor de autorização são uma entrega separada; não há promessa de login automático em ChatGPT/Claude/Codex ou de funcionamento com clientes que não permitem cabeçalhos personalizados.

Fontes oficiais consultadas:

- [MCP 2026: base, resultados e metadados](https://modelcontextprotocol.io/specification/2026-07-28/basic/index).
- [MCP 2026: transporte HTTP, validação dos cabeçalhos e compatibilidade anterior](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http).
- [Schema TypeScript oficial de 2026-07-28](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts).
- [MCP: autorização HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).

## Mapa de chaves/modelos encontrado no código

| Função | Situação constatada antes desta rodada |
|---|---|
| Geração de proposta de estoque/registro | DeepSeek `deepseek-flash`, endpoint fixo oficial e revisão registrada; proposta validada antes de confirmação |
| Conferência e triagem de urgência/importância | TypeSafe JEV `jev-1.14.0`, contrato próprio com limiar de confiança |
| Transcrição | Deepgram Nova-3; Groq `whisper-large-v3-turbo` já tem adaptador, porém o piloto estava vinculado a uma organização e à credencial do servidor |
| Cofre na interface | DeepSeek, TypeSafe e Deepgram; gerenciamento/rotação por administrador e delegação de configuração em TI |
| NVIDIA / outros provedores e modelos livres | Sem adaptador ou configuração de geração no código inspecionado |

“Qualquer chave” não é o contrato atual. Compatibilidade parcial com um formato de API não garante os mesmos parâmetros, uso, limites, custo ou saída estruturada. Endpoints arbitrários também abririam uma superfície de SSRF e exfiltração. A evolução recomendada é um registro de provedores com adaptadores revisados, endpoint oficial fixo, modelos permitidos, capacidades e limites explícitos.

Incremento prioritário sugerido para outra frente: cadastrar Groq pelo cofre existente, preservando o adaptador, cifragem por organização, precedência explícita do piloto, revogação e ausência de fallback automático. Depois ampliar modelos/provedores um de cada vez com fixtures e validações próprias; não habilitar inferência paga para “testar se funciona”.

Fontes: [DeepSeek — API e modelo atual](https://api-docs.deepseek.com/), [Groq — diferenças de compatibilidade](https://console.groq.com/docs/openai), [Groq — transcrição e modelos](https://console.groq.com/docs/speech-to-text), [NVIDIA — endpoint e modelos LLM](https://docs.api.nvidia.com/nim/reference/llm-apis).

## Validação e continuação

- Testes integrados usam a migração SQL real e SQLite em memória: escopos, propósito de token, expiração, bloqueio/anônimização/pendência, troca de vínculo, CSRF, projeções, paginação, metadados e protocolos, revogação concorrente à emissão/leitura e ausência de escrita/custo em consultas.
- QA Chromium local usa **a interface real, API real e SQLite sintético**, criando e revogando uma credencial efêmera pelo próprio painel; a mesma credencial autentica o endpoint MCP. Claro/escuro em 375, 390 e 1366 px, sem overflow. Nenhum segredo real foi usado ou registrado.
- Tipos e lint passaram (zero erros; dois avisos de imagem anteriores em Equipe); `build:node` passou. Os oito testes focados MCP passaram. A suíte geral teve 986 testes: 984 passaram, a conferência do journal 0024 ficou pendente da integração coordenada e o teste anterior de avatar em workerd atingiu seu timeout de 30 segundos, com descarte Miniflare travado no Windows. Não foi alterado código de avatar.
- Revisão visual independente do coordenador: **9/10 neste recorte**, sem certificação de leitor de tela ou compatibilidade universal. O botão de emissão só habilita após escolher projeto e consulta, com orientação acessível; não gera credenciais automaticamente.
- Benchmark local de 50 consultas HTTP de ficha: p50 **14,11 ms**, p95 **41,21 ms**, zero erros, SQLite sintético em RAM e processo único. Não estima capacidade serverless/Vercel nem valida carga de produção.
- Artefatos locais ignorados: `apps/proex-portal/.sites-runtime/mcp-qa/` (capturas mascaradas, relatório, benchmark e harness).
- `0024_mcp_personal_tokens.sql` e o modelo Drizzle acompanham este incremento. O coordenador gera snapshot/journal 0024 sobre o conjunto final 0022/0023 antes de integrar/publicar.
- Integração, migração em produção, revisão no site e registro da entrega na Vault pertencem à finalização do coordenador. Não confundir os testes locais com publicação.
