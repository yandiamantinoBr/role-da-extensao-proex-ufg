import { readReportArrival } from './report-links';

export type PortalSearchParams = Record<string, string | string[] | undefined>;

const portalFields = [
  'module', 'project', 'unit', 'area', 'demandId', 'report', 'view', 'scheduleItemId',
  'workStatus', 'organizationId', 'history', 'detailProject', 'itemId', 'loanId',
  'campaignId', 'teamId', 'destinationId', 'convocation',
] as const;
const routeValue = (value: string) => value.length <= 200 && /^[A-Za-z0-9_]/.test(value) && !/[^A-Za-z0-9._:-]/.test(value);

/** Only carry dashboard navigation through login. Access is still checked on arrival. */
function portalDestination(read: (field: string) => string | null | undefined): string {
  const params = new URLSearchParams();
  for (const field of portalFields) {
    const value = read(field);
    if (value && routeValue(value)) params.set(field, value);
  }
  if (params.get('module') === 'reports' && read('recorte') === '1') {
    const recorte = new URLSearchParams({module:'reports', recorte:'1', from:read('from') ?? '', to:read('to') ?? '', q:read('q') ?? ''});
    const arrival = readReportArrival(recorte);
    if (arrival) {
      params.set('recorte', '1');
      if (arrival.from) params.set('from', arrival.from);
      if (arrival.to) params.set('to', arrival.to);
      if (arrival.search) params.set('q', arrival.search);
    }
  }
  const query = params.toString();
  return query ? `/?${query}` : '/';
}

export function dashboardLoginDestination(searchParams: PortalSearchParams): string {
  return portalDestination(field => {
    const value = searchParams[field];
    return Array.isArray(value) ? value[0] : value;
  });
}

export function loginHref(destination: string): string {
  return destination === '/' ? '/login' : `/login?${new URLSearchParams({ returnTo: destination })}`;
}

export function safeLoginDestination(value: unknown): string {
  if (typeof value !== 'string' || value.length > 6000) return '/';
  if (value.startsWith('/?')) {
    const params = new URLSearchParams(value.slice(2));
    return portalDestination(field => params.get(field));
  }
  if (value === '/participante' || value === '/events' || (value.startsWith('/events/') && routeValue(value.slice('/events/'.length)))) {
    return value;
  }
  return '/';
}
