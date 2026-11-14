import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from './support/project-report-module.mjs';

const {emptyLoanFilters, isValidLoanFilterPeriod, loanMatches}=await load('lib/loan-list-filters.ts');
const day='2026-11-14';
const now=Date.parse(`${day}T12:00:00-03:00`);
const loan={state:'out',startsAt:`${day}T08:00:00-03:00`,endsAt:`${day}T11:00:00-03:00`,labels:['Projetor portátil','Ação da praça']};

test('loan search combines words from authorized labels and state separates active, returned and late loans',()=>{
  const match=loanMatches({...emptyLoanFilters,search:'PROJETOR praca',state:'overdue'},now);
  assert.equal(match(loan),true);
  assert.equal(match({...loan,state:'returned'}),false);
  assert.equal(match({...loan,endsAt:now+1}),false);
  assert.equal(match({...loan,labels:['Projetor portátil']}),false);
});

test('loan date filter uses overlap and an inclusive Brasília day',()=>{
  const sameDay={...emptyLoanFilters,from:day,to:day};
  assert.equal(isValidLoanFilterPeriod(sameDay),true);
  assert.equal(isValidLoanFilterPeriod({...sameDay,to:'2026-11-13'}),false);
  assert.equal(isValidLoanFilterPeriod({...sameDay,to:'2026-11-31'}),false);
  const match=loanMatches(sameDay,now);
  assert.equal(match(loan),true);
  assert.equal(match({...loan, startsAt:'2026-11-13T22:00:00-03:00',endsAt:`${day}T00:01:00-03:00`}),true);
  assert.equal(match({...loan, startsAt:'2026-11-13T22:00:00-03:00',endsAt:`${day}T00:00:00-03:00`}),false);
  assert.equal(match({...loan, startsAt:'2026-11-15T00:00:00-03:00',endsAt:'2026-11-15T01:00:00-03:00'}),false);
});
