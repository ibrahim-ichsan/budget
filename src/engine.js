// Calculation engine. Pure functions, no browser APIs.
// Rules follow "Calculation Logic" and Permutation Tables A to F of the PRD.
// Money is summed in integer cents to avoid floating point drift.

export const TIERS = ['Needs', 'Wants', 'Savings', 'Giving'];
const c = (n) => Math.round((Number(n) || 0) * 100); // to cents
const u = (cents) => cents / 100;                    // from cents
const has = (v) => v !== null && v !== undefined && v !== '';

export function rateOf(state, ccy) {
  if (!ccy || ccy === 'IDR') return 1;
  const r = state.rates[ccy];
  return has(r) && Number(r) > 0 ? Number(r) : null;
}

// Table A. Returns { rate, idr } with idr signed. amt and billed are stored signed.
export function resolveAmount(state, tx) {
  const amt = has(tx.amt) ? Number(tx.amt) : null;
  const billed = has(tx.billed) ? Number(tx.billed) : null;
  if (amt === null && billed === null) return { rate: null, idr: 0 };
  if (billed !== null) {
    if (amt !== null && amt !== 0) {
      return { rate: Math.abs(billed / amt), idr: Math.sign(amt) * Math.abs(billed) };
    }
    return { rate: null, idr: billed };
  }
  const rate = rateOf(state, tx.ccy);
  if (rate === null) return { rate: null, idr: 0, missingRate: true };
  return { rate, idr: amt * rate };
}

export const idrCents = (state, tx) => c(resolveAmount(state, tx).idr);

// Amount in the account's own currency.
export function acctAmount(state, tx, acct) {
  const ccy = acct ? acct.ccy : 'IDR';
  // Same currency and no billed figure: the native amount is exact.
  if (has(tx.amt) && tx.ccy === ccy && !has(tx.billed)) return Number(tx.amt);
  // A leg typed in the account's currency keeps its typed amount (cross-currency transfer, Table C row 3).
  if (has(tx.amt) && tx.ccy === ccy) return Number(tx.amt);
  const r = rateOf(state, ccy);
  return r ? resolveAmount(state, tx).idr / r : 0;
}

export const signCheck = (tx) =>
  has(tx.amt) && has(tx.billed) && Number(tx.amt) !== 0 && Number(tx.billed) !== 0 &&
  Math.sign(Number(tx.amt)) !== Math.sign(Number(tx.billed));

// Base currency conversion: every total is computed in IDR, then shown in the base currency.
export function toBase(state, idr) {
  const r = rateOf(state, state.base || 'IDR');
  return r ? idr / r : idr;
}

// ---- Account balances -------------------------------------------------------
export function balances(state, asOf) {
  const byId = Object.fromEntries(state.accounts.map((a) => [a.id, a]));
  const cents = Object.fromEntries(state.accounts.map((a) => [a.id, c(a.opening)]));
  for (const tx of state.tx) {
    if (asOf && tx.date > asOf) continue;
    const a = byId[tx.acct];
    if (!a) continue;
    cents[a.id] += c(acctAmount(state, tx, a));
  }
  return state.accounts.map((a) => {
    const native = u(cents[a.id]);
    const rate = rateOf(state, a.ccy) || 0;
    return { id: a.id, name: a.name, type: a.type, ccy: a.ccy, archived: !!a.archived, native, idr: native * rate };
  });
}

