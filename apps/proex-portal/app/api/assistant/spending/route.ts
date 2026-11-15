import { getActor } from '@/lib/access';
import { aiSpending, aiSpendingDay } from '@/lib/assistant/spending';
import { spendingCallsWorkbook } from '@/lib/assistant/spending-export';
import { HttpError, publicError } from '@/lib/errors';
import { database } from '@/lib/platform';
import { getPortalUser } from '@/lib/session';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };

function failed(error: unknown) {
  const response = publicError(error);
  for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  return response;
}

/** Resumo por período, lista do dia filtrada ou a mesma lista em XLSX. Somente administração geral. */
export async function GET(request: Request): Promise<Response> {
  try {
    const db = database(), actor = await getActor(db, await getPortalUser());
    if (!actor) throw new HttpError(401, 'Entre para ver os gastos de IA.', 'unauthenticated');
    const params = new URL(request.url).searchParams, organizationId = params.get('organizationId'), day = params.get('day');
    const fields = day !== null ? ['organizationId','day','fn','provider','result','format'] : ['organizationId','from','to'];
    if ([...params.keys()].some(key => !fields.includes(key) || params.getAll(key).length > 1)) {
      throw new HttpError(400, 'Confira o período e os filtros de gastos.', 'assistant_spending_query');
    }
    if (day !== null) {
      const filters = { fn: params.get('fn'), provider: params.get('provider'), result: params.get('result') };
      const format = params.get('format');
      if (format !== null && format !== 'xlsx') throw new HttpError(400, 'Escolha o formato XLSX para baixar as chamadas.', 'assistant_spending_format');
      const detail = await aiSpendingDay(db, actor, { organizationId, day, ...filters });
      if (!format) return Response.json(detail, { headers });
      if (!detail.calls.length) throw new HttpError(409, 'Nenhuma chamada encontrada neste recorte.', 'assistant_spending_empty');
      request.signal.throwIfAborted();
      const artifact = spendingCallsWorkbook(detail, filters);
      return new Response(artifact, { headers: {
        ...headers,
        'Content-Type': artifact.type,
        'Content-Disposition': `attachment; filename="proex-chamadas-ia-${detail.day}.xlsx"`,
      } });
    }
    return Response.json(await aiSpending(db, actor, { organizationId, from: params.get('from'), to: params.get('to') }), { headers });
  } catch (error) { return failed(error); }
}
