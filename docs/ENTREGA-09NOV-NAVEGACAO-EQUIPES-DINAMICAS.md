# Entrega 09/11/2026 · fixados, menu lateral, equipes e Dinâmicas

Branch `claude/navegacao-equipes-dinamicas`. Retorno do Yan, por volta das 12h de 09/11/2026, depois da PR50.

## Três formatos em todo lugar

Todos os pontos com download usam o componente comum Planilha, Documento e PDF:
- Relatórios: resumo diário e os três cartões de registros completos;
- central de relatórios, tanto a barra do recorte quanto o resumo do projeto;
- Registros (Documentos), Meu trabalho, Equipes, programação da dinâmica, estrutura institucional, histórico de estoque e gastos.

A exceção é a vista nova **Histórico** de Registros (PR49), que não tem exportação. Ela é da sessão visual e fica como pendência.

## 1. Projetos fixados

- Os fixados agora ficam **na conta**, em qualquer aparelho. A migração `0038_user_preferences` guarda só os ids, com no máximo 12 projetos e 12 equipes. Os fixados antigos, que ficavam só no navegador, são trazidos uma vez para a conta.
- Na grade, os fixados vêm **primeiro** e marcados como "Fixado".
- A faixa de fixados tem **largura uniforme**: uma coluna por projeto, mesmo quando há um só (247 px em 1366; duas colunas de 176 px no celular). O alfinete para desafixar fica **ao lado do nome**. Testado com 1, 2, 4 e 10 fixados.

## 2. Menu lateral

- Projetos e Equipes ganham uma **seta** que mostra os fixados como subitens. O menu mostra até 6 e, se houver mais, oferece "Ver os N fixados". Na página do próprio módulo a lista já vem aberta; com o menu recolhido, ela não aparece.
- Na gaveta "Mais" do celular, os fixados aparecem logo abaixo do módulo.
- Meu trabalho não ganhou subitens: não há o que fixar nele.

## 3. Equipes e empréstimos

- **Causa:** o botão "Nova equipe" só aparecia na visão da organização inteira, mas a página abria com um projeto selecionado, então o botão sumia.
- **Agora:**
  - quem gerencia vê "Nova equipe" sempre, e o botão leva à visão da organização com o formulário aberto;
  - sem equipes, a página oferece "Criar equipe";
  - um texto diz que é ali que se cria e edita equipe, e que "Pessoas e acessos" cuida de quem entra e de qual permissão tem.
- Nos responsáveis do empréstimo (e de materiais e dinâmicas), quando não há equipe aparece "Criar equipe em Equipes", que abre a página com o formulário pronto.
- A equipe aberta pode ser **fixada no menu**. O nome só aparece para quem ainda pode ver a equipe: quem a integra e mantém vínculo com a organização, ou quem tem acesso de gestão nela.

## 4. Dinâmicas

- A página explica: dinâmica é uma atividade com brindes, pertence a um projeto (o organizador, de cujo estoque saem os brindes) e pode acontecer dentro de um evento anfitrião.
- A lista "Dinâmicas que você acompanha" mostra, por exemplo, "do projeto Rolê da Extensão · no evento 23º CONPEEX", com links. Cada cartão mostra "No evento …".
- A explicação fica depois do atendimento presencial, que é o uso no evento.
- O evento anfitrião vem do planejamento da dinâmica (`campaign_host_contexts`), filtrado pelos projetos que a pessoa pode ver.

## Verificação

- 1420 testes, tipos e lint (0 erros). Testes novos:
  - `preferences` (isolamento, limite, importação, nomes de equipe por acesso, anonimização);
  - `navigation-pinned-subitems`;
  - `work-teams-panel-create`;
  - fixados do painel de Projetos.
- QA local sintético (porta 5176) em 1366 e 390 px, claro e escuro:
  - importação do fixado antigo;
  - 1, 2, 4 e 10 fixados;
  - abrir projeto e equipe pelo menu;
  - criar equipe com projeto selecionado;
  - vínculo de evento anfitrião;
  - gaveta do celular sem rolagem lateral.
