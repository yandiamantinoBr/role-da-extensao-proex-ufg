# Infraestrutura e dependências da PROEX

## V4 publicada — integração inicial verificada

Atualização de 23/10/2026. A V4 conserva o portal dedicado, D1 e R2 e acrescenta metadados de catálogo/projetos, identificadores opcionais, privacidade e serviços de integração portátil. Não foi provisionado outro banco nem transferida a operação para um serviço externo por esta decisão. Consulte a [ADR 0004](ADRS/0004-monorepo-catalogo-e-integracao-v4.md) e o [registro de entrega](../ENTREGA-V4.md).

O portal público permanece em `apps/proex-portal`, com manifesto e deploy próprios; os comandos da raiz pertencem ao jogo livre. Migrações novas devem ser revisadas e aplicadas pelo fluxo da publicação, sem reescrever SQL já aplicado. A publicação V4 foi confirmada: versão 4, fonte `ae50c4eab331f74057c60dd487167af1b9925410`, implantação `appgdep_6adb69136e7c8191a68c74e6e0b09288`, estado succeeded. A revisão final passou em 255 testes do portal, 33 da raiz, TypeScript, build e smoke compilado com aliases e MCP. As contagens V3 abaixo permanecem históricas.

A V4 mantém `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET` e `OWNER_EMAIL` no runtime, sem valores em código ou documentação. O segredo estável também participa dos identificadores criptográficos de entrada e da emissão idempotente de convites. Mudança deliberada de segredo exige plano de continuidade; não copiar valores para planilhas, prompts ou logs.

A configuração de Sheets referencia planilha e pastas privadas. Os valores ficam no runtime e no handoff autorizado. As ferramentas MCP ficaram disponíveis em um contexto novo de nuvem, permitindo a configuração e o pré-cadastro de produção. O pré-cadastro foi executado em produção: 9 iniciativas novas e 1 preservada (10 no total), 4 tipos, 4 editais em rascunho e 11 materiais novos com estoque zero. Não foram fabricados participantes, empréstimos, entregas ou histórico de movimentos.

Em 23/10/2026, às 14:14:59 UTC, uma execução real em contexto de nuvem independente concluiu a exportação de 118 linhas, com leitura de retorno das 27 tabelas e 118 linhas-base verificadas no Google Sheets. Foram aplicadas zero alterações externas e registrados zero conflitos. A conexão foi conferida habilitada e o histórico confirmou conclusão. A rotina periódica está ativa; a atualização não é instantânea.

A edição de metadados e a aba Operações estão disponíveis, mas não havia alterações externas pendentes: zero operações foram importadas. Portanto, esta execução comprova exportação e leitura de retorno, sem constituir teste de uma alteração feita no Sheets e aplicada no portal. A planilha possui 32 abas; não havia anexos para copiar ou limpezas pendentes. Configuração e agendamento não substituem a evidência de execução acima. Acompanhar as próximas execuções; indisponibilidade externa e conflitos podem atrasar a propagação. Backup e restauração de objetos R2 precisam de verificação própria, além da leitura da planilha.


O registro histórico seguinte documenta a publicação V3 anterior. Custos e opções de infraestrutura datados de 20/10/2026 continuam históricos, sem atualização de preço ou contratação implícita pela V4.


## Histórico — configuração V3 publicada

Decisão atual: [ADR 0003](ADRS/0003-identidade-e-operacao-v3.md), de 20/10/2026. A V3 mantém o Site dedicado, D1 e R2, e acrescenta autenticação por e-mail e senha com Better Auth. **Publicação versão 3 confirmada com sucesso em 20/10/2026, às 15:55:09 UTC**, revisão de ambiente 2. A [ADR 0002](ADRS/0002-portal-nativo-sites.md) documenta a V2 anterior com login nativo.

| Recurso ou configuração | Uso efetivo na V3 |
| --- | --- |
| Site dedicado | Worker Vinext no projeto `appgprj_6ad777bf0b288191a60d90401ac71d25`; fonte publicada `db104886f98feebc1b83e30ad35d0390df556d3c` |
| Binding `DB` | D1: operação, perfis, identidades canônicas, vínculos, credenciais e sessões |
| Binding `BUCKET` | R2 privado: termos, anexos operacionais e fotos de perfil |
| `BETTER_AUTH_URL` | Origem HTTPS autorizada do portal, no servidor |
| `BETTER_AUTH_SECRET` | Segredo de autenticação e emissão idempotente de convites, somente no servidor |
| `OWNER_EMAIL` | Bootstrap histórico pela ponte nativa; não cria administrador por coincidência de e-mail num cadastro por senha |

O manifesto preserva seu `project_id` e os bindings. O jogo livre e sua implantação permanecem separados. Não se utiliza banco do Kino Campus. O repositório guarda código, esquema e migrações; não recebe credenciais, sessões, objetos privados ou a base operacional.

Better Auth e seu adaptador Drizzle estão fixados em `1.7.7` nesta revisão. Tabelas de autenticação são separadas das permissões PROEX. IDs de provedor se associam ao ID canônico sem correspondência automática de e-mail. ChatGPT participa apenas da ponte explícita para definir a primeira senha de identidades anteriores; não é a entrada cotidiana da V3.

Novas contas dependem de convite e o destinatário escolhe a própria senha. Convites e recuperação geram links privados para compartilhamento manual pelo responsável autorizado. Sem SMTP, não se anuncia verificação da caixa de e-mail nem envio automático. Bloqueio e fluxos de senha revogam sessões conforme a implementação; as permissões continuam verificadas nos registros do portal.

