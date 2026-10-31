import {ParticipantAccess} from '../participant-client';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{returnTo?:string}>}){const input=await searchParams;const returnTo=typeof input.returnTo==='string'&&/^\/events\/[A-Za-z0-9._:-]{1,200}$/.test(input.returnTo)?input.returnTo:'/participante';return <ParticipantAccess returnTo={returnTo}/>;}
