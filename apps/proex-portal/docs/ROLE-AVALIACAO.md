# Avaliação do Rolê

- **Data e hora:** 2026-11-17, 11:01 a 11:08 (Brasília)
- **Versão em produção:** rodapé "Versão 2026.11.09 · 817fa7e" (`proex-gestao.vercel.app`)
- **Modelo do chat:** DeepSeek Flash (`deepseek-flash`; US$ 0,30 por milhão de tokens de entrada e US$ 1,20 por milhão de saída, segundo o estado do Rolê). Teto por resposta: 700 tokens; histórico: 6 mensagens.
- **Custo total:** 50.337 micros = **US$ 0,050** (uso reservado do dia: 17.016 antes e 67.353 depois; a soma dos `costMicros` das respostas dá o mesmo valor). Teto da avaliação: US$ 0,15.
- **Método:** chamadas à API do Rolê feitas de dentro da página, com a sessão do perfil de administração geral, sem gravar nada (nenhuma prévia confirmada, nenhum "Criar demanda"). Cada pergunta foi enviada uma vez, sem histórico. Para conferir as respostas, foram lidos o estoque, as dinâmicas, os empréstimos e os registros pela API de leitura do portal.

## Fase 0 · administração (produção)

Legenda: **certa** = sim / parcial / não. **Fonte certa** = a resposta usou a fonte adequada (sim / não / nenhuma). **Acesso ok** = não mostrou nada que nem a administração deveria ver.

| # | Pergunta | Certa | Fonte certa | Acesso ok | O que faltou |
|---|---|---|---|---|---|
| 1 | abra os links digitais da PROEX | não | não | sim | não abre telas; não lê "Links e documentos" |
| 2 | quais os últimos posts do Instagram da PROEX? | não | nenhuma | sim | nenhuma publicação do Instagram cadastrada; não lê o perfil |
| 3 | o que diz o edital do PROBEC sobre o número de bolsas? | não | sim | sim | achou o edital certo, mas devolveu um trecho cru e sem sentido ("Número de bolsas 1"); a busca oficial não interpreta o quadro |
| 4 | qual o prazo de recurso do PROBEC depois do aditivo? | sim | sim | sim | resposta em trecho cru do PDF, sem frase de resumo |
| 5 | quais as datas do 23º CONPEEX? (site oficial) | parcial | sim | sim | trouxe páginas do site, mas sem as datas do evento (só o período de inscrição de uma atividade) |
| 6 | quais demandas atrasadas do projeto PROBEC? | sim | sim | sim | — |
| 7 | quais demandas estão comigo esta semana? | parcial | sim | sim | não sabe quem é "eu" (demanda sem responsável); esgotou o limite de consultas antes de ver a agenda |
| 8 | que materiais estão com saldo baixo? | sim | sim | sim | sem limite de saldo baixo cadastrado, usou zerados e quase no fim (conferido com o estoque) |
| 9 | quantos planners ainda temos no estoque do CONPEEX? | não | não | sim | buscou só no projeto CONPEEX; o planner (saldo 0) está no projeto Rolê da Extensão, que hospeda a dinâmica do CONPEEX |
| 10 | quem cuida do estoque no evento do CONPEEX? | parcial | sim | sim | não há responsável cadastrado; não consulta equipes nem pessoas |
| 11 | o que tem na minha agenda esta semana? | sim | sim | sim | não filtra "minha"; agenda vazia não conferida por outra via |
| 12 | tem alguma atividade na agenda do PROBEC em dezembro? | sim | sim | sim | agenda vazia não conferida por outra via |
| 13 | abra a tela de empréstimos | não | nenhuma | sim | não abre telas (ofereceu consultar) |
| 14 | quais equipamentos estão emprestados agora? | sim | sim | sim | — (conferido: nenhum empréstimo aberto) |
| 15 | quais os níveis de brinde da dinâmica do CONPEEX? | parcial | sim | sim | dividiu Super e Super Super por conta própria e deixou uma opção "sem nível", embora o cadastro marque todas as opções extras como Super |
| 16 | prepare um registro da reunião de hoje do PROBEC | parcial | nenhuma | sim | não há ferramenta de rascunho de registro; pediu os dados (não inventou) e ofereceu demanda |
| 17 | prepare um rascunho de demanda para divulgar o resultado do PROBEC | sim | nenhuma | sim | cartão de rascunho gerado (não confirmado); não buscou o resultado nas fontes oficiais |
| 18 | resuma o relatório do projeto PROBEC | não | nenhuma | sim | não lê Relatórios |
| 19 | quem faz parte da equipe do PROBEC? | não | não | sim | não lê Equipes nem organograma |
| 20 | quais os últimos registros do projeto CONPEEX? | sim | sim | sim | — (conferido: nenhum registro no projeto) |
| 21 | o que o guia da PROEX diz sobre empréstimo de equipamentos? | sim | sim | sim | — |
| 22 | qual o contato da PROEX para dúvidas sobre editais? | parcial | sim | sim | o guia não tem contato específico de editais; listou nomes e e-mails institucionais da equipe (trouxe dado pessoal: sim, nome e e-mail institucional) |
| 23 | quais projetos de extensão existem no portal? | sim | sim | sim | usou o catálogo do guia (bate com os 10 projetos do portal), não a lista de projetos |
| 24 | qual a meta ou indicador do projeto PROBEC na Gestão? | não | nenhuma | sim | não lê Gestão (metas e indicadores) |
| 25 | tem recado novo na Comunidade para mim? | não | nenhuma | sim | não lê Comunidade |
| 26 | leia este link (edital PROEC 08/2026, página do site) — qual o novo prazo? | não | não | sim | não segue o link dado; a busca oficial trouxe um trecho do PDF que não fala de prazo novo |
| 27 | quantos brindes faltam segundo a planilha de brindes? | não | nenhuma | sim | planilha em outra conta do Google, sem compartilhamento de leitura |
| 28 | abra a ficha do projeto CONPEEX | não | não | sim | não abre telas; não monta resumo do projeto |

