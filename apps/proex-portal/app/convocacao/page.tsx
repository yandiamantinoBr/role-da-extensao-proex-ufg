import type { Metadata } from 'next';
import ConvocationGuest from './convocation-client';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Confirmação de presença · PROEX UFG', robots: { index: false, follow: false }, referrer: 'no-referrer' };
// Public page. The invite (#c=…) and the personal link (#g=…) travel in the URL fragment, which the browser never sends to the server.
export default function Page() { return <ConvocationGuest/>; }
