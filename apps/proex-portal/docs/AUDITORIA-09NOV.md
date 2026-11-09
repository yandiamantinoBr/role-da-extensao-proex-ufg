# Auditoria geral do Portal PROEX · 09/11/2026

Pedido do Yan: testar segurança, eficiência e uso real antes do CONPEEX (10 a 13/11), procurar brechas e corrigir com PRs pequenas.

## Resumo

- **Segurança:** 108 sondas automáticas contra um servidor local descartável, todas aprovadas. Não houve vazamento entre projetos, falha de CSRF, sessão falsa aceita, upload perigoso aceito nem injeção. O acesso por perfil se manteve em todos os casos testados.
- **Um problema alto, corrigido nesta PR:** pedidos anônimos a uma rota de conta conseguiam forçar uma regravação completa do banco a cada chamada. Em volume, isso deixaria as gravações da equipe lentas ou com falha durante o evento.
- **Desempenho:** em produção, as rotas principais respondem entre 70 e 230 ms. O gasto evitável mais visível era a foto de perfil, com 416 KB baixados de novo a cada página. Agora ela fica em cache.
- **Uso real:** os cinco roteiros funcionam no celular e no computador. Há pontos que confundem (seção "Testes de usuário"), sem trava nos fluxos testados.

## Como foi feito

| Onde | O que | Limite |
|---|---|---|
| Servidor local (`scripts/qa-local.mjs`, 127.0.0.1:5173) | Todos os testes que gravam: ataques, uploads, limites, medições de gravação e roteiros de uso | Dados sintéticos. Duas contas: responsável e bolsista com papel de estoque só no projeto A. O projeto B serve de alvo. |
| Produção (`proex-gestao.vercel.app`) | Somente leitura: cabeçalhos, tempos de resposta, tamanho de arquivos e telas, com a sessão do Yan no Chrome | Nada foi enviado ou salvo em produção. |
| Código | Revisão das rotas novas desde a última revisão de segurança (níveis de brinde, foto principal, planejamento, uploads, sincronização com Sheets) | As rotas do Rolê ficaram com a sessão dona. |

Os scripts das sondas ficaram fora do repositório. Eles usam a senha pública de QA, que já está em `qa-local.mjs`.

## Achados priorizados

