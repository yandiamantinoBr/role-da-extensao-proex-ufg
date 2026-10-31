# Consistência de formulários e controles · V14

Revisão em 31/10/2026, base `23bbeae`, compondo a correção central de camadas CSS `2fbd500`. Implementação local `c9b8347` e semântica dos assuntos de relatório `e2e50c7`. Sem publicação, dados reais, novo servidor ou navegador nesta frente.

## Evidência e limite

As capturas fornecidas mostram filtros/ações e descrição/formulário encostados em Demandas, além de campo próximo à navegação inferior. O coordenador corrige o reset central e o shell; outro agente corrige Demandas/sino. O reset de `fieldset` fora da camada base anulava utilitários de margem/padding/borda; `button { color:inherit }` anulava a cor dos botões. A correção central evita reproduzir Tailwind em cada painel.

As medidas abaixo são **declarações do código**, não medidas de pixels renderizados. A nota visual mínima 9/10 exige a revisão crítica da aplicação integrada, em claro/escuro e 375/414/1250 px. Testes de estado e ausência de overflow isolada não substituem essa revisão.

## Mapa de módulos e estados

| Módulo | Lacuna concreta e correção | Estados a verificar na composição real |
|---|---|---|
| Importação assistida | `p-card` sem padding local; header não quebrava; confirmação com alvo pequeno. Padding 18–24 px, header flexível, separação de 18 px ao abrir, checkbox 20 px dentro de label ≥44 px; corpo/fieldset usam gap. | Fechado/aberto; documento/manual; carregando/erro; prévia/evidência/ausência; conferência; anexo e recibo. Conferir nome longo e botão Fechar. |
| Relatórios | Exportações 40 px, limpar busca 30 px, colunas 43 px, presets 30/36 px, paginação 34/36 px. Controles passam a ≥44 px; remoção/limpeza também têm largura ≥44 px. Seleção de assunto usa grupo nomeado e botões `aria-pressed`, sem padrão de abas incompleto. | Vazio/carregando/erro/403; seleção; menu de colunas aberto; preset longo; consulta parcial; tabela larga; exportação desativada durante troca de filtro. |
| Projetos e catálogos | Tipos/unidades usavam `p-card` sem padding. Contêiner próprio com padding 18–24 px e gap 18 px. Ações/filtros/tabs/resumo com piso local ≥44 px. | Criar/editar, tipos/unidades, erro CAS, título/unidade longos, lista/detalhe, contexto local/plataforma. |
| Organizações | Cards e área de gestão tinham borda sem padding. Padding local 18–24 px. | Lista/gestão, administrador local/plataforma, última administração, convite/revogação, erro/conta sem gestão. |
| Equipe | Fechar detalhes de pessoa media 36×36 px no CSS. Agora 44×44 px. | Diálogo, identidade longa, vários vínculos, carregando/erro, retorno de foco ao fechar. Formulário de convite usa os estilos existentes. |
| Conta e perfil | Ações da foto tinham mínimo 42 px; agora 44 px. | Perfil, foto, formulários de senha/atalhos/privacidade, validação e confirmação. Estrutura existente de gap preservada. |
| Agenda e Registros | Ações locais de 32–43 px existiam fora das exceções mobile. Piso explícito elevado a 44 px em filtros, chips, histórico e anexos. | Filtros, calendário, assinatura, vazio, histórico/anexos, texto longo e rolagem de tabela. |
| Materiais/patrimônio | Seletores de foto eram labels com input `display:none`, sem acionamento por teclado; classe `p-button-secondary` não existe no tema. Botões nativos + refs para inputs hidden preservam accept/capture; uso de `p-button-subtle`. Ações de foto/abas/patrimônio com piso local ≥44 px. | Resumo/editar/movimentar/patrimônio/histórico/fotos; sem permissão; preparando/enviando/erro; Enter/Espaço nos seletores. Nenhuma câmera foi aberta na verificação. |
| Assistente, configuração IA, diagnóstico, e-mail e backups | Dependência do reset central, sem CSS local duplicando os utilitários. Mensagens de voz tinham texto escuro sobre superfície escura; agora usam aviso temático e `--danger`. | Aberto/fechado, autorização/revogação, revisão salva/zero, consentimento desmarcado/marcado, ocupado/erro/sucesso, troca de organização/conta; provedor desligado. |

## Contraste e controles

Contraste calculado por luminância sRGB das cores declaradas para as mensagens de áudio: aviso claro `#825413`/`#fff6e6` = **6,07:1**; aviso escuro `#f4d09a`/`#392d1d` = **9,15:1**. Erro claro `#a92e4c`/`#ffffff` = **6,60:1**; erro escuro `#ffb3c6`/`#241b2e` = **9,85:1**. Conferir o fundo efetivo na integração.

O piso global histórico `p-button` 43 px, `p-button-danger` 38 px e `p-icon-button` 42 px foi comunicado ao coordenador; não é corrigido por exceções locais adicionais. Também ficam com o shell: afastamento da navegação inferior, safe area, footer, scroll-padding e campos focados com teclado virtual. Essa frente não afirma que esses pontos foram resolvidos.

