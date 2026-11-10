# Revisão geral do Portal PROEX · 09/11/2026

O Yan pediu: "uma análise geral, mais aprofundada, entendesse o funcionamento das coisas... tem alguma redundância", "a parte das planilhas... edição ao vivo... eu tenho um banco de dados, que daí ele meio que sincroniza, realmente eu não sei", "testes de perfil de um estudante bolsista para um projeto específico. Ou... um voluntário para uma ação específica lá do UFG nos parques" e "tensione isso... visão analítica e holística".

**Como foi feito:**
- leitura do código (mapa funcional e planilhas);
- matriz de permissões pela API, com cinco perfis;
- uso das telas no celular (375 px) e no computador (1366 px), num servidor local com dados inventados;
- nada foi gravado em produção.

Os termos seguem o [Glossário](GLOSSARIO.md).

## Resumo para o Yan

1. **O portal está seguro nos perfis testados.** Nenhum perfil leu ou mexeu em outro projeto. Convidado e voluntário não veem nome de quem pegou equipamento emprestado.
2. **As planilhas não são edição ao vivo.** O banco do portal é a única fonte da verdade, e as planilhas são cópias atualizadas a cada 10 a 30 min. Só alguns campos voltam da planilha para o portal (seção 3). Essas chamadas regravavam o banco inteiro a cada vez: cerca de 1.900 vezes por dia só com a mestre. **Isso foi corrigido nesta PR.**
3. **Há redundâncias:**
   - histórico em sete lugares;
   - exportação em dez;
   - o painel "Responsáveis e demandas" no topo de três módulos;
   - quatro formas de movimentar estoque;
   - dois assistentes de IA.

   As propostas de unir, cortar ou renomear estão na seção 1 e dependem da sua aprovação.
4. **O voluntário de uma ação ainda não tem um acesso feito para ele.** O menor alcance é o projeto inteiro. A tela inicial dele sugere a Agenda, que depois responde "seu acesso não permite consultar". Detalhes na seção 2.

## 1. Mapa funcional e redundâncias

### O que cada tela faz

| Tela | Para que serve | Quem usa | De onde vêm os dados |
|---|---|---|---|
| Início | Resumo pessoal, alertas, projetos, widgets | Todos | `/api/portal`, `/api/my-work/summary`, `/api/community/widgets` |
| Meu trabalho | Demandas e responsabilidades da própria pessoa | Todos | `/api/my-work` |
| Projetos e ficha do projeto | Cadastro, cronograma, materiais, dinâmicas, empréstimos, equipe, links, planilhas, relatório | Todos leem; edita quem gerencia | `/api/projects/[id]` e outras |
| Demandas | Tarefas com prazo, responsáveis, conferência, transferência, avisos por e-mail | Quem tem projeto; o convidado só lê | `/api/follow-up/*` |
| Equipes | Grupos de trabalho, planilha da equipe, organograma | Quem tem projeto | `/api/work-teams`, `/api/institutional-structure` |
| Agenda | Empréstimos, materiais, consumo e eventos de projeto | Aba visível a todos; cada categoria pede uma permissão | `/api/calendar` |
| Materiais | Catálogo, ficha (resumo, movimentar, histórico, fotos), kits, consumo | Quem tem permissão de estoque | `/api/portal`, `/api/materials/*` |
| Empréstimos | Reserva, retirada, devolução, patrimônio | Quem tem permissão de empréstimo | `/api/portal` |
| Dinâmicas | Operação presencial, roleta e dado, planejamento por turnos, níveis de brinde, retirada | Gestores, operadores e entregadores | `/api/portal`, `/api/campaign-planning`, `/api/prize-tiers` |
| `/events` | Página pública onde o público joga | Público | `/api/events` |
| Registros | Histórico (gráfico) e Documentos (com anexos) | Aba visível a todos | `/api/activity`, `/api/records` |
| Comunidade | Fale com a gestão, conversas, recados, ouvidoria anônima, selos | Quem tem projeto | `/api/community/*`, `/api/feedback` |
| Pessoas e acessos | Organizações, pré-cadastro, equipe publicada, convites, privacidade | Quem administra acessos | `/api/portal`, `/api/directory`, `/api/team/[id]` |
| Relatórios | Central de relatórios e exportação | Conforme o papel | `/api/reports`, `/api/export` |
| Configurações | Página das dinâmicas, cadastro público, planilha, Drive, backup, IA | Dono da plataforma | várias |
| Conta | Perfil, senha, MCP, Drive pessoal | Todos | `/api/profile`, `/api/account` |
| Assistente Rolê | Conversa que consulta e prepara operações para confirmar | Quem lê estoque | `/api/assistant/*` |

