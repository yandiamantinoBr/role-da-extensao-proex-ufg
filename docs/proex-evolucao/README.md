# Rolê da Extensão e operações da PROEX

Contexto de continuidade atualizado em 20/10/2026. A evolução mantém o jogo livre e um portal operacional separado. **A V3 foi publicada com sucesso**, versão 3, às 15:55:09 UTC, em https://proex-gestao.yandiamantinobr.chatgpt.site. Fonte publicada no Sites: `db104886f98feebc1b83e30ad35d0390df556d3c`.

Comece pelo [estado atual](ESTADO_ATUAL.md), pela [ADR 0003](ADRS/0003-identidade-e-operacao-v3.md) e pelo [manual do portal](../../apps/proex-portal/README.md). A [entrega V3](../ENTREGA-V3.md) reúne a evidência final. O endereço do Site, sozinho, não identifica a revisão; o commit público do GitHub é um registro separado da fonte publicada.

## Como retomar

1. Confira a branch atual da implementação e leia o estado antes de editar. A branch inicial `docs/proex-evolucao-20261020` contém o planejamento original; não representa o avanço posterior de código.
2. Localize a aplicação em `apps/proex-portal`. Ela tem build, banco e implantação próprios. A roleta livre permanece fora dessa pasta e mantém seu fluxo existente.
3. Use o [prompt mestre](prompts/00_PROMPT_MESTRE.txt) e o prompt da fase necessária como contexto histórico. Quando uma proposta antiga divergir da implementação, siga as ADRs posteriores e o estado registrado. Há sete fases; não é necessário abrir sete chats ao mesmo tempo.
4. Entregue um incremento verificável, atualize a documentação e diferencie teste local, fonte versionada e publicação hospedada. Commit ou PR não substitui deploy com status confirmado.

## O que a V3 acrescenta

O acesso cotidiano usa e-mail e senha com Better Auth e cadastro por convite. O login nativo ChatGPT fica limitado à migração explícita das contas anteriores. Perfis, bloqueio de contas, funções por projeto, edição de projetos/materiais, registros e agenda complementam campanhas, estoque, empréstimos e relatórios. IDs canônicos preservam o histórico entre métodos de autenticação; e-mails iguais não unem contas.

O painel apresenta permissões por contexto e atualiza sua leitura pelo servidor. Alterações operacionais são confirmadas no D1; o navegador não é a fonte oficial de saldo, autorização ou resultado. Documentos e fotos ficam no R2 privado. O time usa contas individuais e links manuais de convite/recuperação; não existe envio automático de e-mail.

## Papel de cada ferramenta

| Ferramenta | Papel atual |
| --- | --- |
| GitHub | Histórico de código, documentação, revisão e verificações |
| Portal | Operação da equipe e páginas oficiais das campanhas |
| D1 | Fonte compartilhada de registros, permissões e autenticação |
| R2 privado | Termos, anexos e fotos autorizadas |
| Google Calendar | Consumo de arquivo ou assinatura ICS de leitura |
| Google Sheets | Importação manual de CSV; integração automática permanece futura |

ICS não é OAuth Google, envio direto para a agenda nem sincronização bidirecional. O cliente externo decide quando atualizar e pode manter cópias após revogação. A conexão do autor com Drive ou outros plugins não cria credenciais permanentes para o portal.

## Decisões e limites

A repetição Tente novamente já é configurável de zero a três por campanha e precisa constar no regulamento. Super Super Brinde, composição definitiva do planner, estoque real, catálogo público de brindes, retenção e fluxo institucional para menores continuam pendentes. Não preencher esses campos com números ou regras inventadas.

Instagram é link opcional: não há verificação Meta de seguimento, condição de seguir para jogar ou contagem comprovada de novos seguidores. Google OAuth, SMTP, login WhatsApp, SEI/SIGAA e sincronização automática Sheets não estão ativos. Contribuições pessoais para alimentação e operações financeiras não pertencem à implementação atual.

## Histórico preservado

- [Plano original](PLANO.md): organização inicial das demandas e fases; o PDF citado nos primeiros prompts pertence ao pacote original.
- [ADR 0001](ADRS/0001-arquitetura-e-ambientes.md): proposta condicional de infraestrutura externa.
- [Verificação da fase 01](FASE_01_VERIFICACAO.md): preservação do jogo e núcleo independente de acessos.
- [ADR 0002](ADRS/0002-portal-nativo-sites.md): portal dedicado com identidade nativa e publicação V2.
- [ADR 0003](ADRS/0003-identidade-e-operacao-v3.md): identidade por senha e evolução operacional V3.
- [Infraestrutura](INFRAESTRUTURA.md): configuração atual e levantamento histórico separado.

Este pacote não deve conter senhas, tokens, URLs privadas de convite/agenda, termos assinados ou dados reais de participantes. A emissão de convite exige destinatário, função e escopo definidos; a equipe continua responsável por conferir a pessoa e o canal de entrega.
