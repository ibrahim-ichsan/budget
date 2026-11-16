import './style.css';
import * as E from './engine.js';
import { store, emptyState, newId, todayISO } from './store.js';
import { demoState } from './demo.js';
import { lockEnabled, unlock, enableLock, disableLock, lockSupported } from './lock.js';

const app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const S = () => store.state;
const ui = { cy: null, filter: { acct: '', cat: '' }, asOf: '', q: '', limit: 100, planView: '', editBudget: false, msg: '', recon: null, summary: null };

// ---- formatting ---------------------------------------------------------------
const money = (n, ccy) => {
  const digits = ccy === 'IDR' ? 0 : 2;
  const v = Math.abs(n) < 0.005 ? 0 : n;
  try { return new Intl.NumberFormat('en-IE', { style: 'currency', currency: ccy, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v); }
  catch { return `${ccy} ${v.toFixed(digits)}`; }
};
const base = () => S().base || 'EUR';
const mBase = (n) => money(n, base());
const idrToBase = (idr) => E.toBase(S(), idr);
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const monthName = (y, m) => new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-IE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const niceDate = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const acctById = () => Object.fromEntries(S().accounts.map((a) => [a.id, a]));
const catById = () => Object.fromEntries(S().categories.map((k) => [k.id, k]));
const currencies = () => Object.keys(S().rates);
const opt = (v, label, sel) => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(label)}</option>`;
const curCycle = () => ui.cy || (ui.cy = E.cycleOf(S(), todayISO()));
const statusChip = (s) => (s ? `<span class="chip ${/Over|High|Below/.test(s) ? 'bad' : /Watch/.test(s) ? 'warn' : 'ok'}">${esc(s)}</span>` : '');

// ---- shell ----------------------------------------------------------------------
const route = () => (location.hash.replace(/^#/, '') || '/');
const go = (r) => { if (route() === r) render(); else location.hash = r; };
const tabs = [['/', 'Home', 'M3 11l9-8 9 8M5 10v10h14V10'], ['/tx', 'Activity', 'M4 6h16M4 12h16M4 18h10'], ['/add', 'Add', 'M12 5v14M5 12h14'], ['/budget', 'Budget', 'M4 19V5M4 19h16M8 15v-4M12 15V8M16 15v-6'], ['/more', 'More', 'M5 12h.01M12 12h.01M19 12h.01']];

function shell(title, body, { back = '', band = '' } = {}) {
  const r = route();
  return `
  <header class="band"><div class="wrap">
    <div class="topbar">
      ${back ? `<a class="iconbtn" href="#${back}" aria-label="Back"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></a>` : ''}
      <h1>${esc(title)}</h1>
    </div>
    ${band}
  </div></header>
  <main class="wrap">${ui.msg ? `<div class="info" role="status"><p>${esc(ui.msg)}</p></div>` : ''}${body}</main>
  <nav class="tabbar" aria-label="Main">
    ${tabs.map(([href, label, d]) => `<a href="#${href}" class="${href === '/add' ? 'add' : ''}" ${((href === '/' && r === '/') || (href !== '/' && r.startsWith(href))) ? 'aria-current="page"' : ''}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg><span>${label}</span></a>`).join('')}
  </nav>`;
}
const cycleNav = (cy) => `
  <div class="cyclenav">
    <button type="button" class="iconbtn" data-act="cycle" data-step="-1" aria-label="Previous cycle"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>
    <div><p class="cy-name">${esc(monthName(cy.y, cy.m))}</p><p class="cy-dates">${niceDate(cy.start)} to ${niceDate(cy.end)}</p></div>
    <button type="button" class="iconbtn" data-act="cycle" data-step="1" aria-label="Next cycle"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>
  </div>`;

// ---- welcome ---------------------------------------------------------------------
function viewWelcome() {
  return `<header class="band"><div class="wrap"><div class="topbar"><h1>Budget</h1></div>
    <p class="lead">A pay-cycle, multi-currency budget. Your data stays on this device.</p></div></header>
  <main class="wrap">
    <section class="card"><h2>Start</h2>
      <button type="button" class="pill solid" data-act="start-empty">Start empty</button>
      <button type="button" class="pill soft" data-act="start-demo">Try with sample data</button>
      <a class="link" href="#/data" data-act="start-import">I have a workbook to import</a>
    </section>
    <div class="info"><p>Nothing you enter is sent to a server. Back up from the More tab so a lost phone costs you nothing.</p></div>
  </main>`;
}

// ---- dashboard (BG-05) ------------------------------------------------------------
function viewHome() {
  const s = S(), cy = curCycle(), today = todayISO();
  const rep = E.cycleReport(s, cy, ui.filter);
  const asOf = ui.asOf || today;
  const bal = E.balances(s, asOf).filter((b) => !b.archived || Math.abs(b.native) > 0.004);
  const nw = E.netWorth(s, asOf);
  const ps = E.plansSummary(s, Number(today.slice(0, 4)), Number(today.slice(5, 7)));
  const eRate = E.rateOf(s, base());
  const idrLine = (v) => (base() === 'IDR' ? '' : `<p class="sub">${money(v * (eRate || 1), 'IDR')}</p>`);
  const notes = [];
  if (s.meta.demo) notes.push(`<div class="warnbox"><p><strong>Sample data.</strong> Nothing here is real.</p><button type="button" class="link" data-act="leave-demo">Leave Demo Mode</button></div>`);
  const last = s.meta.lastBackup;
  if (!s.meta.demo && s.meta.dirty && s.tx.length && (!last || (new Date(today) - new Date(last)) / 86400000 > 7)) notes.push(`<div class="warnbox"><p>${last ? `Last backup was ${niceDate(last)}.` : 'No backup yet.'} Your data exists only on this device.</p><a class="link" href="#/data">Back up now</a></div>`);
  const stale = currencies().filter((ccy) => ccy !== 'IDR' && s.ratesUpdated?.[ccy] && (new Date(today) - new Date(s.ratesUpdated[ccy])) / 86400000 > 30);
  if (stale.length) notes.push(`<div class="info"><p>Rate may be stale for ${esc(stale.join(', '))}. <a href="#/setup/rates">Update the Rate Table</a></p></div>`);

  const expRows = rep.rows.filter((r) => r.type === 'Expense' && (Math.abs(r.actual) > 0.004 || r.budget)).sort((a, b) => b.actual - a.actual);
  const groups = {};
  for (const b of bal) (groups[b.type] = groups[b.type] || []).push(b);
  const baseAccts = bal.filter((b) => b.ccy === base() && b.type !== 'Credit Card');
  const band = `${cycleNav(cy)}
    <div class="kpis">
      <div><p class="l">Income</p><p class="v">${mBase(rep.totalIncome)}</p>${idrLine(rep.totalIncome)}</div>
      <div><p class="l">Expenses</p><p class="v">${mBase(rep.totalExpense)}</p>${idrLine(rep.totalExpense)}</div>
      <div><p class="l">Net savings</p><p class="v">${mBase(rep.net)}</p>${idrLine(rep.net)}</div>
      <div><p class="l">Savings rate</p><p class="v">${pct(rep.savingsRate)}</p></div>
    </div>`;
  const body = `${notes.join('')}
  <section class="card"><div class="sechead"><h2>Spending by category</h2><a class="link" href="#/budget">Budget</a></div>
    <div class="row2">
      <label class="field"><span class="l">Account</span><select data-chg="filter-acct">${opt('', 'All', ui.filter.acct)}${s.accounts.filter((a) => !a.archived).map((a) => opt(a.id, a.name, ui.filter.acct)).join('')}</select></label>
      <label class="field"><span class="l">Category</span><select data-chg="filter-cat">${opt('', 'All', ui.filter.cat)}${s.categories.filter((k) => k.type !== 'Transfer' && !k.archived).map((k) => opt(k.id, k.name, ui.filter.cat)).join('')}</select></label>
    </div>
    ${expRows.length ? `<ul class="list">${expRows.map((r) => `<li><div><p class="t">${esc(r.name)}</p><p class="note">${esc(r.tier)} · ${rep.totalExpense ? pct(r.actual / rep.totalExpense) : '0%'} of spending${r.budget ? ` · budget ${mBase(r.budget)}` : ''}</p></div><div class="r"><p class="t">${mBase(r.actual)}</p>${statusChip(r.status)}</div></li>`).join('')}</ul>` : '<p class="note">No spending in this cycle yet.</p>'}
  </section>
  <section class="card"><div class="sechead"><h2>Accounts</h2></div>
    <label class="field"><span class="l">Balance as of</span><input type="date" value="${asOf}" data-chg="asof"></label>
    ${Object.entries(groups).map(([type, list]) => `<h3>${esc(type)}</h3><ul class="list">${list.map((b) => `<li><div><p class="t">${esc(b.name)}</p><p class="note">${esc(b.ccy)}${b.native < -0.004 && b.type !== 'Credit Card' ? ' · <span class="neg">negative balance</span>' : ''}</p></div><div class="r"><p class="t">${money(b.type === 'Credit Card' ? 0 - b.native : b.native, b.ccy)}${b.type === 'Credit Card' ? ' owed' : ''}</p>${b.ccy !== base() ? `<p class="note">${mBase(idrToBase(b.type === 'Credit Card' ? 0 - b.idr : b.idr))}</p>` : ''}</div></li>`).join('')}</ul>`).join('')}
    ${baseAccts.length ? `<div class="field"><span class="l">Total in ${esc(base())} accounts</span><p class="v">${mBase(baseAccts.reduce((t, b) => t + b.native, 0))}</p></div>` : ''}
  </section>
  <section class="card"><div class="sechead"><h2>Credit cards</h2><a class="link" href="#/cards">Details</a></div>
    <div class="grid3">
      <div class="field"><span class="l">Card outstanding</span><p class="v">${mBase(idrToBase(nw.cardDebt))}</p></div>
      <div class="field"><span class="l">Remaining instalments</span><p class="v">${mBase(idrToBase(ps.outstanding))}</p></div>
      <div class="field"><span class="l">Instalments per month</span><p class="v">${mBase(idrToBase(ps.monthly))}</p></div>
    </div>
  </section>
  <section class="summary"><h2>Net worth</h2><p class="big">${mBase(idrToBase(nw.total))}</p>${base() === 'IDR' ? '' : `<p class="note">${money(nw.total, 'IDR')}</p>`}
    <ul class="list plain"><li><p>Accounts</p><p>${mBase(idrToBase(nw.accounts))}</p></li><li><p>Investments</p><p>${mBase(idrToBase(nw.investments))}</p></li><li><p>Card outstanding</p><p>${mBase(0 - idrToBase(nw.cardDebt))}</p></li></ul>
    <p class="note">Remaining instalments are already part of card outstanding and are not subtracted twice.</p>
  </section>`;
  return shell('Budget', body, { band });
}

// ---- transactions ------------------------------------------------------------------
function viewTx() {
  const s = S(), A = acctById(), K = catById(), q = ui.q.toLowerCase();
  let list = [...s.tx].sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
  if (q) list = list.filter((t) => `${t.desc} ${K[t.cat]?.name || ''} ${A[t.acct]?.name || ''} ${t.notes || ''}`.toLowerCase().includes(q));
  const shown = list.slice(0, ui.limit);
  const today = todayISO();
  let lastDate = '';
  const rows = shown.map((t) => {
    const head = t.date !== lastDate ? `<li class="datehead">${niceDate(t.date)}${t.date > today ? ' · scheduled' : ''}</li>` : '';
    lastDate = t.date;
    const v = t.amt !== null && t.amt !== undefined ? money(t.amt, t.ccy) : money(t.billed, 'IDR');
    return `${head}<li><a class="txrow" href="#/edit/${esc(t.id)}"><div><p class="t">${esc(t.desc || K[t.cat]?.name || 'Transaction')}</p><p class="note">${esc(K[t.cat]?.name || '')} · ${esc(A[t.acct]?.name || '')}${t.flag ? ' · <span class="neg">check sign</span>' : ''}</p></div><div class="r"><p class="t ${t.type === 'Income' ? 'pos' : ''}">${v}</p><p class="note">${esc(t.type)}</p></div></a></li>`;
  }).join('');
  return shell('Activity', `
    <label class="field"><span class="l">Search</span><input type="search" value="${esc(ui.q)}" data-inp="q" placeholder="Description, category or account"></label>
    <p class="note">${list.length} transaction${list.length === 1 ? '' : 's'}</p>
    <section class="card"><ul class="list">${rows || '<li><p class="note">Nothing here yet. Tap Add.</p></li>'}</ul>
    ${list.length > shown.length ? '<button type="button" class="pill soft" data-act="more-tx">Show more</button>' : ''}</section>`);
}

// ---- add / edit (BG-02, BG-03) ------------------------------------------------------
function usageOrder(type) {
  const count = {};
  for (const t of S().tx) count[t.cat] = (count[t.cat] || 0) + 1;
  return S().categories.filter((k) => k.type === type && !k.archived).sort((a, b) => (count[b.id] || 0) - (count[a.id] || 0) || a.name.localeCompare(b.name));
}
// Table C row 2: a transfer into a credit card is a card payment.
function defaultTransferCat(dest) {
  const list = S().categories.filter((k) => k.type === 'Transfer' && !k.archived);
  const pay = list.find((k) => /credit card payment/i.test(k.name));
  const plain = list.find((k) => /^transfer$/i.test(k.name)) || list.find((k) => k !== pay) || list[0];
  return (dest?.type === 'Credit Card' && pay ? pay : plain)?.id || '';
}
function viewForm(id) {
  const s = S(), A = acctById();
  const existing = id ? s.tx.find((t) => t.id === id) : null;
  if (id && !existing) return shell('Not found', '<p class="note">This transaction no longer exists.</p>', { back: '/tx' });
  const linked = existing?.link ? s.tx.filter((t) => t.link === existing.link) : [];
  const legs = linked.filter((t) => t.type === 'Transfer');
  const isTransferPair = legs.length === 2;
  const type = ui.formType || (isTransferPair ? 'Transfer' : existing?.type) || 'Expense';
  const accts = s.accounts.filter((a) => !a.archived);
  if (!accts.length) return shell('Add', '<section class="card"><p class="p">Add an account first.</p><a class="pill solid" href="#/setup/accounts">Go to accounts</a></section>');
  const lastAcct = [...s.tx].reverse().find((t) => t.type !== 'Transfer')?.acct;
  const seg = existing && !isTransferPair && existing.type === 'Transfer' ? '' : `<div class="seg" role="group" aria-label="Type">${['Expense', 'Income', 'Transfer'].map((t) => `<button type="button" data-act="formtype" data-type="${t}" aria-pressed="${t === type}"${existing && ((t === 'Transfer') !== (type === 'Transfer')) ? ' disabled' : ''}>${t}</button>`).join('')}</div>`;
  let fields;
  if (type === 'Transfer' && (isTransferPair || !existing)) {
    const out = legs.find((t) => t.amt < 0), inn = legs.find((t) => t.amt > 0);
    const fee = linked.find((t) => t.type === 'Expense');
    const from = out?.acct || lastAcct || accts[0].id, to = inn?.acct || (accts.find((a) => a.id !== from) || accts[0]).id;
    const cross = A[from]?.ccy !== A[to]?.ccy;
    fields = `
      <label class="field"><span class="l">From</span><select name="from" data-chg="rerender-form">${accts.map((a) => opt(a.id, `${a.name} (${a.ccy})`, ui.f?.from || from)).join('')}</select></label>
      <label class="field"><span class="l">To</span><select name="to" data-chg="rerender-form">${accts.map((a) => opt(a.id, `${a.name} (${a.ccy})`, ui.f?.to || to)).join('')}</select></label>
      <label class="field"><span class="l">Amount sent (${esc(A[ui.f?.from || from]?.ccy || '')})</span><input name="sent" inputmode="decimal" required value="${esc(ui.f?.sent ?? (out ? Math.abs(out.amt) : ''))}"></label>
      ${(ui.f ? A[ui.f.from]?.ccy !== A[ui.f.to]?.ccy : cross) ? `<label class="field"><span class="l">Amount received (${esc(A[ui.f?.to || to]?.ccy || '')})</span><input name="received" inputmode="decimal" required value="${esc(ui.f?.received ?? (inn ? Math.abs(inn.amt) : ''))}"></label>` : ''}
      <label class="field"><span class="l">Fee, optional (${esc(A[ui.f?.from || from]?.ccy || '')})</span><input name="fee" inputmode="decimal" value="${esc(ui.f?.fee ?? (fee ? Math.abs(fee.amt) : ''))}"></label>
      <label class="field"><span class="l">Category</span><select name="cat">${usageOrder('Transfer').map((k) => opt(k.id, k.name, out?.cat || defaultTransferCat(A[ui.f?.to || to]))).join('')}</select></label>`;
  } else {
    const t = existing || {};
    const acct = ui.f?.acct || t.acct || lastAcct || accts[0].id;
    const ccy = ui.f?.ccy || t.ccy || A[acct]?.ccy || 'IDR';
    const showBilled = ccy !== 'IDR';
    const kind = type === 'Transfer' ? 'Transfer' : type;
    fields = `
      <label class="field amount"><span class="l">Amount</span><input name="amt" inputmode="decimal" autofocus value="${esc(ui.f?.amt ?? (t.amt !== null && t.amt !== undefined ? Math.abs(t.amt) : ''))}" placeholder="0"></label>
      ${type === 'Transfer' ? `<label class="field"><span class="l">Direction</span><select name="dir">${opt('out', 'Money out of this account', (t.amt ?? t.billed) > 0 ? 'in' : 'out')}${opt('in', 'Money into this account', (t.amt ?? t.billed) > 0 ? 'in' : 'out')}</select></label>` : ''}
      <label class="field"><span class="l">Category</span><select name="cat">${usageOrder(kind).map((k) => opt(k.id, k.name, ui.f?.cat || t.cat || '')).join('')}</select></label>
      <label class="field"><span class="l">Account</span><select name="acct" data-chg="acct-ccy">${accts.concat(t.acct && A[t.acct]?.archived ? [A[t.acct]] : []).map((a) => opt(a.id, `${a.name} (${a.ccy})`, acct)).join('')}</select></label>
      <label class="field"><span class="l">Currency</span><select name="ccy" data-chg="rerender-form">${currencies().map((x) => opt(x, x, ccy)).join('')}</select></label>
      ${showBilled ? `<label class="field"><span class="l">Billed IDR, optional</span><input name="billed" inputmode="decimal" value="${esc(ui.f?.billed ?? (t.billed !== null && t.billed !== undefined ? Math.abs(t.billed) : ''))}" placeholder="What the bank charged in IDR"></label>` : ''}`;
  }
  const d = ui.f?.date || existing?.date || todayISO();
  return shell(existing ? 'Edit' : 'Add', `
    <form data-form="tx" class="card form" novalidate>
      <input type="hidden" name="id" value="${esc(id || '')}"><input type="hidden" name="type" value="${type}">
      ${seg}${fields}
      <label class="field"><span class="l">Date</span><input type="date" name="date" value="${d}" required></label>
      <label class="field"><span class="l">Description, optional</span><input name="desc" value="${esc(ui.f?.desc ?? existing?.desc ?? '')}"></label>
      <label class="field"><span class="l">Notes, optional</span><input name="notes" value="${esc(ui.f?.notes ?? existing?.notes ?? '')}"></label>
      ${ui.err ? `<div class="warnbox" role="alert"><p>${esc(ui.err)}</p></div>` : ''}
      <button type="submit" class="pill solid">Save</button>
      ${existing ? `<button type="button" class="pill danger" data-act="del-tx" data-id="${esc(id)}">Delete${isTransferPair ? ' transfer' : ''}</button>` : ''}
    </form>`, { back: existing ? '/tx' : '' });
}

// ---- budget (BG-04) -------------------------------------------------------------------
function viewBudget() {
  const s = S(), cy = curCycle(), rep = E.cycleReport(s, cy);
  const row = (r) => `<li><div><p class="t">${esc(r.name)}</p><p class="note">${mBase(r.actual)} of ${ui.editBudget ? '' : mBase(r.budget)}${!ui.editBudget && r.budget ? ` · ${r.variance >= 0 ? `${mBase(r.variance)} ${r.type === 'Income' ? 'above' : 'left'}` : `${mBase(0 - r.variance)} ${r.type === 'Income' ? 'short' : 'over'}`}` : ''}</p></div>
    <div class="r">${ui.editBudget ? `<input class="binput" inputmode="decimal" name="b:${esc(r.id)}" value="${r.budget || ''}" aria-label="Budget for ${esc(r.name)}">` : statusChip(r.status)}</div></li>`;
  const section = (title, rows) => (rows.length ? `<h3>${esc(title)}</h3><ul class="list">${rows.map(row).join('')}</ul>` : '');
  const inner = `${section('Income', rep.rows.filter((r) => r.type === 'Income'))}${E.TIERS.map((t) => section(t, rep.rows.filter((r) => r.tier === t))).join('')}`;
  const body = `
  <section class="card"><div class="sechead"><h2>Plan against actual</h2><button type="button" class="link" data-act="toggle-budget">${ui.editBudget ? 'Cancel' : 'Edit budgets'}</button></div>
    ${ui.editBudget ? `<form data-form="budget">${inner}<p class="note">Amounts in ${esc(base())}. Saved for ${esc(monthName(cy.y, cy.m))} and carried into later cycles.</p><button type="submit" class="pill solid">Save budgets</button></form>` : inner || '<p class="note">Add categories in Setup first.</p>'}
  </section>
  <section class="card"><h2>Tier allocation, ${esc(s.framework || 'no framework')}</h2>
    <ul class="list">${rep.tiers.map((t) => `<li><div><p class="t">${t.tier}</p><p class="note">${pct(t.share)} of income · recommended ${mBase(t.recommended)}</p></div><div class="r"><p class="t">${mBase(t.actual)}</p>${t.recommended ? statusChip(t.tier === 'Savings' || t.tier === 'Giving' ? '' : t.actual > t.recommended ? 'Over' : 'Under') : ''}</div></li>`).join('')}</ul>
  </section>
  <section class="summary"><h2>Net result</h2>
    <ul class="list plain"><li><p>Budgeted net savings</p><p>${mBase(rep.budgetIncome - rep.budgetExpense)}</p></li><li><p>Actual net savings</p><p>${mBase(rep.net)}</p></li><li><p>Savings rate</p><p>${pct(rep.savingsRate)}</p></li><li><p>Days in cycle</p><p>${cy.days}</p></li><li><p>Average daily spending</p><p>${mBase(rep.avgDaily)}</p></li></ul>
  </section>`;
  return shell('Budget', body, { band: cycleNav(cy) });
}

// ---- cards (BG-06) ----------------------------------------------------------------------
function viewCards() {
  const s = S(), today = todayISO(), A = acctById();
  const view = ui.planView || today.slice(0, 7);
  const list = E.cards(s, today);
  const ps = E.plansSummary(s, Number(view.slice(0, 4)), Number(view.slice(5, 7)));
  const cardAccts = s.accounts.filter((a) => a.type === 'Credit Card' && !a.archived);
  const body = `
  <section class="card"><h2>Cards</h2>
    ${list.length ? `<ul class="list">${list.map((c) => `<li><div><p class="t">${esc(c.name)}</p><p class="note">${c.sharedLimit ? `Shared limit ${money(c.sharedLimit, 'IDR')} (${esc(c.groupName)})` : c.limit !== null ? `Limit ${money(c.limit, 'IDR')}` : 'No limit entered'}${c.util !== null ? ` · ${pct(c.util)} used · ${money(c.available, 'IDR')} available` : ''}</p></div><div class="r"><p class="t">${money(c.outstanding, 'IDR')}</p>${statusChip(c.status)}</div></li>`).join('')}</ul>` : '<p class="note">No credit card accounts. Add one in Setup with type Credit Card.</p>'}
  </section>
  <section class="card"><div class="sechead"><h2>Instalment plans</h2></div>
    <label class="field"><span class="l">View month</span><input type="month" value="${view}" data-chg="planview"></label>
    <div class="grid3">
      <div class="field"><span class="l">Outstanding</span><p class="v">${money(ps.outstanding, 'IDR')}</p></div>
      <div class="field"><span class="l">Per month</span><p class="v">${money(ps.monthly, 'IDR')}</p></div>
      <div class="field"><span class="l">Active / completed</span><p class="v">${ps.activeCount} / ${ps.completedCount}</p></div>
    </div>
    <ul class="list">${ps.rows.map((p) => `<li><div><p class="t">${esc(p.item)}</p><p class="note">${esc(A[p.card]?.name || 'No card')} · ${money(p.monthly, 'IDR')} × ${p.tenor} · ${p.paid} paid · ${esc(p.startMonth)} to ${esc(p.endMonth)}</p></div><div class="r"><p class="t">${money(p.remaining, 'IDR')}</p>${statusChip(p.status === 'Active' ? '' : 'Completed')}<button type="button" class="link" data-act="del-plan" data-id="${esc(p.id)}" aria-label="Delete plan ${esc(p.item)}">Delete</button></div></li>`).join('') || '<li><p class="note">No plans yet.</p></li>'}</ul>
  </section>
  ${cardAccts.length ? `<form data-form="plan" class="card form"><h2>Add a plan</h2>
    <label class="field"><span class="l">Item</span><input name="item" required></label>
    <label class="field"><span class="l">Card</span><select name="card">${cardAccts.map((a) => opt(a.id, a.name, '')).join('')}</select></label>
    <label class="field"><span class="l">Purchase date</span><input type="date" name="date" value="${today}" required></label>
    <label class="field"><span class="l">Total (IDR)</span><input name="total" inputmode="decimal" required></label>
    <label class="field"><span class="l">Tenor (months)</span><input name="tenor" inputmode="numeric" required></label>
    <label class="field"><span class="l">Monthly payment, optional (IDR)</span><input name="monthly" inputmode="decimal" placeholder="Leave empty for total ÷ tenor"></label>
    <p class="note">A plan is a tracker. Log the purchase itself as an expense on the card.</p>
    <button type="submit" class="pill solid">Add plan</button></form>` : ''}`;
  return shell('Cards', body, { back: '/more' });
}

// ---- more & setup (BG-01) -----------------------------------------------------------------
const menu = (items) => `<section class="card"><ul class="list">${items.map(([href, t, n]) => `<li><a class="txrow" href="#${href}"><div><p class="t">${t}</p><p class="note">${n}</p></div><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></a></li>`).join('')}</ul></section>`;
function viewMore() {
  const s = S();
  return shell('More', menu([
    ['/cards', 'Credit cards and instalments', 'Limits, utilisation, plans'],
    ['/setup/accounts', 'Accounts', `${s.accounts.filter((a) => !a.archived).length} active`],
    ['/setup/categories', 'Categories', `${s.categories.filter((k) => !k.archived).length} active`],
    ['/setup/rates', 'Currencies and rates', `Base currency ${esc(base())}`],
    ['/setup/cycle', 'Pay cycle and framework', `Starts on day ${s.anchorDay} · ${esc(s.framework || '')}`],
    ['/data', 'Import, export, backup', s.meta.lastBackup ? `Last backup ${niceDate(s.meta.lastBackup)}` : 'No backup yet'],
  ]));
}
const ACCT_TYPES = ['Bank', 'E-Wallet', 'Credit Card', 'Valas', 'RDN', 'Cash', 'Electronic card money'];
function viewAccounts(editId) {
  const s = S();
  const a = editId === 'new' ? { name: '', type: 'Bank', ccy: base(), opening: 0 } : s.accounts.find((x) => x.id === editId);
  if (a) {
    const isCard = (ui.f?.type || a.type) === 'Credit Card';
    return shell(editId === 'new' ? 'New account' : 'Edit account', `<form data-form="acct" class="card form">
      <input type="hidden" name="id" value="${esc(editId)}">
      <label class="field"><span class="l">Name</span><input name="name" required value="${esc(a.name)}"></label>
      <label class="field"><span class="l">Type</span><select name="type" data-chg="rerender-form">${ACCT_TYPES.map((t) => opt(t, t, ui.f?.type || a.type)).join('')}</select></label>
      <label class="field"><span class="l">Currency</span><select name="ccy">${currencies().map((x) => opt(x, x, a.ccy)).join('')}</select></label>
      <label class="field"><span class="l">${isCard ? 'Amount owed at the start' : 'Opening balance'}</span><input name="opening" inputmode="decimal" value="${isCard ? Math.abs(a.opening || 0) : a.opening || 0}"></label>
      ${isCard ? `<label class="field"><span class="l">Own limit (IDR), optional</span><input name="limit" inputmode="decimal" value="${a.limit ?? ''}"></label>
      <label class="field"><span class="l">Shared limit group</span><select name="group">${opt('', 'None', a.group || '')}${s.groups.map((g) => opt(g.id, `${g.name} (${money(g.limit, 'IDR')})`, a.group || '')).join('')}</select></label>` : ''}
      ${editId !== 'new' ? `<label class="check"><input type="checkbox" name="archived"${a.archived ? ' checked' : ''}> Archived (kept in history, hidden from pickers)</label>` : ''}
      ${ui.err ? `<div class="warnbox" role="alert"><p>${esc(ui.err)}</p></div>` : ''}
      <button type="submit" class="pill solid">Save</button></form>`, { back: '/setup/accounts' });
  }
  return shell('Accounts', `<a class="pill solid" href="#/setup/accounts/new">Add account</a>
    <section class="card"><ul class="list">${s.accounts.map((x) => `<li><a class="txrow" href="#/setup/accounts/${esc(x.id)}"><div><p class="t">${esc(x.name)}</p><p class="note">${esc(x.type)} · ${esc(x.ccy)}${x.archived ? ' · archived' : ''}</p></div><p class="t">${money(x.opening || 0, x.ccy)}</p></a></li>`).join('') || '<li><p class="note">No accounts yet.</p></li>'}</ul></section>
    <form data-form="group" class="card form"><h2>Shared limit groups</h2>
      <ul class="list">${s.groups.map((g) => `<li><div><p class="t">${esc(g.name)}</p><p class="note">${money(g.limit, 'IDR')}</p></div><button type="button" class="link" data-act="del-group" data-id="${esc(g.id)}">Delete</button></li>`).join('') || '<li><p class="note">None. Use a group when two cards share one limit.</p></li>'}</ul>
      <label class="field"><span class="l">Group name</span><input name="name" required></label>
      <label class="field"><span class="l">Shared limit (IDR)</span><input name="limit" inputmode="decimal" required></label>
      <button type="submit" class="pill soft">Add group</button></form>`, { back: '/more' });
}
function viewCategories(editId) {
  const s = S();
  const k = editId === 'new' ? { name: '', type: 'Expense', tier: 'Needs' } : s.categories.find((x) => x.id === editId);
  if (k) {
    const type = ui.f?.type || k.type;
    return shell(editId === 'new' ? 'New category' : 'Edit category', `<form data-form="cat" class="card form">
      <input type="hidden" name="id" value="${esc(editId)}">
      <label class="field"><span class="l">Name</span><input name="name" required value="${esc(k.name)}"></label>
      <label class="field"><span class="l">Type</span><select name="type" data-chg="rerender-form">${['Expense', 'Income', 'Transfer'].map((t) => opt(t, t, type)).join('')}</select></label>
      ${type === 'Expense' ? `<label class="field"><span class="l">Tier</span><select name="tier">${E.TIERS.map((t) => opt(t, t, k.tier)).join('')}</select></label>` : ''}
      ${editId !== 'new' ? `<label class="check"><input type="checkbox" name="archived"${k.archived ? ' checked' : ''}> Archived</label>` : ''}
      ${ui.err ? `<div class="warnbox" role="alert"><p>${esc(ui.err)}</p></div>` : ''}
      <button type="submit" class="pill solid">Save</button></form>`, { back: '/setup/categories' });
  }
  return shell('Categories', `<a class="pill solid" href="#/setup/categories/new">Add category</a>
    <section class="card"><ul class="list">${s.categories.map((x) => `<li><a class="txrow" href="#/setup/categories/${esc(x.id)}"><div><p class="t">${esc(x.name)}</p><p class="note">${esc(x.type)}${x.type === 'Expense' ? ` · ${esc(x.tier)}` : ''}${x.archived ? ' · archived' : ''}</p></div></a></li>`).join('')}</ul></section>`, { back: '/more' });
}
function viewRates() {
  const s = S();
  return shell('Currencies and rates', `<form data-form="rates" class="card form">
    <label class="field"><span class="l">Base currency for totals and budgets</span><select name="base">${currencies().map((x) => opt(x, x, base())).join('')}</select></label>
    <h2>Rate Table: IDR per 1 unit</h2>
    ${currencies().filter((x) => x !== 'IDR').map((x) => `<label class="field"><span class="l">${esc(x)}${s.ratesUpdated?.[x] ? ` · updated ${niceDate(s.ratesUpdated[x])}` : ''}</span><input name="r:${esc(x)}" inputmode="decimal" value="${s.rates[x]}"></label>`).join('')}
    <p class="note">IDR is fixed at 1. Changing a rate changes every IDR value that has no Billed IDR.</p>
    <label class="field"><span class="l">Add a currency (three letters), optional</span><input name="newccy" maxlength="3" placeholder="e.g. GBP"></label>
    <label class="field"><span class="l">Its rate in IDR</span><input name="newrate" inputmode="decimal"></label>
    <label class="field"><span class="l">Investments value (IDR), entered by hand</span><input name="invest" inputmode="decimal" value="${s.investmentsIdr || 0}"></label>
    ${ui.err ? `<div class="warnbox" role="alert"><p>${esc(ui.err)}</p></div>` : ''}
    <button type="submit" class="pill solid">Save</button></form>`, { back: '/more' });
}
function viewCycle() {
  const s = S();
  const fw = s.frameworks.find((f) => f.name === s.framework) || s.frameworks[0];
  return shell('Pay cycle and framework', `<form data-form="cycle" class="card form">
    <h2>Pay cycle</h2>
    <label class="field"><span class="l">Anchor Day: the day a cycle normally starts</span><input name="anchor" inputmode="numeric" value="${s.anchorDay}"></label>
    <p class="note">A cycle is named after the month it starts in. If payday moves in one month, add an Override Date for that month.</p>
    <ul class="list">${Object.entries(s.overrides).sort().map(([k, d]) => `<li><div><p class="t">${esc(k)}</p><p class="note">starts ${niceDate(d)}</p></div><button type="button" class="link" data-act="del-override" data-id="${esc(k)}">Delete</button></li>`).join('') || '<li><p class="note">No overrides.</p></li>'}</ul>
    <label class="field"><span class="l">Override: cycle month</span><input type="month" name="omonth"></label>
    <label class="field"><span class="l">Override: start date</span><input type="date" name="odate"></label>
    <h2>Framework</h2>
    <label class="field"><span class="l">Active framework</span><select name="framework" data-chg="framework">${s.frameworks.map((f) => opt(f.name, f.name, s.framework)).join('')}</select></label>
    <div class="row2">${E.TIERS.map((t) => `<label class="field"><span class="l">${t} %</span><input name="fw:${t.toLowerCase()}" inputmode="decimal" value="${Math.round((fw?.[t.toLowerCase()] || 0) * 1000) / 10}"></label>`).join('')}</div>
    ${ui.err ? `<div class="warnbox" role="alert"><p>${esc(ui.err)}</p></div>` : ''}
    <button type="submit" class="pill solid">Save</button></form>`, { back: '/more' });
}

// ---- data: import, export, backup (BG-07, BG-08, BG-09) --------------------------------------
function viewData() {
  const s = S(), sum = ui.summary, rec = ui.recon;
  const recHtml = rec ? `<section class="card"><h2>Reconciliation with the workbook</h2>
    <p class="note">${rec.filter((r) => Math.abs(r.diff) < 0.01).length} of ${rec.length} account balances match the workbook.</p>
    <ul class="list">${rec.filter((r) => Math.abs(r.diff) >= 0.01).map((r) => `<li><div><p class="t">${esc(r.name)}</p><p class="note">App ${money(r.app, r.ccy)} · workbook ${money(r.workbook, r.ccy)}. ${esc(r.note)}${r.rows.length ? ` Rows: ${r.rows.map((x) => x.row).filter(Boolean).join(', ')}.` : ''}</p></div><p class="t">${money(r.diff, r.ccy)}</p></li>`).join('') || '<li><p class="note">No differences.</p></li>'}</ul></section>` : '';
  const sumHtml = sum ? `<section class="card"><h2>Import summary</h2>
    <ul class="list plain"><li><p>Accounts</p><p>${sum.accounts}</p></li><li><p>Categories</p><p>${sum.categories}</p></li><li><p>Transactions</p><p>${sum.transactions}</p></li><li><p>Date range</p><p>${esc(sum.from)} to ${esc(sum.to)}</p></li><li><p>Instalment plans</p><p>${sum.plans}</p></li><li><p>Transfers linked</p><p>${sum.transfersLinked}</p></li><li><p>Transfer legs left single</p><p>${sum.transfersUnpaired}</p></li><li><p>Rows with a date but no amount</p><p>${sum.emptyRows}</p></li></ul>
    ${sum.overridesFound.length ? `<p class="note">Override dates found and not imported, because the workbook's budget sheet does not use them: ${esc(sum.overridesFound.join('; '))}. Add them under Pay cycle if you want them.</p>` : ''}
    ${sum.skipped.length ? `<h3>Skipped rows</h3><ul class="bul">${sum.skipped.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${sum.flagged.length ? `<h3>Rows to review</h3><ul class="bul">${sum.flagged.slice(0, 40).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${sum.flagged.length > 40 ? `<p class="note">and ${sum.flagged.length - 40} more.</p>` : ''}` : ''}
    </section>` : '';
  const body = `${sumHtml}${recHtml}
  <section class="card"><h2>Backup</h2>
    <p class="p">${s?.meta.lastBackup ? `Last backup ${niceDate(s.meta.lastBackup)}.` : 'No backup yet.'} A backup is one file holding everything.</p>
    <button type="button" class="pill solid" data-act="backup">Save backup file</button>
    <label class="pill soft filebtn">Restore from a backup file<input type="file" accept="application/json,.json" data-file="restore"></label>
  </section>
  <section class="card"><h2>Excel</h2>
    <button type="button" class="pill soft" data-act="export">Export to Excel</button>
    <label class="pill soft filebtn">Import a workbook (.xlsx)<input type="file" accept=".xlsx" data-file="import"></label>
    <p class="note">The file is read on this device. It is not uploaded.</p>
  </section>
  <section class="card"><h2>App lock</h2>
    ${lockSupported() ? (lockEnabled() ? '<p class="p">The app asks for your fingerprint or screen lock when it opens.</p><button type="button" class="pill soft" data-act="lock-off">Turn off</button>' : '<p class="p">Ask for your fingerprint or screen lock when the app opens.</p><button type="button" class="pill soft" data-act="lock-on">Turn on</button>') : '<p class="note">This browser does not offer fingerprint unlock for web apps.</p>'}
    <p class="note">The lock hides the screen. It does not encrypt the data stored on the device.</p>
  </section>
  <section class="card"><h2>Reset</h2>
    ${s?.meta.demo ? '<button type="button" class="pill soft" data-act="leave-demo">Leave Demo Mode</button>' : ''}
    <button type="button" class="pill danger" data-act="reset">Erase all data on this device</button>
  </section>`;
  return shell('Import, export, backup', body, { back: '/more' });
}

// ---- render ------------------------------------------------------------------------------------
let locked = lockEnabled();
function render() {
  const r = route();
  let html;
  if (locked) html = `<header class="band"><div class="wrap"><div class="topbar"><h1>Budget</h1></div></div></header><main class="wrap"><section class="card"><h2>Locked</h2><button type="button" class="pill solid" data-act="unlock">Unlock</button>${ui.err ? `<p class="note">${esc(ui.err)}</p>` : ''}</section></main>`;
  else if (!S() && r !== '/data') html = viewWelcome();
  else if (!S()) { store.state = emptyState(); html = viewData(); }
  else if (r === '/') html = viewHome();
  else if (r === '/tx') html = viewTx();
  else if (r === '/add') html = viewForm('');
  else if (r.startsWith('/edit/')) html = viewForm(decodeURIComponent(r.slice(6)));
  else if (r === '/budget') html = viewBudget();
  else if (r === '/cards') html = viewCards();
  else if (r === '/more') html = viewMore();
  else if (r.startsWith('/setup/accounts')) html = viewAccounts(decodeURIComponent(r.split('/')[3] || ''));
  else if (r.startsWith('/setup/categories')) html = viewCategories(decodeURIComponent(r.split('/')[3] || ''));
  else if (r === '/setup/rates') html = viewRates();
  else if (r === '/setup/cycle') html = viewCycle();
  else if (r === '/data') html = viewData();
  else html = viewHome();
  const keep = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.inp;
  app.innerHTML = html;
  if (keep) { const el = app.querySelector(`[data-inp="${keep}"]`); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }
  ui.msg = '';
}
let lastRoute = '';
window.addEventListener('hashchange', () => {
  if (route() !== lastRoute) { ui.f = null; ui.err = ''; ui.formType = ''; ui.editBudget = false; window.scrollTo(0, 0); }
  lastRoute = route(); render();
});

const numIn = (v) => { const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : NaN; };
const formData = (form) => Object.fromEntries(new FormData(form).entries());
const commit = async (msg) => { await store.save(); ui.cy = null; if (msg) ui.msg = msg; };
const download = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); };
const loadExcel = async () => { const m = await import('exceljs/dist/exceljs.min.js'); return m.default || m; };

