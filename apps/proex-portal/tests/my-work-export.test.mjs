import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {PDFDict,PDFDocument,PDFName} from 'pdf-lib';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {compile,root} from './support/traffic-fixture.mjs';
import {brandBytes,fontBytes,reportPdf,zipEntries} from './support/report-module.mjs';

const {myWorkExportReport,myWorkExportFingerprint,assertMyWorkContext}=await import(compile('components/portal/my-work-export.ts'));
globalThis.__myWorkActualPdf=(title,columns,rows,display,info,options)=>reportPdf.toPdf(title,columns,rows,display,info,{...options,fontBytes,brandBytes});
const {documentExport}=await import(compile('components/portal/document-export.ts',new Map([[resolve(root,'components/portal/report-pdf.ts'),'export async function toPdf(...args){return globalThis.__myWorkActualPdf(...args);}']])));
const query={userId:'viewer-private-id',organizationId:'organization-private-id',projectId:'project-private-id',assignment:'team',status:'pending',taskOffset:6,responsibilityOffset:0};
const counts={total:19,pending:17,attention:2,overdue:1,dueToday:1,inProgress:8,blocked:1,completed:2,cancelled:0};
const target={kind:'materials',id:'target-private-id',name:'Calendários conferidos',canOpen:true,href:'/?module=materials&project=project-private-id&itemId=target-private-id'};
const context={organization_id:query.organizationId,project_id:query.projectId,organization_name:'PROEX sintética',project_name:'CONPEEX sintético'};
const task=(patch={})=>({...context,id:'task-private-id',title:'Conferir calendários de segunda-feira',status:'in_progress',priority:'high',due_at:'2026-11-09',version:2,canEdit:false,canWork:true,canDelegateWork:false,assignees:[{user_id:'person-private-id',team_id:null,name:'Nome privado'}],assignmentVia:'team',area:'materials',href:'/?module=demands&demandId=task-private-id',target,body:'Corpo privado',note:'Nota privada',contact:'contato-restrito@example.invalid',...patch});
const responsibility=(patch={})=>({...context,id:'responsibility-private-id',area:'materials',item_id:'target-private-id',loan_id:null,campaign_id:null,status:'active',version:2,created_at:'2026-11-05T15:00:00Z',updated_at:'2026-11-05T15:00:00Z',assignees:[{user_id:null,team_id:'team-private-id',name:'Equipe privada'}],assignmentVia:'team',canEdit:false,target,...patch});
export function fixture(){return{version:1,viewerId:query.userId,asOf:'2026-11-05T15:12:13.000Z',today:'2026-11-05',timeZone:'America/Sao_Paulo',scope:{organizationId:query.organizationId,projectId:query.projectId,assignment:'team',status:'pending'},totalsScope:'organization-project-assignment',totals:{tasks:counts,responsibilities:{total:8}},areas:[{area:'materials',taskCounts:counts,responsibilityCount:8}],tasks:{items:[task(),task({id:'hidden-task-private-id',title:'Título oculto privado',target:{...target,id:'hidden-private-id',name:'Nome oculto privado',href:'/?module=materials&project=hidden-private-id',canOpen:false},project_name:'Projeto oculto privado'})],total:17,hasMore:true,nextOffset:12},responsibilities:{items:[responsibility(),responsibility({id:'hidden-responsibility-private-id',project_name:'Projeto oculto privado',target:{...target,name:'Nome oculto privado',canOpen:false}})],total:8,hasMore:true,nextOffset:6}};}
const forbidden=/private-id|Nome privado|Equipe privada|contato-restrito|Corpo privado|Nota privada|Título oculto privado|Nome oculto privado|Projeto oculto privado|https?:|href|assignees|user_id/;
const render=(format,report)=>documentExport(format,report.title,report.columns,report.rows,(row,key)=>row[key],report.info,report.presentation);

