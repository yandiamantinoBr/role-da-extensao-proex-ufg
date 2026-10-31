'use client';
export const FOLLOWUP_CHANGED='proex:followup-changed';
export async function followupApi<T>(query:URLSearchParams|string,body?:Record<string,unknown>,signal?:AbortSignal):Promise<T>{const response=await fetch(`/api/follow-up${String(query)?`?${query}`:''}`,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',signal,...(body?{headers:{'Content-Type':'application/json','X-Proex-Action':'1'},body:JSON.stringify(body)}:{})});const data=await response.json().catch(()=>({})) as {error?:string|{message?:string}};if(!response.ok)throw new Error(typeof data.error==='string'?data.error:data.error?.message??'Não foi possível concluir. Preserve suas informações e tente novamente.');return data as T;}
export function followupChanged(){window.dispatchEvent(new Event(FOLLOWUP_CHANGED));}
export const todayInBrazil=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const dueLabel=(date:string|null)=>date?date.split('-').reverse().join('/'):'Sem prazo';
