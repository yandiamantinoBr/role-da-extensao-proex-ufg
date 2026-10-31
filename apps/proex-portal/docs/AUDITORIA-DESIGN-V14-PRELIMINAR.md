# Auditoria independente de design — V14, preliminar

Data: 31/10/2026. Base de fonte: `23bbeae` (código publicado V13 `d069c7f`). Revisão somente de leitura, em worktree própria, sem servidor, build, CUA concorrente, alteração de fonte ou chamada a produção. O documento não contém cópia de captura, foto, e-mail ou dado operacional real.

**Nota preliminar única: 7,0/10** (média ponderada não arredondada: 6,95). Ainda não há evidência para aprovar 9/10. A nota combina inspeção de fonte com duas capturas fornecidas: A, Demandas em retrato/claro; B, Demandas em desktop/claro. Elas não demonstram as outras abas, tema escuro, teclado, leitor de tela, zoom ou aparelho físico. Não é certificação WCAG.

## Rubrica e evidência

| Dimensão | Peso | Nota preliminar | Critério e observação |
| --- | ---: | ---: | --- |
| Hierarquia e próxima ação | 15% | 7,0 | H1 e navegação identificáveis. Captura B repete título/explicação em dois níveis; A dedica grande parte da tela a filtros antes do trabalho. Demandas está com outro agente. |
| Espaçamento e densidade | 10% | 7,5 | Superfícies, cantos e espaçamento consistentes na base. A densidade deve ser conferida dentro da largura útil de cerca de 950px, não apenas em desktop amplo. |
| Tipografia e legibilidade | 10% | 7,0 | Texto principal tem escala reconhecível, mas tabelas e metadados genéricos ainda chegam a 9–10px; não tratar informação operacional importante como rodapé. |
| Contraste e temas | 15% | 6,5 | Tokens compartilhados claros/escuros existem. Há pares específicos insuficientes em placeholders, cabeçalhos e mensagens de áudio; ver D02/D03. |
| Responsividade e toque | 15% | 7,5 | Há container queries, `min-width:0`, quebra de textos, safe area e campos de 16px no mobile. Faltam provas visuais por família e alguns controles próprios divergem da meta de toque. |
| Consistência de componentes | 10% | 7,0 | Várias famílias usam os mesmos campos/botões, outras misturam variantes sem definição. Fluxos públicos não oferecem o mesmo controle de aparência. |
| Teclado e semântica | 15% | 6,0 | Foco visível e diálogos nativos/gerenciados são pontos positivos. A seleção de fotos do material perde operação por teclado; a semântica de abas dos relatórios está incompleta. |
| Feedback e estados | 10% | 7,5 | Existem mensagens de erro/status, bloqueio de submissão e estados vazios. `disabled` usa cursor de espera para qualquer motivo, e mensagens de áudio perdem contraste no escuro. |

Para a reavaliação, manter estes pesos e comparar a mesma tarefa, conteúdo e viewport. Não aumentar a nota apenas porque um teste técnico passou ou um cartão ficou mais bonito.

## Achados acionáveis fora de Demandas/sino

