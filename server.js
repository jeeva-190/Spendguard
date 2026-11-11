require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const store = require('./src/store');
const paypal = require('./src/paypal');
const ai = require('./src/ai');
const A = require('./src/analytics');
const guard = require('./src/guard');
const agent = require('./src/agent');
const demo = require('./src/demo');
const { syncFromPayPal } = require('./src/sync');
const { insights, alerts, dismissAlert } = require('./src/insights');
const { CATEGORIES } = require('./src/categories');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));

// Each browser gets its own private session (data + keys), identified by an http-only cookie.
app.use('/api', (req, res, next) => {
  const m = /(?:^|;\s*)sg_sid=([A-Za-z0-9_-]{20,64})/.exec(req.headers.cookie || '');
  let sid = m && m[1];
  if (!sid) {
    sid = crypto.randomBytes(24).toString('base64url');
    res.setHeader('Set-Cookie', `sg_sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 90}${req.secure ? '; Secure' : ''}`);
  }
  store.run(sid, () => {
    if (!store.db.meta.seeded && DEMO_DATA) demo.seed();
    next();
  });
});
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/fontsource', express.static(path.join(__dirname, 'node_modules/@fontsource')));
app.use('/vendor/ag-grid', express.static(path.join(__dirname, 'node_modules/ag-grid-community')));

const DEMO_DATA = process.env.DEMO_DATA !== 'false';
const COOL_OFF_MIN = Number(process.env.COOL_OFF_MINUTES || 1440);

// Very small per-IP limiter for AI-backed endpoints (public demo safety).
const hits = new Map();
function limit(max, windowMs) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: 'Slow down a little — try again in a minute.' });
    arr.push(now);
    hits.set(key, arr);
    next();
  };
}

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error(e);
  res.status(e.status && e.status < 500 ? e.status : 500).json({ error: e.message });
});

const validMonth = (m) => (/^\d{4}-\d{2}$/.test(m || '') ? m : A.currentMonth());

app.get('/api/config', (req, res) => res.json({
  paypal: paypal.configured(), paypalSource: paypal.creds()?.source || null, paypalEnv: process.env.PAYPAL_ENV === 'live' ? 'live' : 'sandbox',
  ai: ai.enabled(), aiInfo: ai.describe(), demoData: DEMO_DATA, coolOffMinutes: COOL_OFF_MIN, categories: CATEGORIES,
  lastSync: store.db.meta.lastSync,
}));

// ---------- Settings: the visitor's own keys ----------
const mask = (v) => (v ? `${v.slice(0, 4)}••••${v.slice(-4)}` : null);
function settingsView() {
  const s = store.db.settings || {};
  return {
    paypal: { connected: paypal.configured(), source: paypal.creds()?.source || null, clientId: mask(s.paypalClientId), env: 'sandbox', transactionSearch: s.paypalTransactionSearch ?? null },
    ai: { connected: ai.enabled(), ...(ai.describe() || {}), key: mask(s.aiKey), baseUrl: s.aiProvider === 'custom' ? s.aiBaseUrl : null },
    providers: Object.entries(ai.PROVIDERS).map(([id, p]) => ({ id, label: p.label, model: p.model, keyHint: p.keyHint, keysUrl: p.keysUrl, needsBase: id === 'custom' })),
    savedAt: s.savedAt || null,
  };
}
app.get('/api/settings', (req, res) => res.json(settingsView()));

app.post('/api/settings/paypal', limit(8, 60_000), wrap(async (req, res) => {
  const id = String(req.body.clientId || '').trim();
  const secret = String(req.body.secret || '').trim();
  if (id.length < 20 || secret.length < 20) return res.status(400).json({ error: 'Paste both the Client ID and the Secret from your PayPal sandbox app.' });
  if (process.env.PAYPAL_ENV === 'live') return res.status(400).json({ error: 'This server is set to live PayPal. Your own keys can only be used with the sandbox.' });
  const check = await paypal.verify(id, secret);
  Object.assign(store.db.settings, { paypalClientId: id, paypalSecret: secret, paypalTransactionSearch: check.transactionSearch, savedAt: new Date().toISOString() });
  store.save();
  let synced = null;
  if (check.transactionSearch) synced = await syncFromPayPal(3).catch((e) => ({ error: e.message }));
  A.classifyPending().catch(() => {});
  res.json({ ...settingsView(), synced });
}));

