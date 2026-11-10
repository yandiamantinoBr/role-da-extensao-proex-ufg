# Rolê, o assistente da PROEX, e a central de chaves · 09/11/2026

Brief: a equipe da PROEX quer um assistente com a cara do mascote Rolê. Ele recebe texto, imagem e áudio e roda só por API, sem processamento local. O administrador geral precisa de uma área clara para colar, testar, trocar, desligar e remover chaves. O valor da chave nunca volta à tela, ao log nem às exportações. Nenhuma chamada paga sai sem a pessoa ver antes o custo máximo previsto.

## Pronto quando

- [x] Central em **Configurações → Chaves e modelos**, só para a administração geral. Ela mostra nome, provedor, dica mascarada (prefixo + últimos 4), preço oficial resumido, situação e último teste.
- [x] **Testar** na própria linha da chave. O custo previsto aparece antes (US$ 0,00): o teste só consulta a lista de modelos do provedor e não gera texto.
- [x] **Histórico das chaves** com até 15 eventos (salvar, trocar, testar, desligar, religar, remover, recriar o cofre e recifrar), quem fez e quando. Mostra só a dica, nunca o valor.
- [x] Teste `LEAK GUARD` em `tests/role-assistant.test.mjs`. Ele falha se uma chave canário aparecer em resposta da API, mensagem de erro, histórico, auditoria, texto do banco (exceto a coluna cifrada), `console.*`, snapshot do portal ou exportações portáteis.
- [x] `PROEX_KEYS_SECRET` foi criado na Vercel (produção, sensível) em 09/11/2026, com valor gerado localmente e sem exibição. Antes disso, rodaram os testes de recifragem retomável, rotação e recuperação (`tests/assistant.test.mjs`: migração em lotes, CAS, chave anterior e recuperação com confirmação explícita).
- [x] Rolê com botão flutuante (atalho **Alt + R**), conversa, foto, áudio transcrito e custo antes de cada envio. Operações passam pela revisão humana já existente.
- [ ] Chaves reais: quem cola é o Yan, na tela. O primeiro teste real de cada provedor fica registrado no histórico.

## Como funciona

| Entrada | Caminho | Custo mostrado antes |
|---|---|---|
| Texto | `POST /api/assistant/role` `action=chat` → DeepSeek Flash ou GPT-OSS 120B na Groq | Teto calculado igual no navegador e no servidor (`roleEstimate`). Se o valor aceito ficar abaixo do teto do servidor, ele recusa com `role_cost_changed` |
| Imagem | Reduzida no navegador para até 1024 px e 1,5 MB, em JPEG. Vai sempre para DeepSeek Flash, que aceita imagem | O mesmo teto, mais 2.048 tokens por imagem (margem conservadora) |
| Áudio | Gravado no navegador (até 60 s), convertido em WAV 16 kHz. Os modelos de conversa não recebem som, então a transcrição vem antes: `POST /api/assistant/speech` (Groq Whisper turbo ou Deepgram) | `Transcrever · até US$ X`, pela duração (Groq: US$ 0,04/h, mínimo de 10 s) |
| Operação | O Rolê devolve `operation` (pedido em texto). A pessoa clica em **Ver custo para preparar** (`action=estimate.operation`, grátis), depois em **Preparar** (fluxo assinado `prepare`) e confirma a prévia (`apply`) | Teto da preparação, igual à reserva real do `prepare` |

Regras do servidor (`lib/assistant/role.ts`):

