'use client';
import { useSyncExternalStore } from 'react';
import { chapterById } from '@/lib/tutorials/catalog';
import type { TutorialWorkspace } from '@/lib/tutorials/service';

/*
 * Estado dos tutoriais na tela, compartilhado entre o convite do Início, o menu da conta, o "Mais" do
 * celular, a Conta e o cartão guiado. A verdade sobre o acesso vem do servidor (GET /api/tutorials),
 * consultado ao abrir e a cada troca de projeto. Só o progresso pessoal é gravado; nenhum passo
 * chama rotas de trabalho.
 */
export type TutorialUiState = {
  data: TutorialWorkspace | null;
  loading: boolean;
  error: string;
  projectId: string;
  /** Capítulo em andamento e índice do passo no capítulo. */
  active: { chapterId: string; index: number } | null;
  chooser: boolean;
  /** Aviso curto no cartão (ex.: um passo saiu porque o acesso mudou). */
  notice: string;
};

let state: TutorialUiState = { data: null, loading: false, error: '', projectId: '', active: null, chooser: false, notice: '' };
const listeners = new Set<() => void>();
let generation = 0;
let opener: HTMLElement | null = null;

function set(next: Partial<TutorialUiState>) { state = { ...state, ...next }; listeners.forEach(listener => listener()); }
export const getTutorialState = () => state;
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function useTutorials(): TutorialUiState { return useSyncExternalStore(subscribe, getTutorialState, getTutorialState); }

