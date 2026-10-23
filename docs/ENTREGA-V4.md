# Entrega V4 — Catálogo, operação e integração PROEX

Preparado em 23/10/2026, na branch `feat/proex-v4`, a partir de `origin/main` em `ff27166`. As PRs anteriores #1, #2 e #3 já foram integradas à base. **A V4 foi publicada com sucesso, versão 4**, no Site existente. A V3 permanece como histórico em [ENTREGA-V3.md](ENTREGA-V3.md). O seed e a sincronização inicial de produção foram concluídos e verificados separadamente do deploy, conforme os registros abaixo.

| Evidência final | Estado deste registro |
| --- | --- |
| Fonte da V4 publicada no Sites | `ae50c4eab331f74057c60dd487167af1b9925410` |
| Versão, implantação e estado final | 4 · `appgdep_6adb69136e7c8191a68c74e6e0b09288` · succeeded |
| Revisão pública GitHub / PR | Snapshot em `apps/proex-portal` nesta revisão; integração pela PR da branch `feat/proex-v4` |
| Testes completos, TypeScript e build final | Portal 255/255; raiz 33/33; TypeScript e build passaram |
| Runtime e verificação hospedada | Smoke do Worker compilado com aliases e MCP passou; publicação nativa confirmada. Piloto institucional e aparelho físico continuam separados |
| Planilha, pastas e acesso institucional | Configuração concluída; planilha privada com 32 abas; endereços somente no handoff autorizado |
| Sincronização externa sem visitante | Execuções independentes concluídas em 23/10/2026 às 14:14:59 e 14:22:45 UTC; conexão habilitada; rotina periódica ativa |
| Exportação e leitura de retorno | Primeira execução: 118 linhas e 118 linhas-base; segunda: 130 linhas exportadas; 27 tabelas e linhas-base relidas; zero conflitos |
| Importação de alterações externas | Três descrições de buttons editadas pela planilha, aplicadas por versão, conferidas no portal e reexportadas; estoque zero; zero conflitos |
| Catálogo em produção | 9 iniciativas novas + 1 preservada; 4 tipos; 4 editais em rascunho; 11 novos materiais com estoque zero |

O endereço previsto é o portal de gestão existente, https://proex-gestao.yandiamantinobr.chatgpt.site. Esse endereço sozinho não identifica uma revisão; a fonte e o retorno nativo acima identificam a publicação V4. O snapshot público fica em `apps/proex-portal`; a aplicação tem implantação própria, separada do jogo livre. Leia a [ADR 0004](proex-evolucao/ADRS/0004-monorepo-catalogo-e-integracao-v4.md).

## Recursos preparados

A navegação organiza operação, projetos, materiais, empréstimos, registros, equipe e relatórios para uso móvel. Tema claro, escuro e preferência do sistema acompanham as telas. O perfil reúne nome, foto privada e campos opcionais de unidade, cargo/função e telefone. Selecionar uma câmera no navegador não comprova funcionamento em um aparelho físico; o piloto precisa registrar essa evidência.

O acesso continua baseado em contas previamente ativadas e senha. Nome de usuário e CPF são atalhos opcionais, com a mesma senha, configurados pela própria pessoa com confirmação da senha e ciência do aviso. Não são SSO UFG nem prova de titularidade. O CPF não é exibido em relatórios ou planilhas; a busca usa identificador criptográfico. E-mail permanece disponível, e os atalhos podem ser removidos.

A própria pessoa pode solicitar anonimização. O responsável analisa antes da execução. O processo remove dados da conta, identificadores de entrada, credenciais e foto, preservando contagens e histórico operacional com identificador interno. Termos, textos e anexos de terceiros não desaparecem automaticamente. Há controle de limpeza de objetos e tombstone para impedir reativação ou recriação de dados pessoais da conta anonimizada. Esse fluxo não substitui a política institucional de retenção e atendimento de direitos.

Projetos recebem tipo configurável, etapa no catálogo e vínculo superior. Programa, projeto, evento e referência são conceitos distintos. A relação hierárquica não herda permissões e não pode formar ciclos. Acessar projeto abre detalhe interno com fontes, links, editais, cronologia e relações operacionais autorizadas. Edição busca a revisão atual; alterações simultâneas são recusadas pelo controle de versão.

Links, editais e atividades têm metadados versionados. Editais podem se relacionar com vários projetos; alterações exigem autoridade atual em todos os vínculos envolvidos. Restaurar metadados cria uma revisão nova, sem reduzir o contador de versão ou reverter resultados, estoque, arquivos ou empréstimos. Materiais conservam classes operacionais e permitem categorias de apresentação configuráveis.

## Referências institucionais e pré-cadastro

