import {redirect} from 'next/navigation';
import LoginClient from '../login-client';
import {database,setupToken} from '@/lib/platform';
import {ownerExists} from '@/lib/owner-setup';
export const dynamic='force-dynamic';
export default async function OwnerSetup(){if(!setupToken()||await ownerExists(database()))redirect('/login');return <LoginClient mode="setup" firstAccess={null}/>;}
