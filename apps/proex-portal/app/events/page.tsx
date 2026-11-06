import EventsIndex from '@/components/events/events-index';
import { database } from '@/lib/platform';
import { publicEvents } from '@/lib/public-events';
export const dynamic='force-dynamic';
export default async function EventsPage(){
 const rows=await publicEvents(database());
 return <EventsIndex initialEvents={rows.slice(0,500)} initialTruncated={rows.length>500}/>;
}
