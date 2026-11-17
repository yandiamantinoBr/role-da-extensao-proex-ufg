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
// Agenda e compromissos do projeto, ou pedido em duas partes que termina no Portal ("depois veja na Agenda"):
// vão para a conversa com IA, que tem consultar_fontes_oficiais e consultar_agenda. Cronograma, calendário
// ou agenda do edital e data de evento do CONPEEX são documento oficial e continuam busca.
const ofEdital = String.raw`(?!\s+(?:d[oa]s?\s+)?(?:edital|editais|conpeex|23[º°o]?\s*conpeex|probec|proe[xc])\b)`;
const portalSchedule = new RegExp([
  String.raw`\bagenda\b${ofEdital}`,
  String.raw`\bcompromissos?\b`,
  String.raw`\breuni(?:ao|oes)\b`,
  String.raw`\b(?:eventos?|calendarios?)\s+d[oe]s?\s+(?:(?:meu|nosso)\s+)?projetos?\b`,
  String.raw`\b(?:meu|nosso)\s+calendario\b`,
  String.raw`\bdepois\b[^.?!]{0,20}?\b(?:veja|ve|consulte|confira|verifique|olhe|procure|busque)\b[^.?!]{0,40}?\b(?:n[oa]s?|em)\s+(?:portal(?!\s+(?:oficial|da\s+proe[xc]|do\s+conpeex))|agenda|demandas?|tarefas?|calendario|estoque|projetos?|sistema)\b`,
].join('|'));

function portalAction(value: string): boolean {
  const text = value.replace(/https:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim();
  return commandStart.test(text) || !question.test(text) && actionAnywhere.test(text);
}

/** Encaminha consultas ao site público e a editais oficiais identificáveis. */
export function isOfficialSearch(message: string): boolean {
  const value = message.trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  // Link oficial colado é destino exato, salvo quando a frase pede uma operação no Portal.
  if (officialPdfIn(message) || officialPageIn(message)) return !portalAction(value);
  // Sem link: pedido que também consulta a Agenda ou o Portal não vira busca automática (o botão continua valendo).
  if (portalSchedule.test(value)) return false;
  if (requestsOfficialPdf(value) && (program.test(value) || documentCue.test(value)) && !portalAction(value) && !portalData.test(value)) return true;
  const site = /\b(?:(?:site|portal)\s+oficial\b|(?:site|portal)\s+(?:da|do)\s+(?:proe[xc]|23[º°o]?\s*conpeex|conpeex)\b|(?:proex\.ufg\.br|23conpeex\.plateia\.ufg\.br)(?![\w.-]))/;
  const lookup = /\b(?:pesquise|pesquisar|busque|buscar|procure|procurar|consulte|consultar|ache|encontre|encontrar|verifique|confira|acesse|veja|qual|quais|onde|quando|quanto|quantos|quantas|saber|tem|esta)\b/;
  return site.test(value) && (lookup.test(value) || value.includes('?') || /^(?:site|portal|https:\/\/)/.test(value));
}

const plainText = (message: string) => message.trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ');
const proexName = String.raw`(?:proe[xc]|pro[\s-]?reitoria\s+de\s+extensao)`;
// Operação no Portal ou redação de texto: nunca vira resposta direta de links ou notícias.
const portalOrWriting = /\b(?:registr\w*|cadastr\w*|cri(?:a|e|ar|em)|lanc\w*|demandas?|tarefas?|entregas?|estoque|projetos?|no portal|escrev\w*|redi[gj]\w*|prepar\w*|mont\w*|elabor\w*|fa(?:ca|z|zer)|suger\w*|sugir\w*|ger(?:e|ar)|publique|publicar|postar|poste|divulg\w*|legendas?|rascunho|texto)\b/;
const linksCue = String.raw`\b(?:links?(?:\s+(?:uteis|oficiais|importantes|principais))?|acesso\s+rapido|sistemas|servicos|atalhos|enderecos)\b`;
const proexLinks = new RegExp(String.raw`${linksCue}[^.?!]{0,30}?\b(?:d[ao]s?|de|n[ao])\s+(?:(?:pagina|site)(?:\s+inicial)?\s+d[ao]\s+)?${proexName}\b|\bpagina\s+inicial\s+d[ao]\s+${proexName}\b|\blinks?\s+digitais\b`);
const proexPublished = new RegExp(String.raw`\b(?:o\s+que|que)\s+(?:a\s+)?${proexName}\s+(?:publicou|postou|divulgou|anunciou)\b`);
const proexMention = new RegExp(String.raw`\b${proexName}\b`);
const recentCue = /\b(?:posts?|postage(?:m|ns)|publicac(?:ao|oes)|ultim[oa]s?|recentes?|novidades?|novos?|novas?)\b/;

/** "Links da PROEX": links digitais, úteis, acesso rápido, sistemas ou serviços da página inicial da PROEX. */
export function asksProexLinks(message: string): boolean {
  const value = plainText(message);
  return !portalOrWriting.test(value) && proexLinks.test(value);
}

/** Últimos posts do Instagram da PROEX, o que a PROEX publicou ou notícias recentes do site. */
export function asksProexNews(message: string): boolean {
  const value = plainText(message);
  if (portalOrWriting.test(value)) return false;
  if (/\binstagram\b/.test(value) && recentCue.test(value)) return true;
  if (proexPublished.test(value)) return true;
  return /\b(?:noticias?|novidades)\b/.test(value) && (proexMention.test(value) || /\b(?:recentes?|ultim[oa]s?|novas|site)\b/.test(value));
}

/** Resposta direta, sem IA, em qualquer modo: links da página inicial ou Instagram e notícias. */
export function directOfficialKind(message: string): 'links' | 'news' | null {
  return asksProexNews(message) ? 'news' : asksProexLinks(message) ? 'links' : null;
}

export type RoleComposerMode = 'chat' | 'search' | 'off';
/** Conversa com IA, só a busca em fontes oficiais (sem chave de conversa) ou nada. */
export function roleComposerMode(status: { available: boolean; policy?: { publicSearch: boolean } } | null | undefined): RoleComposerMode {
  if (!status) return 'off';
  if (status.available) return 'chat';
  return status.policy?.publicSearch ? 'search' : 'off';
}

/**
 * Para onde vai o envio: busca oficial sem custo quando a pessoa liga "Fontes oficiais" ou quando só a
 * busca está disponível; links e notícias da PROEX respondem direto em qualquer modo. Com a conversa
 * disponível, a pergunta sobre editais reconhecida na frase vai ao modelo, que lê as fontes com as ferramentas.
 */
export function officialRoute(input: { mode: RoleComposerMode; toggled: boolean; publicSearch: boolean; attachment: boolean; text: string }): { official: boolean; explicit: boolean } {
  if (input.mode === 'off' || !input.publicSearch || input.attachment) return { official: false, explicit: false };
  const explicit = input.mode === 'search' || input.toggled;
  return { official: explicit || isOfficialSearch(input.text) || directOfficialKind(input.text) !== null, explicit };
}
