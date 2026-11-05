# Filtros, projetos, arquivos e feedback

## Resultado desta etapa

Filtros de contexto deixam de reservar um espaço vazio quando expandidos. O campo de data apresenta dd/mm/aaaa e um calendário português mesmo em navegador en-US. O calendário carrega quando solicitado; se o recurso falhar, o campo digitável continua disponível. Favoritos pessoais são atalhos compactos e a demanda tem um link para o projeto de origem. O panorama do projeto permite selecionar uma situação para conferir os registros correspondentes, com valores e texto além da cor. Empréstimos declaram a janela dos 100 mais recentes.

A ficha oferece uma planilha nativa exclusiva por projeto, com cadastro/edição de metadados de materiais pelo conector separado. A mestre continua consolidando o estado do Portal pela rotina existente. Chaves duram 30 dias e ficam vinculadas ao projeto, arquivo, emissor e revisão do vínculo. Um gestor precisa escolher explicitamente se títulos, estados e prazos de Demandas podem ser copiados ao arquivo. Corpos, contatos, responsáveis e credenciais ficam fora dessa projeção. Compartilhamento no Google continua independente.

O rodapé mostra a versão e abre o feedback. Cada pessoa acompanha seus registros; gestão de projeto só gerencia os respectivos e feedback geral cabe ao autor e responsável global. Envios têm chave de repetição, limite diário, auditoria sem corpo e limpeza na anonimização da conta. A revisão independente corrigiu respostas antigas de consulta e manteve o botão Fechar visível ao rolar.

Registros e Resumo diário oferecem PDF, DOCX e XLSX. Downloads conservam o recorte e seus metadados. A ficha aponta para a planilha do projeto, em vez de apresentar apenas a importação de uma cópia XLSX. Equipe e convites abrem no projeto escolhido e rascunhos de convite são separados por contexto.

## Evidências em bancada

- Testes SQLite e de transporte cobrem duas organizações, dois projetos, papel alterado durante a chamada, arquivo trocado, repetição, CAS, rollback, expiração e colisão com a mestre. O modelo Drizzle e a cadeia de migrações são conferidos por teste.
- Projetos e datas passaram em 375/390/1366 px, claro/escuro. O calendário foi exercitado com en-US, toque, teclado, Escape, limites, rascunho, reset e envio imediato. Sheets teve teste de interface com rota simulada; o script publicado foi testado em VM com base real descartável.
- A interface de Registros baixou arquivos PDF, DOCX e XLSX reais. O PDF foi renderizado com Poppler e inspecionado. XLSX/DOCX passaram pela leitura ZIP e XML; uma linha e o zero numérico foram conservados no Excel. A renderização visual do DOCX ficou pendente: LibreOffice não está disponível e a instância isolada do Word recusou automação COM. Isso não equivale a um teste visual aprovado no Word.
- O smoke autenticado executou o conector mestre real contra o Portal descartável, incluindo cadastro sem código, resposta perdida, edição nos dois sentidos, concorrência em células, conflito e conferência das 35 projeções.
- Benchmark local: 25 leituras públicas p50 3,92 ms/p95 4,27 ms; 25 leituras autenticadas p50 62,49 ms/p95 125,73 ms. Com 100 consultas públicas e concorrência 10, houve zero erros, p95 141,18 ms. Processo único, loopback e dados sintéticos; não estima capacidade serverless.
- Benchmark do conector por projeto: 13 chamadas, 502 linhas e 351 ms, contra 45 chamadas, 1.013 linhas e 1.444 ms da mestre no mesmo cenário sintético. Ainda há persistência do limitador em cada chamada HTTP. [Método e limites](../apps/proex-portal/docs/PLANILHAS-POR-PROJETO.md).

## Revisão e limites

O coordenador inspecionou as capturas de Projetos, datas e planilha. Os recortes receberam 9/10 após ajustes de semântica e densidade. A revisão de segurança independente do feedback não encontrou bloqueio e indicou três testes adicionais de revogação/anonimização, incorporados e aprovados. Isso não representa nota para todos os fluxos, leitores de tela ou aparelhos físicos.

Favoritos ficam neste navegador, por conta. Instalação do script no arquivo real, primeira execução e edição Google real por projeto são etapas distintas da publicação web. O mestre e seus três gatilhos não foram substituídos. Migração institucional continua planejada com inventário privado e rollback. Nenhuma pessoa foi convidada nem recebeu e-mail de teste nesta etapa; não foi inventado estoque de água, brindes ou presença.

MCP pessoal canônico, Groq no cofre da organização e checklist genérico de atividades estão em frentes seguintes, com credenciais e testes próprios. [Fila completa](RODADA-05NOV-UX-E-PLANILHAS.md). Atualizar este documento com CI, SHA, deploy e conferência do domínio antes de declarar publicação concluída.
