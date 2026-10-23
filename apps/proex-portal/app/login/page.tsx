import LoginClient from '../login-client';
export const dynamic='force-dynamic';
export default async function Login({searchParams}:{searchParams:Promise<{returnTo?:string}>}){const p=await searchParams;return <LoginClient returnTo={p.returnTo||'/'}/>;}