| ID | Gravidade | Área | Achado | Estado |
|---|---|---|---|---|
| A1 | **Alta** | Disponibilidade e custo | Cada chamada anônima a `/api/auth/*` gravava uma linha do limitador do Better Auth. No alvo Node, cada gravação reenvia o banco inteiro ao Supabase e disputa a vez com as gravações da equipe. Sem IP configurado na Vercel, todos ainda dividiam um único balde. | **Corrigido nesta PR.** O limitador passou para a memória e, na Vercel, usa a chave por `x-real-ip`. Medição local: 25 chamadas anônimas antes geravam **25 gravações**; agora geram **0**. |
| A2 | Média | Disponibilidade e custo | O limitador próprio do portal (`lib/rate-limit.ts`) gravava mesmo quando já recusava a tentativa, uma vez por balde. No login, isso dava 2 a 3 gravações por tentativa, sem limite. | **Corrigido nesta PR.** Um balde cheio recusa só com leitura, e os baldes de uma tentativa entram numa única transação. Medição: 30 senhas erradas antes geravam **cerca de 60 gravações**; agora geram **10**, e nenhuma depois do bloqueio. Um login correto caiu de 4–5 para 3 gravações. |
| A3 | Média | Desempenho | A foto de perfil (PNG de 416 KB) vinha com `no-store` e era baixada de novo em toda página. | **Corrigido nesta PR.** A versão atual (`?v=`) fica em cache privado por 1 dia, e versões antigas continuam `no-store`. Sair da conta envia `Clear-Site-Data: "cache"`, pensando nos computadores compartilhados do estande. **Falta:** reduzir a foto na origem (WebP ou 256 px), o que deixaria o arquivo bem menor que 100 KB. |
| A4 | Baixa | Desempenho e custo | Rotas com taxa por pessoa (níveis de brinde, planejamento, transferência de demanda) fazem **2 regravações** por ação: a da taxa e a da operação. | Recomendação: contar a taxa na mesma transação da operação. |
| A5 | Baixa | Arquitetura | Toda gravação reenvia o banco inteiro compactado. No QA sintético isso dá cerca de 100 KB. O backup de produção de 31/10 tinha 0,49 MB. A escolha é consciente e foi documentada (`HOSPEDAGEM-VERCEL.md`), mas o custo cresce com o banco. | Acompanhar o tamanho do instantâneo. Não portar para Postgres (decisão vigente). |
| A6 | Baixa | Segurança (camada extra) | A CSP de produção só tem `frame-ancestors`, sem `script-src`. O React já escapa os textos (o teste com `<img onerror>` foi tratado como texto) e os anexos saem com `sandbox`. | Recomendação: CSP com `script-src 'self'` e hash do script de tema, testada antes num deploy de prévia. |
| A7 | Baixa | Desempenho | O pacote principal `portal-client` tem 1,4 MB, ou 305 KB com brotli. PDF e fontkit já carregam só quando são usados. | Recomendação: dividir os módulos pesados (Relatórios, Equipes) por rota. |
| A8 | Baixa | Desempenho | `/api/material-attention` é chamado duas vezes ao abrir o Início. | Recomendação: deduplicar a busca. |
| A9 | Média | Privacidade | Apontado pela sessão Comunidade (ouvidoria anônima, PR51). `auth_session` guardava IP e navegador de cada login. Quem administra hospedagem e banco poderia cruzar esses dados com o log da Vercel de um relato anônimo e estimar o autor. Nada no portal lia esses campos. | **Corrigido em PR própria.** Um gancho do Better Auth grava os dois campos vazios. O limitador continua usando o IP, em baldes próprios com hash e sem ligação com a conta. **Resta:** sessões abertas antes do deploy guardam os valores até expirar (no máximo 7 dias), e os logs da própria Vercel continuam existindo. |

## Segurança: o que foi testado (108/108 aprovadas)

- **Bolsista contra outro projeto (21 ações):**
  - saída de estoque, edição e criação de material e kit;
  - status do evento, devolução e criação de empréstimo;
  - convite de gestor, tanto no outro projeto quanto como escalada no próprio;
  - foto principal, registro, demanda, níveis de brinde e planejamento;
  - chave do conector Sheets e backup.

  Todas as tentativas foram recusadas com 403 e o saldo e o estado do projeto B ficaram intactos.
- **Leitura cruzada (11 consultas):** ficha do material, registros, anexos, demandas, níveis, planejamento, relatório, exportação, consumo e diretório. Nenhuma devolveu dado do projeto B.
- **Anônimo:** 31 rotas POST e 25 GET responderam sem dado, com 401, 403, 404, 405 ou 415.
- **CSRF:**
  - pedido sem `X-Proex-Action`, com origem estranha ou como formulário `text/plain` foi recusado;
  - Demandas e Registros exigem a mesma origem;
  - o cookie é `HttpOnly` e `SameSite`.
- **Sessão:** um cookie adulterado foi recusado e uma sessão encerrada não voltou a funcionar.
- **Limites e erros:**
  - JSON acima de 32 KB recebe 413, e JSON quebrado recebe uma mensagem genérica sem SQL ou pilha;
  - mais de 10 senhas erradas resultam em 429.
- **Injeção:**
  - o nome `x' OR 1=1; DROP TABLE items;--` foi gravado como texto;
  - filtros de demanda com aspas foram recusados (400);
  - textos iniciados por `=` ficam literais no XLSX (prefixo `'`) e no Sheets (formato texto `@` e rich text).
- **Uploads:**
  - SVG disfarçado de PNG e HTML foram recusados (415);
  - o nome `foto.jpg.html` foi recusado;
  - um arquivo acima de 4 MB recebeu 413.
