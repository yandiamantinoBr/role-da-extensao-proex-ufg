# Resumo pessoal do início e estrutura institucional

## Estado e pronto quando

Composição isolada sobre a produção PR35. Ainda não publicada. Serve a quem precisa identificar o trabalho pessoal ao entrar e a quem administra a estrutura formal da organização, sem converter equipe/unidade em concessão de acesso.

Pronto quando: totais do servidor equivalentes a Meu trabalho, recortes e histórico validados, carregamento/erro distintos de zero, cadastro/edição/arquivamento/replay sem perda de acesso; exportação PDF/DOCX/XLSX conferida com duas leituras atuais; migração aditiva com dados anteriores preservados; tipos, lint, testes, dois builds, navegador nos dois temas e revisão independente concluídos. A revisão independente final foi interrompida pelo limite de uso dos subagentes, portanto não atribuir nota9 ou aceite global.

## Resultado implementado

O início mostra Atenção, Prazo hoje, Pendentes e Em andamento em cartões clicáveis, com símbolos, cores semânticas centralizadas, recorte e horário de Brasília. Os grupos podem se sobrepor. As responsabilidades ativas aparecem separadas. A caixa anterior agora se chama Alertas operacionais e explica que trata estoque, empréstimos e dinâmicas. Não afirma que não há demandas pessoais.

`GET /api/my-work/summary` não recebe nomes ou conteúdo privado no DTO global: resposta própria e limitada, sem títulos, contatos, corpos, IDs de demandas ou listas. Reutiliza os predicados autorizativos de Meu trabalho, deduplica atribuição direta/equipes e compara duas projeções fortes incluindo autoridade atual. Revogação parcial retorna403, alteração durante a leitura409; não se convertem em zeros. Atualização por foco, evento e virada do dia, sem polling persistente.

O status pessoal é validado na URL e sobrevive a recarga e navegação do navegador. Mudanças de filtro substituem a entrada; trocas de módulo criam nova etapa. O teste de retorno encontrou reutilização temporária de resultado anterior. Uma época nova por status recebido e cancelamento no layout corrigem o caso, preservando o filtro direto/equipe. Respostas tardias não reabrem nomes ou exportações do recorte antigo.

Em Equipes, Estrutura institucional distingue a árvore formal das equipes de trabalho. Fonte pública oficial5.0.3 de28/07/2026, modelo editável com11unidades, governança da Câmara separada da subordinação. Migração0029 cria três tabelas vazias; não semeia nomes/pessoas, não altera unidades globais ou ACL. Modelo aplicado somente por ação explícita de responsável da organização em estrutura vazia. Modificações são marcadas como adaptação local. Integrantes, contatos e informações de equipes não autorizadas ficam fora do DTO/exportação.

Administração exige responsável organizacional/global ativo; gerente de projeto, afiliação a equipe e delegação de IA isoladamente não bastam. SQLite protege ciclo, organização, limites, arquivamento e vínculos, com CAS/idempotência/auditoria mínima e verificação terminal de autoridade. O limite500vínculos permite reafirmar vínculo já ativo sem aceitar501. Exportações usam projeção permitida e leitura atual antes/depois da geração.

## Provas até este checkpoint

- Suíte integrada1.183/1.183 aprovada com snapshot/journal0029,104tabelas de aplicação, modelo sem drift e migrações preservadas. Tipos passaram. Lint final sem erros, dois avisos de imagem anteriores. Dois erros novos do lint foram corrigidos sem supressão de regras.45focais de UI foram repetidos;13focais de estrutura passaram após rótulos acessíveis.
- Bancada com servidor/API/SQLite reais e dados exclusivamente sintéticos: cinco demandas, quatro designações,12capturas de Meu trabalho/Equipes/IA em390/1366 claro/escuro, sem erroJS.
- Resumo pessoal:375/390/1366 claro/escuro,24cliques de cartões, recarga/Voltar/Avançar, seis capturas populadas. Sem overflow; grade2/4colunas e alvos44px medidos. Erro403 simulado no transporte limpa os números; as revogações reais são cobertas por SQLite. Nenhum registro de QA em produção ou envio externo.
- O fluxo da estrutura encontrou seletor sem nome acessível preciso; rótulos explícitos corrigidos. Recompilação e repetição completa, documentos e inspeção visual final ainda recebem recibo. Não chamar a execução interrompida de aprovada.
- A primeira tentativa de smoke Worker foi feita após build Node e recusou o artefato por falta do wrangler.json; não foi falha de autenticação. Repetir na ordem Worker → smoke → Node. A mesma dist é substituída entre alvos; não recompilar enquanto um QA lê essa distribuição.

## Limitações e continuidade

A PR35 segue sendo a versão funcional comprovada em produção. O Chrome foi restaurado, mas debugger não anexado e captura nativa divergente do alvo impedem declarar inspeção autenticada concluída. Não usar cookies exportados ou cliques por geometria incerta para contornar a ferramenta.

