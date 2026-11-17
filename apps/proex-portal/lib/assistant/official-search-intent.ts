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

// Verbos de operação no Portal ou de redação, com terminações explícitas (imperativo, 3ª pessoa e infinitivo).
// Terminações fechadas evitam "edital", "abril", "critério", "registro", "envio" e "anexo".
const actionVerb = [
  String.raw`(?:registr|cadastr|cri|lanc|agend|anot|prepar|mont|edit|moviment|envi|anex|vincul|divulg|atualiz|alter|finaliz|adicion|elabor|salv|arquiv|reserv|emprest|apag|public)(?:a|e|ar|em|am)`,
  String.raw`(?:apagu|divulgu|publiqu)e`,
  String.raw`(?:mov|remov|escrev)(?:a|e|er|em|am)`,
  String.raw`(?:exclu|atribu|conclu)(?:a|i|ir|am)`,
  String.raw`(?:abr|redig|transfer|inser)(?:a|e|ir|em|am)`,
  String.raw`(?:redij|insir|transfir)a`,
].join('|');
// Pedido de comando: a frase começa pelo verbo, talvez depois de um "pode", "por favor" ou "me ajuda a".
const commandStart = new RegExp(String.raw`^(?:(?:por favor|favor|role|ola|oi|pode|podes|poderia|consegue|voce pode|quero que voce|quero|preciso|vamos|me ajude a|me ajuda a|me|agora|entao)[\s,:]+)*(?:${actionVerb})\b`);
const actionAnywhere = new RegExp(String.raw`\b(?:${actionVerb})\b`);
// Pergunta: "quando/qual/quantos..." ou "?" — aí um verbo no meio ("prazo para enviar") não é comando.
const question = /\?|\b(?:quando|qual|quais|quanto|quantos|quantas|como|onde|o que|por que|existe|ha)\b/;
// Dado do Portal (projetos, demandas, estoque...) não é documento publicado. "projetos" sozinho não veta.
const portalData = /\b(?:no portal(?!\s+(?:oficial|da\s+proe[xc]|do\s+conpeex))|aqui no|no sistema|projetos?\s+(?:do|no)\s+portal|demandas?|tarefas?|entregas?|estoque|brindes?|kits?|emprestimos?|responsavel)\b/;

function portalAction(value: string): boolean {
  const text = value.replace(/https:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim();
  return commandStart.test(text) || !question.test(text) && actionAnywhere.test(text);
}

/** Encaminha consultas ao site público e a editais oficiais identificáveis. */
export function isOfficialSearch(message: string): boolean {
  const value = message.trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  // Link oficial colado é destino exato, salvo quando a frase pede uma operação no Portal.
  if (officialPdfIn(message) || officialPageIn(message)) return !portalAction(value);
  if (requestsOfficialPdf(value) && (program.test(value) || documentCue.test(value)) && !portalAction(value) && !portalData.test(value)) return true;
  const site = /\b(?:(?:site|portal)\s+oficial\b|(?:site|portal)\s+(?:da|do)\s+(?:proe[xc]|23[º°o]?\s*conpeex|conpeex)\b|(?:proex\.ufg\.br|23conpeex\.plateia\.ufg\.br)(?![\w.-]))/;
  const lookup = /\b(?:pesquise|pesquisar|busque|buscar|procure|procurar|consulte|consultar|ache|encontre|encontrar|verifique|confira|acesse|veja|qual|quais|onde|quando|quanto|quantos|quantas|saber|tem|esta)\b/;
  return site.test(value) && (lookup.test(value) || value.includes('?') || /^(?:site|portal|https:\/\/)/.test(value));
}

export type RoleComposerMode = 'chat' | 'search' | 'off';
/** Conversa com IA, só a busca em fontes oficiais (sem chave de conversa) ou nada. */
export function roleComposerMode(status: { available: boolean; policy?: { publicSearch: boolean } } | null | undefined): RoleComposerMode {
  if (!status) return 'off';
  if (status.available) return 'chat';
  return status.policy?.publicSearch ? 'search' : 'off';
}

/** Para onde vai o envio: busca oficial (pedida na alternância, imposta no modo só busca ou reconhecida na frase) ou conversa. */
export function officialRoute(input: { mode: RoleComposerMode; toggled: boolean; publicSearch: boolean; attachment: boolean; text: string }): { official: boolean; explicit: boolean } {
  if (input.mode === 'off' || !input.publicSearch || input.attachment) return { official: false, explicit: false };
  const explicit = input.mode === 'search' || input.toggled;
  return { official: explicit || isOfficialSearch(input.text), explicit };
}
