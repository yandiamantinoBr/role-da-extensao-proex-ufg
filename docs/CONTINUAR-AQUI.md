# Continuar Portal PROEX

## R3 · Exportar concentrado em Relatórios · em ramo, sem merge antes de 14/11 · 2026-11-11

Branch `claude/r3-exportar-em-relatorios` (Claude Code), PR em **rascunho**. Decisão do Yan de 10/11 ("Sim, seguir todas"), item R3 da consolidação. Detalhes e a lista do que fica onde: `apps/proex-portal/docs/EXPORTACOES.md`.

- Relatórios passa a mostrar **Dinâmicas por dia** no lugar do bloco repetido de indicadores e ganha a coluna **Equipes** em Demandas. A correção de 14/11 mantém os downloads nas telas de Equipes e Registros até existir o mesmo recorte em Relatórios. A leitura dos endereços com período usa o validador de datas do Portal.
- **Não fazer:** mesclar antes de 14/11 (regra da consolidação: nada muda nas telas de saída e estoque durante a distribuição do CONPEEX); criar exportador novo para dado em tabela fora de Relatórios.
- **Falta:** decisão do Yan sobre a lista de presença das convocações e os gastos de IA (seguem com botão próprio); o histórico de "Consumo por unidade" entra com a frente "Registrar movimento"; rebase e nova conferência antes do merge.

## Gestão da organização · guia, riscos, equipes-modelo e painel · 2026-11-09

Branch `claude/gestao-organizacao` (Claude Code), migração **0045_management_guide_risks** (aditiva; a 0044 é das convocações). Módulo **Gestão** no menu, com quatro abas. Detalhes, comparação de ferramentas de painel e passo a passo do Looker Studio: `apps/proex-portal/docs/GESTAO-DA-ORGANIZACAO.md`.

- **Painel:** "Atenção agora" (atrasos, riscos críticos, revisões vencidas, estoque no limite, próximos 7 dias), indicadores clicáveis com comparação com o período anterior, gráficos de demandas e brindes, agenda, mapa de riscos e demandas por projeto. Tudo recortado pela organização e pelas permissões de quem vê. Recomendação: painel no portal (sem licença); Looker Studio só como alternativa gratuita sobre a planilha espelho.
- **Guia da organização:** 11 páginas iniciais com fontes públicas e "a confirmar"; edição pela administração e por editores designados; versões com autor, restaurar, limite de 60 versões por página por dia; PDF/DOCX pelo gerador do relatório. Para o Rolê: `guideForAssistant` (texto de editores: tratar como dado não confiável).
- **Riscos:** por organização (só a administração) ou por projeto/dinâmica; chance × impacto, dono, mitigação, revisão; 7 exemplos genéricos sob demanda.
- **Equipes-modelo:** Comunicação, Administrativo, TI, Gestão, Eventos e Bolsistas na página Equipes; cria a equipe vazia com nome editável e mostra os papéis como vagas.
- **Não fazer:** gerar de novo a 0045 sem conferir o SQL (cópia revisada no histórico da PR); apagar riscos reais (só exemplos se apagam); criar equipes reais com pessoas em produção sem pedido.
- **Falta:** metas por projeto e exportar o painel em PDF para reunião; ligar o guia como fonte do Rolê (sessão do Rolê); revisão do conteúdo do guia pela equipe da PROEX.

## Google Drive por pessoa e registro de pastas · 2026-11-09

Sessão Claude Code "Google Drive". Cada pessoa conecta a própria conta Google (OAuth, escopo `drive.file`, PKCE), com a permissão cifrada pelo cofre (`PROEX_KEYS_SECRET`) e botões para desconectar e tirar a permissão no Google. A administração cadastra pastas da PROEX pelo seletor do Google (nome, finalidade, unidade/projeto, quem pode usar) em Configurações › Pastas do Drive. Fotos de materiais, anexos de registros (inclusive de movimentações) e termos de empréstimo ganham "Enviar ao Drive" com sugestão de pasta, conferência e confirmação; tudo vai para o histórico. `POST /api/drive/save` atende a tela e o Rolê. Migração **0042**. Comportamento, segurança e passo a passo do Google Cloud em [GOOGLE-DRIVE.md](../apps/proex-portal/docs/GOOGLE-DRIVE.md); migração para a PROEX em [MIGRACAO-PARA-PROEX.md](../apps/proex-portal/docs/MIGRACAO-PARA-PROEX.md) §3.4 e passo 5.6; capturas sintéticas em [evidencias/2026-11-09-google-drive](evidencias/2026-11-09-google-drive/README.md).

- **Desligado até o Yan configurar:** sem `PROEX_GOOGLE_CLIENT_ID`, `PROEX_GOOGLE_CLIENT_SECRET`, `PROEX_GOOGLE_PICKER_API_KEY` e `PROEX_GOOGLE_CLOUD_PROJECT_NUMBER` na Vercel, a tela mostra "Ainda não disponível". O agente não criou cliente OAuth nem aceitou termos.
- **Ressalva do escopo:** a documentação atual do Google não diz com todas as letras que escolher uma pasta no seletor libera criar arquivos dentro dela (o blog oficial diz). O teste de aceite (GOOGLE-DRIVE.md §6, passo 3) confirma. Se falhar, a alternativa exige escopo restrito e o OK do Yan.
- **Não fazer:** gerar de novo a 0042 sem conferir; dar o `planToken` ao modelo do Rolê (o `apply` só vem do clique da pessoa); tratar erro de configuração como revogação.
- **Falta:** configuração do Yan no Google Cloud e o teste de aceite real; o Rolê ligar o cartão (sessão do Rolê, depois do merge); seta igual nos grupos de Configurações (padrão geral).
## Relatório do projeto completo e customizável · PR68 · 2026-11-09

Branch `claude/relatorio-projeto-v2` (Claude Code). Em Projetos → projeto → Relatório do projeto: montador com seções marcáveis e reordenáveis, período, observação por seção, referências escolhidas, linha do tempo Marcos/Tudo e modelos salvos por projeto (migração **0041**, aditiva). PDF, DOCX e XLSX saem iguais à prévia (capa, sumário, numeração, referências no fim). Quem vê o projeto vê o relatório, só com o que pode ver. A ficha do projeto não desmonta mais a cada atualização automática. 1.458 testes, tipos, lint, `build` e `build:node`. [Uso e limites](../apps/proex-portal/docs/RELATORIO-DO-PROJETO.md). Confirmar merge e deploy no recibo da PR antes de tratar como produção (a PR67 da Comunidade entrou antes com a 0040).

