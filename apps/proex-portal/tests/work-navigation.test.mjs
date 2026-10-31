import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compiledModule={exports:{}};
const code=ts.transpileModule(readFileSync(new URL('../lib/work-navigation.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(code,{module:compiledModule,exports:compiledModule.exports,URLSearchParams,Object});
const {workRecordFromParams,writeWorkRecordParams}=compiledModule.exports;

test('record links preserve the explicit module and project without treating arbitrary query strings as navigation',()=>{
 for(const [target,key] of [['projects','detailProject'],['materials','itemId'],['loans','loanId'],['events','campaignId']]){
  const record=target==='projects'?'project-a':'record-a',params=new URLSearchParams({module:target,project:'project-a',[key]:record});
  const selected=workRecordFromParams(params);assert.equal(selected.module,target);assert.equal(selected.projectId,'project-a');assert.equal(selected.recordId,record);
 }
 for(const query of ['module=profile&project=p&itemId=i','module=materials&itemId=i','module=materials&project=p&itemId=javascript:alert(1)','module=projects&project=a&detailProject=b','module=materials&project=p&itemId=%2F%2Fexternal'])assert.equal(workRecordFromParams(new URLSearchParams(query)),null);
});

test('leaving a record removes every stale entity hint and never changes the project scope',()=>{
 const params=new URLSearchParams('module=loans&project=p&itemId=old&campaignId=old&loanId=old&detailProject=old');
 writeWorkRecordParams(params,{module:'loans',projectId:'p',recordId:'loan-a'},'loans','p');assert.equal(params.get('loanId'),'loan-a');assert.equal(params.get('itemId'),null);assert.equal(params.get('project'),'p');
 writeWorkRecordParams(params,{module:'loans',projectId:'p',recordId:'loan-a'},'materials','p');assert.equal(params.has('loanId'),false);
 writeWorkRecordParams(params,{module:'loans',projectId:'p',recordId:'loan-a'},'loans','other');assert.equal(params.has('loanId'),false);
});
