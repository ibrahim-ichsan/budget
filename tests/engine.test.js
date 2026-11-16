// One test per row of Permutation Tables A to F in the PRD. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/engine.js';

const base = () => ({
  base: 'EUR', rates: { IDR: 1, EUR: 20000, GBP: 24000 }, anchorDay: 1, overrides: {},
  framework: 'Std', frameworks: [{ name: 'Std', needs: 0.5, wants: 0.3, savings: 0.2, giving: 0 }],
  accounts: [
    { id: 'bank', name: 'Main Bank', type: 'Bank', ccy: 'IDR', opening: 1000000 },
    { id: 'wallet', name: 'E-Wallet', type: 'E-Wallet', ccy: 'IDR', opening: 0 },
    { id: 'eur', name: 'Euro Account', type: 'Bank', ccy: 'EUR', opening: 100 },
    { id: 'gbp', name: 'Pound Account', type: 'Valas', ccy: 'GBP', opening: 0 },
    { id: 'card', name: 'Card One', type: 'Credit Card', ccy: 'IDR', opening: 0, limit: 20000000 },
    { id: 'cardA', name: 'Card A', type: 'Credit Card', ccy: 'IDR', opening: -9000000, group: 'g1' },
    { id: 'cardB', name: 'Card B', type: 'Credit Card', ccy: 'IDR', opening: -8000000, group: 'g1' },
    { id: 'cardN', name: 'Card No Limit', type: 'Credit Card', ccy: 'IDR', opening: -5 },
  ],
  groups: [{ id: 'g1', name: 'Group', limit: 30000000 }],
  categories: [
    { id: 'sal', name: 'Salary', type: 'Income', tier: 'Income' },
    { id: 'food', name: 'Food', type: 'Expense', tier: 'Needs' },
    { id: 'fun', name: 'Fun', type: 'Expense', tier: 'Wants' },
    { id: 'fee', name: 'Admin Fee', type: 'Expense', tier: 'Needs' },
    { id: 'tr', name: 'Transfer', type: 'Transfer', tier: 'Transfer' },
    { id: 'ccp', name: 'Credit Card Payment', type: 'Transfer', tier: 'Transfer' },
  ],
  budgets: { default: {} }, tx: [], plans: [],
});
const near = (a, b, eps = 0.005) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

// ---- Table A ----
test('A1 IDR expense: rate 1', () => {
  const r = E.resolveAmount(base(), { ccy: 'IDR', amt: -85000 });
  assert.equal(r.rate, 1); assert.equal(r.idr, -85000);
});
test('A2 EUR expense, no billed: Rate Table', () => {
  const r = E.resolveAmount(base(), { ccy: 'EUR', amt: -10 });
  assert.equal(r.rate, 20000); assert.equal(r.idr, -200000);
});
test('A3 EUR expense with Billed IDR: effective rate', () => {
  const r = E.resolveAmount(base(), { ccy: 'EUR', amt: -10, billed: -203500 });
  assert.equal(r.rate, 20350); assert.equal(r.idr, -203500);
});
test('A4 Billed IDR only', () => {
  const r = E.resolveAmount(base(), { ccy: 'EUR', amt: null, billed: -203500 });
  assert.equal(r.rate, null); assert.equal(r.idr, -203500);
});
test('A5 Billed IDR added later changes rate and amount', () => {
  const s = base(); const tx = { ccy: 'EUR', amt: -10, billed: null };
  assert.equal(E.resolveAmount(s, tx).idr, -200000);
  tx.billed = -203500;
  assert.equal(E.resolveAmount(s, tx).rate, 20350); assert.equal(E.resolveAmount(s, tx).idr, -203500);
});
test('A6 nothing typed: zero, nothing to save', () => {
  assert.equal(E.resolveAmount(base(), { ccy: 'EUR', amt: null, billed: null }).idr, 0);
});
test('A imported row with different signs is flagged', () => {
  assert.equal(E.signCheck({ amt: -10, billed: 203500 }), true);
  assert.equal(E.signCheck({ amt: -10, billed: -203500 }), false);
});
test('A rate change moves Rate Table rows only, not rows with Billed IDR', () => {
  const s = base();
  const a = { ccy: 'EUR', amt: -10 }, b = { ccy: 'EUR', amt: -10, billed: -203500 };
  s.rates.EUR = 21000;
  assert.equal(E.resolveAmount(s, a).idr, -210000); assert.equal(E.resolveAmount(s, b).idr, -203500);
});

