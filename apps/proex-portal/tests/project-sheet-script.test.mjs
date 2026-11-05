import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { scriptFixture } from './support/apps-script-fixture.mjs';

const source=readFileSync(new URL('../public/integracoes/proex-projeto-planilha.gs',import.meta.url),'utf8');
const schema={table:'items',sheetName:'PROEX · items',mode:'metadata',columns:['_rowKey','_rowHash','id','name','version'].map(name=>({name,editable:name==='name',type:name==='version'?'number':'text'}))};
const original={_rowKey:'synthetic-item',_rowHash:'original-hash',id:'synthetic-item',name:'Material original',version:1};
const fresh={...original,_rowHash:'fresh-hash',name:'Material revisado no Portal',version:2};
function fixture(){
 const f=scriptFixture(),server=f.context.chamar_;vm.runInContext(source,f.context);f.context.chamar_=(tool,args)=>server(tool,args);
 f.schemas=[schema];f.rows.items=[fresh];
 const header=schema.columns.map(column=>column.name),sheet=f.addSheet(schema.sheetName,[header,header.map(name=>original[name])]);sheet.getSheetId=()=>17;
 f.addSheet('PROEX · Controle',[['key','value','note'],['baseline:items:synthetic-item',JSON.stringify(original),'']]);
 return f;
}
test('static project connector stays reproducible and excludes global configuration, Drive and attachment/backup privileges',()=>{
 execFileSync(process.execPath,['scripts/build-project-sheet-connector.mjs','--check'],{cwd:new URL('../',import.meta.url),stdio:'pipe'});
 assert.doesNotMatch(source,/\bDriveApp\b|\/api\/sync\/connector|proex_sync_configure|copiarAnexos|backupCompleto/);
 assert.match(source,/@OnlyCurrentDoc/);
 const scopes=JSON.parse(readFileSync(new URL('../public/integracoes/proex-projeto-appsscript.json',import.meta.url),'utf8')).oauthScopes;
 assert.ok(scopes.includes('https://www.googleapis.com/auth/spreadsheets.currentonly'));assert.ok(!scopes.some(scope=>/auth\/(drive|gmail|spreadsheets$)/.test(scope)));
});
test('project script updates its reserved tabs and direct links while preserving preexisting institutional tabs',()=>{
 const f=fixture(),existing=f.addSheet('Controle de brindes',[['Brinde','Contagem'],['Calendários',50]]),before=JSON.stringify(existing.cells);
 assert.match(f.context.sincronizar_(),/Sincronizado:/);
 assert.equal(JSON.stringify(existing.cells),before);assert.equal(f.sheets.has('items'),false);
 assert.equal(f.sheets.get(schema.sheetName).cells[1][3],fresh.name);
 const links=f.calls.find(call=>call.tool==='proex_project_sheet_tabs');assert.deepEqual(links.args,{tabs:{items:17}});
 assert.equal(f.calls.findLast(call=>call.tool==='proex_sync_run_finish').args.readbackVerified,true);
});
test('edit made during HTTP is preserved and does not advance the project baseline',()=>{
 const f=fixture();f.onCall=tool=>{if(tool==='proex_sync_read')f.sheets.get(schema.sheetName).cells[1][3]='Edição humana durante HTTP';};
 assert.match(f.context.sincronizar_(),/conflito/);assert.equal(f.sheets.get(schema.sheetName).cells[1][3],'Edição humana durante HTTP');
 const baseline=f.sheets.get('PROEX · Controle').cells.find(row=>row[0]==='baseline:items:synthetic-item');assert.deepEqual(JSON.parse(baseline[1]),original);
 assert.equal(f.calls.findLast(call=>call.tool==='proex_sync_run_finish').args.readbackVerified,false);
});
test('real HTTP wrapper sends the observed workbook ID and uses only the project endpoint without token logging',()=>{
 const f=scriptFixture();vm.runInContext(source,f.context);f.properties.set('PORTAL_URL','https://synthetic.invalid');f.properties.set('SYNC_TOKEN','pxp_'+ 'a'.repeat(43));let request;
 f.context.UrlFetchApp.fetch=(url,options)=>{request={url,options};return{getContentText:()=>JSON.stringify({ok:true,result:{projectId:'project-a'}})};};
 const result=f.context.chamar_('proex_sync_describe',{});assert.equal(result.projectId,'project-a');assert.equal(request.url,'https://synthetic.invalid/api/sync/project-connector');assert.equal(request.options.followRedirects,false);assert.equal(JSON.parse(request.options.payload).spreadsheetId,'synthetic-workbook');assert.equal(f.alerts.length,0);
});
