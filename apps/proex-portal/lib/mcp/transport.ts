import { HttpError } from '../errors';
import { mcpIdentity } from './tokens';
import { callPersonalTool, personalResources, personalTools, readPersonalResource } from './resources';

export const MCP_VERSION = '2026-07-28';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'MCP-Protocol-Version': MCP_VERSION };
class ProtocolError extends Error { constructor(public status: number, public code: number, message: string, public data?: unknown) { super(message); } }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get('Content-Length') ?? 0) > 8192) throw new ProtocolError(413, -32600, 'Request body is too large');
  const reader = request.body?.getReader(), chunks: Uint8Array[] = []; let length = 0;
  if (reader) try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.length; if (length > 8192) { await reader.cancel(); throw new ProtocolError(413, -32600, 'Request body is too large'); } chunks.push(chunk.value); } } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let value: unknown; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new ProtocolError(400, -32700, 'Parse error'); }
  if (!record(value)) throw new ProtocolError(400, -32600, 'Invalid request'); return value;
}
function headerValue(value: string | null): string | null {
  if (!value?.startsWith('=?base64?')) return value;
  if (!value.endsWith('?=')) return null;
  try { const bytes = Uint8Array.from(atob(value.slice(9, -2)), byte => byte.charCodeAt(0)); return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; }
}
function keys(params: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(params).some(key => !['_meta', ...allowed].includes(key))) throw new ProtocolError(400, -32602, 'Invalid params');
}
function validate(request: Request, body: Record<string, unknown>) {
  if (body.jsonrpc !== '2.0' || typeof body.method !== 'string' || body.method.length > 100 || !(typeof body.id === 'string' && body.id.length <= 100 || Number.isSafeInteger(body.id))) throw new ProtocolError(400, -32600, 'Invalid request');
  if (!record(body.params) || !record(body.params._meta)) throw new ProtocolError(400, -32602, 'Required per-request metadata is missing');
  const meta = body.params._meta, version = meta['io.modelcontextprotocol/protocolVersion'];
  if (typeof version !== 'string' || !record(meta['io.modelcontextprotocol/clientCapabilities'])) throw new ProtocolError(400, -32602, 'Required per-request metadata is missing');
  if (version !== MCP_VERSION) throw new ProtocolError(400, -32022, 'Unsupported protocol version', { supported: [MCP_VERSION], requested: version });
  const name = body.method === 'tools/call' ? body.params.name : body.method === 'resources/read' ? body.params.uri : undefined;
  if (request.headers.get('MCP-Protocol-Version') !== version || request.headers.get('Mcp-Method') !== body.method || name !== undefined && headerValue(request.headers.get('Mcp-Name')) !== name) throw new ProtocolError(400, -32020, 'Header mismatch');
  const accepted = (request.headers.get('Accept') ?? '').toLowerCase().split(',').map(part => {
    const [media, ...parameters] = part.trim().split(';'), quality = parameters.find(parameter => parameter.trim().startsWith('q='));
    const q = quality === undefined ? 1 : Number(quality.trim().slice(2)); return q > 0 && q <= 1 ? media.trim() : '';
  });
  if (!accepted.includes('application/json') || !accepted.includes('text/event-stream')) throw new ProtocolError(406, -32600, 'Accept must include application/json and text/event-stream');
  return body.params;
}
const serverMeta = { 'io.modelcontextprotocol/serverInfo': { name: 'Portal PROEX · Consultas pessoais', version: '1.0.0' } };
/** Standalone endpoint: no Sites identity header, cookie or provider credential is accepted. */
export async function personalMcp(request: Request, db: D1Database): Promise<Response> {
  let id: unknown;
  try {
    const origin = request.headers.get('Origin');
    if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, 'Origem da conexão inválida.', 'mcp_origin');
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) throw new ProtocolError(415, -32600, 'Content-Type must be application/json');
    const body = await readBody(request); id = typeof body.id === 'string' || Number.isSafeInteger(body.id) ? body.id : undefined;
    const params = validate(request, body), method = body.method;
    let result: Record<string, unknown>;
    if (method === 'server/discover') { keys(params, []); result = { supportedVersions: [MCP_VERSION], capabilities: { tools: {}, resources: {} }, instructions: 'Consultas pessoais limitadas aos projetos autorizados. Não há mutações, geração de IA ou sincronização mestre. Credencial Bearer manual; este endpoint não implementa OAuth ou protocolos anteriores.' }; }
    else {
      const authorization = request.headers.get('Authorization'), identity = await mcpIdentity(db, authorization);
      if (method === 'tools/list') { keys(params, []); result = { tools: personalTools(identity) }; }
      else if (method === 'resources/list') { keys(params, []); result = { resources: personalResources(identity) }; }
      else if (method === 'tools/call') {
        keys(params, ['name', 'arguments']); if (typeof params.name !== 'string' || !record(params.arguments)) throw new ProtocolError(400, -32602, 'Invalid tool arguments');
        const value = await callPersonalTool(db, identity, params.name, params.arguments);
        result = { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value };
      } else if (method === 'resources/read') { keys(params, ['uri']); result = await readPersonalResource(db, identity, params.uri); }
      else throw new ProtocolError(404, -32601, 'Method not found');
      // Re-read credentials, account and project memberships after every read, including lists.
      const current = await mcpIdentity(db, authorization);
      if (current.tokenId !== identity.tokenId || JSON.stringify(current.scopes) !== JSON.stringify(identity.scopes) || JSON.stringify(current.projectIds) !== JSON.stringify(identity.projectIds)) throw new HttpError(403, 'A conexão mudou durante a consulta.', 'mcp_scope');
    }
    return Response.json({ jsonrpc: '2.0', id, result: { resultType: 'complete', ...result, _meta: serverMeta } }, { headers });
  } catch (error) {
    if (error instanceof ProtocolError) return Response.json({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }), error: { code: error.code, message: error.message, ...(error.data === undefined ? {} : { data: error.data }) } }, { status: error.status, headers });
    const known = error instanceof HttpError, status = known ? error.status : 500;
    return Response.json({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }), error: { code: known ? status === 401 ? 1001 : status === 403 ? 1003 : -32602 : -32603, message: known ? error.message : 'Não foi possível consultar esta conexão.' } }, { status, headers: { ...headers, ...(status === 401 ? { 'WWW-Authenticate': 'Bearer realm="proex-mcp"' } : {}) } });
  }
}
