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
