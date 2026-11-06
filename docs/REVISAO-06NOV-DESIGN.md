# Revisão independente de design · 06/11/2026

Revisão somente leitura de implementação e capturas sintéticas. O revisor pode atualizar somente este parecer. Base da composição: `e87159d26797737ada2275864135d4541d780165`, branch `codex/edicao-e-rastreio-06nov`; a árvore de trabalho contém o incremento ainda não publicado. As migrações 0032/0033/0034, segurança e testes de serviço têm parecer próprio em [REVISAO-06NOV-SEGURANCA.md](REVISAO-06NOV-SEGURANCA.md). Teste de serviço não é prova de qualidade visual ou de publicação.

## Histórico negativo preservado

A coordenação informou nota preliminar **8,7/10**, recebida em mensagem do agente de estoque, por três pontos: desalinhamento dos filtros, cartões de saldo altos e aba Acompanhamento cortada. A nota permanece como avaliação anterior; não há arquivo de parecer antigo e não foi inventada uma evidência. Nas recapturas claras, os filtros se alinham, os saldos deixam espaço para a operação e a aba Acompanhamento aparece inteira.

Separadamente, a ficha antiga apresentava grande sobra vazia ao lado dos materiais e as capturas antigas do diretório tinham deslocamentos/cortes. As novas imagens claras mostram a ficha com quatro materiais iniciais, expansão e coluna complementar empilhada; o diretório tem captura de viewport estável e legível. Esses dois problemas deixaram de aparecer na amostra nova.

## Escopo observado até este checkpoint

- Índice público de eventos em 390 e 1366 px, claro/escuro, com três eventos sintéticos; estado público indisponível em 390 px.
- Campainha na aba Estoque em 390 e 1366 px, claro/escuro; estado lido, disponível 4 e mínimo 5, com reexibição de aviso.
- Consumo em 390 e 1366 px, claro/escuro, com filtros, uma barra e detalhes recolhidos. Modal de relação com unidade em 390 px, claro.
- Formulário de movimento em 390 e 1366 px, claro/escuro; cadastro rápido e contexto do recebimento em 390 px, claro. As imagens móveis antigas do drawer ainda mostram o problema de abas informado como corrigido na fonte; exigem recaptura.
- Data/hora brasileira no editor de evento em 1366 px, claro/escuro. As capturas móveis do editor terminam antes dos campos Início/Fim, portanto não comprovam sua composição móvel.
- Prévia renderizada do PDF de histórico: uma página com duas operações, marca, período, colunas e rodapé legíveis. Não foi ensaiado histórico extenso ou quebra entre páginas.

As capturas e recibos consultados estão em `apps/proex-portal/.sites-runtime/events-qa`, `apps/proex-portal/.sites-runtime/edicao-qa` e `.sites-runtime/material-attention-qa`. São evidências locais descartáveis; ainda não representam produção.

Foram acrescentadas e inspecionadas as 11 vistas **claras**, em 390 e 1366 px, de `apps/proex-portal/.sites-runtime/final-review`: ficha, diretório, editor, consumo aberto, previsão ativa, histórico/metodologia, movimento, relação com unidade, data/hora, eventos sem resultado e tentativa de detalhe. As imagens rotuladas `dark` dessa primeira bateria ainda estavam claras e foram devolvidas à coordenação para recaptura; o arquivo de detalhe ainda mostrava o índice, após erro de navegação já identificado pela coordenação. Não foram contadas como evidências do estado desejado.

## Achados comunicados à coordenação

| Prioridade | Evidência e efeito | Correção exata / estado |
|---|---|---|
| P2 corrigido | A ajuda expandida de cobertura em `stock-consumption-panel.tsx` dizia que o envio automático aos responsáveis estava em preparação, embora a 0034 entregue avisos persistentes na campainha. | Fonte relida e ajuda vista na previsão expandida clara: explica a campainha, os responsáveis e o cruzamento em lançamento manual ou alteração do limite. |
| P2 encerrado na recaptura final | Contraprova independente: erro de rede/servidor na consulta `readDirectoryDetail` mantinha o histórico em “Conferindo histórico…” indefinidamente. | Fonte relida: `detailError`, limpeza ao sair e `loadHistory` compartilhado. As oito imagens `erro-directory-*` agora mostram falha com “Tentar histórico novamente” e histórico retornado após retry, em 390/1366 e ambos os temas. O recibo registra quatro falhas forçadas, oito leituras, zero escritas de negócio e rascunho preservado. |
| P3 encerrado na recaptura final | O modal desktop antes cortava o final de `dd/mm/aaaa`, enquanto o móvel já empilhava as datas. | Fonte relida com container queries em 680/330 px. As quatro imagens finais `*-unit-final.png` mostram datas completas; no desktop, unidade e Consultar ocupam a largura do container e as datas ficam em duas colunas. |
| P3 corrigido na fonte | Contraprova: as barras de consumo filtram o histórico, mas o tooltip só descrevia a quantidade. | Fonte relida: ajuda visível “Toque em uma barra para filtrar o histórico; toque de novo para limpar” e tooltip anunciam a ação. |
| P3 corrigido na fonte | Contraprova: “Ler esta página” na campainha executava marcação coletiva como lido. | Fonte relida: “Marcar esta página como lida” antecipa o efeito. |
| P3 | As bordas herdadas dos campos são suaves: `#dcd5e5` no branco ≈1,43:1; `#60496f` em `#21182a` ≈2,18:1. A meta da skill é 3:1 para bordas/ícones. | Fortalecer o token específico dos controles sem escurecer divisórias decorativas. Refinamento transversal; não é uma auditoria WCAG completa. |