## Validação

- Tipos Node24 e lint focado sem erros.
- 34/34 testes de estado em Node24/26: importação, organizações/projetos, relatórios, áudio e os novos controles de foto.
- Os testes novos executam o JSX/handlers reais da gaveta com HTTP/DOM inertes: botão nomeado nativo, input correspondente, accept/capture preservados, nenhum POST ao abrir seletor, preparação desativa ações e permissão insuficiente não expõe seletores. O teste de relatórios troca assunto e verifica seleção acessível e a consulta correspondente.
- Revisão de práticas React: refs estáveis, eventos nativos sem handlers de teclado duplicados, estado/permissão preservados e nenhuma nova dependência/chamada automática.
- Revisão independente limitada do patch Demandas/sino `9c2c7ba`: leitura do diff e 9/9 testes de estado aprovados. Sem bloqueador identificado no escopo lido; aparência e composição final dependem do CUA integrado.

## Critério para a revisão visual final

Verificar hierarquia/legibilidade, respiro entre blocos, contraste claro/escuro, estados de foco/seleção/erro/ocupado, ações alcançáveis com teclado/toque e último campo/submit visíveis acima da navegação. Exigir 9/10 por avaliação crítica após os ajustes, com cada falha remanescente descrita. Não atribuir a nota antes dessa observação.

## Segunda passagem após medição integrada

O coordenador mediu os botões de ordenação dos cabeçalhos de relatórios em 39 px no desktop e 38 px no mobile, além de disclosures de configuração com 21/37 px. O patch local acrescenta mínimo explícito de 44×44 px aos botões dos `th`, preservando a tabela larga e a rolagem contida. Também eleva a 44 px os summaries de Rotina ChatGPT/Codex, Catálogo institucional, Configuração técnica no servidor, áudio/ditado do assistente e política da conta participante. São alterações de classe/CSS local, sem reset novo e sem mudar handlers ou abertura dos disclosures. Tipos/lint e 18 testes de estado passaram; a medida após integração continua a cargo do coordenador.

**Exceção da agenda:** na primeira passagem real do coordenador, tema escuro e viewport de 375 px, os sete dias mediram **40×84 px**, `documentWidth=360`, sem overflow. A grade mantém sete colunas e a leitura do mês completo; a lista de compromissos e os filtros de período ficam disponíveis como alternativa. Forçar largura de 44 px nesse espaço exigiria comprimir arbitrariamente os gutters/padding ou introduzir rolagem horizontal da grade. O coordenador aceitou preservar essa exceção contextual. Nenhuma dimensão da agenda foi alterada nessa passagem e não se afirma que todos os controles do site têm 44 px uniformemente.

## Terceira passagem: chegar ao trabalho antes das ações raras

Após o coordenador/auditor encontrarem o primeiro cartão de Projetos em y1090, o calendário em y1060 e a tabela de relatórios próxima de y2800 no mobile, foram entregues três incrementos separados:

- `cead9eb`: Projetos mantém busca, abrangência, resumo e Novo projeto; quatro filtros secundários ficam em “Refinar projetos” com contagem ativa. Unidades/tipos ficam em “Administrar catálogo”. Agenda mantém resumo de datas/projeto/categoria e recolhe os cinco filtros e ações raras em “Filtrar período e contexto”. Importação fechada mostra título/ação, sem o parágrafo de orientação; reabrir preserva fonte/estado e mostra a orientação completa.
- `cc94a89`: “Organizações e administração” começa fechado; uma única organização não carrega mais automaticamente a gestão. O detalhe administrativo exige “Gerenciar organização”. Pessoas mantém diretório e oferece atalho para o único formulário de convite, condicionado à permissão existente.
- `016d3ac`: assunto do relatório passa a um **único select nativo em todas as larguras**, substituindo o grupo de botões da etapa anterior. Busca fica visível; colunas, recorte, opt-ins e modelos ficam em disclosure com estado ativo no summary. Alertas de texto livre, medidas e consulta parcial permanecem fora. Tabela/paginação antecedem formatos de exportação e indicadores/gráficos. Os gráficos permanecem montados para a impressão; cálculos, carregamento, escopo e bloqueio de exportação obsoleta não mudaram.

Validação: 33 testes de projetos/agenda/importação em Node24; 13 de organizações/equipe em Node24; 12 de relatórios em Node24/26; rodada composta de estado em Node26 com 36/36. Tipos e lint focado sem erros, com um aviso antigo de imagem em TeamPanel. As novas provas executam componentes/handlers reais e verificam unicidade dos filtros, estado/limpeza, consultas e navegação de mês, convite autorizado, zero leitura administrativa inicial e troca dos dez assuntos com exportação bloqueada até resposta atual. A posição final em pixels e a nota visual continuam pendentes da medição integrada do coordenador.
