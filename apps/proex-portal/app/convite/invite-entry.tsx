'use client';

import { useSyncExternalStore } from 'react';
import { readInvitationCode } from '../../lib/invitation-link';
import LoginClient from '../login-client';

function subscribe(callback: () => void) {
  window.addEventListener('hashchange', callback);
  window.addEventListener('popstate', callback);
  return () => {
    window.removeEventListener('hashchange', callback);
    window.removeEventListener('popstate', callback);
  };
}

function browserCode() {
  return readInvitationCode(window.location.search, window.location.hash);
}

export default function InviteEntry() {
  const token = useSyncExternalStore(subscribe, browserCode, () => null);
  return <LoginClient key={token ?? 'loading'} mode="invite" token={token} />;
}