- Exige permissão `inventory.read` no projeto, a política de uso da organização ("Só eu" ou "Organização") e o interruptor `roleEnabled`. A barreira é rechecada no mesmo lote que grava o resultado.
- Antes do transporte, reserva o teto em `ai_calls` e `ai_organization_usage`, dentro do limite diário de custo, tokens, chamadas e tempo. Um envio repetido não cobra de novo.
- A auditoria `assistant.role.chat` guarda só provedor, modelo, tokens, teto, custo real e se havia imagem. O texto e a imagem não são gravados.
- Uma resposta que repete a chave ou parece conter credencial é retida (`role_provider_schema`).
- Desligar ou remover a chave do provedor do Rolê desliga o Rolê. Desligar a DeepSeek desliga a leitura de imagens.
- Imagem conferida no servidor: decodificação completa do base64, assinatura (PNG, JPEG ou WebP com `WEBP`), largura e altura lidas do cabeçalho (até 1024 px) e no máximo 1,5 MB.
- Os turnos anteriores enviados pelo navegador passam pela mesma limpeza (e-mail e CPF omitidos, credenciais recusadas), seja do usuário ou do Rolê.
- O servidor reconfere permissão e configuração logo antes de enviar ao provedor.
- Se o uso real passar do teto, a diferença entra no limite diário e a auditoria marca `overrun: true`.
- No Rolê, a operação sugerida pode ser editada. O custo é calculado de graça e a pessoa autoriza o envio do pedido e da lista de materiais. O `prepare` recebe `acceptedCostMicros` e recusa (`assistant_cost_changed`) se a reserva real ficar maior. A prévia mostra projeto, quantidade, antes e depois, e o texto que será gravado.
- O consentimento do chat fica só na memória da página e some ao recarregar ou trocar de conta.

Reversão: uma versão anterior do portal recusa qualquer configuração de IA salva por esta versão, porque o JSON passa a ter `roleEnabled`, `roleProvider` e `roleVisionEnabled`. Não volte o deploy para um SHA anterior depois que alguém salvar "Funções e acesso". Para desfazer, publique um commit novo que esconda a interface e mantenha `validateConfig` aceitando esses três campos.

Configuração nova (sem migração; JSON antigo continua válido): `roleEnabled`, `roleProvider` (`deepseek` | `groq`) e `roleVisionEnabled`.

Arte: `public/brand/role-mascote/role-rosto.svg` (recorte do rosto) e `role-frontal.svg` (corpo inteiro). Os dois foram gerados a partir de `Drive: Yan/Trabalho/PROEX/Rolê da Extensão/Mascote Rolê — vetorizado/Rolê - vista frontal.svg`, sem metadados.

## Provedores: preço e cota (páginas oficiais lidas em 09/11/2026)

| Provedor | Modelo (ID da API) | Papel | Preço (US$) | Cota grátis | Áudio / imagem | Fonte |
|---|---|---|---|---|---|---|
| Groq | `whisper-large-v3-turbo` | transcrição | 0,04 por hora, mínimo de 10 s | Plano Developer: 20 RPM, 2.000 RPD, 7.200 s de áudio por hora. A página não mostra os limites do plano Free | áudio, até 25 MB (Free) | console.groq.com/docs/speech-to-text · /docs/rate-limits |
| Groq | `openai/gpt-oss-120b` | texto | 0,15 entrada / 0,60 saída por 1M tokens | Developer: 30 RPM, 1.000 RPD | só texto | console.groq.com/docs/model/openai/gpt-oss-120b |
| Groq | `openai/gpt-oss-20b` | decisão barata | 0,075 / 0,30 | igual | só texto | …/model/openai/gpt-oss-20b |
| Groq | `qwen/qwen3.8-27b` (prévia) | visão | 0,80 / 4,00; 2.048 tokens por imagem | Developer | imagem | console.groq.com/docs/vision |
| DeepSeek | `deepseek-flash` (V4.1-Flash-1017) | texto e visão | 0,30 entrada sem cache / 1,20 saída (metade fora do pico) | não há | imagem sim | api-docs.deepseek.com/quick_start/pricing/ |
| TypeSafe | JEV (acesso antecipado) | decisão tipada | 0,042 por 1M tokens de entrada; a saída não aparece na página | não há | texto e imagem | typesafe.ai · docs.typesafe.ai |
| Google | `gemini-3.1-flash-lite` | texto, visão e áudio | 0,25 entrada (0,50 com áudio) / 1,50 saída | Gratuito no AI Studio, mas usa os dados para melhorar produtos | áudio e imagem | aistudio.google.com/docs/pricing |
| Google | `gemini-2.5-flash-lite` | econômico | 0,10 / 0,40 | grátis, nas mesmas condições | áudio e imagem | idem |
| OpenAI | `gpt-6-luna` | texto e visão | 0,10 / 0,50 | não há | imagem | developers.openai.com/api/docs/models/gpt-6-luna |
| OpenAI | `gpt-transcribe` | transcrição | 0,0045 por minuto | não há | áudio, até 25 MB | developers.openai.com/api/docs/pricing |
| Deepgram | `nova-3` (pt-BR) | transcrição | 0,0043 por minuto gravado | US$ 200 uma única vez | áudio | deepgram.com/pricing |
| AssemblyAI | `universal-2` | transcrição | 0,15 por hora | US$ 50 uma única vez | áudio (pt-BR) | assemblyai.com/pricing |
| ElevenLabs | Scribe v2 | transcrição | 0,22 por hora | cerca de 4 h 30 min por mês no plano Free | áudio | elevenlabs.io/pricing/api |

