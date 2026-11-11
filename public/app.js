/* SpendGuard front-end — vanilla JS + AG Grid Community */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money0 = (n) => '$' + Math.round(Number(n || 0)).toLocaleString('en-US');
const rich = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const PALETTE = ['#11402F', '#C98A12', '#4F6D8F', '#9C4A5B', '#6E8B3D', '#B5651D', '#2F7F86', '#5B5F97', '#8A5A2B', '#A08A3C', '#C23A2F', '#3F7F64', '#7A6E66', '#8C7AA9', '#36614F', '#D1A35A'];
const colorOf = (() => { const m = {}; let i = 0; return (k) => (m[k] ||= PALETTE[i++ % PALETTE.length]); })();

const TITLES = { home: null, activity: 'Activity', pay: 'Send money', ask: 'Ask your PayPal', budgets: 'Budgets', settings: 'Settings' };
const S = { config: null, month: null, view: 'home', grid: null, dir: 'all', txns: [], chat: [], selDay: null, editing: null };

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Something went wrong (${res.status})`), { data, status: res.status });
  return data;
}

function toast(msg, ms = 2800) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), ms);
}

function countUp(el, to, fmt) {
  const from = Number(el.dataset.v || 0);
  el.dataset.v = to;
  if (reduced || from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now(), dur = 700;
  const step = (t) => {
    const p = Math.min((t - t0) / dur, 1), e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const monthName = (key, opts = { month: 'long' }) => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 15).toLocaleString('en-US', opts); };
const isCurrentMonth = () => S.month === S.months[0];

// ---------- Navigation ----------
function go(view) {
  if (!TITLES.hasOwnProperty(view)) view = 'home';
  S.view = view;
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  $$('.rail button').forEach((b) => b.classList.toggle('active', b.dataset.go === view));
  $('#viewTitle').textContent = TITLES[view] || (isCurrentMonth() ? 'This month' : monthName(S.month, { month: 'long', year: 'numeric' }));
  $('.month').hidden = !['home', 'activity'].includes(view);
  if (view === 'activity') loadGrid();
  if (view === 'pay') loadIntents();
  if (view === 'budgets') loadBudgets();
  if (view === 'settings') loadSettings();
  if (view === 'ask') setTimeout(() => $('#askInput').focus({ preventScroll: true }), 50);
  window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  if (location.hash.slice(1) !== view) history.replaceState(null, '', `#${view}`);
}
document.addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go); });
window.addEventListener('hashchange', () => go(location.hash.slice(1)));

// ---------- Boot ----------
async function boot() {
  await loadConfig();
  const c = S.config;

  const now = new Date();
  S.months = [0, 1, 2].map((i) => { const d = new Date(now.getFullYear(), now.getMonth() - i, 15); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });
  $('#month').innerHTML = S.months.map((k) => `<option value="${k}">${monthName(k, { month: 'short', year: 'numeric' })}</option>`).join('');
  S.month = S.months[0];
  $('#month').addEventListener('change', async () => { S.month = $('#month').value; S.selDay = null; $('#dayDetail').hidden = true; await refresh(); go(S.view); });

  const spendCats = c.categories.filter((x) => !/Income/.test(x));
  const opts = spendCats.map((x) => `<option>${esc(x)}</option>`).join('');
  $('#payForm [name=category]').insertAdjacentHTML('beforeend', opts);
  $('#budgetForm [name=category]').innerHTML = `<option value="ALL">Everything</option>${opts}`;

  await refresh();
  go(location.hash.slice(1) || 'home');
  if (c.ai || c.paypal) syncNow(true);
}

async function loadConfig() {
  S.config = await api('/api/config');
  const c = S.config;
  const parts = [];
  parts.push(c.paypal ? `Connected to PayPal ${esc(c.paypalEnv)}${c.paypalSource === 'user' ? ' with your keys' : ''}` : '<b>Demo mode</b>: PayPal is not connected, so payments are simulated and the exact PayPal API request is shown instead');
  parts.push(c.ai ? `AI is on: ${esc(c.aiInfo.short)} ${esc(c.aiInfo.model)}${c.aiInfo.source === 'user' ? ' with your key' : ''}` : 'AI is off, so answers and categories use built-in rules');
  if (c.demoData) parts.push('Sample history is included');
  if (c.preview) parts.push('This preview resets when you reload');
  const nudge = !c.paypal || !c.ai ? ' <button class="linkish" data-go="settings">Add your keys</button>' : '';
  $('#modeLine').innerHTML = parts.join('. ') + '.' + nudge;
}

async function syncNow(silent) {
  const btn = $('#syncBtn');
  btn.classList.add('spin');
  try {
    const r = await api('/api/sync', { method: 'POST' });
    if (!silent) toast(r.skipped ? `Already up to date (${r.skipped.toLowerCase()})` : `Synced ${r.synced} PayPal transactions`);
    if (r.synced || r.classified) await refresh();
  } catch (e) { if (!silent) toast(e.message); }
  finally { btn.classList.remove('spin'); }
}
$('#syncBtn').addEventListener('click', () => syncNow(false));

