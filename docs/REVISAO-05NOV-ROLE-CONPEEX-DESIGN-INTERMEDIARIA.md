# Crítica final independente: programação de dinâmicas e transferência de demandas

**Nota do escopo visível: 8/10. Não está pronto:** há um P1 aberto. A correção cabe em uma linha, mas o problema aparece justamente no documento que sai do sistema.

Abri as 18 imagens pedidas e conferi dois pontos no código: `campaign-planning-export.ts` e `campaign-planning-panel.tsx`. Não rodei testes, não acessei produção e não usei shell.

## Achados

**P1. O PDF, o XLSX e o DOCX perdem o aviso "Sugerido".**
Na tela, a sessão provisória aparece como "Sugerido: 18:00 às 19:30". Em `programacao-compacta-1.png` ela aparece como "Início: 18:00 / Fim: 19:30", sem qualificação. Isso contraria a decisão de produto. A causa está em `components/portal/campaign-planning-export.ts:10`: `inicio:session.startsAt??'A confirmar'` não considera o status da sessão. A coluna "Provisória" e a linha "Leitura" atenuam o problema, mas um programa impresso com "Início: 18:00" vai ser lido como horário fechado.
- **Correção:** no `map` da linha 10, criar `const sug=session.status==='tentative'` e usar `inicio:session.startsAt?`${session.startsAt.slice(0,5)}${sug?' (sugerido)':''}`:'A confirmar'`. Fazer o mesmo para `fim`.
- **Teste:** acrescentar um caso em `tests/campaign-planning-export.test.mjs` com sessão provisória com horário, verificando "(sugerido)", e sessão confirmada, verificando que o texto não aparece.

**P2. Aninhamento excessivo na comparação de conflito em 390px.**
Em `390-light-conflict.png` há cinco caixas encaixadas: página, painel de programação, editor, alerta e cartão de campo. Os cartões de campo ficam com cerca de 230px de largura e as bordas verticais se repetem nas laterais. Hoje o texto ainda cabe, mas nomes ou observações longas vão quebrar muito.
- **Correção:** com `@media (max-width:480px)`, zerar `padding-inline` e borda do contêiner "Editar sessão" e do alerta de conflito em `campaign-planning-panel.module.css`. Basta manter só o cartão de campo com borda.

**P3. "Confirmar" parece habilitado em sessões sem horário.**
Em `1366-light-planning.png`, as sessões 2 e 3 mostram "Horário a confirmar" e mesmo assim exibem "Confirmar" ativo. O clique só mostra um erro (`changeStatus`, linha 286), o que frustra quem tenta.
- **Correção:** quando faltar horário, trocar o rótulo para "Informar horário" e fazer o botão abrir `openEditor(editDraft(...))`, em vez de chamar `changeStatus`.

**P3. O select "Situação" fica esticado em 1366px.**
Em `1366-light-conflict-actions.png`, o select fica com cerca de 90px de altura e desalinhado de Início/Fim, porque herda a altura da linha da grade onde está o texto de ajuda.
- **Correção:** aplicar `align-self:start` ao campo Situação, ou levar o texto de ajuda para uma linha própria que ocupe a grade inteira.

**P3. Texto ambíguo na transferência.**
"Nenhum responsável individual perde acesso ao destino." O que está em jogo é o acesso à demanda, não ao destino.
- **Correção:** "Nenhum responsável individual perderá acesso a esta demanda no projeto de destino."

**P3. O botão de ação principal da transferência tem texto pequeno.**
Em `1366-dark-transfer.png`, o botão "Mover para Evento anfitrião QA" ocupa a largura toda, mas a fonte é de cerca de 12px, menor que a do resto do painel.
- **Correção:** usar o mesmo `font-size` dos botões primários do painel (cerca de 15px).

**P3. Os cartões de indicadores ficam desalinhados em Demandas.**
Em `1366-dark-transfer-history.png`, o "0" de "Em andamento" fica mais baixo que os dos outros cartões, porque o rótulo quebra em duas linhas.
- **Correção:** `align-items:start` com altura mínima no rótulo, ou `grid-template-rows:auto 1fr` com o número alinhado à base.

## O que está bom de verdade
- **Conflito:** cada campo traz "Igual" ou "Diferente" em texto, com borda e fundo. O estado não depende só da cor. As duas decisões são explícitas e o motivo do bloqueio fica ao lado de "Salvar". Não há avisos sobrepostos.
- **Foco:** depois de cancelar, o foco volta visível para "Editar". O título do editor recebe foco no tema escuro.
- **Estados:** "Provisória" tem ícone e texto. Os grupos por dia mostram contagens.
- **Marca e documento:** a marca PROEX/UFG está correta no menu e no PDF. O PDF identifica a dinâmica, o responsável e o anfitrião. As duas páginas são legíveis, com os sete campos agrupados sem perda de colunas.
- **Histórico da transferência:** mostra origem → destino e o motivo, sem nome de ator nem pessoas. Isso respeita a restrição.
- **Contagem de afetados:** aparece como individual ("Nenhum responsável individual…"), sem total inventado.

## P1 iniciais
Não consegui ler `docs/REVISAO-05NOV-ROLE-CONPEEX-DESIGN-INICIAL.md`: está fora do diretório a que tenho acesso. Por isso não confirmo item a item quais P1 iniciais foram corrigidos. Pelas imagens, estes pontos estão resolvidos hoje:
- comparação de conflito por campo, com ações explícitas;
- "Sugerido" e "Horário a confirmar" na tela;
- retorno de foco;
- dias que abrem e fecham, com contagem;
- PDF agrupado e legível;
- histórico sem atores privados.

O ponto do "Sugerido" só está parcialmente resolvido: corrigido na tela, mas não no documento (o P1 acima).

## Limites
- **Evidências de execuções diferentes:** em `1366-dark-transfer.png`, a demanda aparece com "Prioridade média" e o motivo "…mantendo os registros". No histórico, aparecem "Prioridade alta" e "…sem apagar contagens". Parecem ser execuções ou dados diferentes, e o histórico não mostra mudança de prioridade. Vale confirmar que a transferência não altera a prioridade.
- **Possível item duplo no menu:** em `1366-light-planning.png` e `1366-light-hosts.png`, "Demandas" aparece destacado junto com "Dinâmicas". Provavelmente é o ponteiro do mouse parado ali durante a captura; não tratei como defeito.
- **Foco no tema claro:** em `390-light-editor.png` o foco não aparece no título, ao contrário do escuro. Pode ser só o momento da captura.
- **Contraste:** não medi. O roxo claro com texto branco nos botões primários do tema escuro merece conferência.
- **O que não verifiquei:** rascunho de backend, ACL, fingerprint, downloads, testes e produção.
