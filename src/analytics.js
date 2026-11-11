// All money maths lives here, in plain code. The AI never does arithmetic.
const store = require('./store');
const ai = require('./ai');
const { ruleCategory } = require('./categories');

const round = (n) => Math.round(n * 100) / 100;
const money = (n) => '$' + round(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthKey = (d) => new Date(d).toISOString().slice(0, 7);
const currentMonth = () => monthKey(new Date());

function prevMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return monthKey(new Date(Date.UTC(y, m - 2, 15)));
}

// Merge AI/user categories onto raw transactions.
function enriched() {
  const { transactions, categoryCache } = store.db;
  return Object.values(transactions)
    .map((t) => {
      const c = categoryCache[t.id];
      return {
        ...t,
        category: c?.category || ruleCategory(t),
        merchant: c?.merchant || t.counterparty,
        recurring: c?.recurring || false,
        categorySource: c?.source || 'rule',
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

const classifying = new Map(); // session -> running job
// Classify anything we haven't seen yet (batched, cached). Falls back to rules silently.
async function classifyPending() {
  if (!ai.enabled()) return 0;
  const sid = store.currentSid();
  if (classifying.has(sid)) return classifying.get(sid);
  const job = (async () => {
    const { transactions, categoryCache } = store.db;
    const todo = Object.values(transactions).filter((t) => !categoryCache[t.id]);
    let done = 0;
    for (let i = 0; i < todo.length; i += 60) {
      const batch = todo.slice(i, i + 60);
      try {
        const results = await ai.classifyBatch(batch);
        for (const r of results) {
          if (!transactions[r.id] || categoryCache[r.id]?.source === 'user') continue;
          categoryCache[r.id] = { category: r.category, merchant: r.merchant, recurring: r.recurring, source: 'ai' };
          done++;
        }
      } catch (e) {
        console.warn('[classify] batch failed:', e.message);
        break;
      }
    }
    if (done) { store.db.insightsCache = {}; store.save(); }
    return done;
  })().finally(() => classifying.delete(sid));
  classifying.set(sid, job);
  return job;
}

function inRange(t, { month, from, to }) {
  if (month && monthKey(t.date) !== month) return false;
  if (from && t.date < from) return false;
  if (to && t.date > to + (to.length === 10 ? 'T23:59:59Z' : '')) return false;
  return true;
}

// Spending = money out excluding bank withdrawals; fees counted separately.
const isSpend = (t) => t.direction === 'out' && t.category !== 'Transfers';

function summary(month = currentMonth()) {
  const all = enriched();
  const txns = all.filter((t) => monthKey(t.date) === month);
  const income = round(txns.filter((t) => t.direction === 'in').reduce((s, t) => s + t.amount, 0));
  const fees = round(txns.reduce((s, t) => s + (t.fee || 0), 0));
  const spent = round(txns.filter(isSpend).reduce((s, t) => s + t.amount, 0) + fees);

  const byCat = {};
  for (const t of txns.filter(isSpend)) byCat[t.category] = round((byCat[t.category] || 0) + t.amount);
  if (fees) byCat['PayPal Fees'] = fees;

  const prev = prevMonth(month);
  const isCurrentM = month === currentMonth();
  // For the running month, compare against the SAME days of last month (fair comparison).
  const cutoffDay = isCurrentM ? new Date().getDate() : 31;
  const prevTx = all.filter((t) => monthKey(t.date) === prev && new Date(t.date).getDate() <= cutoffDay);
  const prevByCat = {};
  for (const t of prevTx.filter(isSpend)) prevByCat[t.category] = round((prevByCat[t.category] || 0) + t.amount);
  const prevFees = round(prevTx.reduce((s, t) => s + (t.fee || 0), 0));
  if (prevFees) prevByCat['PayPal Fees'] = prevFees;

  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const daily = Array.from({ length: daysInMonth }, (_, i) => ({ day: i + 1, out: 0, in: 0 }));
  for (const t of txns) {
    const d = new Date(t.date).getDate() - 1;
    if (!daily[d]) continue;
    if (isSpend(t)) daily[d].out = round(daily[d].out + t.amount);
    if (t.direction === 'in') daily[d].in = round(daily[d].in + t.amount);
  }

  const merchants = {};
  for (const t of txns.filter(isSpend)) merchants[t.merchant] = round((merchants[t.merchant] || 0) + t.amount);
  const topMerchants = Object.entries(merchants).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, amount]) => ({ name, amount }));

  const isCurrent = month === currentMonth();
  const dayOfMonth = isCurrent ? new Date().getDate() : daysInMonth;
  // Projection: what's spent so far + typical daily spend (last 30 days, ignoring one-offs ≥ $200) for the days left.
  let projected = spent;
  if (isCurrent) {
    const since = Date.now() - 30 * 864e5;
    const window = all.filter((t) => isSpend(t) && new Date(t.date) >= since && t.amount < 200);
    const perDay = (window.reduce((s2, t) => s2 + t.amount + (t.fee || 0), 0) + all.filter((t) => t.direction === 'in' && new Date(t.date) >= since).reduce((s2, t) => s2 + (t.fee || 0), 0)) / 30;
    projected = round(spent + perDay * (daysInMonth - dayOfMonth));
  }

  return {
    month, income, spent, fees, net: round(income - spent), count: txns.length,
    byCategory: Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([category, amount]) => ({ category, amount, prev: prevByCat[category] || 0 })),
    prevSpent: round(prevTx.filter(isSpend).reduce((s, t) => s + t.amount, 0) + prevFees),
    prevIncome: round(prevTx.filter((t) => t.direction === 'in').reduce((s, t) => s + t.amount, 0)),
    comparedDays: isCurrentM ? cutoffDay : null,
    daily, topMerchants, projected, dayOfMonth, daysInMonth,
  };
}