// ---------- Home ----------
async function refresh() {
  const [s, txns] = await Promise.all([api(`/api/state?month=${S.month}`), api(`/api/transactions?month=${S.month}`)]);
  S.state = s; S.txns = txns;
  renderHome(s);
  loadInsights();
  if (S.grid) S.grid.setGridOption('rowData', txns);
}

function delta(now, before, goodWhenUp) {
  if (!before) return '';
  const p = Math.round(((now - before) / before) * 100);
  if (!p) return 'same as last month';
  const word = p > 0 ? `${p}% more` : `${Math.abs(p)}% less`;
  return word;
}

function renderHome({ summary: s, budgets, alerts, subscriptions }) {
  const total = budgets.find((b) => b.category === 'ALL');
  const current = isCurrentMonth();
  const daysLeft = s.daysInMonth - s.dayOfMonth + 1;
  const label = $('#heroLabel'), num = $('#heroNum'), sub = $('#heroSub');
  const spentBar = $('.pace-spent'), today = $('.pace-today');

  if (current && total) {
    const left = total.limit - s.spent;
    if (left >= 0) {
      label.textContent = 'Safe to spend today';
      countUp(num, left / daysLeft, money);
      sub.textContent = `${money(left)} left of your ${money0(total.limit)} monthly budget, with ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} to go.`;
    } else {
      label.textContent = 'Over your monthly budget by';
      countUp(num, -left, money);
      sub.textContent = `You set ${money0(total.limit)} for the month and have spent ${money(s.spent)}.`;
    }
    $('#pace').hidden = false;
    spentBar.style.width = `${Math.min((s.spent / total.limit) * 100, 100)}%`;
    spentBar.classList.toggle('over', s.spent > total.limit);
    today.style.left = `${(s.dayOfMonth / s.daysInMonth) * 100}%`;
  } else {
    label.textContent = current ? 'Kept so far this month' : `Spent in ${monthName(S.month)}`;
    countUp(num, current ? s.net : s.spent, money);
    sub.textContent = current ? 'Add a total monthly budget to see what is safe to spend each day.' : `You received ${money(s.income)} and kept ${money(s.net)}.`;
    $('#pace').hidden = true;
  }

  const period = s.comparedDays ? 'than this time last month' : 'than last month';
  $('#kIn').textContent = money0(s.income);
  $('#kInSub').textContent = s.prevIncome ? `${delta(s.income, s.prevIncome)} ${period}` : '';
  $('#kOut').textContent = money0(s.spent);
  $('#kOutSub').textContent = s.prevSpent ? `${delta(s.spent, s.prevSpent)} ${period}` : '';
  $('#kNet').textContent = (s.net < 0 ? '−' : '') + money0(Math.abs(s.net));
  $('#kNet').classList.toggle('neg', s.net < 0);
  $('#kNetSub').textContent = `after ${money0(s.fees)} PayPal fees`;

  renderCalendar(s);

  // categories
  const cats = s.byCategory.filter((c) => c.category !== 'Transfers');
  const sum = cats.reduce((a, c) => a + c.amount, 0);
  $('#catTotal').textContent = sum ? `${money(sum)} in total` : '';
  $('#split').innerHTML = cats.map((c) => `<i style="flex-grow:${c.amount};background:${colorOf(c.category)}" title="${esc(c.category)} ${money(c.amount)}"></i>`).join('');
  $('#cats').innerHTML = cats.length ? cats.map((c) => {
    const d = c.prev ? Math.round(((c.amount - c.prev) / c.prev) * 100) : null;
    const cls = d == null ? '' : d > 15 ? 'up' : d < -15 ? 'down' : '';
    return `<li><span class="sw" style="background:${colorOf(c.category)}"></span>${esc(c.category)}<span class="amt">${money(c.amount)}</span><span class="chg ${cls}">${d == null ? 'new' : (d > 0 ? '+' : '') + d + '%'}</span></li>`;
  }).join('') : '<li class="empty">Nothing spent yet.</li>';

  // alerts
  $('#alertCount').textContent = alerts.length || '';
  $('#alertCount').hidden = !alerts.length;
  $('#alerts').innerHTML = alerts.length ? alerts.map((a) => `
    <li class="${a.level}"><span class="tick"></span><div><b>${esc(a.title)}</b><p>${esc(a.body)}</p></div>
    <button class="x" data-dismiss="${esc(a.id)}" aria-label="Dismiss"><svg><use href="#i-close"/></svg></button></li>`).join('')
    : '<li class="empty" style="display:block">Nothing needs your attention.</li>';

  $('#budgetMini').innerHTML = budgets.length ? budgets.map((b) => gauge(b)).join('') : '<p class="empty">No budgets yet. <button class="text-btn" data-go="budgets">Add one</button></p>';

  const subTotal = subscriptions.reduce((a, x) => a + x.amount, 0);
  $('#subTotal').textContent = subscriptions.length ? `${money(subTotal)} a month` : '';
  $('#subs').innerHTML = subscriptions.length ? subscriptions.map((x) => `<li><span class="sw" style="background:${colorOf(x.category)}"></span>${esc(x.merchant)} <small>${esc(x.category)}</small><span class="amt">${money(x.amount)}</span></li>`).join('')
    : '<li class="empty">No repeating payments found yet.</li>';
}

