import { officialPageIn, officialPdfIn, requestsOfficialPdf } from './official-pdf-url';

// Sinal claro de documento oficial da PROEX: programa, número, edital de extensão/PROEX ou aditivo, retificação e resultado.
const program = /\b(?:probec|conpeex)\b/;
const documentCue = new RegExp([
  String.raw`\bedita(?:l|is)\b[^.?!]{0,40}\bextensao\b`,
  String.raw`\bedita(?:l|is)\s+(?:(?:da|do)\s+)?proe[xc]\b`,
  String.raw`\bedital\s+(?:proe[xc]\s+)?(?:n\s*[º°o.]?\s*)?\d{1,3}(?:\s*\/\s*20\d{2})?\b`,
  String.raw`\bn\s*[º°.]\s*\d{1,3}\s*\/\s*20\d{2}\b`,
  String.raw`\b(?:aditivo|retificac(?:ao|oes)|resultado|errata|prorrogacao)\s+(?:(?:final|preliminar)\s+)?(?:d[oa]s?\s+)?edita(?:l|is)\b`,
  String.raw`\btermo\s+aditivo\b`,
].join('|'));
// Pedidos de operação no Portal ou de redação não são consulta a documento publicado.
const portalAction = /\b(?:registr\w*|cadastr\w*|cri(?:e|ar|a)|mov(?:a|er|e)|lanc(?:e|ar)|apag\w*|exclu\w*|remov\w*|transfir\w*|transferir|agend\w*|anot\w*|atribu\w*|prepar(?:e|ar)|redij\w*|redigi\w*|escrev\w*|elabor\w*|mont(?:e|ar)|edit(?:e|ar))\b/;

/** Encaminha consultas ao site público e a editais oficiais identificáveis. */
export function isOfficialSearch(message: string): boolean {
  const value = message.trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  if (officialPdfIn(message) || officialPageIn(message)) return true;
  if (requestsOfficialPdf(value) && (program.test(value) || documentCue.test(value)) && !portalAction.test(value)) return true;
  const site = /\b(?:(?:site|portal)\s+oficial\b|(?:site|portal)\s+(?:da|do)\s+(?:proe[xc]|23[º°o]?\s*conpeex|conpeex)\b|(?:proex\.ufg\.br|23conpeex\.plateia\.ufg\.br)(?![\w.-]))/;
  const lookup = /\b(?:pesquise|pesquisar|busque|buscar|procure|procurar|consulte|consultar|ache|encontre|encontrar|verifique|confira|acesse|veja|qual|quais|onde|quando|quanto|quantos|quantas|saber|tem|esta)\b/;
  return site.test(value) && (lookup.test(value) || value.includes('?') || /^(?:site|portal|https:\/\/)/.test(value));
}