| ID | Prioridade | Evidência de fonte | Impacto e correção concreta | Aceite |
| --- | --- | --- | --- | --- |
| D01 | P1 | `components/portal/material-detail-drawer.tsx:142`; `material-detail-drawer.module.css:1`, `.photoButtons input{display:none}` | “Usar câmera” e “Escolher foto” são labels com input retirado da árvore de foco, sem botão/ref ou tratamento de teclado. Aplicar o padrão já usado em `profile-panel.tsx:304–305` e `records-panel.tsx:156`: botão real aciona input por ref. | Tab alcança as duas ações; Enter/Espaço abre o seletor correspondente; cancelar preserva o material e o foco; arquivo selecionado mostra prévia antes de gravar. |
| D02 | P1 | `components/portal/speech-input.tsx:16,20`: `text-amber-900` e `text-red-800` sobre `bg-[var(--surface)]` | No tema escuro, texto de indisponibilidade/erro fica escuro sobre superfície escura. Adotar tokens semânticos de aviso/erro com combinação de fundo e texto definida nos dois temas. | Mensagens reais de indisponibilidade, permissão negada e erro legíveis no escuro, também sem depender apenas da cor. |
| D03 | P2 | `app/globals.css:7`, `input::placeholder`; `:9`, `.p-table-wrap th` | Pares claros calculados: `#a19aa8/#ffffff` = 2,73:1; `#8d7f98/#fcfaff` = 3,60:1. Usar cor de texto secundário apropriada para informação pequena; conferir tabelas genéricas, sem substituir os bons tokens dos relatórios modernos. | Pares efetivos de texto pequeno chegam a pelo menos 4,5:1; tabela/placeholder continuam distintos do valor preenchido e do título. |
| D04 | P2 | `material-detail-drawer.tsx:137,141,142`, `p-button-secondary` | Variante usada nas ações não tem definição nos estilos compartilhados; a base tem `p-button-subtle`. Unificar a variante existente para não deixar ações sem fundo/borda reconhecível. | Categoria, histórico e fotos têm a mesma aparência secundária, hover, foco e estado indisponível dos demais painéis, nos dois temas. |
| D05 | P2 | `components/portal/reports-center.tsx:354–355` | Declara `tablist`/`tab`, mas não oferece roving tabIndex, setas ou vínculo `aria-controls`/`tabpanel`. Completar o padrão ou usar grupo de botões com `aria-pressed`, conforme o modelo de interação desejado. | Teclado e semântica representam a interação real; trocar dataset mantém os guards de dados/exportação já existentes. |
| D06 | P2 | `components/portal/team-person.module.css:11`, `.close` de 36×36; `speech-input.tsx:14`, summary com `min-h-8`; `app/participante/participant.module.css:11`, summary de 32px | Há controles móveis próprios menores que a meta de produto de 44px adotada na base. Aumentar a área acionável sem inflar ícones ou toda a tipografia. | Botão fechar e disclosures confortáveis no toque. 44px é meta de usabilidade deste produto; não se declara falha automática do mínimo WCAG de 24px. |
| D07 | P2 | `app/participante/participant-client.tsx:9`, `Frame` | Acesso, confirmação e conta do público herdam o tema global, mas não oferecem o seletor presente no login/evento. Montar controle de aparência coerente no frame compartilhado. | Pessoa sem sessão da equipe consegue escolher Claro/Escuro/Sistema nas rotas públicas, sem voltar ao login; layout não estoura a 320/375px. |
| D08 | P2 | `app/globals.css:6`, `button:disabled{cursor:wait}` | Controle indisponível por seleção vazia ou permissão parece estar processando. Usar cursor neutro/indisponível para disabled e espera somente no estado busy real; manter explicação textual quando necessária. | Vazio, falta de permissão, carregamento e salvamento têm feedback distinto, sem botão que pareça travado. |

Contraste de D02 foi calculado com a paleta efetivamente instalada, não com uma paleta presumida: Tailwind 4 `amber-900=oklch(41.4% 0.112 45.904)` e `red-800=oklch(44.4% 0.177 26.899)` sobre `--surface` escuro `#241b2e`: aproximadamente 1,82:1 e 1,97:1. A inspeção do CSS já compilado confirma que as classes usam esses tokens. Como controle positivo, o texto secundário compartilhado resulta em aproximadamente 6,25:1 no claro e 8,18:1 no escuro. Cálculo de pares não substitui inspeção de todos os estilos computados e estados.

