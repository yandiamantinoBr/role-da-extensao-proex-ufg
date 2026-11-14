# Busca, filtros e contexto do Portal PROEX

Leitura da base `738adf8` em 14/11/2026. A matriz descreve a base consultada para orientar as frentes. O estado de publicação de cada melhoria deve ser conferido na respectiva PR.

| Tela | O que o usuário consegue filtrar | Fonte, persistência e limites |
| --- | --- | --- |
| Demandas | Organização, projeto, compromisso quando aberto pelas Frentes, título ou descrição, situação e prioridade. Linha do tempo, matriz e resumo dependem da consulta. | Servidor autoriza cada demanda e retorna até 50 por página. A consulta atrasa 200 ms e cancela a anterior. O endereço guarda a demanda, o projeto geral e a atividade, enquanto o seletor dentro da tela e as demais escolhas ficam locais. Os indicadores descrevem só a página de 50. |
| Agenda | Categoria, unidade responsável, projeto, datas inclusivas e um dia no calendário. | Servidor cruza categoria, datas em Brasília e acesso. O arquivo ICS repete esse recorte. Escolher um dia reduz só a lista. O endereço guarda unidade e projeto. Categoria, datas consultadas e dia selecionado ficam na tela. Assinaturas contínuas têm seu próprio escopo. |
| Materiais | Contexto de projeto, unidade responsável e área temática. No catálogo, dono do material, classe, categoria própria, situação e foto. | O servidor fornece o instantâneo já limitado por permissão. A busca original no componente pai restringe nome e descrição e desmonta o catálogo quando zera. Na melhoria de 14/11, busca e filtros operam sobre as mesmas linhas autorizadas, inclusive kits. O endereço guarda contexto de projeto, unidade e área. |
| Empréstimos | Projeto, unidade responsável e área temática. Um link pode abrir somente a reserva correspondente. | A lista própria usa o instantâneo do servidor. A consulta original não possui busca, situação ou intervalo. Dados privados do solicitante vêm de uma projeção separada. Agenda e relatórios já consultam datas, com propósitos próprios. |
| Equipes | Organização, projeto, nome da equipe, participação própria e situação das demandas da equipe selecionada. | Servidor pagina demandas e verifica vínculo, escopo, revogação e integrantes; a busca de nome cobre até as 200 equipes carregadas. A instituição possui as equipes e a atribuição de demandas gera trabalho nos projetos. O seletor atual muda a consulta e o arquivo exportado. A ficha da equipe e os refinamentos não são restaurados integralmente pelo endereço. |
| Projetos | Busca por nome, sigla, unidade ou finalidade. Abrangência interna/externa, unidade, área, modalidade e situação. | Catálogo sobre instantâneo autorizado, com filtros locais e atalhos fixados na conta. O endereço restaura a ficha selecionada. A busca e os filtros do catálogo reiniciam ao sair do módulo. Os números dos botões de abrangência mostram o universo por tipo. |

## O que corrigir primeiro

1. **Demandas.** Ao trocar a organização, a tela hoje escolhe o primeiro projeto elegível. A lista do servidor com uma organização e sem projeto inclui projetos e demandas gerais a que a pessoa tem acesso. O menu oferece o rótulo “Demandas gerais da organização” para essa consulta mais ampla. Distinguir os três recortes. Usar rótulo correto para título e descrição. Alinhar o atalho de relatório ao recorte efetivo e distinguir indicadores da página de totais calculados no servidor.
2. **Materiais.** Unificar busca e filtros no catálogo. Consultar código patrimonial, categoria, destino, unidade, descrição e nome com a mesma regra de acentos e termos. Manter os critérios visíveis e a limpeza disponível ao chegar a zero. Separar a unidade do projeto, usada no contexto geral, da unidade dona do material, usada no catálogo.
3. **Empréstimos.** Priorizar busca por equipamento, código e nome da atividade, seguida de situação e datas inclusivas. Aplicar o limite de visibilidade existente também ao texto pesquisável. Deixar claro se o intervalo encontra reservas que começam nele ou qualquer reserva que se sobreponha.
4. **Equipes.** Distinguir equipes transversais de projetos atendidos. Mostrar vínculo explícito e trabalho inferido de atribuições com termos distintos. Participação, vínculo de catálogo e autorização pessoal continuam sendo verificações independentes. Os totais, participantes, páginas, planilhas e arquivos precisam compartilhar o recorte.
5. **Agenda e Projetos.** Alinhar os nomes dos filtros compartilhados e a retomada da consulta. Na Agenda, mostrar o recorte junto do arquivo e distinguir período consultado, dia visível e assinatura. Em Projetos, distinguir contagem do universo e quantidade após aplicar todos os filtros.

## Critérios para evoluir a navegação

