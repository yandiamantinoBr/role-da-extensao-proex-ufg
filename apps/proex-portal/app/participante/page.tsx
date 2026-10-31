import {redirect} from 'next/navigation';
import {getPortalUser} from '@/lib/session';
import {ParticipantHome} from './participant-client';
export const dynamic='force-dynamic';
export default async function Page(){if(!await getPortalUser())redirect('/participante/acesso');return <ParticipantHome/>;}
