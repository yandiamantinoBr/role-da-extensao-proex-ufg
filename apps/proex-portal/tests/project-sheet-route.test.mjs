import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const code=ts.transpileModule(readFileSync(new URL('../app/api/projects/[id]/sheets/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function fixture(){
 let databaseCalls=0;const compiledModule={exports:{}};
 class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
 vm.runInNewContext(code,{module:compiledModule,exports:compiledModule.exports,URL,Response,require:name=>name==='@/lib/errors'?{HttpError,publicError:error=>Response.json({error:error.message},{status:error.status??500})}:name==='@/lib/platform'?{database:()=>{databaseCalls++;throw new Error('authenticated route reached');}}:{}});
 return{post:compiledModule.exports.POST,calls:()=>databaseCalls};
}
test('project sheet mutations require exact Origin, JSON and the explicit action header before opening the database',async()=>{
 for(const headers of [{},{'Origin':'https://other.invalid','Content-Type':'application/json','X-Proex-Action':'1'},{'Content-Type':'application/json','X-Proex-Action':'1'},{'Origin':'https://portal.invalid','Content-Type':'application/json'},{'Origin':'https://portal.invalid','Content-Type':'text/plain','X-Proex-Action':'1'}]){
  const f=fixture(),response=await f.post(new Request('https://portal.invalid/api/projects/p/sheets',{method:'POST',headers,body:'{}'}),{params:Promise.resolve({id:'p'})});assert.equal(response.status,403);assert.equal(f.calls(),0);
 }
 const f=fixture();await f.post(new Request('https://portal.invalid/api/projects/p/sheets',{method:'POST',headers:{Origin:'https://portal.invalid','Content-Type':'application/json','X-Proex-Action':'1'},body:'{}'}),{params:Promise.resolve({id:'p'})});assert.equal(f.calls(),1);
});
