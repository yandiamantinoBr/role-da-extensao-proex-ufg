import { type PortalActor } from '../access';
import { syncStatus, configureSync, startSyncRun, finishSyncRun } from './control';
import { exportPortablePage } from './portable';
import { applyPortableChanges } from './apply';
import { seedCatalog, catalogPreview } from './catalog';
import { listSyncAttachments, createAttachmentTicket, acknowledgeAttachmentExport, acknowledgeAttachmentCleanup } from './attachments';

// Ferramentas compartilhadas pelo /mcp (identidade nativa do Sites) e pelo conector
// da planilha (/api/sync/connector, chave de sincronização). Todas revalidam o
// responsável global dentro de cada serviço; a origem da chamada não concede poder.
export async function callSyncTool(db: D1Database, actor: PortalActor | null, name: unknown, args: Record<string, unknown>, origin: string): Promise<unknown> {
 switch (name) {
  case 'proex_sync_describe': return syncStatus(db, actor);
  case 'proex_sync_read': return exportPortablePage(db, actor, args as never);
  case 'proex_sync_apply': return applyPortableChanges(db, actor, args as never);
  case 'proex_sync_configure': return configureSync(db, actor, args);
  case 'proex_sync_run_start': return startSyncRun(db, actor, args);
  case 'proex_sync_run_finish': return finishSyncRun(db, actor, args);
  case 'proex_catalog_seed': return seedCatalog(db, actor);
  case 'proex_catalog_preview': await syncStatus(db, actor); return catalogPreview();
  case 'proex_sync_attachment_list': return listSyncAttachments(db, actor, args);
  case 'proex_sync_attachment_ticket': return createAttachmentTicket(db, actor, { kind: args.kind, id: args.id, origin });
  case 'proex_sync_attachment_ack': return acknowledgeAttachmentExport(db, actor, args);
  case 'proex_sync_attachment_cleanup': return acknowledgeAttachmentCleanup(db, actor, args);
  default: return undefined;
 }
}
