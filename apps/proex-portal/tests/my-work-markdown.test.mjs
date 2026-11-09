import test from 'node:test';
import assert from 'node:assert/strict';
import {compile} from './support/traffic-fixture.mjs';

const {myWorkExportReport,myWorkExportRows,myWorkMarkdownReport}=await import(compile('components/portal/my-work-export.ts'));
const query={userId:'private-viewer-id',organizationId:'private-organization-id',projectId:'private-project-id',assignment:'team',status:'pending',taskOffset:6,responsibilityOffset:0};
const context={organization_id:query.organizationId,project_id:query.projectId,organization_name:'PROEX de demonstração',project_name:'Projeto de demonstração'};
const target={kind:'materials',id:'private-target-id',name:'Calendários conferidos',canOpen:true,href:'/?module=materials&project=private-project-id&itemId=private-target-id'};
const counts={total:19,pending:17,attention:2,overdue:1,dueToday:1,inProgress:8,blocked:1,completed:2,cancelled:0};
function fixture(){
 const task={...context,id:'private-task-id',title:'Conferir calendários de segunda-feira',body:'PRIVATE-BODY-SENTINEL',notes:'PRIVATE-NOTES-SENTINEL',contact:'private-contact@example.invalid',status:'in_progress',priority:'high',due_at:'2026-11-09',version:2,canEdit:false,canWork:true,canDelegateWork:false,assignees:[{user_id:'private-person-id',team_id:null,name:'PRIVATE-PERSON-SENTINEL'}],assignmentVia:'team',area:'materials',href:'/?module=demands&demandId=private-task-id',target};
 const responsibility={...context,id:'private-responsibility-id',area:'materials',item_id:'private-target-id',loan_id:null,campaign_id:null,status:'active',version:2,created_at:'2026-11-05T15:00:00Z',updated_at:'2026-11-05T15:00:00Z',assignees:[{user_id:null,team_id:'private-team-id',name:'PRIVATE-TEAM-SENTINEL'}],assignmentVia:'team',canEdit:false,target};
 return{version:1,viewerId:query.userId,asOf:'2026-11-05T15:12:13.000Z',today:'2026-11-05',timeZone:'America/Sao_Paulo',scope:{organizationId:query.organizationId,projectId:query.projectId,assignment:'team',status:'pending'},totalsScope:'organization-project-assignment',totals:{tasks:counts,responsibilities:{total:8}},areas:[{area:'materials',taskCounts:counts,responsibilityCount:8}],tasks:{items:[task],total:17,hasMore:true,nextOffset:12},responsibilities:{items:[responsibility],total:8,hasMore:true,nextOffset:6}};
}

