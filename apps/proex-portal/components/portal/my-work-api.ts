'use client';

export class WorkApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

/** The canonical validators run before any response becomes visible to a component. */
export async function workApi<T>(path: string, valid: (value: unknown) => value is T, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal,
    ...(body ? {headers: {'Content-Type': 'application/json', 'X-Proex-Action': '1'}, body: JSON.stringify(body)} : {}),
  });
  let data: unknown;
  try { data = await response.json(); }
  catch (error) {
    if (signal.aborted || error instanceof Error && error.name === 'AbortError') throw error;
    if (response.ok) throw new WorkApiError('A resposta chegou incompleta. Atualize e tente novamente.', response.status);
  }
  if (signal.aborted) { const error = new Error('Consulta cancelada.'); error.name = 'AbortError'; throw error; }
  if (!response.ok) throw new WorkApiError(response.status === 403 || response.status === 401
    ? 'Seu acesso mudou. Atualize a sessão para consultar este contexto.'
    : response.status === 409 ? 'Este registro mudou. Atualize antes de salvar novamente.'
    : 'Não foi possível concluir a consulta. Tente novamente.', response.status);
  if (!valid(data)) throw new WorkApiError('A resposta não corresponde à consulta. Atualize e tente novamente.', response.status);
  return data;
}