function renderCalendar(s) {
  const [y, m] = S.month.split('-').map(Number);
  const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7; // Monday first
  const max = Math.max(1, ...s.daily.map((d) => d.out));
  const current = isCurrentMonth();
  const cells = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<span class="dow">${d}</span>`);
  for (let i = 0; i < offset; i++) cells.push('<span class="pad"></span>');
  for (const d of s.daily) {
    const future = current && d.day > s.dayOfMonth;
    const t = d.out / max;
    const bg = mix('#e2e8e2', '#11402F', Math.pow(t, 0.75));
    const cls = [t > 0.42 ? 'light' : '', d.in ? 'in' : '', current && d.day === s.dayOfMonth ? 'today' : '', S.selDay === d.day ? 'sel' : ''].join(' ');
    cells.push(future
      ? `<button disabled aria-label="${monthName(S.month)} ${d.day}, not yet"><span class="d">${d.day}</span></button>`
      : `<button class="${cls}" style="background:${bg}" data-day="${d.day}" aria-label="${monthName(S.month)} ${d.day}: spent ${money(d.out)}${d.in ? `, received ${money(d.in)}` : ''}"><span class="d">${d.day}</span><span class="v">${d.out ? money0(d.out) : ''}</span></button>`);
  }
  $('#cal').innerHTML = cells.join('');
}
function mix(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`;
}

$('#cal').addEventListener('click', (e) => {
  const b = e.target.closest('[data-day]');
  if (!b) return;
  const day = Number(b.dataset.day);
  const box = $('#dayDetail');
  if (S.selDay === day) { S.selDay = null; box.hidden = true; renderCalendar(S.state.summary); return; }
  S.selDay = day;
  renderCalendar(S.state.summary);
  const rows = S.txns.filter((t) => new Date(t.date).getDate() === day);
  box.hidden = false;
  box.innerHTML = `<h3>${monthName(S.month)} ${day}</h3>` + (rows.length ? `<ul class="rows">${rows.map((t) => `
    <li><span class="sw" style="background:${colorOf(t.category)}"></span><span>${esc(t.merchant)} <small>${esc(t.category)}</small></span>
    <span class="amt ${t.direction === 'in' ? 'in' : ''}">${t.direction === 'in' ? '+' : '−'}${money(t.amount)}</span></li>`).join('')}</ul>` : '<p class="empty">No payments that day.</p>');
});

document.addEventListener('click', async (e) => {
  const d = e.target.closest('[data-dismiss]');
  if (!d) return;
  const li = d.closest('li');
  li.style.transition = 'opacity .2s, transform .2s'; li.style.opacity = 0; li.style.transform = 'translateX(12px)';
  await api(`/api/alerts/${encodeURIComponent(d.dataset.dismiss)}/dismiss`, { method: 'POST' }).catch(() => {});
  setTimeout(() => { li.remove(); const n = $$('#alerts li:not(.empty)').length; $('#alertCount').textContent = n || ''; $('#alertCount').hidden = !n; if (!n) $('#alerts').innerHTML = '<li class="empty" style="display:block">Nothing needs your attention.</li>'; }, 200);
});

const NOTE_ICON = { warning: ['!', '#C98A12'], saving: ['↓', '#2F7F86'], info: ['i', '#4F6D8F'], good: ['✓', '#23875A'] };
async function loadInsights() {
  const box = $('#insights');
  box.innerHTML = '<li><span class="ghost"></span></li><li><span class="ghost"></span></li><li><span class="ghost"></span></li>';
  $('#insSource').textContent = '';
  try {
    const r = await api(`/api/insights?month=${S.month}`);
    $('#insSource').textContent = r.source === 'ai' ? `Written by ${S.config.aiInfo?.short || 'AI'}` : 'Built-in rules';
    box.innerHTML = r.cards.map((c) => {
      const [sym, col] = NOTE_ICON[c.type] || NOTE_ICON.info;
      return `<li><span class="ic" style="color:${col}" aria-hidden="true"><svg viewBox="0 0 24 24" style="width:22px;height:22px"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.8"/><text x="12" y="16.5" text-anchor="middle" font-size="13" font-weight="800" fill="currentColor" font-family="Schibsted Grotesk, sans-serif">${sym}</text></svg></span><div><b>${esc(c.title)}</b><p>${esc(c.body)}</p></div></li>`;
    }).join('');
  } catch (e) {
    box.innerHTML = `<li class="empty" style="display:block">Couldn't load notes: ${esc(e.message)}</li>`;
  }
}

