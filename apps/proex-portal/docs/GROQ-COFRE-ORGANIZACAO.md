# Groq no cofre por organização

Código e ensaios locais de 05/11/2026. Nenhuma chave existente foi lida, nenhuma chave real foi cadastrada e nenhum pedido foi enviado à Groq. Publicação, disponibilidade do segredo dedicado do cofre e teste institucional autorizado precisam de evidência própria.

## Onde preencher

Na sessão da administração geral, abra [Configurações → Chaves e modelos](https://proex-gestao.vercel.app/?module=settings#ai-credentials), selecione a organização e use **Cadastrar chave Groq**. Informe um nome curto e a chave no campo de senha. O valor é enviado apenas ao cofre, cifrado com a mesma fronteira AES-GCM por organização e nunca devolvido ao navegador. Cadastrar ou disponibilizar uma chave não ativa transcrição nem consulta o provedor.

O cofre precisa do segredo independente `PROEX_KEYS_SECRET` no ambiente privado. Sua ausência bloqueia novas chaves Groq na interface e é apresentada como configuração pendente. Não se deve colar esse segredo no campo da Groq, usar uma chave do provedor como segredo de cifra ou colocá-los no GitHub/Vault. Os caminhos legados de DeepSeek, TypeSafe e Deepgram continuam como antes.

Em **Conta → Assistente com revisão → Configurar IA**, uma pessoa atualmente autorizada a configurar aquela organização pode escolher **Groq · Whisper Large V3 Turbo**, marcar **Habilitar transcrição** e salvar. Trocar a seleção desmarca a habilitação para exigir uma decisão explícita. O seletor usa somente adaptadores verificados; não aceita endpoint, nome de modelo ou chave de outro provedor.

**Testar Groq**, no diagnóstico de conexão, exige consentimento próprio e usa apenas a chave cifrada já salva da organização. Consulta `GET https://api.groq.com/openai/v1/models`, sem pedido, áudio, documento ou inferência. Confirma resposta autenticada e presença/ausência do modelo no catálogo; não comprova acurácia, créditos, permissão de transcrição ou funcionamento de um áudio real. Uma consulta de metadados não habilita função de IA.

## Compatibilidade e revogação

As configurações JSON antigas sem `sttProvider` são interpretadas como `legacy`. Essa opção mantém o piloto anterior: Groq pelo ambiente somente se `PROEX_STT_PROVIDER=groq` e `PROEX_GROQ_STT_ORGANIZATION_ID` corresponder exatamente à organização. As demais organizações permanecem em Deepgram. Não há migração automática de chave do ambiente para o banco.

Uma escolha explícita `sttProvider: groq` usa exclusivamente a chave Groq ativa do cofre daquela organização. Chave ausente, desligada ou removida bloqueia o envio, mesmo que uma chave Groq válida esteja no ambiente. Salvar, trocar, desligar ou remover uma chave suspende a transcrição que depende dela. Disponibilizar novamente a chave deixa a função desligada; a pessoa precisa salvar sua habilitação. Revisão/CAS e autorização são reavaliadas antes da gravação e antes/depois de cada transporte.

Configurações, credenciais e cotas pertencem à organização. O estoque pertence ao projeto permitido ao ator. Um gestor ou delegado de TI não ganha acesso ao texto da chave nem a projetos adicionais por poder configurar IA. Perder papel, concessão ou acesso enquanto a resposta chega impede apresentar a transcrição.

## Adaptador, custo e dados

O adaptador existente usa o endpoint fixo `https://api.groq.com/openai/v1/audio/transcriptions`, modelo `whisper-large-v3-turbo`, idioma `pt`, upload WAV canônico e resposta JSON. Não aceita URL de áudio, host/porta personalizados, modelos arbitrários ou redirecionamentos. Mantém os limites de 4 MiB e 0,5 a 90 segundos e a validação real dos bytes. A transcrição fica em um campo revisável; usá-la no pedido, preparar proposta e confirmar alteração de estoque são ações separadas.

Fontes oficiais verificadas em **05/11/2026**: [transcrição Groq](https://console.groq.com/docs/speech-to-text), [API e catálogo de modelos](https://console.groq.com/docs/api-reference#models-list), [limites por conta](https://console.groq.com/docs/rate-limits). A referência de preço do Whisper Turbo é **US$ 0,04 por hora**, com **mínimo de dez segundos faturados por envio**. A reserva inteira é `ceil(max(duração,10) × 40000 / 3600)` em micros de dólar: 1/10 segundos reservam 112; 30 segundos, 334; 60 segundos, 667. O Deepgram conserva sua reserva anterior. Os números são reserva de controle; não são conciliação de fatura ou promessa de gratuidade da conta.

Reserva/quota e recibo antecedem o transporte. O mesmo envio não transcreve nem reserva novamente. Timeout, falha ou cancelamento não causam tentativa automática paga. O áudio bruto não é persistido pelo Portal. A recuperação do texto continua cifrada e temporária no fluxo anterior. A proveniência registra provedor/modelo, origem da credencial (`vault` ou `environment`), organização, projeto e hash/duração; não contém chave ou áudio. O modelo solicitado é conhecido; a resposta de transcrição da Groq não prova uma revisão imutável do modelo.

## Migração e validação

`0025_groq_organization_credentials.sql` amplia somente o `CHECK` de provedores de `ai_provider_credential_metadata`. Reconstrói essa tabela copiando os nove campos e preservando chave composta e vínculo à organização. Não muda `ai_organization_settings`, envelopes cifrados, revisões, textos, saldos ou outras tabelas. O ensaio começou com DeepSeek, TypeSafe e Deepgram preenchidos e confirmou igualdade de todas as linhas, máscaras, cifras/configurações, lista de tabelas e integridade de chaves estrangeiras após a migração.

Não volte para uma aplicação que rejeite o campo novo de configuração após salvar a seleção Groq. Rollback deve usar versão compatível, preservar os segredos do envelope e desabilitar funções afetadas com decisão explícita; não remova histórico ou copie cifras para um ambiente público.

Os testes cobrem cifra e preservação dos três provedores existentes, nenhuma ativação ao cadastrar, chave certa por organização, isolamento A/B, fallback legado restrito, recusa de fallback após desligar/remover, CAS e revogação durante gravação/transporte, arredondamento e mínimo de custo, recuperação sem novo transporte, entrada inválida, resposta com chave refletida, catálogo falso/redirect, consentimento e interface com resposta tardia/perda de acesso. O diagnóstico usa transporte HTTP falso. Acurácia, disponibilidade e cobrança real não foram medidas.

Veja o [mapa de adaptadores por capacidade](MAPA-ADAPTADORES-IA.md) para a ampliação gradual a outros provedores. Uma chave de API não torna um provedor compatível com qualquer função do Portal.
