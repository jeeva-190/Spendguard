// "Ask your PayPal": Claude answers questions by calling tools that compute exact numbers.
const ai = require('./ai');
const A = require('./analytics');
const guard = require('./guard');
const { CATEGORIES } = require('./categories');

const TOOLS = [
  {
    name: 'summarize',
    description: 'Totals of PayPal transactions grouped by category, merchant, day or month. Use for "how much did I spend/earn on X" questions.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'YYYY-MM-DD inclusive' },
        to: { type: 'string', description: 'YYYY-MM-DD inclusive' },
        direction: { type: 'string', enum: ['out', 'in', 'all'], description: 'out = spending (default), in = income' },
        group_by: { type: 'string', enum: ['category', 'merchant', 'day', 'month', 'none'] },
        category: { type: 'string', enum: CATEGORIES },
        merchant: { type: 'string', description: 'case-insensitive substring' },
      },
      required: ['group_by'],
    },
  },
  {
    name: 'find_transactions',
    description: 'List individual transactions matching filters (max 25).',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string' }, to: { type: 'string' },
        direction: { type: 'string', enum: ['out', 'in', 'all'] },
        category: { type: 'string', enum: CATEGORIES },
        merchant: { type: 'string' },
        min_amount: { type: 'number' }, max_amount: { type: 'number' },
        sort: { type: 'string', enum: ['newest', 'largest'] },
        limit: { type: 'integer' },
      },
    },
  },
  { name: 'budgets', description: 'Current month budget status per category, plus month summary and projection.', input_schema: { type: 'object', properties: {} } },
  { name: 'subscriptions', description: 'Detected recurring subscriptions and their monthly cost.', input_schema: { type: 'object', properties: {} } },
  {
    name: 'can_i_afford',
    description: 'Run SpendGuard rules on a hypothetical payment. Returns allow/warn/block and reasons.',
    input_schema: { type: 'object', properties: { amount: { type: 'number' }, category: { type: 'string', enum: CATEGORIES } }, required: ['amount', 'category'] },
  },
];

function filter(args) {
  const m = (args.merchant || '').toLowerCase();
  const dir = args.direction || 'out';
  return A.enriched().filter((t) =>
    A.inRange(t, args) &&
    (dir === 'all' || (dir === 'out' ? A.isSpend(t) : t.direction === 'in')) &&
    (!args.category || t.category === args.category) &&
    (!m || `${t.merchant} ${t.counterparty}`.toLowerCase().includes(m)) &&
    (args.min_amount == null || t.amount >= args.min_amount) &&
    (args.max_amount == null || t.amount <= args.max_amount));
}

function runTool(name, args) {
  if (name === 'summarize') {
    const rows = filter(args);
    const total = A.round(rows.reduce((s, t) => s + t.amount, 0));
    if (args.group_by === 'none') return { total, count: rows.length };
    const key = { category: (t) => t.category, merchant: (t) => t.merchant, day: (t) => t.date.slice(0, 10), month: (t) => t.date.slice(0, 7) }[args.group_by];
    const g = {};
    for (const t of rows) { const k = key(t); g[k] ||= { total: 0, count: 0 }; g[k].total = A.round(g[k].total + t.amount); g[k].count++; }
    return { total, count: rows.length, groups: Object.entries(g).sort((a, b) => b[1].total - a[1].total).slice(0, 25).map(([k, v]) => ({ [args.group_by]: k, ...v })) };
  }
  if (name === 'find_transactions') {
    let rows = filter(args);
    if (args.sort === 'largest') rows = rows.sort((a, b) => b.amount - a.amount);
    const limit = Math.min(args.limit || 10, 25);
    return { matches: rows.length, transactions: rows.slice(0, limit).map((t) => ({ date: t.date.slice(0, 10), merchant: t.merchant, amount: t.amount, direction: t.direction, category: t.category, note: t.note })) };
  }
  if (name === 'budgets') {
    const s = A.summary();
    return { month: s.month, income: s.income, spent: s.spent, net: s.net, fees: s.fees, projectedSpend: s.projected, dayOfMonth: s.dayOfMonth, daysInMonth: s.daysInMonth, budgets: A.budgetStatus() };
  }
  if (name === 'subscriptions') { const subs = A.subscriptions(); return { monthlyTotal: A.round(subs.reduce((s, x) => s + x.amount, 0)), subscriptions: subs }; }
  if (name === 'can_i_afford') { const v = guard.evaluate({ amount: Number(args.amount), category: args.category }); return { decision: v.decision, reasons: v.reasons.map((r) => r.text), facts: v.facts }; }
  return { error: 'unknown tool' };
}

