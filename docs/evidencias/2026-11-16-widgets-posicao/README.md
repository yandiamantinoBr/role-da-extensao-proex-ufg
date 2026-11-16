# Posição dos widgets escolhida por pessoa · 2026-11-16

Capturas do QA local (`scripts/qa-local.mjs` em porta própria), com dados sintéticos.

- `modo-computador-lateral-*-fechada.png`: computador, "Fixo na lateral", sem widget aberto. O trilho à direita reserva 84 px e a página encolhe.
- `modo-computador-lateral-{1366,1250}-*-agenda-calendario.png`: Agenda com o Calendário aberto na coluna. De 1100 a 1399 px a coluna tem 300 px e o cabeçalho mostra só a foto da conta.
- `modo-computador-lateral-721-*-agenda-calendario.png`: computador estreito. O trilho continua reservado e o widget aberto passa por cima, com fundo escurecido (fecha com X, Esc ou clique fora).
- `modo-computador-lateral-1366-*-meu-espaco.png`: a escolha em Widgets → Meu espaço.
- `modo-computador-flutuante-1366-light-demandas.png`: o modo flutuante de antes, para comparar.
- `modo-celular-flutuante-*-demandas.png` e `...-fim.png`: celular, "Flutuante no canto", no topo e no fim da página.
- `modo-celular-flutuante-light-folha.png` e `...-anotacoes.png`: a folha aberta pelo botão; o botão some enquanto ela está aberta.

Medições (QA local): em 320, 375, 390 e 720 px, o botão do celular não ficou sobre nenhum controle visível, nem em repouso, nem no fim, em Demandas, Materiais, Pessoas e acessos, Empréstimos, Agenda e Relatórios. Com campo focado, ele some. Na lateral, a área de trabalho termina onde o trilho começa, em 721, 1250 e 1366 px, sem rolagem lateral.

Crítica visual independente: 7,5 → 9, sem P0/P1/P2. Revisão de código independente: sem P0/P1; os P2 foram corrigidos (gravação otimista sem efeito dentro do atualizador de estado, observador de mudanças com atributos e espera máxima).
