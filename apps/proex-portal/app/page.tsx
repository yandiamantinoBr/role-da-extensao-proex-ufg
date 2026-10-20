import {redirect} from 'next/navigation';
import {getPortalUser} from '../lib/session';
import {database} from '../lib/platform';
import {getActor} from '../lib/access';
import {portalSnapshot} from '../lib/portal-data';
import {HttpError} from '../lib/errors';
import PortalClient from './portal-client';
import LoginClient from './login-client';
export const dynamic='force-dynamic';
export default async function Page(){
 let user;try{user=await getPortalUser();}catch(error){if(error instanceof HttpError&&error.status===403)return <LoginClient initialError={error.message}/>;throw error;}if(!user)redirect('/login');
 if(user.source==='native')return <LoginClient mode="initial" native initialEmail={user.email}/>;
 const db=database(),actor=await getActor(db,user);if(!actor)redirect('/login');
 if(actor.capabilities.includes('projects.manage'))await db.prepare("INSERT OR IGNORE INTO projects(id,name,description,created_at) VALUES('role-da-extensao','Rolê da Extensão','Ações, roleta, dado e materiais do Rolê da Extensão.',?)").bind(new Date().toISOString()).run();
 return <PortalClient initial={await portalSnapshot(db,actor)}/>;
}
