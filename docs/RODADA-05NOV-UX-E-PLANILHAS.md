# Rodada de 5 de novembro de 2026

Pedido vigente de Yan, consolidado a partir da conversa. Publicação está autorizada. Cada entrega deve distinguir implementação, teste sintético, instalação de integração e confirmação em produção. Este arquivo complementa REQUISITOS-E-CONTINUIDADE.md e não apaga o histórico anterior.

## Fila e aceites

| Frente | Resultado esperado | Aceite mínimo | Estado inicial |
| --- | --- | --- | --- |
| Filtros e datas | Refinar contexto compacto, sem espaço vazio; datas visíveis em dd/mm/aaaa e calendário em português | 375/390/1366 px, ambos os temas; navegador em inglês; teclado; ISO preservado nas APIs | Em implementação por filtros_datas |
| Projetos e origem | Favoritos pessoais compactos; demanda abre seu projeto; cartões sem informação duplicada | Persistência por conta, revogação de acesso, URL recarregável, navegação por teclado | Em implementação por projetos_visuais |
| Gráficos | Visões interativas de demandas e projetos, com legenda, valores, filtros e alternativa textual | Dados autorizados; total confere com lista; toque e teclado; nenhum progresso inventado | Ampliação em implementação |
| Sheets por projeto | Arquivo nativo específico, projeção segura, edição de materiais sem códigos; mestre consolidada | Dois projetos e dois papéis, nenhuma linha cruzada, alteração nos dois sentidos, repetição e revogação | Backend e conector por planilhas_escopo |
| Exportações | PDF, DOCX e XLSX nos recortes úteis, inclusive resumo diário e Registros | Mesmas linhas/filtros/permissões; identidade PROEX; abrir e conferir artefatos | Coordenador |
| Feedback e versão | Versão identificável; sugestão/problema com confirmação e registro; avisos temporários de ações | Sem dados de sessão/chaves; falha conserva texto; prevenção de envio duplicado | Coordenador |
| Equipe do projeto | Convidar institucional/externo; gerente e monitor com capacidades explícitas | Convite expira/revoga; monitor não vê outros projetos nem mestre; clareza na ficha | Revisar fluxo existente e completar |
| Operação de eventos | Checklist delegável, presença/ausência/observações; consumo por dia e alerta de reposição | Reutilizar estoque e demandas; escrita validada, histórico e idempotência; quantidades reais | Fila preservada; exemplos do usuário não são dados reais |
| IA e MCP | Provedores configuráveis; ações tipadas e restritas; documentação para outros agentes | Credencial cifrada no servidor, destino permitido, limite de custo e aprovação de alteração; MCP não substitui API de modelo | Auditar capacidade atual e completar por etapas |
| Comunicação | Artes/links Canva, histórico por projeto, revisão/aprovação e compartilhamento | Link validado, ACL atual, publicação externa após revisão; WhatsApp manual existente preservado | Fila anterior preservada |
| Migração institucional | Inventário de locais e plano de transferência para Drive da PROEX | ID, dono, pais, permissões e gatilhos inventariados; backup e rollback; não inferir sincronização por pasta local | Plano nesta rodada |

## Critérios comuns

- Manter React/TypeScript e os serviços existentes. Não reescrever a plataforma ou adicionar um framework por aparência. Centralizar componentes e tokens quando isso reduz inconsistências.
- Projetar primeiro para celular: alvos de pelo menos 44 px, conteúdo sem excesso horizontal, rolagem vertical iniciada em tabelas, ações claras, menos informação repetida e expansão sem saltos desnecessários.
- Cor acompanha símbolo e texto. Diferenciar prioridade, prazo, andamento e importância. Gráficos mostram valores, amostra e recorte; dados incompletos não viram zero nem percentual de conclusão.
- Confirmação breve de sucesso, erro acionável junto do formulário e preservação do rascunho. Não repetir notificações em cada atualização automática.
- Proteger em serviço e no momento da escrita. Pertencer a uma equipe não concede acesso global. Vincular um arquivo Google não altera suas permissões.
- Não criar CSV nos botões. Manter compatibilidade de importações antigas e exigir os formatos pedidos para novos downloads.
- Usar base descartável em testes de cadastro/estoque, cargas e autorização; produção recebe apenas dados solicitados e verificação segura. Não enviar convites ou e-mails de teste a terceiros.
- Revisão independente por fluxo, com notas justificadas e limites declarados. Uma nota de um recorte não é certificação de todo o site. Registrar testes físicos/leitor de tela ainda pendentes.

## Locais e migração

Código local: checkout do repositório; caminho exato no inventário privado da Vault. GitHub: `yandiamantinoBr/role-da-extensao-proex-ufg`. Aplicação: `apps/proex-portal`. Produção: https://proex-gestao.vercel.app/. Persistência: SQLite com instantâneos versionados no Supabase. Os caminhos locais de código, chat e Vault não comprovam sincronização com Google Drive.

A planilha mestre **Gestão PROEX · Dados e sincronização** está no Drive pessoal. O arquivo específico **CONPEEX 2026 — Controle de brindes** fica no Drive institucional compartilhado, conforme inventário privado na Vault. IDs e permissões reais ficam somente nas notas privadas, não neste repositório público.

Sequência de migração: (1) inventariar arquivos/IDs, donos, ACL, scripts vinculados e gatilhos sem ler segredos; (2) confirmar pasta institucional e contas executoras elegíveis; (3) backup verificável; (4) piloto com um projeto e credencial restrita; (5) mover preservando IDs quando possível, ou atualizar registro canônico quando a instituição exigir cópia; (6) testar leitura e edição nos dois sentidos, anexos, links e revogação; (7) trocar destino oficialmente e desativar gatilhos antigos após conciliação; (8) registrar recibo e janela de rollback. Não executar movimentação em massa como efeito colateral desta rodada.

## Continuidade

Base de implementação: `d9ca7e0` (PR #32). Branch do coordenador: `codex/proex-evolucao-05nov`. Worktrees de agentes são isoladas e entram após revisão. Não marcar esta rodada como entregue antes dos checks, merge, deploy e teste no domínio oficial. Atualizar CONTINUAR-AQUI.md, ANDAMENTO.md e a Vault com o SHA efetivamente publicado, provas e pendências restantes.
