import {database} from '@/lib/platform';
import {publicError} from '@/lib/errors';
export const dynamic='force-dynamic';
// Verificação de saúde sem dados: confirma que o banco responde (e o mantém ativo no plano gratuito).
export async function GET(){try{await database().prepare('SELECT 1 AS ok').first();return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});}catch(e){return publicError(e);}}
