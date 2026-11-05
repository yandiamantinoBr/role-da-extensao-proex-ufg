import { isCivilDate } from './civil-date';

/** Civil dates stay independent of the browser locale and UTC offsets. */
export function displayCivilDate(iso: string): string {
  return isCivilDate(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '';
}

export function parseBrazilianDate(text: string): string {
  const match = /^(\d{2})\/?(\d{2})\/?(\d{4})$/.exec(text.trim());
  if (!match) return '';
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  return isCivilDate(iso) ? iso : '';
}

export function calendarDate(iso: string): Date | undefined {
  if (!isCivilDate(iso)) return undefined;
  const date = new Date(0);
  date.setFullYear(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  date.setHours(12, 0, 0, 0);
  return date;
}

export function calendarCivilDate(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Empty editors open today, clamped to the allowed range, rather than at min. */
export function calendarOpeningDay(value: string, min?: string, max?: string, today = calendarCivilDate(new Date())): string {
  let day = isCivilDate(value) ? value : today;
  if (min && isCivilDate(min) && day < min) day = min;
  if (max && isCivilDate(max) && day > max) day = max;
  return day;
}

export function dateFieldError(text: string, min?: string, max?: string): string {
  if (!text.trim()) return '';
  const iso = parseBrazilianDate(text);
  if (!iso) return 'Informe uma data válida no formato dia/mês/ano.';
  if (min && isCivilDate(min) && iso < min) return `Escolha ${displayCivilDate(min)} ou uma data posterior.`;
  if (max && isCivilDate(max) && iso > max) return `Escolha ${displayCivilDate(max)} ou uma data anterior.`;
  return '';
}
