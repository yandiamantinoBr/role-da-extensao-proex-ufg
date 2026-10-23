import LoginClient from '../login-client';
export const dynamic='force-dynamic';
export default async function Reset({searchParams}:{searchParams:Promise<{token?:string}>}){const p=await searchParams;return <LoginClient mode="reset" token={p.token||''}/>;}
