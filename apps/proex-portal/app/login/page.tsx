import LoginClient from '../login-client';
import {database,isStandalone,setupToken} from '@/lib/platform';
import {ownerExists} from '@/lib/owner-setup';
export const dynamic='force-dynamic';
async function firstAccess(){
 // Sites: vínculo do cadastro anterior. Hospedagem própria: configuração inicial enquanto não há responsável.
 if(!isStandalone())return {href:'/acesso-inicial',label:'Configurar acesso anterior'};
 return setupToken()&&!await ownerExists(database())?{href:'/configuracao-inicial',label:'Configuração inicial do servidor'}:null;
}
export default async function Login({searchParams}:{searchParams:Promise<{returnTo?:string}>}){const p=await searchParams;return <LoginClient returnTo={p.returnTo||'/'} firstAccess={await firstAccess()}/>;}
