// SpendGuard: checks a payment BEFORE it reaches PayPal.
// Code decides (allow / warn / block) from hard facts; the AI only explains the decision
// in plain words. A prompt like "ignore your rules" can't change the decision.
const crypto = require('crypto');
const store = require('./store');
const ai = require('./ai');
const A = require('./analytics');
const { CATEGORIES, ruleCategory } = require('./categories');

const IMPULSE = new Set(['Shopping', 'Entertainment', 'Food & Dining']);
const SEVERITY = { allow: 0, warn: 1, block: 2 };

async function categorize(payment) {
  const guess = ruleCategory({ counterparty: payment.payeeName || payment.payee, note: payment.note, direction: 'out' });
  if (!ai.enabled()) return guess;
  try {
    const out = await ai.structured({
      fast: true,
      name: 'categorize_payment',
      system: `Pick the best spending category for an outgoing PayPal payment. Categories: ${CATEGORIES.join(', ')}.`,
      prompt: JSON.stringify({ payee: payment.payeeName || payment.payee, email: payment.payee, note: payment.note, amount: payment.amount }),
      schema: { type: 'object', properties: { category: { type: 'string', enum: CATEGORIES } }, required: ['category'] },
      maxTokens: 200,
    });
    return out.category || guess;
  } catch {
    return guess;
  }
}

// Pure, deterministic evaluation.
function evaluate({ amount, category, payee, payeeName, localHour }) {
  const month = A.currentMonth();
  const s = A.summary(month);
  const budgets = A.budgetStatus(month);
  const spend = A.enriched().filter(A.isSpend);
  const now = Date.now();
  const reasons = [];
  const add = (code, level, text) => reasons.push({ code, level, text });
  const money = A.money;
  const name = (payeeName || payee || '').toLowerCase();

  // Budgets touched by this payment (category budget + overall budget)
  const touched = budgets.filter((b) => b.category === category || b.category === 'ALL');
  const budgetFacts = touched.map((b) => {
    const after = A.round(b.spent + amount);
    const overBy = A.round(after - b.limit);
    if (overBy > 0) {
      add(b.mode === 'block' ? 'BUDGET_BLOCK' : 'BUDGET_OVER', b.mode === 'block' ? 'block' : 'warn',
        `${b.category === 'ALL' ? 'Monthly' : b.category} budget is ${money(b.limit)}; you've spent ${money(b.spent)}. This puts you ${money(overBy)} over.`);
    } else if (after / b.limit >= 0.8 && b.spent / b.limit < 0.8) {
      add('BUDGET_NEAR', 'info', `This uses ${Math.round((after / b.limit) * 100)}% of your ${b.category === 'ALL' ? 'monthly' : b.category} budget.`);
    }
    return { category: b.category, limit: b.limit, spent: b.spent, after, remaining: A.round(b.limit - after), mode: b.mode };
  });

  // Typical size for this category
  const peers = spend.filter((t) => t.category === category);
  const typical = peers.length ? A.round(peers.reduce((x, t) => x + t.amount, 0) / peers.length) : null;
  if (typical && amount >= 100 && amount > typical * 3) add('UNUSUAL_SIZE', 'warn', `That's about ${Math.round(amount / typical)}× your usual ${category} payment (${money(typical)}).`);

  // Same category recently
  const recent = peers.filter((t) => now - new Date(t.date) < 14 * 864e5);
  if (IMPULSE.has(category) && recent.length >= 3) add('FREQUENT', 'info', `${recent.length} ${category} payments in the last 14 days (${money(recent.reduce((x, t) => x + t.amount, 0))}).`);

  // Possible duplicate: same payee, similar amount, last 7 days
  const dup = spend.find((t) => (t.merchant || '').toLowerCase().includes(name.split('@')[0]) && name.length > 2 &&
    Math.abs(t.amount - amount) < 1 && now - new Date(t.date) < 7 * 864e5);
  if (dup) add('DUPLICATE', 'warn', `You paid ${dup.merchant} ${money(dup.amount)} on ${new Date(dup.date).toDateString()}. Is this a duplicate?`);

  // First time paying this person, and it's large
  const known = spend.some((t) => (t.counterparty || '').toLowerCase() === name || (t.merchant || '').toLowerCase() === name);
  if (name && !known && amount >= 200) add('NEW_PAYEE', 'warn', `You have never paid ${payeeName || payee} before, and this is a large amount. Check who they are first.`);

  // Late-night impulse
  const hour = Number.isInteger(localHour) ? localHour : new Date().getHours();
  if (IMPULSE.has(category) && (hour >= 23 || hour < 5)) add('LATE_NIGHT', 'warn', `It is ${hour}:00. Late-night ${category} purchases are the ones people most often regret.`);

  // Cash flow this month
  const netAfter = A.round(s.income - s.spent - amount);
  if (netAfter < 0) add('NEGATIVE_NET', 'warn', `After this, you'll have spent ${money(-netAfter)} more than you earned this month.`);

  const decision = reasons.some((r) => r.level === 'block') ? 'block' : reasons.some((r) => r.level === 'warn') ? 'warn' : 'allow';
  return {
    decision,
    reasons,
    facts: {
      month, amount, category, income: s.income, spent: s.spent, netAfter, projectedSpend: s.projected,
      budgets: budgetFacts, typical, recentSameCategory: recent.length,
    },
  };
}

