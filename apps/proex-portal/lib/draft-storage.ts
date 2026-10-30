export const DRAFT_PREFIX = 'proex:draft:v1:';
const LOGOUT_PREFIX = 'proex:draft:logout:';
export const PRIVATE_DRAFT_FIELD = /(password|senha|cpf|token|secret|setup|registrationnumber|borrower|contact|contato|email|phone|telefone)/i;

/** A stale tab cannot re-enable autosave after logout by rendering its cached user. */
export function createDraftScope() {
  let current = 'anon';
  const invalidated = new Set<string>();
  return {
    get current() { return current; },
    activate(userId: string) { current = userId && !invalidated.has(userId) ? userId : 'anon'; },
    invalidate(userId: string) {
      invalidated.add(userId);
      if (current === userId) current = 'anon';
    },
  };
}

type DraftStorage = Pick<Storage, 'length' | 'key' | 'removeItem'>;

/** Remove only this person's drafts, preserving theme and other preferences. */
export function clearDraftStorage(storage: DraftStorage, userId: string): void {
  const prefix = `${DRAFT_PREFIX}${userId}:`;
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}

export const draftLogoutKey = (userId: string) => `${LOGOUT_PREFIX}${userId}`;

/** A short-lived storage event also invalidates autosave in other open tabs. */
export function onDraftLogout(target: Pick<Window, 'addEventListener' | 'removeEventListener'>, userId: string, invalidate: () => void): () => void {
  const listener = (event: StorageEvent) => {
    if (event.key === draftLogoutKey(userId) && event.newValue !== null) invalidate();
  };
  target.addEventListener('storage', listener);
  return () => target.removeEventListener('storage', listener);
}
