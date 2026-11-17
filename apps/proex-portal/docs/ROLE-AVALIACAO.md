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