async function request(method: 'GET' | 'POST', body?: Record<string, unknown>): Promise<TutorialWorkspace> {
  const url = method === 'GET' ? `/api/tutorials?${new URLSearchParams(state.projectId ? { projectId: state.projectId } : {})}` : '/api/tutorials';
  const response = await fetch(url, method === 'GET' ? { cache: 'no-store', credentials: 'same-origin' }
    : { method, cache: 'no-store', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Proex-Action': '1' }, body: JSON.stringify({ ...body, projectId: state.projectId }) });
  const json = await response.json().catch(() => null) as (TutorialWorkspace & { error?: unknown }) | null;
  if (!response.ok || !json || !Array.isArray(json.chapters)) {
    const detail = json && typeof json.error === 'object' && json.error && 'message' in json.error ? String((json.error as { message: unknown }).message) : typeof json?.error === 'string' ? json.error : '';
    const error = new Error(detail || 'Não foi possível abrir os tutoriais agora.') as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return json;
}

/** Passo atual ainda permitido? Senão, o próximo permitido (ou o anterior, se não houver próximo). */
function reconcile(data: TutorialWorkspace) {
  if (!state.active) return;
  const chapter = data.chapters.find(entry => entry.id === state.active!.chapterId);
  if (!chapter) { set({ active: null }); return; }
  if (chapter.steps[state.active.index]?.available) return;
  const after = chapter.steps.findIndex((step, index) => index > state.active!.index && step.available);
  const before = [...chapter.steps.keys()].reverse().find(index => index < state.active!.index && chapter.steps[index].available);
  const index = after >= 0 ? after : before ?? -1;
  if (index < 0) { set({ active: null, notice: '' }); return; }
  set({ active: { chapterId: chapter.id, index }, notice: 'Seu acesso mudou e um passo saiu do percurso.' });
}

/** Consulta o acesso e o progresso. Chamado ao montar, ao abrir a ajuda e quando o projeto muda. */
export async function loadTutorials(projectId = state.projectId) {
  const mine = ++generation;
  set({ projectId, loading: true, error: '' });
  try {
    const data = await request('GET');
    if (mine !== generation) return;
    set({ data, loading: false });
    reconcile(data);
  } catch (error) {
    if (mine !== generation) return;
    const status = (error as { status?: number }).status;
    // Conta revogada ou sessão encerrada: o tutorial fecha e não mostra nada da conta anterior.
    set({ loading: false, error: error instanceof Error ? error.message : 'Não foi possível abrir os tutoriais agora.', ...(status === 401 || status === 403 ? { data: null, active: null } : {}) });
  }
}

// Gravações em fila: uma de cada vez, na ordem dos cliques (o ponto de parada nunca volta um passo).
let queue: Promise<void> = Promise.resolve();
function save(body: Record<string, unknown>): Promise<void> {
  queue = queue.then(() => send(body));
  return queue;
}
async function send(body: Record<string, unknown>) {
  try { const data = await request('POST', body); set({ data }); reconcile(data); }
  catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 401 || status === 403) { set({ data: null, active: null, chooser: false, error: error instanceof Error ? error.message : '' }); return; }
    if (status === 409) { await loadTutorials(); return; }
    set({ notice: 'Não consegui salvar onde você parou. O tutorial continua funcionando.' });
  }
}

function rememberOpener() {
  const element = typeof document !== 'undefined' ? document.activeElement : null;
  opener = element instanceof HTMLElement && element !== document.body ? element : null;
}
export function restoreFocus() {
  const target = opener;
  opener = null;
  if (target && target.isConnected) target.focus({ preventScroll: true });
  else document.getElementById('main')?.focus({ preventScroll: true });
}

export function openTutorialChooser() {
  rememberOpener();
  set({ chooser: true, notice: '' });
  void loadTutorials();
}
export function closeTutorialChooser(returnFocus = true) {
  set({ chooser: false });
  if (returnFocus) restoreFocus();
}

/** Abre um capítulo: retoma de onde parou (ou do começo, se terminou), ou recomeça quando pedido. */
export async function startChapter(chapterId: string, options: { restart?: boolean } = {}) {
  if (!state.chooser) rememberOpener();
  if (!state.data) await loadTutorials();
  const data = state.data, chapter = data?.chapters.find(entry => entry.id === chapterId);
  if (!data || !chapter || !chapterById(chapterId)) { set({ chooser: false }); return; }
  const first = chapter.steps.findIndex(step => step.available);
  const index = options.restart ? first : chapter.resumeAt >= 0 ? chapter.resumeAt : first;
  if (index < 0) { set({ notice: 'Este assunto não tem passos para o seu acesso agora.' }); return; }
  set({ chooser: false, active: { chapterId, index }, notice: '' });
  if (options.restart) await save({ action: 'progress.restart', chapterId });
  await save({ action: 'progress.save', chapterId, stepId: chapterById(chapterId)!.steps[index].id, status: 'in_progress' });
}

function move(direction: 1 | -1) {
  const active = state.active, chapter = active && state.data?.chapters.find(entry => entry.id === active.chapterId);
  if (!active || !chapter) return;
  let index = active.index + direction;
  while (index >= 0 && index < chapter.steps.length && !chapter.steps[index].available) index += direction;
  if (index < 0 || index >= chapter.steps.length) return;
  set({ active: { chapterId: active.chapterId, index }, notice: '' });
  const last = !chapter.steps.slice(index + 1).some(step => step.available);
  void save({ action: 'progress.save', chapterId: active.chapterId, stepId: chapterById(active.chapterId)!.steps[index].id, status: last ? 'completed' : 'in_progress' });
}
export const nextStep = () => move(1);
export const previousStep = () => move(-1);

/** Pausar e Sair guardam o ponto para Retomar depois. */
export function pauseTutorial() {
  const active = state.active;
  if (!active) return;
  const chapter = chapterById(active.chapterId)!, data = state.data?.chapters.find(entry => entry.id === active.chapterId);
  const completed = data ? !data.steps.slice(active.index + 1).some(step => step.available) : false;
  set({ active: null, notice: '' });
  if (!completed) void save({ action: 'progress.save', chapterId: active.chapterId, stepId: chapter.steps[active.index].id, status: 'paused' });
  restoreFocus();
}
export function finishTutorial(then?: 'repeat' | 'chooser') {
  const active = state.active;
  set({ active: null, notice: '' });
  // Garante a conclusão mesmo se a gravação ao chegar no último passo tiver falhado.
  if (active) void save({ action: 'progress.save', chapterId: active.chapterId, stepId: chapterById(active.chapterId)!.steps[active.index].id, status: 'completed' });
  if (then === 'repeat' && active) { void startChapter(active.chapterId, { restart: true }); return; }
  if (then === 'chooser') { set({ chooser: true }); void loadTutorials(); return; }
  restoreFocus();
}

export async function answerInvite(choice: 'tour' | 'choose' | 'later') {
  rememberOpener();
  await save({ action: choice === 'later' ? 'invite.dismiss' : 'invite.start' });
  if (choice === 'tour') await startChapter('navegacao');
  if (choice === 'choose') { set({ chooser: true }); }
}