test('personal summary has an allowlisted reduced projection, exact pagination and explicit incomplete scope without identifiers',()=>{
 const data=fixture(),report=myWorkExportReport(data,query),serialized=JSON.stringify(report);
 assert.equal(report.rows.length,4);assert.deepEqual(report.rows.map(row=>row.tipo),['Demanda','Demanda','Designação','Designação']);
 assert.equal(report.rows[1].registro,'Registro de acesso restrito');assert.equal(report.rows[3].registro,'Registro de acesso restrito');for(const key of ['contexto','estado','prioridade','prazo'])assert.equal(report.rows[1][key],'');
 assert.equal(report.rows[0].prazo,'09/11/2026');assert.doesNotMatch(serialized,forbidden);
 assert.match(serialized,/Somente as páginas atuais/);assert.match(serialized,/7–8 de 17/);assert.match(serialized,/1–2 de 8/);assert.match(serialized,/deslocamento 6/);assert.match(serialized,/05\/11\/2026, 12:12:13/);assert.match(serialized,/19 demandas e 8 acompanhamentos/);
 assert.equal(report.presentation.metrics[0].value,2);assert.equal(report.presentation.metrics[2].value,2);
});

test('unknown viewer scope or an oversized page is refused and privacy/version changes affect export consistency',()=>{
 const data=fixture();for(const changed of [{...data,viewerId:'someone-else'},{...data,scope:{...data.scope,projectId:'another-project'}},{...data,tasks:{...data.tasks,items:Array.from({length:7},()=>task())}}])assert.throws(()=>assertMyWorkContext(changed,query),/contexto/);
 const fingerprint=myWorkExportFingerprint(data,query);assert.equal(myWorkExportFingerprint({...data,asOf:'2026-11-05T15:12:14Z'},query),fingerprint);
 assert.notEqual(myWorkExportFingerprint({...data,responsibilities:{...data.responsibilities,items:[responsibility({target:{...target,canOpen:false}})]}},query),fingerprint);
 assert.notEqual(myWorkExportFingerprint({...data,tasks:{...data.tasks,total:18}},query),fingerprint);
});

test('Word and Excel are actual packages with current-page metadata and no hidden fields or executable formula',async()=>{
 const data=fixture();data.tasks.items[0].title='=HYPERLINK("https://malicious.invalid","Texto literal")';const report=myWorkExportReport(data,query);
 for(const format of ['docx','xlsx']){const blob=await render(format,report),entries=await zipEntries(blob),text=[...entries.values()].join('');
  assert.ok(entries.has(format==='docx'?'word/document.xml':'xl/worksheets/sheet1.xml'));assert.match(text,/Somente as páginas atuais/);assert.match(text,/PROEX UFG/);assert.match(text,/7–8 de 17/);assert.match(text,/Registro de acesso restrito/);
  assert.doesNotMatch(text,/private-id|Nome privado|Equipe privada|contato-restrito|Corpo privado|Nota privada|Título oculto privado|Nome oculto privado|Projeto oculto privado/);
  if(format==='xlsx'){assert.doesNotMatch(text,/<f[ >]/);assert.match(entries.get('xl/worksheets/sheet1.xml'),/inlineStr/);assert.match(entries.get('xl/worksheets/sheet1.xml'),/'=HYPERLINK/);}
 }
});

test('branded PDF contains the same authorized reduced rows and scoped metadata in extractable Unicode text',async()=>{
 const report=myWorkExportReport(fixture(),query),blob=await render('pdf',report),bytes=new Uint8Array(await blob.arrayBuffer()),pdf=await PDFDocument.load(bytes);
 assert.equal(blob.type,'application/pdf');assert.equal(pdf.getTitle(),report.title);assert.ok(pdf.getPage(0).node.Resources().lookup(PDFName.of('XObject'),PDFDict).keys().length>=2);
 const loading=getDocument({data:bytes.slice(),useSystemFonts:true,disableFontFace:true});try{const document=await loading.promise,pages=[];for(let i=1;i<=document.numPages;i++){const page=await document.getPage(i);pages.push((await page.getTextContent()).items.map(item=>'str'in item?item.str:'').join(' '));}const text=pages.join(' ').replace(/\s+/g,' ');assert.match(text,/Meu trabalho nas páginas atuais/);assert.match(text,/Conferir calendários de segunda-feira/);assert.match(text,/Registro de acesso restrito/);assert.match(text,/7–8 de 17/);assert.match(text,/05\/11\/2026, 12:12:13/);assert.doesNotMatch(text,forbidden);}finally{await loading.destroy();}
});