function gauge(b, { actions = false, add = 0 } = {}) {
  const label = b.category === 'ALL' ? 'Everything' : b.category;
  const pct = Math.min((b.spent / b.limit) * 100, 100);
  const addPct = add ? Math.max(Math.min(((b.spent + add) / b.limit) * 100, 100) - pct, 0) : 0;
  const over = b.spent + add > b.limit;
  return `<div class="gauge">
    <div class="gauge-top"><span>${esc(label)}<span class="tag ${b.mode}">${b.mode === 'block' ? 'blocks' : 'alerts'}</span></span>
    <span><b>${money(b.spent + add)}</b> <span class="of">of ${money0(b.limit)}</span></span></div>
    <div class="track ${add ? '' : b.state}"><i style="width:${pct}%"></i>${add ? `<i class="add ${over ? '' : 'ok'}" style="left:${pct}%;width:${addPct}%"></i>` : ''}</div>
    ${actions ? `<div class="gauge-actions">
      <button class="text-btn" data-edit="${esc(b.category)}">Edit</button>
      <button class="text-btn" data-toggle="${esc(b.category)}">${b.mode === 'block' ? 'Only alert me' : 'Block payments'}</button>
      <button class="text-btn" style="color:var(--stop)" data-del="${esc(b.id)}">Delete</button></div>` : ''}
  </div>`;
}

// ---------- Activity ----------
function loadGrid() {
  if (S.grid) { S.grid.setGridOption('rowData', S.txns); return; }
  const narrow = matchMedia('(max-width: 640px)').matches;
  const fmtDate = (v) => new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  S.grid = agGrid.createGrid($('#grid'), {
    rowData: S.txns,
    getRowId: (p) => p.data.id,
    animateRows: true,
    rowHeight: narrow ? 58 : 48,
    defaultColDef: { sortable: true, resizable: true },
    isExternalFilterPresent: () => S.dir !== 'all',
    doesExternalFilterPass: (n) => n.data.direction === S.dir,
    columnDefs: [
      { field: 'date', headerName: 'Date', width: 92, sort: 'desc', hide: narrow, valueFormatter: (p) => fmtDate(p.value) },
      { field: 'merchant', headerName: 'Who', flex: 1, minWidth: narrow ? 100 : 130,
        cellRenderer: narrow ? (p) => `<div class="who"><b>${esc(p.value)}</b><small>${fmtDate(p.data.date)}</small></div>` : undefined },
      {
        field: 'amount', headerName: 'Amount', width: narrow ? 106 : 112, type: 'numericColumn',
        valueGetter: (p) => (p.data.direction === 'out' ? -p.data.amount : p.data.amount),
        cellRenderer: (p) => `<span class="${p.value < 0 ? 'money-out' : 'money-in'}">${p.value < 0 ? '−' : '+'}${money(Math.abs(p.value))}</span>`,
      },
      {
        field: 'category', headerName: 'Category', width: narrow ? 150 : 200,
        cellRenderer: (p) => `<button class="chip ${p.data.categorySource === 'user' ? 'user' : ''}" aria-label="Change category, now ${esc(p.value)}"><span class="sw" style="background:${colorOf(p.value)}"></span>${esc(p.value)}<span class="caret" aria-hidden="true">▾</span></button>`,
        onCellClicked: (p) => pickCategory(p),
      },
      { field: 'note', headerName: 'Details', flex: 1, minWidth: 200 },
      { field: 'fee', headerName: 'PayPal fee', width: 110, valueFormatter: (p) => (p.value ? money(p.value) : '') },
      { field: 'source', headerName: 'From', width: 110, valueFormatter: (p) => ({ paypal: 'PayPal', spendguard: 'SpendGuard', demo: 'Sample' }[p.value] || p.value) },
    ],
  });
}

function pickCategory(p) {
  const t = p.data;
  sheet.open(`<div class="t-head"><p>Change category</p><h3 id="ticketTitle" class="pick-title">${esc(t.merchant)}</h3>
    <p class="hint">${t.direction === 'in' ? '+' : '−'}${money(t.amount)} on ${new Date(t.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}</p></div>
    <div class="pick">${S.config.categories.map((c) => `<button data-cat="${esc(c)}" class="${c === t.category ? 'on' : ''}" ${c === t.category ? 'data-autofocus' : ''}><span class="sw" style="background:${colorOf(c)}"></span>${esc(c)}</button>`).join('')}</div>`);
  $('.pick').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    const cat = b.dataset.cat;
    sheet.close();
    if (cat === t.category) return;
    try {
      await api(`/api/transactions/${encodeURIComponent(t.id)}`, { method: 'PATCH', body: { category: cat } });
      p.node.setData({ ...t, category: cat, categorySource: 'user' });
      p.api.flashCells({ rowNodes: [p.node], columns: ['category'] });
      toast(`${t.merchant} moved to ${cat}`);
      const s = await api(`/api/state?month=${S.month}`); S.state = s; renderHome(s); loadInsights();
      S.txns = await api(`/api/transactions?month=${S.month}`);
    } catch (err) { toast(err.message); }
  });
}
$('#gridSearch').addEventListener('input', (e) => S.grid?.setGridOption('quickFilterText', e.target.value));
$('#dirFilter').addEventListener('click', (e) => {
  const b = e.target.closest('[data-dir]');
  if (!b) return;
  S.dir = b.dataset.dir;
  $$('#dirFilter button').forEach((x) => x.classList.toggle('on', x === b));
  S.grid?.onFilterChanged();
});

