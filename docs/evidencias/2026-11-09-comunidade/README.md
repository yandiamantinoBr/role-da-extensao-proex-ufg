# Evidências sintéticas · Comunidade fase 1 · 09/11/2026

Capturas de uma base descartável em `127.0.0.1` (script `qa-local.mjs`), sem produção e sem contas reais. Todos os nomes com "QA", relatos, retornos e anotações são inventados. O código de ouvidoria das capturas é de teste.

Larguras de 1366 e 390 px, temas `light` e `dark`:

- `*-inicio-widgets.png`: Início com o bloco "Seus widgets" (Rolê, Lembretes, Anotações). O resto da página é de outras frentes.
- `*-retorno.png`: "Fale com a gestão" (sugestão, problema, elogio) e "Seus envios" com a resposta da gestão.
- `*-ouvidoria.png`: novo relato anônimo, com a garantia de anonimato visível e o código de acompanhamento.
- `*-ouvidoria-acompanhar.png`: consulta por código, com código mascarado e "Fechar conversa".
- `*-caixa-gestao.png`: caixa da gestão com filtros, nome de quem enviou e resposta.
- `*-caixa-salvar-estado.png`: estado alterado, aguardando "Salvar estado" (só a área visível).
- `*-relato-detalhe.png`: visão da ouvidoria de um relato, sem autor.

Nas capturas de página inteira do celular, a barra inferior fixa aparece no meio da imagem; é efeito da captura.

Crítica visual independente: 6,9 → 8,0 → nota final registrada na PR. Não cobre leitor de tela, zoom de 200% nem aparelho físico.

## Fase 2 (recados e selos)

- `fase2-*-recados.png`: recados recebidos de uma segunda pessoa sintética (convidada só na base descartável), com responder, marcar como lido, ocultar e bloquear.
- `fase2-*-selos.png`: nível, quatro selos com arte provisória, regras e pausa.

Crítica visual independente da fase 2: 8,7 → 9,2, sem P0/P1/P2. Depois das capturas, "Bloquear" voltou a ter nome visível.

## Fase 3 (conversas, espaço, aviso de recado, designações da ouvidoria)

- `fase3-*-conversa-projeto.png`: conversa de um projeto com emoji e uma foto sintética (gradiente desenhado no próprio navegador, sem foto real).
- `fase3-390-*-conversas-lista.png`: lista de conversas no celular.
- `fase3-1366-*-espaco.png`: espaço do banco e premissas em uso (no QA local o tamanho total não é medido; a tela diz isso).
- `fase3-*-recados-email.png`: interruptor do aviso de recado por e-mail.
- `fase3-*-ouvidoria-leitores.png`: quem pode ler a ouvidoria, mostrado antes de escrever.
- `fase3-1366-*-designacoes.png`: designação de leitores da ouvidoria com prazo e motivo, e histórico.

Crítica visual independente da fase 3: 8,6 → 9,0, sem P0/P1. Revisão de segurança independente: sem P0/P1; os P2 foram corrigidos.

## Doca flutuante de widgets (migração 0043)

- `doca-*-fechada.png`: botão "Widgets" no canto, em qualquer página, acima do botão do Rolê.
- `doca-*-aberta.png`: pilha com o nome de cada widget ligado e "Meu espaço".
- `doca-*-calendario.png`: hoje e os próximos 7 dias (agenda sintética e prazos das demandas).
- `doca-*-demandas.png`: abertas, que vencem hoje e atrasadas, com links para Meu trabalho.
- `doca-*-meu-espaco.png`: galeria para ligar e desligar widgets (tudo desligado por padrão).

No celular o painel vira folha inferior com fundo escurecido. Crítica visual independente: 7,6 → 8,8 → 9,1, sem P0/P1/P2. Os dois P3 restantes (chip minimizado perto do rodapé; fundo da folha no tema claro) ficaram anotados; o primeiro foi tratado com mais folga no fim da página.
