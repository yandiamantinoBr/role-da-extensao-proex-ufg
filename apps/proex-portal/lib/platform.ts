import {env} from 'cloudflare:workers';
import {HttpError} from './errors';
import type {SpeechEnvironment} from './assistant/settings';
import type {CredentialKeys} from './assistant/crypto';
type RuntimeVars=Record<string,string|undefined>;
const vars=()=>env as unknown as RuntimeVars;
export function database():D1Database{if(!env.DB)throw new HttpError(503,'O banco do portal ainda não está disponível.');return env.DB;}
export function bucket():R2Bucket{if(!env.BUCKET)throw new HttpError(503,'O armazenamento de anexos ainda não está disponível.');return env.BUCKET;}
/** Space used by the hosting database, when the runtime can measure it (Node + Postgres). Never throws. */
export async function storageUsage():Promise<{backend:string;databaseBytes:number|null;snapshotBytes:number|null;historyBytes:number|null;objectBytes:number|null}|null>{try{const measure=(env as unknown as Record<string,unknown>).PROEX_STORAGE_USAGE;return typeof measure==='function'?await (measure as ()=>Promise<never>)():null;}catch{return null;}}
export function ownerEmail():string|undefined{return vars().OWNER_EMAIL;}
/** Origem pública configurada do portal (BETTER_AUTH_URL), sem depender do cabeçalho Host do pedido. */
export function portalOrigin():string|undefined{try{const value=vars().BETTER_AUTH_URL;if(typeof value!=='string'||!value)return undefined;const url=new URL(value);return url.protocol==='https:'||url.hostname==='127.0.0.1'||url.hostname==='localhost'?url.origin:undefined;}catch{return undefined;}}

export function taskTriageEnabled():boolean{return vars().PROEX_JEV_TASK_TRIAGE==='1';}
export function inviteSecret():string|undefined{return vars().BETTER_AUTH_SECRET;}
export function assistantCredentialKeys():CredentialKeys{
 const values=vars();
 return {current:values.PROEX_KEYS_SECRET||undefined,previous:values.PROEX_KEYS_PREVIOUS_SECRET||undefined};
}
/** Server-only routing for a single opt-in organization. */
export function speechEnvironment():SpeechEnvironment {
 const values=vars();
 return {provider:values.PROEX_STT_PROVIDER,organizationId:values.PROEX_GROQ_STT_ORGANIZATION_ID,groqKey:values.GROQ_API_KEY};
}
/** Hospedagem própria (Cloudflare via GitHub). Nela não existe identidade nativa do Sites. */
export function isStandalone():boolean{return vars().PROEX_STANDALONE==='1';}
/** Segredo de uso único para criar o primeiro responsável fora do Sites. */
export function setupToken():string|undefined{const value=vars().SETUP_TOKEN;return value&&value.length>=24?value:undefined;}
/** Dedicated sender; values remain server-only and never belong in public responses/logs. */
export function participantEmailEnvironment(){const values=vars();return{provider:values.PUBLIC_PARTICIPANT_EMAIL_PROVIDER,apiKey:values.PUBLIC_PARTICIPANT_EMAIL_API_KEY,from:values.PUBLIC_PARTICIPANT_EMAIL_FROM,domainId:values.PUBLIC_PARTICIPANT_EMAIL_DOMAIN_ID,origin:values.BETTER_AUTH_URL};}
/** Google Drive por pessoa (docs/GOOGLE-DRIVE.md). O segredo do cliente fica só no servidor; id, chave do Picker e número do projeto são públicos por natureza. */
export function googleDriveEnvironment(){const values=vars();return{clientId:values.PROEX_GOOGLE_CLIENT_ID||undefined,clientSecret:values.PROEX_GOOGLE_CLIENT_SECRET||undefined,pickerApiKey:values.PROEX_GOOGLE_PICKER_API_KEY||undefined,appId:values.PROEX_GOOGLE_CLOUD_PROJECT_NUMBER||undefined,origin:portalOrigin()};}