// ---- Pay Cycle (Table D) ----------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const addDays = (s, n) => {
  const d = new Date(s + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const cycleKey = (y, m) => `${y}-${pad(m)}`;

export function cycleStart(state, y, m) {
  const o = state.overrides && state.overrides[cycleKey(y, m)];
  if (o) return o;
  const day = Math.min(Number(state.anchorDay) || 1, daysIn(y, m));
  return iso(y, m, day);
}
export function cycle(state, y, m) {
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const start = cycleStart(state, y, m);
  const end = addDays(cycleStart(state, ny, nm), -1);
  const days = Math.round((new Date(end) - new Date(start)) / 86400000) + 1;
  return { y, m, key: cycleKey(y, m), start, end, days };
}
// The cycle a date falls in.
export function cycleOf(state, date) {
  let y = Number(date.slice(0, 4));
  let m = Number(date.slice(5, 7));
  for (let i = 0; i < 3; i++) {
    const cy = cycle(state, y, m);
    if (date < cy.start) { m -= 1; if (m === 0) { m = 12; y -= 1; } continue; }
    if (date > cy.end) { m += 1; if (m === 13) { m = 1; y += 1; } continue; }
    return cy;
  }
  return cycle(state, y, m);
}

// ---- Budget (BG-04) ---------------------------------------------------------
export function budgetFor(state, key) {
  const keys = Object.keys(state.budgets || {}).filter((k) => k !== 'default' && k <= key).sort();
  const latest = keys.length ? state.budgets[keys[keys.length - 1]] : null;
  return { ...(state.budgets?.default || {}), ...(latest || {}) };
}

export function cycleReport(state, cy, filter = {}) {
  const cats = Object.fromEntries(state.categories.map((k) => [k.id, k]));
  const actual = {};
  let income = 0, expense = 0;
  for (const tx of state.tx) {
    if (tx.date < cy.start || tx.date > cy.end) continue;
    if (tx.type === 'Transfer') continue;
    if (filter.acct && tx.acct !== filter.acct) continue;
    if (filter.cat && tx.cat !== filter.cat) continue;
    const v = idrCents(state, tx);
    actual[tx.cat] = (actual[tx.cat] || 0) + v;
    if (tx.type === 'Income') income += v; else if (tx.type === 'Expense') expense += v;
  }
  const budget = budgetFor(state, cy.key);
  const rows = state.categories
    .filter((k) => k.type !== 'Transfer' && (!k.archived || actual[k.id]))
    .map((k) => {
      const isInc = k.type === 'Income';
      const raw = toBase(state, u(actual[k.id] || 0));
      const act = isInc ? raw : 0 - raw;
      const bud = Number(budget[k.id]) || 0;
      const variance = isInc ? act - bud : bud - act;
      let status = '';
      if (isInc) status = act >= bud ? 'On track' : 'Below';
      else if (bud !== 0) status = act <= bud ? 'Under' : 'Over';
      return { id: k.id, name: k.name, type: k.type, tier: isInc ? 'Income' : k.tier, budget: bud, actual: act, variance, status };
    });
  const totalIncome = toBase(state, u(income));
  const totalExpense = 0 - toBase(state, u(expense));
  const fw = (state.frameworks || []).find((f) => f.name === state.framework) || null;
  const tiers = TIERS.map((t) => {
    const share = fw ? Number(fw[t.toLowerCase()]) || 0 : 0;
    return {
      tier: t, share, recommended: totalIncome * share,
      budget: rows.filter((r) => r.tier === t).reduce((s, r) => s + r.budget, 0),
      actual: rows.filter((r) => r.tier === t).reduce((s, r) => s + r.actual, 0),
    };
  });
  return {
    cycle: cy, rows, tiers, totalIncome, totalExpense,
    net: totalIncome - totalExpense,
    savingsRate: totalIncome === 0 ? 0 : (totalIncome - totalExpense) / totalIncome,
    avgDaily: cy.days ? totalExpense / cy.days : 0,
    budgetIncome: rows.filter((r) => r.type === 'Income').reduce((s, r) => s + r.budget, 0),
    budgetExpense: rows.filter((r) => r.type === 'Expense').reduce((s, r) => s + r.budget, 0),
  };
}

// ---- Instalment Plans (Table E) ---------------------------------------------
export function planStatus(plan, viewY, viewM) {
  const tenor = Number(plan.tenor) || 0;
  const monthly = has(plan.monthly) ? Number(plan.monthly) : (tenor ? Number(plan.total) / tenor : 0);
  const py = Number(plan.date.slice(0, 4)), pm = Number(plan.date.slice(5, 7));
  const diff = (viewY - py) * 12 + (viewM - pm);
  const paid = Math.min(tenor, Math.max(0, diff));
  const remaining = Math.max(0, monthly * (tenor - paid));
  const endIdx = py * 12 + (pm - 1) + Math.max(0, tenor - 1);
  return {
    monthly, paid, remaining,
    startMonth: cycleKey(py, pm),
    endMonth: cycleKey(Math.floor(endIdx / 12), (endIdx % 12) + 1),
    status: remaining > 0 ? 'Active' : 'Completed',
  };
}
export function plansSummary(state, viewY, viewM) {
  const rows = (state.plans || []).map((p) => ({ ...p, ...planStatus(p, viewY, viewM) }));
  const active = rows.filter((r) => r.remaining > 0);
  return {
    rows,
    outstanding: active.reduce((s, r) => s + r.remaining, 0),
    monthly: active.reduce((s, r) => s + r.monthly, 0),
    activeCount: active.length,
    completedCount: rows.length - active.length,
  };
}

// ---- Cards (Table F) --------------------------------------------------------
export function utilStatus(util) {
  if (util === null) return '';
  if (util < 0.5) return 'Healthy';
  if (util < 0.75) return 'Watch';
  return 'High';
}
export function cards(state, asOf) {
  const bal = Object.fromEntries(balances(state, asOf).map((b) => [b.id, b]));
  const list = state.accounts.filter((a) => a.type === 'Credit Card' && !a.archived).map((a) => ({
    id: a.id, name: a.name, group: a.group || '', limit: has(a.limit) ? Number(a.limit) : null,
    outstanding: 0 - bal[a.id].idr,
  }));
  const groups = Object.fromEntries((state.groups || []).map((g) => [g.id, g]));
  for (const card of list) {
    const g = card.group && groups[card.group];
    if (g && has(g.limit)) {
      const combined = list.filter((x) => x.group === card.group).reduce((s, x) => s + x.outstanding, 0);
      card.sharedLimit = Number(g.limit);
      card.groupName = g.name;
      card.util = Number(g.limit) ? combined / Number(g.limit) : null;
      card.available = Number(g.limit) - combined;
    } else if (card.limit !== null) {
      card.util = card.limit ? card.outstanding / card.limit : null;
      card.available = card.limit - card.outstanding;
    } else {
      card.util = null;
      card.available = null;
    }
    card.status = utilStatus(card.util);
  }
  return list;
}

// ---- Net worth --------------------------------------------------------------
// Owner decision on Q-02: remaining instalments are NOT subtracted a second time.
// A card purchase is already inside card outstanding.
export function netWorth(state, asOf) {
  const bal = balances(state, asOf);
  const accounts = bal.filter((b) => b.type !== 'Credit Card').reduce((s, b) => s + c(b.idr), 0);
  const cardDebt = 0 - bal.filter((b) => b.type === 'Credit Card').reduce((s, b) => s + c(b.idr), 0);
  const investments = c(state.investmentsIdr || 0);
  return { accounts: u(accounts), investments: u(investments), cardDebt: u(cardDebt), total: u(accounts + investments - cardDebt) };
}

// ---- Transfers (Table C) ----------------------------------------------------
// Builds the linked legs (and the optional fee) for one transfer action.
export function buildTransfer(state, f, newId) {
  const src = state.accounts.find((a) => a.id === f.from);
  const dst = state.accounts.find((a) => a.id === f.to);
  if (!src || !dst) throw new Error('Pick a source and a destination account.');
  if (src.id === dst.id) throw new Error('Source and destination must be different accounts.');
  const sent = Number(f.sent);
  if (!(sent > 0)) throw new Error('Enter the amount sent.');
  const cross = src.ccy !== dst.ccy;
  if (cross && !(Number(f.received) > 0)) throw new Error('Enter the amount received in the destination currency.');
  const link = newId();
  const base = { date: f.date, desc: f.desc || `Transfer to ${dst.name}`, cat: f.cat, type: 'Transfer', notes: f.notes || '', link };
  const out = { ...base, id: newId(), acct: src.id, ccy: src.ccy, amt: -sent, billed: null };
  const sentIdr = resolveAmount(state, out).idr; // negative
  const inn = { ...base, id: newId(), acct: dst.id, ccy: dst.ccy, amt: cross ? Number(f.received) : sent, billed: null };
  // Table C row 3: the destination leg carries the IDR sent as Billed IDR, so the effective rate is stored.
  if (cross && dst.ccy !== 'IDR') inn.billed = Math.abs(sentIdr);
  const legs = [out, inn];
  if (Number(f.fee) > 0) {
    legs.push({ id: newId(), date: f.date, desc: `Fee: ${base.desc}`, cat: f.feeCat, type: 'Expense', acct: src.id, ccy: src.ccy, amt: -Number(f.fee), billed: null, notes: '', link });
  }
  return legs;
}

// ---- Insights (BG-10) -------------------------------------------------------
// "Spending" here means Expense categories in the chosen tiers. Savings is left out by default,
// because money moved into investments is not money spent. All figures are in the base currency.
export const SPEND_TIERS = ['Needs', 'Wants', 'Giving'];
export const mondayOf = (s) => addDays(s, -((new Date(s + 'T00:00:00Z').getUTCDay() + 6) % 7));
const prevCycle = (state, cy) => (cy.m === 1 ? cycle(state, cy.y - 1, 12) : cycle(state, cy.y, cy.m - 1));
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);

