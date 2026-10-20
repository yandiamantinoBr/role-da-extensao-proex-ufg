# ADR 0001 Arquitetura e ambientes da evolução PROEX

Data: 20/10/2026. Estado: decisão para a fase 01; provisionamento e entrada em produção ainda pendentes.

## Contexto

A roleta livre já funciona no Sites e possui build estático para GitHub Pages. O portal futuro precisa de contas, permissões por projeto, convites, registros compartilhados e arquivos privados. A experiência livre deve continuar independente desses serviços. As conexões acessíveis foram consultadas somente para leitura: nenhum projeto exclusivo PROEX/Rolê foi encontrado. Isso não demonstra inexistência de infraestrutura na UFG ou em contas não conectadas.

## Decisão

Preservar os endereços, o jogo e os builds atuais. O Sites mantém sua autenticação nativa; não substituir sua pilha por OAuth improvisado. GitHub Pages permanece publicação estática do modo livre, sem assumir funções de servidor ou banco.

Preparar o portal oficial como aplicação separada, em hospedagem compatível com o provedor de identidade escolhido. Reutilizar componentes e regras que possam ser compartilhados sem alterar a experiência livre. Manter inicialmente o mesmo repositório, com entradas, configuração e implantação isoladas. A escolha da hospedagem não autoriza transportar o build Worker para outro runtime sem verificar compatibilidade.

Usar banco transacional exclusivo PROEX, autenticação gerenciada e armazenamento privado. Supabase é candidato condicional para PostgreSQL, Google/e-mail e arquivos; não constitui serviço já criado ou escolhido contratualmente. Não reutilizar banco, organização operacional ou credenciais de projetos alheios. A titularidade e os acessos devem ser transferíveis à instituição.

O banco será fonte oficial de participações, estoque e empréstimos. Sheets será projeção de consulta ou entrada validada, sem sincronização bidirecional irrestrita. Registros reais não entram no repositório público. Nenhum recurso foi provisionado, contratado ou alterado neste levantamento.

## Ambientes

| Ambiente | Uso | Identidade e dados |
| --- | --- | --- |
| Jogo livre atual | Uso público ilimitado | Comportamento existente; sem registro oficial inferido |
| Desenvolvimento isolado | Contratos e testes de autorização | Dados sintéticos; sem login falso em produção |
| Homologação futura | Validar integração e atendimento completo | Recursos exclusivos e credenciais próprias; testes identificados |
| Produção futura | Operação institucional | Regras, responsáveis, infraestrutura e guarda definidos |

## Consequências

A separação preserva o jogo durante falhas ou evolução do portal, mas adiciona configuração de domínio, callbacks e operação. Banco, SMTP, OAuth, backups, região e custos precisam ser definidos antes da homologação integrada. Contratos, autorização e testes podem avançar sem essas credenciais, explicitando que não há autenticação real configurada.

A implementação deve negar acesso sem vínculo válido e verificar escopo no servidor. Revogação, convites de uso único e isolamento entre projetos não podem depender de menus ocultos ou campos editáveis do usuário. O próximo ADR registrará provedor, hospedagem e responsáveis concretos quando disponíveis.
