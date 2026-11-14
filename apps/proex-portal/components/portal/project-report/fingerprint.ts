import type { ReportDocument } from './document';

/** Compare the rendered content in browser and server using the same preview timestamp. */
export async function reportDocumentDigest(doc: ReportDocument): Promise<string> {
  // The display of the timestamp is localized independently by the browser and server.
  const { generatedAt, ...content } = doc;
  void generatedAt;
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(content)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