// ---- Table B ----
test('B1-B2 income raises, expense lowers balance, budget and net worth', () => {
  const s = base();
  const nw0 = E.netWorth(s).total;
  s.tx.push({ id: 1, date: '2026-08-05', type: 'Income', cat: 'sal', acct: 'bank', ccy: 'IDR', amt: 500000 });
  s.tx.push({ id: 2, date: '2026-08-06', type: 'Expense', cat: 'food', acct: 'bank', ccy: 'IDR', amt: -200000 });
  const bank = E.balances(s).find((b) => b.id === 'bank');
  assert.equal(bank.native, 1300000);
  near(E.netWorth(s).total - nw0, 300000);
  const rep = E.cycleReport(s, E.cycle(s, 2026, 8));
  near(rep.totalIncome, 25); near(rep.totalExpense, 10);
});
test('B3-B4 transfer legs move balances, not budget, not net worth', () => {
  const s = base(); let n = 0; const id = () => `t${++n}`;
  const nw0 = E.netWorth(s).total;
  s.tx.push(...E.buildTransfer(s, { date: '2026-08-05', from: 'bank', to: 'wallet', sent: 250000, cat: 'tr' }, id));
  const b = Object.fromEntries(E.balances(s).map((x) => [x.id, x.native]));
  assert.equal(b.bank, 750000); assert.equal(b.wallet, 250000);
  near(E.netWorth(s).total, nw0);
  const rep = E.cycleReport(s, E.cycle(s, 2026, 8));
  assert.equal(rep.totalIncome, 0); assert.equal(rep.totalExpense, 0);
});
test('B5 expense on a credit card raises outstanding and lowers net worth', () => {
  const s = base(); const nw0 = E.netWorth(s).total;
  s.tx.push({ id: 1, date: '2026-08-05', type: 'Expense', cat: 'food', acct: 'card', ccy: 'IDR', amt: -100000 });
  assert.equal(E.cards(s).find((x) => x.id === 'card').outstanding, 100000);
  near(E.netWorth(s).total - nw0, -100000);
});

