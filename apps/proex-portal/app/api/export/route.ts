import {getPortalUser} from '@/lib/session';
import { accessibleProjects, getActor, requireCapability, projectAuthoritySql } from '@/lib/access';
import { all, csv, type Row } from '@/lib/database';
import { HttpError, publicError } from '@/lib/errors';
import { database } from '@/lib/platform';
import { pdfAssets } from '@/lib/pdf-assets';
import { toDocx, toXlsx, type ExportColumn, type ExportRow } from '@/components/portal/report-export';

const FORMATS = ['csv', 'xlsx', 'docx', 'pdf'] as const;
type Format = typeof FORMATS[number];
const TITLES: Record<string, string> = { participations: 'Participação nas dinâmicas', stock: 'Materiais e movimentos', loans: 'Empréstimos' };
/** Rótulos legíveis para DOCX e PDF; o XLSX mantém as chaves usadas em importações já existentes. */
const LABELS: Record<string, string> = {
  tipo: 'Tipo', projeto: 'Projeto', campanha: 'Campanha', dia_brasilia: 'Dia', modalidade: 'Modalidade', identificacao: 'Identificação',
  estado: 'Estado', resultado: 'Resultado', quantidade: 'Quantidade', material: 'Material', categoria: 'Categoria', unidade: 'Unidade',
  saldo_fisico: 'Saldo físico', reservado: 'Reservado', disponivel: 'Disponível', condicao: 'Condição', equipamento: 'Equipamento', acao: 'Ação',
  retirada_prevista_brasilia: 'Retirada prevista', devolucao_prevista_brasilia: 'Devolução prevista', sem_registros: 'Sem registros',
};
/** Agrupamento só do PDF: mantém cada coluna autorizada uma vez, em tabela legível. */
const PDF_GROUPS: Record<string, { label: string; keys: string[] }[]> = {
  participations: [{ label: 'Campanha', keys: ['campanha', 'projeto'] }, { label: 'Dia', keys: ['dia_brasilia'] }, { label: 'Registro', keys: ['tipo', 'modalidade', 'identificacao'] }, { label: 'Situação', keys: ['estado', 'resultado'] }, { label: 'Quantidade', keys: ['quantidade'] }],
  stock: [{ label: 'Material', keys: ['material', 'categoria', 'unidade'] }, { label: 'Projeto', keys: ['projeto'] }, { label: 'Saldo', keys: ['saldo_fisico', 'reservado', 'disponivel'] }, { label: 'Condição', keys: ['condicao'] }],
  loans: [{ label: 'Equipamento', keys: ['equipamento', 'acao'] }, { label: 'Projeto', keys: ['projeto'] }, { label: 'Período', keys: ['retirada_prevista_brasilia', 'devolucao_prevista_brasilia'] }, { label: 'Estado', keys: ['estado'] }, { label: 'Quantidade', keys: ['quantidade'] }],
};
const VALUES: Record<string, Record<string, string>> = {
  tipo: { participacao: 'Participação', tentativa: 'Tentativa', premiacao: 'Premiação', acesso: 'Acesso' },
  modalidade: { physical: 'Presencial', dice: 'Dado', wheel: 'Roleta' },
  categoria: { gift: 'Brinde', equipment: 'Equipamento', distribution: 'Distribuição', consumption: 'Consumo' },
  condicao: { active: 'Ativo', maintenance: 'Em manutenção', inactive: 'Inativo' },
  identificacao: { account: 'Conta', ticket: 'Ficha presencial' },
  resultado: { brinde: 'Brinde', super: 'Prêmio especial', retry: 'Nova tentativa', miss: 'Não foi dessa vez', retry_exhausted: 'Tentativas esgotadas', pending: 'Aguardando resultado' },
  estado: { ready: 'Pronta', done: 'Concluída', pending: 'Pendente', physical_pending: 'Aguardando atendimento', retry_ready: 'Nova tentativa liberada', reserved: 'Reservado', delivered: 'Entregue', cancelled: 'Cancelado', out: 'Retirado', returned: 'Devolvido' },
};
const FILE_SLUG: Record<string, string> = { participations: 'participacao', stock: 'materiais', loans: 'emprestimos' };
/** Mensagens que podem ir à tela; qualquer outra falha vira um aviso genérico em português. */
const KNOWN_LIMITS = /2\.000 linhas|muito extenso|páginas/;
const NUMERIC = new Set(['quantidade', 'saldo_fisico', 'reservado', 'disponivel']);
const MIME: Record<Format, string> = { csv: 'text/csv; charset=utf-8', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pdf: 'application/pdf' };

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
    const format = (url.searchParams.get('format') ?? 'csv') as Format;
    if (!FORMATS.includes(format)) throw new HttpError(400, 'Escolha um formato de exportação válido.', 'invalid_export_format');
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
    const keys = Object.keys(rows[0] ?? { sem_registros: null });
    const value = (row: ExportRow, key: string) => row[key];
    const info: [string, string][] = [['Linhas', String(rows.length)], ['Recorte', projectId ? 'Projeto escolhido' : 'Projetos autorizados para o seu perfil'], ['Gerado em', new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })]];
    let content: string | Blob;
    if (format === 'csv') content = csv(rows);
    else if (format === 'xlsx') content = toXlsx('Registros', keys.map(key => ({ key, label: key })), rows, value, [['Linhas', String(rows.length)]]);
    else {
      const columns: ExportColumn[] = keys.map(key => ({ key, label: LABELS[key] ?? key, numeric: NUMERIC.has(key) }));
      const readable = (row: ExportRow, key: string) => { const raw = row[key]; return typeof raw === 'string' && VALUES[key]?.[raw] ? VALUES[key][raw] : raw; };
      const groups = PDF_GROUPS[kind];
      const grouped = groups && groups.flatMap(group => group.keys).sort().join() === [...keys].sort().join();
      try {
        content = format === 'docx'
          ? toDocx(TITLES[kind], columns, rows, readable, info)
          : await (await import('@/components/portal/report-pdf')).toPdf(TITLES[kind], columns, rows, readable, info, { ...(await pdfAssets(request)), presentation: { layout: 'table', compactRows: true, recordsLabel: 'Registros', ...(grouped ? { columnGroups: groups } : {}) } });
      } catch (cause) {
        if (cause instanceof HttpError) throw cause;
        const message = cause instanceof Error ? cause.message : '';
        if (/2\.000 linhas/.test(message)) throw new HttpError(413, 'Este recorte tem mais de 2.000 linhas. Para documento ou PDF, escolha um projeto; o recorte completo sai na planilha (XLSX).', 'export_too_large');
        if (KNOWN_LIMITS.test(message)) throw new HttpError(413, message, 'export_too_large');
        throw new HttpError(500, 'Não foi possível preparar o arquivo. Baixe a planilha ou tente novamente.', 'export_failed');
      }
    }
    return new Response(content, {
      headers: {
        'Content-Type': MIME[format],
        'Content-Disposition': `attachment; filename="proex-${FILE_SLUG[kind]}-${new Date().toISOString().slice(0, 10)}.${format}"`,
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
