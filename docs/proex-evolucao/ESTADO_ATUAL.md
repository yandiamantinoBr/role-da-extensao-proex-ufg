# Estado atual da evolução PROEX

Data: 20/10/2026. Branch de implementação: `feat/proex-access-foundation`, baseada na documentação `docs/proex-evolucao-20261020`. Fase 01 executada e primeiro incremento independente da fase 02 implementado. Sem alteração de main, do jogo ou da publicação atual.

## Evidências atualizadas

- GitHub main permanece em `f905f0d78371dc4a8784cce27bdbc7ef6fa88103`, árvore `d07a71a224e5ee9e73b73da9098fd00c3af29749`.
- Fonte Sites reaberta pelo fluxo nativo; sua árvore coincide exatamente com a árvore pública acima. O histórico privado não foi copiado para GitHub.
- Sites público ativo na versão 7, project_id `appgprj_6ac62af904348191af733a95a71534db`. Sites e Pages responderam HTTP 200 e o título esperado no teste de disponibilidade.
- Manifesto com `d1=null` e `r2=null`; schema operacional vazio. Automação Sites vinculada continua desabilitada. Sincronização Windows não testada nem reativada.
- Nenhum projeto exclusivo PROEX encontrado nas conexões Supabase/Vercel acessíveis. Isso não prova ausência de infraestrutura institucional fora dessas conexões.
- Releases e licença global do projeto continuam pendentes. Licenças de terceiros e marcas preservadas.

## Entregue em código

- `lib/proex/access`: autorização com negação por padrão, escopos, validade, revogação e teto explícito de delegação.
- Serviço de convites com emissão, aceite, revogação de convites pendentes, revalidação da autoridade do emissor, vínculo ao e-mail verificado e auditoria sem token. Persistência, relógio, hash e geração de identificadores/tokens são portas injetadas.
- 25 testes do núcleo, com repositório serializado exclusivamente de teste; 8 testes de preservação do jogo. Dados sintéticos e nenhuma mensagem real enviada.
- Scripts de verificação e workflow de PR sem publicação. Baseline de 12 arquivos, ADR de arquitetura e matriz de infraestrutura sem segredos.

## Validação e limites

33 testes e TypeScript passaram. Builds Pages e Worker passaram; evidências estão em `FASE_01_VERIFICACAO.md`. Na prévia desktop, configurações, bloqueio durante giro e resultados da roleta/dado foram observados; correspondência de todas as faces foi verificada por testes. Não houve nova prova auditiva humana nem teste em aparelho móvel real. Erros capturados no console eram da extensão do navegador, sem erro do aplicativo identificado naquela amostra.

Este incremento não é painel administrativo utilizável. Autenticação real, APIs, banco, persistência transacional, envio de convite e interface administrativa não foram integrados. Concorrência/rollback da fixture não comprovam concorrência de banco em produção. Revogar convite já aceito não revoga o vínculo: esse fluxo e a proteção do último responsável ainda precisam ser implementados transacionalmente. Nenhuma garantia de segurança do sistema completo é inferida destes testes.

## Próximo incremento

Completar a fase 02: escolha e configuração de infraestrutura exclusiva PROEX, adapter de identidade confiável, persistência com restrições/locks, revogação de vínculos e último responsável; depois APIs e interface móvel. Google OAuth e SMTP institucional são dependências reais, ainda sem configuração. Até lá, continuar contratos e testes isolados sem login simulado ou dados reais.

## Pendências de negócio

Escopo de uma participação; Tente novamente; Super Super Brinde; catálogo, saldos e composição do planner; perfil/aplicativo Instagram e compatibilidade do follow-gate; responsáveis, finalidade/base legal, guarda e fluxo para menores; integração com SEI/SIGAA. Não solicitar segredos em texto.

## Continuidade

Ler este arquivo na branch atual antes de editar. Registrar comportamento, testes reais e pendências. PR de código isolado não significa deploy. Preservar o jogo e não misturar demonstração com operação oficial. O relatório original de 2025 permanece fonte narrativa; nenhum histórico de métricas foi inventado ou importado.
