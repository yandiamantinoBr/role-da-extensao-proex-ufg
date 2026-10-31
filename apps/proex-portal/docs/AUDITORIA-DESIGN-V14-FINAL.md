# Auditoria independente de design — V14

Data: 31/10/2026. **Estado: reavaliação pendente das recapturas; nota final ainda não emitida.** Publicação V14 não é afirmada por este documento.

Esta revisão compara a base `23bbeae` (V13 `d069c7f`) com a coleta principal `186e44f` e recapturas pontuais de `3fa3222`. A correção posterior `0804314` ainda não tem recaptura. A nota inicial de 6,95/10 permanece registrada em `AUDITORIA-DESIGN-V14-PRELIMINAR.md`; os pesos não foram alterados para a reavaliação. O revisor não implementou as mudanças de design, não operou CUA em paralelo, não iniciou servidor/build e não alterou produção ou serviços externos. A inspeção combina leitura de fonte, comparação visual de PNGs locais e medições da coordenação.

## Rubrica preservada

| Dimensão | Peso | Base | Reavaliação |
| --- | ---: | ---: | --- |
| Hierarquia e próxima ação | 15% | 7,0 | Pendente das últimas recapturas. |
| Espaçamento e densidade | 10% | 7,5 | Pendente das últimas recapturas. |
| Tipografia e legibilidade | 10% | 7,0 | Pendente das últimas recapturas. |
| Contraste e temas | 15% | 6,5 | Pendente das últimas recapturas. |
| Responsividade e toque | 15% | 7,5 | Pendente das últimas recapturas. |
| Consistência de componentes | 10% | 7,0 | Pendente das últimas recapturas. |
| Teclado e semântica | 15% | 6,0 | Pendente das últimas recapturas. |
| Feedback e estados | 10% | 7,5 | Pendente das últimas recapturas. |

## Evidência e comparação

Artefatos privados: `.sites-runtime/production-v14/`, incluindo `measurements-first-pass.json`, `measurements-final.json` e PNGs `final-*`. Não copiar as imagens para o repositório. A coleta principal final informa `codeRevision:186e44f` e `methodVersion:3`, com desktop de 1250×950 e mobile de 375×950, claro e escuro; foram acrescentadas amostras de 320px e estados de trabalho preenchidos. Viewport CSS é verificado pelos metadados, não inferido apenas dos pixels da imagem.

Na primeira leitura do arquivo final havia 90 registros: nenhum overflow do corpo, nenhum campo móvel de edição de texto/seleção abaixo de 16px e somente os dias da Agenda abaixo da meta de 44px. A regra de tamanho da fonte não trata checkbox/radio como campo de digitação. São dias de 40×84px em sete colunas, com lista de registros alternativa; essa exceção contextual foi aceita explicitamente. O método não prova ausência de sobreposição entre elementos: a marca e o sino sobrepostos em 320px foram encontrados visualmente apesar de `overflow:false`.

Os principais ganhos observados são concretos: a repetição do hero do Início foi removida; Projetos passou a mostrar o primeiro cartão perto de 715px, antes próximo de 1090px; Agenda passou a iniciar a grade antes de 550px, antes próxima de 1060px. Materiais permite abrir o detalhe pelo nome visível, sem exigir alcançar a coluna lateral de ações. Relatórios substitui dez botões de assunto por um seletor e mostra as linhas antes de formatos/gráficos; a primeira tabela móvel passou de aproximadamente 2800px para perto de 1100px. Configurações oferece quatro grupos identificáveis, em lugar de uma página inicial de aproximadamente 6476px. As posições são aproximações das capturas comparadas, não garantias para qualquer conteúdo ou dispositivo.

Os diffs mantêm os filtros e seus handlers originais, o resumo do contexto ativo fora dos blocos recolhidos, os guards de permissão e a única montagem de cada painel de backup. Relatórios mantém o vínculo dos dados à consulta atual, validação de resposta, aviso de conteúdo parcial, seleção de colunas e bloqueio das seis exportações enquanto os dados não correspondem ao recorte. A compactação usa `details/summary` nativos e não remove os controles avançados.

