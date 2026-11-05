'use client';

import { lazy, Suspense, useEffect, useId, useRef, useState, type InputHTMLAttributes } from 'react';
import { CalendarDays, X } from 'lucide-react';
import { Popover } from 'radix-ui';
import { isCivilDate } from '../../lib/civil-date';
import { calendarCivilDate, dateFieldError, displayCivilDate, parseBrazilianDate } from '../../lib/date-field';
import styles from './date-field.module.css';
const DateCalendar=lazy(()=>import('./date-calendar').catch(()=>({default:()=> <p role="alert" style={{padding:16}}>Calendário indisponível. Digite a data em dd/mm/aaaa no campo.</p>})));

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'onChange' | 'min' | 'max'> & {
  value?: string; defaultValue?: string; min?: string; max?: string;
  onValueChange?(iso: string): void;
};

/** A Portuguese civil-date editor; only the hidden ISO value is submitted or drafted. */
export default function DateField({ value, defaultValue = '', onValueChange, min, max, name, id, className, disabled, required, ...props }: Props) {
  const generatedId = useId(), inputId = id ?? `date-${generatedId}`, errorId = `${inputId}-error`;
  const initial = isCivilDate(defaultValue) ? defaultValue : '';
  const [local, setLocal] = useState(initial), [edit, setEdit] = useState<{ iso: string; text: string } | null>(null);
  const [open, setOpen] = useState(false), [touched, setTouched] = useState(false);
  const hidden = useRef<HTMLInputElement>(null), input = useRef<HTMLInputElement>(null);
  const iso = value === undefined ? local : isCivilDate(value) ? value : '';
  const text = edit?.iso === iso ? edit.text : displayCivilDate(iso);
  const error = dateFieldError(text, min, max);
  const label = props['aria-label'] ?? 'Data';
  const today = calendarCivilDate(new Date()), todayAllowed = (!min || today >= min) && (!max || today <= max);

  useEffect(() => { input.current?.setCustomValidity(error); }, [error]);
  useEffect(() => {
    const form = hidden.current?.form;
    if (!form || value !== undefined) return;
    const reset = () => queueMicrotask(() => { input.current?.setCustomValidity(dateFieldError(displayCivilDate(initial), min, max)); setLocal(initial); setEdit(null); setTouched(false); });
    form.addEventListener('reset', reset);
    return () => form.removeEventListener('reset', reset);
  }, [initial, value, min, max]);

  function commit(next: string, display = displayCivilDate(next)) {
    // Native validation can run in the same event turn as a change or requestSubmit.
    input.current?.setCustomValidity(dateFieldError(display, min, max));
    setLocal(next); setEdit({ iso: next, text: display }); onValueChange?.(next);
    // Synchronous canonical value makes the form's autosave see the selected day.
    if (hidden.current) {
      hidden.current.value = next;
      hidden.current.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  return <span className={styles.field}>
    <input ref={hidden} type="hidden" name={name} value={iso} disabled={disabled} data-draft-date="true" onInput={event => {
      // useFormDraft restores canonical values via native setters + input events.
      const next = isCivilDate(event.currentTarget.value) ? event.currentTarget.value : '';
      input.current?.setCustomValidity(dateFieldError(displayCivilDate(next), min, max));
      setLocal(next); setEdit(null); setTouched(false); onValueChange?.(next);
    }} />
    <span className={styles.control}>
      <input {...props} ref={input} id={inputId} type="text" lang="pt-BR" inputMode="numeric" autoComplete={props.autoComplete ?? 'off'}
        className={[className, styles.input].filter(Boolean).join(' ')} placeholder="dd/mm/aaaa" value={text} disabled={disabled} required={required}
        aria-invalid={touched && error ? true : props['aria-invalid']} aria-describedby={[props['aria-describedby'], touched && error ? errorId : ''].filter(Boolean).join(' ') || undefined}
        onChange={event => commit(parseBrazilianDate(event.target.value), event.target.value)}
        onBlur={event => { setTouched(true); if (parseBrazilianDate(text)) setEdit({ iso, text: displayCivilDate(iso) }); props.onBlur?.(event); }}
        onInvalid={event => { setTouched(true); props.onInvalid?.(event); }} />
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild><button type="button" className={styles.trigger} disabled={disabled || props.readOnly} aria-label={`Abrir calendário: ${label}`}><CalendarDays size={19} aria-hidden="true" /></button></Popover.Trigger>
        <Popover.Portal><Popover.Content className={styles.popover} align="end" sideOffset={6} collisionPadding={8} aria-label={`Escolher ${label.toLocaleLowerCase('pt-BR')}`}>
          <div className={styles.heading}><strong>Escolher data</strong><Popover.Close className={styles.close} aria-label="Fechar calendário"><X size={18} aria-hidden="true" /></Popover.Close></div>
          {open && <Suspense fallback={<p role="status" style={{minHeight:308,padding:16}}>Carregando calendário…</p>}><DateCalendar value={iso} min={min} max={max} onSelect={next=>{commit(next);setTouched(false);setOpen(false);}}/></Suspense>}
          <div className={styles.actions}><button type="button" disabled={!todayAllowed} onClick={() => { commit(today); setTouched(true); setOpen(false); }}>Hoje</button>
            {!required && <button type="button" onClick={() => { commit(''); setTouched(false); setOpen(false); }}>Limpar</button>}</div>
          <span className={styles.hint}>Dia/mês/ano · use as setas para navegar.</span>
        </Popover.Content></Popover.Portal>
      </Popover.Root>
    </span>
    {touched && error && <span id={errorId} className={styles.error} role="alert">{error}</span>}
  </span>;
}
