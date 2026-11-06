# Edição, estoque e eventos · 2026-11-06

Ao abrir um projeto, a equipe agora encontra os materiais e as ações de cadastro no início da ficha. Cada material oferece Abrir, Editar e Movimentar conforme o acesso da pessoa. A edição de demandas também ganhou uma ação explícita. O cadastro rápido preserva o projeto, a digitação e os erros, sem conceder novas permissões.

Uma movimentação pode registrar origem ou destino, unidade ou projeto, beneficiário, referência SEI e data da operação. O autor e a data de gravação continuam separados. O contexto é imutável e acompanha o histórico. A consulta de consumo compara o mesmo material e medida, permite filtrar pelas barras, abrir o histórico da unidade e baixar PDF, XLSX ou DOCX. A previsão exige observação suficiente e informa suas limitações.

Os responsáveis explicitamente designados recebem avisos de estoque na campainha quando um lançamento manual ou a alteração do mínimo cruza o limite. Leitura e dispensa são pessoais e persistentes; recuperação do saldo encerra o episódio. Não há envio de e-mail nesta funcionalidade.

O diretório administrativo prepara pessoas sem criar conta, convite ou acesso. Cadastro, edição, arquivamento e histórico mantêm versão e auditoria. Uma falha ao consultar o histórico permite tentar novamente sem perder o editor.

`/events` passa a listar ações publicadas com busca, situação e datas. Rascunhos continuam privados; uma pessoa autorizada que abre seu endereço é encaminhada à edição da equipe. As marcas PROEX/UFG preservam proporção e contraste nos dois temas. Data e hora usam calendário brasileiro e relógio de 24 horas nos formulários alterados.

## Verificação

- Suíte integral local: 1.309 testes aprovados antes da contraprova adicional da Agenda; essa contraprova passou 6/6 no arquivo correspondente. Tipos, builds Worker e Node e smoke de autenticação/MCP aprovados. O CI da PR deve confirmar a composição final.
- Edição real na base sintética: criar material, editar, receber 100, consumir 7, conferir saldo 93, abrir unidade/histórico e baixar os três formatos. PDF renderizado em A4; arquivos XLSX e DOCX conferidos.
- Avisos: queda até o mínimo, marcação como lido, dispensa, restauração, recuperação do saldo e novo episódio. Diretório: criar, editar versão 2, histórico e arquivar.
- Eventos: busca e filtros; entrada efetiva pelo cartão de um evento ativo; rascunho autorizado e anônimo; data/hora inválida, restauração e reset de formulário.
- 44 capturas finais em 390 e 1366 px, claro e escuro, com tema conferido no DOM, sem transbordamento horizontal ou erro de página. [Evidências sintéticas](evidencias/2026-11-06-edicao-e-rastreio/README.md).
- [Revisão independente de segurança e comportamento](REVISAO-06NOV-SEGURANCA.md) e [parecer visual independente](REVISAO-06NOV-DESIGN.md). Os limites de cada parecer fazem parte do aceite.

## Falhas encontradas e corrigidas

A primeira captura escura estava clara porque a preferência era redefinida na navegação. O novo ensaio usa o seletor real e confere o tema antes de salvar. Um seletor de QA confundia o nome do evento, que é um parágrafo, com um título. Nenhuma dessas duas falhas foi atribuída ao produto.

O clique real nos links públicos encontrou uma exceção no roteador cliente do Vinext. Os links deste fluxo usam navegação nativa pelo mesmo endereço; o novo ensaio concluiu a entrada no detalhe sem erro. O carregamento indefinido do histórico do diretório foi corrigido e ganhou testes de falha, repetição e resposta atrasada. Filtros do modal de unidade agora se adaptam à largura do próprio painel.

## Dados, migrações e continuidade

Migrações aditivas: 0032 (contexto de movimentação), 0033 (pré-cadastros) e 0034 (avisos). Os snapshots Drizzle correspondem a 113 tabelas; os gatilhos complementares foram preservados. Não gerar novamente um arquivo SQL customizado sem cópia e conferência. A aplicação mantém SQLite com persistência por instantâneos no Supabase.

As 35 projeções existentes da mestre não passam a incluir automaticamente as novas tabelas. O arquivo manual de contagem por projeto também não se torna sincronizado apenas por receber um link. A operação e os dados reais ficam registrados na Vault, separados das evidências sintéticas públicas.

Não foram substituídos saldos pela estimativa da fotografia. O DOCX recebido posteriormente é um cronograma, sem contagem física ou metadado de contagem. Os novos horários da equipe substituem as hipóteses anteriores de três rodadas por dia. Quantidades de planejamento, estoque histórico, saldo registrado e contagem conferida devem permanecer distintos.

Ainda exigem aceites próprios: conexão bidirecional da planilha de contagem, custódia institucional, coleta dos feeds pelo Google, cofre e recuperação, provedores reais de IA/MCP e o terceiro nível de prêmio. O jogo atual possui dois níveis de prêmio; simular um terceiro não o ativa. Esta entrega não encerra todas as solicitações da plataforma.

## Publicação

Este documento acompanha o código testado. O recibo de PR, CI, merge, implantação e conferência autenticada deve ser registrado no checkpoint da Vault após as ações reais. Não atribuir publicação a uma branch local.
