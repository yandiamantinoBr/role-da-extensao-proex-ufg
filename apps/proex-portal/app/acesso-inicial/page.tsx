import LoginClient from '../login-client';
import {getChatGPTUser,chatGPTSignInPath} from '../chatgpt-auth';
export const dynamic='force-dynamic';
export default async function Initial(){const user=await getChatGPTUser();return <LoginClient mode="initial" native={!!user} initialEmail={user?.email||''} nativeHref={chatGPTSignInPath('/acesso-inicial')}/>;}
