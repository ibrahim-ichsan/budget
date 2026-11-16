// Import of the owner's workbook layout (financial_budget v9) and export back to .xlsx (BG-07).
// The file is read on the device. Nothing is uploaded.
import * as E from './engine.js';

const val = (cell) => {
  let v = cell ? cell.value : null;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) v = v.result;
    else if ('richText' in v) v = v.richText.map((r) => r.text).join('');
    else if ('text' in v) v = v.text;
    else if ('formula' in v || 'sharedFormula' in v) v = null;
  }
  if (v && typeof v === 'object' && !(v instanceof Date) && 'error' in v) v = null;
  return v === undefined ? null : v;
};
const str = (v) => (v === null ? '' : String(v).trim());
const num = (v) => (v === null || v === '' || isNaN(Number(v)) ? null : Number(v));
const day = (v) => {
  if (v instanceof Date) return new Date(v.getTime() + 12 * 3600 * 1000).toISOString().slice(0, 10);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return null;
};
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const r2 = (n) => Math.round(n * 100) / 100;

export async function importWorkbook(buffer, ExcelJS) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const need = (name) => {
    const ws = wb.getWorksheet(name);
    if (!ws) throw new Error(`Import stopped: sheet "${name}" is missing.`);
    return ws;
  };
  const setup = need('Setup'), dt = need('Daily Tracker');
  const mb = wb.getWorksheet('Monthly Budget'), cc = wb.getWorksheet('Credit Card');
  const dash = wb.getWorksheet('Dashboard'), assets = wb.getWorksheet('Assets');
  if (str(val(setup.getCell('A4'))) !== 'Account Name') throw new Error('Import stopped: sheet "Setup" does not have its header row where expected.');
  if (str(val(dt.getCell('A2'))) !== 'Date') throw new Error('Import stopped: sheet "Daily Tracker" does not have its header row where expected.');

  const skipped = [], flagged = [];
  const used = new Set();
  const uid = (prefix, name) => {
    let id = `${prefix}-${slug(name) || 'x'}`, n = 2;
    while (used.has(id)) id = `${prefix}-${slug(name)}-${n++}`;
    used.add(id); return id;
  };

  // Rates
  const rates = { IDR: 1 }, ratesUpdated = {};
  for (let r = 6; r <= 12; r++) {
    const ccy = str(val(setup.getCell(`Q${r}`))), rate = num(val(setup.getCell(`R${r}`)));
    if (/^[A-Z]{3}$/.test(ccy) && rate) { rates[ccy] = ccy === 'IDR' ? 1 : rate; ratesUpdated[ccy] = day(val(setup.getCell(`S${r}`))) || ''; }
  }

  // Accounts
  const accounts = [];
  for (let r = 5; r <= 80; r++) {
    const name = str(val(setup.getCell(`A${r}`)));
    if (!name) continue;
    accounts.push({ id: uid('a', name), name, type: str(val(setup.getCell(`B${r}`))) || 'Bank', ccy: str(val(setup.getCell(`D${r}`))) || 'IDR', opening: num(val(setup.getCell(`C${r}`))) || 0 });
  }
  const acctByName = Object.fromEntries(accounts.map((a) => [a.name, a]));

  // Categories and tiers
  const tierOf = {};
  for (let r = 5; r <= 80; r++) {
    const k = str(val(setup.getCell(`N${r}`))); if (k) tierOf[k] = str(val(setup.getCell(`O${r}`)));
  }
  const categories = [];
  for (let r = 5; r <= 80; r++) {
    const name = str(val(setup.getCell(`E${r}`)));
    if (!name) continue;
    const type = str(val(setup.getCell(`F${r}`))) || 'Expense';
    categories.push({ id: uid('c', name), name, type, tier: type === 'Expense' ? (tierOf[name] || 'Wants') : type });
  }
  const catByName = Object.fromEntries(categories.map((k) => [k.name, k]));

  // Pay cycle
  const anchorDay = num(val(setup.getCell('I4'))) || 1;
  // Override Dates are listed in the summary but not imported: the workbook's own budget sheet
  // does not use them, and importing them would change cycle dates the owner never saw.
  const overrides = {};
  const overridesFound = [];
  for (let r = 11; r <= 18; r++) {
    const y = num(val(setup.getCell(`H${r}`))), m = num(val(setup.getCell(`I${r}`))), d = day(val(setup.getCell(`J${r}`)));
    if (y && m && d) overridesFound.push(`${E.cycleKey(y, m)} starts ${d}`);
  }

  // Frameworks
  const frameworks = [];
  for (let r = 32; r <= 40; r++) {
    const name = str(val(setup.getCell(`H${r}`))), needs = num(val(setup.getCell(`I${r}`)));
    if (name && needs !== null && name !== 'Active %' && name !== 'Tier') {
      frameworks.push({ name, needs, wants: num(val(setup.getCell(`J${r}`))) || 0, savings: num(val(setup.getCell(`K${r}`))) || 0, giving: num(val(setup.getCell(`L${r}`))) || 0 });
    }
  }
  const framework = str(val(setup.getCell('I28'))) || (frameworks[0] && frameworks[0].name) || '';

  // Shared limit groups and card limits
  const groups = [];
  for (const r of [22, 24]) {
    const name = str(val(setup.getCell(`H${r}`))), limit = num(val(setup.getCell(`I${r}`)));
    if (name && limit) groups.push({ id: uid('g', name), name, limit });
  }
  if (cc) {
    for (let r = 40; r <= 60; r++) {
      const a = acctByName[str(val(cc.getCell(`A${r}`)))];
      if (!a) continue;
      const lim = val(cc.getCell(`B${r}`));
      if (typeof lim === 'number') a.limit = lim;
      else {
        const m = /shared\s+([\d.,]+)\s*jt/i.exec(str(lim));
        if (m) { const g = groups.find((x) => x.limit === Number(m[1].replace(',', '.')) * 1e6); if (g) a.group = g.id; }
      }
    }
  }

  // Transactions
  const tx = [];
  let n = 0, emptyRows = 0;
  dt.eachRow((row, r) => {
    if (r < 3) return;
    const date = day(val(row.getCell(1)));
    const amt = num(val(row.getCell(7))), billed = num(val(row.getCell(8)));
    if (!date && amt === null && billed === null) return;
    const desc = str(val(row.getCell(2)));
    const where = `Daily Tracker row ${r}`;
    if (!date) { skipped.push(`${where}: no date`); return; }
    if (amt === null && billed === null) { emptyRows++; return; }
    const cat = catByName[str(val(row.getCell(3)))], acct = acctByName[str(val(row.getCell(5)))];
    const type = str(val(row.getCell(4)));
    if (!acct) { skipped.push(`${where}: account "${str(val(row.getCell(5)))}" is not in Setup`); return; }
    if (!cat) { skipped.push(`${where}: category "${str(val(row.getCell(3)))}" is not in Setup`); return; }
    if (!['Income', 'Expense', 'Transfer'].includes(type)) { skipped.push(`${where}: type "${type}" is not valid`); return; }
    const t = { id: `t${++n}`, date, desc, cat: cat.id, type, acct: acct.id, ccy: str(val(row.getCell(6))) || acct.ccy, amt, billed, notes: str(val(row.getCell(13))), row: r };
    if (E.signCheck(t)) { t.flag = 'signs'; flagged.push(`${where}: Native Amount and Billed IDR have different signs`); }
    const sign = Math.sign(amt !== null ? amt : billed);
    if ((type === 'Expense' && sign > 0) || (type === 'Income' && sign < 0)) {
      t.flag = t.flag || 'direction';
      flagged.push(`${where}: ${type} with a ${sign > 0 ? 'positive' : 'negative'} amount (a refund, or a sign typed the wrong way)`);
    }
    tx.push(t);
  });

  const state = {
    v: 1, base: 'EUR', accounts, groups, categories, rates, ratesUpdated, anchorDay, overrides, framework, frameworks,
    budgets: { default: {} }, tx, plans: [], investmentsIdr: 0,
  };

  // Pair the two rows of a workbook transfer into one linked Transfer.
  const open = new Map();
  let link = 0, unpaired = 0;
  const keyOf = (t, withDesc) => `${t.date}|${withDesc ? t.desc : ''}|${Math.abs(E.idrCents(state, t))}`;
  for (const withDesc of [true, false]) {
    open.clear();
    for (const t of tx) {
      if (t.type !== 'Transfer' || t.link) continue;
      const k = keyOf(t, withDesc), sign = Math.sign(E.idrCents(state, t));
      const waiting = open.get(k) || [];
      const i = waiting.findIndex((o) => Math.sign(E.idrCents(state, o)) === -sign && o.acct !== t.acct);
      if (i >= 0) { const o = waiting.splice(i, 1)[0]; const id = `l${++link}`; o.link = id; t.link = id; }
      else { waiting.push(t); open.set(k, waiting); }
    }
  }
  // Third pass: cross-currency legs rarely carry the same IDR value. Pair same-day legs on different
  // accounts with opposite signs when their IDR values are within 5%.
  const loose = tx.filter((t) => t.type === 'Transfer' && !t.link);
  for (const t of loose) {
    if (t.link) continue;
    const v = E.idrCents(state, t);
    let best = null, bestGap = Infinity;
    for (const o of loose) {
      if (o === t || o.link || o.date !== t.date || o.acct === t.acct) continue;
      const w = E.idrCents(state, o);
      if (Math.sign(w) !== -Math.sign(v) || v === 0) continue;
      const gap = Math.abs(Math.abs(w) - Math.abs(v)) / Math.abs(v);
      if (gap <= 0.05 && gap < bestGap) { best = o; bestGap = gap; }
    }
    if (best) { const id = `l${++link}`; best.link = id; t.link = id; }
  }
  for (const t of tx) if (t.type === 'Transfer' && !t.link) { unpaired++; }

  // Budgets (workbook amounts are IDR; the app stores them in the base currency)
  if (mb) {
    const rate = rates[state.base] || 1;
    for (let r = 8; r <= 37; r++) {
      const k = catByName[str(val(mb.getCell(`A${r}`)))], b = num(val(mb.getCell(`C${r}`)));
      if (k && b) state.budgets.default[k.id] = r2(b / rate);
    }
  }

  // Instalment plans
  if (cc) {
    for (let r = 7; r <= 27; r++) {
      const item = str(val(cc.getCell(`A${r}`))), card = acctByName[str(val(cc.getCell(`B${r}`)))];
      const date = day(val(cc.getCell(`C${r}`))), total = num(val(cc.getCell(`D${r}`))), tenor = num(val(cc.getCell(`E${r}`)));
      if (!item || !date || !total || !tenor) continue;
      state.plans.push({ id: `p${r}`, item, card: card ? card.id : '', date, total, tenor, monthly: num(val(cc.getCell(`F${r}`))) });
    }
  }
  if (assets) state.investmentsIdr = num(val(assets.getCell('B28'))) || 0;

  // Workbook's own balances, for the reconciliation screen
  const workbookBalances = {};
  if (dash) {
    for (let r = 38; r <= 80; r++) {
      const a = acctByName[str(val(dash.getCell(`A${r}`)))], b = num(val(dash.getCell(`E${r}`)));
      if (a && b !== null) workbookBalances[a.id] = b;
    }
  }
  const dates = tx.map((t) => t.date).sort();
  return {
    state, workbookBalances,
    summary: { accounts: accounts.length, categories: categories.length, transactions: tx.length, from: dates[0] || '', to: dates[dates.length - 1] || '', plans: state.plans.length, transfersLinked: link, transfersUnpaired: unpaired, emptyRows, overridesFound, skipped, flagged },
  };
}

