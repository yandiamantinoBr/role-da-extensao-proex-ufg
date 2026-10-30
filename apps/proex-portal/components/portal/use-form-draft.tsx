'use client';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { History, Trash2 } from 'lucide-react';
import { DRAFT_PREFIX, PRIVATE_DRAFT_FIELD, clearDraftStorage, createDraftScope, draftLogoutKey, onDraftLogout } from '../../lib/draft-storage';

// Rascunho automático de formulários. Guarda os campos no próprio navegador enquanto a
// pessoa digita, restaura ao reabrir o formulário e apaga depois de salvar com sucesso.
// Funciona com campos controlados (React) e não controlados: a restauração usa os
// setters nativos e dispara os mesmos eventos de digitação. Senhas, CPF, tokens e
// arquivos nunca são guardados. O rascunho fica separado por pessoa (veja setDraftScope).
type Values = Record<string, string | boolean | string[]>;
type Stored = { savedAt: string; values: Values };
const PREFIX = DRAFT_PREFIX;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const PRIVATE = PRIVATE_DRAFT_FIELD;
const draftScope = createDraftScope();
/** Chamado pelo portal com o identificador da pessoa conectada. */
export function setDraftScope(userId: string) { draftScope.activate(userId); }

/** Keep logout invalidation active even while no draft form is mounted. */
export function watchDraftLogout(userId: string) {
  return onDraftLogout(window, userId, () => {
    draftScope.invalidate(userId);
    try { clearDraftStorage(localStorage, userId); } catch { /* storage may be disabled */ }
  });
}

/** A completed logout must not leave form drafts on a shared computer. */
export function clearCurrentDrafts() {
  const scope = draftScope.current;
  draftScope.invalidate(scope);
  try {
    clearDraftStorage(localStorage, scope);
    const key = draftLogoutKey(scope);
    localStorage.setItem(key, 'logout');
    localStorage.removeItem(key);
  } catch { /* restricted browser storage must not block logout */ }
}

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
function fields(form: HTMLFormElement): Field[] {
  return ([...form.elements] as Element[]).filter(el => (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)
    && !!el.name && !PRIVATE.test(el.name) && !(el instanceof HTMLInputElement && ['password', 'file', 'hidden', 'submit', 'button', 'reset'].includes(el.type))) as Field[];
}
function read(form: HTMLFormElement): Values {
  const values: Values = {};
  for (const el of fields(form)) {
    if (el instanceof HTMLInputElement && el.type === 'checkbox') values[el.name] = el.checked;
    else if (el instanceof HTMLInputElement && el.type === 'radio') { if (el.checked) values[el.name] = el.value; }
    else if (el instanceof HTMLSelectElement && el.multiple) values[el.name] = [...el.selectedOptions].map(option => option.value);
    else values[el.name] = el.value;
  }
  return values;
}
function setNative(el: Field, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
}
function apply(form: HTMLFormElement, values: Values) {
  for (const el of fields(form)) {
    if (!(el.name in values)) continue;
    const value = values[el.name];
    if (el instanceof HTMLInputElement && el.type === 'checkbox') { if (el.checked !== value) el.click(); }
    else if (el instanceof HTMLInputElement && el.type === 'radio') { if (el.value === value && !el.checked) el.click(); }
    else if (el instanceof HTMLSelectElement && el.multiple && Array.isArray(value)) { for (const option of el.options) option.selected = value.includes(option.value); el.dispatchEvent(new Event('change', { bubbles: true })); }
    else if (typeof value === 'string' && el.value !== value && (!(el instanceof HTMLSelectElement) || [...el.options].some(option => option.value === value))) setNative(el, value);
  }
}
const same = (a: Values, b: Values) => JSON.stringify(a) === JSON.stringify(b);
const storageKey = (key: string) => `${PREFIX}${draftScope.current}:${key}`;
function load(key: string): Stored | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(key)) || 'null') as Stored | null;
    if (!parsed || Date.now() - Date.parse(parsed.savedAt) > MAX_AGE_MS) return null;
    return parsed;
  } catch { return null; }
}

export type FormDraft = { savedAt: string | null; restored: boolean; clear(): void; discard(): void };
/**
 * `key` identifica o formulário e o registro (ex.: `project:<id>:<versão>`); `null` desliga.
 * Chame `clear()` depois de salvar com sucesso.
 */
export function useFormDraft(formRef: RefObject<HTMLFormElement | null>, key: string | null): FormDraft {
  const [savedAt, setSavedAt] = useState<string | null>(null), [restored, setRestored] = useState(false);
  const baseline = useRef<Values | null>(null), timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const form = formRef.current;
    if (!form || !key) return;
    const formScope = draftScope.current;
    if (formScope === 'anon') return;
    const stopLogoutListener = onDraftLogout(window, formScope, () => {
      draftScope.invalidate(formScope);
      window.clearTimeout(timer.current);
      try { clearDraftStorage(localStorage, formScope); } catch { /* storage may be disabled */ }
      setSavedAt(null); setRestored(false);
    });
    // Espera o primeiro render preencher os valores iniciais antes de restaurar.
    const start = window.setTimeout(() => {
      if (draftScope.current !== formScope) return;
      baseline.current = read(form);
      const stored = load(key);
      if (stored && !same(stored.values, baseline.current)) { apply(form, stored.values); setSavedAt(stored.savedAt); setRestored(true); }
    }, 0);
    const save = () => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        if (!baseline.current || draftScope.current !== formScope) return;
        const values = read(form);
        try {
          if (same(values, baseline.current)) { localStorage.removeItem(storageKey(key)); setSavedAt(null); return; }
          const savedNow = new Date().toISOString();
          localStorage.setItem(storageKey(key), JSON.stringify({ savedAt: savedNow, values } satisfies Stored));
          setSavedAt(savedNow);
        } catch { /* navegador sem armazenamento local: segue sem rascunho */ }
      }, 600);
    };
    form.addEventListener('input', save);
    form.addEventListener('change', save);
    return () => { stopLogoutListener(); window.clearTimeout(start); window.clearTimeout(timer.current); form.removeEventListener('input', save); form.removeEventListener('change', save); };
  }, [formRef, key]);
  const clear = useCallback(() => {
    window.clearTimeout(timer.current);
    if (key) try { localStorage.removeItem(storageKey(key)); } catch { /* sem armazenamento */ }
    if (formRef.current) baseline.current = read(formRef.current);
    setSavedAt(null); setRestored(false);
  }, [formRef, key]);
  const discard = useCallback(() => {
    const form = formRef.current, initial = baseline.current;
    clear();
    if (form && initial) { apply(form, initial); baseline.current = initial; }
  }, [clear, formRef]);
  return { savedAt, restored, clear, discard };
}

const hour = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
export function DraftNotice({ draft }: { draft: FormDraft }) {
  if (!draft.savedAt) return null;
  return <p className="p-draft-notice" role="status">
    <History size={15} aria-hidden="true" />
    <span>{draft.restored ? `Rascunho restaurado (salvo em ${hour(draft.savedAt)}).` : `Rascunho salvo automaticamente às ${hour(draft.savedAt).split(' ')[1] ?? hour(draft.savedAt)}.`} Ele fica só neste navegador até você salvar ou sair.</span>
    <button type="button" className="p-text-link" onClick={draft.discard}><Trash2 size={14} aria-hidden="true" />Descartar rascunho</button>
  </p>;
}
