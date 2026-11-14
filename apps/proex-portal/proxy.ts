import { NextResponse, type NextRequest } from 'next/server';
import { readInvitationCode } from './lib/invitation-link';

const invitationHeaders = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
};

export function proxy(request: NextRequest) {
  const { search, searchParams } = new URL(request.url);
  if (!searchParams.has('token')) return NextResponse.next({ headers: invitationHeaders });

  // The legacy address must be cleaned before rendering. Vinext includes the
  // request query in its navigation bootstrap even if the page ignores it.
  const code = readInvitationCode(search, '');
  const location = code ? `/convite#${new URLSearchParams({ token: code })}` : '/convite';
  return new Response(null, {
    status: 307,
    headers: { ...invitationHeaders, Location: location },
  });
}

export const config = { matcher: ['/convite'] };
