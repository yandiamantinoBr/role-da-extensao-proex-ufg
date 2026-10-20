# ADR 0002 — Portal operacional em um Site dedicado

Decisão de 20/10/2026, posterior à proposta condicional da ADR 0001.

O portal está em https://proex-gestao.yandiamantinobr.chatgpt.site. O jogo livre permanece no Site anterior e no GitHub Pages, com os 12 arquivos de referência preservados. A aplicação nova está em `apps/proex-portal` nesta branch.

## Escolha executada

Sites hospeda o Worker Vinext, provisiona um banco D1 exclusivo e um bucket R2 privado, e fornece a identidade nativa ChatGPT. Projeto: `appgprj_6ad777bf0b288191a60d90401ac71d25`. Fonte publicada: `e146d849e3f7ca87c471841a27f429b22c216905`. Versão 2 confirmada com status `succeeded` em 20/10/2026, após a primeira publicação e revisão dos links de autenticação. As migrações 0000 e 0001 são parte da publicação. Não alterar SQL aplicado; acrescentar migrações.

A conexão Supabase acessível pertence a outro projeto; não foi reutilizada. Não havia uma organização PROEX provisionável pelas ferramentas disponíveis. Não foi contratado projeto Supabase/Vercel pago. A opção nativa permitiu entregar infraestrutura separada e operável usando o acesso existente, sem depender da contratação de outro provedor. Não se presume preço fixo ou ausência de limites do serviço.

A página de entrada e as páginas de evento têm audiência pública. Os dados de gestão, convites, alterações e anexos exigem identidade autenticada e permissões verificadas no servidor. Audiência do Site não concede função administrativa. Não há credenciais de participantes no repositório.

## Identidade e administração

Login nesta entrega: conta ChatGPT. Google/e-mail/WhatsApp diretos não estão configurados. O e-mail verificado da conta proprietária do Site foi configurado como segredo `OWNER_EMAIL`. No primeiro acesso dessa conta, o servidor cria uma única vinculação inicial de responsável. Alterar o segredo não ressuscita vínculo revogado nem substitui um responsável já existente.

Convites são links manuais, vinculados ao e-mail esperado, expiram em sete dias e guardam somente hash do token. A aplicação não envia e-mail. Um gestor de projeto delega funções operacionais apenas naquele projeto; não concede administração institucional. Revogar convite aceito não revoga o vínculo: a equipe deve revogar o vínculo explicitamente. O último responsável é protegido no SQL.

## Dados e operação

Os serviços SQL usam D1 `batch` transacional, índices únicos e triggers para participação, estoque, reservas e conflitos de equipamento. Resultados digitais vêm do servidor antes da animação. Uma conta tem uma participação por evento, compartilhada entre roleta, dado e presencial. Tíquetes assistidos são registrados separadamente e não comprovam pessoas únicas. Cancelamento de atendimento pendente é auditado e não devolve uma chance.

Prêmios usam ofertas compostas por itens de brinde. Reservar uma tentativa cobre conservadoramente ambas ofertas; só o resultado devido continua reservado. Uma entrega baixa estoque uma vez. Equipamentos são cadastrados individualmente, não podem ter dois empréstimos sobrepostos nem duas retiradas simultâneas, e só têm retirada registrada na janela reservada. Termos/fotos PDF/JPEG/PNG/WebP são privados no R2 e exigem autorização a cada download.

CSV e métricas distinguem carregamentos, contas/tíquetes, tentativas, premiações e unidades. Dia de relatório usa Brasília, atualmente UTC−03. Sem contagens históricas inventadas, identificação no CSV, impressão digital de dispositivo ou prova fictícia de seguidores.

## Integrações e escolhas pendentes

Instagram é apenas um link opcional configurável. Não existe follow-gate verificado nem aplicativo Meta configurado. Não se registra clique como novo seguidor. Google Sheets recebe CSV por importação manual nesta entrega; não há sincronização automática nem integração bidirecional ativada. A conexão do autor no chat não se transforma em credencial permanente do portal.

A operação de campanhas exige que a equipe registre estoque real, ofertas, regras de repetição (zero a três) e aviso institucional de privacidade. Nenhum saldo, contato, campanha de demonstração ou aviso jurídico foi inserido na produção. Super Super Brinde, contribuições de alimentação, SEI/SIGAA, política de guarda e fluxo institucional para menores exigem decisões próprias; não foram inventados.

## Portabilidade e manutenção

As funções de acesso, materiais, campanhas, participação e relatórios estão em `lib/`, separadas do acesso `platform.ts` e dos endpoints. Uma migração para PostgreSQL exige um adapter transacional e tradução explícita dos triggers/SQL; não é uma troca de variável. Google OAuth exige provedor de identidade próprio compatível, não chaves copiadas para o navegador.

`apps/proex-portal` é uma cópia versionada da fonte publicada, sem histórico privado, artefatos de build ou segredos. Não há sincronização automática entre dois repositórios. Trabalhar nesta pasta, validar e publicar pelo fluxo Sites no mesmo project_id; atualizar a cópia pública de forma explícita. Não copiar o `.git` privado para GitHub. Os controles locais de QA foram removidos antes do build publicado.