// ---- events --------------------------------------------------------------------------------------
app.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target, f = formData(form), s = S();
  ui.err = '';
  try {
    if (form.dataset.form === 'tx') {
      if (!f.date) throw new Error('Pick a date.');
      const existing = f.id ? s.tx.find((t) => t.id === f.id) : null;
      if (f.type === 'Transfer' && f.from !== undefined) {
        const feeCat = s.categories.find((k) => k.name === 'Admin Fee' && k.type === 'Expense') || s.categories.find((k) => k.type === 'Expense');
        if (numIn(f.fee) > 0 && !feeCat) throw new Error('Add an expense category for the fee first.');
        if (!f.cat) throw new Error('Add a Transfer category first.');
        const legs = E.buildTransfer(s, { date: f.date, from: f.from, to: f.to, sent: numIn(f.sent), received: numIn(f.received), fee: numIn(f.fee) || 0, cat: f.cat, feeCat: feeCat?.id, desc: f.desc, notes: f.notes }, newId);
        if (existing?.link) s.tx = s.tx.filter((t) => t.link !== existing.link);
        s.tx.push(...legs);
      } else {
        const amt = numIn(f.amt), billed = f.billed ? numIn(f.billed) : NaN;
        if (!(amt > 0) && !(billed > 0)) throw new Error('Enter an amount.');
        if (!f.cat) throw new Error('Pick a category. Add one in Setup if the list is empty.');
        const sign = f.type === 'Income' || (f.type === 'Transfer' && f.dir === 'in') ? 1 : -1;
        const t = { ...(existing || {}), id: existing?.id || newId(), date: f.date, desc: f.desc || '', cat: f.cat, type: f.type, acct: f.acct, ccy: f.ccy, amt: amt > 0 ? sign * amt : null, billed: billed > 0 ? sign * billed : null, notes: f.notes || '' };
        delete t.flag;
        if (E.resolveAmount(s, t).missingRate) throw new Error(`There is no rate for ${f.ccy}. Add it under Currencies and rates, or enter the Billed IDR.`);
        if (existing) s.tx[s.tx.indexOf(existing)] = t; else s.tx.push(t);
      }
      await commit('Saved.'); ui.f = null; ui.formType = '';
      history.length > 1 && route() !== '/add' ? go('/tx') : go('/');
      return;
    }
    if (form.dataset.form === 'budget') {
      const cy = curCycle(), key = cy.key;
      const next = { ...E.budgetFor(s, key) };
      for (const [k, v] of Object.entries(f)) if (k.startsWith('b:')) { const n = numIn(v); if (v === '' || n === 0) delete next[k.slice(2)]; else if (n > 0) next[k.slice(2)] = n; else throw new Error('Budgets must be positive numbers.'); }
      s.budgets[key] = next; ui.editBudget = false; const keepCy = cy; await commit('Budgets saved.'); ui.cy = keepCy;
    }
    if (form.dataset.form === 'plan') {
      const total = numIn(f.total), tenor = Math.round(numIn(f.tenor));
      if (!(total > 0) || !(tenor > 0)) throw new Error('Enter a total and a tenor.');
      s.plans.push({ id: newId(), item: f.item, card: f.card, date: f.date, total, tenor, monthly: f.monthly ? numIn(f.monthly) : null });
      await commit('Plan added.');
    }
    if (form.dataset.form === 'acct') {
      const name = f.name.trim();
      if (!name) throw new Error('Enter a name.');
      if (s.accounts.some((a) => a.name.toLowerCase() === name.toLowerCase() && a.id !== f.id)) throw new Error('An account with this name already exists.');
      const isCard = f.type === 'Credit Card';
      const opening = numIn(f.opening) || 0;
      const a = f.id === 'new' ? { id: newId() } : s.accounts.find((x) => x.id === f.id);
      Object.assign(a, { name, type: f.type, ccy: f.ccy, opening: isCard ? 0 - Math.abs(opening) : opening, archived: f.archived === 'on' });
      if (isCard) { a.limit = f.limit ? numIn(f.limit) : null; a.group = f.group || ''; } else { delete a.limit; delete a.group; }
      if (f.id === 'new') s.accounts.push(a);
      await commit('Saved.'); go('/setup/accounts'); return;
    }
    if (form.dataset.form === 'group') {
      if (!(numIn(f.limit) > 0)) throw new Error('Enter the shared limit.');
      s.groups.push({ id: newId(), name: f.name.trim(), limit: numIn(f.limit) }); await commit('Group added.');
    }
    if (form.dataset.form === 'cat') {
      const name = f.name.trim();
      if (!name) throw new Error('Enter a name.');
      if (s.categories.some((k) => k.name.toLowerCase() === name.toLowerCase() && k.id !== f.id)) throw new Error('A category with this name already exists.');
      const k = f.id === 'new' ? { id: newId() } : s.categories.find((x) => x.id === f.id);
      Object.assign(k, { name, type: f.type, tier: f.type === 'Expense' ? f.tier : f.type, archived: f.archived === 'on' });
      if (f.id === 'new') s.categories.push(k);
      await commit('Saved.'); go('/setup/categories'); return;
    }
    if (form.dataset.form === 'rates') {
      const today = todayISO();
      for (const [k, v] of Object.entries(f)) if (k.startsWith('r:')) {
        const n = numIn(v); if (!(n > 0)) throw new Error(`Enter a rate for ${k.slice(2)}.`);
        if (n !== s.rates[k.slice(2)]) { s.rates[k.slice(2)] = n; s.ratesUpdated[k.slice(2)] = today; }
      }
      if (f.newccy) {
        const ccy = f.newccy.trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(ccy) || !(numIn(f.newrate) > 0)) throw new Error('A new currency needs three letters and a rate.');
        s.rates[ccy] = numIn(f.newrate); s.ratesUpdated[ccy] = today;
      }
      if (f.base !== s.base) {
        // Budgets are stored in the base currency; convert them when the base changes.
        const from = E.rateOf(s, s.base), to = E.rateOf(s, f.base);
        for (const set of Object.values(s.budgets)) for (const k of Object.keys(set)) set[k] = Math.round((set[k] * from / to) * 100) / 100;
        s.base = f.base;
      }
      s.investmentsIdr = numIn(f.invest) || 0;
      await commit('Saved.');
    }
    if (form.dataset.form === 'cycle') {
      const anchor = Math.round(numIn(f.anchor));
      if (!(anchor >= 1 && anchor <= 31)) throw new Error('Anchor Day must be between 1 and 31.');
      const fw = s.frameworks.find((x) => x.name === f.framework);
      const shares = Object.fromEntries(E.TIERS.map((t) => [t.toLowerCase(), numIn(f[`fw:${t.toLowerCase()}`]) / 100]));
      const total = Object.values(shares).reduce((a, b) => a + b, 0);
      if (Math.abs(total - 1) > 0.0005) throw new Error(`Framework shares must add up to 100%. They add up to ${(total * 100).toFixed(1)}%.`);
      s.anchorDay = anchor; s.framework = f.framework; Object.assign(fw, shares);
      if (f.omonth && f.odate) s.overrides[f.omonth] = f.odate;
      await commit('Saved.');
    }
  } catch (err) { ui.err = err.message || String(err); ui.f = f; }
  render();
});

