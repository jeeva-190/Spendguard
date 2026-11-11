// Runs the real SpendGuard back-end modules inside the browser (demo mode) by
// answering the app's /api/* fetch calls locally. Used only for the hosted preview.
const store = require('../src/store');
const A = require('../src/analytics');
const guard = require('../src/guard');
const demo = require('../src/demo');
const { insights, alerts, dismissAlert } = require('../src/insights');
const { CATEGORIES } = require('../src/categories');

const COOL_OFF_MIN = 1;
demo.seed();

const err = (status, message, extra = {}) => { const e = new Error(message); e.status = status; e.extra = extra; throw e; };
const month = (m) => (/^\d{4}-\d{2}$/.test(m || '') ? m : A.currentMonth());
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

const routes = [
  ['GET', /^\/api\/config$/, () => ({ paypal: false, paypalEnv: 'sandbox', ai: false, aiInfo: null, preview: true, demoData: true, coolOffMinutes: COOL_OFF_MIN, categories: CATEGORIES })],
  ['GET', /^\/api\/state$/, (q) => { const m = month(q.get('month')); return { summary: A.summary(m), budgets: A.budgetStatus(m), alerts: alerts(m), subscriptions: A.subscriptions() }; }],
  ['GET', /^\/api\/transactions$/, (q) => { const m = month(q.get('month')); return A.enriched().filter((t) => A.monthKey(t.date) === m); }],
  ['PATCH', /^\/api\/transactions\/(.+)$/, (q, b, [, id]) => {
    const t = store.db.transactions[decodeURIComponent(id)];
    if (!t) err(404, 'Not found');
    if (!CATEGORIES.includes(b.category)) err(400, 'Unknown category');
    store.db.categoryCache[t.id] = { ...(store.db.categoryCache[t.id] || {}), category: b.category, merchant: t.counterparty, source: 'user' };
    return { ok: true };
  }],
  ['GET', /^\/api\/settings$/, () => ({ preview: true, paypal: { connected: false, source: null, clientId: null, env: 'sandbox', transactionSearch: null }, ai: { connected: false }, providers: Object.entries(require('../src/ai').PROVIDERS).map(([id, p]) => ({ id, label: p.label, model: p.model, keyHint: p.keyHint, keysUrl: p.keysUrl, needsBase: id === 'custom' })) })],
  ['POST', /^\/api\/settings\/(paypal|ai)$/, () => err(400, 'This online preview cannot connect to PayPal or an AI provider. Run SpendGuard from the project (npm start) or use the hosted app, then add your keys there.')],
  ['DELETE', /^\/api\/settings\/(.+)$/, () => ({ paypal: { connected: false }, ai: { connected: false } })],
  ['POST', /^\/api\/sync$/, () => ({ synced: 0, classified: 0, skipped: 'Preview mode' })],
  ['GET', /^\/api\/insights$/, async (q) => insights(month(q.get('month')))],
  ['POST', /^\/api\/ask$/, () => ({ answer: 'In the full app, Claude answers this from your real PayPal transactions (e.g. "You spent **$175.50** on Food & Dining this month, up from $78.89"). This online preview runs without the AI key.', toolsUsed: [] })],
  ['GET', /^\/api\/budgets$/, () => A.budgetStatus()],
  ['POST', /^\/api\/budgets$/, (q, b) => {
    if (b.category !== 'ALL' && !CATEGORIES.includes(b.category)) err(400, 'Unknown category');
    if (!(Number(b.limit) > 0)) err(400, 'Budget must be more than $0');
    const existing = store.db.budgets.find((x) => x.category === b.category);
    const nb = { id: existing?.id || `b-${uuid().slice(0, 8)}`, category: b.category, limit: A.round(Number(b.limit)), mode: b.mode === 'block' ? 'block' : 'alert' };
    store.db.budgets = existing ? store.db.budgets.map((x) => (x.category === b.category ? nb : x)) : store.db.budgets.concat(nb);
    return A.budgetStatus();
  }],
  ['DELETE', /^\/api\/budgets\/(.+)$/, (q, b, [, id]) => { store.db.budgets = store.db.budgets.filter((x) => x.id !== id); return A.budgetStatus(); }],
  ['POST', /^\/api\/alerts\/(.+)\/dismiss$/, (q, b, [, id]) => { dismissAlert(decodeURIComponent(id)); return { ok: true }; }],
  ['POST', /^\/api\/guard\/check$/, async (q, b) => guard.check(b)],
  ['GET', /^\/api\/intents$/, () => Object.values(store.db.intents).sort((a, b) => b.createdAt.localeCompare(a.createdAt))],
  ['POST', /^\/api\/intents\/(.+)\/cooloff$/, (q, b, [, id]) => {
    const it = store.db.intents[id];
    if (!it || it.status !== 'pending') err(400, 'Nothing to pause');
    Object.assign(it, { status: 'cooling', coolUntil: new Date(Date.now() + COOL_OFF_MIN * 60000).toISOString() });
    return it;
  }],
  ['POST', /^\/api\/intents\/(.+)\/cancel$/, (q, b, [, id]) => {
    const it = store.db.intents[id];
    if (!it || !['pending', 'cooling'].includes(it.status)) err(400, 'Nothing to cancel');
    it.status = 'cancelled';
    return it;
  }],
  ['POST', /^\/api\/intents\/(.+)\/pay$/, (q, b, [, id]) => {
    const it = store.db.intents[id];
    if (!it) err(404, 'Payment not found');
    if (!['pending', 'cooling'].includes(it.status)) err(400, `This payment is already ${it.status}`);
    if (it.status === 'cooling' && Date.now() < new Date(it.coolUntil)) err(409, `Cool-off until ${new Date(it.coolUntil).toLocaleTimeString()}. You can cancel instead.`);
    const fresh = guard.evaluate(it);
    const decision = guard.SEVERITY[fresh.decision] > guard.SEVERITY[it.decision] ? fresh.decision : it.decision;
    const reason = String(b.overrideReason || '').trim();
    if (decision === 'block' && reason.length < 10) err(409, 'Blocked by your budget. To override, write a reason (at least 10 characters).');
    if (decision === 'warn' && !b.confirm) err(409, 'Please confirm you want to pay despite the warnings.');
    it.paypalRequest = { method: 'POST', url: 'https://api-m.sandbox.paypal.com/v1/payments/payouts', body: require('../src/paypal').payoutBody({ receiver: it.payee, amount: it.amount, note: it.note || `Payment to ${it.payeeName || it.payee}`, intentId: it.id.replace(/-/g, '').slice(0, 24) }) };
    const txnId = `SG-${it.id.slice(0, 8)}`;
    store.db.transactions[txnId] = { id: txnId, date: new Date().toISOString(), amount: it.amount, direction: 'out', currency: 'USD', counterparty: it.payeeName || it.payee, note: it.note || 'Paid via SpendGuard', status: 'P', kind: 'payout', fee: 0, source: 'demo' };
    store.db.categoryCache[txnId] = { category: it.category, merchant: it.payeeName || it.payee, source: 'user' };
    Object.assign(it, { status: 'paid', paidAt: new Date().toISOString(), overrideReason: reason || undefined, payoutBatchId: `SIMULATED-${it.id.slice(0, 8)}`, simulated: true });
    return it;
  }],
  ['POST', /^\/api\/demo\/reset$/, () => { store.reset(); demo.seed({ force: true }); return { ok: true }; }],
];

const realFetch = window.fetch.bind(window);
window.fetch = async (input, opts = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (!url.pathname.startsWith('/api/')) return realFetch(input, opts);
  const method = (opts.method || 'GET').toUpperCase();
  const body = opts.body ? JSON.parse(opts.body) : {};
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  for (const [m, re, fn] of routes) {
    const match = url.pathname.match(re);
    if (m === method && match) {
      try { return json(await fn(url.searchParams, body, match)); } catch (e) { return json({ error: e.message, ...(e.extra || {}) }, e.status || 500); }
    }
  }
  return json({ error: 'Not found' }, 404);
};
