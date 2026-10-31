/** Current UFG operational dates use Brasília (UTC-03:00), independently of the browser. */
export function serverWorkClock(now=Date.now()) {return{asOf:new Date(now).toISOString(),today:new Date(now-3*60*60*1000).toISOString().slice(0,10)};}

/** A refresh hint from the portal response, never from the device's current clock. */
export function workDayFromServerTimestamp(value: unknown): string {
 if (typeof value !== 'string' || !value) return '';
 const date = new Date(value);
 if (!Number.isFinite(date.getTime())) return '';
 return new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'}).format(date);
}
