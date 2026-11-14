import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {PDFDict,PDFDocument,PDFName} from 'pdf-lib';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {compile,root} from './support/traffic-fixture.mjs';
import {brandBytes,fontBytes,reportPdf,zipEntries} from './support/report-module.mjs';
import {teamScenario} from './support/work-teams-fixture.mjs';

const {structureExportReport}=await import(compile('components/portal/institutional-structure-export.ts'));
const {structureFingerprint}=await import(compile('lib/institutional-structure/snapshot.ts'));
const {isStructureWorkspace}=await import(compile('components/portal/institutional-structure-api.ts'));
globalThis.__structureActualPdf=(title,columns,rows,display,info,options)=>reportPdf.toPdf(title,columns,rows,display,info,{...options,fontBytes,brandBytes});
const {documentExport}=await import(compile('components/portal/document-export.ts',new Map([[resolve(root,'components/portal/report-pdf.ts'),'export async function toPdf(...args){return globalThis.__structureActualPdf(...args);}']])));
const routeBindings=new Map([
 [resolve(root,'lib/platform.ts'),'export function database(){return globalThis.__structureExportDB;} export function portalOrigin(){return "https://proex.example.invalid";}'],
 [resolve(root,'lib/session.ts'),'export async function getPortalUser(){return globalThis.__structureExportUser??null;}'],
 [resolve(root,'components/portal/report-pdf.ts'),'export async function toPdf(...args){return globalThis.__structureExportPdf(...args);}'],
]);
const {GET:downloadStructure}=await import(compile('app/api/institutional-structure/export/route.ts',routeBindings));
const {structureAction,structureWorkspace}=await import(compile('lib/institutional-structure/service.ts'));
const {structureDigest}=await import(compile('lib/institutional-structure/snapshot.ts'));
const exportOrigin='https://proex.example.invalid';
const mime={pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
const fixture=()=>({viewerId:'viewer-private-id',scope:{organizationId:'organization-private-id',organizationName:'PROEX sintética',projectId:'project-private-id',projectName:'CONPEEX sintético',canManage:true},version:9,canApplyTemplate:false,source:{label:'Organograma PROEX UFG',revision:'5.0.3',issuedOn:'2026-07-28',referenceUrl:'https://official.example/secret-path.pdf',adapted:true},nodes:[{id:'council-private-id',parentId:null,name:'Câmara de Extensão e Cultura',acronym:'CEC',kind:'council',relation:'root',position:0,status:'active'},{id:'office-private-id',parentId:'council-private-id',name:'Pró-reitoria de Extensão',acronym:'PROEX',kind:'office',relation:'governance',position:0,status:'active'},{id:'unit-private-id',parentId:'office-private-id',name:'Coordenação de Eventos Institucionais',acronym:'',kind:'coordination',relation:'subordination',position:0,status:'active'}],teams:[{id:'team-private-id',name:'Comunicação',status:'active',members:[{name:'Pessoa privada',email:'private@example.invalid'}]}],links:[{nodeId:'unit-private-id',teamId:'team-private-id'}],asOf:'2026-11-05T15:12:13Z',notes:'Anotação privada',drive:'https://private.invalid',body:'Corpo privado'});
const forbidden=/private-id|Pessoa privada|private@example|Anotação privada|Corpo privado|secret-path|private\.invalid|referenceUrl|user_id|teamId|nodeId/;
const render=(format,report)=>documentExport(format,report.title,report.columns,report.rows,(row,key)=>row[key]??'',report.info,report.presentation);

test('reduced projection identifies governance separately and includes version, source nature, scope and Brazilian date',()=>{
 const report=structureExportReport(fixture()),serialized=JSON.stringify(report);assert.equal(report.columns.length,6);assert.equal(report.rows.length,3);assert.equal(report.rows[1].relacao,'Governança');assert.equal(report.rows[2].relacao,'Subordinação');assert.equal(report.rows[1].superior,'Câmara de Extensão e Cultura');assert.equal(report.rows[2].equipes,'Comunicação');assert.match(report.info.find(([key])=>key==='Versão do cadastro')[1],/^9 · Consulta em /);assert.equal(report.info.length,5);assert.match(serialized,/Cadastro adaptado localmente/);assert.match(serialized,/28\/07\/2026/);assert.match(serialized,/05\/11\/2026, 12:12:13/);assert.match(serialized,/não concede permissões/);assert.match(serialized,/CONPEEX sintético/);assert.doesNotMatch(serialized,forbidden);assert.doesNotMatch(serialized,/https?:/);assert.deepEqual(report.presentation.metrics.map(metric=>metric.value),[3,1,1]);
});

test('export follows the hierarchy even when rows arrive shuffled, ordering only siblings by position and name',()=>{const data=fixture();data.nodes=[data.nodes[2],data.nodes[0],data.nodes[1]];const rows=structureExportReport(data).rows;assert.match(rows[0].unidade,/^1 Câmara/);assert.match(rows[1].unidade,/^1\.1 Pró-reitoria/);assert.match(rows[2].unidade,/^1\.1\.1 Coordenação/);});

test('all returned nodes must form a valid finite tree, known links and an internally consistent template capability',()=>{
 const good=fixture();assert.equal(isStructureWorkspace(good),true);
 for(const data of [{...good,source:{...good.source,referenceUrl:'javascript:alert(1)'}},{...good,source:{...good.source,referenceUrl:'https://user:password@official.example/file'}},{...good,source:{...good.source,referenceUrl:'https://official.example/file?secret=x'}},{...good,nodes:[{...good.nodes[0],parentId:'office-private-id',relation:'subordination'},good.nodes[1]]},{...good,nodes:[good.nodes[0],good.nodes[0]]},{...good,links:[{nodeId:'missing',teamId:'team-private-id'}]},{...good,canApplyTemplate:true},{...good,canApplyTemplate:true,nodes:[],links:[],scope:{...good.scope,canManage:false}},{...good,version:NaN}]){assert.equal(isStructureWorkspace(data),false);assert.throws(()=>structureExportReport(data),/incompleta/);}
});

test('fingerprint ignores only asOf; source adaptations, membership visibility, hierarchy and CAS all fence the document',()=>{
 const data=fixture(),fingerprint=structureFingerprint(data);assert.equal(structureFingerprint({...data,asOf:'2026-11-05T15:12:14Z'}),fingerprint);
 for(const changed of [{...data,version:10},{...data,source:{...data.source,adapted:false}},{...data,teams:[],links:[]},{...data,nodes:data.nodes.map((node,index)=>index===2?{...node,parentId:'council-private-id'}:node)},{...data,scope:{...data.scope,canManage:false}},{...data,canApplyTemplate:true}])assert.notEqual(structureFingerprint(changed),fingerprint);
});

test('Word and Excel are literal packages with the same six allowed columns, source/version and no private extras',async()=>{
 const data=fixture();data.nodes[2].name='=HYPERLINK("https://example.invalid","Texto <literal>")';data.teams[0].name='=HYPERLINK("https://example.invalid","Comunicação <literal>")';const report=structureExportReport(data,true);
 for(const format of ['docx','xlsx']){const entries=await zipEntries(await render(format,report)),xml=[...entries.values()].join('');assert.ok(entries.has(format==='docx'?'word/document.xml':'xl/worksheets/sheet1.xml'));assert.match(xml,/Versão do cadastro/);assert.match(xml,/Cadastro adaptado localmente/);assert.match(xml,/Inclui unidades arquivadas autorizadas/);assert.match(xml,/PROEX UFG/);assert.match(xml,/Governança/);assert.match(xml,/Comunicação/);assert.doesNotMatch(xml,forbidden);assert.match(xml,/&lt;literal&gt;/);if(format==='xlsx'){assert.match(entries.get('xl/worksheets/sheet1.xml'),/inlineStr/);assert.match(entries.get('xl/worksheets/sheet1.xml'),/'=HYPERLINK/);assert.doesNotMatch(xml,/<f[ >]/);}}
});

test('real branded PDF has Unicode hierarchy labels, source/version and only the same authorized literal rows',async()=>{
 const report=structureExportReport(fixture()),blob=await render('pdf',report),bytes=new Uint8Array(await blob.arrayBuffer()),pdf=await PDFDocument.load(bytes);assert.equal(blob.type,'application/pdf');assert.equal(pdf.getPageCount(),1,'a small three-unit scope must fit one page with its provenance and privacy note');assert.equal(pdf.getTitle(),report.title);assert.ok(pdf.getPage(0).node.Resources().lookup(PDFName.of('XObject'),PDFDict).keys().length>=2);
 const loading=getDocument({data:bytes.slice(),useSystemFonts:true,disableFontFace:true});try{const document=await loading.promise,pages=[];let intactKind=false,intactStatus=false;for(let i=1;i<=document.numPages;i++){const page=await document.getPage(i);const content=await page.getTextContent(),header=content.items.find(item=>'str'in item&&item.str==='Unidade formal');if(header)intactStatus ||= content.items.some(item=>'str'in item&&item.str==='Situação');if(header)intactKind ||= content.items.some(item=>'str'in item&&item.str==='Tipo: Coordenação'&&Math.abs(item.transform[4]-header.transform[4])<.5);pages.push(content.items.map(item=>'str'in item?item.str:'').join(' '));}assert.equal(intactStatus,true,'the status heading must fit Situação without splitting its final letter');assert.equal(intactKind,true,'the grouped unit cell must preserve the whole kind label');const text=pages.join(' ').replace(/\s+/g,' ');assert.match(text,/Estrutura institucional e equipes/);assert.match(text,/Versão do cadastro/);assert.match(text,/Cadastro adaptado localmente/);assert.match(text,/Governança/);assert.match(text,/Subordinação/);assert.match(text,/Coordenação de Eventos Institucionais/);assert.match(text,/Comunicação/);assert.match(text,/05\/11\/2026, 12:12:13/);assert.doesNotMatch(text,forbidden);assert.doesNotMatch(text,/https?:/);}finally{await loading.destroy();}
});

// Grouping is print-only: no authorized column may be dropped, repeated or invented.
test('PDF grouping retains all six literal fields and rejects missing or duplicate field mappings',async()=>{const report=structureExportReport(fixture());assert.deepEqual(report.presentation.columnGroups.flatMap(group=>group.keys).sort(),report.columns.map(column=>column.key).sort());for(const groups of [[{label:'Unit',keys:['unidade']},{label:'Team',keys:['equipes']}],[{label:'First',keys:['unidade','tipo','relacao']},{label:'Second',keys:['superior','equipes','equipes']}],[{label:'First',keys:['unidade','tipo','relacao']},{label:'Second',keys:['superior','equipes','invented']}]] )await assert.rejects(render('pdf',{...report,presentation:{...report.presentation,columnGroups:groups}}),/preservar cada coluna/);});

async function routeFixture(t) {
 const f=await teamScenario(t);
 globalThis.__structureExportDB=f.db;
 const use=name=>{globalThis.__structureExportUser=f.users[name];};
 const nativeFetch=globalThis.fetch;
 globalThis.fetch=async url=>{
  assert.equal(url.origin,exportOrigin,'the asset source is a fixed site origin');
  const file={'/fonts/NotoSans-Regular.ttf':fontBytes,'/brand/proex.png':brandBytes.proex,'/brand/ufg-white.png':brandBytes.ufg}[url.pathname];
  return new Response(file, {status:file?200:404});
 };
 globalThis.__structureExportPdf=reportPdf.toPdf;
 t.after(()=>{
  globalThis.fetch=nativeFetch;
  for(const key of ['__structureExportDB','__structureExportUser','__structureExportPdf'])delete globalThis[key];
 });
 const actor=await f.actor('owner-a');
 let expectedVersion=0;
 const act=async change=>{
  const result=await structureAction(f.db,actor,{...change,organizationId:'org-a',operationKey:crypto.randomUUID(),expectedVersion});
  expectedVersion=result.version;
  return result;
 };
 const unit=await act({action:'node.save',name:'Pró-reitoria de teste',relation:'root',kind:'office'});
 for(const teamId of [f.a,f.hidden])await act({action:'link.save',nodeId:unit.entityId,teamId,linked:true});
 const request=(format='pdf',suffix='',viewerId='viewer-a')=>new Request(exportOrigin+'/api/institutional-structure/export?organizationId=org-a&projectId=project-a&includeArchived=false&format='+format+suffix,{headers:{'X-Proex-Viewer':viewerId}});
 return{...f,use,request,unit};
}

test('authenticated HTTP downloads contain the real PDF, Word and Excel with the same allowed scope and no private rows',async t=>{
 const f=await routeFixture(t);
 f.use('viewer-a');
 const scope={organizationId:'org-a',projectId:'project-a',includeArchived:false};
 const expected=await structureDigest(structureFingerprint(await structureWorkspace(f.db,await f.actor('viewer-a'),scope)));
 for(const format of ['pdf','docx','xlsx']) {
  const response=await downloadStructure(f.request(format));
  assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
  assert.equal(response.headers.get('Content-Type'),mime[format]);assert.equal(response.headers.get('X-Proex-Structure-Snapshot'),expected);
  assert.equal(response.headers.get('Content-Disposition'),`attachment; filename="proex-estrutura-institucional.${format}"`);
  let content;
  if(format==='pdf'){
   const document=getDocument({data:new Uint8Array(await response.arrayBuffer()),useSystemFonts:true,disableFontFace:true});
   try{const pdf=await document.promise;content=(await (await pdf.getPage(1)).getTextContent()).items.map(item=>item.str??'').join(' ');}finally{await document.destroy();}
  }else content=[...(await zipEntries(await response.blob())).values()].join(' ');
  assert.match(content,/Comunicação e Design/);assert.match(content,/Projeto Aurora/);
  assert.doesNotMatch(content,/Equipe interna Horizonte|Equipe reservada B|example\.invalid|viewer-a|owner-a/);
 }
});

test('HTTP route refuses anonymous or mismatched accounts, foreign projects, archives for readers and duplicate filters',async t=>{
 const f=await routeFixture(t);
 const denied=async(request,status)=>{
  const response=await downloadStructure(request);
  assert.equal(response.status,status);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
  assert.equal(response.headers.get('Content-Disposition'),null);assert.equal(response.headers.get('X-Proex-Structure-Snapshot'),null);
  assert.doesNotMatch(await response.text(),/Projeto Aurora|Equipe interna Horizonte/);
 };
 await denied(f.request(),401);f.use('viewer-a');await denied(f.request('pdf','','owner-a'),403);
 await denied(new Request(f.request().url.replace('project-a','project-a2'),f.request()),403);
 await denied(new Request(f.request().url.replace('includeArchived=false','includeArchived=true'),f.request()),403);
 await denied(f.request('csv'),400);await denied(f.request('pdf','&projectId=project-a2'),400);
});

for(const change of ['membership','session','content']) {
 test(`the PDF renderer withholds the file after a mid-render change in ${change}`,async t=>{
  const f=await routeFixture(t);f.use('viewer-a');
  globalThis.__structureExportPdf=async (...args)=>{
   if(change==='membership')f.native.prepare("UPDATE members SET revoked_at=? WHERE user_id='viewer-a'").run(f.now);
   else if(change==='session')f.use('owner-a');
   else f.native.prepare('UPDATE institutional_nodes SET name=? WHERE id=?').run('Nome alterado',f.unit.entityId);
   return reportPdf.toPdf(...args);
  };
  const response=await downloadStructure(f.request());
  assert.equal(response.status,change==='content'?409:403);
  assert.equal(response.headers.get('Content-Disposition'),null);
  assert.equal(response.headers.get('X-Proex-Structure-Snapshot'),null);
 });
}
