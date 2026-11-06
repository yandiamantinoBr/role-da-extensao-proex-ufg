# Evidências sintéticas · edição, materiais e eventos

Base descartável, restrita ao loopback, sem produção, contas ou contagens reais. As capturas `390-*` e `1366-*` mostram os dois temas, selecionados na interface e conferidos no DOM. `verification.json` registra as 44 vistas finais e ausência de erros de página.

- `project-final`: ações e materiais na ficha.
- `movement-final` e `unit-final`: movimentação contextual e relação com unidade.
- `consumption-open`, `forecast` e `history-method`: filtro, projeção com amostra suficiente, responsáveis e histórico abertos.
- `directory-final` e `directory-editor`: pré-cadastros administrativos, sem concessão de acesso.
- `event-detail`: detalhe aberto pelo cartão real do evento ativo na base sintética.
- `events-empty`: busca sem resultado.
- `datetime-fields`: início/fim em português e relógio de 24 horas.

A bateria anterior `events-qa` usou três DTOs sintéticos por interceptação para testar os filtros públicos; isso não comprova publicação de eventos reais. O detalhe desta pasta usa a API da base sintética e navegação pelo cartão, sem essa interceptação. Nenhuma participação ou entrega de brinde foi realizada.

Os três formatos do histórico foram baixados na QA: PDF de uma página A4, XLSX sem fórmula no conjunto sintético e DOCX válido. A prévia `historico-preview.png` permite inspecionar o PDF. Não há ensaio visual de um histórico extenso entre páginas.

Resultados locais: suíte integral 1.309/1.309 antes da contraprova adicional da Agenda; ver o CI da PR para o total final. As revisões de [segurança](../../REVISAO-06NOV-SEGURANCA.md) e [design](../../REVISAO-06NOV-DESIGN.md) delimitam o que foi efetivamente examinado. Registros reais de Agenda, fontes do Drive e estimativas de estoque ficam somente na Vault e no arquivo institucional.

O CI42299838784 confirmou o total final de **1.310 testes do Portal e 33 do jogo**. O acabamento posterior de relógios de sessão está nas imagens `*-planning-clock.png` e no recibo `planning-clock-verification.json`: uma escrita sintética válida, inválido sem escrita, rascunho preservado e reabertura limpa; zero erros de página. Essas quatro imagens não integram a nota da rodada anterior sem a contraprova específica.
