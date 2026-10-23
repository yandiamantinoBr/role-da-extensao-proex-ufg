import {env} from 'cloudflare:workers';
import {HttpError} from './errors';
type RuntimeVars=Record<string,string|undefined>;
const vars=()=>env as unknown as RuntimeVars;
export function database():D1Database{if(!env.DB)throw new HttpError(503,'O banco do portal ainda não está disponível.');return env.DB;}
export function bucket():R2Bucket{if(!env.BUCKET)throw new HttpError(503,'O armazenamento de anexos ainda não está disponível.');return env.BUCKET;}
export function ownerEmail():string|undefined{return vars().OWNER_EMAIL;}

export function inviteSecret():string|undefined{return vars().BETTER_AUTH_SECRET;}
/** Hospedagem própria (Cloudflare via GitHub). Nela não existe identidade nativa do Sites. */
export function isStandalone():boolean{return vars().PROEX_STANDALONE==='1';}
/** Segredo de uso único para criar o primeiro responsável fora do Sites. */
export function setupToken():string|undefined{const value=vars().SETUP_TOKEN;return value&&value.length>=24?value:undefined;}