app.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act, s = S(), today = todayISO();
  if (act === 'unlock') { try { await unlock(); locked = false; ui.err = ''; } catch { ui.err = 'Unlock did not complete. Try again.'; } return render(); }
  if (act === 'start-empty') { await store.replace(emptyState()); return go('/setup/accounts'); }
  if (act === 'start-demo') { await store.replace(demoState(today)); return go('/'); }
  if (act === 'start-import') return;
  if (act === 'leave-demo') { if (confirm('Remove all sample data?')) { await store.clear(); ui.summary = ui.recon = null; go('/'); } return; }
  if (act === 'cycle') { const cy = curCycle(); let m = cy.m + Number(el.dataset.step), y = cy.y; if (m === 0) { m = 12; y--; } if (m === 13) { m = 1; y++; } ui.cy = E.cycle(s, y, m); return render(); }
  if (act === 'more-tx') { ui.limit += 200; return render(); }
  if (act === 'formtype') { ui.formType = el.dataset.type; ui.f = null; return render(); }
  if (act === 'toggle-budget') { ui.editBudget = !ui.editBudget; return render(); }
  if (act === 'del-tx') {
    const t = s.tx.find((x) => x.id === el.dataset.id);
    if (t && confirm(t.link ? 'Delete this transfer and its linked entries?' : 'Delete this transaction?')) { s.tx = s.tx.filter((x) => (t.link ? x.link !== t.link : x.id !== t.id)); await commit('Deleted.'); go('/tx'); }
    return;
  }
  if (act === 'del-plan') { if (confirm('Delete this plan?')) { s.plans = s.plans.filter((p) => p.id !== el.dataset.id); await commit(); render(); } return; }
  if (act === 'del-group') { s.groups = s.groups.filter((g) => g.id !== el.dataset.id); s.accounts.forEach((a) => { if (a.group === el.dataset.id) a.group = ''; }); await commit(); return render(); }
  if (act === 'del-override') { delete s.overrides[el.dataset.id]; await commit(); return render(); }
  if (act === 'backup') {
    s.meta.lastBackup = today; s.meta.dirty = false; await store.save(false);
    download(new Blob([JSON.stringify({ app: 'budget', version: 1, exported: today, state: s })], { type: 'application/json' }), `budget-backup-${today}.json`);
    ui.msg = 'Backup file saved. Keep a copy outside this phone.'; return render();
  }
  if (act === 'export') {
    try { const { exportWorkbook } = await import('./xlsx.js'); const buf = await exportWorkbook(s, await loadExcel(), today);
      download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `budget-export-${today}.xlsx`); ui.msg = 'Excel file created.'; }
    catch (err) { ui.msg = `Export failed: ${err.message}`; }
    return render();
  }
  if (act === 'reset') { if (confirm('Erase everything on this device? Make a backup first if you need the data.')) { await store.clear(); ui.summary = ui.recon = null; go('/'); } return; }
  if (act === 'lock-on') { try { await enableLock(); ui.msg = 'App lock is on.'; } catch (err) { ui.msg = `Could not turn the lock on: ${err.message}`; } return render(); }
  if (act === 'lock-off') { disableLock(); ui.msg = 'App lock is off.'; return render(); }
});