Artificial Analysis (artificialanalysis.ai/leaderboards/models, 09/11/2026). A página mostra o custo por tarefa, não por token. As melhores relações índice/custo foram GPT-6 Luna (índice 21, US$ 0,07), DeepSeek V4.1 Flash (29, US$ 0,46), MiniMax-M3.1-Flash (29, US$ 0,49) e GLM-5.3-Flash (28, US$ 0,58).

### Custo típico por uso

| Uso | Modelo | Custo |
|---|---|---|
| Mensagem curta (1.500 tokens de entrada, 400 de saída) | DeepSeek Flash | ≈ US$ 0,0009 (pico) |
| Mensagem curta | GPT-OSS 120B na Groq | ≈ US$ 0,0005 |
| Foto (≈ 1.000 tokens) | DeepSeek Flash | ≈ US$ 0,0005, mas a contagem oficial de tokens da imagem não foi publicada |
| Áudio de 30 s | Groq Whisper turbo | ≈ US$ 0,0003 |
| Decisão JEV | TypeSafe | ≈ US$ 0,00006 |

### Padrão recomendado (grátis ou barato, tudo por API)

1. **Conversa e imagens: DeepSeek Flash.** Uma chave cobre texto e visão. É o 2º melhor custo-benefício do Artificial Analysis e já tinha contrato revisado no portal.
2. **Voz: Groq `whisper-large-v3-turbo`.** É a transcrição mais barata da tabela. A mesma chave Groq libera a conversa econômica com GPT-OSS 120B, se o Yan preferir.
3. **Decisão e triagem: JEV (TypeSafe)**, já integrado. O GPT-OSS 20B na Groq fica como alternativa futura, sem adaptador ainda.
4. **Alternativa paga de qualidade:** OpenAI (`gpt-6-luna` + `gpt-transcribe`) ou Gemini 3.8 Flash. Nenhum dos dois tem adaptador nesta versão.

O Gemini Flash-Lite cobriria tudo com uma chave e de graça. Mas o plano gratuito usa os dados para melhorar os produtos, o que não serve para dados internos da UFG, e o portal ainda não tem adaptador para ele. Fica como proposta.

### Não confirmado

- Limites do plano Free da Groq: a aba aparece vazia, e a tabela visível é a do plano Developer.
- Suporte oficial a pt-BR no Whisper da Groq: a página diz só "multilingual". Deepgram e AssemblyAI confirmam pt-BR.
- Contagem de tokens de imagem no DeepSeek: o portal reserva 2.048 tokens por imagem até o primeiro teste real.
- Formato exato de imagem aceito pela API da DeepSeek: o portal usa `image_url` com data URL, no padrão OpenAI. Confirmar no primeiro envio real com custo registrado.
- O adaptador OpenAI do portal fixa `gpt-5.6-luna`. A página atual lista `gpt-6-luna`; revisar numa rodada própria.

## Verificação

- `node --test tests/role-assistant.test.mjs`: 9 testes, cobrindo contrato, status sem custo, reserva, auditoria sem conteúdo, consentimento, teto, permissão, imagem, Groq, chave refletida, teto diário, política privada, estimativa de operação e LEAK GUARD.
- `tests/assistant.test.mjs`: atualizado para aceitar `mask` na auditoria do cofre, que segue sem valor.
- Capturas e crítica independente: ver `docs/evidencias/2026-11-09-role-chaves/`.

