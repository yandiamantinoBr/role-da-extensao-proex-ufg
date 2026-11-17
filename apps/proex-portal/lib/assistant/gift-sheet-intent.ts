// Planilha de brindes: fica em outra conta do Google e o Rolê ainda não tem acesso a ela.
// Decisão de 2026-11-16: o acesso virá quando a planilha for compartilhada como leitor; até lá, resposta direta, sem IA.

export const GIFT_SHEET_REPLY = 'Ainda não tenho acesso à planilha de brindes: ela está em outra conta do Google. Para eu ler, a administração do Portal precisa compartilhar a planilha comigo, só para leitura. Enquanto isso, posso ajudar com o que está no Portal: os níveis de brinde da dinâmica, as entregas registradas e o estoque do projeto.';

// "Tabela" sozinha não conta: as tabelas de distribuição por dia ficam no texto das demandas do Portal.
const sheet = /\b(?:planilhas?|google\s+sheets?|sheets?|spreadsheets?|tabelas?\s+(?:do\s+)?google)\b/;
const gift = /\bbrindes?\b/;
// Pedir uma planilha nova a partir do Portal (exportar, baixar, gerar) não é perguntar pela planilha de brindes.
const makeSheet = /\b(?:export\w*|baix\w*|(?:ger|cri|mont|fac|faz)(?:a|e|ar|er|ir)?\s+(?:uma\s+|a\s+)?(?:planilha|tabela))\b/;

/** Pergunta sobre a planilha (Google Sheets) de brindes, e não sobre brindes no Portal ou outra planilha. */
export function asksGiftSheet(message: string): boolean {
  const value = message.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ');
  return sheet.test(value) && gift.test(value) && !makeSheet.test(value);
}