Referências primárias: [contraste de texto](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [operação por teclado](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html), [padrão de abas](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) e [tamanho mínimo de alvo e exceções](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html). Não foram feitas declarações globais de conformidade a partir de imagens.

## Checklist por aba e família

Cada linha exige desktop claro/escuro e mobile claro/escuro. Usar captura de visão geral e ao menos um estado de trabalho aberto; comprovar também teclado e erro/vazio quando a família tiver essa interação. `Fonte` significa leitura estática, não aprovação visual.

| Família / aba | Fonte principal inspecionada | Checklist concreto para a coordenação |
| --- | --- | --- |
| Estrutura, navegação e conta no topo | `portal-navigation.tsx`, `app/portal-client.tsx`, `globals.css` | Menu expandido/recolhido, “Mais” móvel, tema, avatar longo, skip link, foco/restauração e safe area; nenhuma sobreposição com CTA final. Sino está com outro agente. |
| Início | `dashboard-panel.tsx`, regras `.pd-*` | Atalhos e próximo passo precedem decoração; indicadores só com dados conhecidos; nomes longos, vazio e seis atalhos não estouram; sem linha de texto excessivamente longa no desktop. |
| Projetos e detalhe | `project-panel.tsx`, `project-detail.tsx`, `project-panel.module.css` | Lista/filtros, novo projeto, organização explícita, unidade, detalhe, vínculos, planilhas e histórico. CTA de editar/voltar reconhecível; nomes/URLs longos; formulários em uma coluna quando a largura útil exigir. |
| Demandas e conferências | `follow-up-panel.tsx` | Cobertura estática e capturas A/B; correção por outro agente. Conferir hierarquia sem duplicação, filtros compactos, criação, detalhe, equipes, conferência por tamanho, paginação/vazio e foco ao abrir/fechar. |
| Agenda | `calendar-panel.tsx`, `calendar-panel.module.css` | Grade de sete dias sem overflow do corpo; data selecionada/today distinguíveis além da cor; lista alternativa de eventos; filtros, meses e assinatura cabem sem esconder ação de voltar. |
| Materiais e patrimônio | `material-detail-drawer.tsx`, `asset-details-panel.tsx`, estilos próprios e montagem | Catálogo, drawer, movimentação, histórico, prévia patrimonial, fotos e anexos. Corrigir D01/D04; teclado no drawer; campos e saldo legíveis; nomes, centavos e tombamentos longos não estouram. |
| Brindes, ofertas e kits | montagem de Materiais em `app/portal-client.tsx`, regras `.p-kit-*` | Separar trabalho de catálogo e prêmios, seleção de componente/quantidade alinhada, estoque zero explícito e unidade não ambígua; ações secundárias não competem com confirmar. |
| Empréstimos | montagem em `app/portal-client.tsx`, regras `.p-loan-*`, componentes de documentos | Reservado, retirado, vencido e devolvido reconhecíveis por texto; data efetiva separada da previsão; criar/retirar/devolver/anexar termo utilizáveis no celular; erro e confirmação não ficam fora da área rolável. |
| Dinâmicas e atendimento | `campaign-form.tsx`, `physical-attendance.tsx`, `pending-prizes.tsx` | Criar/editar campanha, validar regras/ofertas, estado de ativação, código de atendimento, repetição autorizada, cancelamento e entrega. Uma ação principal por momento; estados de processamento claros. |
| Registros e documentos | `records-panel.tsx`, `records-panel.module.css` | Filtros, linha do tempo, criar/editar, câmera/galeria/PDF e anexos; textos e nomes longos; leitura de erros e retorno ao ponto anterior após gravar. Padrão de upload por botão é positivo. |
| Equipe e organizações | `team-panel.tsx`, `team-person-detail.tsx`, `organizations-panel.tsx`, diretório oficial | Convite/permissão, pessoa bloqueada/revogada, copiar link, perfil, troca organizacional e confirmações. D06; funções extensas e contatos autorizados não comprimem controles. |
| Relatórios | `reports-center.tsx`, `reports-center.module.css` | Todos os datasets disponíveis, colunas, busca, agrupamento, unidades e seis exportações. D05; gráficos e tabela sem somas indevidas, cobertura parcial visível, ações bloqueadas durante troca de recorte. |
| Configurações, Sheets e backup | `sync-settings-panel.tsx`, `complete-backup-panel.tsx`, `backup-automation-panel.tsx` | Estado e próxima ação antes de instruções longas; disclosure, erro, indisponibilidade, chave pública longa e listas de recibos. Nenhum segredo real em capturas; não instalar/ativar serviços durante QA visual. |
| Conta, foto e privacidade | `profile-panel.tsx`, `account-identity-panel.tsx`, `admin-privacy-panel.tsx`, `webcam-capture.tsx` | Perfil/contato opcional, senha, CPF/atalho, consentimentos, anonimização e câmera. Confirmação destrutiva inequívoca, foco, erro de câmera, remover/trocar foto e zoom sem cortar ações. |
| Importação e IA/voz | `assisted-import-panel.tsx`, `assistant-panel.tsx`, `assistant-connection-panel.tsx`, `speech-input.tsx` | Arquivo/texto → prévia → seleção → revisão → confirmação. D02; citação e ausência de confiança não confundem com aprovação. Provedor indisponível, microfone negado, diagnóstico e áudio revisado têm próximos passos claros. Usar somente fixtures. |
| Público e entrada | `app/login-client.tsx`, `app/participante/*`, `app/events/*`, `app/not-found.tsx` | Login, convite inválido, senha, cadastro/recovery público fechado, confirmação, conta, evento sem dados, regras, sorteio/resultado e 404. D07; temas, textos longos, toque, redução de movimento e feedback. Não criar conta/participação real para a auditoria. |

O link para a roleta livre externa não equivale a uma inspeção daquela aplicação. A revisão aqui cobre o Portal PROEX e suas rotas públicas locais; eventual mudança de escopo precisa ser registrada pela coordenação.

## Gate para uma nota de pelo menos 9/10

1. D01 e D02 fechados com prova funcional/visual; P2 resolvidos ou acompanhados de uma decisão explícita e justificável de produto.
2. Matriz de dezesseis famílias acima conferida nos quatro contextos. Referência: 375px, desktop de aproximadamente 1250×950 e largura útil de cerca de 950px; adicionar 320px/zoom de 200% aos fluxos críticos. Registrar viewport CSS, tema, estado e revisão do código; pixels físicos de uma captura não provam viewport CSS.
3. Percurso de teclado completo para navegação, drawers/modais, upload, relatórios e formulários; foco visível, ordem compreensível e retorno ao acionador. Leitor de tela e aparelhos físicos continuam evidências próprias, não deduções de CSS.
4. Comparação antes/depois da mesma tarefa, sem dados pessoais e sem chamadas pagas ou mutações reais como parte do teste de apresentação.
5. Reaplicar a mesma rubrica. Uma imagem isolada ou ausência de scrollbar no estado vazio não autoriza declarar todo o site aprovado.

Este é um diagnóstico preliminar; não documenta correções realizadas nem publicação V14. A coordenação mantém exclusividade de CUA, alterações de fonte e integração.
