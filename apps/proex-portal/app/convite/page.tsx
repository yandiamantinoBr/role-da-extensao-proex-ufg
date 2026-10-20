import { getChatGPTUser, chatGPTSignInPath } from '@/app/chatgpt-auth';
import InviteClient from './invite-client';
import '../events/event.css';

export const dynamic = 'force-dynamic';
export default async function InvitationPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const query = await searchParams;
  const token = typeof query.token === 'string' && /^[A-Za-z0-9_-]{43,512}$/.test(query.token) ? query.token : '';
  const user = await getChatGPTUser();
  const returnTo = token ? `/convite?token=${encodeURIComponent(token)}` : '/convite';
  return <InviteClient token={token} signedIn={Boolean(user)} signInHref={chatGPTSignInPath(returnTo)} />;
}
