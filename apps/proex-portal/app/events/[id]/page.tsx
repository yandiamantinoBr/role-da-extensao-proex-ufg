import { getChatGPTUser, chatGPTSignInPath } from '@/app/chatgpt-auth';
import EventClient from './event-client';
import '../event.css';

export const dynamic = 'force-dynamic';
export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getChatGPTUser();
  return <EventClient key={id} eventId={id} signedIn={Boolean(user)} signInHref={chatGPTSignInPath(`/events/${encodeURIComponent(id)}`)} />;
}
