# Projetos: favoritos, origem da demanda e panorama visual

Base: `d9ca7e0`. Recorte do agente `projetos_visuais`, em worktree isolado; sem push, merge ou deploy pelo agente.

## Brief e pronto quando

Para a equipe que abre projetos repetidamente pelo celular: fixar projetos como atalhos compactos, abrir a ficha de origem de uma demanda e entender rapidamente a operação do projeto. A fonte continua sendo a lista de projetos autorizada e a resposta autenticada de `/api/projects/{id}`. Dados de outro projeto/conta não podem aparecer nos atalhos ou gráficos.

- Favoritos pessoais persistem após recarregar e somem imediatamente quando a conta/permissão muda.
- A demanda oferece um link real para a ficha de origem somente quando seu projeto está no catálogo acessível.
- Cartões evitam nome curto repetido, placeholders sem conteúdo e descrições extensas.
- Gráfico permite tocar/clicar em situações de atividades, materiais e empréstimos e abrir registros relacionados.
- A soma conta registros da mesma categoria, sem somar unidades de estoque diferentes ou inventar avanço de projeto.

## Implementação e decisões

Favoritos guardam somente até 12 IDs na chave `proex:project-pins:v1:{userId}` do navegador; não criam permissão nem substituem o banco. O filtro da lista não esconde os atalhos já fixados; a lista autorizada atual sempre controla o que aparece. A interface explica que a preferência pertence a este navegador.

O panorama usa atividades cadastradas e relações já retornadas pela API. Uma relação ausente/nula não produz um gráfico de zeros. Empréstimos explicitam o limite de até 100 registros recentes. Equipamento emprestado pode ter estoque físico, mas disponibilidade zero: o gráfico separa **Sem disponibilidade** de **Saldo no mínimo**, evitando sugerir reposição pela ausência temporária. Os rótulos, números, símbolos e foco complementam as cores.

## Evidências

- Tipos e ESLint dos arquivos alterados: aprovados.
- Testes de Projetos/contextos/organizações: 20 aprovados; gráfico: 3 aprovados; suite Demandas: 24 aprovados (incluindo quatro subcasos).
- Build Node: aprovado; revisão final do build repetida após o ajuste semântico dos rótulos.
- QA em `http://127.0.0.1:5184`: banco descartável, usuário e dados inteiramente sintéticos; nenhuma chave ou sessão de produção usada.
- Navegador Chrome: 375, 390 e 1366 px × claro/escuro; nenhum overflow horizontal nem erro de página.
- Fluxos: fixar → recarregar → restaurar atalho; selecionar barras → conferir registros; demanda → link de origem → ficha do projeto.
- Testes de isolamento: usuário A/B antes dos efeitos, mudança de ACL, ID oculto em armazenamento, preferências malformadas, limitação de quantidade e ausência de relação não autorizada.
- Capturas locais em `apps/proex-portal/.sites-runtime/project-visual-qa/`; `chart-focus-*` mostra o gráfico sem o restante da página. `result.json` registra o QA sintético.
- Revisão independente pelo coordenador: 9/10 para este recorte após o ajuste semântico. Não constitui nota para todo o portal.

## Limites

Não foi verificado em produção por este agente. Favoritos são locais ao navegador, não sincronizam entre aparelhos. O gráfico não calcula porcentagem de conclusão do projeto. As capturas foram feitas com dados sintéticos; estoque, público e pessoas reais não foram alterados.

## Aprendizados

- Separar seleção de contexto de navegação para uma ficha: o link deve preencher `detailProject` e `project` com a mesma identidade permitida.
- Preferências locais precisam mascarar imediatamente a conta anterior e sempre cruzar os IDs com a lista autorizada atual.
- Um zero de disponibilidade pode representar empréstimo/reserva, não falta física. Visualizações precisam declarar o denominador e a janela de dados.
- Cartão de catálogo e atalho frequente resolvem tarefas diferentes; manter o atalho compacto evita transformar o catálogo em um painel longo de favoritos.
