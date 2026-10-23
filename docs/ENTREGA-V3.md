# Entrega V3 — Gestão PROEX e Rolê da Extensão

> Registro histórico da publicação V3. A evolução V4, publicada em 23/10/2026, é descrita em [ENTREGA-V4.md](ENTREGA-V4.md). A evidência abaixo continua vinculada à revisão V3.


Registro de 20/10/2026. **Versão 3 publicada com sucesso**, conforme retorno da plataforma às 15:55:09 UTC. A entrada pública e a proteção dos endpoints foram conferidas por HTTP depois da publicação.

| Evidência | Registro final |
| --- | --- |
| Revisão de fonte V3 publicada | `db104886f98feebc1b83e30ad35d0390df556d3c` |
| URL da V3 verificada | https://proex-gestao.yandiamantinobr.chatgpt.site |
| Versão e estado da publicação | 3 · succeeded · `appgdep_6ad78ec1db0c81919b6e4ef6588d8491` · revisão de ambiente 2 |
| Contagem final de testes | Portal: 179/179; base livre/fundação: 33/33; 12 arquivos livres preservados |
| Teste do fluxo de senha no Worker | Worker compilado em workerd/Miniflare: ativação, login, saída, senha inválida, troca, renovação de cookie e revogação passaram com D1/R2 isolados |

O destino é o portal de gestão existente, separado da roleta livre. Os registros anteriores de entrega da V2 documentam a autenticação daquela revisão; não devem ser usados para concluir como funciona o login da V3. O manual de operação e desenvolvimento atualizado fica em [apps/proex-portal/README.md](../apps/proex-portal/README.md), e o estado consolidado em [proex-evolucao/ESTADO_ATUAL.md](proex-evolucao/ESTADO_ATUAL.md).

## O que a revisão acrescenta

A entrada habitual passa a usar e-mail e senha, com Better Auth no D1, cadastro por convite e sessões verificadas no servidor. A identidade canônica do portal preserva vínculos e histórico anteriores. Igualdade de e-mail não basta para fundir contas ou promover um administrador. A comprovação nativa do Sites permanece somente no fluxo explícito de acesso inicial dos cadastros anteriores e do primeiro responsável configurado.

O diretório de equipe permite consultar os usuários visíveis no escopo autorizado, alterar funções permitidas e bloquear ou reativar contas. Convites e recuperação de senha geram links para compartilhamento manual; nenhum e-mail é enviado automaticamente. O bloqueio impede novas leituras e operações protegidas. Os controles de último responsável continuam no servidor.

Meu perfil permite editar nome, preparar foto da galeria ou seleção de câmera e trocar senha. As fotos ficam em armazenamento privado. A interface oferece temas claro, escuro e do sistema; a preferência é deste navegador. A abertura de câmera e a compatibilidade dos arquivos dependem do aparelho e do navegador. Os dados confirmados ficam no servidor; não há edição offline.

Projetos recebem identificação, cor, endereço oficial, local, período e situação. Registros operacionais documentam manutenção, distribuição, consumo, material, projeto, observação ou empréstimo, com fotos e PDFs privados. Um registro narrativo não movimenta estoque nem cria uma reserva automaticamente. Registros vinculados a empréstimos exigem também a permissão de leitura de empréstimos naquele projeto, mesmo quando classificados em outra categoria.

## Agenda e Google Calendar

A agenda reúne empréstimos, materiais, projetos e eventos, e consumo, com filtros de projeto, categoria e período. Materiais e consumo mostram movimentações efetivamente registradas; quantidade em estoque não é convertida em compromisso futuro. A disponibilidade dos equipamentos continua sendo validada pelo banco do portal.

O download ICS exige sessão e permissões. A assinatura ICS usa um link privado por categoria e projeto, exibido somente na criação, válido por um ano e revogável. O banco guarda o hash do token. Cada consulta revalida a conta proprietária e suas permissões. Eventos não incluem contatos, observações internas, documentos ou identidade de participantes. Registros vinculados a empréstimos respeitam a permissão adicional também nos feeds.

No computador, o responsável pode adicionar a URL em **Google Calendar → Outras agendas → + → Do URL**. A assinatura é de leitura; o Google decide quando atualizar. Editar o Calendar não altera o portal. Importar um arquivo ICS cria uma cópia. Revogar o link impede consultas posteriores, mas não apaga cópias já recebidas. Não há OAuth Google configurado, gravação automática na agenda institucional ou sincronização bidirecional nesta revisão.

## Receita de primeiro acesso

1. A manutenção configura os nomes de runtime `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET` e `OWNER_EMAIL`, pelo mecanismo de secrets da hospedagem. Valores não pertencem ao repositório. Preservar segredo e identidade do Site entre atualizações.
2. O primeiro responsável, ou alguém com cadastro nativo anterior, abre `/acesso-inicial`, comprova a identidade pelo fluxo indicado e define uma senha. Se já houver credencial correspondente, também deve comprovar a senha existente. Esse fluxo não promove quem apenas digita um e-mail institucional.
3. Nos acessos seguintes, usar `/login`. Uma pessoa nova recebe um convite criado pela equipe, abre o link e conclui a ativação. Não há cadastro público livre. O responsável confere o destinatário e compartilha o link por canal apropriado.
4. Conferir os projetos e permissões, cadastrar estoque físico real, compor ofertas e definir regras e aviso de privacidade antes de ativar campanhas. Fazer um piloto com os perfis autorizados.
5. Para acompanhar a agenda, selecionar projeto e categoria, gerar uma assinatura e guardá-la como credencial. Para recuperar um link perdido, revogar o antigo e gerar outro.

## Evidências e limites

As verificações incluem testes reproduzíveis com SQLite e migrações reais, isolamento de projetos, sessões, convites, estoque, empréstimos, registros e assinaturas ICS. A regressão do calendário cobre títulos de registros vinculados a empréstimos, inclusive nos feeds sem cookie. A interface foi revisada em desktop e largura de 390 pixels, nos dois temas, com dados sintéticos locais. Isso não comprova funcionamento de câmera em aparelho físico nem um piloto institucional completo.

Continuam fora desta revisão: comprovação de seguimento no Instagram, Meta/WhatsApp/Facebook, sincronização automática Sheets, SMTP, contribuições financeiras, assinatura eletrônica certificada, integração SEI/SIGAA e regras de Super Super Brinde. Definições institucionais de privacidade, menores, retenção, suporte e recuperação precisam acompanhar a operação. Não foram fabricados saldos, participantes ou histórico. A roleta livre, o Pages e seus arquivos preservados continuam independentes.

Conferência hospedada sem sessão: `/login` e `/api/account` responderam 200; `/api/portal`, `/api/profile`, `/api/calendar` e `/api/records` responderam 401 com cache desabilitado. O teste completo de senha foi executado no Worker compilado com dados temporários; não se afirma um piloto autenticado em produção com contas reais. O snapshot público de 193 arquivos foi comparado à fonte publicada e é idêntico.
