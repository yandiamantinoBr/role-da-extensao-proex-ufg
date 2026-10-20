import {env} from 'cloudflare:workers';
import {HttpError} from './errors';
export function database():D1Database{if(!env.DB)throw new HttpError(503,'O banco do portal ainda não está disponível.');return env.DB;}
export function bucket():R2Bucket{if(!env.BUCKET)throw new HttpError(503,'O armazenamento de anexos ainda não está disponível.');return env.BUCKET;}
export function ownerEmail():string|undefined{return (env as unknown as Record<string,string|undefined>).OWNER_EMAIL;}

export function inviteSecret():string|undefined{return (env as unknown as Record<string,string|undefined>).BETTER_AUTH_SECRET;}
