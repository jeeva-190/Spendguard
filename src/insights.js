// AI insights (facts computed in code, words written by AI) + rule-based alerts.
const crypto = require('crypto');
const store = require('./store');
const ai = require('./ai');
const A = require('./analytics');

const money = A.money;

function facts(month) {
  const s = A.summary(month);
  const changes = s.byCategory
    .filter((c) => c.prev > 0)
    .map((c) => ({ category: c.category, now: c.amount, before: c.prev, changePct: Math.round(((c.amount - c.prev) / c.prev) * 100) }))
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, 5);
  return {
    month, isCurrentMonth: month === A.currentMonth(), dayOfMonth: s.dayOfMonth, daysInMonth: s.daysInMonth,
    income: s.income, spent: s.spent, net: s.net, fees: s.fees, projectedSpend: s.projected, previousMonthSpentSamePeriod: s.prevSpent, previousMonthIncomeSamePeriod: s.prevIncome,
    note: s.comparedDays ? `Category 'prev'/'before' values cover days 1-${s.comparedDays} of last month, for a fair comparison.` : 'Comparisons are full month vs full previous month.',
    topCategories: s.byCategory.slice(0, 6), categoryChanges: changes, topMerchants: s.topMerchants,
    subscriptions: A.subscriptions(), unusualPayments: A.anomalies(month), budgets: A.budgetStatus(month),
  };
}

function fallbackCards(f) {
  const cards = [];
  const up = f.categoryChanges.find((c) => c.changePct >= 25);
  if (up) cards.push({ emoji: '📈', type: 'warning', title: `${up.category} is up ${up.changePct}%`, body: `${money(up.now)} vs ${money(up.before)} in the same period last month.` });
  if (f.subscriptions.length) {
    const total = f.subscriptions.reduce((s, x) => s + x.amount, 0);
    cards.push({ emoji: '🔁', type: 'saving', title: `${f.subscriptions.length} subscriptions = ${money(total)}/month`, body: `Biggest: ${f.subscriptions.slice(0, 3).map((x) => `${x.merchant} ${money(x.amount)}`).join(', ')}. Cancel any you don't use.` });
  }
  for (const a of f.unusualPayments.slice(0, 1)) cards.push({ emoji: '🚨', type: 'warning', title: `Unusual: ${money(a.amount)} to ${a.merchant}`, body: a.reason + '.' });
  if (f.fees) cards.push({ emoji: '💸', type: 'info', title: `${money(f.fees)} in PayPal fees`, body: `That's ${f.income ? ((f.fees / f.income) * 100).toFixed(1) : 0}% of your income this month.` });
  cards.push({ emoji: f.net >= 0 ? '✅' : '⚠️', type: f.net >= 0 ? 'good' : 'warning', title: `Net ${f.net >= 0 ? '+' : ''}${money(f.net)} this month`, body: `Earned ${money(f.income)}, spent ${money(f.spent)}.` });
  return cards.slice(0, 5);
}

async function insights(month = A.currentMonth()) {
  const f = facts(month);
  const key = crypto.createHash('md5').update(JSON.stringify([month, f.income, f.spent, f.budgets, f.topCategories.length, Object.keys(store.db.categoryCache).length])).digest('hex');
  const hit = store.db.insightsCache[key];
  if (hit) return hit;
  let cards, source = 'rules';
  if (ai.enabled()) {
    try {
      const out = await ai.structured({
        name: 'insights',
        system:
          'You are a sharp, friendly financial analyst for a solo online seller who runs their money through PayPal. ' +
          'Write 4-5 insight cards from the facts. Each must be specific (name merchants, categories and exact amounts from the facts), ' +
          'actionable, and non-obvious where possible: spending spikes, forgotten subscriptions, unusual payments, fee drag, ' +
          'budget pace (projected vs budget), and one positive note. Never invent numbers; only use or simply combine numbers given.',
        prompt: JSON.stringify(f),
        schema: {
          type: 'object',
          properties: {
            cards: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  emoji: { type: 'string' },
                  type: { type: 'string', enum: ['warning', 'saving', 'info', 'good'] },
                  title: { type: 'string', description: 'max 8 words' },
                  body: { type: 'string', description: 'max 30 words' },
                },
                required: ['emoji', 'type', 'title', 'body'],
              },
            },
          },
          required: ['cards'],
        },
      });
      cards = out.cards.slice(0, 5);
      source = 'ai';
    } catch (e) {
      console.warn('[insights]', e.message);
    }
  }
  const result = { cards: cards || fallbackCards(f), source, at: new Date().toISOString() };
  if (source === 'ai') { store.db.insightsCache = { [key]: result }; store.save(); }
  return result;
}

function alerts(month = A.currentMonth()) {
  const dismissed = new Set(store.db.alerts.filter((a) => a.read).map((a) => a.id));
  const list = [];
  for (const b of A.budgetStatus(month)) {
    const label = b.category === 'ALL' ? 'Total monthly' : b.category;
    if (b.state === 'over') list.push({ id: `over-${b.id}-${month}`, level: 'danger', title: `${label} budget exceeded`, body: `${money(b.spent)} of ${money(b.limit)} (${b.pct}%).` });
    else if (b.state === 'warning') list.push({ id: `warn-${b.id}-${month}`, level: 'warning', title: `${label} budget at ${b.pct}%`, body: `${money(b.remaining)} left for the rest of the month.` });
  }
  const s = A.summary(month);
  const all = store.db.budgets.find((b) => b.category === 'ALL');
  if (all && month === A.currentMonth() && s.projected > all.limit && s.spent < all.limit)
    list.push({ id: `pace-${month}`, level: 'warning', title: 'On pace to overspend', body: `At this rate you'll spend ${money(s.projected)} vs your ${money(all.limit)} budget.` });
  for (const a of A.anomalies(month)) list.push({ id: `anom-${a.id}`, level: 'danger', title: `Unusual payment: ${money(a.amount)}`, body: `${a.merchant} — ${a.reason}${a.lateNight ? ', made late at night' : ''}.` });
  return list.filter((a) => !dismissed.has(a.id));
}

function dismissAlert(id) {
  store.db.alerts = store.db.alerts.filter((a) => a.id !== id).concat({ id, read: true });
  store.save();
}

module.exports = { insights, alerts, dismissAlert, facts };