### Redundâncias e o que fazer (proposta, não aprovada)

| # | Onde se repete | Proposta |
|---|---|---|
| R1 | **Histórico em sete lugares:** Registros, ficha do material, demanda, versões e "linha do tempo" do projeto, pré-cadastro, consumo | **Unir** num componente só de linha do tempo, com filtro, e deixar nas fichas apenas um atalho. Renomear a "linha do tempo" do projeto para **Cronograma**, porque mostra datas futuras e não histórico. |
| R2 | **Seis ideias de "pessoas":** acesso, pré-cadastro, equipe publicada, equipe de trabalho, organograma, responsáveis | **Manter separado, mas renomear:** "Acessos" (quem entra) e "Equipes" (como dividimos o trabalho). Juntar pré-cadastro e equipe publicada num "Diretório". Levar o organograma para Pessoas ou Configurações. |
| R3 | **Exportação em cerca de dez lugares** | Manter os botões de cada tela, mas concentrar em Relatórios tudo que for baixar dados. **Cortar** "Indicadores das dinâmicas", que repete a central. |
| R4 | **Painel "Responsáveis e demandas"** no topo de Materiais, Empréstimos e Dinâmicas, além de fichas e cartões | **Cortar** o painel do topo dos módulos e manter nas fichas e em Meu trabalho. É boa parte do "espaço antes da lista" no celular. |
| R5 | **Quatro formas de movimentar estoque:** formulário da página, ficha do material, ficha do projeto e Rolê. Os campos têm nomes diferentes (`note` e `reason`). | **Unir:** "Registrar movimento" escolhe o material e abre a ficha. A ficha já tem corrigir, desfazer e anexos; o formulário da página não tem. |
| R6 | **"Assistente com revisão"** dentro de Materiais e o **Rolê** usam a mesma rota e o mesmo público | **Cortar** o "Assistente com revisão". Manter a importação assistida, renomeada para "Importar de arquivo". |
| R7 | **Dinâmicas × Agenda × eventos de projeto:** turnos e prazos de demanda não aparecem na Agenda | **Unir:** levar turnos e prazos para a Agenda. Usar "Evento" só para o projeto anfitrião (ex.: CONPEEX). |
| R8 | Configurações espalhadas: e-mails de aviso em Demandas, organizações em Pessoas | Levar os avisos por e-mail da organização para Configurações. |

O botão "Sugestão ou problema" e o feedback da Comunidade usam a mesma rota e a mesma tabela: **não é redundância**.

### Termos conflitantes ainda soltos

Foram acrescentados ao glossário nesta PR:
- **Unidade:** unidade acadêmica × unidade de controle (unidade, kit, pacote);
- **Reserva:** de empréstimo × de brinde;
- **Retirada:** de equipamento × de brinde;
- **Ação:** tabela sem tela × "ação" como dinâmica;
- **Destino**, **Pré-cadastro**, **Turno**;
- **Responsável:** responsabilidade × responsável de demanda;
- **Conferência:** três usos.

## 2. Testes por perfil

**Perfis:**

| Perfil | Papel | Projeto |
|---|---|---|
| Administração geral | dono | todos |
| Técnico | gestor | Rolê |
| Bolsista | estoque | Rolê |
| Voluntário | operador de evento | UFG nos Parques |
| Convidado | leitura | Rolê |

**Matriz pela API** (✓ permitido, ✗ recusado):

