# Acabamento de Demandas, Projetos e exportações · 2026-11-04

Esta rodada dá prioridade a quem consulta e edita demandas no celular e a quem precisa levar um recorte do Portal para uma reunião, um documento ou uma planilha. Os dados continuam sujeitos ao acesso de cada pessoa e projeto.

- **Demandas:** filtros em uma coluna nas telas mais estreitas; título antes dos sinais de estado, urgência e prazo; ação de editar antes do compartilhamento. Ao fechar o detalhe, o foco retorna ao cartão ou à linha do tempo. O formulário espera as opções do projeto correto antes de permitir salvar, oferece nova tentativa em caso de falha e confirma a gravação.
- **Projetos:** criar ou editar abre o formulário abaixo do cabeçalho móvel. O foco vai para o formulário e a rolagem respeita a preferência de movimento reduzido.
- **Exportações:** os botões de saída não oferecem CSV. O resumo diário, os registros e os atalhos completos usam XLSX; a central e a ficha mantêm PDF, XLSX e DOCX. A ficha oferece acesso às planilhas já vinculadas, quando disponíveis, com orientação para importar o XLSX no Google Sheets. A importação de CSV e o contrato anterior da API continuam disponíveis para integração. O link para Sheets não grava em nenhuma planilha.
- **Gráficos de relatórios:** o seletor de grupo e o clique na barra aplicam o mesmo filtro. O gráfico mensal tem uma tabela com os valores, e o eixo ocupa menos espaço nos cartões estreitos.

## Critérios de verificação

- Abrir uma demanda com título longo em 390 e 1366 px, nos dois temas. Verificar texto e ícones, ordem da edição, abertura por toque, mensagem ao salvar, fechamento e volta ao cartão.
- Simular atraso e falha do catálogo: a edição não pode enviar dados parciais nem remover responsáveis existentes. Um perfil de leitura não pode editar.
- Baixar PDF, DOCX e XLSX com dados fictícios e conferir extensão, estrutura e recorte. Abrir a ficha com e sem planilha vinculada e verificar que o atalho aparece apenas quando há vínculo.

## Evidências em bancada

- Demandas foi aberta e editada com toque emulado a 390 px; o título alterado e o recibo reapareceram. A tela ficou sem rolagem horizontal extra a 390 e 1366 px, nos dois temas.
- Em Projetos, o início dos formulários Criar projeto e Adicionar link ficou a 84 px do topo, abaixo do cabeçalho de 66 px. Foco no editor e preferência de movimento reduzido conferidos.
- Chrome baixou XLSX da Central e PDF, XLSX e DOCX da ficha. As três exportações completas responderam em XLSX com sessão válida e bloquearam sessão anônima. Um vínculo fictício fez aparecer o atalho para Planilhas; nenhum serviço Google foi chamado.
- Os gráficos passaram a 320, 390 e 1366 px, nos dois temas, com toque, teclado, valores mensais, retorno de foco e impressão das linhas filtradas. Esses ensaios usaram dados sintéticos; não incluíram aparelhos físicos nem leitores de tela.

O [roteiro de interação](REVISAO-DE-INTERACAO-MOVEL.md) guarda as regras reutilizáveis e o próximo recorte de navegação.
