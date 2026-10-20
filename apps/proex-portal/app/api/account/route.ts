import {headers} from 'next/headers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {database} from '@/lib/platform';
import {getActor,requireCapability,accessAction,writeAudit} from '@/lib/access';
import {getPortalUser,ensureNativePrincipal,authForRequest,newPrincipalId} from '@/lib/session';
import {one,iso,text} from '@/lib/database';
import {HttpError,publicError} from '@/lib/errors';
import {boundedJson} from '@/lib/http';
import {accountRate} from '@/lib/rate-limit';
export const dynamic='force-dynamic';
async function tokenHash(value:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
function password(value:unknown){if(typeof value!=='string'||value.length<12||value.length>128)throw new HttpError(400,'Use uma senha de 12 a 128 caracteres.','invalid_password');return value;}
async function invitation(db:D1Database,token:string){if(!/^[A-Za-z0-9_-]{32,120}$/.test(token))throw new HttpError(400,'Convite inválido.');const i=await one(db,'SELECT * FROM invites WHERE token_hash=?',[await tokenHash(token)]);if(!i||i.revoked_at||i.expires_at<=iso())throw new HttpError(410,'O convite expirou ou foi revogado. Peça outro link.');return i;}
function safePath(value:unknown){return typeof value==='string'&&value.startsWith('/')&&!value.startsWith('//')&&!value.startsWith('/api/')?value:'/';}
function privateResponse(r:Response){r.headers.set('Cache-Control','private, no-store');return r;}
async function admittedSignIn(db:D1Database,auth:Awaited<ReturnType<typeof authForRequest>>,email:string,secret:string,h:Headers,callbackURL='/'){
 const response=await auth.api.signInEmail({body:{email,password:secret,callbackURL,rememberMe:true},headers:h,asResponse:true});
 if(!response.ok)return privateResponse(response);
 const result=await response.clone().json() as {token?:string;user?:{id?:string}};
 const account=await one(db,"SELECT u.status,u.activation_pending FROM identity_aliases l JOIN portal_users u ON u.user_id=l.user_id WHERE l.provider='password' AND l.subject=?",[result.user?.id||'']);
 if(!account||account.status!=='active'||account.activation_pending){
  if(result.token)await db.prepare('DELETE FROM auth_session WHERE token=?').bind(result.token).run();
  throw new HttpError(403,'O acesso mudou durante a entrada. Procure o responsável da equipe.','account_blocked');
 }
 return privateResponse(response);
}
export async function GET(request:Request){try{const url=new URL(request.url),token=url.searchParams.get('token');if(token){const i=await invitation(database(),token);return Response.json({email:i.email,role:i.role,accepted:!!i.accepted_at,projectName:i.project_id?(await one(database(),'SELECT name FROM projects WHERE id=?',[i.project_id]))?.name:null},{headers:{'Cache-Control':'no-store'}});}const user=await getPortalUser();return Response.json({user:user?{userId:user.userId,email:user.email,displayName:user.displayName,hasPassword:user.hasPassword,source:user.source}:null},{headers:{'Cache-Control':'no-store'}});}catch(e){return publicError(e);}}
export async function POST(request:Request){try{
 const origin=new URL(request.url).origin;if(request.headers.get('Origin')!==origin||request.headers.get('X-Proex-Action')!=='1'||!request.headers.get('content-type')?.includes('application/json'))throw new HttpError(403,'Atualize a página e tente novamente.','invalid_origin');
 const input=await boundedJson(request,12000),db=database(),h=await headers();
 if(input.action==='login'){
  const email=text(input.email,254).toLowerCase();await accountRate(db,request,email||'invalid');if(typeof input.password!=='string'||input.password.length>128)throw new HttpError(401,'E-mail ou senha inválidos.');
  const admitted=await one(db,"SELECT u.status,u.activation_pending FROM auth_user a JOIN identity_aliases l ON l.provider='password' AND l.subject=a.id JOIN portal_users u ON u.user_id=l.user_id WHERE lower(a.email)=?",[email]);
  if(!admitted||admitted.status!=='active'||admitted.activation_pending)throw new HttpError(401,'E-mail ou senha inválidos, ou cadastro ainda não ativado.');
  return await admittedSignIn(db,await authForRequest(db),email,input.password,h,safePath(input.returnTo));
 }
 if(input.action==='logout')return privateResponse(await(await authForRequest(db)).api.signOut({headers:h,asResponse:true}));
 if(input.action==='initialPassword'){
  const native=await getChatGPTUser(),user=await ensureNativePrincipal();if(!native||!user)throw new HttpError(403,'Comprove o acesso anterior pelo link de configuração inicial.');
  await accountRate(db,request,`initial:${user.userId}`);const auth=await authForRequest(db),newPassword=password(input.password),name=text(input.name,120)||user.displayName;
  if(user.hasPassword)throw new HttpError(409,'Sua senha já foi configurada. Entre com e-mail e senha.');
  let authUser=await one(db,'SELECT id,email FROM auth_user WHERE lower(email)=?',[user.email]);
  if(authUser){await auth.api.signInEmail({body:{email:user.email,password:newPassword},headers:h});const existing=await one(db,"SELECT user_id FROM identity_aliases WHERE provider='password' AND subject=?",[authUser.id]);if(existing&&existing.user_id!==user.userId)throw new HttpError(409,'Esta conta já está vinculada a outro cadastro. Procure o responsável.');}
  else authUser=(await auth.api.createUser({body:{email:user.email,password:newPassword,name,role:'user'}})).user;
  await db.batch([db.prepare("INSERT OR IGNORE INTO identity_aliases(provider,subject,user_id,created_at) VALUES('password',?,?,?)").bind(authUser.id,user.userId,iso()),db.prepare("UPDATE profiles SET display_name=?,version=version+1,updated_at=? WHERE user_id=? AND EXISTS(SELECT 1 FROM identity_aliases WHERE provider='password' AND subject=? AND user_id=?)").bind(name,iso(),user.userId,authUser.id,user.userId)]);
  const linked=await one(db,"SELECT user_id FROM identity_aliases WHERE provider='password' AND subject=?",[authUser.id]);if(linked?.user_id!==user.userId)throw new HttpError(409,'Esta conta já está vinculada a outro cadastro. Procure o responsável.');
  await writeAudit(db,(await getActor(db,user))!,'account.password-linked',user.userId);
  return await admittedSignIn(db,auth,user.email,newPassword,h);
 }
 if(input.action==='activateInvite'){
  const token=text(input.token,150);await accountRate(db,request,`invite:${await tokenHash(token)}`);const i=await invitation(db,token),auth=await authForRequest(db),suppliedPassword=password(input.password),name=text(input.name,120);
  if(!name)throw new HttpError(400,'Informe como deseja ser chamado.');
  let authUser=await one(db,'SELECT id,email FROM auth_user WHERE lower(email)=?',[i.email.toLowerCase()]);
  if(authUser)await auth.api.signInEmail({body:{email:i.email,password:suppliedPassword},headers:h});
  else authUser=(await auth.api.createUser({body:{email:i.email,password:suppliedPassword,name,role:'user'}})).user;
  const alias=await one(db,"SELECT user_id FROM identity_aliases WHERE provider='password' AND subject=?",[authUser.id]);
  const native=await getChatGPTUser();const legacy=native&&native.email.toLowerCase()===i.email.toLowerCase()?await ensureNativePrincipal():null;
  let canonical=alias?.user_id||legacy?.userId||newPrincipalId();const now=iso();
  if(alias&&legacy&&alias.user_id!==legacy.userId)throw new HttpError(409,'Os cadastros anteriores são diferentes. Procure o responsável para revisar o vínculo.');
  await db.batch([
   db.prepare("INSERT OR IGNORE INTO portal_users(user_id,email,status,activation_pending,created_at,updated_at) VALUES(?,?,'active',1,?,?)").bind(canonical,i.email,now,now),
   db.prepare('INSERT OR IGNORE INTO profiles(user_id,display_name,version,created_at,updated_at) VALUES(?,?,1,?,?)').bind(canonical,name,now,now),
   db.prepare("INSERT OR IGNORE INTO identity_aliases(provider,subject,user_id,created_at) VALUES('password',?,?,?)").bind(authUser.id,canonical,now)]);
  const persistedAlias=await one(db,"SELECT user_id FROM identity_aliases WHERE provider='password' AND subject=?",[authUser.id]);if(!persistedAlias)throw new HttpError(409,'Não foi possível vincular a conta. Tente novamente.');
  if(legacy&&persistedAlias.user_id!==legacy.userId)throw new HttpError(409,'Esta conta já está vinculada a outro cadastro. Procure o responsável.');canonical=persistedAlias.user_id;
  const account=await one(db,'SELECT status FROM portal_users WHERE user_id=?',[canonical]);if(account?.status!=='active')throw new HttpError(403,'Este cadastro está bloqueado. Procure o responsável.');
  const actor=(await getActor(db,{userId:canonical,email:i.email,displayName:name}))!;
  if(!i.accepted_at)await accessAction(db,actor,'invite.accept',{token},origin);else if(i.accepted_by!==canonical)throw new HttpError(409,'Este convite já foi utilizado por outra conta.');
  await db.prepare('UPDATE portal_users SET activation_pending=0,updated_at=? WHERE user_id=? AND status=? AND EXISTS(SELECT 1 FROM invites WHERE id=? AND accepted_by=?)').bind(now,canonical,'active',i.id,canonical).run();
  const activated=await one(db,'SELECT activation_pending,status FROM portal_users WHERE user_id=?',[canonical]);if(!activated||activated.activation_pending||activated.status!=='active')throw new HttpError(403,'Não foi possível ativar o cadastro. Peça ao responsável para revisar o convite.');
  return await admittedSignIn(db,auth,i.email,suppliedPassword,h);
 }
 if(input.action==='resetPassword'){
  await accountRate(db,request,`reset:${text(input.token,150)}`);await(await authForRequest(db)).api.resetPassword({body:{token:text(input.token,150),newPassword:password(input.newPassword)}});return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});
 }
 const user=await getPortalUser();if(!user)throw new HttpError(401,'Entre com seu e-mail e senha.');
 if(input.action==='changePassword'){
  if(user.source!=='password')throw new HttpError(409,'Configure primeiro sua senha.');await accountRate(db,request,`change:${user.userId}`);
  return privateResponse(await(await authForRequest(db)).api.changePassword({body:{currentPassword:typeof input.currentPassword==='string'?input.currentPassword:'',newPassword:password(input.newPassword),revokeOtherSessions:true},headers:h,asResponse:true}));
 }
 if(input.action==='adminReset'){
  const actor=(await getActor(db,user))!;requireCapability(actor,'organization.manage',null);await accountRate(db,request,`admin-reset:${user.userId}`);
  const target=await one(db,"SELECT a.email FROM identity_aliases l JOIN auth_user a ON a.id=l.subject WHERE l.provider='password' AND l.user_id=?",[text(input.userId,200)]);if(!target)throw new HttpError(404,'Essa pessoa ainda não configurou uma senha.');let resetToken='';
  await(await authForRequest(db,{captureReset:(_url,token)=>{resetToken=token;}})).api.requestPasswordReset({body:{email:target.email,redirectTo:`${origin}/redefinir-senha`}});
  if(!resetToken)throw new HttpError(409,'Não foi possível gerar o link de recuperação. Tente novamente.');await writeAudit(db,actor,'account.recovery-issued',text(input.userId,200));return Response.json({ok:true,resetUrl:`${origin}/redefinir-senha?token=${encodeURIComponent(resetToken)}`,expiresInMinutes:30},{headers:{'Cache-Control':'no-store'}});
 }
 throw new HttpError(400,'Operação de conta inválida.');
 }catch(e){if(e&&typeof e==='object'&&'statusCode'in e){const code=Number((e as {statusCode:unknown}).statusCode);return Response.json({error:code===429?'Aguarde antes de tentar novamente.':'Não foi possível validar a conta. Confira o e-mail, a senha e o link recebido.'},{status:code>=400&&code<500?code:400,headers:{'Cache-Control':'no-store'}});}return publicError(e);}}