## Cobertura das dezesseis famílias

As famílias representam a inspeção do portal; não se afirma que toda combinação possível de dados, papel e estado foi executada. A matriz de quatro contextos foi produzida pela coordenação. O revisor comparou visualmente amostras por família, ampliando para quatro contextos nas famílias mais alteradas, e leu a fonte correspondente.

| Família | Evidência principal e resultado observado | Limite específico |
| --- | --- | --- |
| Estrutura e navegação | `portal-navigation.tsx`, `globals.css`; topbar, menu lateral, navegação inferior, sino com nove avisos e foco visível. Recaptura corrigida de 320px separa a marca do sino. | A coordenação mediu marca terminando em 84px e sino começando em 92px, com 8px de separação. Não equivale a QA de aparelho físico. |
| Início | `dashboard-panel.tsx`; quatro PNGs `final-inicio-*`. Atalhos, indicadores únicos e acompanhamento têm hierarquia coerente; não há mais “EMPRÉSTIMO/S”. | Dados sintéticos, sem análise de personalização de uma equipe real. |
| Projetos e detalhe | `project-panel.tsx`, `project-detail.tsx`; cartões, refinamentos, recorte ativo e formulário. Recaptura corrigida mostra datas, estado Retirado e disponibilidade atual zero do bem emprestado. | As capturas anteriores ao `3fa3222` registram o defeito, não o resultado corrigido. Tabelas extensas continuam usando rolagem interna. |
| Demandas e conferências | `follow-up-panel.tsx`; cinco demandas com estados/prioridades, conferência P/M/G concluída e avaria, organização/equipes. Filtros, ações e detalhe são distinguíveis. | Repetição de avisos no sino permanece melhoria de feedback. |
| Agenda | `calendar-panel.tsx`; quatro contextos, cinco registros de categorias diferentes, período resumido e filtros recolhidos. | Dias de 40×84px são exceção documentada; não declarar meta uniforme de 44px. |
| Materiais e patrimônio | Montagem, drawer e `asset-details-panel.tsx`; catálogo, detalhe, cadastro, aba Fotos e botões reais de câmera/galeria. Nome do item é acesso direto. | Seletor/câmera físicos e envio real de foto não foram executados por este revisor. |
| Brindes e kits | `final-brindes-kits-*`; ofertas, componentes, quantidade/unidade e ação de salvar são identificáveis. | Capturas não provam entrega ou baixa real de estoque. |
| Empréstimos | `final-emprestimos-*`; estado Retirado, datas, disclosure de documentos e formulário móvel legíveis; detalhe do projeto recapturado após correção contratual. | A captura não comprova retirada/devolução real; o erro anterior do detalhe não foi confundido com esta aba. |
| Dinâmicas e atendimento | `campaign-form.tsx`, atendimento e prêmios; evento ativo, atendimento presencial, retirada e preparação de campanha. | Nenhuma participação/entrega real foi criada para a auditoria visual. |
| Registros e documentos | `records-panel.tsx`; registro preenchido, filtro, linha do tempo e anexos visíveis. | Upload/PDF/DOCX têm testes próprios; a imagem não comprova o conteúdo de um arquivo. |
| Equipe e organizações | `final-equipe-*`, gestão organizacional, convite e equipes múltiplas. Administração está recolhida e pessoas/convite são acessíveis antes de abrir a gestão. | Catálogo oficial é referência declarada; não prova vínculo/permissão. |
| Relatórios | `reports-center.tsx`; quatro contextos, Empréstimos com exportadores abertos e Conferências/avarias preenchido. Tabela precede exportação e gráficos. | Verificação dos arquivos exportados fica em prova separada da coordenação. |
| Configurações, Sheets e backup | Grupos Planilha, Backup, Público e Operação; estados abertos claros/escuros e textos de risco preservados. Recapturas conferem botão primário de Planilha (`744be40`) e respiro/títulos de Backup (`1bdae39`). | QA visual não configura gatilhos ou serviços. Não foi gerada chave real para testar apresentação. |
| Conta, foto e privacidade | `profile-panel.tsx`, identidade e privacidade; perfil, campos opcionais, senha e ações de anonimização. | Não testado com leitor de tela nem câmera física. |
| Importação, IA e voz | Prévia patrimonial em 375/320px com destino/proveniência, campos selecionados e confirmação; IA indisponível, configuração e áudio aberto com aviso legível no escuro. | Sem chave real, inferência paga, ditado de pessoa real ou benchmark físico de memória. |
| Público e entrada | Login e erro em português; cadastro fechado, confirmação incompleta, conta não participante e página real do Rolê nos temas. Evento recapturado após `d39e32f`, incluindo Dado/Presencial. | O fechamento do painel Tempo e som tinha 40×40px e recebeu correção posterior `0804314`; falta recaptura. Não foi realizada participação pública real. |