// ---- Table C ----
const ids = () => { let n = 0; return () => `x${++n}`; };
test('C1 same currency: two legs, same amount, one link', () => {
  const legs = E.buildTransfer(base(), { date: '2026-08-01', from: 'bank', to: 'wallet', sent: 1000, cat: 'tr' }, ids());
  assert.equal(legs.length, 2); assert.equal(legs[0].amt, -1000); assert.equal(legs[1].amt, 1000);
  assert.equal(legs[0].link, legs[1].link);
});
test('C2 card payment lowers bank and card outstanding by the same amount', () => {
  const s = base();
  s.tx.push({ id: 0, date: '2026-08-01', type: 'Expense', cat: 'food', acct: 'card', ccy: 'IDR', amt: -400000 });
  s.tx.push(...E.buildTransfer(s, { date: '2026-08-02', from: 'bank', to: 'card', sent: 400000, cat: 'ccp' }, ids()));
  assert.equal(E.balances(s).find((b) => b.id === 'bank').native, 600000);
  assert.equal(E.cards(s).find((x) => x.id === 'card').outstanding, 0);
  assert.equal(s.tx[1].cat, 'ccp'); assert.equal(s.tx[1].type, 'Transfer');
});
test('C3 cross-currency: destination rises by exactly the amount received, effective rate stored', () => {
  const s = base();
  s.tx.push(...E.buildTransfer(s, { date: '2026-08-01', from: 'bank', to: 'eur', sent: 610500, received: 30, cat: 'tr' }, ids()));
  assert.equal(E.balances(s).find((b) => b.id === 'eur').native, 130);
  assert.equal(E.resolveAmount(s, s.tx[1]).rate, 20350);
  assert.equal(E.balances(s).find((b) => b.id === 'bank').native, 389500);
});
test('C4 foreign to foreign: each leg in its own currency', () => {
  const s = base();
  s.tx.push(...E.buildTransfer(s, { date: '2026-08-01', from: 'eur', to: 'gbp', sent: 60, received: 50, cat: 'tr' }, ids()));
  const b = Object.fromEntries(E.balances(s).map((x) => [x.id, x.native]));
  assert.equal(b.eur, 40); assert.equal(b.gbp, 50);
  assert.equal(E.resolveAmount(s, s.tx[0]).idr, -1200000);
});
test('C5 with fee: two legs plus one Admin Fee expense on the source', () => {
  const s = base();
  const legs = E.buildTransfer(s, { date: '2026-08-01', from: 'bank', to: 'wallet', sent: 1000, fee: 2500, cat: 'tr', feeCat: 'fee' }, ids());
  assert.equal(legs.length, 3);
  assert.deepEqual([legs[2].type, legs[2].cat, legs[2].acct, legs[2].amt], ['Expense', 'fee', 'bank', -2500]);
});
test('C6 source equals destination is refused', () => {
  assert.throws(() => E.buildTransfer(base(), { date: '2026-08-01', from: 'bank', to: 'bank', sent: 1, cat: 'tr' }, ids()));
});
test('C cross-currency without amount received is refused', () => {
  assert.throws(() => E.buildTransfer(base(), { date: '2026-08-01', from: 'bank', to: 'eur', sent: 1000, cat: 'tr' }, ids()));
});

// ---- Table D ----
const cyc = (anchor, overrides, y, m) => { const s = base(); s.anchorDay = anchor; s.overrides = overrides; return E.cycle(s, y, m); };
test('D1 anchor 1: calendar month', () => {
  const x = cyc(1, {}, 2026, 8); assert.deepEqual([x.start, x.end, x.days], ['2026-08-01', '2026-08-31', 31]);
});
test('D2 anchor 25: 25 May to 24 Jun', () => {
  const x = cyc(25, {}, 2026, 5); assert.deepEqual([x.start, x.end], ['2026-05-25', '2026-06-24']);
});
test('D3 override moves the start of that cycle', () => {
  const x = cyc(25, { '2026-05': '2026-05-22' }, 2026, 5); assert.deepEqual([x.start, x.end], ['2026-05-22', '2026-06-24']);
});
test('D4 the cycle before an override ends the day before it', () => {
  const x = cyc(25, { '2026-05': '2026-05-22' }, 2026, 4); assert.deepEqual([x.start, x.end], ['2026-04-25', '2026-05-21']);
});
test('D5 anchor 31 in a shorter month uses its last day', () => {
  const x = cyc(31, {}, 2027, 2); assert.deepEqual([x.start, x.end], ['2027-02-28', '2027-03-30']);
});
test('D6 December cycle crosses the year', () => {
  const x = cyc(25, {}, 2026, 12); assert.deepEqual([x.start, x.end], ['2026-12-25', '2027-01-24']);
});
test('D a transaction on the start or end date belongs to that cycle', () => {
  const s = base(); s.anchorDay = 25;
  assert.equal(E.cycleOf(s, '2026-05-25').key, '2026-05');
  assert.equal(E.cycleOf(s, '2026-06-24').key, '2026-05');
  assert.equal(E.cycleOf(s, '2026-05-24').key, '2026-04');
});