## Catálogo de modelos, comparação e gastos · 09/11/2026 (tarde)

Pedido do Yan: poder cadastrar qualquer modelo por API (OpenAI, Anthropic, NVIDIA e serviços compatíveis), apagar e editar, organizar as chaves por função, comparar modelos testando e acompanhar os gastos com gráfico e exportação.

- **Catálogo por organização**, em Configurações → Chaves e modelos → **Modelos**, só para a administração geral. Fica salvo na tabela `settings` (`ai.catalog.v1:<organização>`), sem migração. Cada modelo tem provedor, nome na API, capacidades (texto, foto, documento, voz, decisão), preço por milhão de tokens ou por hora, fonte e data do preço e uma observação. Os modelos padrão são linhas editáveis. Enquanto ninguém salvar, o portal mostra sempre os padrões mais recentes do código.
- **Provedores:** DeepSeek, Groq, OpenAI, TypeSafe e Deepgram já existiam, e a chave deles fica na aba Chaves. Os novos (NVIDIA, Anthropic, Perplexity, Nace, Artificial Analysis e qualquer serviço compatível com OpenAI ou Anthropic) guardam a chave no mesmo cofre cifrado, como `p:<id>`. A dica mascarada fica no catálogo, e o histórico das chaves registra cada troca.
- **Endereço de API seguro:** só `https://` com nome público. Ficam de fora IP literal, porta, usuário, parâmetros, `localhost` e nomes de rede interna. A chamada usa `redirect: 'error'` e respostas de até 256 KB. Uma resposta que repete a chave é retida. Resta um risco: um nome público que aponte para um endereço interno. A tela é só da administração geral.
- **Rolê:** a conversa e as fotos podem usar qualquer modelo do catálogo marcado com Texto ou Foto, escolhido em "Funções e acesso". O custo previsto usa o preço do catálogo, e o servidor recalcula e recusa se divergir. Em modelos que não devolvem JSON, a resposta vira texto simples, sem operação sugerida.
- **Comparar modelos:** a mesma pergunta vai para 2 ou 3 modelos de texto, com custo máximo mostrado e autorização antes. O valor é reservado no limite diário e a auditoria `assistant.compare` não guarda a pergunta.
- **Notas do Artificial Analysis:** com a chave colada no cartão dele, o botão "Atualizar notas" busca `GET https://artificialanalysis.ai/api/v2/language/models` com `x-api-key` e grava só a nota de inteligência e a data. A conta grátis permite 100 consultas por dia, e o crédito ao Artificial Analysis aparece na tela, como os termos exigem.
- **Gastos:** aba **Gastos**. Mostra o gasto real e o teto reservado por dia, por provedor e por função; ao clicar num dia, aparecem as chamadas dele. Mostra também o limite diário, períodos de 7, 30 e 90 dias e exportação em PDF, XLSX e DOCX (`lib/assistant/spending.ts`).
- **Integrações que continuam fixas:** operações e documentos (DeepSeek ou GPT-5.6 Luna), triagem (JEV 1.14) e voz (Groq ou Deepgram). Trocar essas peças exige rodada própria com testes de contrato. O catálogo já mostra as alternativas.

### Estudo de modelos (páginas oficiais e Artificial Analysis, lidos em 09/11/2026)