## Fechamento de achados e pendências

Os oito achados da baseline têm correção correspondente na fonte: botões reais para fotos (D01), cores semânticas de áudio (D02), tokens de texto secundário (D03), variante de botão existente (D04), seletor nativo de assunto (D05), áreas acionáveis ampliadas (D06), tema no frame público (D07) e cursor indisponível distinto de processamento (D08). A coordenação informou operação por Enter do nome do material, fechamento/restauração de foco do drawer, sino de 44×44px e retorno de foco por Escape. São provas relatadas da coordenação, não operação de CUA feita pelo revisor.

As recapturas pontuais de `3fa3222` foram inspecionadas e fecham os achados de marca/sino em 320px (`9c37a96`), botão de chave da Planilha (`744be40`), respiro/títulos de Backup (`1bdae39`), controles públicos principais (`d39e32f`) e datas/disponibilidade do detalhe do projeto (`3fa3222`). A coordenação informou 755 testes passando em Node 24 e 26, tipos/lint sem erros e builds Node/Worker concluídos; não houve repetição desses testes pelo revisor visual.

**Gates ainda abertos:** recaptura do botão de fechar de Tempo e som após `0804314`, e ensaio de zoom de 200% nos fluxos críticos. Ao tentar selecionar a janela Chrome para o zoom nativo, o runtime de CUA da coordenação não conseguiu determinar sua URL Windows com segurança e exigiu encerrar o uso visual naquele turno. A interrupção foi respeitada, sem ferramenta alternativa ou bypass. Isso limita a evidência: a aprovação final não será inferida só pelo diff ou pela aprovação de testes. A nota final permanece pendente; nenhum 9/10 foi atribuído neste checkpoint.

**Melhoria residual aberta:** avisos consecutivos da mesma demanda exibem título e estado iguais, sem distinguir a mudança geradora. Na fixture, nove avisos referem-se a quatro demandas e cinco linhas parecem duplicadas. Agrupar por demanda com contagem ou mostrar causa/data curta reduziria o ruído. O problema não bloqueia abertura, leitura, marcação ou fechamento; não foi declarado resolvido.

Não há certificação WCAG nem promessa de ausência de defeitos. As capturas full-page podem deslocar elementos fixos na imagem; esse deslocamento não foi classificado como sobreposição operacional sem confirmação geométrica no viewport. Medições não substituem leitura visual, percurso por teclado, leitor de tela ou aparelho físico. Testes de software e builds relatados pela coordenação são evidências complementares, sem elevar automaticamente uma nota estética/de usabilidade. A roleta livre externa permanece fora do escopo.

Este checkpoint não autoriza publicação ou merge. A coordenação informou que produção permanece na V13/`23bbeae`, com a continuidade registrada separadamente. O próximo turno deve retomar somente os gates pendentes e reaplicar a rubrica, preservando este histórico de evidências.