- **Rotas públicas que poderiam gravar:** feed de calendário, arquivos do conector, eventos, saúde, convite, MCP e pedidos de participante. Nenhuma gravou o banco em chamadas anônimas.
- **Chaves:** nenhuma resposta, log ou erro trouxe segredo. Erros desconhecidos registram só o nome do erro (`lib/errors.ts`).
- **Produção (só leitura):**
  - HSTS com preload, `nosniff`, `X-Frame-Options`, `Referrer-Policy: no-referrer` e `Permissions-Policy`;
  - APIs privadas respondem 401 sem sessão.

## Desempenho

**Produção, Chrome com a sessão do Yan, 5 amostras (ms):**

| Rota | Tempos |
|---|---|
| `/api/portal` | 161, 180, 170, 227, 215 |
| `/api/my-work/summary` | 73–101 |
| `/api/follow-up?view=inbox` | 70–148 |
| `/api/follow-up?view=tasks` | 71–89 |
| `/api/materials` | 65–114 |
| `/api/records` | 69–257 |

Na página inicial, o primeiro byte chegou em 23 ms (CDN), o DOM ficou pronto em 466 ms e a página carregou em 699 ms.

**Local, depois da correção, mediana e p95 (ms):**

| Rota | Mediana | p95 |
|---|---|---|
| `GET /api/portal` | 32 | 37 |
| Demandas | 8 | 15 |
| Meu trabalho | 12 | 14 |
| Ficha do material | 11 | 19 |
| Saída de estoque | 31 | 44 |
| Níveis de brinde (2 gravações) | 56 | 71 |

**Gravações do banco por ação (local):**

| Ação | Antes | Depois |
|---|---|---|
| Leituras (painel, demandas, níveis) | 0 | 0 |
| `/api/auth/*` anônimo | 1 por chamada | 0 |
| Senha errada | 2–3 por tentativa, sem fim | 1 até o bloqueio, depois 0 |
| Login correto | 4–5 | 3 |
| Saída de estoque, nova demanda | 1 | 1 |
| Níveis de brinde | 2 | 2 (A4) |

As telas não estouram a largura: em 375 px, `scrollWidth` foi igual a `clientWidth` em Materiais. Em 1366 px, o mesmo valeu para Início, Materiais, Empréstimos, Demandas e Registros.

## Testes de usuário (CONPEEX)

Roteiros feitos no servidor local, no celular (375 px) e no computador (1366 px), com dados sintéticos.

| Roteiro | Resultado | O que confunde |
|---|---|---|
| Dar saída de brindes por lote | **Funciona.** Ficha do material → Movimentar estoque → Entrega ou distribuição. Saldo foi de 40 para 28 e o histórico mostrou a linha. | **U1.** No celular, a lista de Materiais começa depois de uma tela inteira de filtros, e o formulário geral de movimento fica a mais de 4 telas. O caminho rápido, pela ficha, existe, mas não é óbvio. **U2.** O formulário começa em "Recebimento": quem só digita a quantidade **soma** ao estoque em vez de tirar. **U3.** Não há como dar saída de vários materiais de uma vez (lote misto da manhã): é um registro por material. |
| Registrar empréstimo e devolução | **Funciona.** Devolução registrada com "Registro salvo". | **U4.** A devolução fica escondida em "Detalhes, termos e ocorrências" no cartão. **U10.** O campo de arquivo do termo mostra "Choose File" (nativo, em inglês). |
| Abrir e concluir demanda | **Funciona.** | **U5.** Com "Todos os projetos" não aparece "Nova demanda", nem uma dica para escolher o projeto. **U6.** Para concluir é preciso Editar → Estado → Salvar, sem botão direto de concluir. **U7.** O aviso "Registro salvo" de Empréstimos continuou visível ao abrir Demandas. |
| Trocar foto de material | **Funciona bem.** Prévia lado a lado, aviso de baixa resolução e foto anterior preservada. | Nada relevante. |
| Consultar o histórico | **Funciona por material** (ficha → Histórico). | **U8.** Registros não mostra saídas de estoque, devoluções nem demandas: quem procura "o histórico" ali não acha a saída de brindes. **U9.** "28 unidade" no singular (já conhecido) e "Novembro De 2026". |

