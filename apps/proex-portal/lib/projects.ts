import { accessibleProjects, requireCapability, type PortalActor } from './access';
import { all, one, uid, iso, type Row } from './database';
import { HttpError } from './errors';
import { prepareMutation } from './mutations';
import { listRecords } from './records';
import { projectSpreadsheetLinks } from './sync/project-links';
import { isExtensionLine, isThematicArea } from './extension-catalog';

type Entity = 'project' | 'call' | 'project_link' | 'project_schedule_item';
const TABLES: Record<Entity, string> = { project: 'projects', call: 'calls', project_link: 'project_links', project_schedule_item: 'project_schedule_items' };
const PREFIX: Record<Entity, string> = { project: 'project', call: 'call', project_link: 'project.link', project_schedule_item: 'project.schedule' };
const FIELDS: Record<Entity, string[]> = {
  project: ['name','short_name','description','status','lifecycle','type_id','parent_id','unit_id','prizes_enabled','scope','thematic_area','extension_line','color','official_url','starts_at','ends_at','location'],
  call: ['project_id','title','reference_code','description','status','opens_at','closes_at','official_url'],
  project_link: ['project_id','label','url','kind'],
  project_schedule_item: ['project_id','title','starts_at','ends_at','status','note','url'],
};
function text(value: unknown, label: string, max: number, optional = false): string {
  if ((value === null || value === undefined) && optional) return '';
  if (typeof value !== 'string') throw new HttpError(400, `Informe ${label} como texto.`, 'invalid_input');
  const result = value.normalize('NFC').trim();
  if ((!result && !optional) || result.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result)) throw new HttpError(400, `${label} deve ter ${optional ? 'até' : 'entre 1 e'} ${max} caracteres.`, 'invalid_input');
  return result;
}
function identifier(value: unknown, optional = false): string | null {
  if ((value === null || value === undefined || value === '') && optional) return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) throw new HttpError(400, 'Identificador inválido.', 'invalid_identifier');
  return value;
}
function area(value: unknown): string { const result = value ?? ''; if (!isThematicArea(result)) throw new HttpError(400, 'Escolha uma área temática da extensão válida.', 'invalid_thematic_area'); return result; }
function line(value: unknown): string { const result = value ?? ''; if (!isExtensionLine(result)) throw new HttpError(400, 'Escolha uma linha de extensão válida (01 a 53).', 'invalid_extension_line'); return result; }
function choice(value: unknown, options: string[], label: string): string { if (typeof value !== 'string' || !options.includes(value)) throw new HttpError(400, `Escolha ${label} válido.`, 'invalid_input'); return value; }
function date(value: unknown, optional = true): string | null {
  if ((value === null || value === undefined || value === '') && optional) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value)) throw new HttpError(400, 'Informe data, horário e fuso válidos.', 'invalid_date');
  const time = Date.parse(value), [year,month,day] = value.slice(0,10).split('-').map(Number);
  if (!Number.isFinite(time) || year < 2000 || year > 2200 || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year,month,0)).getUTCDate()) throw new HttpError(400, 'Informe uma data válida.', 'invalid_date');
  return new Date(time).toISOString();
}
function url(value: unknown, optional = true): string {
  const result = text(value, 'o endereço', 500, optional); if (!result) return '';
  let parsed: URL; try { parsed = new URL(result); } catch { throw new HttpError(400, 'Informe um endereço HTTPS válido.', 'invalid_url'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new HttpError(400, 'O endereço deve usar HTTPS e não conter credenciais.', 'invalid_url');
  return parsed.href;
}
function permitted(actor: PortalActor, capability: string, projectId: string | null): boolean { try { requireCapability(actor, capability, projectId); return true; } catch { return false; } }
function manage(actor: PortalActor, projectId: string): void { if (!permitted(actor, 'projects.manage', null)) requireCapability(actor, 'campaigns.manage', projectId); }
function canSee(actor: PortalActor, projectId: string): boolean { const scope = accessibleProjects(actor); return scope === null || scope.includes(projectId); }
function guard(actor: PortalActor, projectId: string | null) {
  return { sql: `EXISTS (SELECT 1 FROM members m LEFT JOIN portal_users u ON u.user_id=m.user_id WHERE m.user_id=? AND m.revoked_at IS NULL
    AND COALESCE(u.status,'active')='active' AND COALESCE(u.activation_pending,0)=0
    AND ${projectId === null ? "m.role='owner' AND m.project_id IS NULL" : "m.role IN ('owner','manager') AND (m.project_id IS NULL OR m.project_id=?)"})`, values: projectId === null ? [actor.userId] : [actor.userId, projectId] };
}
async function normalize(db: D1Database, actor: PortalActor, entity: Entity, input: Row, existing: Row | null): Promise<{ fields: Row; linked: string[] }> {
  const get = (camel: string, snake = camel, fallback: unknown = '') => input[camel] === undefined ? existing?.[snake] ?? fallback : input[camel];
  let fields: Row, linked: string[] = [];
  if (entity === 'project') {
    const color = text(get('color','color','#54216C'), 'a cor', 7).toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(color)) throw new HttpError(400, 'Use uma cor como #54216C.', 'invalid_color');
    const typeId = identifier(get('typeId','type_id',null), true), parentId = identifier(get('parentId','parent_id',null), true), unitId = identifier(get('unitId','unit_id',null), true);
    const prizesEnabled = get('prizesEnabled','prizes_enabled',false);
    if (prizesEnabled!==true&&prizesEnabled!==false&&prizesEnabled!==0&&prizesEnabled!==1) throw new HttpError(400,'Informe se dinâmicas e brindes estão habilitados.','invalid_prizes_enabled');
    if (unitId && !await one(db,"SELECT id FROM organizational_units WHERE id=? AND (status='active' OR id=?)",[unitId,existing?.unit_id??''])) throw new HttpError(400,'Unidade não encontrada ou arquivada.','invalid_organizational_unit');
    if (typeId && !await one(db, 'SELECT id FROM project_types WHERE id=? AND (status=\'active\' OR id=?)', [typeId, existing?.type_id ?? ''])) throw new HttpError(400, 'Tipo de projeto não encontrado ou arquivado.', 'invalid_project_type');
    if (parentId) {
      if (parentId === existing?.id || (parentId !== existing?.parent_id && !canSee(actor, parentId)) || !await one(db, 'SELECT id FROM projects WHERE id=?', [parentId])) throw new HttpError(400, 'Escolha um programa/projeto superior acessível.', 'invalid_parent');
      const cycle = existing && await one(db, `WITH RECURSIVE ancestors(id,parent_id) AS (SELECT id,parent_id FROM projects WHERE id=? UNION SELECT p.id,p.parent_id FROM projects p JOIN ancestors a ON p.id=a.parent_id) SELECT id FROM ancestors WHERE id=? LIMIT 1`, [parentId, existing.id]);
      if (cycle) throw new HttpError(400, 'A hierarquia não pode formar um ciclo.', 'project_cycle');
    }
    fields = { name:text(get('name'), 'o nome do projeto',120), short_name:text(get('shortName','short_name'),'o nome curto',40,true), description:text(get('description'),'a descrição',2000,true), status:choice(get('status','status','active'),['active','archived'],'um estado'), lifecycle:choice(get('lifecycle','lifecycle','active'),['active','past','catalog'],'um ciclo de vida'), type_id:typeId,parent_id:parentId,unit_id:unitId,prizes_enabled:prizesEnabled?1:0,scope:choice(get('scope','scope','internal'),['internal','external'],'uma abrangência (interno ou externo)'),thematic_area:area(get('thematicArea','thematic_area','')),extension_line:line(get('extensionLine','extension_line','')),color,official_url:url(get('officialUrl','official_url')),starts_at:date(get('startsAt','starts_at',null)),ends_at:date(get('endsAt','ends_at',null)),location:text(get('location'),'o local',200,true) };
  } else {
    const projectId = existing?.project_id ?? identifier(input.projectId)!; manage(actor, projectId);
    if (!await one(db, 'SELECT id FROM projects WHERE id=?', [projectId])) throw new HttpError(404, 'Projeto não encontrado.');
    if (entity === 'call') {
      const previous = existing ? await all(db,'SELECT project_id FROM project_calls WHERE call_id=?',[existing.id]) : [];
      const values = input.linkedProjectIds === undefined ? previous.map(row=>row.project_id) : input.linkedProjectIds;
      if (!Array.isArray(values) || values.length > 20) throw new HttpError(400,'Selecione até 20 projetos para o edital.');
      linked = [...new Set(values.map(value=>identifier(value)!))].filter(id=>id!==projectId).sort();
      for (const id of [...new Set([...linked,...previous.map(row=>row.project_id)])]) { manage(actor,id); if (!await one(db,'SELECT id FROM projects WHERE id=?',[id])) throw new HttpError(400,'Projeto vinculado não encontrado.'); }
      fields={project_id:projectId,title:text(get('title'),'o título',200),reference_code:text(get('referenceCode','reference_code'),'a referência',80,true),description:text(get('description'),'a descrição',4000,true),status:choice(get('status','status','draft'),['draft','open','closed','archived'],'um estado'),opens_at:date(get('opensAt','opens_at',null)),closes_at:date(get('closesAt','closes_at',null)),official_url:url(get('officialUrl','official_url'))};
    } else if (entity === 'project_link') fields={project_id:projectId,label:text(get('label'),'o nome do link',150),url:url(get('url'),false),kind:choice(get('kind','kind','other'),['official','notice','report','gallery','other'],'um tipo de link')};
    else fields={project_id:projectId,title:text(get('title'),'o título',200),starts_at:date(get('startsAt','starts_at'),false),ends_at:date(get('endsAt','ends_at'),false),status:choice(get('status','status','planned'),['planned','completed','cancelled'],'um estado'),note:text(get('note'),'a observação institucional',2000,true),url:url(get('url'))};
  }
  const start = fields.starts_at ?? fields.opens_at, end = fields.ends_at ?? fields.closes_at;
  if (start && end && (entity === 'project_schedule_item' ? end < start : end <= start)) throw new HttpError(400,'A data final deve ser posterior à inicial.','invalid_interval');
  return {fields,linked};
}
function snapshot(entity: Entity, row: Row, linked: string[] = []): Row { return Object.fromEntries(['id',...FIELDS[entity],'version','created_at',...(entity==='project'?[]:['updated_at'])].map(key=>[key,row[key]??null]).concat(entity==='call'?[['linked_project_ids',linked]]:[])); }
function versionStatement(db: D1Database, entity: Entity, row: Row, actor: PortalActor, now: string, condition: string, values: unknown[], linked: string[] = []) {
  return db.prepare(`INSERT OR IGNORE INTO entity_versions(id,entity_type,entity_id,project_id,version,snapshot_json,actor_id,created_at) SELECT ?,?,?,?,?,?,?,? WHERE ${condition}`)
    .bind(uid(),entity,row.id,entity==='project'?row.id:row.project_id,row.version,JSON.stringify(snapshot(entity,row,linked)),actor.userId,now,...values);
}
async function saveEntity(db: D1Database, actor: PortalActor, entity: Entity, action: string, input: Row): Promise<Row> {
  const update=action.endsWith('.update'), table=TABLES[entity];
  const existing=update?await one(db,`SELECT * FROM ${table} WHERE id=?`,[identifier(input.id)]):null;
  if(update&&!existing)throw new HttpError(404,'Registro não encontrado.','entity_not_found');
  const projectId=entity==='project'?(existing?.id??null):(existing?.project_id??identifier(input.projectId)!);
  if(projectId)manage(actor,projectId);else requireCapability(actor,'projects.manage',null);
  if(update&&(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<1))throw new HttpError(400,'Informe a versão atual. Atualize a página.','invalid_version');
  // Legacy project edits remain CAS protected. The current UI and all new metadata writes use keys.
  const mutation=entity==='project'&&update&&input.operationKey===undefined?null:await prepareMutation(db,actor.userId,action,input);
  if(mutation?.existingId)return {id:mutation.existingId,[entity]:await one(db,`SELECT * FROM ${table} WHERE id=?`,[mutation.existingId]),duplicate:true};
  if(existing&&existing.version!==input.expectedVersion)throw new HttpError(409,'Este registro mudou. Reabra a edição para carregar a versão atual.','project_changed');
  const {fields,linked}=await normalize(db,actor,entity,input,existing),id=existing?.id??uid(),now=iso(),revision=(existing?.version??0)+1;
  const previousLinked=entity==='call'&&existing?(await all(db,'SELECT project_id FROM project_calls WHERE call_id=? ORDER BY project_id',[id])).map(row=>row.project_id):[];
  const auth=guard(actor,projectId),relatedAuth=entity==='call'?[...new Set([...linked,...previousLinked])].map(project=>guard(actor,project)):[];
  const cycleGuard=entity==='project'&&existing&&fields.parent_id?{sql:`NOT EXISTS(WITH RECURSIVE ancestors(id,parent_id) AS (SELECT id,parent_id FROM projects WHERE id=? UNION SELECT p.id,p.parent_id FROM projects p JOIN ancestors a ON p.id=a.parent_id) SELECT 1 FROM ancestors WHERE id=?)`,values:[fields.parent_id,id]}:{sql:'1=1',values:[]};
  const authorization=[auth.sql,...relatedAuth.map(value=>value.sql),cycleGuard.sql].join(' AND '),authValues=[...auth.values,...relatedAuth.flatMap(value=>value.values),...cycleGuard.values];
  const target=existing?`EXISTS(SELECT 1 FROM ${table} WHERE id=? AND version=?) AND (${authorization})`:`(${authorization})`;
  const targetValues=existing?[id,input.expectedVersion,...authValues]:authValues;
  const statements:D1PreparedStatement[]=[];
  if(mutation)statements.push(db.prepare(`INSERT INTO mutation_keys(scope,fingerprint,entity_id,created_at) SELECT ?,?,?,? WHERE ${target}`).bind(mutation.scope,mutation.fingerprint,id,now,...targetValues));
  if(existing)statements.push(versionStatement(db,entity,existing,actor,now,target,targetValues,previousLinked));
  const mutationIndex=statements.length;
  const extra=entity==='project'?{}:{updated_at:now};
  const row={...existing,...fields,...extra,id,version:revision,created_at:existing?.created_at??now};
  if(existing)statements.push(db.prepare(`UPDATE ${table} SET ${Object.keys({...fields,...extra}).map(key=>`${key}=?`).join(',')},version=version+1 WHERE id=? AND version=? AND (${authorization})`).bind(...Object.values({...fields,...extra}),id,input.expectedVersion,...authValues));
  else {const columns=['id',...Object.keys(fields),'version','created_at',...Object.keys(extra)];statements.push(db.prepare(`INSERT INTO ${table}(${columns.join(',')}) SELECT ${columns.map(()=>'?').join(',')} WHERE ${authorization}`).bind(id,...Object.values(fields),1,now,...Object.values(extra),...authValues));}
  statements.push(versionStatement(db,entity,row,actor,now,'changes()=1',[],linked));
  if(entity==='call'){
    const ownsClaim=`EXISTS(SELECT 1 FROM mutation_keys WHERE scope=? AND entity_id=?)`;
    statements.push(db.prepare(`DELETE FROM project_calls WHERE call_id=? AND ${ownsClaim}`).bind(id,mutation!.scope,id));
    for(const project of linked)statements.push(db.prepare(`INSERT INTO project_calls(call_id,project_id) SELECT ?,? WHERE ${ownsClaim}`).bind(id,project,mutation!.scope,id));
    statements.push(db.prepare(`INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) SELECT ?,?,?,?,?,?,? WHERE ${ownsClaim} AND EXISTS(SELECT 1 FROM calls WHERE id=? AND version=?)`).bind(uid(),actor.userId,projectId,action,id,JSON.stringify({previousVersion:existing?.version??null,version:revision}),now,mutation!.scope,id,id,revision));
  }else statements.push(db.prepare(`INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) SELECT ?,?,?,?,?,?,? WHERE changes()=1`).bind(uid(),actor.userId,entity==='project'?id:projectId,action,id,JSON.stringify({previousVersion:existing?.version??null,version:revision}),now));
  let results:D1Result[];
  try{results=await db.batch(statements);}catch(error){if(!mutation)throw error;const replayId=await mutation.recover(error);return {id:replayId,[entity]:await one(db,`SELECT * FROM ${table} WHERE id=?`,[replayId]),duplicate:true};}
  if(results[mutationIndex].meta.changes!==1)throw new HttpError(existing?409:403,'O registro ou seu acesso mudou. Atualize a página.',existing?'project_changed':'access_changed');
  return {id,[entity]:await one(db,`SELECT * FROM ${table} WHERE id=?`,[id])};
}

async function typeAction(db:D1Database,actor:PortalActor,action:string,input:Row):Promise<Row>{
  requireCapability(actor,'projects.manage',null);const update=action.endsWith('.update'),existing=update?await one(db,'SELECT * FROM project_types WHERE id=?',[identifier(input.id)]):null;
  if(update&&!existing)throw new HttpError(404,'Tipo não encontrado.');
  const mutation=await prepareMutation(db,actor.userId,action,input);if(mutation.existingId)return{id:mutation.existingId,duplicate:true};
  if(existing&&(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion!==existing.version))throw new HttpError(409,'O tipo mudou. Atualize a página.','project_type_changed');
  const key=text(input.key??existing?.key,'a chave do tipo',50).toLowerCase();if(!/^[a-z][a-z0-9_-]{1,49}$/.test(key))throw new HttpError(400,'Use uma chave curta em letras, números e hífen.');
  const fields={key,label:text(input.label??existing?.label,'o nome do tipo',100),description:text(input.description??existing?.description,'a descrição',1000,true),status:choice(input.status??existing?.status??'active',['active','archived'],'um estado')},id=existing?.id??uid(),now=iso(),auth=guard(actor,null);
  const target=existing?`EXISTS(SELECT 1 FROM project_types WHERE id=? AND version=?) AND ${auth.sql}`:auth.sql,targetValues=existing?[id,input.expectedVersion,...auth.values]:auth.values;
  let result:D1Result[];try{result=await db.batch([db.prepare(`INSERT INTO mutation_keys(scope,fingerprint,entity_id,created_at) SELECT ?,?,?,? WHERE ${target}`).bind(mutation.scope,mutation.fingerprint,id,now,...targetValues),existing?db.prepare(`UPDATE project_types SET key=?,label=?,description=?,status=?,version=version+1,updated_at=? WHERE id=? AND version=? AND ${auth.sql}`).bind(...Object.values(fields),now,id,input.expectedVersion,...auth.values):db.prepare(`INSERT INTO project_types(id,key,label,description,status,version,created_at,updated_at) SELECT ?,?,?,?,?,1,?,? WHERE ${auth.sql}`).bind(id,...Object.values(fields),now,now,...auth.values),db.prepare(`INSERT INTO audit(id,actor_id,project_id,action,entity_id,details,created_at) SELECT ?,?,NULL,?,?,'{}',? WHERE changes()=1`).bind(uid(),actor.userId,action,id,now)]);}catch(error){return{id:await mutation.recover(error),duplicate:true};}
  if(result[1].meta.changes!==1)throw new HttpError(409,'O tipo ou seu acesso mudou. Atualize a página.');return{id,projectType:await one(db,'SELECT * FROM project_types WHERE id=?',[id])};
}
export async function projectAction(db:D1Database,actor:PortalActor,action:string,input:Row):Promise<Row|null>{
  if(['project.type.create','project.type.update'].includes(action))return typeAction(db,actor,action,input);
  for(const [entity,prefix] of Object.entries(PREFIX) as [Entity,string][])if(action===`${prefix}.create`||action===`${prefix}.update`)return saveEntity(db,actor,entity,action,input);
  if(action==='entity.restore'&&Object.hasOwn(TABLES,input.entityType)){
    const entity=input.entityType as Entity,id=identifier(input.entityId),version=input.restoreVersion;
    if(!Number.isSafeInteger(version)||version<1)throw new HttpError(400,'Escolha uma versão válida.');
    const existing=await one(db,`SELECT * FROM ${TABLES[entity]} WHERE id=?`,[id]);if(!existing)throw new HttpError(404,'Registro não encontrado.');manage(actor,entity==='project'?existing.id:existing.project_id);
    const saved=await one(db,'SELECT snapshot_json FROM entity_versions WHERE entity_type=? AND entity_id=? AND version=?',[entity,id,version]);if(!saved)throw new HttpError(404,'Versão não encontrada.');
    let source:Row;try{source=JSON.parse(saved.snapshot_json);}catch{throw new HttpError(409,'Esta versão não pode ser restaurada.');}
    const restored:Row={id,expectedVersion:input.expectedVersion,operationKey:input.operationKey};
    // Historical revisions precede optional V5 settings: preserving those settings avoids
    // clearing a current unit or disabling dynamics when restoring only older metadata.
    for(const field of FIELDS[entity])if(Object.hasOwn(source,field))restored[field.replace(/_([a-z])/g,(_,letter)=>letter.toUpperCase())]=source[field];
    if(entity==='call')restored.linkedProjectIds=source.linked_project_ids??[];
    return saveEntity(db,actor,entity,`${PREFIX[entity]}.update`,restored);
  }
  return null;
}

export async function projectDetail(db:D1Database,actor:PortalActor|null,id:string):Promise<Row>{
  if(!actor)throw new HttpError(401,'Entre para acessar este projeto.','unauthenticated');identifier(id);
  if(!canSee(actor,id))throw new HttpError(404,'Projeto não encontrado.');
  const project=await one(db,`SELECT p.*,t.key type_key,t.label type_label,u.name unit_name,u.acronym unit_acronym FROM projects p LEFT JOIN project_types t ON t.id=p.type_id LEFT JOIN organizational_units u ON u.id=p.unit_id WHERE p.id=?`,[id]);if(!project)throw new HttpError(404,'Projeto não encontrado.');
  const canEdit=permitted(actor,'campaigns.manage',id)||permitted(actor,'projects.manage',null),inventory=permitted(actor,'inventory.read',id),loans=permitted(actor,'loans.read',id),reports=permitted(actor,'reports.read',id),campaigns=canEdit||permitted(actor,'participation.operate',id);
  const visible=accessibleProjects(actor),visibility=visible===null?'1=1':visible.length?`p.id IN (${visible.map(()=>'?').join(',')})`:'1=0';
  const [types,links,calls,schedule,versions,relatedProjects,items,events,loanRows,records]=await Promise.all([
    all(db,'SELECT * FROM project_types ORDER BY label,id'),all(db,'SELECT * FROM project_links WHERE project_id=? ORDER BY kind,label,id',[id]),
    all(db,`SELECT c.*,(SELECT json_group_array(pc.project_id) FROM project_calls pc WHERE pc.call_id=c.id) linked_ids_json FROM calls c WHERE c.project_id=? OR EXISTS(SELECT 1 FROM project_calls pc WHERE pc.call_id=c.id AND pc.project_id=?) ORDER BY c.opens_at DESC,c.title`,[id,id]),
    all(db,'SELECT * FROM project_schedule_items WHERE project_id=? ORDER BY starts_at DESC,id',[id]),
    canEdit?all(db,`SELECT id,entity_type,entity_id,version,snapshot_json,created_at FROM entity_versions WHERE project_id=? AND entity_type IN ('project','call','project_link','project_schedule_item') ORDER BY created_at DESC,id DESC LIMIT 200`,[id]):Promise.resolve([]),
    all(db,`SELECT p.id,p.name,p.status,p.lifecycle,p.parent_id FROM projects p WHERE (p.parent_id=? OR p.id=?) AND (${visibility}) ORDER BY p.name`,[id,project.parent_id??'',...(visible??[])]),
    inventory?all(db,'SELECT id,name,category,unit,stock,reserved,low_stock,condition FROM items WHERE project_id=? ORDER BY name',[id]):Promise.resolve(null),
    campaigns?all(db,'SELECT id,name,location,starts_at,ends_at,status FROM campaigns WHERE project_id=? ORDER BY starts_at DESC',[id]):Promise.resolve(null),
    loans?all(db,`SELECT l.id,l.item_id,i.name item_name,l.action_name,l.starts_at,l.ends_at,l.status FROM loans l JOIN items i ON i.id=l.item_id AND i.project_id=l.project_id WHERE l.project_id=? ORDER BY l.starts_at DESC LIMIT 100`,[id]):Promise.resolve(null),
    inventory||loans||reports||canEdit?listRecords(db,actor,{projectId:id,limit:100}):Promise.resolve({records:[]}),
  ]);
  const projectedCalls=calls.map((call):Row=>{let linked:string[]=[];try{linked=JSON.parse(call.linked_ids_json||'[]');}catch{}const safe={...call};delete safe.linked_ids_json;return{...safe,linkedProjectIds:linked.filter(project=>canSee(actor,project)),canEdit:[call.project_id,...linked].every(project=>permitted(actor,'campaigns.manage',project)||permitted(actor,'projects.manage',null))};});
  const editableCalls=new Set(projectedCalls.filter(call=>call.canEdit).map(call=>call.id));
  return {project,types,organizationalUnits:await all(db,'SELECT id,name,acronym,kind,status,version,group_label,campus FROM organizational_units ORDER BY name,id'),spreadsheetLinks:await projectSpreadsheetLinks(db,actor,id),links,calls:projectedCalls,schedule,versions:versions.filter(version=>version.entity_type!=='call'||editableCalls.has(version.entity_id)),relatedProjects,relationships:{items,campaigns:events,loans:loanRows,records:records.records},permissions:{canEdit,canManageTypes:permitted(actor,'projects.manage',null),inventory,loans,reports,campaigns}};
}
