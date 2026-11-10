// Markdown mínimo e seguro do Guia: títulos (#, ##), parágrafos, listas (-, 1.) com recuo,
// **negrito**, _itálico_ e [links](https://…). Nada de HTML: o texto vira estrutura, nunca marcação.
import type { Block, ReportDocument, ReportSection } from '../project-report/document';

export type Inline = { text: string; bold?: boolean; italic?: boolean; href?: string };
export type MdBlock =
  | { type: 'h1' | 'h2' | 'h3' | 'p'; inline: Inline[] }
  | { type: 'list'; ordered: boolean; items: { depth: number; inline: Inline[] }[] };

function safeHref(value: string): string | undefined {
  try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined; } catch { return undefined; }
}
export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let text = '', bold = false, italic = false;
  const flush = () => { if (text) out.push({ text, ...(bold ? { bold } : {}), ...(italic ? { italic } : {}) }); text = ''; };
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '\\' && i + 1 < source.length) { text += source[++i]; continue; }
    if (char === '*' && source[i + 1] === '*') { flush(); bold = !bold; i++; continue; }
    if (char === '_' && (i === 0 || /[\s(]/.test(source[i - 1]) || italic)) { flush(); italic = !italic; continue; }
    if (char === '[') {
      const close = source.indexOf('](', i), end = close >= 0 ? source.indexOf(')', close + 2) : -1;
      if (close > i && end > close) {
        const label = source.slice(i + 1, close), href = safeHref(source.slice(close + 2, end));
        flush();
        out.push({ text: label, ...(href ? { href } : {}), ...(bold ? { bold } : {}), ...(italic ? { italic } : {}) });
        i = end; continue;
      }
    }
    text += char;
  }
  flush();
  return out;
}
export function parseMarkdown(source: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => { if (paragraph.length) blocks.push({ type: 'p', inline: parseInline(paragraph.join(' ')) }); paragraph = []; };
  for (const raw of source.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const item = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (!line.trim()) { flush(); continue; }
    if (heading) { flush(); blocks.push({ type: heading[1].length === 1 ? 'h1' : heading[1].length === 2 ? 'h2' : 'h3', inline: parseInline(heading[2]) }); continue; }
    if (item) {
      flush();
      const ordered = /\d/.test(item[2]), depth = Math.min(3, Math.floor(item[1].replace(/\t/g, '  ').length / 2)), last = blocks.at(-1);
      const entry = { depth, inline: parseInline(item[3]) };
      if (last?.type === 'list' && last.ordered === ordered) last.items.push(entry); else blocks.push({ type: 'list', ordered, items: [entry] });
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}
export const plainText = (inline: Inline[]) => inline.map(part => part.href && part.href !== part.text ? `${part.text} (${part.href})` : part.text).join('');

/** O guia inteiro como documento: a mesma capa, sumário e numeração do relatório do projeto. */
export function guideDocument(organizationName: string, pages: { slug: string; title: string; sectionLabel: string; markdown: string; updatedAt: string | null; updatedBy: string; version: number }[], now = new Date()): ReportDocument {
  const sections: ReportSection[] = pages.map((page, index) => {
    const blocks: Block[] = [];
    for (const block of parseMarkdown(page.markdown)) {
      if (block.type === 'h1') continue;
      if (block.type === 'h2' || block.type === 'h3') blocks.push({ kind: 'subheading', text: plainText(block.inline) });
      else if (block.type === 'p') blocks.push({ kind: 'paragraph', text: plainText(block.inline) });
      else if (block.type === 'list') blocks.push({ kind: 'paragraph', text: block.items.map((item, position) => `${'   '.repeat(item.depth)}${block.ordered ? `${position + 1}.` : '•'} ${plainText(item.inline)}`).join('\n') });
    }
    blocks.push({ kind: 'note', text: page.version ? `Versão ${page.version}${page.updatedBy ? `, por ${page.updatedBy}` : ''}${page.updatedAt ? `, em ${new Date(page.updatedAt).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : ''}.` : 'Conteúdo inicial, ainda não revisado pela equipe.' });
    return { id: 'notes', number: index + 1, title: page.title, blocks };
  });
  return {
    kicker: 'Guia da organização', title: `Guia da ${organizationName}`, projectName: 'Como a organização funciona', subtitle: 'Estrutura, programas, processos, calendário, contatos e glossário',
    period: 'Conteúdo vigente', generatedAt: `${now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })} (Brasília)`,
    generatedIso: now.toISOString(), sections, unavailable: [],
  };
}