// ---- Table E ----
const plan = { date: '2026-05-12', total: 714500, tenor: 3, monthly: 238167 };
for (const [n, y, m, paid, rem, st] of [
  ['E1', 2026, 4, 0, 714501, 'Active'], ['E2', 2026, 5, 0, 714501, 'Active'], ['E3', 2026, 6, 1, 476334, 'Active'],
  ['E4', 2026, 7, 2, 238167, 'Active'], ['E5', 2026, 8, 3, 0, 'Completed'], ['E6', 2026, 12, 3, 0, 'Completed'],
]) {
  test(`${n} instalment plan viewed ${y}-${m}`, () => {
    const r = E.planStatus(plan, y, m);
    assert.deepEqual([r.paid, r.remaining, r.status], [paid, rem, st]);
  });
}
test('E monthly payment defaults to total divided by tenor', () => {
  near(E.planStatus({ date: '2026-05-12', total: 900000, tenor: 12, monthly: null }, 2026, 5).monthly, 75000);
});

// ---- Table F ----
const util = (out) => { const s = base(); s.accounts.find((a) => a.id === 'card').opening = -out; return E.cards(s).find((x) => x.id === 'card'); };
test('F1 under 50%: Healthy', () => assert.equal(util(9999999).status, 'Healthy'));
test('F2 exactly 50%: Watch', () => assert.equal(util(10000000).status, 'Watch'));
test('F3 under 75%: Watch', () => assert.equal(util(14999999).status, 'Watch'));
test('F4 exactly 75%: High', () => assert.equal(util(15000000).status, 'High'));
test('F5 shared limit: one combined utilisation on both cards', () => {
  const list = E.cards(base());
  const a = list.find((x) => x.id === 'cardA'), b = list.find((x) => x.id === 'cardB');
  near(a.util, 17 / 30, 1e-9); assert.equal(a.util, b.util);
  assert.equal(a.status, 'Watch'); assert.equal(b.status, 'Watch');
});
test('F6 no limit entered: utilisation not shown', () => {
  const x = E.cards(base()).find((v) => v.id === 'cardN');
  assert.equal(x.util, null); assert.equal(x.status, '');
});

// ---- Budget and net worth ----
test('budget: variance, status and tier recommendation', () => {
  const s = base();
  s.budgets.default = { sal: 100, food: 20, fun: 0 };
  s.tx.push({ id: 1, date: '2026-08-01', type: 'Income', cat: 'sal', acct: 'eur', ccy: 'EUR', amt: 100 });
  s.tx.push({ id: 2, date: '2026-08-31', type: 'Expense', cat: 'food', acct: 'eur', ccy: 'EUR', amt: -25 });
  s.tx.push({ id: 3, date: '2026-09-01', type: 'Expense', cat: 'food', acct: 'eur', ccy: 'EUR', amt: -99 });
  const r = E.cycleReport(s, E.cycle(s, 2026, 8));
  const food = r.rows.find((x) => x.id === 'food'), fun = r.rows.find((x) => x.id === 'fun'), sal = r.rows.find((x) => x.id === 'sal');
  near(food.actual, 25); near(food.variance, -5); assert.equal(food.status, 'Over');
  assert.equal(fun.status, ''); assert.equal(sal.status, 'On track');
  near(r.tiers.find((t) => t.tier === 'Needs').recommended, 50);
  near(r.savingsRate, 0.75); near(r.avgDaily, 25 / 31);
});
test('budget: a new cycle starts with the latest earlier budgets', () => {
  const s = base(); s.budgets = { default: { food: 10 }, '2026-08': { food: 30 } };
  assert.equal(E.budgetFor(s, '2026-07').food, 10);
  assert.equal(E.budgetFor(s, '2026-09').food, 30);
});
test('net worth: card debt is counted once; instalment plans are not subtracted again', () => {
  const s = base();
  const before = E.netWorth(s).total;
  s.plans.push({ id: 'p', item: 'Phone', card: 'card', ...plan });
  assert.equal(E.netWorth(s).total, before);
});
test('balance as of a date ignores later transactions', () => {
  const s = base();
  s.tx.push({ id: 1, date: '2026-08-10', type: 'Expense', cat: 'food', acct: 'bank', ccy: 'IDR', amt: -1000 });
  assert.equal(E.balances(s, '2026-08-09').find((b) => b.id === 'bank').native, 1000000);
  assert.equal(E.balances(s, '2026-08-10').find((b) => b.id === 'bank').native, 999000);
});