As migrações 0000/0001 pertencem à base V2. A V3 acrescenta 0002/0003, com autenticação, perfis e estado de ativação, em alterações aditivas que preservam dados e triggers. Não reescrever SQL aplicado nem importar fixtures de QA na produção. Banco local, bancos temporários de teste e banco hospedado são ambientes distintos.

Perfis e documentos usam rotas privadas autorizadas. Avatares são preparados em PNG e processados pelo servidor. URLs ICS são credenciais de assinatura: têm escopo, prazo e revogação, e não devem aparecer no GitHub ou em capturas. Google Calendar consome **ICS de leitura**, sem OAuth nem escrita de eventos na conta Google. O cliente externo controla a frequência de atualização.

O lote final registrado tem 179/179 testes, TypeScript/build e smoke do Worker compilado em Miniflare/workerd aprovados. A implantação nativa é `appgdep_6ad78ec1db0c81919b6e4ef6588d8491`. A revisão visual usou desktop e largura de 390 pixels com dados sintéticos. Isso não comprova câmera real, operação institucional com dados reais ou política de backup homologada.

SMTP, sincronização automática Sheets e aplicativo Meta para confirmar seguidores não estão configurados. CSV não é sincronização de banco. Custos, limites do Sites/D1/R2, titularidade, domínio, retenção, backups e suplência administrativa exigem acompanhamento próprio; esta revisão não estabelece valor mensal, contratação ou gratuidade. PostgreSQL continua alternativa de migração com adaptação explícita de SQL, identidade, arquivos e testes.

## Levantamento histórico e alternativas condicionais

O conteúdo a seguir é o levantamento anterior. Preços e variáveis propostos são referências históricas datadas, não serviços contratados nem configuração necessária para executar a V3.

Atualização executada: o portal usa Sites + D1 + R2 + login nativo ChatGPT; consulte [ADR 0002](ADRS/0002-portal-nativo-sites.md). O levantamento e as opções condicionais abaixo são históricos, não a configuração implantada.

Levantamento de 20/10/2026, somente leitura. Nenhum projeto exclusivo PROEX/Rolê foi encontrado nos recursos Supabase e Vercel acessíveis. Os serviços institucionais fora dessas conexões não foram inspecionados. Não foram consultados segredos nem modificados recursos alheios. A arquitetura está em [ADR 0001](ADRS/0001-arquitetura-e-ambientes.md).

## Configuração a definir

Os nomes abaixo são propostas de contrato, sem valores. Parte da configuração pode residir no painel do provedor, em vez de variáveis do aplicativo. Confirmar nomes efetivos na implementação; não criar arquivos contendo credenciais a partir desta tabela.

| Nome proposto | Finalidade e local | Responsável proposto |
| --- | --- | --- |
| `PROEX_APP_URL` | Origem oficial e retornos autorizados | Responsável técnico e gestor institucional |
| `PROEX_AUTH_PROVIDER` | Provedor escolhido para o portal | Responsável técnico |
| `NEXT_PUBLIC_SUPABASE_URL` | Endpoint público, se Supabase for escolhido | Responsável técnico |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Chave pública limitada por políticas | Responsável técnico |
| `SUPABASE_SECRET_KEY` | Operações privilegiadas estritamente no servidor | Administrador do serviço |
| `DATABASE_URL` | Conexão de manutenção/migrações, protegida | Administrador do banco |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Aplicativo OAuth e configuração no provedor | Administrador institucional de identidade |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Envio transacional autenticado | Administrador institucional de e-mail |

Valores privilegiados nunca vão ao navegador, GitHub, logs ou documentação. Os ambientes terão credenciais distintas. Domínio, conta proprietária, região, guarda, backups e suplência administrativa continuam sem definição. Google OAuth, SMTP e envio de convites não foram configurados ou testados.

O SMTP padrão do Supabase tem restrições de destinatário e não é destinado à produção. Login por código/link e convites para o público exigem envio próprio compatível. A documentação recomenda configurar SMTP e controles de abuso; a conexão de e-mail disponível ao autor no chat não substitui essa infraestrutura. Fonte oficial: [Send emails with custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

## Custos de referência

Valores públicos em USD, consultados em 20/10/2026; não representam a fatura atual nem contratação. Não foi feita conversão cambial. Uso excedente, impostos, SMTP, domínio e recursos opcionais podem acrescentar custos.

| Cenário condicional | Referência oficial e limitação |
| --- | --- |
| Supabase Free para experimento | US$0; pausa após uma semana de inatividade, limite de dois projetos ativos, sem backup automático. Elegibilidade não verificada. |
| Supabase Pro dedicado | A partir de US$25/mês, primeiro projeto incluído; adicionais a partir de US$10/mês. Consumo e configuração alteram o total. |
| Vercel Pro para portal compatível | Referência de US$20/mês; assentos e uso podem alterar o total. Compatibilidade do aplicativo ainda precisa ser validada. |

Fontes: [Supabase Pricing](https://supabase.com/pricing) e [Vercel Pricing](https://vercel.com/pricing). O [Vercel Hobby](https://vercel.com/docs/plans/hobby) é restrito a uso pessoal não comercial; não presumir adequação ao serviço institucional. O menor esforço nesta fase é concluir código e testes independentes de provedor, sem contratar serviços. Antes de homologação, identificar infraestrutura autorizada e comparar seu custo e responsabilidade operacional com as alternativas acima.
