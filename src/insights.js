// Insights screen (BG-10): this week against budget, pace in the cycle, cycle history, runway.
// Charts are plain SVG so they work offline. Every figure comes from engine.js.
import * as E from './engine.js';

const PART_TIME = /part|side|freelance|shift|gig|sampingan/i;
const TIER_ORDER = ['Needs', 'Wants', 'Giving', 'Savings'];

export function insightPrefs(s) {
  const p = (s.meta.insights = s.meta.insights || {});
  if (!Array.isArray(p.tiers) || !p.tiers.length) p.tiers = [...E.SPEND_TIERS];
  if (!Array.isArray(p.keep)) p.keep = s.categories.filter((k) => k.type === 'Income' && !PART_TIME.test(k.name)).map((k) => k.id);
  return p;
}

// ---- chart pieces ---------------------------------------------------------------
const W = 320, H = 172, L = 40, R = 6, T = 12, B = 34;
function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 3, 4, 5, 8, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}
const grid = (max, fmt) => [0, 0.5, 1].map((k) => {
  const y = T + (H - T - B) * (1 - k);
  return `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" class="ch-grid"/><text x="${L - 6}" y="${y + 4}" text-anchor="end" class="ch-tick">${fmt(max * k)}</text>`;
}).join('');

// items: [{ key, label, value, budget, current, aria }]. One series; budget is a tick across each bar.
export function barChart(items, { chart, selected, fmt, esc }) {
  const max = niceMax(Math.max(...items.map((i) => Math.max(i.value, i.budget || 0)), 0));
  const band = (W - L - R) / items.length;
  const bw = Math.min(30, band * 0.62);
  const y = (v) => T + (H - T - B) * (1 - Math.max(0, v) / max);
  const bars = items.map((it, i) => {
    const cx = L + band * i + band / 2;
    const top = y(it.value), base = y(0), h = Math.max(0, base - top), r = Math.min(4, h, bw / 2);
    const x = cx - bw / 2;
    const path = h > 0 ? `M${x},${base}V${top + r}a${r},${r} 0 0 1 ${r},-${r}h${bw - 2 * r}a${r},${r} 0 0 1 ${r},${r}V${base}Z` : '';
    const sel = it.key === selected;
    return `<g>
      ${path ? `<path d="${path}" class="ch-bar${it.current ? ' now' : ''}${sel ? ' sel' : ''}"/>` : ''}
      ${it.budget ? `<line x1="${cx - band * 0.4}" x2="${cx + band * 0.4}" y1="${y(it.budget)}" y2="${y(it.budget)}" class="ch-ref"/>` : ''}
      <text x="${cx}" y="${H - B + 16}" text-anchor="middle" class="ch-tick${sel ? ' sel' : ''}">${esc(it.label)}</text>
      ${sel ? `<text x="${cx}" y="${Math.max(10, Math.min(top, it.budget ? y(it.budget) : top) - 6)}" text-anchor="middle" class="ch-val">${fmt(it.value)}</text>` : ''}
      <rect x="${L + band * i}" y="${T}" width="${band}" height="${H - T}" class="ch-hit" data-act="ins-pick" data-chart="${chart}" data-key="${esc(it.key)}" role="button" tabindex="0" aria-label="${esc(it.aria)}"/>
    </g>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="group" aria-label="Bar chart, tap a bar for detail">${grid(max, fmt)}${bars}</svg>`;
}

// Running total (solid) against a straight budget line (dashed), both labelled at their ends.
export function paceChart(p, cy, { fmt }) {
  const max = niceMax(Math.max(p.budget || 0, p.spent, 1) * 1.08);
  const x = (i) => L + ((W - L - R) * i) / Math.max(1, cy.days - 1);
  const y = (v) => T + (H - T - B) * (1 - Math.max(0, v) / max);
  const line = p.points.map((pt, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(pt.cum).toFixed(1)}`).join('');
  const lx = p.points.length ? x(p.points.length - 1) : x(0);
  const ly = y(p.spent);
  const right = lx > W * 0.62;
  const by = p.budget ? y(p.budget) : 0;
  const xl = [[0, cy.start], [cy.days - 1, cy.end]].map(([i, d]) => `<text x="${x(i)}" y="${H - B + 16}" text-anchor="${i ? 'end' : 'start'}" class="ch-tick">${Number(d.slice(8))}/${Number(d.slice(5, 7))}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Spending so far in this cycle against the budget line">${grid(max, fmt)}${xl}
    ${p.budget ? `<line x1="${x(0)}" y1="${y(0)}" x2="${x(cy.days - 1)}" y2="${by}" class="ch-ref dash"/><text x="${W - R}" y="${Math.max(10, by - 6)}" text-anchor="end" class="ch-tick">Budget ${fmt(p.budget)}</text>` : ''}
    ${line ? `<path d="${line}" class="ch-line"/><circle cx="${lx}" cy="${ly}" r="5" class="ch-dot"/><text x="${right ? lx - 9 : lx + 9}" y="${ly > T + 26 ? ly - 9 : ly + 18}" text-anchor="${right ? 'end' : 'start'}" class="ch-val">Spent ${fmt(p.spent)}</text>` : ''}
  </svg>`;
}

// ---- the screen -------------------------------------------------------------------
export function viewInsights(c) {
  const { s, ui, today, esc, money, mBase, pct, monthName, niceDate, opt, shell, statusChip } = c;
  const prefs = insightPrefs(s);
  const st = (ui.ins = ui.ins || { acct: '', cat: '', span: 6, week: null, cyc: null, adjust: 0 });
  const f = { tiers: prefs.tiers, acct: st.acct, cat: st.cat };
  const whole = (n) => { try { return new Intl.NumberFormat('en-IE', { style: 'currency', currency: s.base || 'EUR', maximumFractionDigits: 0 }).format(Math.round(n)); } catch { return String(Math.round(n)); } };
  const short = (d) => `${Number(d.slice(8))}/${Number(d.slice(5, 7))}`;
  const table = (head, rows) => `<details class="tbl"><summary>Show as table</summary><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></details>`;
  const breakdown = (rows) => {
    if (!rows.length) return '<p class="note">No spending here.</p>';
    const max = Math.max(...rows.map((r) => r.spent), 0.01);
    return `<ul class="list bars">${rows.slice(0, 8).map((r) => `<li><button type="button" class="barrow" data-act="ins-cat" data-id="${esc(r.id)}" aria-label="Filter by ${esc(r.name)}"><span class="t">${esc(r.name)}</span><span class="t">${mBase(r.spent)}</span><span class="track"><span style="width:${Math.max(2, (Math.max(0, r.spent) / max) * 100).toFixed(1)}%"></span></span></button></li>`).join('')}</ul>${rows.length > 8 ? `<p class="note">${rows.length - 8} smaller categories not shown.</p>` : ''}`;
  };

  // Data
  const wk = E.weeks(s, today, 8, f);
  const thisWeek = wk[wk.length - 1];
  const ws = E.weekStatus(thisWeek, today);
  const lastWeek = wk[wk.length - 2];
  const cy = E.cycleOf(s, today);
  const p = E.pace(s, cy, today, f);
  const hist = E.cycleHistory(s, today, st.span, f);
  const done = hist.filter((h) => !h.current && (h.spent > 0.004 || h.income > 0.004));
  const avgMonth = done.length ? done.reduce((t, h) => t + h.spent, 0) / done.length : null;
  const rw = E.runway(s, today, { tiers: prefs.tiers, keepIncome: prefs.keep, adjust: st.adjust, withInvestments: !!prefs.inv });
  const mv = E.movers(s, today, f).filter((m) => m.diff > 0).slice(0, 3);
  const selWeek = wk.find((w) => w.key === st.week) || thisWeek;
  const selCyc = hist.find((h) => h.key === st.cyc) || hist[hist.length - 1];
  const runwayText = !isFinite(rw.months) ? 'Not running down' : rw.months >= 36 ? '3+ years' : `${rw.months.toFixed(1)} months`;
  const untilText = rw.until ? monthName(Number(rw.until.slice(0, 4)), Number(rw.until.slice(5, 7))) : '';
  const incomeCats = s.categories.filter((k) => k.type === 'Income' && !k.archived);
  const filtered = st.acct || st.cat || prefs.tiers.join() !== E.SPEND_TIERS.join();

  const band = `<div class="kpis">
      <div><p class="l">This week</p><p class="v">${mBase(thisWeek.spent)}</p><p class="sub">${thisWeek.budget === null ? 'No budget to compare' : ws.left >= 0 ? `${mBase(ws.left)} under budget` : `${mBase(0 - ws.left)} over budget`}</p></div>
      <div><p class="l">Left per day</p><p class="v">${p.perDay === null ? '—' : mBase(Math.max(0, p.perDay))}</p><p class="sub">${p.perDay === null ? 'Set a budget first' : `${p.daysLeft} days left in cycle`}</p></div>
      <div><p class="l">Average month</p><p class="v">${avgMonth === null ? '—' : mBase(avgMonth)}</p><p class="sub">${done.length ? `Last ${done.length} complete cycle${done.length > 1 ? 's' : ''}` : 'No complete cycle yet'}</p></div>
      <div><p class="l">Money lasts</p><p class="v">${runwayText}</p><p class="sub">${untilText ? `Until ${untilText}` : 'Income covers spending'}</p></div>
    </div>`;

  const filters = `<section class="card"><div class="sechead"><h2>Filters</h2>${filtered ? '<button type="button" class="link" data-act="ins-reset">Reset</button>' : ''}</div>
    <div class="chips" role="group" aria-label="Tiers counted as spending">${TIER_ORDER.map((t) => `<button type="button" class="chipbtn" aria-pressed="${prefs.tiers.includes(t)}" data-act="ins-tier" data-tier="${t}">${t}</button>`).join('')}</div>
    <div class="row2">
      <label class="field"><span class="l">Account</span><select data-chg="ins-acct">${opt('', 'All', st.acct)}${s.accounts.filter((a) => !a.archived).map((a) => opt(a.id, a.name, st.acct)).join('')}</select></label>
      <label class="field"><span class="l">Category</span><select data-chg="ins-cat">${opt('', 'All', st.cat)}${s.categories.filter((k) => k.type === 'Expense' && !k.archived).map((k) => opt(k.id, k.name, st.cat)).join('')}</select></label>
    </div>
    <p class="note">The filters apply to every chart below. Savings is off by default: money moved to investments is not spending.${st.acct ? ' Budgets are per category, so there is no budget line under an account filter.' : ''}</p>
  </section>`;

  const weekCard = `<section class="card"><div class="sechead"><h2>This week</h2>${statusChip(ws.status ? `${ws.status} budget` : '')}</div>
    <p class="big">${mBase(thisWeek.spent)}</p>
    <p class="p">${thisWeek.budget === null ? 'No budget set for these categories.' : `of ${mBase(thisWeek.budget)} for the week. ${ws.left >= 0 ? `${mBase(ws.left)} left for the next ${ws.daysLeft} day${ws.daysLeft > 1 ? 's' : ''}.` : `${mBase(0 - ws.left)} over with ${ws.daysLeft} day${ws.daysLeft > 1 ? 's' : ''} to go.`}`} Last week: ${mBase(lastWeek.spent)}.</p>
    ${barChart(wk.map((w) => ({ key: w.key, label: short(w.start), value: w.spent, budget: w.budget, current: w.current, aria: `Week of ${niceDate(w.start)}: ${mBase(w.spent)}` })), { chart: 'week', selected: selWeek.key, fmt: whole, esc })}
    <p class="legend"><span class="sw bar"></span>Spent<span class="sw now"></span>Week in progress<span class="sw ref"></span>Weekly budget</p>
    <div class="field"><span class="l">Week of ${niceDate(selWeek.start)} to ${niceDate(selWeek.end)}</span><p class="v">${mBase(selWeek.spent)}${selWeek.budget === null ? '' : ` of ${mBase(selWeek.budget)}`}</p></div>
    ${breakdown(E.spendByCategory(s, selWeek.start, selWeek.end, f))}
    ${table(['Week of', 'Spent', 'Budget'], wk.map((w) => [niceDate(w.start), mBase(w.spent), w.budget === null ? '—' : mBase(w.budget)]))}
    <p class="note">Weeks run Monday to Sunday. The weekly budget is the cycle budget spread evenly over its days, so a week with rent in it will look heavy: filter rent out with the Category filter to judge day-to-day spending.</p>
  </section>`;

  const paceCard = `<section class="card"><div class="sechead"><h2>Pace this cycle</h2>${statusChip(p.budget === null ? '' : p.spent <= p.expected ? 'Under pace' : 'Over pace')}</div>
    <p class="p">${niceDate(cy.start)} to ${niceDate(cy.end)}. ${p.budget === null ? `${mBase(p.spent)} spent so far.` : `${mBase(p.spent)} spent; an even pace would be ${mBase(p.expected)} by today.`} At this rate the cycle ends at about ${mBase(p.projected)}.</p>
    ${paceChart(p, cy, { fmt: whole })}
    <p class="legend"><span class="sw line"></span>Spent so far<span class="sw dash"></span>Budget, spread evenly</p>
  </section>`;

  const monthCard = `<section class="card"><div class="sechead"><h2>Month by month</h2></div>
    <div class="seg" role="group" aria-label="How many cycles">${[6, 12].map((n) => `<button type="button" aria-pressed="${st.span === n}" data-act="ins-span" data-n="${n}">Last ${n} cycles</button>`).join('')}</div>
    ${barChart(hist.map((h) => ({ key: h.key, label: new Date(Date.UTC(h.cycle.y, h.cycle.m - 1, 1)).toLocaleString('en-IE', { month: 'short', timeZone: 'UTC' }), value: h.spent, budget: h.budget, current: h.current, aria: `${monthName(h.cycle.y, h.cycle.m)}: ${mBase(h.spent)}` })), { chart: 'cyc', selected: selCyc.key, fmt: whole, esc })}
    <p class="legend"><span class="sw bar"></span>Spent<span class="sw now"></span>Cycle in progress<span class="sw ref"></span>Budget</p>
    <div class="grid3">
      <div class="field"><span class="l">${esc(monthName(selCyc.cycle.y, selCyc.cycle.m))}</span><p class="v">${whole(selCyc.spent)}</p></div>
      <div class="field"><span class="l">Income</span><p class="v">${whole(selCyc.income)}</p></div>
      <div class="field"><span class="l">Kept</span><p class="v">${selCyc.income > 0.004 ? pct((selCyc.income - selCyc.spent) / selCyc.income) : '—'}</p></div>
    </div>
    ${breakdown(E.spendByCategory(s, selCyc.cycle.start, selCyc.cycle.end, f))}
    ${table(['Cycle', 'Spent', 'Income', 'Budget'], hist.map((h) => [esc(monthName(h.cycle.y, h.cycle.m)), mBase(h.spent), mBase(h.income), h.budget === null ? '—' : mBase(h.budget)]))}
  </section>`;

  const runwayCard = `<section class="summary"><h2>How long the money lasts</h2>
    <p class="big">${runwayText}</p>
    <p class="p">${!isFinite(rw.months) ? 'The income you counted covers your average spending, so the balance is not falling.' : `At ${mBase(rw.burn)} a month more going out than coming in, ${mBase(Math.max(0, rw.liquid))} lasts until about ${untilText}.`}</p>
    <ul class="list plain">
      <li><p>Money available now</p><p>${mBase(rw.liquid)}</p></li>
      <li><p>Average spending a month</p><p>${mBase(rw.spend)}</p></li>
      <li><p>Income that continues</p><p>${mBase(rw.income)}</p></li>
    </ul>
    <h3>Income to count as continuing</h3>
    ${incomeCats.length ? `<div class="chips" role="group" aria-label="Income categories that continue">${incomeCats.map((k) => `<button type="button" class="chipbtn" aria-pressed="${prefs.keep.includes(k.id)}" data-act="ins-keep" data-id="${esc(k.id)}">${esc(k.name)}</button>`).join('')}</div>` : '<p class="note">No income categories yet.</p>'}
    <h3>What if spending changes</h3>
    <div class="seg" role="group" aria-label="Change in monthly spending">${[-0.2, -0.1, 0, 0.1, 0.2].map((a) => `<button type="button" aria-pressed="${st.adjust === a}" data-act="ins-adjust" data-a="${a}">${a === 0 ? 'As now' : `${a > 0 ? '+' : '−'}${Math.abs(a * 100)}%`}</button>`).join('')}</div>
    <label class="check"><input type="checkbox" data-chg="ins-inv" ${prefs.inv ? 'checked' : ''}> Count investments as money available</label>
    <p class="note">${rw.scaled ? 'There is no complete cycle yet, so this scales up the current cycle and will move around until one is finished.' : `Based on the last ${rw.cyclesUsed} complete cycle${rw.cyclesUsed > 1 ? 's' : ''}.`} Money available is every account minus card outstanding. Uses the tier filter above, not the account or category filter. Turn an income category off to see the picture without it, for example without part-time work.</p>
  </section>`;

  const moversCard = mv.length ? `<section class="card"><h2>Running above your usual</h2>
    <ul class="list">${mv.map((m) => `<li><div><p class="t">${esc(m.name)}</p><p class="note">Usually ${mBase(m.usual)} by this day of the cycle</p></div><div class="r"><p class="t">${mBase(m.spent)}</p><span class="chip warn">+${mBase(m.diff)}</span></div></li>`).join('')}</ul>
    <p class="note">Compared with what you had spent by the same day in your last three cycles.</p></section>` : '';

  return shell('Insights', `${filters}${weekCard}${paceCard}${monthCard}${runwayCard}${moversCard}`, { band });
}

// Returns true when it handled the click. `save` persists the saved preferences.
export async function insightClick(act, el, { s, ui, save }) {
  if (!act.startsWith('ins-')) return false;
  const prefs = insightPrefs(s);
  const st = (ui.ins = ui.ins || { acct: '', cat: '', span: 6, week: null, cyc: null, adjust: 0 });
  const toggle = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  if (act === 'ins-pick') { if (el.dataset.chart === 'week') st.week = el.dataset.key; else st.cyc = el.dataset.key; }
  if (act === 'ins-span') st.span = Number(el.dataset.n);
  if (act === 'ins-adjust') st.adjust = Number(el.dataset.a);
  if (act === 'ins-cat') st.cat = st.cat === el.dataset.id ? '' : el.dataset.id;
  if (act === 'ins-reset') { st.acct = ''; st.cat = ''; prefs.tiers = [...E.SPEND_TIERS]; await save(); }
  if (act === 'ins-tier') { const next = toggle(prefs.tiers, el.dataset.tier); if (next.length) { prefs.tiers = TIER_ORDER.filter((t) => next.includes(t)); await save(); } }
  if (act === 'ins-keep') { prefs.keep = toggle(prefs.keep, el.dataset.id); await save(); }
  return true;
}
