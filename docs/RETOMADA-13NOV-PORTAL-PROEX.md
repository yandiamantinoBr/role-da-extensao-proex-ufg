# Retomada do Portal PROEX · 13/11/2026

O GitHub e o domínio oficial apontavam para `68e4d830cdcc41c074915994e0c788f5246973c9` (PR101) na consulta de 13/11. A Vercel confirmou o deploy `dpl_4c6CAdM7us1QF2xYifuMMJUQxruH` em READY. Saúde, login e convite responderam HTTP 200. O código publicado mantém as migrações até a 0046. Confira a revisão e as PRs abertas antes de escolher a base de uma nova frente. [PR101](https://github.com/yandiamantinoBr/role-da-extensao-proex-ufg/pull/101)

As 58 integrações desde a PR40 vieram de ramos `claude/*`. Os recibos do Claude Code registram a evolução da identidade do Portal, de Materiais, Relatórios, Rolê, Comunidade, Gestão e voluntariado. A contribuição do Antigravity verificada nesta retomada está na referência da ArtCraft da Vault. Consulte [o glossário vigente](../apps/proex-portal/docs/GLOSSARIO.md) para os nomes de tela, código e banco. Os registros técnicos das entregas anteriores permanecem em [Continuar Portal PROEX](CONTINUAR-AQUI.md).

## Integrações preparadas

O combinado para o CONPEEX preserva os fluxos de saída, movimentação de estoque e assistentes durante a distribuição até 13/11. Os quatro rascunhos de consolidação têm janela de integração a partir de 14/11. Esse é o primeiro dia possível para a integração, sujeito à conferência da base e dos fluxos.

| Frente | Estado em 13/11 | Próximo aceite |
| --- | --- | --- |
| [PR98](https://github.com/yandiamantinoBr/role-da-extensao-proex-ufg/pull/98) · Histórico e responsáveis | Rascunho `c344f20`, CI verde na base da PR95 | Conferir designação única, trilha e permissões na ficha e no painel antigo. Integrar antes da PR103. |
| [PR103](https://github.com/yandiamantinoBr/role-da-extensao-proex-ufg/pull/103) · Painel fora do topo | Rascunho `8fc6e6e`, empilhado sobre a PR98 | Manter o ramo-base até que a PR103 aponte para `main`. Obter CI atualizado e conferir os atalhos e a visão de todos os projetos de forma independente. |
| [PR100](https://github.com/yandiamantinoBr/role-da-extensao-proex-ufg/pull/100) · Exportar | Rascunho | Conciliar navegação em `portal-client.tsx` com as PRs 98/103. Conferir relatórios filtrados e os documentos que continuam nas telas de origem. |
| [PR102](https://github.com/yandiamantinoBr/role-da-extensao-proex-ufg/pull/102) · Movimentações | Rascunho | Conferir a composição com os três módulos, a gaveta de material e a saída múltipla com dados sintéticos. |
| [PR104](https://github.com/yandiamantinoBr/role-da-extensao-proex-ufg/pull/104) · Roteamento do Rolê | Rascunho, revisão de segurança registrada em 8/10 | Tratar os achados restantes, obter crítica visual e rodar a suíte na base atual. Preservar os testes de Histórico ao conciliar `activity.test.mjs`. |

Na PR103, o atalho de responsáveis precisa da mesma verificação de acesso por projeto que a seção de destino. A leitura do código encontrou o caso de uma pessoa com estoque no projeto A e só relatórios no projeto B. A [PR105 isolada](https://github.com/yandiamantinoBr/role-da-extensao-proex-ufg/pull/105) contém a correção `12f306d`: o teste falha na versão original e passa na corrigida, junto com 19 testes focais, tipos e lint do recorte. Integre o commit na composição de R4 após a janela; não mescle o rascunho no ramo do Claude. No aceite das PRs 98/103, use dois projetos, duas organizações e contas sintéticas de administração, técnico, bolsista, voluntário e convidado. Confira uma única versão por operação e recusas a identificadores forçados ou acessos revogados. Teste os três módulos, a visão de todos os projetos, o foco e a área de toque. A remoção de históricos duplicados é etapa posterior. [Plano R1/R4](https://github.com/yandiamantinoBr/role-da-extensao-proex-ufg/blob/8fc6e6ea239bceff2f548c3148b4c0bc6a14aaac/docs/PLANO-R1-R4-HISTORICO-E-RESPONSAVEIS.md)

## Convite e teste local

A rodada de 13/11 parte de `68e4d83` em `codex/proex-convite-qr-13nov`. O convite de conta fica em Pessoas e acessos. Convocações usa um formulário de presença sem conta, com regras próprias. A sessão de conta está configurada para sete dias e pode ser renovada após 24 horas. O link do voluntário vence em até sete dias, limitado pelo fim do acesso à ação. [Voluntário por ação](../apps/proex-portal/docs/VOLUNTARIO-POR-ACAO.md) · [Convocações](../apps/proex-portal/docs/CONVOCACOES-E-AVISOS.md)

O modo `--invite-smoke` passou no build Node integrado. Rode a partir de `apps/proex-portal`, com as dependências do lockfile instaladas:

```powershell
npx --yes pnpm@11.25.0 build:node
node scripts/qa-local.mjs --invite-smoke
```

O script abre um SQLite temporário em loopback com dados sintéticos. A prova de aceitação verifica o 307 dos endereços legados, resposta sem código no corpo, metadados genéricos, ativação, cookie local de sete dias, sair/entrar, isolamento do projeto, voluntário com prazo e recusa de um link revogado. Uma conta que já aceitou o convite e apresenta a senha atual pode entrar novamente sem duplicar o vínculo. No navegador, foram exercitados 390 e 1366 px, temas claro e escuro, geração do QR, aceite e recarga. A leitura do PNG com um decodificador independente confirmou igualdade ao link sintético (sem registrar o código). A interação com um cliente externo de mensagens e a leitura por câmera física não foram atestadas.

O primeiro build demonstrou que a query legada aparecia no HTML de navegação do Vinext, mesmo sem ser usada pela página. O `proxy.ts` redireciona antes da renderização e a rota de aceite consulta o convite pelo corpo de uma requisição de mesma origem. A contraprova no build Node final passou. [Uso, prazo e segurança dos convites](../apps/proex-portal/docs/CONVITES-E-SESSOES.md)

O MCP pessoal continua em `/api/mcp`: requer cliente compatível com 2026-07-28, escopo por projeto e credencial emitida na Conta. Passaram 14 testes locais de transporte, autorização, expiração e revogação. Descoberta pública no ambiente oficial e listagem anônima recusada não comprovam o handshake de um cliente externo. O conector legado teve leitura, mas descreve apenas 27 tabelas e não deve ser usado para escrever no Portal que opera com 35 projeções. [Contrato MCP atual](MCP-PESSOAL-E-PROVEDORES.md)

## Padrão para novas frentes

- Parta dos tokens e componentes do Portal. Use DM Sans e Sora, textos em português simples, alvos de toque de 44 px e foco visível. Confira estados de erro e carregamento, voltar, atualização de dados e restrições por perfil. Compare capturas em 390 e 1366 px nos dois temas com o comportamento real no navegador. [Acabamento visual](ENTREGA-09NOV-VISUAL-E-COERENCIA.md)
- Use o app editável pertinente da ArtCraft quando a entrega incluir criação visual que a equipe precise revisar manualmente. FigCraft serve para interfaces e protótipos, VectorCraft para vetores e PhotoCraft para edição de fotos. Use o MCP disponível ou a CLI oficial do próprio app. Guarde o editável e a prévia na pasta do projeto, com fontes e instruções para reabrir. Confira a reabertura no app. A referência da Vault **ArtCraft - suíte de criação e como as IAs usam** registra versões e rotas de acesso verificadas. Use o código do Portal como fonte da interface em execução.
- Para GitHub, Vercel, Supabase, Drive e ferramentas de criação, consulte o conector pertinente e confira a conta, o projeto e o ambiente na operação. Registre separadamente o que foi conferido por leitura, teste sintético e fluxo autenticado. Use referências locais e recibos de execução sem valores de credenciais. Os limites de banco e credenciais estão no [AGENTS do projeto](../AGENTS.md).
- Ao escolher, comparar ou recomendar modelos de texto, decisão, visão ou voz, comece pelo [Artificial Analysis](https://artificialanalysis.ai/) e indique a data da consulta. Confirme os preços na fonte oficial do provedor e teste quando possível antes de trocar o padrão. A regra vale para o Portal e suas skills. A tela de Chaves e modelos concentra os gastos do Rolê.
- Trabalhe em etapas e em ramos separados por frente. Na passagem, registre SHA e PR, estado, evidência e próximos responsáveis. Na Vault, use o contexto para fatos, o plano para pendências e Decisões para o que Yan aprovou. Use notas de passagem para recuperar contexto entre ferramentas e mantenha o registro técnico neste repositório.

## Pendências operacionais

| Pendência | Próximo responsável |
| --- | --- |
| Nova base e CI das PRs 98, 103, 100 e 102 após a janela | Coordenação do Portal e revisão independente |
| Ajustes de segurança e validação do roteamento | Frente do Rolê |
| Primeiro voluntário e primeira convocação reais | Equipe da PROEX, com conferência de escopo e prazo |
| Proteção e scripts da mestre, OAuth individual do Drive e leitura da planilha de brindes pelo Rolê | Administração da PROEX e responsável pela integração, conforme a conta autorizada |
| Atualização do script de avisos e credencial provisória com vencimento em 30/11 | Administração da PROEX e responsável pelos avisos |
| Novo aceite autenticado no celular, incluindo alvo de toque de Gestão e sino da Comunidade com itens | QA com conta autorizada |

O cofre dedicado já consta nos recibos de 09/11 e os níveis de brindes já existem no código. As instruções e os estados anteriores a essas entregas servem como histórico. Para configuração externa ainda pendente, veja [Google Drive](../apps/proex-portal/docs/GOOGLE-DRIVE.md), [proteção da planilha mestre](../apps/proex-portal/docs/PLANILHA-MESTRE-PROTECAO.md) e [convocações e avisos](../apps/proex-portal/docs/CONVOCACOES-E-AVISOS.md).
