import {getPortalUser} from '@/lib/session';
import { accessibleProjects, getActor, requireCapability, projectAuthoritySql } from '@/lib/access';
import { all, csv, type Row } from '@/lib/database';
import { HttpError, publicError } from '@/lib/errors';
import { database } from '@/lib/platform';

export const dynamic = 'force-dynamic';

function scopeFilter(column: string, projects: string[] | null): { sql: string; params: unknown[] } {
  if (projects === null) return { sql: '1=1', params: [] };
  if (!projects.length) return { sql: '1=0', params: [] };
  return { sql: `${column} IN (${projects.map(() => '?').join(',')})`, params: projects };
}

export async function GET(request: Request): Promise<Response> {
  try {
    const user = await getPortalUser();
    if (!user) throw new HttpError(401, 'Entre com sua conta para exportar.', 'unauthenticated');
    const db = database();
    const actor = await getActor(db, user);
    const url = new URL(request.url);
    const kind = url.searchParams.get('kind') ?? 'participations';
    if (!['participations', 'stock', 'loans'].includes(kind)) {
      throw new HttpError(400, 'Escolha uma exportação válida.', 'invalid_export');
    }
    const projectId = url.searchParams.get('projectId');
    requireCapability(actor, 'reports.read', projectId === null ? undefined : projectId);
    const projects = projectId === null ? accessibleProjects(actor, 'reports.read') : [projectId];
    const scope = scopeFilter(kind === 'participations' ? 'c.project_id' : kind === 'stock' ? 'i.project_id' : 'l.project_id', projects);
    const authority=projectAuthoritySql(actor!,['reports.read'],kind==='participations'?'c.project_id':kind==='stock'?'i.project_id':'l.project_id');scope.sql=`(${scope.sql}) AND (${authority.sql})`;scope.params.push(...authority.values);
    const organizationId=url.searchParams.get('organizationId');if(organizationId){if(organizationId.length>200)throw new HttpError(400,'Organização inválida.','invalid_organization');scope.sql+=' AND pr.organization_id=?';scope.params.push(organizationId);}
    let rows: Row[];
    if (kind === 'participations') {
      // Record types keep denominators separate: an authorized retry is not a second person.
      // Campaign timestamps are UTC; operational calendar grouping uses São Paulo's UTC-03
      // offset for the currently supported event period. No identity id or account is exported.
      const participations = await all(db, `SELECT 'participacao' AS tipo,pr.name AS projeto,c.name AS campanha,
        date(p.created_at,'-3 hours') AS dia_brasilia,p.modality AS modalidade,
        p.identity_method AS identificacao,p.state AS estado,'' AS resultado,COUNT(*) AS quantidade
        FROM participations p JOIN campaigns c ON c.id=p.campaign_id JOIN projects pr ON pr.id=c.project_id
        WHERE ${scope.sql} GROUP BY c.id,pr.name,c.name,dia_brasilia,p.modality,p.identity_method,p.state
        ORDER BY dia_brasilia,c.name,p.modality`, scope.params);
      const attempts = await all(db, `SELECT 'tentativa' AS tipo,pr.name AS projeto,c.name AS campanha,
        date(a.created_at,'-3 hours') AS dia_brasilia,p.modality AS modalidade,
        p.identity_method AS identificacao,a.state AS estado,a.result AS resultado,COUNT(*) AS quantidade
        FROM attempts a JOIN participations p ON p.id=a.participation_id
        JOIN campaigns c ON c.id=p.campaign_id JOIN projects pr ON pr.id=c.project_id
        WHERE ${scope.sql} GROUP BY c.id,pr.name,c.name,dia_brasilia,p.modality,p.identity_method,a.state,a.result
        ORDER BY dia_brasilia,c.name,p.modality,a.result`, scope.params);
      const prizes = await all(db, `SELECT 'premiacao' AS tipo,pr.name AS projeto,c.name AS campanha,
        date(COALESCE(e.delivered_at,e.created_at),'-3 hours') AS dia_brasilia,p.modality AS modalidade,
        p.identity_method AS identificacao,e.state AS estado,a.result AS resultado,COUNT(*) AS quantidade
        FROM entitlements e JOIN attempts a ON a.id=e.attempt_id
        JOIN participations p ON p.id=e.participation_id JOIN campaigns c ON c.id=p.campaign_id
        JOIN projects pr ON pr.id=c.project_id WHERE ${scope.sql}
        GROUP BY c.id,pr.name,c.name,dia_brasilia,p.modality,p.identity_method,e.state,a.result
        ORDER BY dia_brasilia,c.name,p.modality`, scope.params);
      const visits = await all(db, `SELECT 'acesso' AS tipo,pr.name AS projeto,c.name AS campanha,
        v.day AS dia_brasilia,'' AS modalidade,'' AS identificacao,'' AS estado,'' AS resultado,SUM(v.hits) AS quantidade
        FROM visits v JOIN campaigns c ON c.id=v.campaign_id JOIN projects pr ON pr.id=c.project_id
        WHERE ${scope.sql} GROUP BY c.id,pr.name,c.name,v.day ORDER BY v.day,c.name`, scope.params);
      rows = [...participations, ...attempts, ...prizes, ...visits];
    } else if (kind === 'stock') {
      rows = await all(db, `SELECT pr.name AS projeto,i.name AS material,i.category AS categoria,i.unit AS unidade,
        i.stock AS saldo_fisico,i.reserved AS reservado,CASE WHEN i.condition<>'active' OR (i.category='equipment' AND EXISTS(SELECT 1 FROM loans busy WHERE busy.item_id=i.id AND (busy.status='out' OR (busy.status='reserved' AND busy.starts_at<=? AND busy.ends_at>?)))) THEN 0 ELSE MAX(0,i.stock-i.reserved) END AS disponivel,i.condition AS condicao
        FROM items i JOIN projects pr ON pr.id=i.project_id WHERE ${scope.sql} ORDER BY pr.name,i.name,i.id`, [Date.now(),Date.now(),...scope.params]);
    } else {
      rows = await all(db, `SELECT pr.name AS projeto,i.name AS equipamento,l.action_name AS acao,
        datetime(l.starts_at/1000,'unixepoch','-3 hours') AS retirada_prevista_brasilia,
        datetime(l.ends_at/1000,'unixepoch','-3 hours') AS devolucao_prevista_brasilia,
        l.status AS estado,COUNT(*) AS quantidade
        FROM loans l JOIN projects pr ON pr.id=l.project_id
        JOIN items i ON i.id=l.item_id AND i.project_id=l.project_id
        WHERE ${scope.sql} GROUP BY l.project_id,l.item_id,l.action_name,l.starts_at,l.ends_at,l.status
        ORDER BY l.starts_at,pr.name,i.name`, scope.params);
    }
    return new Response(csv(rows), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="proex-${kind}-${new Date().toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    const response = publicError(error);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
}
