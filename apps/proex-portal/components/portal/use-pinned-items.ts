'use client';
import { useEffect, useSyncExternalStore } from 'react';

/*
 * Projetos e equipes fixados, salvos na conta (0038) e compartilhados entre o menu lateral,
 * Projetos e Equipes. Os fixados antigos, que ficavam só neste navegador, são trazidos uma vez.
 */
export type PinKind = 'project' | 'team';
export type PinnedTeam = { id: string; name: string; organizationId: string };
type Snapshot = { userId: string; projectPins: string[]; teamPins: string[]; teams: PinnedTeam[]; ready: boolean; error: string };
const EMPTY: Snapshot = { userId: '', projectPins: [], teamPins: [], teams: [], ready: false, error: '' };
let state: Snapshot = EMPTY;
let loading: string | null = null;
const listeners = new Set<() => void>();
const emit = (next: Snapshot) => { state = next; listeners.forEach(listener => listener()); };
const legacyKey = (userId: string) => `proex:project-pins:v1:${encodeURIComponent(userId)}`;

async function call(body?: Record<string, unknown>): Promise<{ projectPins: string[]; teamPins: string[]; teams: PinnedTeam[] }> {
  const response = await fetch('/api/preferences', body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify(body) } : { cache: 'no-store' });
  const data = await response.json().catch(() => null) as { projectPins?: string[]; teamPins?: string[]; teams?: PinnedTeam[]; error?: string } | null;
  if (!response.ok || !data) throw new Error(data?.error || 'Não foi possível salvar seus fixados agora.');
  return { projectPins: data.projectPins ?? [], teamPins: data.teamPins ?? [], teams: data.teams ?? [] };
}

async function load(userId: string) {
  if (!userId || loading === userId || (state.userId === userId && state.ready)) return;
  loading = userId;
  try {
    let saved = await call();
    let legacy: string[] = [];
    try { const raw = localStorage.getItem(legacyKey(userId)); const parsed = raw ? JSON.parse(raw) : []; legacy = Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []; } catch { /* navegador sem armazenamento */ }
    if (legacy.length) {
      saved = await call({ action: 'import', projectPins: legacy.slice(0, 12) });
      try { localStorage.removeItem(legacyKey(userId)); } catch { /* manter não causa duplicidade: a importação une as listas */ }
    }
    if (loading === userId) emit({ userId, ...saved, ready: true, error: '' });
  } catch (error) {
    if (loading === userId) emit({ ...EMPTY, userId, ready: true, error: error instanceof Error ? error.message : 'Não foi possível carregar seus fixados.' });
  } finally { if (loading === userId) loading = null; }
}

/** Fixa ou desafixa; a tela muda na hora e volta atrás se o servidor recusar. */
export async function setPinned(kind: PinKind, id: string, pinned: boolean): Promise<void> {
  const key = kind === 'project' ? 'projectPins' : 'teamPins', before = state;
  const list = state[key].filter(item => item !== id);
  if (pinned && list.length >= 12) throw new Error(`Você pode fixar até 12 ${kind === 'project' ? 'projetos' : 'equipes'}. Remova um para incluir outro.`);
  emit({ ...state, [key]: pinned ? [...list, id] : list });
  try { const saved = await call({ action: 'pin', kind, id, pinned }); if (state.userId === before.userId) emit({ ...state, ...saved, error: '' }); }
  catch (error) { if (state.userId === before.userId) emit(before); throw error; }
}

export function usePinnedItems(userId: string): Snapshot {
  const snapshot = useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => state, () => EMPTY);
  useEffect(() => { if (userId) void load(userId); }, [userId]);
  return snapshot.userId === userId ? snapshot : { ...EMPTY, userId };
}