app.post('/api/settings/ai', limit(8, 60_000), wrap(async (req, res) => {
  const key = String(req.body.key || '').trim();
  const provider = String(req.body.provider || ai.detect(key) || '').trim();
  const model = String(req.body.model || '').trim();
  const base = String(req.body.baseUrl || '').trim();
  if (key.length < 12) return res.status(400).json({ error: 'Paste your AI API key.' });
  if (!ai.PROVIDERS[provider]) return res.status(400).json({ error: 'Pick which AI provider this key is from.' });
  if (provider === 'custom' && !/^https:\/\/[^\s]+$/.test(base)) return res.status(400).json({ error: 'Enter the https:// base URL of your OpenAI-compatible API.' });
  const check = await ai.verify({ provider, key, model, base });
  Object.assign(store.db.settings, { aiProvider: provider, aiKey: key, aiModel: check.model, aiBaseUrl: provider === 'custom' ? check.base : undefined, savedAt: new Date().toISOString() });
  delete store.db.settings.anthropicKey;
  store.db.insightsCache = {};
  // Re-sort transactions with the new AI (keep the user's own corrections).
  for (const [id, c] of Object.entries(store.db.categoryCache)) if (c.source !== 'user') delete store.db.categoryCache[id];
  store.save();
  A.classifyPending().catch(() => {});
  res.json(settingsView());
}));

app.delete('/api/settings/:which', (req, res) => {
  const s = store.db.settings;
  if (req.params.which === 'paypal' || req.params.which === 'all') { delete s.paypalClientId; delete s.paypalSecret; delete s.paypalTransactionSearch; }
  if (req.params.which === 'ai' || req.params.which === 'all') { delete s.aiKey; delete s.aiProvider; delete s.aiModel; delete s.aiBaseUrl; delete s.anthropicKey; }
  store.db.insightsCache = {};
  store.save();
  res.json(settingsView());
});

app.get('/api/state', wrap(async (req, res) => {
  const month = validMonth(req.query.month);
  res.json({ summary: A.summary(month), budgets: A.budgetStatus(month), alerts: alerts(month), subscriptions: A.subscriptions() });
}));

app.get('/api/transactions', wrap(async (req, res) => {
  const month = req.query.month === 'all' ? null : validMonth(req.query.month);
  const rows = A.enriched().filter((t) => !month || A.monthKey(t.date) === month);
  res.json(rows);
}));

app.patch('/api/transactions/:id', wrap(async (req, res) => {
  const t = store.db.transactions[req.params.id];
  if (!t) return res.status(404).json({ error: 'Not found' });
  if (!CATEGORIES.includes(req.body.category)) return res.status(400).json({ error: 'Unknown category' });
  const prev = store.db.categoryCache[t.id] || {};
  store.db.categoryCache[t.id] = { ...prev, category: req.body.category, merchant: prev.merchant || t.counterparty, source: 'user' };
  store.db.insightsCache = {};
  store.save();
  res.json({ ok: true });
}));

app.post('/api/sync', limit(6, 60_000), wrap(async (req, res) => {
  const result = paypal.configured() ? await syncFromPayPal(3) : { synced: 0, skipped: 'PayPal not configured' };
  const classified = await A.classifyPending();
  res.json({ ...result, classified });
}));

app.get('/api/insights', limit(20, 60_000), wrap(async (req, res) => res.json(await insights(validMonth(req.query.month)))));

app.post('/api/ask', limit(12, 60_000), wrap(async (req, res) => {
  if (!req.body.question) return res.status(400).json({ error: 'Ask a question' });
  res.json(await agent.ask(req.body.question, Array.isArray(req.body.history) ? req.body.history : []));
}));

// ---------- Budgets ----------
app.get('/api/budgets', (req, res) => res.json(A.budgetStatus()));
app.post('/api/budgets', wrap(async (req, res) => {
  const { category, limit: amount, mode } = req.body;
  if (category !== 'ALL' && !CATEGORIES.includes(category)) return res.status(400).json({ error: 'Unknown category' });
  if (!(Number(amount) > 0)) return res.status(400).json({ error: 'Budget must be more than $0' });
  const existing = store.db.budgets.find((b) => b.category === category);
  const b = { id: existing?.id || `b-${crypto.randomUUID().slice(0, 8)}`, category, limit: A.round(Number(amount)), mode: mode === 'block' ? 'block' : 'alert' };
  store.db.budgets = existing ? store.db.budgets.map((x) => (x.category === category ? b : x)) : store.db.budgets.concat(b);
  store.db.insightsCache = {};
  store.save();
  res.json(A.budgetStatus());
}));
app.delete('/api/budgets/:id', (req, res) => {
  store.db.budgets = store.db.budgets.filter((b) => b.id !== req.params.id);
  store.save();
  res.json(A.budgetStatus());
});

app.post('/api/alerts/:id/dismiss', (req, res) => { dismissAlert(req.params.id); res.json({ ok: true }); });

// ---------- SpendGuard: check, then pay ----------
app.post('/api/guard/check', limit(15, 60_000), wrap(async (req, res) => {
  res.json(await guard.check(req.body || {}));
}));

app.get('/api/intents', (req, res) => {
  res.json(Object.values(store.db.intents).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30));
});