// Offline answers for common questions, used when no AI key is set (and in the hosted preview).
function offlineAnswer(question) {
  const q = question.toLowerCase();
  const m = A.money;
  const now = new Date();
  const first = `${A.currentMonth()}-01`;
  const today = now.toISOString().slice(0, 10);
  const prev = A.prevMonth(A.currentMonth());
  const prevTo = `${prev}-${String(Math.min(now.getDate(), 28)).padStart(2, '0')}`;
  const aliases = { food: 'Food & Dining', eat: 'Food & Dining', dining: 'Food & Dining', coffee: 'Food & Dining', ad: 'Advertising', ads: 'Advertising', advertising: 'Advertising', marketing: 'Advertising', software: 'Software & Tools', tools: 'Software & Tools', shopping: 'Shopping', shop: 'Shopping', travel: 'Travel & Transport', uber: 'Travel & Transport', shipping: 'Shipping', contractor: 'Contractors', contractors: 'Contractors', freelancer: 'Contractors', supplies: 'Inventory & Supplies', inventory: 'Inventory & Supplies', entertainment: 'Entertainment', bills: 'Bills & Utilities', refunds: 'Refunds' };
  const word = Object.keys(aliases).find((k) => new RegExp(`\\b${k}\\b`).test(q));
  const category = word && aliases[word];
  const tools = [];
  const run = (name, args) => { tools.push(name); return runTool(name, args); };

  const amt = q.match(/\$?\s?(\d+(?:[.,]\d{1,2})?)/);
  if (/afford|can i (buy|pay|spend)/.test(q) && amt) {
    const v = run('can_i_afford', { amount: Number(amt[1].replace(',', '')), category: category || 'Shopping' });
    const verdict = { allow: 'Yes, that fits your budgets.', warn: 'You can, but I would think twice.', block: 'Not this month. It breaks a budget you set to block.' }[v.decision];
    return { answer: `${verdict}${v.reasons.length ? '\n' + v.reasons.map((r) => `• ${r}`).join('\n') : ''}`, toolsUsed: tools };
  }
  if (/subscri|recurring|cancel/.test(q)) {
    const s = run('subscriptions', {});
    if (!s.subscriptions.length) return { answer: 'I could not find any recurring payments yet.', toolsUsed: tools };
    const list = s.subscriptions.map((x) => `• ${x.merchant}: ${m(x.amount)}/month`).join('\n');
    return { answer: `You pay **${m(s.monthlyTotal)}/month** for ${s.subscriptions.length} subscriptions:\n${list}\nStart with the ones you have not opened in the last month.`, toolsUsed: tools };
  }
  if (/biggest|largest|top|most expensive/.test(q)) {
    const n = Number((q.match(/\b(\d)\b/) || [])[1]) || 3;
    const r = run('find_transactions', { from: first, to: today, direction: 'out', sort: 'largest', limit: n, category });
    return { answer: `Your ${n} biggest payments this month:\n${r.transactions.map((t) => `• **${m(t.amount)}** to ${t.merchant} (${t.category}, ${new Date(t.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`).join('\n')}`, toolsUsed: tools };
  }
  if (/compare|last month|vs|versus/.test(q)) {
    const now1 = run('summarize', { from: first, to: today, group_by: 'none', category });
    const before = run('summarize', { from: `${prev}-01`, to: prevTo, group_by: 'none', category });
    const diff = before.total ? Math.round(((now1.total - before.total) / before.total) * 100) : null;
    return { answer: `${category || 'Total spending'} so far this month: **${m(now1.total)}**. Same days last month: **${m(before.total)}**${diff == null ? '.' : ` (${diff >= 0 ? 'up' : 'down'} ${Math.abs(diff)}%).`}`, toolsUsed: tools };
  }
  if (/earn|income|made|sales|revenue/.test(q)) {
    const r = run('summarize', { from: first, to: today, direction: 'in', group_by: 'none' });
    return { answer: `You received **${m(r.total)}** from ${r.count} payments this month.`, toolsUsed: tools };
  }
  if (/budget|left|remaining|on track/.test(q)) {
    const b = run('budgets', {});
    return { answer: b.budgets.map((x) => `• ${x.category === 'ALL' ? 'Total' : x.category}: ${m(x.spent)} of ${m(x.limit)} (${x.pct}%)`).join('\n') + `\nAt this pace you will spend about **${m(b.projectedSpend)}** this month.`, toolsUsed: tools };
  }
  if (/spen|cost|paid|pay/.test(q) || category) {
    const r = run('summarize', { from: first, to: today, group_by: category ? 'merchant' : 'category', category });
    const top = r.groups.slice(0, 4).map((g) => `• ${g.merchant || g.category}: ${m(g.total)}`).join('\n');
    return { answer: `You spent **${m(r.total)}**${category ? ` on ${category}` : ''} this month across ${r.count} payments.\n${top}`, toolsUsed: tools };
  }
  return { answer: 'Without the AI key I can answer questions about spending by category, your biggest payments, subscriptions, budgets, income, comparisons with last month, and "can I afford $X". Add ANTHROPIC_API_KEY for anything else.', toolsUsed: [] };
}

async function ask(question, history = []) {
  if (!ai.enabled()) return offlineAnswer(String(question));
  const today = new Date().toISOString().slice(0, 10);
  return ai.runAgent({
    system:
      `You are "Ask your PayPal", the assistant inside SpendGuard. Today is ${today}. Currency is USD. ` +
      'Answer questions about the user\'s PayPal money using the tools; ALWAYS get numbers from tools, never estimate or do your own sums beyond simple comparisons. ' +
      '"This month" means from the 1st of the current month to today. Spending excludes bank withdrawals. ' +
      'Keep answers short (2-5 sentences or a tiny list), friendly, and end with one useful tip when relevant. Use **bold** for key amounts. Plain text only, no tables or headings.',
    history: history.slice(-6).map((h) => ({ role: h.role === 'user' ? 'user' : 'assistant', content: String(h.content).slice(0, 2000) })),
    question: String(question).slice(0, 1000),
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: t.input_schema })),
    runTool: (name, args) => { try { return runTool(name, args); } catch (e) { return { error: e.message }; } },
  }).catch((e) => {
    // Free AI plans have rate limits. Fall back to built-in answers instead of failing.
    const fallback = offlineAnswer(String(question));
    return { ...fallback, answer: `${fallback.answer}\n\n(The AI is busy right now (${e.message.slice(0, 80)}), so this answer came from built-in rules.)` };
  });
}

module.exports = { ask, runTool, offlineAnswer };