function budgetStatus(month = currentMonth()) {
  const s = summary(month);
  const cat = Object.fromEntries(s.byCategory.map((c) => [c.category, c.amount]));
  return store.db.budgets.map((b) => {
    const spent = b.category === 'ALL' ? s.spent : cat[b.category] || 0;
    const pct = b.limit ? spent / b.limit : 0;
    return { ...b, spent: round(spent), remaining: round(b.limit - spent), pct: round(pct * 100), state: pct >= 1 ? 'over' : pct >= 0.8 ? 'warning' : 'ok' };
  });
}

// Recurring = same merchant, similar amount, seen in ≥2 different months (or AI flagged).
function subscriptions() {
  const all = enriched().filter((t) => isSpend(t) && !['Refunds', 'Contractors', 'Inventory & Supplies'].includes(t.category) && t.kind !== 'refund');
  const groups = {};
  for (const t of all) (groups[t.merchant] ||= []).push(t);
  const subs = [];
  for (const [merchant, list] of Object.entries(groups)) {
    const months = new Set(list.map((t) => monthKey(t.date)));
    const amounts = list.map((t) => t.amount);
    const steady = Math.max(...amounts) - Math.min(...amounts) < 1;
    if ((months.size >= 2 && steady) || list.some((t) => t.recurring && months.size >= 2)) {
      subs.push({ merchant, amount: list[0].amount, category: list[0].category, lastCharged: list[0].date, months: months.size });
    }
  }
  return subs.sort((a, b) => b.amount - a.amount);
}

// Outgoing payments far above what this merchant/category usually costs, or at odd hours.
function anomalies(month = currentMonth()) {
  const all = enriched().filter(isSpend);
  const out = [];
  for (const t of all.filter((x) => monthKey(x.date) === month)) {
    const peers = all.filter((x) => x.category === t.category && x.id !== t.id);
    const avg = peers.length ? peers.reduce((s, x) => s + x.amount, 0) / peers.length : 0;
    const firstTime = !all.some((x) => x.merchant === t.merchant && x.id !== t.id);
    const hour = new Date(t.date).getHours();
    if (t.amount >= 150 && (firstTime || (avg && t.amount > avg * 3))) {
      out.push({ id: t.id, merchant: t.merchant, amount: t.amount, date: t.date, reason: firstTime ? 'First payment to this merchant and unusually large' : `About ${Math.round(t.amount / avg)}× your usual ${t.category} payment` , lateNight: hour < 5 });
    }
  }
  return out;
}

module.exports = { money, enriched, classifyPending, summary, budgetStatus, subscriptions, anomalies, inRange, isSpend, monthKey, currentMonth, prevMonth, round };