app.post('/api/intents/:id/cooloff', (req, res) => {
  const it = store.db.intents[req.params.id];
  if (!it || it.status !== 'pending') return res.status(400).json({ error: 'Nothing to pause' });
  it.status = 'cooling';
  it.coolUntil = new Date(Date.now() + COOL_OFF_MIN * 60_000).toISOString();
  store.save();
  res.json(it);
});

app.post('/api/intents/:id/cancel', (req, res) => {
  const it = store.db.intents[req.params.id];
  if (!it || !['pending', 'cooling'].includes(it.status)) return res.status(400).json({ error: 'Nothing to cancel' });
  it.status = 'cancelled';
  store.save();
  res.json(it);
});

app.post('/api/intents/:id/pay', limit(10, 60_000), wrap(async (req, res) => {
  const it = store.db.intents[req.params.id];
  if (!it) return res.status(404).json({ error: 'Payment not found' });
  if (!['pending', 'cooling'].includes(it.status)) return res.status(400).json({ error: `This payment is already ${it.status}` });
  if (it.status === 'cooling' && Date.now() < new Date(it.coolUntil)) {
    return res.status(409).json({ error: `Cool-off until ${new Date(it.coolUntil).toLocaleString()}. You can cancel instead.` });
  }

  // Re-check against the latest numbers: the rules may be stricter now than when you started.
  const fresh = guard.evaluate(it);
  const decision = guard.SEVERITY[fresh.decision] > guard.SEVERITY[it.decision] ? fresh.decision : it.decision;
  const reason = String(req.body.overrideReason || '').trim();
  if (decision === 'block' && reason.length < 10) {
    return res.status(409).json({ error: 'Blocked by your budget. To override, write a reason (at least 10 characters).', decision, reasons: fresh.reasons });
  }
  if (decision === 'warn' && !req.body.confirm) {
    return res.status(409).json({ error: 'Please confirm you want to pay despite the warnings.', decision, reasons: fresh.reasons });
  }

  let payout;
  const payoutArgs = { receiver: it.payee, amount: it.amount, note: it.note || `Payment to ${it.payeeName || it.payee}`, intentId: it.id.replace(/-/g, '').slice(0, 24) };
  it.paypalRequest = { method: 'POST', url: `${paypal.BASE}/v1/payments/payouts`, body: paypal.payoutBody(payoutArgs) };
  if (paypal.configured()) {
    try {
      payout = await paypal.createPayout(payoutArgs);
    } catch (e) {
      it.status = 'failed';
      it.error = e.message;
      store.save();
      throw Object.assign(new Error(`PayPal rejected the payout: ${e.message}`), { status: 502 });
    }
  } else {
    payout = { batch_header: { payout_batch_id: `SIMULATED-${it.id.slice(0, 8)}`, batch_status: 'SUCCESS' }, simulated: true };
  }

  const txnId = `SG-${it.id.slice(0, 8)}`;
  store.db.transactions[txnId] = {
    id: txnId, date: new Date().toISOString(), amount: it.amount, direction: 'out', currency: 'USD',
    counterparty: it.payeeName || it.payee, note: it.note || 'Paid via SpendGuard', status: 'P', kind: 'payout', fee: 0,
    source: payout.simulated ? 'demo' : 'spendguard', payoutBatchId: payout.batch_header?.payout_batch_id,
  };
  store.db.categoryCache[txnId] = { category: it.category, merchant: it.payeeName || it.payee, recurring: false, source: 'user' };
  if (!payout.simulated) it.paypalResponse = { batch_header: payout.batch_header };
  Object.assign(it, { status: 'paid', paidAt: new Date().toISOString(), overrideReason: reason || undefined, payoutBatchId: payout.batch_header?.payout_batch_id, simulated: Boolean(payout.simulated) });
  store.db.insightsCache = {};
  store.save();
  res.json(it);
}));

app.post('/api/demo/reset', limit(3, 60_000), wrap(async (req, res) => {
  if (!DEMO_DATA) return res.status(400).json({ error: 'Demo data is turned off' });
  const keepReal = Object.values(store.db.transactions).filter((t) => t.source !== 'demo');
  store.reset({ keepSettings: true });
  for (const t of keepReal) store.db.transactions[t.id] = t;
  demo.seed({ force: true });
  A.classifyPending().catch(() => {});
  res.json({ ok: true });
}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`SpendGuard running on http://localhost:${PORT}`);
  console.log(`  PayPal: ${process.env.PAYPAL_CLIENT_ID ? 'server keys set' : 'no server keys (visitors can add their own in Settings)'}`);
  console.log(`  AI:     ${process.env.AI_API_KEY || process.env.ANTHROPIC_API_KEY ? 'server key set' : 'no server key (visitors can add their own in Settings)'}`);
});