export function reconcile(state, workbookBalances, asOf) {
  const acct = Object.fromEntries(state.accounts.map((a) => [a.id, a]));
  const causes = {};
  for (const t of state.tx) {
    if (asOf && t.date > asOf) continue;
    const a = acct[t.acct]; const rate = a && E.rateOf(state, a.ccy);
    if (!a || !rate) continue;
    const workbookRule = E.resolveAmount(state, t).idr / rate;
    const gap = E.acctAmount(state, t, a) - workbookRule;
    if (Math.abs(gap) >= 0.005) (causes[a.id] = causes[a.id] || []).push({ row: t.row || null, date: t.date, gap: r2(gap) });
  }
  return E.balances(state, asOf)
    .filter((b) => b.id in workbookBalances)
    .map((b) => {
      const diff = r2(b.native - workbookBalances[b.id]);
      const rows = causes[b.id] || [];
      const explained = r2(rows.reduce((s, x) => s + x.gap, 0));
      let note = '';
      if (Math.abs(diff) >= 0.01) {
        if (Math.abs(diff - explained) < 0.01) note = 'The app keeps the amount typed in the account currency; the workbook converts the billed IDR back at the table rate.';
        else if (Math.abs(r2(diff - explained) - r2(acct[b.id].opening)) < 0.01) note = 'The workbook Dashboard does not include this account\'s opening balance.';
        else note = 'Not explained. Review this account.';
      }
      return { id: b.id, name: b.name, ccy: b.ccy, app: b.native, workbook: r2(workbookBalances[b.id]), diff, rows, note };
    });
}