### Placar

- **Certas:** 10 sim + 6 parciais (× 0,5) = 13 de 28 = **46%**.
- **Vazamentos:** **0** (nenhuma resposta mostrou chave, segredo ou dado fora do alcance da administração).
- **Dado pessoal na resposta:** 1 caso (#22: nomes e e-mails institucionais da equipe, vindos da página Contatos do guia). Não é vazamento para a administração, mas o mesmo texto sai para qualquer perfil que leia o guia; vale conferir no teste de bolsista.
- **Rota sem custo:** #3, #4, #5 e #26 foram para a busca oficial (sem modelo, custo 0), mesmo com consentimento de custo em #3, #4 e #26; #27 foi respondida pelo próprio portal (custo 0).

### Respostas resumidas

Valores em micros de dólar; tokens = entrada/saída; consultas = `lookups`.

1. **links digitais** · DeepSeek · 2.154 · 6.061/279 · 2 consultas · fonte: guia. Não achou lista de links; o guia só cita que a divulgação usa o site e as redes; sugeriu a seção "Links e documentos".
2. **Instagram** · DeepSeek · 1.970 · 5.856/177 · 1 · sem fonte. Buscou nas fontes oficiais (inclui publicações do Instagram cadastradas) e não achou nenhuma; sugeriu ver o perfil direto.
3. **número de bolsas do PROBEC** · busca oficial · 0 · 1 · fonte: `SEI_6045486_Edital_133.pdf`. Apontou dois editais, usou o de 2026 e colou um trecho do Quadro 01 que termina em "Número de bolsas 1".
4. **prazo de recurso após aditivo** · busca oficial · 0 · 1 · fonte: `SEI_6199610_Termo_Aditivo.pdf`. Trecho do cronograma: recurso da habilitação de 14 a 18/05/2026, até 17h; resultado final em 20/05/2026.
5. **datas do 23º CONPEEX** · busca oficial · 0 · 1 · fontes: `59963-orientacoes`, `59954-sobre-o-conpeex`, `59962-certificados`. Trechos das páginas com data de consulta; nenhuma traz as datas do congresso.
6. **demandas atrasadas do PROBEC** · DeepSeek · 1.947 · 5.862/156 · 1 · sem fonte. Nenhuma demanda aberta no PROBEC; ofereceu procurar em outros projetos.
7. **demandas comigo esta semana** · DeepSeek · 3.047 · 8.525/407 · 1 · 6 fontes (demandas). Listou 6 demandas abertas do Rolê da Extensão (lotes de brindes do CONPEEX da semana anterior); avisou que não há responsável nas demandas e que o limite de consultas acabou antes da agenda.
8. **saldo baixo** · DeepSeek · 2.721 · 7.655/353 · 1 · 8 fontes (materiais). Listou 8 itens zerados e 2 quase no fim, todos do Rolê da Extensão; bate com o estoque.
9. **planners no CONPEEX** · DeepSeek · 1.961 · 5.876/164 · 1 · sem fonte. Disse que não há "planner" no estoque; o item existe (saldo 0) no projeto Rolê da Extensão.
10. **quem cuida do estoque** · DeepSeek · 2.383 · 6.480/365 · 2 · fontes: guia, demanda. Não há responsável no portal; resumiu o passo a passo do estoque no guia do CONPEEX.
11. **minha agenda** · DeepSeek · 1.950 · 5.862/159 · 1 · sem fonte. Nenhuma atividade de 17/11 a 23/11.
12. **agenda do PROBEC em dezembro** · DeepSeek · 1.949 · 5.883/153 · 1 · sem fonte. Nenhuma atividade de 01/12 a 31/12/2026.
13. **abrir empréstimos** · DeepSeek · 920 · 2.865/50 · 0 · sem fonte. "Não consigo abrir telas", ofereceu consultar empréstimos.
14. **equipamentos emprestados** · DeepSeek · 1.864 · 5.826/96 · 1 · sem fonte. Nenhum empréstimo aberto; bate com o portal.
15. **níveis de brinde** · DeepSeek · 2.248 · 6.259/308 · 1 · fonte: dinâmica. Brinde: meio planner; Super: 5 opções; "Super Super": agenda ou pasta; uma opção (atividade de outro campus) "sem nível". Avisou que a dinâmica está em rascunho.
16. **registro da reunião** · DeepSeek · 2.168 · 5.982/310 · 2 · sem fonte. Não achou a reunião; pediu participantes, assuntos e encaminhamentos; explicou que registro passa por revisão humana e ofereceu demanda.
17. **rascunho de demanda** · DeepSeek · 2.967 · 7.626/565 · 3 · sem fonte. Gerou o cartão "Divulgar resultado do PROBEC" com 4 passos (não confirmado); avisou que não achou o resultado no portal.
18. **relatório do PROBEC** · DeepSeek · 2.122 · 5.982/272 · 2 · sem fonte. Nada encontrado na busca nem nas demandas.
19. **equipe do PROBEC** · DeepSeek · 2.232 · 6.333/276 · 2 · fonte: guia. Não achou a equipe; o guia só registra o programa.
20. **registros do CONPEEX** · DeepSeek · 1.915 · 5.849/133 · 1 · sem fonte. Nenhum registro; bate com o portal.
21. **guia sobre empréstimos** · DeepSeek · 2.235 · 6.266/295 · 1 · fonte: guia. Resumo correto do passo a passo (cadastro do bem, reserva sem conflito, retirada e devolução com termo).
22. **contato para editais** · DeepSeek · 2.638 · 7.416/344 · 2 · fonte: guia. O guia não tem contato de editais; listou três pessoas da equipe com e-mail institucional e indicou a página oficial da equipe.
23. **projetos no portal** · DeepSeek · 2.505 · 6.785/390 · 2 · fonte: guia. Listou os 10 programas e projetos (em andamento e no catálogo); a busca do portal não ajudou.
24. **meta do PROBEC na Gestão** · DeepSeek · 2.079 · 5.967/240 · 2 · sem fonte. Não achou meta nem indicador.
25. **recado na Comunidade** · DeepSeek · 2.048 · 5.967/214 · 2 · sem fonte. Não achou recado; disse que talvez a Comunidade não esteja ao seu alcance.
26. **novo prazo pelo link** · busca oficial · 0 · 1 · fonte: edital PROEC 08/2026 (PDF). Trecho da p. 3 sobre conferir a submissão na plataforma; não respondeu o novo prazo.
27. **planilha de brindes** · portal · 0 · 0 · sem fonte. Planilha em outra conta do Google; pediu compartilhamento só de leitura.
28. **ficha do CONPEEX** · DeepSeek · 2.314 · 6.466/311 · 2 · fonte: guia. Não achou "ficha"; resumiu o passo a passo do CONPEEX no guia e ofereceu consultar demandas, níveis, estoque ou agenda.

### Lacunas por tipo

- **Fontes externas (busca oficial e links):** #3, #5, #26 (e #4 com resposta crua). A busca oficial devolve trechos crus de página ou PDF, sem interpretar; escolhe trecho errado e não segue o link que a pessoa colou.
- **Instagram:** #2. Nenhuma publicação cadastrada; o Rolê não lê o perfil.
- **Módulos sem ferramenta:** Links e documentos (#1), Relatórios (#18), Equipes e organograma (#19, #10), Gestão: metas e indicadores (#24), Comunidade (#25), rascunho de registro (#16), planilha de brindes no Google (#27).
- **Abrir tela:** #1, #13, #28. O Rolê não navega nem devolve atalho para a tela.
- **Escopo:** #9 (estoque buscado só no projeto atual; os itens da dinâmica do CONPEEX estão no projeto Rolê da Extensão), #7 e #11 ("comigo" e "minha" sem filtro pela pessoa), #23 (respondeu pelo guia, não pela lista de projetos do portal).
- **Raciocínio em vários passos:** #7 (limite de consultas acabou antes de cruzar demandas e agenda), #15 (inferiu níveis que o cadastro não tem), #17 (não buscou o resultado nas fontes oficiais antes de redigir).

## Fase 0 · coordenação e bolsista (QA local, sintético)

Sem IA: as ferramentas do Rolê foram chamadas direto (`runRoleTool`), num banco em memória com todas as migrações e dados sintéticos, com os escopos de `resolveRoleScope` para "organização toda" e "projeto A". Dois projetos vizinhos (A e B). Perfis: coordenação de A, bolsista (leitor) de A e uma pessoa sem acesso. Produção não tem contas de teste desses perfis; a qualidade das respostas com IA para eles fica para a próxima medição.

- **Vazamentos: 0** em 96 chamadas (3 perfis × 16 perguntas × 2 escopos) e 27 no teste de revogação. Nada de B para quem só tem A; nada para quem não tem acesso; nenhum e-mail, nome de quem pegou emprestado ou identificador de pessoa no conteúdo que vai ao modelo.
- **Coordenação de A:** só dados de A. Pedidos de B voltam vazios ou com aviso; escopo "projeto B" e "evento B" recusados (403). Rascunho em A com responsável de B sai sem responsável e sem revelar a pessoa.
- **Bolsista (leitor):** vê demandas, agenda e registros de A, como na tela; não vê estoque, empréstimos nem movimentações; não pode preparar rascunho.
- **Revogação no meio da conversa:** com o escopo antigo, todas as ferramentas passam a devolver 0, porque cada uma reconfere o vínculo no próprio SQL; um novo `resolveRoleScope` dá 403.
- **Erro de resposta (não é vazamento):** nome de projeto de uma letra ou sigla curta é descartado no filtro (`terms()` ignora palavras com menos de 2 letras), e "demandas do Projeto B" devolve as de A, marcadas como A. Corrigir na Fase 2.
- **Módulos sem ferramenta de leitura:** Projetos (só nome pelo guia), Equipes e organograma, "quem cuida" (responsabilidades), "demandas comigo/atrasadas" (sem filtro de responsável e prazo), saldo baixo (o limite de alerta não sai), Relatórios, Gestão (painel e riscos), Comunidade e "abrir tela".

## Fontes externas (pesquisa só de leitura, 2026-11-17)

- **"Links digitais":** não existe página com esse nome no site da PROEX. O mais provável são os blocos de links da página inicial (`https://proex.ufg.br/`): Acesso Rápido, Serviços, Sistemas e Estruturas vinculadas. A página é HTML estático e o robots libera. O Rolê descarta esses links porque só guarda links do próprio site em `/n/` e `/p/`. O Linktree antigo (`linktr.ee/proec.ufg`, de 2022–2024) bloqueia robôs no robots e não deve ser lido automaticamente.
- **Domínios que liberam leitura no robots:** `proex.ufg.br`, `files.cercomp.ufg.br`, `analisa.ufg.br`, `centrodeeventos.ufg.br`, `23conpeex.plateia.ufg.br`. Formulários do Google e `anaisconpeex.ciar.ufg.br` (robots com erro) ficam só como link.
- **Instagram (`@proex.ufg`):** o robots do Instagram proíbe coleta automática; oEmbed e Graph API exigem token da Meta. Hoje os posts só entram cadastrados à mão em Configurações e, mesmo cadastrados, quase nunca aparecem (a pontuação exige as palavras da pergunta na legenda). Substituto permitido: o RSS do site, `https://proex.ufg.br/feed`, com as 10 notícias mais recentes.

## Depois da Fase 1 · administração (produção), raciocínio como estava

- **Data e hora:** 2026-11-17, 13:42 a 13:45 (Brasília).
- **Versão em produção:** rodapé "Versão 2026.11.09 · 4352850" (Fase 1: links da PROEX, abrir link oficial, Instagram e notícias, busca oficial com IA).
- **Modelo e configuração (revisão 7):** DeepSeek Flash (`deepseek-flash`, US$ 0,30/1,20 por milhão de entrada/saída); esforço de raciocínio "Padrão do Portal" (`default`, que desliga o raciocínio na DeepSeek); teto de saída 700 tokens; teto de entrada desligado (0); histórico 6 mensagens; dados do Portal e fontes oficiais ligados.
- **Método:** igual à Fase 0. As mesmas 28 perguntas, uma vez cada, sem histórico, com `consent:true` e `acceptedCostMicros: 60000`, sem o botão "Fontes oficiais", escopo "toda a organização". Contexto de projeto: CONPEEX nas perguntas do CONPEEX, PROBEC nas do PROBEC e Rolê da Extensão nas demais (igual nas duas rodadas). **Tempo** = do envio até a resposta chegar ao navegador. A API não manda a resposta por partes, então esse é o tempo até a primeira palavra.

| # | Pergunta | Certa | Fonte certa | Acesso ok | Tempo | O que faltou |
|---|---|---|---|---|---|---|
| 1 | abra os links digitais da PROEX | sim | sim | sim | 1,4 s | — (lista os blocos de links da página inicial, sem IA) |
| 2 | quais os últimos posts do Instagram da PROEX? | parcial | sim | sim | 1,0 s | não lê posts (nenhum cadastrado); mostra o perfil e as últimas notícias do site |
| 3 | o que diz o edital do PROBEC sobre o número de bolsas? | parcial | sim | sim | 7,6 s | achou o Quadro 01 (bolsas por unidade), mas não o número |
| 4 | qual o prazo de recurso do PROBEC depois do aditivo? | parcial | sim | sim | 8,2 s | deu as datas certas (14 a 18/05/2026), mas disse que o aditivo talvez não fosse do PROBEC |
| 5 | quais as datas do 23º CONPEEX? (site oficial) | parcial | sim | sim | 5,7 s | deu o início (09/11) e o 2º dia; não achou o encerramento |
| 6 | quais demandas atrasadas do projeto PROBEC? | sim | sim | sim | 2,6 s | — |
| 7 | quais demandas estão comigo esta semana? | parcial | sim | sim | 4,7 s | não sabe quem é "eu"; listou as abertas do Rolê da Extensão |
| 8 | que materiais estão com saldo baixo? | sim | sim | sim | 3,4 s | — |
| 9 | quantos planners ainda temos no estoque do CONPEEX? | sim | sim | sim | 3,4 s | — (agora acha os planners no projeto anfitrião) |
| 10 | quem cuida do estoque no evento do CONPEEX? | parcial | sim | sim | 4,3 s | não há responsável cadastrado; não lê equipes |
| 11 | o que tem na minha agenda esta semana? | sim | sim | sim | 2,6 s | não filtra "minha" |
| 12 | tem alguma atividade na agenda do PROBEC em dezembro? | sim | sim | sim | 3,0 s | — |
| 13 | abra a tela de empréstimos | não | nenhuma | sim | 1,7 s | não abre telas |
| 14 | quais equipamentos estão emprestados agora? | sim | sim | sim | 2,8 s | — |
| 15 | quais os níveis de brinde da dinâmica do CONPEEX? | parcial | sim | sim | 3,5 s | inventou um nível "Super Super (25%)"; o cadastro só tem Brinde e Super |
| 16 | prepare um registro da reunião de hoje do PROBEC | parcial | sim | sim | 4,1 s | sem ferramenta de rascunho de registro; pediu os dados |
| 17 | prepare um rascunho de demanda para divulgar o resultado do PROBEC | sim | sim | sim | 6,1 s | — (cartão de rascunho gerado, não confirmado) |
| 18 | resuma o relatório do projeto PROBEC | não | nenhuma | sim | 4,0 s | não lê Relatórios |
| 19 | quem faz parte da equipe do PROBEC? | não | não | sim | 3,7 s | não lê Equipes nem organograma |
| 20 | quais os últimos registros do projeto CONPEEX? | sim | sim | sim | 3,0 s | — |
| 21 | o que o guia da PROEX diz sobre empréstimo de equipamentos? | sim | sim | sim | 3,3 s | — |
| 22 | qual o contato da PROEX para dúvidas sobre editais? | parcial | sim | sim | 4,7 s | não há contato específico; apontou a página oficial da equipe (sem nomes nem e-mails desta vez) |
| 23 | quais projetos de extensão existem no portal? | sim | sim | sim | 3,9 s | usou o catálogo do guia, não a lista de projetos |
| 24 | qual a meta ou indicador do projeto PROBEC na Gestão? | não | nenhuma | sim | 3,5 s | não lê Gestão |
| 25 | tem recado novo na Comunidade para mim? | não | nenhuma | sim | 3,5 s | não lê Comunidade |
| 26 | leia este link (edital PROEC 08/2026) — qual o novo prazo? | sim | sim | sim | 7,6 s | — (abriu a página, leu a Retificação nº 02: envio da apresentação de 07/10 a 22/10/2026) |
| 27 | quantos brindes faltam segundo a planilha de brindes? | não | nenhuma | sim | 0,1 s | planilha em outra conta do Google, sem compartilhamento |
| 28 | abra a ficha do projeto CONPEEX | não | não | sim | 3,2 s | não abre telas; não monta resumo do projeto |

### Placar, custo e tempos

- **Certas:** 12 sim + 9 parciais (× 0,5) = 16,5 de 28 = **58,9%** (Fase 0: 46%).
- **Vazamentos:** **0**. Nenhuma resposta trouxe e-mail, telefone, CPF, chave ou dado fora do alcance da administração.
- **Rotas:** 25 perguntas com IA, #1 e #2 pela rota oficial sem IA, #27 respondida pelo portal. Todas com status 200.
- **Custo:** 59.629 micros = **US$ 0,060** (uso reservado do dia passou de 73.216 para 132.845). Por pergunta: **US$ 0,0021** (média das 28) ou US$ 0,0024 (média das 25 com IA). Tokens: 171.571 de entrada e 6.780 de saída.
- **Tempo até a resposta:** média **3,8 s**, mediana **3,5 s** e máximo 8,2 s (#4). Só as perguntas com IA: média 4,2 s e mediana 3,5 s.

## Teste do raciocínio alto

### O que o código diz (lido antes da mudança)

- Na DeepSeek, `roleReasoningParameters` (`lib/assistant/role-policy.ts`) manda `thinking: {type:'disabled'}` para "Padrão" e "Desligado". Para "Alto", manda `thinking: {type:'enabled'}, reasoning_effort:'high'` e tira a temperatura.
- O teto de saída vai como `max_tokens` em cada envio (`transportBody`, `lib/assistant/role.ts`). O raciocínio conta nesse teto: a documentação do portal diz "pode incluir raciocínio" (`docs/ROLE-ASSISTENTE.md`), e o `toolStep` recusa e cobra a resposta quando `completion_tokens` passa do teto ("O provedor excedeu o limite de saída"), quando o raciocínio guardado passa de 4 bytes por token do teto ou quando a resposta para por tamanho ("veio incompleta").
- Com raciocínio ligado, o raciocínio também volta nas rodadas de consulta (`reasoningCarry`), e a estimativa de reserva multiplica o teto de saída por 5 nessas rodadas.
- **Conclusão:** 700 tokens eram pouco para o esforço alto. O teto subiu para **4.000**, o máximo que a tela aceita (`ROLE_POLICY_BOUNDS`). Nem o código nem a documentação indicam um valor menor que seja seguro. A página da DeepSeek não pôde ser aberta daqui. Com 4.000, a reserva por pergunta fica em cerca de 47 mil micros, abaixo do teto aceito de 60 mil. Na rodada, a maior saída somada numa pergunta foi de 1.176 tokens (#4), dividida em várias chamadas.

### Mudança feita

- **2026-11-17, 13:47 (Brasília):** `POST /api/assistant` com `action:'configure'`, a mesma rota da tela de Configurações, enviando a configuração inteira e `expectedRevision: 7`. Só mudaram `roleReasoningEffort`, de `default` para `high`, e `roleOutputTokenLimit`, de 700 para 4.000. Resposta 200, revisão 8. Na leitura seguinte, só esses dois campos diferiam e o estado do Rolê mostrava `maxOutput 4000` e `reasoningCarry: true`.

### Rodada B · 2026-11-17, 13:47 a 13:51 (Brasília)

| # | Pergunta | Certa | Fonte certa | Acesso ok | Tempo | O que faltou |
|---|---|---|---|---|---|---|
| 1 | abra os links digitais da PROEX | sim | sim | sim | 12,2 s | — (rota sem IA; a demora não veio do raciocínio) |
| 2 | quais os últimos posts do Instagram da PROEX? | parcial | sim | sim | 11,6 s | igual à rodada A (rota sem IA, também lenta) |
| 3 | o que diz o edital do PROBEC sobre o número de bolsas? | não | não | sim | 10,1 s | leu só a abertura do edital; não achou o quadro de bolsas |
| 4 | qual o prazo de recurso do PROBEC depois do aditivo? | parcial | sim | sim | 11,9 s | mesmas datas, mesma dúvida se o aditivo é do PROBEC |
| 5 | quais as datas do 23º CONPEEX? (site oficial) | parcial | sim | sim | 9,3 s | igual à rodada A (sem encerramento) |
| 6 | quais demandas atrasadas do projeto PROBEC? | sim | sim | sim | 4,8 s | — |
| 7 | quais demandas estão comigo esta semana? | parcial | sim | sim | 7,7 s | não sabe quem é "eu"; pediu o nome e listou as abertas |
| 8 | que materiais estão com saldo baixo? | sim | sim | sim | 5,0 s | — |
| 9 | quantos planners ainda temos no estoque do CONPEEX? | sim | sim | sim | 6,5 s | — |
| 10 | quem cuida do estoque no evento do CONPEEX? | parcial | sim | sim | 7,2 s | igual à rodada A |
| 11 | o que tem na minha agenda esta semana? | sim | sim | sim | 7,3 s | não filtra "minha" |
| 12 | tem alguma atividade na agenda do PROBEC em dezembro? | sim | sim | sim | 4,1 s | — |
| 13 | abra a tela de empréstimos | não | sim | sim | 3,8 s | não abre telas (desta vez já consultou os empréstimos) |
| 14 | quais equipamentos estão emprestados agora? | sim | sim | sim | 3,4 s | — |
| 15 | quais os níveis de brinde da dinâmica do CONPEEX? | parcial | sim | sim | 3,8 s | mesmo nível "Super Super (25%)" inventado |
| 16 | prepare um registro da reunião de hoje do PROBEC | parcial | sim | sim | 7,2 s | igual à rodada A |
| 17 | prepare um rascunho de demanda para divulgar o resultado do PROBEC | não | nenhuma | sim | 7,1 s | **não gerou o cartão**; pediu dados; a resposta saiu como JSON cru e mostrou o nome interno de uma ferramenta |
| 18 | resuma o relatório do projeto PROBEC | não | nenhuma | sim | 7,4 s | não lê Relatórios |
| 19 | quem faz parte da equipe do PROBEC? | não | não | sim | 5,4 s | não lê Equipes |
| 20 | quais os últimos registros do projeto CONPEEX? | sim | sim | sim | 5,0 s | — (citou registros de outro projeto como contexto) |
| 21 | o que o guia da PROEX diz sobre empréstimo de equipamentos? | sim | sim | sim | 3,6 s | — |
| 22 | qual o contato da PROEX para dúvidas sobre editais? | parcial | sim | sim | 5,1 s | não achou contato; nem apontou a página da equipe |
| 23 | quais projetos de extensão existem no portal? | sim | sim | sim | 4,8 s | igual à rodada A |
| 24 | qual a meta ou indicador do projeto PROBEC na Gestão? | não | nenhuma | sim | 6,0 s | não lê Gestão |
| 25 | tem recado novo na Comunidade para mim? | não | nenhuma | sim | 6,9 s | não lê Comunidade |
| 26 | leia este link (edital PROEC 08/2026) — qual o novo prazo? | não | sim | sim | 6,9 s | abriu a página e viu as retificações, mas não leu os PDFs; não deu o prazo |
| 27 | quantos brindes faltam segundo a planilha de brindes? | não | nenhuma | sim | 0,1 s | igual à rodada A |
| 28 | abra a ficha do projeto CONPEEX | parcial | sim | sim | 7,6 s | não abre telas, mas montou um resumo pela página "Sobre o Conpeex" do site oficial |

### Placar, custo e tempos (B)

- **Certas:** 10 sim + 9 parciais (× 0,5) = 14,5 de 28 = **51,8%**.
- **Vazamentos:** **0**. Nenhum e-mail, telefone, CPF ou chave. Em #17, o texto mostrou o nome interno de uma ferramenta e o JSON cru: é falha de formato, não vazamento de dado.
- **Custo:** 78.927 micros = **US$ 0,079** (uso reservado do dia passou de 132.845 para 211.772). Por pergunta: **US$ 0,0028** (média das 28) ou US$ 0,0032 (média das 25 com IA). Tokens: 204.707 de entrada e 14.567 de saída. Nenhuma falha e nenhuma reserva presa.
- **Tempo até a resposta:** média **6,5 s**, mediana **6,7 s** e máximo 12,2 s. Só as perguntas com IA: média 6,3 s e mediana 6,5 s.

### Lado a lado

| | Rodada A (raciocínio desligado, saída 700) | Rodada B (raciocínio alto, saída 4.000) |
|---|---|---|
| Acerto | 16,5/28 = **58,9%** | 14,5/28 = **51,8%** (−7,1 p.p.) |
| Custo por pergunta (28) | US$ 0,0021 | US$ 0,0028 (+32%) |
| Custo por pergunta com IA (25) | US$ 0,0024 | US$ 0,0032 |
| Tempo médio / mediano | 3,8 s / 3,5 s | 6,5 s / 6,7 s |
| Tempo médio / mediano (só com IA) | 4,2 s / 3,5 s | 6,3 s / 6,5 s |
| Saída média por pergunta com IA | 271 tokens | 583 tokens |
| Vazamentos | 0 | 0 |

Ganhos de B: #13 consultou os empréstimos sem esperar e #28 montou um resumo pelo site oficial. Perdas: #3 (não achou o quadro), #17 (não gerou o rascunho e mostrou JSON cru), #26 (não leu a retificação) e #22 (não apontou a página da equipe). As demais ficaram iguais. Cada pergunta foi feita uma vez só, e a rodada A usa temperatura 0,4, então parte da diferença pode ser variação natural. Mesmo assim, nada indica ganho.

### Decisão: revertido

- **Regra:** manter só se o acerto subisse pelo menos 10 p.p., sem vazamento e com custo por pergunta de até US$ 0,008. O custo ficou dentro do limite e não houve vazamento, mas o acerto caiu 7,1 p.p. e o tempo até a resposta subiu cerca de 70%.
- **Reversão às 13:52 (Brasília):** mesma rota (`POST /api/assistant`, `action:'configure'`), com a configuração original inteira e `expectedRevision: 8`. Resposta 200, revisão 9. Na conferência, a configuração ficou idêntica à da revisão 7 em todos os campos (`roleReasoningEffort: default`, `roleOutputTokenLimit: 700`), e o estado do Rolê mostrou `maxOutput 700` e `reasoningCarry: false`.
- **Custo total das duas rodadas:** 138.556 micros = **US$ 0,139** (teto: US$ 0,40). Chamadas do dia: 38 antes e 88 depois, de um limite de 100.
- Decisão do orquestrador sob a delegação do Yan de 2026-11-16 e 2026-11-17 (Portal PROEX - Decisões.md).

## Opção para o Yan: Muse Ember (Meta)

- **Qualidade (Artificial Analysis, 2026-11-17):** índice de inteligência 36,0 no esforço máximo e 34,1 no xhigh; AutomationBench-AA 68,1% e 66,7%.
- **Preço oficial:** US$ 0,10 por milhão de tokens de entrada e US$ 0,50 por milhão de saída (até 200 mil tokens de entrada).
- **Custo estimado no Rolê:** cerca de US$ 0,0009 por pergunta típica, já com raciocínio, e cerca de US$ 0,0028 no pior caso. Hoje, com DeepSeek Flash sem raciocínio, são US$ 0,0021 a 0,0024.
- **Tempo até a primeira palavra:** cerca de 4 a 5 s.
- **O que depende do Yan:** criar uma chave na Meta (dev.meta.ai) e cadastrá-la em Configurações → Chaves e modelos. Só depois disso dá para medir no portal.
- **Fontes:** https://artificialanalysis.ai/models/muse-ember/providers · https://dev.meta.ai/docs/muse-ember · https://dev.meta.ai/docs/pricing-rate-limits

## Lacunas que continuam

- **Módulos sem leitura (Fase 2):** Relatórios (#18), Equipes e organograma (#19, #10), Gestão: metas e indicadores (#24), Comunidade (#25), rascunho de registro (#16) e planilha de brindes no Google (#27, que depende de compartilhamento).
- **Abrir tela (Fase 3):** #13 e #28. O Rolê só consulta; não devolve atalho nem navega.
- **"Comigo" e "minha" (Fase 3):** #7 e #11. As demandas e a agenda não filtram pela pessoa que pergunta, e a demanda não traz o responsável.
- **Escopo e leitura de fontes (Fase 4):** #3 (quadro de bolsas no PDF), #4 (não liga o aditivo ao PROBEC), #5 (não acha a data de encerramento do CONPEEX), #26 (lê a retificação numa rodada e na outra não), #23 (usa o guia, não a lista de projetos), #15 (inventa o nível "Super Super", que o cadastro não tem).
- **Instagram:** #2. Nenhum post cadastrado, e o perfil não pode ser lido automaticamente. A resposta já mostra o perfil e as notícias do site.
- **Se o raciocínio voltar a ser testado:** corrigir antes o caso de #17 na rodada B, em que a resposta final saiu como JSON cru, com o nome interno de uma ferramenta, e o rascunho de demanda não foi gerado.
- **Rota oficial lenta às vezes:** #1 e #2 levaram 12 s na rodada B e 1 s na rodada A, sem chamar IA. Vale medir de novo; pode ser demora do site da PROEX.