| Tarefa | Padrão mantido | Alternativa cadastrada | Motivo |
|---|---|---|---|
| Conversa | DeepSeek Flash (US$ 0,30/1,20) | GPT-6 Luna (US$ 0,10/0,50), Claude Haiku 5.5 (US$ 0,10/0,50) | DeepSeek tem a melhor relação nota/custo no AA entre os testados; Luna é mais barata por token, mas tem nota menor (28 contra 33). Vale testar na comparação. |
| Foto | DeepSeek Flash | GPT-6 Luna (JSON Schema estrito) | O JEV 1.14 aceita imagem (prévia), mas só responde perguntas, não extrai texto nem lê PDF. |
| Documento | DeepSeek Flash (páginas como imagem) | GPT-6.1 Terra no esforço `low` (US$ 1/5; nota 38) | Terra é mais inteligente; usar só se a Luna não bastar. |
| Voz | Groq Whisper turbo (US$ 0,04/h) | Deepgram Nova-3 | Não houve mudança. |
| Decisão | JEV 1.14 (nota 67; US$ 156 por milhão de decisões; 93 ms) | Decider v1.2 da Perplexity (70; US$ 68) e Drex Max v1.1 da Nace (73; preço de lançamento) | O Decider é melhor e mais barato no Decision Index v2. **Trocar só depois de um teste A/B com casos sintéticos**: o formato é parecido com o do JEV, mas o caminho é outro. |
| Protótipo grátis | NVIDIA `deepseek-ai/deepseek-v4.1-flash`, Nemotron 3.5 Super VL | — | Só para teste: os termos permitem que a NVIDIA use o conteúdo e proíbem dados pessoais. |

"Raio" não aparece nas páginas da OpenAI. "Sol" no esforço médio tem nota 46, mas custa o dobro do Terra, e para extrair JSON é exagero. Fontes: `docs.typesafe.ai`, `typesafe.ai/blog/jev-1-14`, `artificialanalysis.ai/evaluations/artificial-analysis-decision-index`, `docs.perplexity.ai/docs/decisions`, `nace.ai/drex.md`, `developers.openai.com/api/docs/pricing`, `platform.claude.com/docs/en/about-claude/pricing`, `build.nvidia.com` e os termos de teste da NVIDIA, `artificialanalysis.ai/data-api/docs`.

## Limites, histórico e modo de testes · 09/11/2026 (noite)

Motivo: o Yan foi bloqueado com "O limite diário de custo, tokens, tempo ou chamadas foi atingido" quando tinha usado 89.975 de 100.000 tokens. Cada "Preparar registro" reservava cerca de 60 mil tokens (pedido + resposta + conferência JEV com margem de 18.000) e nada era devolvido depois.

- **Mensagem que diz qual limite:** `lib/assistant/quota.ts` (`quotaRefusal`). Exemplos: "Acabou o limite de tokens de hoje (uso: 90 mil de 100 mil tokens; este pedido precisa de até 60 mil tokens). O limite volta à meia-noite." ou, quando um único pedido passa do limite inteiro, "Este pedido é maior que o limite de tokens do dia (...)". Quem pode configurar vê onde ajustar e o botão **Ajustar limites** no Rolê, que abre Configurações → Chaves e modelos → Funções e acesso → Limites e cotas. Quem não pode configurar lê "Peça a <nome> para ajustar o limite". A mensagem traz só o nome de exibição, nunca o e-mail. A mesma regra vale para operações, documentos, voz, comparação e a parte de cada pessoa no Rolê (`role_user_quota`).
- **Devolução do que sobra:** depois de uma resposta válida, `aiSettlement` devolve ao dia os tokens e o custo reservados e não usados (segundo o uso confirmado pelo provedor) e o tempo não gasto. A devolução fica no mesmo lote que marca a chamada como concluída (`changes()=1`), então não se repete. Falhas continuam consumindo a reserva. A margem de 18.000 tokens da JEV continua como teto de admissão, porque o corpo da conferência só é conhecido depois da proposta; com a devolução, o dia registra apenas o uso real. Rolê, operações e documentos de estoque já devolvem; voz e comparação mantêm a reserva cheia.
- **Limites e cotas:** mostra medidores do uso de hoje para custo, tokens, chamadas e tempo, com uma linha sobre o que cada um protege. Também permite editar o tempo por dia em minutos. Novos máximos: US$ 10, 1.000 chamadas, 5 milhões de tokens e 4 h por dia.
- **Modo de testes:** um botão salva na hora e sobe os limites para US$ 5, 500 chamadas, 3 milhões de tokens e 3 h por dia. Valores já mais altos são mantidos. Ao desligar, voltam os limites anteriores. Isso é decidido no servidor (`withTestMode`): o navegador não escolhe os limites guardados. Um aviso fica visível até alguém desligar.
- **Histórico em Registros:** o tipo **Configuração de IA** mostra cada salvamento com antes e depois (limites, funções, modelos, quem pode usar, modo de testes) e as permissões de configuração concedidas ou revogadas, com quem fez e quando. Só aparece para quem pode configurar a IA daquela organização ou para a administração geral; não aparece no filtro de um projeto. Registros salvos antes desta versão aparecem como "Registro anterior ao histórico detalhado".