// ---------- Ticket sheet ----------
const sheet = {
  open(html) {
    $('#sheetBody').innerHTML = html;
    const el = $('#sheet');
    el.classList.remove('closing');
    el.hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => ($('.ticket [data-autofocus]') || $('.ticket-close')).focus({ preventScroll: true }), 60);
  },
  close() {
    const el = $('#sheet');
    if (el.hidden) return;
    el.classList.add('closing');
    setTimeout(() => { el.hidden = true; el.classList.remove('closing'); document.body.style.overflow = ''; }, 200);
  },
};
window.sheet = sheet;
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet' || e.target.closest('[data-close]')) sheet.close(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') sheet.close(); });

const COOL = () => { const m = S.config.coolOffMinutes; return m >= 60 ? `${Math.round(m / 60)} hours` : `${m} ${m === 1 ? 'minute' : 'minutes'}`; };
const STAMP = { allow: 'CLEARED', warn: 'HOLD', block: 'STOPPED' };

// ---------- Pay ----------
$('.tries').addEventListener('click', (e) => {
  const b = e.target.closest('[data-preset]');
  if (!b) return;
  const p = JSON.parse(b.dataset.preset);
  for (const [k, v] of Object.entries(p)) $(`#payForm [name=${k}]`).value = v;
  $('#payForm [name=category]').value = '';
  $('#payForm [name=amount]').focus();
});

$('#payForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const btn = e.target.querySelector('[type=submit]');
  btn.disabled = true;
  sheet.open(`<div class="checking">
    <div class="scan"><svg viewBox="0 0 24 28"><path d="M12 1.5 22 5v8c0 6.4-4.3 11-10 13-5.7-2-10-6.6-10-13V5z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg></div>
    <h3 id="ticketTitle">Checking ${money(Number(f.amount))}${f.payeeName ? ` to ${esc(f.payeeName)}` : ''}</h3>
    <ol><li>Your budgets</li><li>Your usual spending</li><li>Who you are paying</li><li>Time and cash flow</li></ol></div>`);
  const steps = $$('.checking li');
  steps.forEach((li, i) => setTimeout(() => li.classList.add('on'), 180 + i * 230));
  try {
    const [it] = await Promise.all([
      api('/api/guard/check', { method: 'POST', body: { ...f, amount: Number(f.amount), category: f.category || undefined, localHour: new Date().getHours() } }),
      new Promise((r) => setTimeout(r, reduced ? 0 : 1150)),
    ]);
    showTicket(it);
  } catch (err) {
    sheet.open(`<div class="t-head"><p>Payment check</p><h3 id="ticketTitle" style="font-size:20px;margin-top:6px">This payment could not be checked</h3></div>
      <p class="t-msg" style="margin-top:10px">${esc(err.message)}</p><div class="t-actions"><button class="btn" data-close data-autofocus>Fix the details</button></div>`);
  } finally { btn.disabled = false; }
});

function showTicket(it) {
  const reasons = it.reasons.filter((r) => it.decision === 'allow' || r.level !== 'info' || it.reasons.length <= 3);
  const amt = money(it.amount);
  let actions;
  if (it.decision === 'allow') {
    actions = `<button class="btn primary" data-pay="${it.id}" data-autofocus>Send ${amt} with PayPal</button>
      <button class="btn plain" data-cancel="${it.id}">Cancel payment</button>`;
  } else if (it.decision === 'warn') {
    actions = `<button class="btn primary" data-cool="${it.id}" data-autofocus>Wait ${COOL()}, then decide</button>
      <button class="btn" data-pay="${it.id}" data-confirm="1">Send ${amt} anyway</button>
      <button class="btn plain" data-cancel="${it.id}">Cancel payment</button>`;
  } else {
    actions = `<button class="btn primary" data-cool="${it.id}" data-autofocus>Wait ${COOL()}, then decide</button>
      <details class="override"><summary>I need this now</summary>
        <textarea id="overrideReason" maxlength="200" placeholder="Write why you need it. This is saved with the payment."></textarea>
        <p class="count-left" id="ovLeft">Write at least 10 characters to unlock</p>
        <button class="btn stop" style="width:100%" data-pay="${it.id}" data-override="1" disabled>Override and send ${amt}</button>
      </details>
      <button class="btn plain" data-cancel="${it.id}">Cancel payment</button>`;
  }
  const budgets = (it.facts.budgets || []).map((b) => gauge({ ...b, spent: b.spent }, { add: it.amount })).join('');
  sheet.open(`
    <span class="stamp ${it.decision}" aria-hidden="true">${STAMP[it.decision]}</span>
    <div class="t-head">
      <p>Payment check</p>
      <div class="t-amount" id="ticketTitle">${amt}</div>
      <div class="t-to">to ${esc(it.payeeName || it.payee)} <small>for ${esc(it.category)}</small></div>
    </div>
    <div class="perf"></div>
    <p class="t-msg"><b>${esc(it.headline)}.</b> ${esc(it.message)}</p>
    ${it.tip ? `<p class="t-tip">${esc(it.tip)}</p>` : ''}
    ${reasons.length ? `<ul class="t-reasons">${reasons.map((r) => `<li class="${r.level}">${esc(r.text)}</li>`).join('')}</ul>` : ''}
    ${budgets ? `<div class="t-impact">${budgets}</div>` : ''}
    <div class="t-actions">${actions}</div>`);
  const ta = $('#overrideReason');
  if (ta) ta.addEventListener('input', () => {
    const n = ta.value.trim().length;
    $('[data-override]').disabled = n < 10;
    $('#ovLeft').textContent = n < 10 ? `${10 - n} more ${10 - n === 1 ? 'character' : 'characters'} to unlock` : 'Ready. This reason is saved with the payment.';
  });
}

