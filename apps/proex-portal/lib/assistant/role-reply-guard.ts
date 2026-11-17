/**
 * Rolê: o texto final do modelo vira resposta para a pessoa. Com raciocínio alto, o modelo às vezes devolve
 * JSON cru de chamada de ferramenta ou cita o nome interno de uma consulta. Aqui: se for o JSON da resposta,
 * vale o campo da resposta; se for chamada de ferramenta sem resposta, sai uma mensagem simples; nome interno
 * vira o nome que a pessoa entende. Quem chama registra o caso (sem o conteúdo).
 */
import { validateRoleReply, type RoleReply } from './role-contracts';
import { ROLE_MEMORY_PREFIX, ROLE_TOOL_LABELS } from './role-memory';

export const ROLE_REPLY_FALLBACK = 'Não consegui montar a resposta. Tente perguntar de outro jeito.';
export type RoleReplyIssue = 'tool_json' | 'internal_name' | 'json';

// Não mexe em endereços: nome precedido de /, letra, número ou ponto ("…/consultar_x", "a.consultar_x") fica como está.
const INTERNAL = /(?<![/\w.])(?:consultar|filtrar|buscar|abrir|preparar|resumir|registros|minha)_[a-z0-9_]+/gi;
const REPLY_KEYS = ['reply', 'resposta', 'answer', 'content', 'text', 'texto', 'message', 'mensagem'];
const CALL_KEYS = ['name', 'tool', 'tool_name', 'tool_call', 'tool_calls', 'function', 'function_call', 'arguments', 'args', 'parameters'];
const MEMORY_ECHO = new RegExp(`\\s*${ROLE_MEMORY_PREFIX.replace(/[[\]]/g, '\\$&')}[^\\]]*\\]`, 'g');

const internal = (text: string) => { INTERNAL.lastIndex = 0; return INTERNAL.test(text); };
const humanize = (text: string) => text.replace(INTERNAL, name => ROLE_TOOL_LABELS[name.toLowerCase()] ?? 'uma consulta do portal');
function parse(text: string): unknown {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text), body = fenced ? fenced[1] : text;
  try { return JSON.parse(body); } catch { /* segue */ }
  const start = body.indexOf('{'), end = body.lastIndexOf('}');
  if (start >= 0 && end > start) { try { return JSON.parse(body.slice(start, end + 1)); } catch { /* segue */ } }
  return undefined;
}
function finish(reply: string, operation: string | null, issue: RoleReplyIssue | null): RoleReply & { issue: RoleReplyIssue | null } {
  // A linha de memória do histórico é do portal: se o modelo a repetir, ela sai da resposta.
  const text = reply.replace(MEMORY_ECHO, '').trim().slice(0, 4000);
  if (!text) return { reply: ROLE_REPLY_FALLBACK, operation: null, issue: issue ?? 'json' };
  const named = internal(text) || !!operation && internal(operation);
  return named ? { reply: humanize(text), operation: operation && humanize(operation), issue: issue ?? 'internal_name' } : { reply: text, operation, issue };
}

export function roleReplyFromModel(content: string): RoleReply & { issue: RoleReplyIssue | null } {
  const text = content.trim();
  const looksJson = /^(?:```|\{|\[\s*[{"])/.test(text) || /^[a-z]+_[a-z0-9_]+\s*\(/i.test(text);
  const parsed = parse(text);
  if (parsed === undefined && !looksJson) return finish(text, null, null);
  try { const valid = validateRoleReply(parsed); return finish(valid.reply, valid.operation, null); } catch { /* segue */ }
  const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  const callKeys = !!record && CALL_KEYS.some(key => Object.hasOwn(record, key));
  // Texto que só traz um trecho entre chaves: continua texto, a menos que o trecho seja uma chamada de ferramenta.
  if (!looksJson) return callKeys ? { reply: ROLE_REPLY_FALLBACK, operation: null, issue: 'tool_json' } : finish(text, null, null);
  const call = !record || callKeys || internal(text);
  const field = record ? REPLY_KEYS.map(key => record[key]).find((value): value is string => typeof value === 'string' && !!value.trim()) : undefined;
  // O campo de resposta só vale se for texto para a pessoa (não outro JSON); a operação de um JSON fora do formato é descartada.
  if (field && !/^\s*[{[]/.test(field)) return finish(field, null, call ? 'tool_json' : 'json');
  return { reply: ROLE_REPLY_FALLBACK, operation: null, issue: call ? 'tool_json' : 'json' };
}