O catálogo foi pesquisado em fontes públicas oficiais em 23/10/2026. Ele distingue [programas da gestão 2026–2029](https://proex.ufg.br/p/62169-programas-de-extensao-2026-2029), [referências da gestão 2022–2025](https://proex.ufg.br/p/60604-programas-de-extensao-2022-2025), [Rolê da Extensão](https://proex.ufg.br/p/60194-role-da-extensao) e [Curta o Campus](https://proex.ufg.br/p/26615-projeto-curta-o-campus). CONPEEX é tratado como congresso/evento; PROBEC, como programa de fomento. Editais não viram projetos automaticamente.

O pré-cadastro usa os serviços de domínio, com chaves idempotentes, preserva cadastros encontrados e cria itens ausentes com estoque zero. Comparação de nomes considera Unicode. Referências históricas não são marcadas como encerradas apenas por não estarem no índice atual. Não são fabricados saldos, empréstimos, participantes, entregas, campanhas ou execução de atividades. Datas e notícias editoriais não são importadas como operações realizadas.

A equipe precisa conferir a contagem física, as características dos materiais, a composição dos kits, os regulamentos e o aviso institucional antes de operar campanhas. Não há decisão automática sobre Super Super Brinde ou composição definitiva do planner. O pré-cadastro foi executado em produção: 9 iniciativas novas e 1 preservada (10 no total), 4 tipos, 4 editais em rascunho e 11 materiais novos com estoque zero. Não foram fabricados participantes, empréstimos, entregas ou histórico de movimentos.

## Agenda, planilha e Drive

A agenda continua separando empréstimos, materiais, projetos/eventos e consumo, agora incluindo as atividades do detalhe de projeto. Histórico de estoque não cria compromisso futuro. Registros ligados a empréstimos exigem a permissão correspondente no mesmo projeto, inclusive em feeds de outra categoria.

Download e assinatura ICS são de leitura. A URL privada tem escopo, prazo, revogação e revalidação da conta. O Google decide quando buscar atualizações; editar o Calendar não altera o portal. Revogação impede novas consultas, mas não apaga cópias recebidas. Não há OAuth Google ou gravação direta de eventos nesta revisão.

O formato portátil oferece tabelas e campos declarados, paginação com digest, operações com chave estável, recibos e controle de conflitos. Metadados editáveis passam por versão e regras de domínio. Movimentos operacionais são append-only; resultados, saldos calculados e concessões de acesso não são livremente editáveis na planilha. Nomes técnicos, cabeçalhos, IDs, versões e hashes devem ser preservados.

**Configuração e agendamento, sozinhos, não comprovam sincronização.** Nesta entrega houve a evidência adicional: as ferramentas MCP ficaram disponíveis num contexto novo de nuvem, a configuração e o pré-cadastro foram executados e o fluxo real foi conferido.

Em 23/10/2026, às 14:14:59 UTC, a primeira execução real em contexto de nuvem independente concluiu a exportação de 118 linhas, com leitura de retorno das 27 tabelas e 118 linhas-base verificadas no Google Sheets. Foram aplicadas zero alterações externas e registrados zero conflitos. A conexão foi conferida habilitada e o histórico confirmou conclusão. A rotina periódica está ativa; a atualização não é instantânea.

Em uma segunda execução, concluída em 23/10/2026 às 14:22:45 UTC, três descrições de buttons foram alteradas pela planilha para registrar cor e diâmetro de 2,5 cm conforme informado pelo usuário. A importação por controle de versão aplicou as três alterações, sem conflitos. A leitura do portal confirmou as descrições e o incremento de uma versão por material, com estoque ainda zero. Após reexportar materiais, auditoria e versões, houve nova leitura das 27 abas de tabelas e das linhas-base. O registro dessa execução concluiu com 130 linhas exportadas, três alterações aplicadas e zero conflitos: o percurso planilha → portal → planilha foi verificado para esses metadados. A aba Operações continua disponível; o teste real acima validou edição de metadados, sem representar homologação de todos os tipos de operação.

A planilha tem 32 abas, incluindo as tabelas declaradas e abas auxiliares. Não havia anexos para copiar nem pendências de limpeza nessa execução: zero anexos e zero limpezas. Isso não demonstra restauração de um arquivo real. A planilha portátil continua sem equivaler a backup integral do D1 e do R2; objetos privados e recuperação exigem verificação própria. Acompanhar as próximas execuções e seus conflitos; rotina periódica não garante propagação imediata.


## Verificação e operação

As verificações focadas executaram SQL real das migrações, serviços de domínio, concorrência, CAS, versões, escopos, feeds e pré-cadastro. Os testes do catálogo verificam estoque inicial zero, preservação de dados manuais e repetição/concorrência sem duplicação. A execução final registrada para esta revisão aprovou 255 testes do portal, 33 da raiz, TypeScript, build e smoke do Worker compilado com aliases e MCP. A publicação nativa foi confirmada separadamente. A sincronização inicial real externa tem a evidência específica acima; os testes locais não a substituem. Isso também não comprova captura por câmera física ou homologação institucional completa. A importação real foi verificada separadamente para as três descrições acima; outros tipos de operação exigem sua própria evidência. A contagem V3 continua restrita ao registro V3.

O [manual operacional](../apps/proex-portal/docs/MANUAL-PROEX.md) e o [README do portal](../apps/proex-portal/README.md) orientam primeiro acesso, convites, materiais, campanhas, agenda e planilha. O [estado atual](proex-evolucao/ESTADO_ATUAL.md) deve ser atualizado após a publicação. A roleta livre mantém seu Site e GitHub Pages; os 12 arquivos protegidos continuam vinculados à referência `f905f0d78371dc4a8784cce27bdbc7ef6fa88103`.

Não são anunciados como ativos: verificação de seguidores Instagram, login WhatsApp/Facebook/Instagram, envio SMTP automático, integração SEI/SIGAA, assinatura eletrônica certificada, contribuições financeiras. Documentos públicos não recebem credenciais, dados pessoais, termos assinados, tokens ou endereços privados de operação.
