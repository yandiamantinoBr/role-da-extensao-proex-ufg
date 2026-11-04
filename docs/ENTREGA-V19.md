# V19 · atividades de dia inteiro na Agenda

Na Linha do tempo de um projeto, o formato **Dia inteiro (sem horário)** guarda o primeiro e o último dia como datas civis, incluindo ambos. A Agenda mostra o período completo. No iCalendar, `DTEND` fica no dia seguinte ao último dia visível, conforme o formato de data exclusiva. Assim, o período de 9 a 13 de novembro aparece em cinco dias. [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545.html#section-3.6.1).

As atividades com horário mantêm seus timestamps ao editar campos que não mudaram. O formulário pede correção explícita de datas antigas inválidas ou misturadas. A projeção da Agenda filtra intervalos civis inconsistentes. As datas usam os mesmos campos de texto e passam pelo conector Sheets como valores literais. Os testes cobrem edição, restauração, limites do período, exportação ICS e ida e volta pelo conector.

O cadastro existente do 23º CONPEEX aponta para a mesma página oficial vinculada pela UFG. A programação geral informa 9 a 13/11/2026, no Centro de Cultura e Eventos, Câmpus Samambaia. O registro de produção deve ser uma atividade de dia inteiro vinculada a esse cadastro, com a página da UFG no campo de fonte. [Programação oficial da UFG](https://ufg.br/e/39456-23-congresso-de-pesquisa-ensino-e-extensao-conpeex).

Fontes integradas `ede7053`, `23a4ac1`, `2290065` e `878d6ea`. Conferências de CI, produção, Sheets e Google Calendar serão registradas conforme os resultados observados.