function spendCats(state, f = {}) {
  const tiers = f.tiers || SPEND_TIERS;
  return state.categories.filter((k) => k.type === 'Expense' && tiers.includes(k.tier) && (!f.cat || k.id === f.cat));
}
// Spending per category between two dates (inclusive). Refunds booked as a positive Expense net off.
export function spendByCategory(state, from, to, f = {}) {
  const cats = spendCats(state, f);
  const ids = new Set(cats.map((k) => k.id));
  const sum = {};
  for (const tx of state.tx) {
    if (tx.type !== 'Expense' || tx.date < from || tx.date > to || !ids.has(tx.cat)) continue;
    if (f.acct && tx.acct !== f.acct) continue;
    sum[tx.cat] = (sum[tx.cat] || 0) - idrCents(state, tx);
  }
  return cats.map((k) => ({ id: k.id, name: k.name, tier: k.tier, spent: toBase(state, u(sum[k.id] || 0)) }))
    .filter((r) => Math.abs(r.spent) > 0.004).sort((a, b) => b.spent - a.spent);
}
export const spendBetween = (state, from, to, f = {}) => spendByCategory(state, from, to, f).reduce((s, r) => s + r.spent, 0);

// Budget for the filtered categories in one cycle. A budget is set per category, not per account,
// so an account filter has no budget to compare with.
export function spendBudget(state, cy, f = {}) {
  if (f.acct) return null;
  const b = budgetFor(state, cy.key);
  const total = spendCats(state, f).reduce((s, k) => s + (Number(b[k.id]) || 0), 0);
  return total > 0 ? total : null;
}
// The share of the cycle budgets that falls on a run of days, so a week across two cycles is still right.
function budgetForDays(state, from, to, f) {
  let total = 0; let any = false;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const cy = cycleOf(state, d);
    const b = spendBudget(state, cy, f);
    if (b !== null) { total += b / cy.days; any = true; }
  }
  return any ? total : null;
}