document.addEventListener('click', async (e) => {
  const pay = e.target.closest('[data-pay]');
  const cool = e.target.closest('[data-cool]');
  const cancel = e.target.closest('[data-cancel]');
  const open = e.target.closest('[data-open]');
  if (pay) {
    const body = {};
    if (pay.dataset.confirm) body.confirm = true;
    if (pay.dataset.override) { body.overrideReason = $('#overrideReason')?.value || ''; body.confirm = true; }
    pay.disabled = true;
    const label = pay.textContent;
    pay.textContent = 'Sending…';
    try {
      const it = await api(`/api/intents/${pay.dataset.pay}/pay`, { method: 'POST', body });
      sheet.open(`<div class="done"><span class="stamp allow" style="position:static;display:inline-block">SENT</span>
        <div class="big" id="ticketTitle">${money(it.amount)}</div><p>sent to ${esc(it.payeeName || it.payee)}</p>
        <p class="hint" style="margin:10px 0 12px">${it.simulated ? 'Demo mode: this exact request goes to PayPal once your sandbox keys are added in Settings.' : `PayPal payout batch <code>${esc(it.payoutBatchId)}</code>`}</p>
        ${it.paypalRequest ? `<details class="apireq" ${it.simulated ? 'open' : ''}><summary>PayPal Payouts API request</summary><pre>${esc(`${it.paypalRequest.method} ${it.paypalRequest.url}\n\n${JSON.stringify(it.paypalRequest.body, null, 2)}${it.paypalResponse ? `\n\nResponse:\n${JSON.stringify(it.paypalResponse, null, 2)}` : ''}`)}</pre></details>` : ''}
        <div style="height:14px"></div>
        <button class="btn primary wide" data-close data-autofocus>Done</button></div>`);
      $('#payForm').reset();
      loadIntents(); refresh();
    } catch (err) {
      pay.disabled = false; pay.textContent = label;
      toast(err.message, 4200);
    }
  }
  if (cool) {
    try {
      const it = await api(`/api/intents/${cool.dataset.cool}/cooloff`, { method: 'POST' });
      const until = new Date(it.coolUntil).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
      sheet.open(`<div class="done"><span class="stamp warn" style="position:static;display:inline-block">ON HOLD</span>
        <div class="big" id="ticketTitle" style="font-size:28px">Until ${until}</div>
        <p class="hint" style="margin:8px 0 18px">Your ${money(it.amount)} stays with you. If you still want it then, open it from Checked payments.</p>
        <button class="btn primary wide" data-close data-autofocus>Done</button></div>`);
      loadIntents();
    } catch (err) { toast(err.message); }
  }
  if (cancel) {
    await api(`/api/intents/${cancel.dataset.cancel}/cancel`, { method: 'POST' }).catch(() => {});
    sheet.close();
    toast('Payment cancelled. Nothing was sent.');
    loadIntents();
  }
  if (open) {
    const list = await api('/api/intents');
    const it = list.find((x) => x.id === open.dataset.open);
    if (it) showTicket(it);
  }
});

