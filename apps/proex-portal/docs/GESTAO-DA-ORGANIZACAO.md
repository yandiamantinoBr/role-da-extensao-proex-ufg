# Gestão da organização (guia, riscos, equipes-modelo e painel)

Pedido do Yan em 09/11/2026: entender e registrar como a PROEX funciona dentro do próprio portal; modelos de equipe; controle de riscos; e painéis gerenciais gratuitos em vez do Power BI.

Módulo **Gestão** no menu, com quatro abas. Aparece para quem tem projeto na organização. O que cada pessoa vê segue as permissões que ela já tem.

## Painel

Indicadores clicáveis, cada um levando ao detalhe:
- demandas abertas, em atraso e entregues no período;
- itens distribuídos;
- dinâmicas ativas e participações;
- estoque baixo;
- riscos abertos, os de nível alto ou crítico e os com revisão vencida.

Gráficos e listas, no mesmo padrão de Registros:
- demandas por mês (criadas e concluídas) e brindes distribuídos por mês;
- próximos 45 dias (agenda e dinâmicas);
- mapa de riscos;
- demandas por projeto;
- estoque baixo.

Filtros: projeto e período (30 dias, 90 dias, 6 meses ou 12 meses).

Dados: `lib/management/dashboard.ts` reaproveita `reportRows` (filtrado pela organização), o histórico das demandas, `risksWorkspace` e `activityFeed`. Uma seção que a pessoa não pode ver fica fora, em vez de aparecer zerada.

## Guia da organização

São 11 páginas: estrutura, programas e projetos, CONPEEX, UFG nos Parques, editais e bolsas, empréstimos, brindes, comunicação, calendário, contatos e glossário.

O conteúdo inicial fica em `lib/management/guide-starter.ts`. Ele usa só informação institucional e pública, com fontes e datas, e marca *a confirmar* onde há dúvida.

Os **blocos vivos** são lidos na hora com as permissões de quem lê:
- `{{estrutura}}`: o organograma cadastrado;
- `{{programas}}`: os projetos visíveis;
- `{{calendario}}`: os próximos 180 dias;
- `{{equipe-oficial}}`: a cópia conferida da página oficial "Equipe PROEX".

Quem lê e quem edita:
- quem tem vínculo com a organização lê;
- a administração da organização edita;
- a administração pode designar outros editores, e quem perde o vínculo deixa de editar.

Cada gravação cria uma versão com autor e nota do que mudou. Restaurar cria uma versão nova.

Exportação: o guia sai em PDF e DOCX pelo mesmo gerador do relatório do projeto (capa, sumário e numeração).

Para o **Rolê**, `guideForAssistant(db, actor, organizationId)` devolve o mesmo Markdown resolvido. A rota é `GET /api/management?view=guide&organizationId=…`.

## Riscos

Cada risco é registrado num destes escopos:
- **organização**: só a administração vê e edita;
- **projeto ou dinâmica**: quem participa do projeto lê; o responsável ou o gestor edita.

Campos: probabilidade e impacto (de 1 a 5), nível, dono, mitigação, situação e data de revisão.

O nível sai da conta probabilidade × impacto:

| Nível | Pontos |
|---|---|
| Baixo | 1 a 4 |
| Moderado | 5 a 9 |
| Alto | 10 a 14 |
| Crítico | 15 a 25 |

Uma revisão está vencida quando a data passou e o risco segue aberto ou em monitoramento.

O botão "Carregar exemplos", da administração, cria 4 exemplos marcados como **Exemplo**:
- conta pessoal do Yan;
- credencial que vence em 30/11/2026;
- cota da Vercel;
- planilha inacessível.

Os exemplos podem ser apagados. Riscos reais não se apagam: são encerrados.

## Equipes-modelo

Seis modelos: Comunicação, Administrativo, Tecnologia/TI, Gestão, Eventos e Bolsistas de projeto. Cada um traz papéis, responsabilidades, acessos sugeridos e rotinas (`lib/management/team-templates.ts`).

Na página **Equipes**, quem administra a organização usa "Começar de um modelo de equipe":
- a equipe é criada vazia pelo mesmo `team.create`;
- a equipe passa a mostrar os papéis do modelo;
- pessoas e acessos continuam sendo decisões à parte.

## Dados

Migração aditiva com as tabelas `org_guide_pages`, `org_guide_page_versions`, `org_guide_editors`, `org_risks` e `team_template_applications`. Toda gravação passa por `audit`.

## Painéis: comparação e recomendação