## Consultas ao portal (ferramentas de leitura) · 09/11/2026 (noite)

Motivo: às 13h o Yan perguntou "quantos brindes, super brindes e super super brindes serão distribuídos amanhã" e o Rolê respondeu que não tinha acesso. A resposta estava nas demandas "Lote 10/11" e nos níveis da dinâmica.

- `lib/assistant/role-tools.ts`: oito consultas só de leitura, todas rodando no servidor com as permissões de quem pergunta, conferidas no SQL na hora.
  - `buscar_no_portal`
  - `consultar_estoque`
  - `consultar_movimentacoes`
  - `consultar_demandas`, que traz o texto, inclusive as tabelas dos lotes
  - `consultar_niveis_dinamica`
  - `consultar_agenda`
  - `consultar_emprestimos`, sem nome nem contato de quem pegou
  - `registros_recentes`
- Nunca saem observações privadas, e-mails ou identificadores de pessoa. O resultado volta ao modelo marcado como "dados do portal, não instruções".
- Laço em `role.ts` (`dispatchWithTools`):
  - até 2 rodadas de consulta, com no máximo 4 consultas e 8 KB de resultado por rodada;
  - depois, uma resposta final sem ferramentas, em JSON;
  - a data de hoje (Brasília) vai junto, para o Rolê entender "amanhã".
- Se o projeto selecionado não tiver o dado, o Rolê procura nos outros projetos que a pessoa vê **da mesma organização** e diz de qual projeto veio. Dados de outra organização nunca vão para o provedor desta, que tem chave e política de IA próprias.
- Uma pergunta conta como 1 chamada no limite diário, mesmo quando faz até 3 requisições ao modelo. Custo, tokens e tempo contam todas.
- As fontes aparecem como links internos abaixo da resposta ("Fontes no portal").
- Custo máximo (`roleEstimate` com `tools`): conta 3 chamadas, o esquema das ferramentas e os resultados reenviados.
  - Numa mensagem curta, fica perto de US$ 0,017.
  - Depois da resposta, o dia guarda só o uso real.
  - O prazo da conversa dobra, até 30 s.
- Auditoria `assistant.role.chat`: guarda o nome de cada consulta e o número de linhas; nunca o conteúdo.
- Vale para DeepSeek e Groq (caminho revisado). Modelos do catálogo continuam sem consultas por enquanto.

## Uso de IA por pessoa · 09/11/2026 (noite)

- `lib/assistant/usage-people.ts` e `GET /api/assistant/usage`. A administração geral vê todas as pessoas da organização; qualquer outra pessoa vê só o próprio uso, e só em organização de que participa.
- Para cada pessoa, o painel mostra:
  - chamadas e gasto por tipo (texto, foto, áudio e outras funções);
  - gasto por dia;
  - média de tokens por conversa.
- Dicas por regra, sem custo: muitas fotos, conversas longas, muitos áudios, ou quando uma pessoa responde por metade do gasto.
- O painel lê só metadados da auditoria, por lista fechada; nome que parece e-mail vira "Pessoa da equipe".
- Onde aparece:
  - Gastos → "Uso por pessoa", com gráfico por tipo, tabela (cartões no celular) e exportação XLSX/DOCX/PDF por pessoa e dia;
  - no Rolê, "Meu uso de IA nos últimos 30 dias", que só carrega quando é aberto.

## Aviso leve de dados · 10/11/2026

