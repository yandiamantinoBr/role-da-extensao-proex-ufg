import { type PortalActor } from '../access';
import { one, iso, uid } from '../database';
import { HttpError } from '../errors';
import { prepareMutation } from '../mutations';
import { requireSyncOwner, SYNC_OWNER_SQL } from './contracts';

const KEY='sync.google_sheets.material_links';
type Configuration={spreadsheetId:string;sheetId:number;views:Record<string,number>;version:number};
function integer(value:unknown):value is number{return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=2147483647;}
function configuration(value:unknown):value is Configuration {
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const v=value as Configuration;
 return typeof v.spreadsheetId==='string'&&/^[-_A-Za-z0-9]{10,200}$/.test(v.spreadsheetId)&&integer(v.sheetId)&&Number.isSafeInteger(v.version)&&v.version>0&&!!v.views&&typeof v.views==='object'&&!Array.isArray(v.views)&&Object.keys(v.views).length<=500&&Object.entries(v.views).every(([key,id])=>/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(key)&&integer(id));
}
async function stored(db:D1Database):Promise<{value:string;configuration:Configuration}|null>{const row=await one(db,'SELECT value FROM settings WHERE name=?',[KEY]);if(!row)return null;try{const c=JSON.parse(row.value);return configuration(c)?{value:row.value,configuration:c}:null;}catch{return null;}}

/** A filtered Google view is a convenience, never an access boundary. The global
 * operational spreadsheet link is visible only to a current global owner. */
export async function projectSpreadsheetLinks(db:D1Database,actor:PortalActor|null,projectId:string):Promise<{materialsUrl:string|null}>{
 try{await requireSyncOwner(db,actor);}catch(error){if(error instanceof HttpError&&[401,403].includes(error.status))return {materialsUrl:null};throw error;}
 const row=await one(db,"SELECT value FROM settings WHERE name='sync.google_sheets.configuration'"),links=await stored(db);
 if(!row||!links)return {materialsUrl:null};
 let config:Record<string,unknown>;try{config=JSON.parse(row.value);}catch{return {materialsUrl:null};}
 if(typeof config.spreadsheetId!=='string'||!/^[-_A-Za-z0-9]{10,200}$/.test(config.spreadsheetId))return {materialsUrl:null};
 if(links.configuration.spreadsheetId!==config.spreadsheetId)return {materialsUrl:null};
 const view=links.configuration.views[projectId];
 // Never send a global/unfiltered substitute when the selected project's view
 // has not been prepared. Project-specific documents use their own Drive ACLs.
 if(!integer(view))return {materialsUrl:null};
 await requireSyncOwner(db,actor);
 return {materialsUrl:`https://docs.google.com/spreadsheets/d/${config.spreadsheetId}/edit#gid=${links.configuration.sheetId}&fvid=${view}`};
}

export async function configureMaterialLinks(db:D1Database,actor:PortalActor|null,input:Record<string,unknown>){
 await requireSyncOwner(db,actor);if(!actor)throw new HttpError(401,'Entre para configurar as planilhas.');
 const previous=await stored(db),expectedVersion=input.expectedVersion??0;
 if(!Number.isSafeInteger(expectedVersion)||Number(expectedVersion)<0)throw new HttpError(400,'Informe a versão dos atalhos de planilha.','invalid_material_links_version');
 const configRow=await one(db,"SELECT value FROM settings WHERE name='sync.google_sheets.configuration'");
 let spreadsheetId:unknown;try{spreadsheetId=JSON.parse(configRow?.value??'{}').spreadsheetId;}catch{spreadsheetId=null;}
 const next={spreadsheetId,sheetId:input.sheetId,views:input.views,version:Number(expectedVersion)+1};
 if(!configuration(next))throw new HttpError(400,'Informe a aba e as visualizações verificadas no Google Planilhas.','invalid_material_links');
 for(const id of Object.keys(next.views))if(!await one(db,'SELECT id FROM projects WHERE id=?',[id]))throw new HttpError(400,'Uma visualização aponta para um projeto inexistente.','invalid_project_view');
 const mutation=await prepareMutation(db,actor.userId,'sync.material_links.configure',input);
 if(mutation.existingId)return {id:KEY,configuration:(await stored(db))?.configuration,duplicate:true};
 if(Number(expectedVersion)!==(previous?.configuration.version??0))throw new HttpError(409,'Os atalhos de planilha mudaram. Releia a configuração.','sync_links_changed');
 const now=iso();
 const write=previous?db.prepare('UPDATE settings SET value=?,updated_at=? WHERE name=? AND value=?').bind(JSON.stringify(next),now,KEY,previous.value):db.prepare('INSERT INTO settings(name,value,updated_at) SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM settings WHERE name=?)').bind(KEY,JSON.stringify(next),now,KEY);
 try{await db.batch([
  db.prepare(`SELECT CASE WHEN ${SYNC_OWNER_SQL} THEN 1 ELSE json_extract('sync_forbidden','$') END`).bind(actor.userId),
  mutation.claimStatement(KEY),write,
  db.prepare("SELECT CASE WHEN changes()=1 THEN 1 ELSE json_extract('[]','sync_links_changed') END"),
  db.prepare("INSERT INTO audit(id,actor_id,action,entity_id,details,created_at) VALUES(?,?,'sync.material_links.configure',?,'{}',?)").bind(uid(),actor.userId,KEY,now),
 ]);}catch(error){await requireSyncOwner(db,actor);if(String(error).includes('sync_links_changed'))throw new HttpError(409,'Os atalhos mudaram durante a gravação. Releia a configuração.','sync_links_changed');const recovered=await mutation.recover(error);return {id:recovered,configuration:(await stored(db))?.configuration,duplicate:true};}
 return {id:KEY,configuration:next};
}

export async function materialLinksStatus(db:D1Database,actor:PortalActor|null){await requireSyncOwner(db,actor);return (await stored(db))?.configuration??null;}