async function loadIntents() {
  const list = await api('/api/intents');
  const word = { paid: 'Sent', cancelled: 'Cancelled', cooling: 'On hold', pending: 'Not sent', failed: 'Failed' };
  $('#intents').innerHTML = list.length ? list.map((it) => {
    const ready = it.status === 'cooling' && new Date(it.coolUntil) <= new Date();
    const when = new Date(it.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const sub = it.status === 'cooling' && !ready ? `on hold until ${new Date(it.coolUntil).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : when;
    return `<li class="${it.decision}"><span class="dot" title="${STAMP[it.decision].toLowerCase()}"></span>
      <div><b>${money(it.amount)}</b> to ${esc(it.payeeName || it.payee)}<small>${esc(it.category)}, ${sub}${it.overrideReason ? `. Reason: “${esc(it.overrideReason)}”` : ''}</small></div>
      <span>${['pending', 'cooling'].includes(it.status) ? `<button class="open" data-open="${it.id}">${ready ? 'Decide' : 'Open'}</button>` : ''}<span class="state ${ready ? 'ready' : it.status}">${ready ? 'Ready' : word[it.status]}</span></span></li>`;
  }).join('') : '<li class="empty" style="display:block">Payments you check show up here. Try one of the examples.</li>';
}
setInterval(() => { if (S.view === 'pay' && $('#sheet').hidden) loadIntents(); }, 15000);

// ---------- Ask ----------
function addMsg(role, html, cls = '') {
  const el = document.createElement('div');
  el.className = `msg ${role} ${cls}`;
  el.innerHTML = html;
  $('#chat').appendChild(el);
  el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'end' });
  return el;
}
async function ask(q) {
  q = q.trim();
  if (!q) return;
  addMsg('user', esc(q));
  const typing = addMsg('bot', 'Looking at your PayPal', 'typing');
  $('#askInput').value = '';
  try {
    const r = await api('/api/ask', { method: 'POST', body: { question: q, history: S.chat } });
    typing.remove();
    const used = r.toolsUsed?.length ? `<span class="src">Checked: ${[...new Set(r.toolsUsed)].map((t) => ({ summarize: 'totals', find_transactions: 'transactions', budgets: 'budgets', subscriptions: 'subscriptions', can_i_afford: 'budget rules' }[t] || t)).join(', ')}</span>` : '';
    addMsg('bot', rich(r.answer) + used);
    S.chat.push({ role: 'user', content: q }, { role: 'assistant', content: r.answer });
  } catch (e) {
    typing.remove();
    addMsg('bot', esc(e.message));
  }
}
$('#askForm').addEventListener('submit', (e) => { e.preventDefault(); ask($('#askInput').value); });
$('#chips').addEventListener('click', (e) => { if (e.target.tagName === 'BUTTON') ask(e.target.textContent); });

// ---------- Budgets ----------
async function loadBudgets() {
  const list = await api('/api/budgets');
  S.budgets = list;
  $('#budgetList').innerHTML = list.length ? list.map((b) => gauge(b, { actions: true })).join('') : '<p class="empty">No budgets yet. Add your first one.</p>';
}
async function saveBudget(b, msg = 'Budget saved') {
  await api('/api/budgets', { method: 'POST', body: b });
  toast(msg);
  await loadBudgets();
  refresh();
}
function resetBudgetForm() {
  $('#budgetForm').reset();
  $('#budgetFormTitle').textContent = 'Add a budget';
  $('#budgetForm [name=category]').disabled = false;
}
$('#budgetForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const sel = $('#budgetForm [name=category]');
  sel.disabled = false;
  const f = Object.fromEntries(new FormData(e.target));
  saveBudget({ category: f.category, limit: Number(f.limit), mode: f.mode }).then(resetBudgetForm).catch((err) => toast(err.message));
});
$('#budgetList').addEventListener('click', async (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  const find = (c) => S.budgets.find((b) => b.category === c);
  if (t.dataset.toggle) {
    const b = find(t.dataset.toggle);
    const mode = b.mode === 'block' ? 'alert' : 'block';
    saveBudget({ category: b.category, limit: b.limit, mode }, mode === 'block' ? `${b.category === 'ALL' ? 'Total' : b.category} now blocks payments that go over` : `${b.category === 'ALL' ? 'Total' : b.category} now only alerts you`);
  }
  if (t.dataset.edit) {
    const b = find(t.dataset.edit);
    const sel = $('#budgetForm [name=category]');
    sel.value = b.category; sel.disabled = true;
    $('#budgetForm [name=limit]').value = b.limit;
    $(`#budgetForm [name=mode][value=${b.mode}]`).checked = true;
    $('#budgetFormTitle').textContent = `Change ${b.category === 'ALL' ? 'total' : b.category} budget`;
    $('#budgetForm').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
    $('#budgetForm [name=limit]').focus({ preventScroll: true });
  }
  if (t.dataset.del) {
    await api(`/api/budgets/${t.dataset.del}`, { method: 'DELETE' });
    toast('Budget deleted');
    loadBudgets(); refresh();
  }
});
$('#resetDemo').addEventListener('click', async () => {
  try {
    await api('/api/demo/reset', { method: 'POST' });
    toast('Sample data reset');
    resetBudgetForm();
    await refresh(); loadBudgets(); loadIntents();
  } catch (e) { toast(e.message); }
});

// ---------- Settings ----------
async function loadSettings() {
  const st = await api('/api/settings');
  renderSettings(st);
}
function renderSettings(st) {
  const pp = st.paypal, an = st.ai || { connected: false };
  S.providers = st.providers || S.providers || [];
  const pill = (el, on, source) => {
    el.className = `pill ${on ? (source === 'server' ? 'server' : 'on') : ''}`;
    el.textContent = on ? (source === 'server' ? 'Using demo key' : 'Connected') : 'Not connected';
  };
  pill($('#ppPill'), pp.connected, pp.source);
  pill($('#aiPill'), an.connected, an.source);
  $('#keyStatus').innerHTML = `
    <li class="${pp.connected ? 'on' : ''}"><span class="led"></span>PayPal sandbox <small>${pp.connected ? (pp.source === 'user' ? 'your keys' : 'demo keys') : 'off'}</small></li>
    <li class="${an.connected ? 'on' : ''}"><span class="led"></span>AI <small>${an.connected ? `${esc(an.short)} ${esc(an.model)}${an.source === 'user' ? '' : ' (demo key)'}` : 'off'}</small></li>`;
  $('#ppCurrent').hidden = !pp.clientId;
  $('#ppCurrent').innerHTML = pp.clientId ? `Your Client ID <b>${esc(pp.clientId)}</b> is saved.${pp.transactionSearch === false ? ' Transaction search is not switched on for this app yet, so past payments cannot be read.' : ''} Paste new keys to replace them.` : '';
  $('#aiCurrent').hidden = !an.key;
  $('#aiCurrent').innerHTML = an.key ? `Your ${esc(an.label)} key <b>${esc(an.key)}</b> is saved, using <b>${esc(an.model)}</b>. Paste a new key to replace it.` : '';
  $('[data-forget=paypal]').hidden = !pp.clientId;
  $('[data-forget=ai]').hidden = !an.key;
  const sel = $('#aiProvider');
  if (!sel.options.length) sel.innerHTML = S.providers.map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join('');
  if (an.key && an.provider) sel.value = an.provider;
  providerChanged(false);
}

function providerChanged(clearModel = true) {
  const p = (S.providers || []).find((x) => x.id === $('#aiProvider').value);
  if (!p) return;
  const model = $('#aiModel');
  model.placeholder = p.model ? `${p.model} (default)` : 'Model name, e.g. llama-3.3-70b';
  if (clearModel) model.value = '';
  $('#aiBaseRow').hidden = !p.needsBase;
  $('#aiSteps').innerHTML = p.keysUrl
    ? `<li>Open <a href="${p.keysUrl}" target="_blank" rel="noopener">${esc(new URL(p.keysUrl).hostname)}</a> and log in.</li><li>Create an API key${p.keyHint ? ` (it starts with <b>${esc(p.keyHint)}</b>)` : ''} and paste it below.</li><li>Leave the model empty to use <b>${esc(p.model)}</b>, or type another model your account can use.</li>`
    : '<li>Paste the API key and the base URL of any OpenAI-compatible service (it must support tool calling).</li><li>Type the model name to use.</li>';
}
$('#aiProvider').addEventListener('change', () => providerChanged(true));
$('#aiForm [name=key]').addEventListener('input', (e) => {
  const k = e.target.value.trim();
  const guess = k.startsWith('sk-ant-') ? 'anthropic' : k.startsWith('sk-or-') ? 'openrouter' : k.startsWith('gsk_') ? 'groq' : k.startsWith('AIza') ? 'gemini' : null;
  if (guess && $('#aiProvider').value !== guess) { $('#aiProvider').value = guess; providerChanged(true); formMsg($('#aiMsg'), `Looks like a ${S.providers.find((p) => p.id === guess).label} key.`, ''); }
});

function formMsg(el, text, kind) { el.textContent = text; el.className = `form-msg ${kind || ''}`; }

$('#ppForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const btn = e.target.querySelector('[type=submit]');
  const msg = $('#ppMsg');
  if (!f.clientId.trim() || !f.secret.trim()) return formMsg(msg, 'Paste both the Client ID and the Secret.', 'err');
  btn.disabled = true; btn.textContent = 'Checking with PayPal…'; formMsg(msg, '');
  try {
    const st = await api('/api/settings/paypal', { method: 'POST', body: f });
    e.target.reset();
    renderSettings(st);
    if (st.paypal.transactionSearch === false) formMsg(msg, 'Connected. Payouts will work, but tick "Transaction search" in your PayPal app so SpendGuard can read past payments.', 'warn');
    else formMsg(msg, `Connected to PayPal sandbox.${st.synced?.synced != null ? ` Read ${st.synced.synced} transactions.` : ''}`, 'ok');
    toast('PayPal connected');
    await loadConfig(); refresh();
  } catch (err) { formMsg(msg, err.message, 'err'); }
  finally { btn.disabled = false; btn.textContent = 'Check and connect PayPal'; }
});