// The last n weeks, Monday to Sunday, oldest first. The last one is the week of `today`.
export function weeks(state, today, n = 8, f = {}) {
  const out = [];
  const thisMon = mondayOf(today);
  for (let i = n - 1; i >= 0; i--) {
    const start = addDays(thisMon, -7 * i); const end = addDays(start, 6);
    out.push({ key: start, start, end, current: i === 0, spent: spendBetween(state, start, end, f), budget: budgetForDays(state, start, end, f) });
  }
  return out;
}
export function weekStatus(w, today) {
  const daysLeft = w.current ? daysBetween(today, w.end) + 1 : 0;
  if (w.budget === null) return { status: '', left: null, daysLeft };
  return { status: w.spent <= w.budget ? 'Under' : 'Over', left: w.budget - w.spent, daysLeft };
}

// The last n pay cycles, oldest first. The last one is the cycle of `today` and is usually incomplete.
export function cycleHistory(state, today, n = 6, f = {}) {
  const out = [];
  let cy = cycleOf(state, today);
  for (let i = 0; i < n; i++) {
    let income = 0;
    for (const tx of state.tx) {
      if (tx.type !== 'Income' || tx.date < cy.start || tx.date > cy.end) continue;
      if (f.acct && tx.acct !== f.acct) continue;
      income += idrCents(state, tx);
    }
    out.unshift({ key: cy.key, cycle: cy, current: i === 0, spent: spendBetween(state, cy.start, cy.end, f), budget: spendBudget(state, cy, f), income: toBase(state, u(income)) });
    cy = prevCycle(state, cy);
  }
  return out;
}

// Running total for one cycle, day by day up to today, against a straight budget line.
export function pace(state, cy, today, f = {}) {
  const last = today < cy.end ? today : cy.end;
  const byDay = {};
  const ids = new Set(spendCats(state, f).map((k) => k.id));
  for (const tx of state.tx) {
    if (tx.type !== 'Expense' || tx.date < cy.start || tx.date > last || !ids.has(tx.cat)) continue;
    if (f.acct && tx.acct !== f.acct) continue;
    byDay[tx.date] = (byDay[tx.date] || 0) - idrCents(state, tx);
  }
  const points = []; let cum = 0;
  if (today >= cy.start) for (let d = cy.start; d <= last; d = addDays(d, 1)) { cum += byDay[d] || 0; points.push({ date: d, cum: toBase(state, u(cum)) }); }
  const spent = toBase(state, u(cum));
  const budget = spendBudget(state, cy, f);
  const elapsed = points.length;
  const daysLeft = today > cy.end ? 0 : cy.days - elapsed + (elapsed ? 1 : 0); // today still counts as a day to spend in
  return {
    points, spent, budget, elapsed, daysLeft,
    expected: budget === null ? null : (budget * elapsed) / cy.days,
    perDay: budget === null || !daysLeft ? null : (budget - spent) / daysLeft,
    projected: elapsed ? (spent / elapsed) * cy.days : 0,
  };
}

