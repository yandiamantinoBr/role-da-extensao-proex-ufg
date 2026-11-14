import { HttpError } from './errors';
import { portalOrigin } from './platform';

/** Only the configured public site or local QA may provide assets to the PDF renderer. */
function assetOrigin(request: Request): string | null {
  const configured = portalOrigin();
  if (configured) return configured;
  const local = new URL(request.url);
  const loopback = local.hostname === '127.0.0.1' || local.hostname === 'localhost';
  return loopback && (typeof process === 'undefined' || process.env?.NODE_ENV !== 'production') ? local.origin : null;
}

const assetCache = new Map<string, Promise<Uint8Array>>();
function publicAsset(origin: string, path: string, limit: number): Promise<Uint8Array> {
  const key = origin + path;
  const cached = assetCache.get(key);
  if (cached) return cached;
  const pending = (async () => {
    const response = await fetch(new URL(path, origin), { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok || Number(response.headers.get('Content-Length') || 0) > limit) throw new Error('pdf_asset_unavailable');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > limit) throw new Error('pdf_asset_unavailable');
    return bytes;
  })().catch(error => { assetCache.delete(key); throw error; });
  assetCache.set(key, pending);
  return pending;
}

export async function pdfAssets(request: Request): Promise<{ fontBytes: Uint8Array; brandBytes: { proex?: Uint8Array; ufg?: Uint8Array } }> {
  const unavailable = new HttpError(503, 'Não foi possível preparar o PDF agora. Tente novamente ou baixe a planilha.', 'pdf_font_unavailable');
  const origin = assetOrigin(request);
  if (!origin) throw unavailable;
  const [fontBytes, proex, ufg] = await Promise.all([
    publicAsset(origin, '/fonts/NotoSans-Regular.ttf', 2 * 1024 * 1024).catch(() => { throw unavailable; }),
    publicAsset(origin, '/brand/proex.png', 256 * 1024).catch(() => undefined),
    publicAsset(origin, '/brand/ufg-white.png', 256 * 1024).catch(() => undefined),
  ]);
  return { fontBytes, brandBytes: { proex, ufg } };
}