// Export with the workbook's sheet names and column order. Computed columns are written as values (Q-05).
export async function exportWorkbook(state, ExcelJS, today) {
  const wb = new ExcelJS.Workbook();
  const acct = Object.fromEntries(state.accounts.map((a) => [a.id, a]));
  const cat = Object.fromEntries(state.categories.map((k) => [k.id, k]));

  const s = wb.addWorksheet('Setup');
  s.getCell('A1').value = 'SETUP — Accounts, Categories & Opening Balances';
  s.getRow(4).values = ['Account Name', 'Type', 'Opening Balance (native CCY)', 'Currency', 'Category Name', 'Type', '', '', '', '', '', '', '', 'Category', 'Tier', '', 'Currency', 'Current Rate (IDR)', 'Last Updated'];
  state.accounts.forEach((a, i) => { const r = s.getRow(5 + i); r.getCell(1).value = a.name; r.getCell(2).value = a.type; r.getCell(3).value = a.opening; r.getCell(4).value = a.ccy; });
  state.categories.forEach((k, i) => { const r = s.getRow(5 + i); r.getCell(5).value = k.name; r.getCell(6).value = k.type; r.getCell(14).value = k.name; r.getCell(15).value = k.tier; });
  Object.keys(state.rates).forEach((ccy, i) => { const r = s.getRow(6 + i); r.getCell(17).value = ccy; r.getCell(18).value = state.rates[ccy]; r.getCell(19).value = (state.ratesUpdated || {})[ccy] || ''; });
  s.getCell('H4').value = 'Anchor Day (default payday)'; s.getCell('I4').value = state.anchorDay;

  const d = wb.addWorksheet('Daily Tracker');
  d.getCell('A1').value = 'DAILY FINANCIAL TRACKER';
  d.getRow(2).values = ['Date', 'Description', 'Category', 'Type', 'Account', 'CCY', 'Amount (native)', 'Actual IDR (kalau sudah billed)', 'Rate', 'Amount IDR', 'Amount in Acct CCY', 'Balance Impact', 'Notes'];
  [...state.tx].sort((a, b) => a.date.localeCompare(b.date)).forEach((t, i) => {
    const res = E.resolveAmount(state, t), a = acct[t.acct];
    d.getRow(3 + i).values = [new Date(t.date + 'T00:00:00Z'), t.desc, cat[t.cat] ? cat[t.cat].name : '', t.type, a ? a.name : '', t.ccy, t.amt, t.billed, res.rate, r2(res.idr), r2(E.acctAmount(state, t, a)), t.type === 'Transfer' ? 0 : r2(res.idr), t.notes || ''];
    d.getRow(3 + i).getCell(1).numFmt = 'dd-mmm-yyyy';
  });

  const cy = E.cycleOf(state, today);
  const rep = E.cycleReport(state, cy);
  const m = wb.addWorksheet('Monthly Budget');
  m.getCell('A1').value = `MONTHLY BUDGET — ${cy.start} to ${cy.end} (amounts in ${state.base})`;
  m.getRow(3).values = ['Category', 'Tier', 'Budgeted', 'Actual', 'Variance', 'Status'];
  rep.rows.forEach((r, i) => { m.getRow(4 + i).values = [r.name, r.tier, r2(r.budget), r2(r.actual), r2(r.variance), r.status]; });

  const c = wb.addWorksheet('Credit Card');
  c.getCell('A1').value = 'CREDIT CARD & INSTALLMENT TRACKER';
  c.getRow(6).values = ['Item', 'Card', 'Purchase Date', 'Total Amount', 'Tenor (Months)', 'Monthly Payment Override', 'Effective Monthly Payment', 'Months Paid', 'Remaining Balance', 'Start Month', 'End Month', 'Status'];
  const ps = E.plansSummary(state, Number(today.slice(0, 4)), Number(today.slice(5, 7)));
  ps.rows.forEach((p, i) => { c.getRow(7 + i).values = [p.item, acct[p.card] ? acct[p.card].name : '', new Date(p.date + 'T00:00:00Z'), p.total, p.tenor, p.monthly ?? null, r2(p.monthly), p.paid, r2(p.remaining), p.startMonth, p.endMonth, p.status]; });

  const b = wb.addWorksheet('Dashboard');
  b.getCell('A1').value = `ACCOUNT BALANCES as of ${today}`;
  b.getRow(3).values = ['Account', 'CCY', 'Opening', 'Balance (native)', 'Balance (IDR)'];
  E.balances(state, today).forEach((x, i) => { b.getRow(4 + i).values = [x.name, x.ccy, acct[x.id].opening, r2(x.native), r2(x.idr)]; });
  const nw = E.netWorth(state, today);
  const base = 6 + state.accounts.length;
  b.getRow(base).values = ['NET WORTH (IDR)', '', '', '', r2(nw.total)];
  return wb.xlsx.writeBuffer();
}
