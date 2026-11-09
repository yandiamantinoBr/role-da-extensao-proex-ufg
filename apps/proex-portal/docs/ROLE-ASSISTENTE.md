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
