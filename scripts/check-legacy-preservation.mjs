import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root=new URL('../',import.meta.url);
const baseline=JSON.parse(await readFile(new URL('docs/proex-evolucao/BASELINE.json',root),'utf8'));
const failures=[];
for(const {path,gitBlobSha} of baseline.files){
  try {
    const bytes=await readFile(new URL(path,root));
    const actual=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if(actual!==gitBlobSha)failures.push(path);
  }catch{failures.push(path);}
}
if(failures.length){
 console.error('Arquivos do jogo livre diferem da referência aprovada:\n'+failures.join('\n'));
 console.error('Revise a alteração e atualize o baseline somente em uma mudança intencional e verificada.');
 process.exitCode=1;
}else console.log(`${baseline.files.length} arquivos do jogo livre preservados (${baseline.revision.slice(0,7)}).`);