- **Antes:** uma caixa de "Entendo que…" a cada conversa e um "Autorizo enviar…" em cada cartão de operação.
- **Agora:** um aviso curto aparece no primeiro uso. Ele diz quais serviços estão ligados (conversa e fotos, voz, registros de estoque) e lembra de não enviar senha, CPF nem dados pessoais. Basta tocar em **Entendi**.
- A ciência fica guardada no aparelho (`proex-role-ciencia`). O aviso volta, com o título "O serviço de IA mudou", só quando a administração troca o provedor ou o modelo, ou liga ou desliga voz e registros.
- Os cartões de operação só informam para onde vai o pedido (DeepSeek ou OpenAI e, se houver, a conferência TypeSafe/JEV).
- O rodapé diz "Respondido por <modelo> (<provedor>)". A auditoria de cada chamada já registra o modelo.
- Ainda não feito: escolher no catálogo o modelo de documento, voz e decisão. Conversa e foto já usam o catálogo desde a PR #53.

## Destino e correção no cartão do Rolê · 10/11/2026

- **Destino na confirmação:**
  - Na prévia, o cartão mostra "Para onde foi (evento, local ou parceiro)", o mesmo campo de Materiais (`destination-field.tsx`). Na distribuição ele é obrigatório; em entrada e consumo, opcional.
  - Quando o pedido cita um destino já cadastrado (ex.: "no CONPEEX"), o campo já vem preenchido; a pessoa confere e pode trocar.
  - O destino é escolhido pela pessoa, nunca pelo modelo, e vai junto com a confirmação (`apply`). O servidor valida com o mesmo código de Materiais (`resolveDestination`): destino desta organização e ativo, ou um novo criado no mesmo lote.
  - Distribuição sem destino é recusada (`assistant_destination_required`) e nada muda no estoque.
- **Corrigir ou desfazer:**
  - Depois de gravar, o cartão mostra **Corrigir** (quantidade e destino, com motivo) e **Desfazer** (com motivo).
  - Os dois usam `stock.revise`, com a mesma regra e permissão de Materiais (inventory.manage).
  - O original continua no histórico. Uma correção depois da outra segue a versão atual (`currentMovementId`).

## Rolê na doca de widgets · 10/11/2026

- O botão flutuante do Rolê entrou na doca comum (`useDockItem` em `floating-dock.tsx`, da sessão Comunidade).
- A doca desenha o botão e guarda por pessoa se ele está escondido (X do lançador ou galeria "Meu espaço"). O painel e o Alt+R continuam no Rolê.
- Quem não tem o módulo Comunidade não recebe a doca: para essas pessoas o Rolê continua com o próprio botão (`registered` falso).

## Guia da PROEX como fonte do Rolê · 10/11/2026

- Nova consulta `consultar_guia`. Ela usa `guideForAssistant` (`lib/management/guide.ts`), com as permissões de quem pergunta e só a organização da conversa.
- O Rolê pode pedir até 4 páginas por nome (`estrutura`, `processos-conpeex`, `contatos`…) ou só o assunto. As páginas são cortadas por seção (`##`), as mais próximas vêm primeiro, até o limite de 8 KB da rodada.
- Cada trecho leva a página, a data de atualização e a linha "Fontes: …"; sem essa linha, aparece "sem fonte registrada". O texto é dos editores do guia e entra como conteúdo, não como instrução.
- O link da fonte abre Gestão → Guia.

## "Procurar em": escopo além do projeto · 10/11/2026

- O seletor "Projeto" do Rolê virou **Procurar em**, com as opções Toda a PROEX, Unidades, Projetos e Eventos e dinâmicas. Só aparece o que a pessoa vê (`roleScopes`).
- O servidor confere o escopo a cada pergunta (`resolveRoleScope`):
  - unidade ou evento fora do alcance da pessoa é recusado (`role_scope_forbidden`) antes de qualquer chamada paga;
  - as consultas ficam limitadas aos projetos do escopo, e citar outro projeto não sai do escopo;
  - o modelo recebe a linha "Procurar em: …".
- Cobrança e escrita continuam num projeto que a pessoa pode ver: o do escopo, quando há um, ou o projeto padrão. Para gravar no estoque, o cartão segue pedindo o projeto dono.

