# Fase 01 Diagnóstico e primeiro incremento

Executado em 20/10/2026. O objetivo foi reabrir e preservar o jogo existente, definir ambientes e iniciar regras de acesso verificáveis sem depender de credenciais ainda inexistentes. Esta fase não implanta o portal institucional.

## Mapa da aplicação existente

| Área | Arquivo e comportamento observado |
| --- | --- |
| Interação | `app/page.tsx`: seleção, configurações, bloqueio, sorteio local e conclusão |
| Regra livre | `lib/roulette.ts`: RNG seguro, pesos, setores e orientações |
| Movimento | Web Animations API com fallback e duração escolhida |
| Áudio | `lib/game-audio.ts`: síntese, eventos por movimento, volume e interrupções |
| Identidade | `app/globals.css`, `app/layout.tsx`, `public/brand` |
| Pages | `github-pages/main.tsx` importa o mesmo jogo e CSS; build estático |
| Sites | Worker via Vinext; identidade nativa em `app/chatgpt-auth.ts` |
| Dados | `db/schema.ts` vazio; adaptador D1 sem binding ativo |

As preferências salvas no navegador não são registros de campanha nem controles de participação única. O novo núcleo não é importado por nenhuma dessas entradas, portanto não acrescenta autenticação, rede ou payload ao jogo livre.

## Referência e preservação

GitHub main e fonte atual Sites têm a mesma árvore `d07a71a224e5ee9e73b73da9098fd00c3af29749`, embora seus commits tenham históricos diferentes. `BASELINE.json` registra o commit público e hashes de 12 arquivos do jogo/identidade. `npm run check:legacy` verifica os bytes atuais usando o mesmo hash de blob Git.

Os endereços Sites e Pages responderam HTTP 200 com título Rolê da Extensão. Isso comprova disponibilidade HTTP naquele momento, não uma auditoria permanente de todas as rotas. A audiência pública e versão 7 foram confirmadas pela ferramenta Sites. Nenhuma nova versão foi publicada e nenhum agendamento foi reativado.

Reversão deste incremento: abandonar/reverter o PR de fundamento sem alterar a implantação livre. Não restaurar banco nem girar credenciais, pois nenhum recurso operacional foi criado. Uma release de legado continua proposta; registrar código em tag/release não preserva sozinho os endereços publicados. Não foi adicionada uma licença própria sem definição de titularidade.

## Núcleo de acesso

`authorize` verifica identidade interna, capacidades explícitas, escopo e instante válido. O módulo não obtém identidade do navegador: um futuro adapter de servidor precisa resolver o usuário e a propriedade real dos recursos. Grant de outro usuário/projeto/evento/local, expirado ou revogado não autoriza.

`canDelegate` exige autoridade de convite e teto explícito no mesmo vínculo; não combina vínculos independentes para criar privilégios mais amplos. Uma concessão com prazo não cria outra ilimitada. Exportação identificável é capacidade própria, sem herança de leitura agregada.

O serviço de convites guarda hash, exige e-mail verificado e relê as permissões do emissor no aceite. A porta de persistência exige transação serializável/locks, compare-and-swap que falhe em conflito, rollback de todas as escritas e unicidade de token e vínculo por convite. A fixture em memória implementa esse contrato somente para testes. Não é adaptador de produção. Tokens seguros exigem gerador criptográfico do futuro adapter; os testes usam valores sintéticos deliberados.

Revogação de convite pendente está coberta. Revogação de vínculo aceito e proteção do último responsável não estão entregues. Aplicação de RLS e proteção de APIs/anexos também dependem das próximas etapas.

## Verificações executadas

- `npm run check:types`: passou, sem atualização de dependências.
- `npm test`: 33 casos passaram, sendo 25 de acesso/convite e 8 do jogo.
- `npm run check:legacy`: 12 arquivos preservados byte a byte.
- `npm run build:pages`: passou; saída baseline CSS `index-CRPmy4gS.css`, JS `index-DZlldEbz.js`, respectivamente 25,09 kB e 102,31 kB gzip. A medição é tamanho de artefato, não desempenho em celular.
- `node <plugin Sites>/scripts/build-site.mjs`: build Worker passou. O build emite aviso de classificação de rota da ferramenta Vinext; não foi tratado como falha do aplicativo.
- `git diff --check`: passou.

Na prévia desktop, configurei roleta para 3 segundos e dado para 2 segundos, observei bloqueio durante sorteio e conclusão. Resultado de roleta Tente novamente terminou em 2460 graus (300 graus normalizados), correspondente ao setor. Dado Brinde terminou com rotação X=1080 e Y=1440 e face frontal Brinde. A geometria das seis faces, amostragem, configurações e cliques sintetizados também têm testes determinísticos. Não foram declarados teste auditivo humano, experiência em aparelho móvel real, competição em banco ou login Google concluídos.

Limitações de ferramentas: a prévia precisou de dependências locais disponíveis no próprio checkout, sem symlink para fora do volume. Uma edição no tsconfig recarregou a prévia durante um ensaio; o fluxo foi repetido depois. Um waitFor reportou timeout com diagnóstico já visível; a inspeção subsequente confirmou estado final. Erros de console amostrados vieram da extensão do navegador; não foi identificado erro do jogo nessa amostra.

## Próximas verificações necessárias

Testar adapter real de identidade, convites por SMTP, restrições de banco sob concorrência, revogação em sessão aberta, último responsável e fluxos móveis antes de anunciar administração utilizável. Operação com menores, estoque real e Instagram permanecem fora desta fase. Custos e dependências estão em `INFRAESTRUTURA.md`; a decisão está em `ADRS/0001-arquitetura-e-ambientes.md`.
