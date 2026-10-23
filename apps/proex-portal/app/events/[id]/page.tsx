import {getPortalUser} from '@/lib/session';
import {HttpError} from '@/lib/errors';
import EventClient from './event-client';
import '../event.css';

export const dynamic = 'force-dynamic';
export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let user;try{user=await getPortalUser();}catch(error){if(!(error instanceof HttpError&&error.status===403))throw error;}
  return <EventClient key={id} eventId={id} signedIn={Boolean(user)} signInHref={`/login?returnTo=${encodeURIComponent(`/events/${id}`)}`} />;
}
