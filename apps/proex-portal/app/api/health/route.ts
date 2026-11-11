import {database} from '@/lib/platform';
import {publicError} from '@/lib/errors';
import {maybeRefreshOfficialSources} from '@/lib/assistant/official-sources';
import {scheduledChatMediaPurge} from '@/lib/community/chat';
import {chatMediaStore} from '@/lib/community/media-store';
export const dynamic='force-dynamic';
// Verificação de saúde sem dados: confirma que o banco responde (e o mantém ativo no plano gratuito).
// A rotina diária também atualiza a cópia das páginas públicas oficiais do Rolê (no máximo a cada 20 h, sem custo; só na Vercel, nunca no QA local)
// e remove as fotos de conversa com mais de 180 dias (em lotes, no máximo uma vez por hora por instância). A resposta nunca traz dados.
export async function GET(){try{const db=database();await db.prepare('SELECT 1 AS ok').first();if(process.env.VERCEL==='1')await maybeRefreshOfficialSources(db).catch(()=>false);await Promise.resolve().then(()=>scheduledChatMediaPurge(db,chatMediaStore())).catch(()=>null);return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});}catch(e){return publicError(e);}}
