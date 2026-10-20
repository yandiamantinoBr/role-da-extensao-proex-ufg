import LoginClient from '../login-client';
export const dynamic='force-dynamic';
export default async function Invite({searchParams}:{searchParams:Promise<{token?:string}>}){const p=await searchParams;return <LoginClient mode="invite" token={p.token||''}/>;}
