import { database } from '@/lib/platform';
import { personalMcp } from '@/lib/mcp/transport';
export const dynamic = 'force-dynamic';
export function POST(request: Request) { return personalMcp(request, database()); }
const unsupported = () => new Response(null, { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } });
export const GET = unsupported;
export const DELETE = unsupported;
