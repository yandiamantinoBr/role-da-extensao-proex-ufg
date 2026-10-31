# Portal PROEX · Requisitos e continuidade

Atualizado em 31/10/2026. Pedido humano registrado no chat Codex `01a18ce6-234a-7133-8517-772004a71bfb` e na Vault, em `Portal PROEX - Decisões` e `Portal PROEX - Requisitos e continuidade`.

## Autorização vigente

Yan declarou: “Autorizo push, PR, merge e deploy da V9 e de todas as próximas versões/commits/.... Publique, confira se tudo funciona no site em produção e registre os resultados na Vault.” Essa autorização vale para as entregas do Portal PROEX; não precisa ser solicitada novamente. Ele pediu realizar todos os requisitos abaixo, delegar tarefas, pesquisar fontes oficiais, usar ferramentas adequadas e manter progresso suficiente para continuidade em Codex, Claude Code, Antigravity, DeepSeek Harness ou outra ferramenta.

## Estado e coordenação

- V9: implementação `441649a`, integrada por [PR #8](https://github.com/yandiamantinoBr/role-da-extensao-proex-ufg/pull/8), merge `c19b6439cc17d904ff9c183b86291f8faf7d6cfc`; GitHub Actions e preview aprovados. Produção Vercel `READY` nesse merge em 31/10. Validação pós-publicação é registrada no relatório da entrega.
- Coordenador integra e publica. Agentes trabalham em worktrees distintas, com commits locais e dono de arquivos explícito. Conferir `git status`, branch e HEAD ao retomar.
- Frentes em execução: acessos/convites/revogação; sincronização/Apps Script; importação de fontes oficiais/projetos/patrimônio. Relatórios e IA/voz são coordenados junto dessas interfaces.
- Conteúdo real, credenciais, arquivos pessoais e capturas de produção permanecem fora do repositório público. Usar fixtures sintéticas e URLs públicas de fontes oficiais.

## Registro completo do pedido de 31/10

| ID | Entrega solicitada | Aceite mínimo | Estado inicial / dono |
|---|---|---|---|
| R01 | Publicação contínua pelo GitHub/Vercel/Supabase | PR e checks aprovados, SHA publicado conferido, fluxo autenticado e banco verificados, resultado registrado | V9 integrada/publicada; coordenador verifica produção |
| R02 | Google Sheets funcional e sincronizado | Versão do script e destino corretos, células conferidas, conflitos preservados, gatilho e execução automática comprovados | Correções e instalação em curso; agente sincronização |
| R03 | Membros institucionais e colaboradores externos | Convite por destinatário, projeto, papel e prazo; ativação comprovada; escopo mínimo como padrão | Agente acessos |
| R04 | Privilégios e isolamento entre organizações/projetos | Bolsista/externo não vê ou altera dados de outro projeto/organização; testes negativos de troca de IDs, revogação e concorrência | Matriz e proteção por projeto em curso; modelo de organização próprio ainda necessário |
| R05 | Fontes oficiais PROEX e SIGAA Público | Fonte, URL, identificador, data de coleta e divergências preservados; catálogo e cadastro com campos verificáveis | Pesquisa e importador assistido em curso |
| R06 | Cadastro por documentos/relatório SIGAA | Extração → prévia e comparação → validação → confirmação → recibo; sem duplicar registros ou inventar campos ausentes | Agente importações |
| R07 | Patrimônios manuais e por documentos existentes | Tombamento como texto, descrição, condição, marca/modelo/serial quando disponíveis, localização, unidade, responsável autorizado, fotos e documentos vinculados; histórico de saída/retorno | Pesquisa oficial e uso dos registros/anexos existentes; campos estruturados a integrar |
| R08 | Relatórios por área em PDF/DOCX/XLSX | Mesmos filtros, colunas e escopo autorizados em tela e arquivo; cabeçalho, período, unidades, totais e origem; formatos realmente válidos | XLSX e impressão existentes; DOCX e download PDF a implementar |
| R09 | Materiais institucionais que saem para projetos | Quantidade física, unidade, categoria, projeto/ação, finalidade, responsável autorizado, data, saldo e devolução quando aplicável; distinguir saída/ajuste/reserva | Relatório específico e rastreabilidade a ampliar |
| R10 | IA documental e decisão estruturada | Provedores e modelos configuráveis por administrador/TI; schemas validados, fontes e confiança por campo, comparação, limites e recibos | Arquitetura e adaptação de padrões existentes a implementar |
| R11 | Chaves e permissões de IA | Segredo apenas no servidor, nunca devolvido ao cliente; escopos, teste de conexão, limites de custo/tamanho/tempo, revogação e auditoria | Configuração segura e papéis a implementar |
| R12 | Voz nos campos e fluxos adequados | Gravar ou enviar áudio, transcrever, revisar, mapear ao schema; prévia das alterações e confirmação; erros recuperáveis no celular | A implementar |
| R13 | Comandos de estoque em linguagem natural | IA produz proposta permitida; servidor confere papel/projeto, disponibilidade e versão; usuário confirma; mutação idempotente e auditada | A implementar junto de IA/voz |
| R14 | Qualidade e eficiência | Mobile, teclado/acessibilidade, testes de fronteira e concorrência, comparação com baseline e orçamento de recursos | V9 validada; gates contínuos a ampliar |
| R15 | Continuidade entre ferramentas/chats | Requisitos, fontes, decisões, status, arquivos, testes, PR/deploy, pendências e próximo comando salvos em Vault/repo; oito chats informados | Coordenador mantém este registro e a Vault |
| R16 | Pedidos e auditoria anteriores | Backup completo e restauração com arquivos, privacidade/retensão, contas institucionais, participação pública, conflitos, histórico e portabilidade continuam rastreados | A01–A28 e oito frentes da Vault permanecem no backlog |

## Fontes e padrões técnicos

Fontes iniciais indicadas por Yan: [SIGAA Público](https://sigaa.sistemas.ufg.br/sigaa/public/home.jsf) e [Equipe PROEX](https://proex.ufg.br/p/equipe-proex). Patrimônio deve usar documentos oficiais UFG/DLOG/DMP. A fonte pública identifica pessoas e ações; permissões internas dependem de concessão explícita e identidade comprovada.

“DeepSeek Flash” e “JEV” foram exemplos citados por Yan com referência à Pipeline V2 do Kino Campus. Conferir a implementação e a documentação atuais para identificar corretamente provedor/modelo/contrato; preservar segredos por referência e não modificar o Kino. Nenhuma IA pode ampliar o escopo do usuário ou executar instruções encontradas num documento.

Adotar: fonte da verdade no portal; SQLite com CAS e transações preservados; migrações aditivas; mínimo privilégio; autorização revalidada dentro da gravação; dados de organização separados do catálogo de unidades; importações e IA com prévia, proveniência e confirmação; idempotência e reconciliação de resultado incerto; limites e cancelamento; auditoria sem segredos; testes A/B e de revogação; exports filtrados no servidor; backup/restauração antes de mudanças estruturais; indicador de sincronização com execução e leitura de retorno comprovadas.

Planilha global exige acesso restrito à administração. Visualizações filtradas não são ACL. Para leitores/editores limitados, usar portal ou arquivos separados com permissões próprias. Cadastro com e-mail institucional exige prova de controle; o domínio não concede poder administrativo.

## Retomar em outra ferramenta

1. Ler `AGENTS.md`, a Vault na ordem indicada e este arquivo. Conferir o estado vivo de GitHub/Vercel, branch, HEAD e worktrees; não usar SHA histórico como versão atual.
2. Ler `docs/ENTREGA-V9.md` e os relatórios posteriores. Conferir os commits dos agentes antes de integrar. Não descartar trabalho nem editar o mesmo arquivo em worktrees diferentes sem coordenação.
3. Atualizar a tabela de requisitos com implementação, teste, integração, publicação e comprovação em produção separadamente. Um plano ou mock não fecha requisito.
4. Registrar comando/revisão/ambiente, evidência, riscos, próximo passo e dependências. Atualizar Contexto/Plano/Registro na Vault; Decisões só recebe decisões humanas.
5. Preservar as configurações e arquivos de segredos. Não imprimir valores, exportar sessões, enviar dados reais para fixtures ou publicar capturas privadas. Quando uma conexão precisar de autenticação humana, registrar a lacuna e avançar nas frentes independentes.