Conectores reais do Google, coleta Calendar, segredo dedicado/recuperação externa, custeio/IA real, interoperabilidade MCP e migração institucional permanecem com seus aceites próprios no CONTINUAR-AQUI e na Vault. Este incremento não instala Google Apps Script, amplia permissões reais, envia e-mails ou chama provedores. Não substitui a fila completa de requisitos por duas funcionalidades novas.

Worktree da composição: `proex-worktrees/resumo-estrutura-05nov`, branch `codex/proex-resumo-e-estrutura-05nov`. Fontes originais preservadas em `codex/estrutura-institucional` e `codex/resumo-pessoal-dashboard`; usar a composição com as correções do coordenador e não recolher isoladamente os commits antigos sem elas. Evidências sintéticas ignoradas em `.sites-runtime`; notas privadas na Vault. Não copiar credenciais, caminhos privados do Drive ou sessões para o Git público.

Contratos: [Resumo pessoal](../apps/proex-portal/docs/RESUMO-PESSOAL-DASHBOARD.md), [Estrutura institucional](../apps/proex-portal/docs/ESTRUTURA-INSTITUCIONAL.md). Recibo de produção anterior: [PR35](ENTREGA-05NOV-PROVEDORES-E-RELATORIOS.md).


## Builds finais

Fonte `c2de498`: Worker compilado, smoke de autenticação/CPF/cookies/logout/revogação e MCP aprovado na ordem correta, depois build Node aprovado. A bancada do fluxo institucional foi recriada limpa após esses builds; o processo anterior foi encerrado pelo próprio comando `parar`, sem tocar servidores de outros projetos. A entrega permanece sem publicação até fechar o navegador da estrutura e a revisão independente.

Main documental `cec980f33ef93df17dfe1b2298e280b71e5989ca` ficou READY na Vercel `dpl_Ee4k5zxEcM9nYNvxbkCbzYbiX9C5` e alias oficial conferido. Não muda o código funcional da PR35. Os registros anteriores de4992afa continuam como recibo do merge funcional.


## Estrutura no navegador e refinamento do PDF

Fonte `c2de498` passou o fluxo completo no navegador local: prévia oficial editável/aplicação, unidade com nome longo, edição, vínculo e navegação à equipe, arquivamento bloqueado por vínculo, desvinculação/arquivamento/reativação e fonte com data brasileira. Foram 22 capturas de vazio/prévia/árvore/edição/exportação em 390/1366 px, temas claro/escuro; nenhum overflow, alvo interativo menor que 44 px, erro JS ou requisição externa. PDF 64.389 bytes, DOCX 33.315 e XLSX 13.571; duas consultas atuais por arquivo e OpenXML reaberto sem identificadores/contatos.

O PDF de três páginas foi renderizado e inspecionado. A coluna Tipo quebrava a última letra de Coordenação; pesos foram equilibrados e a ordem foi alterada para respeitar a hierarquia, antes de ordenar irmãos. Fonte `d52bc59`: seis testes de exportação passaram, incluindo texto inteiro na coordenada da coluna e árvore de entrada embaralhada. O gerador real com o estado sintético da API produziu o PDF refinado de 64.179 bytes, renderizado e conferido; não é arquivo de produção nem captura do build antigo. As demais provas de UI continuam no build anterior, sem alteração visual dos componentes entre esses dois commits. CI do head final refaz os alvos.

PR #36: https://github.com/yandiamantinoBr/role-da-extensao-proex-ufg/pull/36 . Permanece rascunho: a revisão independente final não concluiu por limite dos agentes. A árvore móvel pode ganhar recolhimento por ramo para reduzir a extensão e facilitar a leitura; é refinamento proposto, sem nota9/10 atribuída ou promessa de perfeição. Não instalar fonte/dados reais a partir da bancada.


A recaptura do primeiro ajuste de larguras revelou que o cabeçalho Situação também precisava de espaço. O ajuste final conserva esse espaço e mede as palavras com as fontes reais, sem compensar com fonte menor. O teste agora exige Coordenação e Situação inteiras nas posições da tabela. Seis testes passaram; a fixture final de três unidades produziu PDF de 60.418 bytes, renderizado e inspecionado. A prova anterior de 12 unidades/64.179 bytes é intermediária. Mantidas todas as colunas permitidas e a ordem hierárquica; sem mudança de escopo ou dados.


A revisão final de navegação encontrou um estado residual: ao trazer um filtro pessoal de organização e depois selecionar no Início um projeto de outra organização, o cliente podia consultar o par incompatível e receber403. A seleção agora limpa o filtro pessoal anterior ao trocar para um projeto de outra organização, alinhada à validação já feita pela URL e pelo servidor. Não concede acesso adicional. Testes focais de histórico/escopo passaram; o cenário entre organizações em navegador real ainda integra o aceite independente pendente.

Calendar relido no destino canônico informado pelo usuário:200/text-calendar,1VEVENT,636bytes, CRLF conforme, DTSTART20261109 e DTEND exclusivo20261114. A assinatura Google existente ainda retornou0eventos nessa janela. O link privado não é publicado; nenhuma agenda foi duplicada, alterada ou revogada. Fonte com evento e coleta Google são aceites distintos, sem causa presumida.
