# Planilha por projeto: interface de conexão

Continuação do recorte visual `150648d`. O backend é responsabilidade da frente de planilhas (`dcf9ab0` e `cf5ecc5`, integrados pelo coordenador). Esta entrega não faz push nem deploy.

## Brief

Para servidores e integrantes que trabalham principalmente no Google Sheets: oferecer na ficha do projeto um acesso direto ao documento específico e às suas abas, sem levá-los à planilha mestre. Gestores podem vincular o documento e preparar sua conexão, com a menor permissão necessária. Pessoas que apenas participam do projeto não veem chaves nem formulários de gestão.

Pronto quando: links nativos abrem as abas do mesmo documento; gestão começa recolhida; ID/link do Sheets é validado; resumo de demandas é opt-in desligado; chave aparece uma única vez, mascarada, e sai ao fechar/trocar de projeto; revogação confirma a linha escolhida; falhas permitem tentar novamente e revogação de acesso esconde o estado anterior.

## Comportamento

A revisão do coordenador também reforçou a janela do panorama: o cartão usa **Empréstimos recentes**, a legenda explicita **Empréstimos carregados · até 100 mais recentes** e o vazio diz **Nenhum registro carregado**, preservando o LIMIT 100 da API. O teste unitário confere o contrato literal do denominador.

- `ProjectSheetsPanel` usa GET/POST `/api/projects/{projectId}/sheets`. Links sempre correspondem ao `spreadsheetId` da conexão atual; não aceita endpoint arbitrário ou URL de outro documento.
- A navegação rápida da ficha oferece Planilhas mesmo antes de haver conexão. Equipe e convites aparece somente com `permissions.accessManage` e abre o módulo no projeto atual.
- Referências manuais existentes continuam abaixo em **Outras planilhas e referências**; a planilha mestre mantém a restrição anterior de responsável global.
- Uma URL vinculada não cria um arquivo, não muda seu compartilhamento no Google nem instala uma rotina. O bloco de instalação informa a necessidade de Apps Script, autorização e primeira atualização. O estado diz **Conexão habilitada**, sem prometer execução já instalada.
- `includeTasks` nasce falso. A confirmação explica que todos com acesso ao documento no Google lerão títulos, prioridades, estados e prazos; corpos, responsáveis e contatos não são enviados.
- Chaves de consulta ou de materiais valem 30 dias. A interface não usa localStorage, rascunhos ou logs para a chave; ela só existe no estado em memória enquanto exibida. Ao fechar a gestão, descartar, trocar de projeto ou atualizar a lista, a chave sai da tela. Uma emissão que termina após o fechamento também é descartada.
- A cópia é explícita; se o navegador bloquear a área de transferência, o campo fica selecionado para a pessoa copiar.
- A revogação exige confirmar a conexão escolhida. Uma falha de GET apaga links e metadados anteriores, evitando manter a interface de gestão depois de uma perda de acesso.

## Verificação

- TypeScript e ESLint dos arquivos alterados aprovados, sem avisos pendentes.
- 8 testes novos de estado/segurança da interface aprovados, incluindo conta/projeto, falhas, CAS, opt-in, emissão tardia, fechamento, cópia e revogação. Os testes falham se este componente tentar acessar localStorage.
- Suites relacionadas de Projetos/contextos e Demandas também aprovadas (42 casos antes do último teste adicional; 8 casos novos da interface de planilha na versão final).
- Build Node aprovado. O coordenador deve executar os gates da revisão integrada ao backend.
- Navegador: Chrome, 375/390/1366 px × claro/escuro. App e SQLite locais descartáveis; somente a rota nova de planilhas foi simulada, com dados sintéticos. Links, chave mascarada, descarte ao fechar/reabrir e confirmação de revogação verificados. Sem overflow horizontal ou erros de página.
- Capturas em `apps/proex-portal/.sites-runtime/project-visual-qa/sheets-*.png`; `sheets-result.json` contém o resultado. As capturas longas de gestão usam uma altura maior para enquadrar o componente inteiro; a navegação foi testada nas alturas 844/1000 px.

## Limites de evidência

Esta frente não criou nem autorizou um documento no Google e não verificou ida e volta em uma planilha real. O navegador verificou a interface contra respostas simuladas do contrato novo. Os testes reais do serviço/conector pertencem à outra frente e a revisão integrada pertence ao coordenador. Nenhuma chave ou documento real foi usado nas capturas.

## Revisão de densidade da gestão

A crítica independente do coordenador aprovou o painel cotidiano (9/10) e pediu reduzir linhas longas e altura da gestão desktop. A gestão agora coloca as etapas 1/2 lado a lado a partir de 850 px de container, mantém a chave emitida na largura completa e organiza a instalação em quatro passos em duas colunas. No celular continua em uma coluna. O estado cotidiano continua recolhido.

## Aprendizados

Um link filtrado da planilha mestre não isola a informação no Drive. O documento por projeto precisa ser independente e compartilhado com a equipe correta. Sincronização é um comportamento do conector instalado, não uma propriedade de uma URL. Campos de credencial em interfaces reativas precisam mascarar a identidade anterior antes dos efeitos e também rejeitar respostas que terminem após o contexto mudar.