| Ação | Admin | Técnico | Bolsista | Voluntário | Convidado |
|---|---|---|---|---|---|
| Ver painel (projetos visíveis) | Rolê + Parques | Rolê | Rolê, sem empréstimos e dinâmicas | Parques | Rolê, empréstimos sem nome de quem pegou |
| Ficha do material, receber, distribuir | ✓ | ✓ | ✓ | ✗ | ✗ |
| Desfazer ou corrigir movimentação | ✓ | ✓ | ✓ | ✗ | ✗ |
| Criar empréstimo | ✓ | ✓ | ✗ | ✗ | ✗ |
| Criar demanda no próprio projeto | ✓ | ✓ | ✓ | ✓ (Parques) | ✗ |
| Criar demanda em outro projeto | — | ✗ | ✗ | ✗ | ✗ |
| Registro no próprio projeto | ✓ | ✓ | ✗ | ✗ | ✗ |
| Agenda | ✓ | ✓ | ✓ | **✗ (veja P2)** | ✓ |
| Relatório de empréstimos | ✓ | ✓ | 0 linhas | 0 linhas | ✓, sem nomes |
| Exportação | ✓ | ✓ | ✗ | ✗ | ✓ (sem registros identificáveis) |
| Assistente Rolê | ✓ | ✓ | ✓ | ✗ | ✗ |
| Comunidade e widgets | ✓ | ✓ | ✓ | ✓ | ✓ |
| Convidar pessoa | ✓ | ✓ (papéis abaixo dele) | ✗ | ✗ | ✗ |

**Telas:**
- Os 14 módulos abrem sem erro e sem rolagem lateral para bolsista, técnico e administração, no celular e no computador.
- O fluxo de material no celular funciona do começo ao fim: ficha → Histórico → Ver detalhes → Desfazer, com motivo. O saldo voltou e o registro ficou marcado como desfeito.
- Na mesma tela de detalhes há anexos (Tirar foto, Escolher foto ou PDF) e Corrigir.
- Trocar foto, empréstimo e devolução, e demanda foram testados na auditoria da manhã (`AUDITORIA-09NOV.md`).

### Achados

| ID | Prioridade | Achado | Dono |
|---|---|---|---|
| P1 | Alta | Cada chamada das planilhas regravava o banco inteiro no Supabase. São cerca de 45 chamadas por rodada da mestre (a cada 30 min) e 13 por planilha de projeto (a cada 10 min), perto de 1.900 regravações por dia por planilha. Isso disputa a vez com as gravações da equipe. | **Corrigido nesta PR**: a taxa das planilhas, que já exigem chave revogável, passou a ser contada na memória. |
| P2 | Média | **Voluntário (operador):** o Início sugere "Agenda" e mostra o cartão "Ver agenda", mas a Agenda diz "Seu acesso não permite consultar esta agenda". O voluntário precisa justamente ver os turnos da ação. | Navegação e Agenda (`local_770aa641`) |
| P3 | Média | **Não existe acesso por ação ou dinâmica:** o menor alcance é o projeto. Um voluntário do UFG nos Parques recebe "operador" no projeto inteiro: opera todas as dinâmicas dele e lê e edita todas as demandas. O acesso aceito também não expira. | Decisão do Yan. Ligado a convocações e presença (`local_648ff9a6`). |
| P4 | Média | **Planilha mestre:** quem pode editar o arquivo pode editar o script, que roda com a chave de administração. Na prática, quem edita a mestre age como administrador. | Registro e decisão. Recomendação: só a administração geral edita a mestre. Drive e planilhas (`local_ae377ae1`). |
| P5 | Média | **Conflitos da planilha** ficam registrados, mas não há botão para resolver. Só o cabeçalho é pintado de creme, não as células editáveis, e as colunas cinzas não estão protegidas. | Drive e planilhas (`local_ae377ae1`) |
| P6 | Baixa | Configurações, para o técnico, volta ao Início sem avisar por quê. | Navegação (`local_770aa641`) |
| P7 | Baixa | Agenda e Registros aparecem para todos, mesmo quando a pessoa não tem nada a ver neles. | Navegação (`local_770aa641`) |
| P8 | Baixa | O bolsista (estoque) pode abrir demanda, mas não pode criar registro no projeto. Não é falha de segurança, mas confunde: as duas coisas são "anotar algo do projeto". | Visual e Registros (`local_2aa044cd`), para decidir o texto ou a regra |
| P9 | Baixa | Não há saída de vários materiais de uma vez (achado U3 da manhã), exceto pela entrega de kit numa dinâmica. | Materiais (`local_648ff9a6`) |

