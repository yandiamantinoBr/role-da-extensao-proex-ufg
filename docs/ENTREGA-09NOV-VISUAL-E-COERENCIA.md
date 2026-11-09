# Entrega 09/11/2026 · Acabamento visual e coerência

Frente conduzida pelo Claude Code (sessão "visual-coerencia"), branch `claude/visual-coerencia-09nov`. Objetivo: levar o Portal PROEX ao padrão visual do site Vozes da Gestão Pública, sem alterar regras, permissões ou dados.

## O que mudou para quem usa

| Pendência (vault, Rodada 09nov) | Resultado |
|---|---|
| "Refinar contexto" feio e com espaço vazio no celular | Seletor de projeto e botão de filtro na mesma linha. O painel abre logo abaixo, sem sobra. Um ponto laranja indica filtro ativo; os valores continuam no nome acessível. O `<details>` nativo foi mantido, como os testes exigem. |
| Início pouco visual | O cabeçalho do Início virou uma faixa de boas-vindas com data e cores do Rolê (sem bloco extra: o "hero" duplicado já tinha sido removido na V14). "Meu trabalho" ganhou barra de andamento (concluídas, em andamento, a iniciar). Os cartões de resumo têm barra em duas cores. |
| Gráficos interativos fora de Relatórios | O "Panorama" interativo da ficha do projeto agora também aparece no Início (materiais e empréstimos dos projetos selecionados). Tocar numa barra lista os registros com link para cada um, no projeto certo. Só entra o conjunto que a conta recebeu: nunca um zero no lugar de "sem acesso". |
| Excesso de espaçamento | Cabeçalho de módulo, filtros e "Acompanhamento" ficaram mais compactos no celular. Em Materiais (390 px), o título "Materiais e estoque" subiu de cerca de 850 px para cerca de 670 px. |
| Navegação inferior redundante | A barra do celular deixou de repetir "Conta" (fica no avatar do topo e em "Mais") e ganhou um terceiro atalho de trabalho, conforme a função. |
| Demanda abrindo no projeto de origem | Conferido ponta a ponta em 390 e 1366 px: o link "Abrir projeto de origem" abre a ficha do projeto certo, sem erro de página. Na ficha, "Importar projeto" saiu de cima e fica depois da lista. |
| Toasts, versão e ícones | Avisos com cor por tipo (sucesso, erro, alerta). Versão em pílula legível no rodapé (`Versão 2026.11.09 · <sha>`). Ícones sem repetição: "Pessoas e acessos" usa engrenagem de pessoa e "Relatórios" usa gráfico. |
| Mesma hierarquia em todos os módulos | Títulos em Sora, texto em DM Sans, cartões com a mesma sombra e raio, blocos recolhíveis com o mesmo marcador ▸/▾, escala de texto pequena um degrau acima (nada abaixo de 10 px). |

## Decisões e premissas fáceis de trocar

- **Tipografia:** DM Sans e Sora (licença OFL), as mesmas fontes das peças do Rolê da Extensão encontradas no computador do Yan. Servidas pelo próprio portal. Para trocar, altere `--font-sans` e `--font-display` no fim de `app/globals.css`.
- **Barra inferior:** Início + três atalhos (fixados primeiro, depois os recomendados para a função) + Mais.
- **Panorama no Início:** materiais e empréstimos; atividades continuam só na ficha do projeto.

## Verificação

- Capturas antes/depois em 390 e 1366 px, temas claro e escuro, dos 14 módulos, com dados sintéticos (`scripts/qa-local.mjs` + sementes privadas ignoradas). Nenhum erro de página nem rolagem horizontal.
- Fluxo demanda → projeto de origem conferido em navegador automatizado nas duas larguras.
- Gates: ver a seção "Resultados" abaixo.

## Fora do escopo

- Lógica dos níveis de brinde na dinâmica e troca de foto dos materiais (sessão paralela `proex-niveis-foto`).
- Regras, permissões e dados: nenhuma alteração.

## Resultados

(preenchido ao final da rodada)