Não foi identificado P0 ou P1 visual nas imagens efetivamente inspecionadas. Os textos secundários conferidos pelos tokens têm contraste suficiente: `--muted` no branco ≈5,01:1; `--text-secondary` no branco ≈6,25:1; os equivalentes escuros sobre `--surface` ≈7,46:1 e ≈8,18:1. Esses números não substituem verificação de todos os estados.

## Crítica do contra

Os eventos públicos têm a composição mais resolvida desta amostra: a marca é íntegra, a busca antecede os resultados, a situação tem nome além de cor e os filtros cabem no celular. O consumo preserva quantidade e unidade junto de cada barra, evitando comparação muda por cor; porém a apresentação final de cobertura, previsão e histórico ainda precisa ser vista aberta. Na campainha, a hierarquia permite distinguir material, projeto, disponível e mínimo. A atualização geral e a atualização local de estoque aparecem ao mesmo tempo; consolidá-las ou dar tooltip de escopo seria um refinamento pequeno. A ausência de corte horizontal nas capturas novas é relevante, mas não compensa estados ainda não vistos.

## Aceite pendente — checkpoint anterior, superado abaixo

**Ainda não há nota final nesta revisão.** A nota mínima pedida pelo usuário é 9/10; ela será atribuída somente ao escopo comprovado e depois de inspecionar a ficha/diretório recapturados, drawer móvel final e os estados abertos de consumo. O detalhe público ativo, estado sem resultados e data/hora móvel também precisam de evidência caso integrem o aceite global. Capturas de carregamento, erro e vazios ainda não cobrem todas as telas; teclado, salvamento e retorno são relatados pelos recibos do coordenador e pelos testes independentes, não executados por este revisor.

## Aceite final independente · 06/11/2026

**Nota: 9,1/10 para o escopo visual comprovado. Aprovado neste escopo, sem P0 ou P1 visual aberto.** O histórico negativo acima permanece válido como registro das rodadas anteriores, mas as lacunas de captura que impediam a nota foram supridas. Este aceite não declara publicação nem substitui os gates funcionais e de segurança.

Foram conferidos os dois recibos e as 52 imagens existentes em `apps/proex-portal/.sites-runtime/final-review`: as 44 relacionadas em `verification.json` e as oito de erro/recuperação do diretório. A revisão principal viu 44 imagens; uma contraprova separada viu as 12 de detalhe público, data/hora e relação com unidade, com quatro vistas em comum. Não foi operado navegador, backend ou banco nesta rodada. As montagens locais em `independent-sheets` apenas facilitaram a comparação dos originais.

- As 44 capturas finais cobrem ficha do projeto, diretório e editor, consumo aberto, previsão ativa, histórico/metodologia, movimento, relação com unidade, detalhe público ativo, eventos sem resultado e campos de data/hora; todos em 390 e 1366 px e nos dois temas. `verification.json` registra `errors: []` e dados sintéticos.
- Os temas agora são visualmente distintos nas imagens: superfícies, controles e seleção mudam de fato. O detalhe público mostra o evento com roleta, identidade e orientação de participação, em vez do índice que apareceu na tentativa anterior.
- A ficha reduz a lista inicial a quatro materiais e oferece expansão. Saldo, ações e coluna complementar têm hierarquia clara; no celular, empilham sem estreitar os controles. O diretório preserva a explicação de acesso administrativo e de que pré-cadastro não cria conta, convite ou aviso.
- Consumo, cobertura e histórico estão abertos. Quantidade e unidade acompanham as barras e os lançamentos; a previsão mostra 75 pastas, média de 2,81 por dia em 16 dias completos e estimativa de 26,67 dias. O limite da estimativa e o comportamento da campainha são explicados na própria seção. A ajuda de toque deixa explícito como filtrar e limpar.
- No movimento móvel, Acompanhamento aparece inteiro em uma segunda linha. O formulário desktop mantém contexto, motivo e confirmação visíveis. No modal de unidade, os placeholders das duas datas estão completos nos dois temas; o corte anteriormente apontado foi corrigido.
- Data/hora móvel mostra `09/11/2026 13:30` e `12/11/2026 19:30` completos. O estado público sem resultados oferece orientação e limpeza dos filtros. Os oito originais de erro/retry mostram a recuperação do histórico do diretório nos quatro cenários.

O recibo `erro-directory-receipt.json` registra `forcedFailures: 4`, `detailReads: 8`, `businessWrites: 0`, `errors: []`, sucesso do retry e preservação do rascunho nos quatro cenários. Há um POST de sessão (`sessionPosts: 1`), portanto a evidência deve ser descrita como zero escritas de negócio, e não como ausência absoluta de POST. As imagens comprovam apresentação da falha e retorno do histórico; preservação do rascunho e ausência de escrita são verificações do recibo, não algo inferido dos pixels.

A nota se sustenta pela consistência entre as telas, adaptação móvel legível, hierarquia das ações e estados úteis de recuperação. Os refinamentos remanescentes são P3: as bordas suaves dos campos já registradas, os textos auxiliares pequenos em seções densas e o nome longo abreviado pelo select nativo móvel. Não há perda de composição ou ação principal visível decorrente desses pontos na amostra.

Limites: este foi um aceite de capturas e fontes existentes, não uma nova execução de login, salvar, voltar, teclado ou leitor de tela. Na captura rolada de data/hora móvel, o rótulo Início encosta sob o cabeçalho fixo e o botão Salvar aparece parcialmente junto à barra inferior; os campos estão íntegros, mas a imagem isolada não prova a folga máxima de rolagem. Não se conclui obstrução permanente sem fluxo ao vivo. Não foram reensaiados dispositivos físicos, zoom de 200%, todos os estados de carregamento/erro/vazio de cada módulo, histórico longo com múltiplas páginas ou publicação. A nota é do incremento e das dimensões/estados listados, não uma certificação geral de acessibilidade.