## 3. Planilhas versus banco

**Em uma frase:** o banco do portal é a única fonte da verdade. As planilhas do Google são cópias atualizadas de tempos em tempos, e só alguns campos voltam da planilha para o portal, sempre passando pelas regras dele.

| Planilha | O que tem | Sentido | Quando | Conflito |
|---|---|---|---|---|
| **Mestre** (administração) | 35 abas, uma por tabela, mais Controle, Operações e Conflitos | Portal → planilha em tudo. Planilha → portal em 9 abas (tipos de projeto, projetos, links, agenda, editais, categorias, materiais, ações da roleta, unidades), no menu **Cadastrar material** e na aba Operações | A cada 30 min ou pelo menu "Sincronizar agora"; fotos e termos para o Drive a cada 1 h | A edição só entra se a linha não mudou no portal desde a última rodada. Se mudou, vai para a aba Conflitos e a célula volta ao valor oficial. |
| **Por projeto** | 8 abas "PROEX ·" (projeto, categorias, materiais, estoque, atividades, empréstimos, ações, agenda); Demandas é opcional | Chave de leitura: só portal → planilha. Chave de materiais: também cadastra material e registra movimento de estoque | A cada 10 min | Igual à mestre |
| **Por equipe** | 1 aba com as demandas da equipe | Só portal → planilha; cada linha tem link para editar no portal | A cada 10 min | Não se aplica |

**Só exportação (não sincroniza):** XLSX, PDF, DOCX e CSV baixados, "Salvar no Drive" e o backup diário criptografado.

### Recomendação de "edição ao vivo"

| Opção | Como funciona | Custo e limite | Já existe |
|---|---|---|---|
| **A. Banco mestre + espelho só de leitura por área + edição sempre no portal** | Cada área ou equipe tem sua planilha atualizada; para mudar, o link da linha abre o portal | Custo mais baixo e sem conflito. Ninguém edita na planilha. | Planilha de equipe e planilha de projeto com chave de leitura |
| **B. Edição em células controladas** | Algumas colunas voltam para o portal, com fila, recibo e aba de Conflitos | Custo médio. Demora de 10 a 30 min e o conflito é resolvido à mão. | Mestre e planilha de projeto com chave de materiais |
| C. Sincronização total, editando qualquer célula | — | Custo alto. O Google não trava a planilha enquanto o script grava, e saldo e permissão não podem vir da planilha. **Não recomendado.** | — |

**Sugestão:**
- Usar **A como padrão**, com um espelho por área ou equipe.
- Usar **B só onde a planilha ajuda de verdade**, como o cadastro de materiais por projeto, depois de três melhorias:
  1. pintar e proteger as células;
  2. criar um botão "resolver conflito" no portal;
  3. limitar quem edita a mestre.

A correção P1 desta PR tira o principal custo de multiplicar planilhas. Antes dela, cada planilha nova somava cerca de 1.900 regravações do banco por dia.

**Limites a vigiar:**
- cota do Google: cerca de 90 min por dia de gatilhos numa conta comum, um número a conferir na conta usada;
- execução de no máximo 6 min por vez;
- teto de 5.000 linhas ou 8 MB por tabela no conector.

## O que foi corrigido nesta PR

- **P1:** `memoryRateLimit` em `lib/rate-limit.ts`, usado pelos conectores das planilhas mestre, de projeto e de equipe. O teste em `tests/traffic-cost.test.mjs` prova que a chamada não grava linha de limite e que o teto continua valendo. Ele falha sem a correção.
- **Glossário:** termos conflitantes acrescentados.

## Não verificado

- Produção com outros perfis. Só a conta do Yan existe lá, e o uso foi apenas leitura.
- Se o "UFG nos Parques" existe como projeto em produção.
- Cotas reais do Google na conta conectada e o tamanho atual do banco no Supabase.
- Celular físico e leitor de tela.