- Manter busca e resumo do recorte disponíveis no celular. Agrupar refinamentos secundários em um controle explícito e manter rótulos acessíveis. Conferir a interface a 320 CSS px e os tamanhos de 390 e 1366 px usados no Portal. Os controles principais seguem o alvo interno de 44 px. [USWDS · busca](https://designsystem.digital.gov/components/search/) · [W3C · adaptação ao espaço](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) · [W3C · tamanho mínimo dos alvos](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).
- Anunciar atualização e quantidade em uma região de status. Preservar foco durante a digitação e devolvê-lo à busca se o comando de limpeza desaparecer. Apresentar carregamento, erro, lista vazia e zero após filtrar com formas de recuperação distintas. [W3C · mensagens de status](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).
- Validar filtros compartilháveis por módulo, incluindo recarga, Voltar e entrada sem sessão. Filtros de texto e identificadores exigem limites de entrada e verificação das permissões. Guardar preferências privadas separadamente de dados sensíveis e do endereço. Exportações e consultas devem conferir a autorização vigente.
- Para buscas paginadas, filtrar antes da paginação e mostrar o alcance verdadeiro das contagens. Cancelar requisições antigas e rejeitar respostas de outro contexto. Medir as consultas locais com dados fictícios antes de introduzir índices ou novas chamadas.

## Onde conferir

- [Navegação e contexto comum](../app/portal-client.tsx) · [leitura do endereço](../lib/portal-history.ts) · [destino após entrar](../lib/login-destination.ts).
- [Demandas](../components/portal/follow-up-panel.tsx) · [consulta e autorização](../lib/follow-up/service.ts) · [relatório de demandas](../lib/follow-up/reports.ts).
- [Agenda](../components/portal/calendar-panel.tsx) · [consulta e assinatura](../lib/calendar.ts) · [teste de estado](../tests/calendar-panel-state.test.mjs).
- [Materiais](../components/portal/material-catalog.tsx) · [projeção de estoque, empréstimos e dados privados](../lib/portal-data.ts) · [testes de filtros compactos](../tests/compact-filters-state.test.mjs).
- [Equipes](../components/portal/work-teams-panel.tsx) · [consulta, paginação e exportação](../lib/follow-up/teams.ts) · [testes de acesso](../tests/work-teams.test.mjs).
- [Projetos](../components/portal/project-panel.tsx) · [testes de navegação](../tests/portal-history.test.mjs).

## Aceite do catálogo de Materiais

Em banco local descartável, a busca pelo código sintético `QA-TEST-001` encontrou o equipamento entre dois materiais. Com “Estoque baixo”, a busca apresentou zero resultados e conservou os critérios. “Limpar busca e filtros” restaurou dois materiais e dois kits e devolveu o foco à busca. As larguras de 390 e 1366 px nos temas claro e escuro comportaram busca e filtros sem rolagem horizontal da página. Tipo, checagem e compilação Node passaram. Os testes do catálogo, navegação, acessos e Agenda somaram 30 aprovações. A busca permanece local ao painel e não altera a fonte de dados de estoque.

## Fluxos integrados em 14/11

- **Demandas** · Escolher uma organização mostra o conjunto autorizado. É possível escolher um projeto ou, com a permissão correspondente, apenas as demandas gerais. “Relatório do recorte” transfere organização, projeto, situação e prioridade. Um link aberto de novo solicita o termo de busca. Mudanças de acesso pedem uma nova escolha de recorte.
- **Agenda** · A busca por texto atualiza os resultados exibidos e as contagens no calendário. A exportação ICS segue as datas, a categoria, a unidade e o projeto informados junto ao botão. A assinatura contínua tem sua própria configuração.
- **Empréstimos** · Nome do equipamento, patrimônio e nome da atividade podem ser combinados com situação e período. O intervalo inclui reservas que se sobrepõem aos dias selecionados, em Brasília. Atraso exige retirada anterior e devolução ainda pendente.
- **Equipes** · Projeto atribuído e unidade são dimensões distintas. Na ficha de cada projeto, “Quem cuida de cada área” atribui uma equipe. A gestão pode repetir a designação em quantos projetos precisar. Equipes permite filtrar atuação em vários projetos ativos, vínculo institucional ou ausência de projetos. Os vínculos no organograma seguem o mesmo alcance.
- **Relatórios** · PDF, XLSX, DOCX e JSON repetem a consulta antes da preparação e antes de entregar. Impressão só insere linhas e gráficos na janela depois de confirmar a consulta. Se os dados mudaram, a tabela se atualiza e pede novo clique. Se a sessão ou o recorte mudou durante a entrega, o arquivo é descartado. A busca recebida de Demandas viaja no corpo da consulta e aparece apenas como “Busca de Demandas aplicada” nos metadados do arquivo. Os atalhos do Google Sheets continuam abrindo os arquivos já vinculados.