// How long the money lasts. Liquid money is every non-card account minus card outstanding
// (investments only when asked). Burn is average spending minus the income that keeps coming.
// The average uses up to n complete cycles that have transactions; with none, the current cycle is scaled up.
export function runway(state, today, { tiers, keepIncome = [], n = 3, adjust = 0, withInvestments = false } = {}) {
  const f = { tiers: tiers || [...SPEND_TIERS, 'Savings'] };
  const nw = netWorth(state, today);
  const liquid = toBase(state, nw.accounts - nw.cardDebt + (withInvestments ? nw.investments : 0));
  const keep = new Set(keepIncome);
  const incomeIn = (cy, to) => {
    let v = 0;
    for (const tx of state.tx) if (tx.type === 'Income' && keep.has(tx.cat) && tx.date >= cy.start && tx.date <= to) v += idrCents(state, tx);
    return toBase(state, u(v));
  };
  const cur = cycleOf(state, today);
  const used = [];
  let cy = prevCycle(state, cur);
  const first = state.tx.reduce((m, t) => (t.date < m ? t.date : m), '9999');
  for (let i = 0; i < 24 && used.length < n && cy.end >= first; i++) {
    if (state.tx.some((t) => t.date >= cy.start && t.date <= cy.end)) used.push(cy);
    cy = prevCycle(state, cy);
  }
  let spend; let income; let scaled = false;
  if (used.length) {
    spend = used.reduce((s, x) => s + spendBetween(state, x.start, x.end, f), 0) / used.length;
    income = used.reduce((s, x) => s + incomeIn(x, x.end), 0) / used.length;
  } else {
    const elapsed = Math.max(1, daysBetween(cur.start, today) + 1);
    spend = (spendBetween(state, cur.start, today, f) / elapsed) * cur.days;
    income = incomeIn(cur, today); // income usually lands once per cycle, so it is not scaled up
    scaled = true;
  }
  spend *= 1 + adjust;
  const burn = spend - income;
  const months = burn > 0.004 ? Math.max(0, liquid) / burn : Infinity;
  let until = null;
  if (isFinite(months)) {
    const whole = Math.floor(months);
    const idx = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1 + whole;
    until = cycleKey(Math.floor(idx / 12), (idx % 12) + 1);
  }
  return { liquid, spend, income, burn, months, until, cyclesUsed: used.length, scaled };
}

// Categories running above their own recent pattern: spending so far in this cycle against the
// average spent by the same day of the last n cycles, so rent paid on day 1 compares with rent paid on day 1.
export function movers(state, today, f = {}, n = 3) {
  const cur = cycleOf(state, today);
  const elapsed = daysBetween(cur.start, today);
  const now = Object.fromEntries(spendByCategory(state, cur.start, today, f).map((r) => [r.id, r]));
  const past = {}; let cy = prevCycle(state, cur); let used = 0;
  for (let i = 0; i < n; i++) {
    if (state.tx.some((t) => t.date >= cy.start && t.date <= cy.end)) {
      used += 1;
      const to = addDays(cy.start, elapsed) < cy.end ? addDays(cy.start, elapsed) : cy.end;
      for (const r of spendByCategory(state, cy.start, to, f)) past[r.id] = { ...r, spent: (past[r.id]?.spent || 0) + r.spent };
    }
    cy = prevCycle(state, cy);
  }
  if (!used) return [];
  const ids = new Set([...Object.keys(now), ...Object.keys(past)]);
  return [...ids].map((id) => {
    const usual = (past[id]?.spent || 0) / used;
    const spent = now[id]?.spent || 0;
    return { id, name: (now[id] || past[id]).name, spent, usual, diff: spent - usual };
  }).filter((r) => Math.abs(r.diff) > 0.5).sort((a, b) => b.diff - a.diff);
}
