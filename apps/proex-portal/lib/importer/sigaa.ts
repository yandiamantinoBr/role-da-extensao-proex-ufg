import { HttpError } from '../errors';
import { IMPORT_TEXT_LIMIT } from './contracts';
import { decodeEntities } from './parse';

const ORIGIN = 'https://sigaa.sistemas.ufg.br';
export function canonicalSigaaUrl(value: unknown): { url: string; externalId: string } {
  if (typeof value !== 'string' || value.length > 500) throw new HttpError(400, 'Informe o número da ação ou seu link público do SIGAA/UFG.', 'import_sigaa_url');
  const trimmed = value.trim(); let parsed: URL;
  try { parsed = new URL(/^\d{1,10}$/.test(trimmed) ? `${ORIGIN}/sigaa/link/public/extensao/visualizacaoAcaoExtensao/${trimmed}` : trimmed); } catch { throw new HttpError(400, 'Use o link público de uma ação de extensão do SIGAA/UFG.', 'import_sigaa_url'); }
  const id = parsed.pathname.match(/^\/sigaa\/link\/public\/extensao\/visualizacaoAcaoExtensao\/(\d{1,10})\/?$/)?.[1];
  if (parsed.origin !== ORIGIN || parsed.username || parsed.password || parsed.search || parsed.hash || !id || /^0+$/.test(id)) throw new HttpError(400, 'Use somente o link público da ação de extensão no SIGAA/UFG.', 'import_sigaa_url');
  return { url: `${ORIGIN}/sigaa/link/public/extensao/visualizacaoAcaoExtensao/${id}`, externalId: id };
}
// Follow only observed public extension routes. Cookies are anonymous, per-request,
// memory-only; global fetch does not retain them across SIGAA's redirects itself.
export async function readPublicSigaa(value: unknown, fetcher: typeof fetch = fetch): Promise<{ content: string; url: string; externalId: string }> {
  const source = canonicalSigaaUrl(value), cookies = new Map<string, string>();
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
  let current = source.url;
  try {
    for (let hop = 0; hop < 5; hop++) {
      const response = await fetcher(current, { redirect: 'manual', cache: 'no-store', signal: controller.signal,
        headers: { Accept: 'text/html', ...(cookies.size ? { Cookie: Array.from(cookies, ([key, value]) => `${key}=${value}`).join('; ') } : {}) } });
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';', 1)[0], split = pair.indexOf('=');
        if (split > 0 && /^[A-Za-z0-9_-]+$/.test(pair.slice(0, split))) cookies.set(pair.slice(0, split), pair.slice(split + 1));
      }
      if (response.status >= 300 && response.status < 400) {
        const destination = response.headers.get('location'); if (!destination) throw new HttpError(502, 'O SIGAA não informou a página de destino.', 'import_sigaa_unavailable');
        const next = new URL(destination, current), pathname = next.pathname.replace(/;jsessionid=[^/]*/i, '');
        if (next.origin !== ORIGIN || next.username || next.password || !(/^\/sigaa\/public\/extensao\/[A-Za-z0-9_]+\.jsf$/.test(pathname) || /^\/sigaa\/link\/public\/extensao\/visualizacaoAcaoExtensao\/\d+$/.test(pathname))) throw new HttpError(422, 'O SIGAA pediu uma etapa fora da consulta pública. Abra o sistema e use um documento textual.', 'import_sigaa_protected');
        current = next.href; continue;
      }
      if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('text/html')) throw new HttpError(502, 'A consulta pública do SIGAA não respondeu como esperado. Tente mais tarde ou use um documento.', 'import_sigaa_unavailable');
      if (Number(response.headers.get('content-length') ?? 0) > IMPORT_TEXT_LIMIT || !response.body) throw new HttpError(413, 'A página do SIGAA excedeu o limite de leitura.', 'import_document_limit');
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > IMPORT_TEXT_LIMIT) { await reader.cancel(); throw new HttpError(413, 'A página do SIGAA excedeu o limite de leitura.', 'import_document_limit'); } chunks.push(value); } } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const charset = response.headers.get('content-type')?.match(/charset\s*=\s*([\w-]+)/i)?.[1] ?? 'utf-8';
      let content: string; try { content = new TextDecoder(charset).decode(bytes); } catch { throw new HttpError(422, 'A codificação da página não pôde ser reconhecida.', 'import_sigaa_encoding'); }
      if (/g-recaptcha|h-captcha|captcha|autentica..o necess.ria|sess.o expirada/i.test(content)) throw new HttpError(422, 'O SIGAA exige uma verificação humana. Abra o sistema e use um documento textual; nenhuma proteção foi contornada.', 'import_sigaa_protected');
      const readable = decodeEntities(content);
      if (!readable.includes(`/visualizacaoAcaoExtensao/${source.externalId}`) || /\/visualizacaoAcaoExtensao\/0(?:["'<\s]|$)/.test(readable)) throw new HttpError(422, 'O SIGAA retornou uma página sem a ação solicitada. Use um documento ou tente mais tarde.', 'import_sigaa_empty');
      return { content, ...source };
    }
    throw new HttpError(502, 'A consulta pública redirecionou muitas vezes. Tente mais tarde.', 'import_sigaa_unavailable');
  } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(502, 'Não foi possível consultar o SIGAA agora. Tente mais tarde ou use um documento textual.', 'import_sigaa_unavailable'); }
  finally { clearTimeout(timer); cookies.clear(); }
}