U8 e U9 foram repassados à sessão da página Registros. U1–U7 e U10 são sugestões de interface: ficaram fora desta PR, que trata de segurança e desempenho.

## Legibilidade, console e exploração por perfil (2ª frente, 09/11 à tarde)

Pedido do Yan, transmitido pela sessão coordenadora: deixar o código legível para pessoas e IAs, olhar os erros que aparecem ao clicar no ícone de atenção do navegador e explorar o portal ativamente.

**Nomes de classe legíveis.**
- O inspetor agora mostra `Arquivo_classe__hash` (ex.: `NotificationBell_trigger__3693d`) em vez de `_trigger_x8k2_1`. A configuração está em `scripts/vite/readable-class-names.mjs`, com teste próprio, e nenhum arquivo foi renomeado.
- Custo medido no build Node: CSS compactado de 95,9 KB para 101,3 KB (+5,4 KB, +5,7%) e pacote JS principal compactado de 419,3 KB para 424,9 KB (+1,3%).
- Sem erro de hidratação: o servidor e o navegador geram o mesmo nome.

**Console em produção, com o login do Yan:**
- **Nenhum erro.**
- Laços e requisições repetidas: não há. O Início faz 6 chamadas ao abrir e nenhuma nova em 20 segundos.
- Um único **aviso** do Recharts ("width(-1) and height(-1)") se repete a cada gráfico montado, porque o `ResponsiveContainer` começa com tamanho -1. Fontes e donos:
  - `activity-panel` (Registros e visual);
  - `reports-center` (Relatórios);
  - `ai-spending-panel` (Rolê e chaves).

  A correção de uma linha foi enviada a cada sessão.

**O ícone de atenção** é o painel *Issues* do DevTools: "A form field element should have an id or name attribute". Em produção eram de 3 a 31 campos por página.
- Corrigido aqui, por serem compartilhados ou sem dono:
  - seletor de tema;
  - filtros Projeto, Unidade e Área;
  - hora do `DateTimeField`;
  - situação da dinâmica;
  - Conta (perfil, senha, apelido e CPF);
  - filtros de Projetos e Demandas;
  - Meu trabalho.
- Medido no servidor local depois da correção: o Início e a Conta passaram a **0** campos sem `id`/`name`.
- Os restantes foram enviados às sessões donas: Relatórios (27), Registros (4), Agenda (4), Pessoas e acessos (4), Equipes (3), Comunidade (2), Materiais, Empréstimos e Dinâmicas (1 cada).

**Exploração por perfil** (servidor local com dados sintéticos; bolsista no celular, técnico e administração no computador):
- Os 14 módulos abrem sem erro na tela, sem estouro de largura e sem mensagem técnica vazada.
- O bolsista (estoque) não vê Empréstimos, Dinâmicas nem Pessoas e acessos.
- Para o técnico, Configurações volta ao Início em silêncio (sem permissão). Sugestão: mostrar um aviso curto.
- Achados de interface U1–U10 já enviados (seção "Testes de usuário").

**Glossário:** `docs/GLOSSARIO.md`, com termos, tabelas, sinônimos, mapa de pastas e plano de consolidação em quatro fases para depois de 13/11. Linkado no `AGENTS.md` e no `README`.

## Não verificado

- Escrita em produção, de propósito. As correções serão conferidas lá depois do deploy, com chamadas que não gravam.
- O tamanho atual do instantâneo e as métricas do Supabase de produção. O projeto fica na organização PROEX UFG, fora do conector disponível nesta sessão.
- Celular físico, leitor de tela, zoom de 200% e carga com muitas pessoas ao mesmo tempo.
- Rotas e chaves do Rolê, que estão com a sessão própria.
