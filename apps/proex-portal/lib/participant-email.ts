import { HttpError } from './errors';

export type ParticipantEmailEnvironment={provider?:string;apiKey?:string;from?:string;domainId?:string;origin?:string};
export type ParticipantSender={apiKey:string;from:string;domainId:string;domain:string;origin:string};
export async function digest(value:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
export function senderConfiguration(environment:ParticipantEmailEnvironment):ParticipantSender|null{
 if(environment.provider!=='resend'||!environment.apiKey||environment.apiKey.length<16||environment.apiKey.length>256||!environment.from||!environment.domainId||!/^[A-Za-z0-9-]{1,100}$/.test(environment.domainId))return null;
 const from=environment.from.trim().toLowerCase();if(from.length>254||!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(from))return null;
 let url:URL;try{url=new URL(environment.origin??'');}catch{return null;}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname))return null;
 return{apiKey:environment.apiKey,from,domainId:environment.domainId,domain:from.split('@')[1],origin:url.origin};
}
export const senderFingerprint=(sender:ParticipantSender)=>digest(JSON.stringify(['proex.public-sender.v1',sender.apiKey,sender.from,sender.domainId,sender.origin]));
/** Fixed official origin, no redirects, no user-selected host or DNS request. */
async function providerRequest(sender:ParticipantSender,path:string,init:RequestInit={}):Promise<Record<string,unknown>>{
 let response:Response;try{response=await fetch(`https://api.resend.com${path}`,{...init,redirect:'error',signal:AbortSignal.timeout(1500),headers:{Authorization:`Bearer ${sender.apiKey}`,...init.headers}});}catch{throw new HttpError(503,'O serviço de e-mail está indisponível. Tente novamente mais tarde.','participant_email_unavailable');}
 if(!response.ok)throw new HttpError(503,'O serviço de e-mail precisa de conferência administrativa.','participant_email_unavailable');
 const length=Number(response.headers.get('Content-Length')||0);if(length>32768)throw new HttpError(503,'Resposta de e-mail indisponível.','participant_email_unavailable');
 // Domain records are bounded before parsing; never return DNS records or provider errors.
 const reader=response.body?.getReader();let size=0,result='';if(!reader)throw new HttpError(503,'Resposta de e-mail indisponível.','participant_email_unavailable');
 const decoder=new TextDecoder();try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>32768){await reader.cancel();throw new Error('bounded');}result+=decoder.decode(next.value,{stream:true});}return JSON.parse(result) as Record<string,unknown>;}catch{throw new HttpError(503,'Resposta de e-mail indisponível.','participant_email_unavailable');}
}
export async function verifyParticipantSender(sender:ParticipantSender){
 const data=await providerRequest(sender,`/domains/${encodeURIComponent(sender.domainId)}`),capabilities=data.capabilities as {sending?:unknown}|undefined;
 if(data.id!==sender.domainId||data.name!==sender.domain||data.status!=='verified'||capabilities?.sending!=='enabled'||data.open_tracking!==false||data.click_tracking!==false)throw new HttpError(503,'Confirme o domínio remetente, habilite o envio e desative rastreamento de abertura/cliques no provedor.','participant_sender_unverified');
 return{domain:sender.domain,fingerprint:await senderFingerprint(sender),verifiedAt:Date.now()};
}
/** Invoked only by the explicit same-origin human registration/recovery HTTP action. */
export async function sendParticipantEmail(sender:ParticipantSender,input:{email:string;token:string;challengeId:string;purpose:'signup'|'recovery'}){
 const link=`${sender.origin}/participante/confirmar#token=${encodeURIComponent(input.token)}`;
 const text=`${input.purpose==='signup'?'Confirme seu e-mail para criar uma conta de participante.':'Confirme seu e-mail para recuperar sua conta de participante.'}\n\n${link}\n\nO link é pessoal, expira em 15 minutos e só pode ser usado uma vez. Esta conta não concede acesso à equipe ou a projetos internos. Se você não fez o pedido, ignore esta mensagem.`;
 const data=await providerRequest(sender,'/emails',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':`participant/${input.challengeId}`},body:JSON.stringify({from:sender.from,to:[input.email],subject:input.purpose==='signup'?'Confirme sua conta de participante · PROEX':'Recupere sua conta de participante · PROEX',text})});
 if(typeof data.id!=='string')throw new HttpError(503,'Não foi possível confirmar o envio.','participant_email_unavailable');
}