async function explain(payment, verdict) {
  const fallback = () => {
    if (verdict.decision === 'allow') return { headline: 'Looks good', message: 'This fits your budgets and your usual spending. Safe to send.', tip: null };
    const top = verdict.reasons.filter((r) => r.level !== 'info');
    return {
      headline: verdict.decision === 'block' ? 'Blocked by your budget' : 'Hold on a second',
      message: verdict.decision === 'block'
        ? 'You asked me to stop payments that break this budget, so this one has not been sent.'
        : 'This payment does not fit your usual pattern. Check the points below before it goes to PayPal.',
      tip: verdict.decision === 'block' ? 'Wait until next month, or override it with a reason.' : 'If it can wait, put it on hold and decide later.',
    };
  };
  if (!ai.enabled()) return fallback();
  try {
    return await ai.structured({
      fast: true,
      name: 'guard_message',
      system:
        'You are SpendGuard, a friendly money coach that speaks before a PayPal payment goes out. ' +
        'The decision has ALREADY been made by the rules engine; never change it, never invent numbers, use only the facts given. ' +
        'Be warm, short and specific (max 2 sentences for message). No lecturing. Use $ amounts exactly as given.',
      prompt: JSON.stringify({ payment: { payee: payment.payeeName || payment.payee, amount: payment.amount, note: payment.note }, verdict }),
      schema: {
        type: 'object',
        properties: {
          headline: { type: 'string', description: 'max 7 words, no emoji' },
          message: { type: 'string' },
          tip: { type: 'string', description: 'one concrete alternative or next step, or empty' },
        },
        required: ['headline', 'message', 'tip'],
      },
      maxTokens: 400,
    });
  } catch {
    return fallback();
  }
}

async function check(payment) {
  const amount = A.round(Number(payment.amount));
  if (!(amount > 0) || amount > 10000) throw Object.assign(new Error('Amount must be between $0.01 and $10,000'), { status: 400 });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payment.payee || '')) throw Object.assign(new Error('Enter the PayPal email of who you are paying'), { status: 400 });
  const p = { ...payment, amount, note: String(payment.note || '').slice(0, 160), payeeName: String(payment.payeeName || '').slice(0, 60) };
  const category = CATEGORIES.includes(p.category) ? p.category : await categorize(p);
  const verdict = evaluate({ ...p, category });
  const words = await explain(p, verdict);
  const intent = {
    id: crypto.randomUUID(), createdAt: new Date().toISOString(), status: 'pending',
    payee: p.payee, payeeName: p.payeeName, amount, note: p.note, category, localHour: p.localHour,
    ...verdict, ...words,
  };
  store.db.intents[intent.id] = intent;
  store.save();
  return intent;
}

module.exports = { check, evaluate, SEVERITY };
