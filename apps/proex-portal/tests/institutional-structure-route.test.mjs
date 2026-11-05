import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const code=ts.transpileModule(readFileSync(new URL('../app/api/institutional-structure/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function fixture(){let calls=0;const mod={exports:{}};class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
 vm.runInNewContext(code,{module:mod,exports:mod.exports,URL,Response,require:name=>name==='@/lib/errors'?{HttpError,publicError:error=>Response.json({error:error.message},{status:error.status??500})}:name==='@/lib/platform'?{database:()=>{calls++;return{};}}:name==='@/lib/access'?{getActor:async()=>({userId:'synthetic-viewer'})}:name==='@/lib/session'?{getPortalUser:async()=>({})}:name==='@/lib/http'?{boundedJson:request=>request.json()}:name==='@/lib/institutional-structure/service'?{structureWorkspace:async()=>({viewerId:'synthetic-viewer'}),structureAction:async()=>({entityId:'synthetic-node'})}:{}});return{...mod.exports,calls:()=>calls};}
test('structure mutation requires exact same-origin JSON and explicit action header before DB, and all responses are private',async()=>{
 for(const headers of [{},{Origin:'https://other.invalid','Content-Type':'application/json','X-Proex-Action':'1'},{'Content-Type':'application/json','X-Proex-Action':'1'},{Origin:'https://portal.invalid','Content-Type':'application/json'},{Origin:'https://portal.invalid','Content-Type':'text/plain','X-Proex-Action':'1'}]){const f=fixture(),response=await f.POST(new Request('https://portal.invalid/api/institutional-structure',{method:'POST',headers,body:'{}'}));assert.equal(response.status,403);assert.equal(f.calls(),0);assert.equal(response.headers.get('Cache-Control'),'private, no-store');}
 const f=fixture(),response=await f.POST(new Request('https://portal.invalid/api/institutional-structure',{method:'POST',headers:{Origin:'https://portal.invalid','Content-Type':'application/json','X-Proex-Action':'1'},body:'{}'}));assert.equal(response.status,200);assert.equal(f.calls(),1);assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
});
test('invalid structure query flags and extra fields are rejected without touching storage; GET is no-store',async()=>{
 for(const query of ['includeArchived=1','includeArchived=none','organizationId=a&unexpected=x']){const f=fixture(),response=await f.GET(new Request('https://portal.invalid/api/institutional-structure?'+query));assert.equal(response.status,400);assert.equal(f.calls(),0);}
 const f=fixture(),response=await f.GET(new Request('https://portal.invalid/api/institutional-structure?organizationId=synthetic-org'));assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
});
