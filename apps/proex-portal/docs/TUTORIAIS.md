# Tutoriais do Portal (sem IA)

Pedido da coordenação em 2026-11-16, a partir do [roteiro por público](ROTEIRO-TUTORIAIS-PROEX.md) e da [passagem de QA](QA-TUTORIAIS-WIDGETS-E-ROLE.md). Capítulos prontos: **Navegação**, **Meu trabalho**, **Projetos**, **Demandas**, **Equipes**, **Agenda**, **Materiais**, **Dinâmicas** e **Empréstimos**. Os próximos entram um por PR.

## O que a pessoa vê

- **Convite do Rolê no Início:** aparece uma vez, dentro da página, sem tomar o foco. **Fazer o tour completo**, **Escolher assunto** ou **Agora não**.
- **Ajuda e tutoriais:** no menu da conta (foto ou nome no alto), em **Mais** no celular e na **Conta**.
- **Cartão guiado:** fica no canto e não é modal. Mostra **Navegação · 2 de 8**, a fala do Rolê e o que a pessoa vai ver, e põe um contorno no controle real da página.
  - Botões: **Voltar**, **Pausar**, **Próximo** e **Sair** (o X).
  - No último passo: **Repetir esta parte**, **Ver outros assuntos** e **Concluir**.
  - **Escape** pausa.
  - Quando o controle fica em outro módulo, **Abrir no Portal** leva até lá e o tutorial continua.
- **Retomar** volta ao último passo permitido. **Recomeçar** reinicia só aquele capítulo. A data da primeira conclusão é mantida.

Funciona sem IA, chave, consentimento de provedor, widgets, saldo ou `inventory.read`. Nenhum passo grava dados de trabalho: só o progresso pessoal.

## Como funciona

| Peça | Arquivo |
|---|---|
| Catálogo (capítulos, passos, falas, rótulos citados, âncoras, requisitos de acesso) | `lib/tutorials/catalog.ts` |
| Acesso e progresso no servidor | `lib/tutorials/service.ts` |
| Rota | `app/api/tutorials/route.ts`: GET `?projectId=` e POST com ações `progress.save`, `progress.restart`, `invite.dismiss`, `invite.start` |
| Tabela | `user_tutorials` (migração **0052**): pessoa, capítulo, versão, último passo, situação e datas. O convite usa o capítulo reservado `convite` |
| Tela | `components/portal/tutorials/` (estado compartilhado, camada com cartão e janela, convite, lista e cartão da Conta) |
| Âncoras | `data-tutorial` em `portal-navigation.tsx` (Início, menu, Mais), `portal-client.tsx` (menu da conta), `dashboard-panel.tsx` (Personalizar), `account-access-panel.tsx` (Meus acessos) e `meu-trabalho-panel.tsx` (cabeçalho, origem, totais, demandas e responsabilidades). O campo Projeto usa o `id="filtro-projeto"` que já existia |

**Permissões efetivas:**
- A cada abertura e a cada troca de projeto, a tela consulta `GET /api/tutorials`.
- O servidor calcula os passos com o ator da sessão (`getActor`, `accessibleProjects`).
- Projeto de outra organização ou fora do alcance conta como "nenhum projeto" e não é ecoado.
- Gravar exige conta ativa no momento (`accountBatch`) e confere de novo se o passo é permitido (409 se não for).
- Conta bloqueada ou anonimizada recebe 401/403, e a tela fecha o tutorial sem mostrar dados anteriores.
- A anonimização apaga o progresso (`lib/privacy.ts`).

**Versões:**
- Ids de capítulo e de passo são estáveis.
- Mudou a ordem, a fala ou o caminho: suba `version` no catálogo.
- Quem parou num passo que saiu retoma no próximo permitido.
- A conclusão fica registrada, e a lista mostra "com novidades".

## Como criar um capítulo

1. Acrescente o capítulo em `TUTORIAL_CHAPTERS`, com ids `a-z0-9-` e um passo final.
2. Para cada passo:
   - escreva a fala (`speech`) e "Você verá" (`youWillSee`), com variações `Mobile` quando o caminho mudar no celular;
   - defina `target` como uma âncora `data-tutorial="…"` ou um `#id` que já exista;
   - use `module` quando o controle ficar em outro módulo;
   - use `requires` quando o passo depender de acesso (`projects`, ou `capability` com `scope: 'selected'` para o projeto escolhido);
   - liste em `labels` os rótulos da tela citados na fala.
3. Rode `node --test tests/tutorials.test.mjs tests/tutorials-ui.test.mjs`. O teste falha se um rótulo citado não existir na interface, se uma âncora sumir ou se um módulo não existir.
4. Teste com uma conta completa e uma restrita, em 390 e 1366 px nos dois temas.

## O que ainda falta

- **Experimentar** com exemplo fictício nos capítulos de operação.
- Ajuda local na página do voluntário e na área pública da ação (público anônimo com progresso só no aparelho).
- Abrir a mesma ajuda pelo chat do Rolê.

## Testes

- `tests/tutorials.test.mjs`:
  - catálogo íntegro;
  - permissões efetivas com o `getActor` real: papéis mistos, projeto vizinho, voluntário sem concessão vigente, conta bloqueada e vínculo revogado com a tela aberta;
  - progresso pessoal, pausa, conclusão, repetição e recomeço;
  - convite;
  - entradas inválidas;
  - anonimização.
- `tests/tutorials-ui.test.mjs`:
  - rótulos e âncoras reais;
  - ligação no Portal;
  - nenhuma rota de trabalho, IA ou `inventory.read`;
  - estado da tela: passo pulado sem acesso, troca de projeto que remove o passo, 401/403, pausa e convite.