app.addEventListener('change', async (ev) => {
  const el = ev.target, s = S();
  if (el.dataset.file) {
    const file = el.files && el.files[0]; if (!file) return;
    try {
      if (el.dataset.file === 'restore') {
        const data = JSON.parse(await file.text());
        if (data.app !== 'budget' || !data.state) throw new Error('This is not a Budget backup file.');
        const st = data.state;
        if (!confirm(`Replace everything with the backup from ${data.exported}? It holds ${st.accounts.length} accounts and ${st.tx.length} transactions.`)) return;
        await store.replace(st); ui.cy = null; ui.msg = 'Backup restored.';
      } else {
        if (s && s.tx.length && !confirm('This app already holds data. Replace it with the workbook?')) return;
        ui.msg = 'Reading the workbook…'; render();
        const { importWorkbook, reconcile } = await import('./xlsx.js');
        const res = await importWorkbook(await file.arrayBuffer(), await loadExcel());
        res.state.meta = { demo: false, lastBackup: '', dirty: true, cards: {} };
        await store.replace(res.state); await store.save();
        ui.cy = null; ui.summary = res.summary; ui.recon = reconcile(res.state, res.workbookBalances, todayISO()); ui.msg = 'Workbook imported.';
      }
    } catch (err) { ui.msg = err.message || String(err); }
    return render();
  }
  const chg = el.dataset.chg;
  if (!chg) return;
  if (chg === 'filter-acct') ui.filter.acct = el.value;
  if (chg === 'filter-cat') ui.filter.cat = el.value;
  if (chg === 'asof') ui.asOf = el.value;
  if (chg === 'planview') ui.planView = el.value;
  if (chg === 'rerender-form' || chg === 'acct-ccy') {
    ui.f = formData(el.form);
    if (chg === 'acct-ccy') ui.f.ccy = acctById()[el.value]?.ccy || ui.f.ccy;
  }
  if (chg === 'framework') { s.framework = el.value; await store.save(); }
  render();
});
app.addEventListener('input', (ev) => { if (ev.target.dataset.inp === 'q') { ui.q = ev.target.value; ui.limit = 100; render(); } });

// App lock also applies when the app comes back from the background, not only on a cold start.
// A short grace period keeps the file picker and other system sheets from locking mid-task.
const LOCK_GRACE_MS = 30000;
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
  if (lockEnabled() && !locked && hiddenAt && Date.now() - hiddenAt > LOCK_GRACE_MS) { locked = true; ui.err = ''; render(); }
});

(async function init() {
  await store.load();
  lastRoute = route();
  render();
})();
