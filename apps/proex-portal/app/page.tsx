import {getChatGPTUser,chatGPTSignInPath,chatGPTSignOutPath} from './chatgpt-auth';
import {database,ownerEmail} from '../lib/platform';
import {getActor} from '../lib/access';
import {portalSnapshot} from '../lib/portal-data';
import PortalClient from './portal-client';
export const dynamic='force-dynamic';
export default async function Page(){
 const user=await getChatGPTUser();
 if(!user)return <main className="entry-page"><div className="entry-orbit"/><section className="entry-card"><div className="entry-brand"><img src="/brand/proex.png" alt="PROEX UFG"/></div><p className="eyebrow">CONEXÕES QUE TRANSFORMAM</p><h1>Uma extensão.<br/>Muitas possibilidades.</h1><p>O espaço da equipe PROEX para organizar ações, acompanhar materiais e cuidar de cada encontro.</p><a className="primary-button" href={chatGPTSignInPath('/')} target="_top">Entrar no portal <span aria-hidden="true">↗</span></a><p className="entry-note">Acesso com sua conta ChatGPT. As permissões são definidas pela equipe, por projeto.</p><a className="entry-free" href="https://role-da-extensao-ufg.yandiamantinobr.chatgpt.site" target="_blank" rel="noreferrer">Abrir a roleta livre ↗</a></section><footer>PROEX · Universidade Federal de Goiás</footer></main>;
 try{const db=database(),actor=await getActor(db,user,ownerEmail());if(!actor)throw new Error('Acesso indisponível');
  if(actor.capabilities.includes('projects.manage'))await db.prepare("INSERT OR IGNORE INTO projects(id,name,description,created_at) VALUES('role-da-extensao','Rolê da Extensão','Ações, roleta, dado e materiais do Rolê da Extensão.',?)").bind(new Date().toISOString()).run();
  return <PortalClient initial={await portalSnapshot(db,actor)}/>;
 }catch(error){console.error('Portal unavailable',error instanceof Error?error.name:'error');return <main className="entry-page"><section className="entry-card"><h1>Estamos preparando seu acesso.</h1><p>Atualize a página em instantes. Se você recebeu um convite, abra o link do convite depois de entrar.</p><a className="primary-button" href="/">Tentar novamente</a><a href={chatGPTSignOutPath('/')} target="_top">Sair</a></section></main>;}
}