// Decode one literal layer only. Repeated entity decoding would change the source
// text itself (for example, a source that literally says "&lt;script&gt;").
function decodeLiteral(value){
 const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
 return value.replace(/\\([!-/:-@\[-`{-~])|&(?:#([0-9]+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos));/gi,(_m,escaped,decimal,hex,name)=>escaped??(decimal?String.fromCodePoint(Number(decimal)):hex?String.fromCodePoint(parseInt(hex,16)):named[name.toLowerCase()]));
}
function tableCells(line){
 const value=line.trim();if(!value.startsWith('|')||!value.endsWith('|'))return null;
 const result=[];let cell='';
 for(let i=1;i<value.length-1;i++){
  if(value[i]==='\\'&&i+1<value.length-1){cell+=value[i]+value[++i];continue;}
  if(value[i]==='|'){result.push(cell.trim());cell='';}else cell+=value[i];
 }
 result.push(cell.trim());return result;
}
const sixColumnRows=markdown=>markdown.split(/\r?\n/).map(tableCells).filter(row=>row?.length===6&&!row.every(cell=>/^:?-+:?$/.test(cell)));
const inertLiteral=value=>value.replace(/\\[!-/:-@\[-`{-~]|&(?:#[0-9]+|#x[0-9a-f]+|amp|lt|gt|quot|apos);/gi,'x');
function literalCell(value){
 const inert=inertLiteral(value);
 assert.doesNotMatch(inert,/[\\`*_{}\[\]<>()#+.!|~=:^$-]/,'dynamic Markdown punctuation must remain literal, including Obsidian embeds, autolinks and HTML');
}
const forbidden=/private-(?:viewer|organization|project|task|target|responsibility|person|team)-id|PRIVATE-(?:BODY|NOTES|PERSON|TEAM)-SENTINEL|private-contact@example\.invalid|\?module=|demandId=|itemId=/;

test('Vault Markdown has the same six allowlisted cells and current-page metadata as the document formats',()=>{
 const data=fixture(),report=myWorkExportReport(data,query),markdown=myWorkMarkdownReport(report);
 assert.equal(typeof markdown,'string');assert.match(markdown,/^# Meu trabalho no Portal PROEX\n/);
 const rows=sixColumnRows(markdown).map(row=>row.map(decodeLiteral));
 assert.deepEqual(rows[0],report.columns.map(column=>column.label));
 assert.deepEqual(rows.slice(1),report.rows.map(row=>report.columns.map(column=>String(row[column.key]??''))));
 assert.deepEqual(report.rows,myWorkExportRows(data));
 const decoded=decodeLiteral(markdown);for(const [label,value]of report.info){assert.ok(decoded.includes(label),label);assert.ok(decoded.includes(value),label);}
 assert.match(decoded,/7–7 de 17/);assert.match(decoded,/1–1 de 8/);assert.match(decoded,/deslocamento 6/);assert.match(decoded,/Limite 6 por lista/);assert.match(decoded,/05\/11\/2026, 12:12:13/);assert.match(decoded,/19 demandas e 8 acompanhamentos/);
 assert.doesNotMatch(decoded,forbidden);assert.doesNotMatch(markdown,/^---\s*$/m);
});

test('hostile document names remain literal cells rather than embeds HTML links fences tasks or frontmatter',()=>{
 const hostile=[
  '![[nota privada#seção|exibir]]',
  '<script>alert("x")</script><img src=x onerror=alert(1)>',
  '[Abrir](javascript:alert(1)) ![imagem](https://external.invalid/image)',
  '```html\n# Título falso\n<script>exec()</script>\n```',
  '---\ncssclasses: perigoso\npublish: true\n---',
  '- [x] tarefa falsa\n1. nova linha\n> citação\n# cabeçalho',
  'https://external.invalid/rota?email=private@example.invalid&v=1',
  '==realce== %%oculto%% $math$ ^block {{template}}',
  '[referência]: https://external.invalid/ ![[embed]]',
  'Caneta | lápis \\ # [modelo] &lt;script&gt; &amp; &#124;',
  'Variação \u202Eoculta\u2066 \u0000 e\t espaços\nquebrados',
 ];
 for(const source of hostile){
  const data=fixture();data.tasks.items[0].title=source;data.tasks.items[0].organization_name=source;data.responsibilities.items[0].target={...target,name:source};
  const report=myWorkExportReport(data,query),markdown=myWorkMarkdownReport(report),encoded=sixColumnRows(markdown);
  assert.equal(encoded.length,3,'source newlines and pipes must not add report rows or cells');
  for(const row of encoded.slice(1))for(const cell of row)literalCell(cell);
  assert.deepEqual(encoded.slice(1).map(row=>row.map(decodeLiteral)),report.rows.map(row=>report.columns.map(column=>String(row[column.key]??''))),source);
  assert.doesNotMatch(inertLiteral(markdown),/<\/?(?:script|img|svg)|!\[\[|```|^---\s*$|^\s*[-+] \[[ x]\]/mi);
  assert.doesNotMatch(markdown.replace(/\r?\n/g,''),/[\p{Cc}\p{Bidi_Control}]/u,'control characters must not survive inside exported values');
 }
});

test('restricted records replace the entire Markdown row and never expose supplied hidden names or context',()=>{
 const data=fixture();data.tasks.items[0]={...data.tasks.items[0],title:'PRIVATE-TITLE-SENTINEL',organization_name:'PRIVATE-ORG-SENTINEL',project_name:'PRIVATE-PROJECT-SENTINEL',target:{...target,name:'PRIVATE-TARGET-SENTINEL',canOpen:false}};
 data.responsibilities.items[0]={...data.responsibilities.items[0],organization_name:'PRIVATE-ORG-SENTINEL',project_name:'PRIVATE-PROJECT-SENTINEL',target:{...target,name:'PRIVATE-TARGET-SENTINEL',canOpen:false}};
 const report=myWorkExportReport(data,query),markdown=myWorkMarkdownReport(report),rows=sixColumnRows(markdown).slice(1).map(row=>row.map(decodeLiteral));
 assert.deepEqual(rows,[['Demanda','Registro de acesso restrito','','','',''],['Designação','Registro de acesso restrito','','','','']]);
 // The file's own generation time is "now" and may legitimately be 09/11/2026; only the hidden due date must not leak.
 assert.doesNotMatch(decodeLiteral(markdown).replace(/arquivo em \d{2}\/\d{2}\/\d{4}, [\d:]+/,'arquivo em [geração]'),/PRIVATE-|private-.*?-id|private-contact|09\/11\/2026|Prioridade alta/);
});

test('metadata is literal too and caller-injected extra DTO properties never become Markdown',()=>{
 const report=myWorkExportReport(fixture(),query),source='![[segredo]] <svg/onload=alert(1)> [x](javascript:x)\n---';
 const withMetadata={...report,info:[...report.info,[source,source]],body:'PRIVATE-BODY-SENTINEL',assignees:['PRIVATE-PERSON-SENTINEL'],href:'https://private.invalid'};
 const markdown=myWorkMarkdownReport(withMetadata),decoded=decodeLiteral(markdown);
 assert.ok(decoded.includes(source.replace(/\s+/gu,' ').trim()));
 assert.doesNotMatch(inertLiteral(markdown),/!\[\[|<svg|javascript:x|\n---/);
 const metadata=markdown.split('\n').find(line=>line.includes('segredo')).match(/^- \*\*(.*):\*\* (.*)$/);
 assert.ok(metadata);literalCell(metadata[1]);literalCell(metadata[2]);
 assert.doesNotMatch(decoded,/PRIVATE-|private\.invalid/);
});
