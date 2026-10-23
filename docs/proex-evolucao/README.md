# Rolê da Extensão e operações da PROEX

Contexto atualizado em 23/10/2026. **A V4 foi publicada com sucesso**, versão 4, no portal https://proex-gestao.yandiamantinobr.chatgpt.site. A fonte publicada no Sites é `ae50c4eab331f74057c60dd487167af1b9925410`; a revisão pública GitHub é uma evidência separada. A branch `feat/proex-v4` parte de `origin/main` observado em `ff27166`, após a integração das PRs #1, #2 e #3.

Comece pelo [estado atual](ESTADO_ATUAL.md), pela [entrega V4](../ENTREGA-V4.md), pela [ADR 0004](ADRS/0004-monorepo-catalogo-e-integracao-v4.md) e pelo [manual operacional](../../apps/proex-portal/docs/MANUAL-PROEX.md). O [README do portal](../../apps/proex-portal/README.md) contém o contrato técnico. Endereço do Site, revisão pública e revisão publicada são evidências diferentes.

## Como retomar

1. Confira a branch, o estado documentado e a revisão realmente publicada antes de editar. A branch inicial de planejamento e os prompts antigos são contexto histórico.
2. Trabalhe no portal em `apps/proex-portal`, com manifesto, dependências, banco, arquivos e deploy próprios. A raiz e `github-pages` continuam pertencendo ao jogo livre.
3. Preserve os 12 arquivos protegidos pelo baseline `f905f0d78371dc4a8784cce27bdbc7ef6fa88103`. Esse baseline não é a posição atual de main. Não recrie o Site nem substitua IDs canônicos por e-mail.
4. Leia as notas atuais antes do [prompt mestre](prompts/00_PROMPT_MESTRE.txt) e do roteiro da fase. ADRs posteriores e evidência de execução prevalecem sobre propostas antigas.
5. Registre código, testes, fonte publicada e verificação hospedada da mesma revisão. Configuração de conexão e deploy não comprovam que uma rotina externa foi executada.

## Evolução V4

O acesso habitual permanece por senha e conta ativada. Nome de usuário e CPF são atalhos opcionais da mesma senha, não SSO nem prova de identidade. Perfis recebem metadados opcionais e fotografia privada. Solicitações de anonimização têm revisão, limpeza e tombstone, sem apagar indiscriminadamente o histórico ou documentos de terceiros.

Projetos têm tipos configuráveis, etapa no catálogo e hierarquia sem herdar privilégios. O detalhe reúne links, editais, cronologia e relações operacionais autorizadas. Metadados são versionados; restauração cria uma revisão nova. Categorias de apresentação dos materiais não substituem as classes e regras operacionais. A agenda inclui as atividades dos projetos.

O catálogo pesquisado em fontes oficiais separa programas atuais, referências históricas, projetos, congresso e fomento. O pré-cadastro autorizado preserva registros existentes e cria itens ausentes com saldo zero. O pré-cadastro foi executado em produção: 9 iniciativas novas e 1 preservada (10 no total), 4 tipos, 4 editais em rascunho e 11 materiais novos com estoque zero. Não foram fabricados participantes, empréstimos, entregas ou histórico de movimentos. Não foram fabricados participantes, empréstimos, entregas, eventos realizados ou saldo a partir de notícias.

## Recursos e integração externa

| Recurso | Estado registrado |
| --- | --- |
| Portal / D1 / R2 | V4 publicada; operação transacional e arquivos privados |
| GitHub / monorepo | Código, documentação, testes e migrações; aplicações com deploy separado |
| Calendar | Download ou assinatura ICS de leitura, sem OAuth ou edição inversa |
| Planilha / Drive | Configuração concluída; 32 abas; 118 linhas exportadas; leitura de retorno de 27 tabelas e 118 linhas-base verificada |
| MCP do portal | Ferramentas disponíveis e usadas num contexto novo de nuvem; rotina periódica ativa |

**Configuração e agendamento não comprovam sincronização por si só.** Nesta entrega, o fluxo real independente concluiu em 23/10/2026 às 14:14:59 UTC, com 118 linhas exportadas, 27 tabelas e 118 linhas-base verificadas por leitura de retorno, zero alterações importadas e zero conflitos. A conexão foi conferida habilitada e a rotina periódica está ativa; a atualização não é instantânea.

A edição de metadados e a aba Operações estão disponíveis, mas não havia alterações externas pendentes: zero operações foram importadas. Portanto, esta execução comprova exportação e leitura de retorno, sem constituir teste de uma alteração feita no Sheets e aplicada no portal. Não havia anexos ou limpezas pendentes nessa execução. Objetos privados e recuperação precisam de verificação própria; a planilha não é backup integral. IDs e URLs privados ficam no handoff autorizado.


## Limites

Instagram permanece link opcional: não há comprovação Meta de seguidores ou condição de seguir para participar. OAuth Google, SMTP, login WhatsApp/Facebook/Instagram, SEI/SIGAA, assinatura certificada e contribuições financeiras não são anunciados como ativos. ICS não oferece atualização imediata garantida nem apaga cópias externas ao revogar o link.

Estoque real, composição do planner, ofertas, regulamentos, fluxo para menores, retenção, suporte e recuperação exigem validação institucional. Super Super Brinde continua sem regra implementada. Revisão de interface não equivale a câmera ou operação testada em aparelho físico. Esta documentação não reativa tarefas antigas Windows/Sites.

## Histórico preservado

- [Plano original](PLANO.md) e [modelo proposto](MODELO_E_CONTRATOS.md): hipóteses e organização inicial das demandas.
- [ADR 0001](ADRS/0001-arquitetura-e-ambientes.md): alternativas condicionais de infraestrutura.
- [Verificação fase 01](FASE_01_VERIFICACAO.md): núcleo independente e preservação do jogo.
- [ADR 0002](ADRS/0002-portal-nativo-sites.md): portal dedicado e publicação V2.
- [ADR 0003](ADRS/0003-identidade-e-operacao-v3.md) e [entrega V3](../ENTREGA-V3.md): identidade por senha e publicação anterior confirmada.
- [Infraestrutura](INFRAESTRUTURA.md): configuração atual e evidências históricas separadas.

Código público não implica dados públicos. Este pacote não recebe senhas, tokens, URLs privadas de convite/agenda, termos assinados, pastas privadas de operação ou dados reais de participantes.
