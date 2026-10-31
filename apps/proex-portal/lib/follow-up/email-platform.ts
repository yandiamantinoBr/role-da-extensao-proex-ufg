import {env} from 'cloudflare:workers';
/** Only the server-configured public origin is passed to message composition. */
export function followupEmailOrigin():unknown{return(env as unknown as {BETTER_AUTH_URL?:unknown}).BETTER_AUTH_URL;}
