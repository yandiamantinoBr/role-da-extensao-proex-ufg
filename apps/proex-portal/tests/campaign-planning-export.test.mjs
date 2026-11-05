import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {PDFDocument} from 'pdf-lib';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {compile,root} from './support/traffic-fixture.mjs';
import {brandBytes,fontBytes,reportPdf,zipEntries} from './support/report-module.mjs';
const {planningExportReport,planningFingerprint}=await import(compile('components/portal/campaign-planning-export.ts'));
globalThis.__planningActualPdf=(title,columns,rows,display,info,options)=>reportPdf.toPdf(title,columns,rows,display,info,{...options,fontBytes,brandBytes});
const {documentExport}=await import(compile('components/portal/document-export.ts',new Map([[resolve(root,'components/portal/report-pdf.ts'),'export async function toPdf(...args){return globalThis.__planningActualPdf(...args);}']])));
const fixture=()=>({viewerId:'private-viewer-id',campaignId:'private-campaign-id',primaryProjectId:'role-da-extensao',version:3,canManage:true,campaign:{name:'Rolê no evento sintético',status:'draft',primaryProjectName:'Rolê da Extensão'},hosts:[{projectId:'hidden-project-id',projectName:'Host private name',canManage:true,projectStatus:'active',linkedAt:'2026-11-05T15:00:00Z'}],sessions:[{id:'private-session-id',sessionDate:'2026-11-09',ordinal:1,label:'=HYPERLINK("https://evil.invalid")',startsAt:null,endsAt:null,status:'tentative',note:'Conferir calendários <literal>',version:1}],asOf:'2026-11-05T15:12:13Z',email:'private@example.invalid',stock:99});
const forbidden=/private-viewer-id|private-campaign-id|private-session-id|hidden-project-id|Host private name|private@example|"stock"/;
const render=(format,report)=>documentExport(format,report.title,report.columns,report.rows,(row,key)=>row[key]??'',report.info,report.presentation);
test('planning export keeps tentative dates/times literal, covers all fields in PDF grouping, and excludes hosts and identities',()=>{
 const report=planningExportReport(fixture());assert.equal(report.rows.length,1);assert.equal(report.rows[0].data,'09/11/2026');assert.equal(report.rows[0].inicio,'A confirmar');assert.equal(report.rows[0].fim,'A confirmar');assert.equal(report.presentation.projectBrand,'role-da-extensao');assert.doesNotMatch(JSON.stringify(report),forbidden);assert.match(JSON.stringify(report.info),/05\/11\/2026, 12:12:13/);assert.deepEqual(report.presentation.columnGroups.flatMap(group=>group.keys).sort(),report.columns.map(c=>c.key).sort());
 const first=fixture(),same={...first,asOf:'2026-11-05T15:12:14Z'};assert.equal(planningFingerprint(first),planningFingerprint(same));assert.notEqual(planningFingerprint(first),planningFingerprint({...same,canManage:false}));assert.notEqual(planningFingerprint(first),planningFingerprint({...same,hosts:[]}));
});
test('planning XLSX and DOCX are real archives; formula-like labels remain inert and private DTO fields are absent',async()=>{
 for(const format of ['xlsx','docx']){const report=planningExportReport(fixture()),blob=await render(format,report),entries=await zipEntries(blob),xml=entries.get(format==='docx'?'word/document.xml':'xl/worksheets/sheet1.xml');assert.ok(entries.has('[Content_Types].xml'));const allXml=[...entries.values()].join(' ');assert.match(allXml,/Projeto responsável/);assert.match(allXml,/Rolê da Extensão/);assert.match(xml,/Provisória/);assert.match(xml,/A confirmar/);assert.match(xml,/&lt;literal&gt;/);assert.doesNotMatch(xml,forbidden);if(format==='xlsx'){assert.match(xml,/'=HYPERLINK/);assert.doesNotMatch(xml,/<f[ >]/);}}
});
test('planning PDF uses the institutional layout and preserves tentative semantics on a compact page',async()=>{
 const report=planningExportReport(fixture()),blob=await render('pdf',report),bytes=new Uint8Array(await blob.arrayBuffer()),pdf=await PDFDocument.load(bytes);assert.equal(blob.type,'application/pdf');assert.equal(pdf.getPageCount(),1);assert.equal(pdf.getTitle(),`Rolê da Extensão - ${report.title}`);
 const loading=getDocument({data:bytes.slice(),useSystemFonts:true,disableFontFace:true});try{const doc=await loading.promise,page=await doc.getPage(1),content=await page.getTextContent(),text=content.items.map(item=>'str'in item?item.str:'').join(' ').replace(/\s+/g,' ');assert.match(text,/Programação da dinâmica/);assert.match(text,/Rolê da Extensão/);assert.match(text,/A confirmar/);assert.match(text,/Provisória/);assert.match(text,/09\/11\/2026/);assert.doesNotMatch(text,forbidden);}finally{await loading.destroy();}
});


test('fifteen branded planning rows use the compact table in at most three A4 pages with every date and note',async()=>{
 const data=fixture();data.sessions=Array.from({length:15},(_,i)=>({...data.sessions[0],id:`synthetic-session-${i}`,sessionDate:`2026-11-${String(9+Math.floor(i/3)).padStart(2,'0')}`,ordinal:i%3+1,label:`Rodada ${i%3+1}`,note:`Observação ${i+1}: planejamento provisório; conferir quantidade com a equipe.`}));
 const report=planningExportReport(data),bytes=new Uint8Array(await(await render('pdf',report)).arrayBuffer()),pdf=await PDFDocument.load(bytes);assert.ok(pdf.getPageCount()<=3,`15 rows must be a compact table, got ${pdf.getPageCount()} pages`);
 const loading=getDocument({data:bytes.slice(),useSystemFonts:true,disableFontFace:true});try{const doc=await loading.promise,all=[];for(let i=1;i<=doc.numPages;i++){const page=await doc.getPage(i),content=await page.getTextContent();all.push(content.items.map(x=>'str'in x?x.str:'').join(' '));}const text=all.join(' ').replace(/\s+/g,' ');assert.match(text,/RELATÓRIO DO PROJETO/);assert.match(text,/13\/11\/2026/);assert.match(text,/Observação 15/);assert.match(text,/Sessão e horário/);assert.doesNotMatch(text,/Registro 15/);}finally{await loading.destroy();}
});
