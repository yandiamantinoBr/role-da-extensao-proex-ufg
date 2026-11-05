# OpenAI para texto e documentos por organização

Implementação local de 05/11/2026. Nenhuma chave real foi lida/criada, nenhuma função foi ativada e nenhuma inferência real foi executada nesta rodada. Publicação e preparação do segredo dedicado do cofre são etapas próprias do coordenador. Este documento descreve o contrato do adaptador e os limites do aceite.

## Uso na central

Em [Configurações → Chaves e modelos](https://proex-gestao.vercel.app/?module=settings#ai-credentials), a administração geral escolhe a organização e cadastra/troca/desliga/remove a chave OpenAI no cofre. O campo é de escrita: a API só devolve máscara e metadados sanitizados. Sem `PROEX_KEYS_SECRET` no servidor, o cadastro permanece indisponível e a central explica a pendência; não há alternativa que use um segredo menos restrito.

Em **Funções e acesso**, um responsável ou delegado nominal escolhe **OpenAI · GPT-5.6 Luna** como provedor de texto/documentos. A troca desmarca as duas funções e exige confirmação ao salvar. Salvar uma chave, trocar provedor ou testar autenticação não habilita inferência. “Só eu” e “Organização” preservam o mesmo significado aplicado a todas as capacidades. Escolher OpenAI não altera o provedor de áudio nem o JEV.

Somente `gpt-5.6-luna` é aceito neste adaptador. O campo mostra o modelo permitido; não há caixa para inventar um endpoint/modelo. Configurações antigas sem `textProvider` continuam DeepSeek. DeepSeek, TypeSafe/JEV, Deepgram e Groq mantêm suas credenciais e contratos. Uma chave ausente/desligada/removida da OpenAI não provoca fallback para DeepSeek, e vice-versa.

## Contrato e fontes oficiais

- [Modelo GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna): modelo não depreciado, Responses e saída estruturada; a referência de preço é US$ 0,20/M tokens de entrada e US$ 1,20/M de saída. O alias pode mudar no provedor; ele não é uma revisão imutável. O Portal registra o modelo retornado e a data de verificação do contrato, e recusa outro identificador. Revisar a allowlist e os preços antes de ampliar o piloto.
- [Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create): endpoint HTTPS fixo `https://api.openai.com/v1/responses`, sem redirects, sem ferramentas, sem background/stream; `store:false`, `reasoning.effort:none`, `service_tier:default` e teto de saída configurado. `store:false` desativa o armazenamento de aplicação da resposta, mas não é promessa de retenção zero ou de ausência de registros de prevenção de abuso no provedor; aplicam-se os [controles de dados do provedor](https://developers.openai.com/api/docs/guides/your-data).
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs): JSON Schema estrito, todos os campos declarados e `additionalProperties:false`. Os contratos de operação e de extração documental são separados. A validação de domínio continua no Portal: IDs locais, quantidade literal, evidência no pedido/documento e revisão humana. Recusas, truncamento, erro, conteúdo inesperado, resposta excessiva, chave refletida e uso/modelo não verificáveis são rejeitados.
- [Retrieve model](https://developers.openai.com/api/reference/resources/models/methods/retrieve): diagnóstico explícito usa apenas `GET https://api.openai.com/v1/models/gpt-5.6-luna`. Não envia materiais, pedido, documento ou áudio. Um diagnóstico autenticado não prova que a credencial possui permissão para `/responses`, saldo suficiente, qualidade ou acurácia.

O parser limita a resposta a 128 KiB e aceita somente uma mensagem final, com um único texto JSON, modelo exato, estado concluído e erro/detalhes incompletos nulos. Esse recorte é deliberado: uma expansão futura do protocolo exige novos testes. Ainda falta provar externamente que o modelo devolve exatamente esse recorte na conta institucional; o transporte simulado não demonstra isso.

## Reserva, escopo e revisão

A reserva usa o tamanho em bytes do **corpo Responses efetivo**, incluindo seu esquema, como limite preventivo de tokens de entrada. O preço preventivo de entrada é US$ 0,25/M para cobrir a referência de gravação de cache de 1,25×; saída usa US$ 1,20/M, com arredondamento para cima em microdólares. O contexto do Portal fica muito abaixo de 272 mil tokens; entradas maiores são rejeitadas, sem truncar silenciosamente. Descontos de cache e cotas promocionais não são presumidos. JEV, se habilitado, acrescenta a mesma reserva já existente de decisão.

Admissão/cota/nonce são atômicos e compartilhados pela organização. Operação repetida recupera a mesma prévia sem novo transporte. Falhas mantêm a reserva preventiva e não causam retry pago implícito. Sessão, projeto/organização, política pessoal, revisão da configuração e concessões vigentes são verificados depois da descriptografia, antes da reserva/transporte e na gravação/devolução. Trocar/remover uma chave invalida a revisão e as propostas anteriores. Confirmação usa os serviços normais de estoque/cadastro, CAS e idempotência; o modelo não escreve SQL nem ganha ferramentas de administração.

## Migração e verificação

`0027_openai_organization_credentials.sql` amplia somente o CHECK de provedores da tabela de metadados. O rebuild preserva as nove colunas, PK composta, FK e linhas anteriores; não toca a cifra/configuração nem os livros de estoque. O coordenador deve gerar snapshot/journal em sequência após integrar 0024–0026. Não aplicar fora da cadeia de migrações do projeto.

Os testes usam SQLite real descartável e respostas de transporte sintéticas: cinco provedores, CRUD/máscaras/cifra, prévia e confirmação/replay, documentos, orçamento, duas organizações, política pessoal, revogação, mudanças em andamento, respostas hostis e migração populada/rollback. Documentos funcionam com operações desligadas; as duas opções da central são independentes. Desligar documentos depois de uma prévia bloqueia sua aplicação. O aceite real futuro precisa ser explícito: chave com permissão mínima, uma consulta de metadados autorizada, funções habilitadas pelo responsável e pequeno conjunto factual português de operações/documentos, medindo precisão, abstenção, latência e custo. Não confundir aprovação desse contrato com aferição de qualidade do modelo.

Anthropic, Gemini, NVIDIA, visão, vídeo e endpoints personalizados continuam fora desta entrega. Consulte o [mapa de adaptadores](MAPA-ADAPTADORES-IA.md) para o padrão progressivo de integração.

## Evidências locais e revisão independente

- `tests/openai-assistant.test.mjs`: **21/21** casos, incluindo o fluxo documental com operações OFF para os dois provedores, aplicação/replay e bloqueio após desligar documentos. A revisão independente de fontes não encontrou bloqueios P1/P2 no recorte OpenAI; ressalvou o aceite externo e a integração de snapshot/journal/guard de migração pelo coordenador.
- Regressões de assistente, cotas, política, diagnóstico e interface: **105 casos aprovados** no lote focal. Um segundo lote de OpenAI/documentos/independentes passou **47 casos**; há sobreposição com os 21 acima. Tipos, lint e build Node foram executados no lote. Os testes antigos de cardinalidade/mock foram atualizados para cinco provedores, sem retirar seus casos de preservação de Groq.
- Bancada autenticada descartável em `127.0.0.1:5186`: cadastro/troca de chave OpenAI sintética limpa o campo; escolha de provedor e configuração privada são salvas/relidas; operações e documentos ficam OFF; diagnóstico sem consentimento fica bloqueado. Contadores de inferência e diagnóstico permaneceram zero; nenhuma requisição externa do navegador ou erro JavaScript foi observado.
- Oito combinações de Chaves/Funções, 390/1366 px e temas claro/escuro apresentaram `scrollWidth=innerWidth`, `scrollX=0` e nenhum botão visível menor que 44 px. Há oito capturas adicionais da seção de modelos e do card OpenAI completos. Evidências descartáveis ficam em `.sites-runtime/qa-openai-ui/`, excluídas do Git.
- A crítica independente marcou **9,0/10 somente para o recorte OpenAI observado**, sem P1/P2 visual. A nota inclui legibilidade de modelo, duas funções OFF, propósito, máscara, datas, estado, ações e reservas. Não avalia o portal inteiro, diagnóstico, diálogo de entrada ou produção. Os P3 opcionais são recolher preço/alias em um detalhe e compactar os metadados de datas/responsável. As capturas mostram a ordem anterior do cofre; a reordenação final aproxima os dois provedores de texto e não muda o conteúdo/estilo dos cards.

Aprendizado: em controles nativos envolvidos por um `label`, o nome acessível pode conter o valor selecionado. A automação deve consultar o papel `combobox` e o rótulo relevante, sem exigir texto literal exato que exclua esse valor. Uma falha desse seletor foi distinguida de falha da interface pelas capturas e pela leitura da árvore; a seleção real funcionou na verificação corrigida.


## Revisão independente do identificador retornado - 2026-11-05

A seção Snapshots do catálogo oficial consultada novamente lista apenas gpt-5.6-luna. As fontes consultadas não provaram se Responses retornará esse alias ou outro identificador nessa conta; não existe base para inventar uma data ou aceitar qualquer prefixo. A igualdade exata permanece e rejeitará outro identificador, sem retry ou fallback. Isso é uma lacuna externa de disponibilidade, bloqueante para declarar inferência real funcionando, não uma equivalência presumida. No piloto autorizado, registrar somente requestedModel/returnedModel sanitizados; qualquer ampliação precisa de identificador exato, fonte/contrato, preço e avaliação. O guia oficial recomenda versões fixas quando disponíveis: https://developers.openai.com/api/docs/guides/prompt-engineering. Nenhuma chamada real foi feita.
