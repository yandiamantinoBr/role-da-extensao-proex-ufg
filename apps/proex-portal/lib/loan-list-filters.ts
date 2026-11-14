import { isCivilDate } from './civil-date';
import { listSearch } from './list-search';

export const loanStates = { all:'Todas as situações', reserved:'Reservado', out:'Retirado', overdue:'Em atraso', returned:'Devolvido', cancelled:'Cancelado' };
export type LoanStateFilter = keyof typeof loanStates;
export type LoanListFilters = { search:string; state:LoanStateFilter; from:string; to:string };
export const emptyLoanFilters: LoanListFilters = { search:'', state:'all', from:'', to:'' };

export function isValidLoanFilterPeriod({from,to}: LoanListFilters): boolean {
  return (!from || isCivilDate(from)) && (!to || isCivilDate(to)) && (!from || !to || from <= to);
}

type LoanInput = { state:string; startsAt:string|number|null; endsAt:string|number|null; labels:readonly (string|null|undefined)[] };
function timestamp(value: LoanInput['startsAt']): number {
  return value === null || value === '' ? NaN : new Date(value).getTime();
}
export function isOverdueLoan(state: string, endsAt: LoanInput['endsAt'], now: number): boolean {
  return state === 'out' && timestamp(endsAt) < now;
}

export function loanMatches(filters: LoanListFilters, now: number): (loan: LoanInput) => boolean {
  const matches = listSearch(filters.search);
  const start = filters.from ? Date.parse(`${filters.from}T00:00:00-03:00`) : null;
  const end = filters.to ? Date.parse(`${filters.to}T00:00:00-03:00`) + 86400000 : null;
  return loan => {
    const matchingState = filters.state === 'overdue' ? isOverdueLoan(loan.state,loan.endsAt,now)
      : filters.state === 'all' || filters.state === loan.state;
    return matchingState && matches(loan.labels)
      && (start === null || timestamp(loan.endsAt) > start)
      && (end === null || timestamp(loan.startsAt) < end);
  };
}
