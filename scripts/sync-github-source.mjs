// Keep public GitHub history separate from the private Sites repository history.
// This command prepares a three-way source merge; native connectors publish it.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';

const remote='https://github.com/yandiamantinoBr/role-da-extensao-proex-ufg.git';
const root=process.cwd();
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024}).trim();
const mode=process.argv[2]??'plan';
const marker=/^GitHub sync: ([0-9a-f]{40})$/m;
if(mode==='mark') {
  const sha=process.argv[3];
  if(!/^[0-9a-f]{40}$/.test(sha??''))throw new Error('A verified GitHub commit SHA is required.');
  git('fetch','--no-tags',remote,'main:refs/remotes/github/main');
  if(git('rev-parse',`${sha}^{tree}`)!==git('write-tree'))throw new Error('Site and GitHub file trees differ; refusing to mark them synchronized.');
  git('commit','--allow-empty','-m',`GitHub sync: ${sha}`);
  console.log(JSON.stringify({githubCommit:sha,siteCommit:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}')}));
} else if(mode==='plan') {
  if(git('status','--porcelain'))throw new Error('Commit or preserve pending source edits before preparing a merge.');
  const baseline=git('log','--format=%B','--grep=^GitHub sync:','-1').match(marker)?.[1];
  if(!baseline)throw new Error('No synchronization baseline. Establish verified equal file trees using mark first.');
  git('fetch','--no-tags',remote,'main:refs/remotes/github/main');
  const publicHead=git('rev-parse','refs/remotes/github/main');
  const baseTree=git('rev-parse',`${baseline}^{tree}`),publicTree=git('rev-parse',`${publicHead}^{tree}`),siteTree=git('rev-parse','HEAD^{tree}');
  let mergedTree=publicTree;
  if(siteTree!==baseTree && siteTree!==publicTree){
    // This temporary commit has only the public baseline as its parent.
    const candidate=git('commit-tree',siteTree,'-p',baseline,'-m','Alteracoes de origem ChatGPT Sites');
    try{mergedTree=git('merge-tree','--write-tree',publicHead,candidate).split('\n')[0];}
    catch{throw new Error('Concurrent source conflict: preserve both versions and report it; never force-push or overwrite edits.');}
  }
  mkdirSync('.sync',{recursive:true});
  const plan={baseline,publicHead,siteTree,mergedTree,needsGitHub:mergedTree!==publicTree,needsSites:mergedTree!==siteTree};
  writeFileSync('.sync/source-plan.json',JSON.stringify(plan,null,2)+'\n');
  console.log(JSON.stringify(plan));
} else if(mode==='apply') {
  const plan=JSON.parse(readFileSync('.sync/source-plan.json','utf8'));
  if(git('status','--porcelain')||git('rev-parse','HEAD^{tree}')!==plan.siteTree)throw new Error('Source changed after planning; start again.');
  git('read-tree','--reset','-u',plan.mergedTree);
  if(plan.needsSites)git('commit','-m','Sincronizar fonte do Role da Extensao');
  console.log(JSON.stringify(plan));
} else if(mode==='export') {
  const plan=JSON.parse(readFileSync('.sync/source-plan.json','utf8'));
  const rows=git('ls-tree','-r',plan.mergedTree).split('\n').filter(Boolean);
  const files=rows.map(row=>{
    const match=/^(\d+) blob ([a-f0-9]+)\t(.+)$/.exec(row);
    if(!match)throw new Error('Unsupported source entry.');
    const [,fileMode,sha,filePath]=match;
    const bytes=execFileSync('git',['cat-file','blob',sha],{cwd:root,maxBuffer:32*1024*1024});
    return {path:filePath,mode:fileMode,sha,encoding:'base64',content:bytes.toString('base64')};
  });
  const output=path.resolve('.sync/github-export.json');
  writeFileSync(output,JSON.stringify({parentSha:plan.publicHead,treeSha:plan.mergedTree,files}));
  console.log(JSON.stringify({output,fileCount:files.length,parentSha:plan.publicHead,treeSha:plan.mergedTree}));
} else throw new Error('Use plan, apply, export or mark.');
