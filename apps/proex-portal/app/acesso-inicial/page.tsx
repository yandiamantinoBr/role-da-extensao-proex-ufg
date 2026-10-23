import {redirect} from 'next/navigation';
import LoginClient from '../login-client';
import {getChatGPTUser,chatGPTSignInPath} from '../chatgpt-auth';
import {isStandalone} from '@/lib/platform';
export const dynamic='force-dynamic';
export default async function Initial(){if(isStandalone())redirect('/configuracao-inicial');const user=await getChatGPTUser();return <LoginClient mode="initial" native={!!user} initialEmail={user?.email||''} nativeHref={chatGPTSignInPath('/acesso-inicial')}/>;}
