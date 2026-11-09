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

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
let sequence = 0;

async function load(userId: string) {
  if (!userId || loading === userId || (state.userId === userId && state.ready)) return;
  loading = userId;
  try {
    let saved = await call();
    let legacy: string[] = [];
    try { const raw = localStorage.getItem(legacyKey(userId)); const parsed = raw ? JSON.parse(raw) : []; legacy = Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string' && ID.test(id)) : []; } catch { /* navegador sem armazenamento */ }
    if (legacy.length) {
      // Se a importação falhar, a tela segue com o que já está na conta; a próxima carga tenta de novo.
      try { saved = await call({ action: 'import', projectPins: legacy.slice(0, 12) }); localStorage.removeItem(legacyKey(userId)); }
      catch { /* mantém os fixados antigos guardados para outra tentativa */ }
    }
    if (loading === userId) emit({ userId, ...saved, ready: true, error: '' });
  } catch (error) {
    // ready continua falso: ao voltar à página, uma nova tentativa acontece.
    if (loading === userId) emit({ ...EMPTY, userId, error: error instanceof Error ? error.message : 'Não foi possível carregar seus fixados.' });
  } finally { if (loading === userId) loading = null; }
}

/** Fixa ou desafixa; a tela muda na hora. Só a resposta mais recente vale, e uma recusa desfaz apenas este item. */
export async function setPinned(kind: PinKind, id: string, pinned: boolean): Promise<void> {
  const key = kind === 'project' ? 'projectPins' : 'teamPins', owner = state.userId, mine = ++sequence;
  const apply = (list: string[], on: boolean) => on ? [...list.filter(item => item !== id), id] : list.filter(item => item !== id);
  emit({ ...state, [key]: apply(state[key], pinned) });
  try {
    const saved = await call({ action: 'pin', kind, id, pinned });
    if (state.userId === owner && mine === sequence) emit({ ...state, ...saved, error: '' });
  } catch (error) {
    if (state.userId === owner) emit({ ...state, [key]: apply(state[key], !pinned) });
    throw error;
  }
}

export function usePinnedItems(userId: string): Snapshot {
  const snapshot = useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => state, () => EMPTY);
  useEffect(() => {
    if (!userId) return;
    void load(userId);
    // Depois de uma falha, tenta de novo quando a pessoa volta à janela (sem repetir em laço).
    const retry = () => { if (!(state.userId === userId && state.ready)) void load(userId); };
    window.addEventListener('focus', retry);
    return () => window.removeEventListener('focus', retry);
  }, [userId]);
  return snapshot.userId === userId ? snapshot : { ...EMPTY, userId };
}