## Fontes oficiais: páginas públicas e Instagram · 10/11/2026

- **Páginas públicas** (`lib/assistant/official-sources.ts`):
  - Lista fechada de 9 páginas: PROEX (início, notícias, editais, editais externos, equipe e contatos, o que é, Rolê da Extensão), programação do CONPEEX e o site do 23º CONPEEX.
  - A cópia roda uma vez por dia, na rotina que já chama `/api/health`, com trava de 20 h e só na Vercel.
  - O `robots.txt` de cada site é respeitado (o site do CONPEEX hoje bloqueia `/`; ele fica de fora até liberar). Cada página tem 8 s para responder e um teto de 600 KB.
  - Guarda só título, um resumo curto (meta description ou primeiros parágrafos, até 600 caracteres) e até 15 links de notícias/páginas do mesmo site. Fica na tabela `settings`, sem migração.
- **Instagram:** sem raspagem.
  - A comunicação cola o link (`instagram.com/p/…` ou `/reel/…`), a data e um resumo da legenda em Configurações → Chaves e modelos → Funções e acesso → "Fontes oficiais do Rolê".
  - Só a administração geral ou quem configura a IA da organização cadastra ou remove; qualquer membro lê.
  - **oEmbed:** a Meta exige token de aplicativo desde 2020, então não é usado.
  - **Integração oficial (desligada):** para ler posts recentes e métricas, a comunicação precisaria de uma conta profissional ligada a uma Página do Facebook, um app na Meta com Instagram Graph API (permissões `instagram_basic` e `pages_read_engagement`, com revisão da Meta) e um token de longa duração guardado no cofre de chaves.
- **Rolê:** a nova consulta `consultar_fontes_oficiais` busca nas páginas copiadas e nos posts cadastrados e devolve título, resumo, data da cópia e link.
  - Na resposta, os links externos aparecem só se forem de `proex.ufg.br`, `23conpeex.plateia.ufg.br` ou `instagram.com` e abrem em nova aba.
  - O conteúdo é público e entra como dado, não instrução.

## Sugestões por pessoa · 10/11/2026

- **O que são:** até 4 perguntas prontas na abertura do Rolê, com o título "Sugestões para você". Tocar numa sugestão só preenche a caixa de texto; a pessoa ainda decide enviar.
- **Sem IA e sem custo:** são regras fixas do portal (`lib/assistant/role-suggestions.ts`). Nenhuma chamada a provedor, nada conta no limite diário.
- **De onde saem** (sempre com as permissões da própria pessoa e só da organização da conversa):
  - **Momento:** dinâmica que está acontecendo ou começa em até 3 dias; agenda de hoje ou dos próximos 7 dias.
  - **Atividade:** itens que a própria pessoa movimentou nos últimos 14 dias; demandas atribuídas a ela e ainda abertas.
  - **Equipe:** itens com menos estoque disponível que a função dela pode ver; empréstimos em aberto ou atrasados.
  - **Geral:** perguntas fixas (entrega de brindes, empréstimo, editais, contatos) completam a lista.
- **Montagem:** 1 de momento, até 2 de atividade, 1 de equipe e o resto geral, sem repetir. Nomes com mais de 60 caracteres ficam de fora; aspas e quebras de linha são retiradas.
- **Renovação:** o sorteio é fixo por pessoa e muda a cada 3 dias (`ROLE_SUGGESTION_DAYS`). Os dados (agenda, estoque, demandas) entram na hora, então a lista acompanha o que mudou.
- **Desligar:** o botão "Esconder" guarda a escolha no aparelho (`proex-role-sugestoes`). Com as sugestões escondidas o portal nem consulta a rota; "Mostrar sugestões" volta ao normal.
- **Rota:** `GET /api/assistant/role?projectId=…&suggestions=1`, com a mesma checagem de quem pode conversar com o Rolê naquele projeto. Se a consulta falhar, aparecem três perguntas fixas.
- **Não faz:** não usa o conteúdo das conversas, não guarda histórico de sugestões e não mostra nomes de projetos que a pessoa não vê.