## Comunidade · fases 1 e 2 · 2026-11-09

Módulo **Comunidade** (sessão Claude Code "comunidade"). Fase 1 publicada pela PR [51](https://github.com/yandiamantinoBr/role-da-extensao-proex-ufg/pull/51) (merge `5ee5a42`, migração 0036): widgets pessoais no Início (desligados por padrão), "Fale com a gestão" (sugestão, problema, elogio por plataforma, projeto ou evento, com resposta da gestão) e ouvidoria anônima com código de acompanhamento. Fase 2 publicada pela PR [56](https://github.com/yandiamantinoBr/role-da-extensao-proex-ufg/pull/56) (merge `4e446cc`, migração 0037): recados entre pessoas e selos com arte provisória. Comportamento, limites honestos do anonimato e testes em [COMUNIDADE.md](../apps/proex-portal/docs/COMUNIDADE.md); evidências sintéticas em [evidencias/2026-11-09-comunidade](evidencias/2026-11-09-comunidade/README.md); especificação e perguntas ao Yan na Vault (`Portal PROEX - Comunidade (especificação)`).

- **Não fazer:** gerar de novo 0036 com o Drizzle (o SQL é escrito à mão e recria `portal_feedback`); trocar o atributo `aria-keyshortcuts="Alt+R"` do botão do Rolê sem atualizar `floating-dock.module.css` (a doca sobe acima dele enquanto o Rolê desenha o próprio botão); gravar autoria, hora ou contador por pessoa na ouvidoria.
- **Fase 3** na PR [67](https://github.com/yandiamantinoBr/role-da-extensao-proex-ufg/pull/67) (migração 0040): conversas por projeto e diretas com fotos (opção A de armazenamento, atrás de `MediaStore`; 180 dias), painel de espaço do banco, aviso de recado por e-mail (fila `cm-…`; **exige atualizar o script de avisos na conta Google**) e designações de quem lê a ouvidoria (resposta do Yan de 09/11).
- **Doca flutuante de widgets** (branch `claude/widget-doca`, migração **0043**, aditiva): botão "Widgets" no canto de todas as páginas, com Anotações, Lembretes, Calendário, Minhas demandas e Atalhos; tudo desligado por padrão, ligado em "Meu espaço"; painel minimiza e fecha (X, Esc); estado por pessoa no servidor; cada widget só carrega ao abrir. "Resumo do contexto" foi cortado (repete o painel de contexto do projeto). O Rolê entra na doca pelo hook `useDockItem` de `components/portal/floating-dock.tsx` (sessão do Rolê liga depois do merge). Detalhes em [COMUNIDADE.md](../apps/proex-portal/docs/COMUNIDADE.md).
- **Falta:** atualizar o script de avisos no Apps Script do Yan, recados e conversas no sino, arte definitiva dos selos (comunicação). A limpeza dos 180 dias agora roda na rotina diária de `/api/health` (2026-11-11).

## Exportação, Agenda, fotos e Configurações · 2026-11-09

Branch `claude/mystifying-sanderson-7b4c51` (Claude Code). Agenda não rola mais a página ao abrir/fechar um dia (causa: `scrollIntoView` na coluna sticky); miniatura da foto principal na lista de materiais (só `inventory.read`); componente comum de exportação (planilha verde, documento azul, PDF vermelho) e `/api/export` com DOCX/PDF no servidor; Configurações agrupadas por tarefa, central de chaves só reposicionada. 1375/1375 testes, tipos, lint, `build`, `build:node`. [Entrega, provas e limites](ENTREGA-09NOV-EXPORTACAO-AGENDA-FOTOS-CONFIG.md). Confirmar merge e deploy no recibo da PR antes de tratar como produção.

## Acabamento visual e coerência · PR42 · 2026-11-09

Branch `claude/visual-coerencia-09nov` (Claude Code), PR [42](https://github.com/yandiamantinoBr/role-da-extensao-proex-ufg/pull/42), atualizada com a `main` da PR41 (níveis de brinde e foto) sem desfazer aquele trabalho. Só apresentação: tipografia própria do portal (DM Sans + Sora), filtros "Projeto + funil", Materiais/Dinâmicas/Demandas compactos no celular, Panorama clicável no Início e em Materiais, barra inferior com os módulos do evento. 1.339/1.339 testes, tipos, lint, `build` e `build:node`. Crítica independente final 9,0/10 sem P0/P1. [Entrega, pendências e perguntas](ENTREGA-09NOV-VISUAL-E-COERENCIA.md). Confirmar merge e deploy no recibo da entrega antes de tratar como produção.

## Rolê e central de chaves · 2026-11-09

**Branch `claude/role-assistente-chaves-a34257`** (sessão Claude Code "Rolê e chaves"). Entrega: assistente **Rolê** com botão flutuante (Alt + R), texto, foto (DeepSeek Flash) e áudio transcrito (Groq/Deepgram); custo máximo mostrado antes de toda chamada paga; operações pelo fluxo assinado `prepare`/`apply` com prévia e confirmação. Central de chaves com Testar grátis, preços oficiais, recomendados, histórico com dica mascarada e textos simples. Detalhes, tabela de provedores e fontes em [ROLE-ASSISTENTE.md](../apps/proex-portal/docs/ROLE-ASSISTENTE.md); capturas sintéticas em [evidencias/2026-11-09-role-chaves](evidencias/2026-11-09-role-chaves/README.md).

- **Segredo:** `PROEX_KEYS_SECRET` criado na Vercel (produção, sensível) em 09/11/2026, gerado localmente e sem exibição. Testes de recifragem retomável, rotação e recuperação passaram antes. O valor não está registrado em lugar nenhum. Se for perdido, as chaves cifradas ficam ilegíveis e a central oferece "recriar o cofre": basta colar as chaves de novo.
- **Configuração nova** (sem migração): `roleEnabled`, `roleProvider`, `roleVisionEnabled`. **Não reverter o deploy para um SHA anterior** depois que alguém salvar "Funções e acesso": versões antigas recusam o JSON novo.
- **Testes:** 1.334 do portal localmente, incluindo `tests/role-assistant.test.mjs` com o LEAK GUARD. Corrigida a bomba de data em `my-work-markdown.test.mjs`, que falhava em 09/11/2026.
- **Revisões:** segurança sem P0/P1, com os P2 corrigidos. A nota da crítica de design está registrada na PR.
- **Falta:** o Yan colar as chaves reais (DeepSeek e Groq; TypeSafe opcional), testar na central e ligar o Rolê. O primeiro uso real de cada provedor fica no histórico. Não houve chamada real a provedor nesta rodada.

## PR39 publicada sobre a PR38 · edição, estoque e eventos · 2026-11-06

**Base publicada pela PR38 em 078c6aba20126956d744ac1787b9b097c106e1e8.** Vercel `dpl_Ff1LUdNVGWKPY9bb3BMpnwj7Uwxn` READY e domínio oficial vinculados ao SHA. A composição reúne edição contextual, origem/destino/SEI (0032), diretório privado (0033), avisos persistentes (0034), `/events`, marcas e datas brasileiras. [Entrega e recibo](ENTREGA-06NOV-EDICAO-ESTOQUE-E-EVENTOS.md), [brief](RODADA-06NOV-EDICAO-E-RASTREIO.md), [revisão independente](REVISAO-06NOV-SEGURANCA.md). CI42299838784 aprovou **1.310 testes do Portal + 33 do jogo**, tipos, Worker/Node e smoke. Parecer visual independente **9,1/10 no escopo**, 52 imagens sintéticas. Saúde200; APIs novas401/private,no-store; `/events`200. Chrome autenticado confirmou a nova ficha e o redirecionamento do rascunho; o índice público foi visto no celular nos dois temas.

**Acabamento PR39 publicado — produção atual:** PR [39](https://github.com/yandiamantinoBr/role-da-extensao-proex-ufg/pull/39) MERGED em `c972f8ec1d0ca3e8ea43e56ac0ad5f54e18a70de`, head testado `12e9c2593412a0516a553eb6780f2edeacd7e37a`. CI [42301818366](https://github.com/yandiamantinoBr/role-da-extensao-proex-ufg/actions/runs/42301818366) aprovado: **1.323 testes do Portal + 33 do jogo**. Vercel `dpl_5wcAVHtaoXtkq7b9px6sMGvAdLbq` READY e alias oficial vinculados ao SHA de merge `c972f8e`. Os dois últimos relógios nativos de sessões passam a texto de 24 horas: normalizam `1330` para `13:30`, validam antes de gravar e preservam o rascunho. 40 testes focais e QA descartável aprovados; quatro capturas sem erro de página. Chrome confirmou a versão `c972f8e` / 2026.11.06 e releu no DOM o cronograma persistido, com horários em HH:mm nas sessões provisórias e canceladas preservadas. A campanha permanece em rascunho, sem ativação ou alteração de estoque. Fontes, horários e recibos operacionais ficam no registro privado.

**Limites que permanecem:** a planilha manual não é bidirecional; um feed válido não comprova sua coleta pelo Google; o terceiro nível de prêmio continua apenas hipótese de planejamento.

**Operação real separada:** a consulta inicial à programação pública resultou em quatro janelas na Agenda. O cronograma da equipe recebido depois trouxe restrições e turnos específicos, incorporados sem apagar os registros anteriores. A Agenda agora distingue exposição sem brindes, turnos principais e reservas condicionais. Fontes, pessoas, horários e recibos reais ficam na Vault e no arquivo institucional; nenhuma campanha foi ativada.

**Contagem e planejamento:** o DOCX fornecido é um cronograma, sem quantidade de materiais ou metadado de contagem. A fotografia informa quantidade aproximada por pacote. A autorização para substituir saldos não deve converter aproximação em contagem exata nem apagar entidades gerais do Portal. Foram preservadas as abas em uso e acrescentadas abas de planejamento e conferência ao mesmo arquivo institucional, com fontes e hipóteses separadas. O terceiro nível de prêmio continua simulação, não ativação do jogo. Saldos permanecem preservados até conciliação comprovada.

**Continuidade técnica:** snapshots e journal estão em ordem até 0034, com SQL complementar preservado. Não gerar novamente uma migração customizada sem cópia e conferência. Não reconstruir `dist` enquanto o servidor de QA estiver rodando. As projeções da mestre não incluem automaticamente as novas tabelas. Validar CI antes do merge e conferir o fluxo autenticado após o deploy. Pendências de Sheets, cofre e coleta pelo Google permanecem separadas.


## Histórico · PR37 publicada e migração conferida · 2026-11-05

Produção funcional **5ad7025d58a7d3351edc301377c72079ed0cb961**, Vercel **dpl_FnF94q2dLgVWgLgVyo1993UUcawo READY**, alias oficial e Chrome autenticado conferidos. Head funcional testado **dc5796e**: **1.237/1.237**, tipos, lint sem erros (dois avisos antigos), Worker/Node e smoke; CI42094055194 aprovado. Saúde200; APIs novas com consulta válida sem sessão401/no-store. [Entrega](ENTREGA-05NOV-ROLE-CONPEEX.md), [aceite independente9/10 no escopo](REVISAO-05NOV-ROLE-CONPEEX-DESIGN-ACEITE.md), [recibos e imagens sintéticas](evidencias/2026-11-05-role-conpeex/README.md).

**Operação real concluída:** nove demandas saíram do contexto CONPEEX para Rolê, mantendo ID, campos, atribuições e histórico original, com recibo de transferência. Mesmo arquivo/aba/linhas de contagem preservados. Dinâmica do Rolê em rascunho, CONPEEX anfitrião,15propostas sem horários e sexta condicional; persistência confirmada após recarregar. Não ativar jogo nem inventar quantidades. A mestre foi atualizada pelo menu instalado e relida:35tabelas/completed em19:45:23.914Z; nove demandas emRolê/versão2 e campanha draft. Recibos reais/IDs somente na Vault.

**Pendências reais:** integração bidirecional do arquivo de contagem (continua manual, não é a mestre); confirmar agenda/rodadas e sexta; canais Sheets por projeto/equipe e custódia; cofre/recuperação bloqueados pela política da ferramenta, Calendar/IA/MCP reais e P3 cosméticos. [Fontes e operação do CONPEEX](CONPEEX-2026-OPERACAO-E-FONTES.md). Não atribuir esta entrega à conclusão de todos os pedidos. Os checkpoints abaixo são históricos.

## Histórico · PR36 publicada · 2026-11-05

Produção funcional **b94814c227b2eabf8eeaf27ffdadac1d0601b20e**, Vercel **dpl_B7zEtBnpmBczYYRfpXtyg3j8vCE7 READY**, alias oficial conferido. CI42077711627: **1.196/1.196**, tipos, Worker/Node, autenticação/MCP e legado aprovados. Chrome autenticado confirmou o resumo, navegação à lista, estrutura/prévia descartada, marca e projeto móvel, rodapé e abertura das abas. Saúde200, privadas401/no-store, aposentados403. [Recibo completo](ENTREGA-05NOV-RESUMO-E-ESTRUTURA.md#publicação-e-aceite--2026-11-05).

Resumo pessoal, organograma/equipes, integridade de vínculos e PDFs refinados receberam nota9 **no escopo sintético avaliado**, semP0/P1/P2; [parecer final](REVISAO-INDEPENDENTE-05NOV-DESIGN-FINAL.md), [evidências](evidencias/2026-11-05-resumo-estrutura/README.md). Histórico negativo preservado. **Não reaplicar PR36 nem misturar os checkpoints antigos abaixo com o estado atual.** Fontes dos agentes/worktrees preservadas; não descartar trabalho não integrado.

Próximos aceites: Sheets por projeto/equipe e custódia institucional; cofre dedicado/recuperação externa bloqueados pela política da ferramenta, sem segredo novo; Calendar com feed válido mas coleta Google ainda não comprovada; IA real e MCP; refinamentos P3 dos pareceres. Chrome foi recuperado por aba própria. O recibo de download em produção falhou na ferramenta; não confundir com os arquivos reais conferidos localmente ou afirmar que o arquivo salvo em produção foi reaberto. Todos os pedidos anteriores continuam em REQUISITOS-E-CONTINUIDADE e na Vault.

## Histórico · PR35 (substituído pelo checkpoint da PR36)

Produção funcional: **4992afac14151ac66ae3be5b4e7139c8071e21ad**, PR #35. Vercel **dpl_Azn3XQoa3LsUQS8FsdwPZxinmGaP READY**, alias oficial conferido. CI42049279531: **1.135 testes**, tipos, lint, builds Worker/Node e smoke de autenticação aprovados. Saúde200, APIs privadas401/no-store e versões aposentadas403. Script de equipe publicado idêntico ao Git. [Recibo e limites](ENTREGA-05NOV-PROVEDORES-E-RELATORIOS.md#publicação-comprovada-em-2026-11-05).

Chrome restaurado, mas extensão sem debugger e captura nativa divergente da janela pedida; não continuar cliques com geometria incerta. A conferência visual autenticada da PR35 não foi concluída. O cofre ainda depende do segredo dedicado: provisionamento rejeitado antes de executar, sem contorno nem redução das proteções do Bitwarden.

A próxima composição está na [PR #36, rascunho](https://github.com/yandiamantinoBr/role-da-extensao-proex-ufg/pull/36), branch `codex/proex-resumo-e-estrutura-05nov`: organograma formal0029, estrutura/equipes com permissões separadas, exportações e resumo pessoal do Início com totais privados. Não foi publicada. [Registro, gates e próximos aceites](ENTREGA-05NOV-RESUMO-E-ESTRUTURA.md). Ler o registro antes de continuar; a interrupção dos subagentes por limite de uso não constitui aceite de revisão. Os checkpoints antigos abaixo permanecem históricos.


## Publicação confirmada e próxima composição · 05/11/2026

PR #33 publicada: merge `c8182d2e4b34f99033b861daa8064e12f1e2d937`, Vercel `dpl_7vA9LLPkEtiJoewFzEThQAfiKqFy` READY. CI `42030415419`: 1003 testes do Portal, tipos, builds Worker/Node e autenticação aprovados. Chrome autenticado confirmou versão no rodapé, cartão do CONPEEX abrindo a ficha, calendário em português no mês atual e campo `05/11/2026`, além do feedback com versão. Nenhuma demanda/aviso de QA foi criada em produção.

PR #34 publicada em `bd36d084ce475c6f43fc765b2f36ebded6594193`, Vercel `dpl_HfBiVwe913M2kuWawJc2jNjc1y3o` READY, domínio canônico conferido. CI final42037080311 aprovado, funcional1072/1072 e builds. Saúde200, raiz exige login, novas APIs privadas401/no-store, aposentados403. Chrome indisponível (`Debugger unattached`); inspeção visual autenticada pós-deploy ainda não realizada. [Evidências e limites](ENTREGA-05NOV-IA-E-EQUIPES.md).

`PROEX_KEYS_SECRET` continua ausente: a revisão automática bloqueou o provisionamento antes da execução; não contornar a rejeição ou apresentar o cofre como pronto. Usuário informou Bitwarden desbloqueado, CLI continuou bloqueada; abertura do aplicativo pela ferramenta também foi impedida. Nenhum segredo foi lido ou criado nessas tentativas.

PR35 em rascunho: `codex/proex-provedores-e-relatorios-05nov`, com OpenAI0027, Meu trabalho em PDF/DOCX/XLSX e Markdown opcional, Sheets de equipe/projeto0028 e correções dos avisos/PDF. A composiçãof8c253f passou1129/1129, tipos, lint e CI42043696074; MD entrou depois em e2c9f6c com43focais aprovados e build Worker/Node/smoke de autenticação aprovados. Snapshot0028 reconciliado,101 tabelas. O ajuste posterior59b7360 expande avisos e retira botões ocultos do foco; recompilação e recaptura integradas em andamento. [Entrega e limites](ENTREGA-05NOV-PROVEDORES-E-RELATORIOS.md). Ainda não atribuir PR35 à produção sem recibo de merge/deploy.

Frente seguinte iniciada em worktree isolada: estrutura institucional formal dentro de Equipes, migração0029 reservada, sem snapshot/journal pelo agente. Não altera unidades globais nem concede ACL por equipe/nó. Modelo oficial deve ser prévia editável, sem inventar pessoas ou criar dados reais como efeito da migração. Pesquisa e IDs privados ficam na Vault.

## Primeira entrega da rodada · 05/11/2026

PR #33, branch `codex/proex-evolucao-05nov`: filtros/datas brasileiras, favoritos/gráfico de projetos, origem da demanda, planilha exclusiva por projeto, versão/feedback e PDF/DOCX/XLSX em Registros e Resumo diário. [Resultado, testes e limites](ENTREGA-05NOV-UX-E-SHEETS.md) e [fila completa](RODADA-05NOV-UX-E-PLANILHAS.md). Não confundir esta branch com produção antes do recibo de merge/deploy.

Agentes mantêm frentes separadas de MCP pessoal (0024), Groq no cofre (0025) e checklist de atividade (0026). Integrar e gerar snapshots em ordem após os respectivos testes. Não ler segredos, usar dados reais em QA ou iniciar chamadas pagas. A instalação do script por projeto é uma etapa própria no Google; preservar script/gatilhos da mestre.


## Voltar e Avançar entre os módulos · 04/11/2026

Cada troca de módulo preserva uma etapa no histórico do navegador. Mudanças nos filtros de contexto atualizam a etapa atual. A volta a um endereço antigo respeita os acessos atuais e os rascunhos automáticos guardam a digitação feita imediatamente antes da saída. [Reprodução e testes](NAVEGACAO-PORTAL.md).

## Cadastro de materiais no Sheets e revisão dos módulos · 04/11/2026

- **Uso:** na planilha mestre, abra **PROEX → Cadastrar material**. O registro entra no Portal com saldo zero e a próxima sincronização traz a linha para **Materiais**. Use as células em creme para editar. [Operação, cuidados e teste nos dois sentidos](../apps/proex-portal/docs/SINCRONIZACAO.md#atalhos-de-materiais-e-permissões-do-drive).
- **Verificação:** publicação na Vercel, instalação do `.gs` vinculado e execução do gatilho são marcos independentes. Rode `node scripts/qa-local.mjs --sync-smoke` em `apps/proex-portal` depois de construir a aplicação para testar o fluxo com base descartável; não use materiais de teste na mestre.
- **Interface:** [auditoria dos 13 módulos e da Agenda](QA-AGENDA-E-MODULOS.md). Próximos recortes: catálogo de Materiais em telas estreitas, navegação Voltar entre módulos e testes mais profundos por papel e com leitor de tela.

## Histórico · V23 e V24 publicadas

PR #26 integrou `bed5b69496f22f6ba18a89dce98c05938a4d989e` e ficou READY na Vercel. O CI aprovou 922 testes do portal e 33 do jogo. [Entrega V23/V24](ENTREGA-V23-V24.md) reúne o caminho para cadastrar chaves, as evidências do cofre e a classificação das demandas. O segredo dedicado está pendente no ambiente. O JEV em produção depende de ativação própria. [Login Google](V25-LOGIN-GOOGLE.md) registra os testes exigidos antes do piloto.

As PRs #24 e #25 corrigiram os cartões de projetos no Início, a escolha da atualização de empréstimo, a lista de ocultadas e os marcos da Agenda no relatório. [Revisão de fluxos](ENTREGA-V22.md#revisão-de-fluxos-após-a-v22--04112026)

A [revisão de interação](REVISAO-DE-INTERACAO-MOVEL.md) registra o caso de rolagem da PR #27 e os critérios de teste para gestos, foco, mudanças de recorte e exportação.

O [acabamento de Demandas e exportações](ACABAMENTO-DEMANDAS-E-EXPORTACOES.md) detalha o fluxo de edição móvel, a troca dos downloads CSV por XLSX e o acesso a planilhas vinculadas, além da alternativa de teclado para os gráficos.

Os [atalhos para abas do Google Sheets](../apps/proex-portal/docs/SINCRONIZACAO.md#atalhos-de-materiais-e-permissões-do-drive) usam a planilha mestre já conectada e separam a base sincronizada do recorte baixado em XLSX. O teste de edição manual usa `qa-local.mjs --sync-smoke` com dados descartáveis.

## Histórico · V22 publicada

Em 04/11/2026, PR #23 integrada em `51fedadfdc27ab7f05059ad6276b871d64f0e15e`, Vercel `dpl_2ei6jUVH2CgbRbVwvAdG9cXcuWiS` READY. CI 899 portal + 33 jogo. Ficha do CONPEEX baixada e renderizada em produção. Avisos e Pendentes têm ações pessoais e feedback de concorrência. A migração 0019 mantém 35 projeções Sheets. O GitHub remoto voltou a ter somente `main`. [Entrega V22](ENTREGA-V22.md).

Para continuar, comece pelos aceites V23–V25 no fim da seção de continuidade da V22. Preserve as decisões e a fila de integrações da Vault. As próximas entregas têm validações próprias de custo, acesso, identidade e operação.

## Histórico · V21 publicada

Em 04/11/2026, a PR #22 integrou `dcac2edfd633e599c538ad8a929b50bc002b39fa`, READY na Vercel. CI com 884 testes do portal e 33 do jogo. Comunicação por projeto, gráficos de Demandas e exportação direta foram conferidos no CONPEEX em produção. Groq está disponível como opção de configuração para um piloto, testado por simulação. [Entrega V21](ENTREGA-V21.md).

## Histórico · V20 publicada

Em 04/11/2026, a PR #21 integrou a V20 em `e4b528c`, READY na Vercel. A marca mobile volta ao Início, o resumo prioriza o recorte selecionado e Meu trabalho exporta as páginas exibidas em Markdown. Foram verificadas nove demandas do CONPEEX em produção e o link da planilha de contagem e lotes no Drive institucional Equipe PROEC. [Entrega V20](ENTREGA-V20.md).

A verificação a 375 e 1250 px foi feita depois na bancada local V21. [Entrega V21](ENTREGA-V21.md).

## Histórico · V19 publicada

Em 04/11/2026, a PR #20 integrou a V19 em `bf662b4d271e65ca3c50cde2ebcbe09b7170a758`, READY na Vercel. O CI aprovou 871 testes do portal e 33 do jogo. A atividade oficial do 23º CONPEEX aparece de 9 a 13 de novembro na Agenda, como dia inteiro. A V18 corrigiu a seleção repetida da mesma demanda, conferida em produção ao reabrir o cartão pela demanda do piloto. [Entrega V19](ENTREGA-V19.md), [entrega V18](ENTREGA-V18.md).

## Histórico · V17 publicada e operação verificada em 04/11

Em 31/10/2026, a PR #18 integrou a V17 em `f77736262089c97aab226f956fd622ae3b407ad4`, Vercel `dpl_9FpsCmBEfQPeTZ8q9j8TmTxETivG` READY. CI com 854 testes do portal e 33 do jogo. O piloto próprio chegou à caixa de entrada, seu link abriu a demanda e ela foi concluída. O gatilho único de dez minutos está instalado. Em 04/11, o histórico do Google confirmou quatro execuções automáticas concluídas, entre 09:42 e 10:12. Credencial ativa até 30/11. Leia [ENTREGA-V17.md](ENTREGA-V17.md) para os limites, escopos e provas.

Em 04/11, a aba Controle confirmou **35 tabelas verificadas** às `13:09:15.920Z`, conector 2026-10-31. O Apps Script de dados registrou as execuções automáticas de sincronização às 10:05:47, anexos às 09:53:32 e backup às 03:53:52, todas concluídas. A pasta privada continha cópias de 01 a 04/11. A de 04/11 foi criada às `06:53:58.114Z`, tem 531.305 bytes e somente o proprietário tem acesso. A restauração física confirmada continua a de 31/10. Metadados privados na Vault. Uma sincronização manual posterior ao cadastro V19 confirmou a linha do CONPEEX e 35 tabelas às `13:46:02.449Z`. A assinatura no Google Calendar está ativa e ainda aguardava a coleta do novo marco na conferência pós-cadastro. [Entrega V19](ENTREGA-V19.md).

## Histórico · V16 publicada

Em 31/10/2026, [PR #17](https://github.com/yandiamantinoBr/role-da-extensao-proex-ufg/pull/17) integrada: merge funcional `f8c3718abcb654b0b8b06679fe8dfba87cf6deff`; Vercel `dpl_GsN2Q4ZZJGH8foUMmtTzcXBREsAf` READY nesse SHA. CI: 838 testes do portal e 33 do jogo, sem falhas; tipos/builds Worker e Node aprovados, lint sem erros e três avisos anteriores. QA 375/1250 sem overflow. O botão da agenda segue o fluxo oficial Do URL, com ICS passivo conforme e verificação fresca de acesso. [ENTREGA-V16.md](ENTREGA-V16.md) traz provas e limites. O usuário já tem a assinatura criada no Google; a fonte consultada durante a V16 retornava zero registros no horizonte da assinatura. Não criar compromissos fictícios para preenchê-la.

Durante a V16, conta, organização e credencial restrita de 30 dias foram conectadas no projeto privado. O servidor ainda estava desligado enquanto a V17 preparava o piloto próprio e o feedback da cópia. A execução confirmada está no checkpoint da V17 acima.

## Histórico · V15 publicada

Em 31/10/2026, PR #16 integrada: candidato fdc2faf, merge funcional `737a14bf2b3d68c7c0bf19c090a15150c45ffe32`. Vercel `dpl_5dsBCaCtGYdqMS6VS26xvzEoYqxd` READY nesse SHA. CI: 827/827 testes do portal e 33/33 do jogo. Código local main e GitHub conferidos. Commits posteriores apenas documentais preservam a versão funcional; verificar o SHA corrente no GitHub/Vercel antes de continuar. Push, PR, merge e deploy permanecem autorizados; regras de segredos e dados continuam em AGENTS.md.

[ENTREGA-V15.md](ENTREGA-V15.md) registra Meu trabalho, responsabilidades explícitas, CAS/histórico, sinais, sino agrupado, testes, revisão independente de 9,1/10 e conferência real. Migração 0017 aplicada; 86 tabelas de aplicação e 35 projeções Sheets. A projeção de designações é somente leitura, sem responsáveis/histórico. SQLite/Supabase existentes preservados. Backup publicado recuperado em RAM: 86 tabelas, journal com 18 migrações, integridade/FKs/objetos aprovados. Custódia independente da máquina ainda não comprovada.

Sheets canônico: 35 tabelas, 170 linhas/zero conflitos e depois 173 linhas/zero. **Conector de IA divergente:** um MCP desta sessão respondeu 27 tabelas e histórico de 25/10. Revalidar destino/esquema antes de usar essa conexão para escrita; portal canônico e planilha respondem 35. O gerenciamento consultado não expõe edição desse endpoint privado. Isso não é uma falha da sincronização canônica.

Na entrega V15, R21 estava preparado e OFF, esperando confirmação Google específica; esse bloqueio de autorização foi superado pela resposta posterior registrada no topo. IA/STT, público, custódia externa e decisões institucionais permanecem na [matriz R01–R24](COBERTURA-DE-REQUISITOS.md). Não gravar exemplos de QA em produção nem presumir atribuição por autoria/cargo/tomador. Zoom de 200%, leitor de tela e aparelhos físicos não foram comprovados. [Parecer visual](../apps/proex-portal/docs/AUDITORIA-DESIGN-V15.md).

## Histórico de retomadas anteriores

**Retomada histórica: V14 aprovada para publicação; R24 em implementação V15 isolada.** Builds do candidato c35140a e recaptura do último fechar44 concluídos nos quatro contextos, teclado/foco aprovados. Rubrica independente final9,0/10 nos estados observados (9,045 ponderada), mesmos oito pesos; zoom 200% permanece não comprovado, sem certificação WCAG. Parecer final atualizado e nenhum novo bloqueador visual demonstrado. Falta CI do descendente documental, merge da PR15, Vercel READY no mesmo SHA e conferência real. Não tocar janela nativa bloqueada; o navegador interno funcionou neste novo turno sem contorno. R24: backend de responsabilidades/Meu trabalho (0017), UI isolada e sinais visuais em três worktrees próprias; nada disso deve entrar na V14 por acidente. Produção ainda23bbeae até comprovação. Os checkpoints abaixo são históricos; ler primeiro docs/ENTREGA-V14.md.

**Checkpoint histórico: V14 candidata não publicada.** Código em `v14-interface`, funcional `3fa3222`, último ajuste CSS `0804314`. 755/755 testes em Node 24/26, 33/33 do jogo, tipos/lint sem erros (três avisos antigos), Worker/Node passaram em `3fa3222`. QA e recapturas pontuais confirmaram datas, disponibilidade, botão da planilha, respiro do backup, alvos públicos e cabeçalho de 320 px. CUA foi encerrado por proteção ao não identificar a URL Chrome no Windows; não contornar. QA encerrado. Falta recompilar o último ajuste CSS do fechar 44 px, recapturá-lo, completar a verificação visual/zoom e concluir a nota independente antes de merge/deploy. 200% não foi comprovado. Ler `docs/ENTREGA-V14.md`; o texto anterior abaixo é histórico do trabalho. Última produção ainda `23bbeae`. R21 continua OFF, aguardando a confirmação específica de acesso Google já perguntada.

Em 31/10/2026, após V13, Yan escolheu provisoriamente a conta Google pessoal atual para avisos e pediu auditoria visual de TODO portal com nota independente mínima de 9/10. Última produção comprovada continua 23bbeae/V13. V14 está LOCAL, ainda sem publicação e sem aprovação9. Os detalhes abaixo da V13 permanecem como histórico útil.

- Root integra v14-interface e faz CUA exclusivo em QA sintético, sem gravações de QA em produção. Achados não se limitam a overflow: cascata CSS, contraste, teclado, toque e prioridade do conteúdo.
- relatorios_datas mantém auditoria independente, baseline V13 de 7,0/10, rubrica de 8 dimensões e checklist de 16 famílias em apps/proex-portal/docs/AUDITORIA-DESIGN-V14-PRELIMINAR.md. Só reavaliar após os mesmos contextos/estados no build final.
- revisao_organizacoes: Demandas/sino, login, Início e recorte compartilhado/configurações. mobile_responsivo: projetos, agenda, importação, relatórios, equipe e alvos locais. Não sobrepor arquivos sem coordenação.
- Avisos: remetente salvo OFF no portal, planilha/Apps Script privados separados preparados e menu confirmado. Manifesto limita quatro escopos e não solicita Gmail/Sheets/Drive. Confirmação específica de Google+token de 30 dias+piloto próprio está pendente em pergunta assíncrona. Não emitir token nem habilitar envio antes da resposta. Localizadores e endereço somente na Vault; nenhum segredo no Git.
- QA em 127.0.0.1:5173 iniciado pelo coordenador, somente loopback/dados fictícios. Provas privadas em apps/proex-portal/.sites-runtime/production-v14; mudanças na fonte requer parar QA e rebuild antes de conferir o build final. Não tocar QA antigo cuja exclusão foi rejeitada.

Checkpoint da revisão integrada em 31/10: 749/749 testes Node 24/26 e builds Worker/Node passaram na fonte 186e44f. Onze abas principais foram conferidas nos quatro contextos e estados públicos/importação/IA/patrimônio em QA sintético; PDF/DOCX/XLSX reabertos, PDF renderizado. Novos achados de 320 px, evento público, chave de sincronização e respiro de backup corrigidos localmente até d39e32f, ainda aguardando recompilação/recaptura pontual. Auditoria encontrou também datas/atraso e disponibilidade incorretos no detalhe do projeto; mobile_responsivo corrige DTO/leitura e testes, revisao_organizacoes fará revisão independente. QA anterior encerrado; não chamar esses últimos commits de testados em produção. Repetir suíte completa após integrar a correção da consulta, compilar, conferir os pontos afetados e só então pedir a nota final ao auditor. Notificações repetidas da mesma demanda permanecem melhoria residual registrada; não estão resolvidas.

# Histórico de continuidade · V12/V13 em 31/10/2026

Atualizado em 31/10/2026. Leia AGENTS.md, este guia e a matriz de requisitos. Confirme GitHub/Vercel e git status: checkpoints não são monitoração contínua. Push, PR, merge e deploy de todas as entregas estão permanentemente autorizados por Yan.

## Produção comprovada

- Site: https://proex-gestao.vercel.app/ . V13 publicada na PR #14; V12 e compatibilidade do backup são histórico nas PRs #12/#13.
- Revisão funcional V13: d069c7f280881f946e801fd9a956dad86379fcdf; Vercel READY dpl_3KvAbcFCHoaJp61GsjuxBS6N7GBD no mesmo SHA. Candidato f202903, PR/main aprovados: 726/726 portal e 33/33 jogo. Sessão real, Demandas/sino, novo relatório e padrão documental OFF conferidos após deploy, sem QA ou chamadas de provedores em produção. Commits posteriores só de documentação mantêm o mesmo código; consultar GitHub/Vercel para o SHA corrente.
- Health canônico 200; URLs geradas antigas V9/V10 retornam 403. Preview não tem credenciais de produção. Não operar o banco atual com código anterior à migração 0008.
- Demandas, prioridades, equipes sobrepostas, conferência por material/tamanho, pendências, sino e relatórios estão publicados. Concessão de tarefa não amplia ACL; conferência não movimenta estoque nem fecha empréstimo. WhatsApp é compartilhamento manual.
- E-mail MailApp e cadastro público estão implementados, mas DESATIVADOS. Remetente pessoal provisório escolhido em 31/10 e salvo com envio OFF; instalação separada e autorização Google ainda pendentes. Aviso aprovado e infraestrutura da entrada pública têm gates próprios. Não escolher uma conta por ausência de resposta.

## Backup e Sheets reais

- Primeiro formato 2 capturado em 31/10 às 13:19:05 BRT, releitura/ACK 13:19:11; 485.224 bytes. A cópia baixada do Drive privado tem o mesmo SHA-256 do recibo: f13c9a6678d956550b7789e9ee4b928892c1fccc8c3612a944563ed6c12ada50.
- Recuperação física isolada passou: snapshot 270, SQLite 1.183.744 bytes, 1 objeto / 416.503 bytes, 16 migrações, integridade/FK/hashes aprovados; réplica clara temporária removida. Provas privadas em apps/proex-portal/.sites-runtime/production-v12. Localizadores/chaves somente na Vault/AppData, nunca no Git público.
- Apps Script da planilha recebeu Code.gs atual e backup-automatico.gs, sem arquivo MailApp. Gatilho diário às 03h America/Sao_Paulo instalado e consulta confirmou 1 gatilho, recibo válido e nenhum pendente. A primeira execução pelo relógio ainda não aconteceu; não confundir com a captura manual comprovada pela rotina. Privada sob DPAPI local; custódia independente continua pendente.
- Drive real informa inherited=true na própria ACL única user/owner. Correção mantém dono atual, ACL única, pai privado exato e recusa qualquer acesso extra, sharedDrive, atalho ou paginação. Positivo reproduzido antes/depois e negativos/revisão passaram. Diagnóstico temporário retirado; pasta extra vazia criada por seleção incorreta foi movida à lixeira recuperável, pasta configurada preservada.
- Sheets pós-V12: execução automática concluída em 31/10 às 16:37:03.006Z, 34 tabelas / 153 linhas / zero conflitos. Inclui as cinco projeções somente leitura do acompanhamento. Um gatilho de dados e um de anexos preservados; execução automática anterior após V11 foi comprovada em 15:07:06.612Z. Última rodada de anexos não revalidou uma cópia anterior, sem novas falhas; não chamar isso de nova releitura.

## V13 publicada e próxima ação

Checkout coordenador atual: v14-interface, sobre a produção documental 23bbeae (revisão funcional V13 d069c7f). R09, R10 e R11 integrados, revisados por agentes diferentes e conferidos em CUA. Revisões específicas estão em apps/proex-portal/docs. Fonte congelada; últimos commits são testes e documentação. Não abrir frentes concorrentes sobre arquivos compartilhados.

- R09: “Saídas rastreáveis” mostra ação, quantidade, operador autorizado e retorno; reservas/agendamentos não contam como saída, textos livres exigem opt-in, CSV parcial tem nome explícito.
- R10: IA opcional no importador de projetos/patrimônios, evidências literais por campo, revisão e confirmação. documentEnabled começa false. Confiança sem calibração permanece nula; não há OCR/envio binário ou saldo automático. 0016 é aditiva.
- R11: painel montado só em configuração autorizada com revisão salva; consentimento próprio para metadados, sem geração/transcrição automática. Troca de organização/revisão desmonta o diagnóstico. Chaves/provedores reais não foram usados.
- Autoridade é conferida depois dos awaits de configuração/decifragem, antes de cada envio IA/STT e ao devolver/reaplicar resultados. Mudança de identidade recarrega a interface antes de aplicar novo snapshot.

Suítes finais: 726/726 em Node24 e Node26, tipos/lint sem erros (3 avisos antigos), Worker e Node builds aprovados. PR #14 e deploy de produção concluídos, conferência autenticada e isolamento aprovados. Coordenador mantém a trilha de registro na Vault e oito chats. Próximas ações reais: concluir autorização/instalação do remetente pessoal provisório já escolhido, configurar provedores pelo responsável, testar em aparelhos físicos, comprovar primeira execução diária e custodiar as chaves fora da máquina. Não ativar serviços por ausência de resposta; consultar docs/ENTREGA-V13.md e a matriz.

## Evidências e limites

V12: suíte local 643/643 Node26 mais contrato posterior focado; CI 644/644. Correção Drive: CI 645/645, 22 focados, revisão independente. Tipos/lint sem erros (3 avisos antigos), Worker/Node builds passaram. V13: modelos de 83 tabelas e cadeia 0000–0016 coerentes; migração 0016 ensaiada no backup RSA real V12 em RAM preservou as 82 tabelas originais, integridade OK/FK zero. Histórico V12: migrações ensaiadas no backup real V10 em RAM preservaram 49 tabelas. CUA 375/414/1250 sem overflow, evento→P/M/G com 1 avaria M→revisão alta, PDF/DOCX/XLSX reabertos e PDF renderizado. Build final também confirmou deep link e consentimento próprio persistido/retirado com envio desligado.

Smoke local de Sheets/conflitos e backup de 5,29 MB / 161 chunks com recuperação física passou. Benchmark público local: 100 pedidos, concorrência 10, zero erros, p95 14,47 ms; página de 50 demandas passou de 101 para 1 consulta de versão, zero recargas/commits estáveis. São medições sintéticas locais, não capacidade serverless ou latência Postgres.

Requisitos R01–R22 e achados A01–A28 continuam rastreados. Não declarar tudo concluído: política institucional/retensão, custódia independente, ativação de provedores/público, escolhas de catálogo e demais pendências são distintas de código pronto. R12 já oferece áudio→transcrição revisada→proposta/confirmar no assistente; não espalhar microfones sem necessidade. Nunca ler/imprimir .env/.dev.vars, arquivos de segredo ou valores de chaves.

Leia docs/COBERTURA-DE-REQUISITOS.md e docs/ENTREGA-V13.md; V12 é histórico em docs/ENTREGA-V12.md. Histórico em docs/ANDAMENTO.md; Vault salva/relida localmente não comprova sincronização em nuvem.


## Verificações em continuidade - 05/11

A reconsulta Google Calendar da assinatura existente PROEX · Projetos e eventos,9–13/11, retornou zero eventos às10h54 de Brasília. Coleta ainda pendente; não criar cópia ou revogar link para esconder a lacuna. A conexão de inventário dos chats não devolveu resultado e foi encerrada sem envio; não declarar comunicação das novas entregas aos oito chats. A próxima composição recebeu snapshot0027, nove colunas/PK/FK preservadas e rollback sob falha.26focais passaram. Rodada ampla1094/1095 teve falso positivo antigo na busca de prefixo CPF de três dígitos em UUID/timestamp; f4b744d agora valida as duas formas completas e JSON exato de auditoria. Focal passou; repetir integrado depois das novas mudanças, sem registrar100% antecipadamente.


## QA final e frente seguinte em paralelo - 05/11

59b7360 passou tipos/lint/Node e56 estados dos14 módulos mais4deavisos; alvos44reais, teclado, semoverflow/erroJS/HTTPfalho. Testes completos1129 na composição anterior aoMD;43focais da exportação apósMD; head final ainda depende CI. [Evidências, benchmark e limites](ENTREGA-05NOV-PROVEDORES-E-RELATORIOS.md). O appPROEX instalado continua retornando27projeções/run25out, sem origem editável exposta; proibir sua escrita até revalidar, sem confundir com35canônicas atuais.

Estrutura0029: WTestrutura-institucional, backend0928dbe +81ad4c7 +doc7cbb8d2 +negativasfe0f7c6; não integrar naPR35. UI com planilhas_escopo/auditoria_ia_config; root revisará serviço e fronteiras. Resumo pessoal: WTresumo-pessoal-dashboard sobre59b7360, filtros_datas, sem migração. Deve corrigir a ambiguidade dos alertas operacionais e mostrar contagens pessoais com DTO mínimo, ACL viva e linkworkStatus/reload/Voltar, sem alterar candidato35.