Fontes oficiais lidas em 09/11/2026.

| Ferramenta | Custo | Manutenção | Ver e editar | Risco de quebrar pela interface | Migrar para a PROEX |
|---|---|---|---|---|---|
| **Painel no portal** (recomendado) | Zero de licença | Já roda na Vercel com o Supabase | As mesmas permissões do portal, separadas no código | **Baixo**: só muda por PR, com testes e histórico no Git | Vai junto com o portal |
| Looker Studio | Gratuito; o Pro é pago, sem preço nas páginas lidas | Nenhum servidor; lê o Google Sheets | "Can view" e "Can edit", mas **quem edita também compartilha** | Médio: qualquer editor muda; tem histórico de versões | Fácil (Google Workspace) |
| Power BI | Pro US$ 14 e PPU US$ 24 por usuário/mês; para quem não tem licença ver, exige capacidade P1/F64 | Nuvem Microsoft | Licença por pessoa | Não verificado | Exige contrato Microsoft |
| Metabase OSS | Livre (AGPL); nuvem a partir de US$ 100/mês | Servidor Java e Postgres | Por grupos e pastas | Baixo/médio: guarda 15 versões | Precisa de servidor da TI |
| Apache Superset | Livre (Apache 2.0) | Servidor e banco de metadados | Por papéis (RBAC) | Não informado | Precisa de servidor da TI |
| Grafana | OSS (AGPL); nuvem grátis com até 3 usuários ativos | Servidor ou nuvem limitada | Viewer, Editor e Admin | Baixo/médio: guarda 20 versões | Servidor da TI; é ferramenta de monitoramento técnico |
| Evidence | Livre (MIT); hospedado a partir de US$ 2.500/mês | Site gerado a partir do código | `access.yaml`; na Vercel, só senha básica | Baixo (Git) | Duplica o que o portal já faz |

Fontes:
- [Power BI](https://www.microsoft.com/en-us/power-platform/products/power-bi/pricing).
- Looker Studio: [Pro](https://docs.cloud.google.com/looker/docs/studio/about-looker-studio-pro), [compartilhamento](https://docs.cloud.google.com/looker/docs/studio/invite-others-to-your-reports) e [Sheets](https://docs.cloud.google.com/looker/docs/studio/connect-to-google-sheets).
- Metabase: [preços](https://www.metabase.com/pricing/), [licença](https://github.com/metabase/metabase/blob/master/LICENSE.txt), [permissões](https://www.metabase.com/docs/latest/permissions/collections) e [histórico](https://www.metabase.com/docs/latest/exploration-and-organization/history).
- Superset: [repositório](https://github.com/apache/superset) e [arquitetura](https://superset.apache.org/admin-docs/installation/architecture/).
- Grafana: [preços](https://grafana.com/pricing/), [papéis](https://grafana.com/docs/grafana/latest/administration/roles-and-permissions/) e [versões](https://grafana.com/docs/grafana/latest/dashboards/build-dashboards/manage-version-history/).
- Evidence: [preços](https://evidence.dev/pricing) e [implantação](https://docs.evidence.dev/deployment/overview).

**Recomendação:** o painel principal fica no portal. Não tem custo de licença. As permissões já são as do portal. Ninguém altera o painel pela interface: mudanças passam por PR, testes e deploy. E ele acompanha o portal quando a PROEX assumir.

**Alternativa gratuita**, se a coordenação quiser montar gráficos próprios: Looker Studio lendo a **planilha institucional que já espelha o portal**. Funciona sem servidor e com conta do Workspace da UFG.

### Looker Studio sobre a planilha que espelha o portal (passo a passo, sem contas novas)

1. Use uma **conta institucional da PROEX**, não pessoal, como dona do relatório.
2. Em lookerstudio.google.com, vá em **Criar → Fonte de dados → Google Planilhas**.
3. Escolha a planilha mestre do portal e a aba a usar (por exemplo, Demandas ou Materiais). Cada fonte é uma aba.
4. Crie o relatório a partir dessa fonte reutilizável. Não use dados embutidos nem link público, porque o link público expõe as fontes.
5. **Compartilhe** assim:
   - "Pode ver" para quase todos;
   - "Pode editar" só para 1 ou 2 pessoas, porque quem edita também compartilha.
6. Antes de mudanças grandes, **nomeie uma versão** no histórico.
7. Não coloque dados pessoais nas abas usadas pelo painel. A planilha segue as mesmas regras do portal.

Nada disso foi criado nesta entrega.