$('#aiForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const btn = e.target.querySelector('[type=submit]');
  const msg = $('#aiMsg');
  if (!f.key.trim()) return formMsg(msg, 'Paste your AI API key.', 'err');
  const label = S.providers.find((p) => p.id === f.provider)?.label || 'the provider';
  btn.disabled = true; btn.textContent = `Checking with ${label}…`; formMsg(msg, '');
  try {
    const st = await api('/api/settings/ai', { method: 'POST', body: f });
    e.target.querySelector('[name=key]').value = '';
    renderSettings(st);
    formMsg(msg, `AI is on with ${st.ai.label} (${st.ai.model}). Insights, categories and answers now come from it.`, 'ok');
    toast(`${st.ai.short} turned on`);
    await loadConfig(); refresh();
  } catch (err) { formMsg(msg, err.message, 'err'); }
  finally { btn.disabled = false; btn.textContent = 'Check and turn on AI'; }
});

document.addEventListener('click', async (e) => {
  const peek = e.target.closest('[data-peek]');
  if (peek) {
    const input = peek.parentElement.querySelector('input');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    peek.classList.toggle('on', show);
    peek.setAttribute('aria-label', show ? 'Hide' : 'Show');
  }
  const forget = e.target.closest('[data-forget]');
  if (forget) {
    const st = await api(`/api/settings/${forget.dataset.forget}`, { method: 'DELETE' });
    renderSettings(st);
    formMsg($(forget.dataset.forget === 'paypal' ? '#ppMsg' : '#aiMsg'), 'Removed.', '');
    toast(forget.dataset.forget === 'paypal' ? 'PayPal keys removed' : 'AI key removed');
    await loadConfig(); refresh();
  }
});

boot().catch((e) => toast(e.message, 6000));
