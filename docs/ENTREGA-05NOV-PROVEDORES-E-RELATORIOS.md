# OpenAI, resumo pessoal e planilhas restritas por equipe

## Resultado e estado

[PR #35](https://github.com/yandiamantinoBr/role-da-extensao-proex-ufg/pull/35), branch `codex/proex-provedores-e-relatorios-05nov`. Candidata em validação; este registro ainda não atesta publicação. A composição `f8c253f` passou **1129/1129 testes**, tipos e lint sem erros, com dois avisos antigos de imagem. O CI42043696074 também passou nesse SHA. A opção complementar de Markdown entrou depois em `e2c9f6c`; os43 testes focais de exportação passaram. Builds e inspeção integrada finais terão recibos próprios abaixo.

## Publicação comprovada em 2026-11-05

PR #35 mesclada em `4992afac14151ac66ae3be5b4e7139c8071e21ad`. O CI final [42049279531](https://github.com/yandiamantinoBr/role-da-extensao-proex-ufg/actions/runs/42049279531), sobre `de4dc6d6b1142b82e6fc11fbb9039e925ea52941`, passou **1.135/1.135 testes do portal**, tipos, lint, builds Worker/Node e verificações de autenticação. A primeira execução do CI dessa rodada falhou em uma expectativa antiga de plural; a expectativa foi alinhada ao texto novo e o CI final passou.

Vercel `dpl_Azn3XQoa3LsUQS8FsdwPZxinmGaP` ficou READY no mesmo SHA do merge. O alias `proex-gestao.vercel.app` foi conferido. Saúde canônica 200; rotas de equipes, credenciais, MCP e Meu trabalho retornaram 401 sem sessão e `private, no-store`; dois deploys aposentados continuam 403. O script publicado de equipe tem 9.108 bytes e SHA-256 `2b3f913bceeb4c97ad6ec1ebd5fcc5332b78b21587c66ba929fd48b3bdb26113`, idêntico ao Git.

Chrome restaurado por `launch_app`, confirmado no inventário e na árvore nativa. A extensão continuou sem debugger; na tentativa nativa, a captura veio de outra janela e o clique foi recusado por ausência de geometria. Nenhuma ação por coordenada foi feita depois dessa divergência. A inspeção autenticada pós-deploy continua pendente. Os dados e uploads abertos do usuário foram preservados.

O texto de candidata abaixo preserva a sequência de validação e fica superado, quanto ao estado de publicação, por este recibo.

## Comportamento entregue

- **Meu trabalho:** PDF, DOCX e XLSX das páginas atuais, com até seis demandas e seis designações, filtros, intervalos, totais e horários explícitos. A opção de Markdown para a Vault fica secundária. Baixar um arquivo não escreve nem sincroniza uma Vault.
- **Privacidade do resumo:** cada formato recebe somente uma projeção de campos permitidos. Um alvo restrito vira “Registro de acesso restrito”, sem nome, contexto, corpo, contato, responsável, URL ou ID. A consulta é refeita antes da geração e ao terminar; mudança de dados, acesso, conta ou contexto impede o download. O texto do Markdown mantém conteúdo literal sem criar HTML, links ou comandos incorporados.
- **PDF:** cabeçalho e primeira linha seguem juntos. Pesos opcionais de colunas são limitados; os demais relatórios conservam seus padrões. Uma linha maior que a página continua sem laço de paginação ou perda dos marcadores do teste. O resumo sintético passou de três para duas páginas legíveis.
- **Avisos:** fechar tem alvo44×44 dentro do cartão, espaço reservado para o texto, cores dos temas e rótulo “Fechar aviso”. A revisão mede também controles gerados pela biblioteca, além dos botões escritos no Portal.
- **OpenAI:** quinto provedor no cofre e seleção explícita para texto/documentos. Preserva credenciais anteriores, política pessoal/organização, reserva, revisão humana e revogação. Troca de provedor desliga as funções para nova confirmação; falta de chave não troca de serviço. A consulta de metadados não comprova inferência real.
- **Sheets da equipe:** arquivo exclusivo de uma equipe em um projeto, credencial própria e apenas demandas atribuídas àquela equipe. Afiliação não concede ACL. O canal é de consulta; o link da linha leva à edição no Portal. Não expõe a mestre, o projeto inteiro, corpos, contatos, anexos, histórico ou observações dos checklists.

## Acesso, concorrência e dados

Migrações0027–0028 e snapshots em sequência, **101 tabelas de aplicação**. A0027 amplia somente o CHECK de metadados de credenciais; dados populados, nove colunas, PK/FK, cifras/configurações e rollback foram ensaiados. A exceção do guard aceita somente os dois rebuilds revisados; outras exclusões, renomeações ou desativação de FK continuam recusadas.

Três problemas do conector de equipe foram reproduzidos por revisão independente e corrigidos: título retornado após retirada de atribuição; replay de conclusão antiga com atribuição já retirada; requisição antiga pendurada bloqueando o contexto novo. A página e o recibo conferem o conjunto autorizado na transação final, inclusive replay. AbortController e identidade da operação impedem que o finally antigo libere a operação nova. Mudança de arquivo invalida credenciais e recibos anteriores. Triggers conferem exclusividade entre mestre, projetos e equipes nos dois sentidos.

## Evidência e limites

Ensaios dos agentes usaram navegador, serviços e SQLite descartável, com respostas de modelos simuladas. Foram baixados PDF/DOCX/XLSX reais; OpenXML foi reaberto e o PDF foi renderizado. Revisão independente:9,0/10 no painel de resumo,9,2/10 nas duas páginas do PDF e9,0/10 no painel de Sheets da equipe, nos recortes explicitados. A opção complementar de Markdown e o Toaster têm conferência integrada própria; essas notas não certificam todo o site, acessibilidade com leitor de tela, aparelho físico ou aparência do DOCX no Word.

`PROEX_KEYS_SECRET` permanece ausente. A revisão automática bloqueou seu provisionamento antes da execução; não houve criação de segredo ou leitura de valores, e a rejeição não foi contornada. O desbloqueio do Bitwarden desktop informado pelo usuário não desbloqueou a CLI. A política da ferramenta impediu abrir o aplicativo e não é uma configuração alterável pelo agente.

Não houve chave/modelo real, gasto de inferência, envio de e-mail, nova permissão Google ou instalação em arquivo real nesta composição. Novos conectores precisam de instalação e autorização próprias. A mestre existente confirmou35 tabelas em14:07:07.699Z após a PR34, incluindo a coluna kind; esse recibo não confirma a instalação do canal por equipe.

A assinatura existente do Google Calendar ainda retornou zero eventos para9–13/11 na reconsulta de05/11. O Chrome do usuário continuou sem conexão de inspeção; não atribuir as provas locais à sessão autenticada em produção. A consulta de inventário dos oito chats não respondeu e foi encerrada sem envio; a continuidade está salva no repositório e na Vault, sem afirmar comunicação nova aos chats.

Contratos específicos: [OpenAI](../apps/proex-portal/docs/OPENAI-TEXTO-ORGANIZACAO.md), [Sheets por equipe](../apps/proex-portal/docs/SHEETS-POR-EQUIPE.md), [Meu trabalho](../apps/proex-portal/docs/MEU-TRABALHO-EXPORTACOES.md), [continuidade](CONTINUAR-AQUI.md).


## Conferência integrada final do candidato

Revisão funcional59b7360: tipos e lint aprovados (dois avisos antigos de imagem), build Node aprovado. O build Worker e o smoke de identidade, CPF, senha, cookies, logout, revogação e MCP passaram na composiçãoe2c9f6c, antes do refinamento final de apresentação. O CI do head final verificará novamente os dois alvos.

Navegador real com conta/base sintéticas:14 módulos ×390/1366px × claro/escuro =56 estados normais de viewport, sem excesso horizontal, erroJS ou respostaAPI com falha. Foram quatro estados adicionais de avisos: botões44×44 medidos, no máximo dois visíveis/acessíveis, fila oculta fora do foco, cores aplicadas e fechamento por teclado. A primeira medição encontrou escala0,95/0,9 nos itens empilhados; a correção exibe os visíveis por inteiro. A pausa do temporizador por ponteiro/foco foi separada do ensaio de expiração.

Complemento com dados pelo HTTP normal: cinco demandas (direta/equipe/ambas; atenção2, prazo hoje1, andamento1, concluída1), quatro designações e duas equipes. Meu trabalho, Equipes e IA aberta tiveram12 capturas complementares; o PDF de duas páginas foi renderizado, e os três formatos principais foram baixados e reabertos. Capturas fullPage que disparavam transição do shell foram rejeitadas como prova principal; viewport e geometria foram preservados, e as imagens longas estáveis identificam a supressão de transição/navfixo apenas durante a captura. Parecer independente9,0/10 nesses recortes e no Toaster, semP1/P2 aberto no escopo observado. Não equivale a testar todos os botões/papéis do site ou o navegador autenticado de produção.

O Apps Script real da mestre, executado em VM contra HTTP/SQLite locais, passou as dez etapas: cadastro sem código, edição nos dois sentidos, resposta perdida, concorrência e conflitos, com35 projeções. Backup sintético5308490bytes,163chunks, um objeto privado verificado e SQLite1458176bytes restaurado em isolamento. Pico do processo273604KiB; esses números não representam backup de produção ou runtime Vercel.

Benchmark local:25 leituras públicas, p95 de5,45ms;25 autenticadas, p95 de54,71ms;100 públicas com concorrência10, zero falhas, p95 de85,57ms e total504,66ms. Loopback, processo único e carga sintética; diferenças frente a rodadas anteriores não isolam causalidade nem estimam capacidade serverless.

## Conector antigo e próxima frente

A reconsulta do app PROEX instalado no Codex confirmou uma divergência já registrada na V15: configuração da mesma mestre,27 projeções e último run de25/10, contra35 e recibo atual de05/11 no Google. As ferramentas não expõem a URL/host editável da conexão privada; origem antigaSites continua hipótese. Não usar suas ferramentas de escrita até identificar e revalidar o destino. O MCP pessoal canônico tem autenticação/envelope/finalidade próprios e não substitui de forma transparente as12 ferramentas antigas. Nenhum plugin, OAuth ou credencial foi alterado.

Estrutura institucional formal0029 e resumo pessoal de atenção no Dashboard seguem em worktrees distintas, fora desta PR. O quadro operacional atual não conta demandas; a próxima entrega distinguirá esse recorte e apresentará os totais pessoais sem incluir listas privadas no DTO global.
