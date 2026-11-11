// Pull transactions from PayPal Transaction Search and normalize them.
const paypal = require('./paypal');
const store = require('./store');

function kindFromCode(code = '') {
  if (code === 'T0001' || code.startsWith('T0001')) return 'payout';
  if (code.startsWith('T11') || code.startsWith('T12')) return 'refund';
  if (code.startsWith('T04')) return 'withdrawal';
  if (code.startsWith('T03')) return 'deposit';
  if (code.startsWith('T02')) return 'conversion';
  if (code.startsWith('T00')) return 'payment';
  return 'other';
}

function normalize(detail) {
  const t = detail.transaction_info || {};
  const p = detail.payer_info || {};
  const items = (detail.cart_info?.item_details || []).map((i) => i.item_name).filter(Boolean);
  const value = Number(t.transaction_amount?.value || 0);
  const kind = kindFromCode(t.transaction_event_code);
  const counterparty =
    p.payer_name?.alternate_full_name ||
    [p.payer_name?.given_name, p.payer_name?.surname].filter(Boolean).join(' ') ||
    p.email_address ||
    t.transaction_subject ||
    'PayPal';
  return {
    id: t.transaction_id,
    date: t.transaction_initiation_date,
    amount: Math.abs(value),
    direction: value < 0 ? 'out' : 'in',
    currency: t.transaction_amount?.currency_code || 'USD',
    counterparty,
    note: [t.transaction_note, t.transaction_subject, ...items].filter(Boolean).join(' · '),
    status: t.transaction_status,
    eventCode: t.transaction_event_code,
    kind,
    fee: Math.abs(Number(t.fee_amount?.value || 0)),
    source: 'paypal',
  };
}

// Sync the last `months` months (each request ≤ 31 days).
async function syncFromPayPal(months = 3) {
  if (!paypal.configured()) return { synced: 0, skipped: 'PayPal not configured' };
  const end = new Date();
  let cursor = new Date(end.getFullYear(), end.getMonth() - (months - 1), 1);
  let count = 0;
  while (cursor < end) {
    const next = new Date(Math.min(cursor.getTime() + 30 * 864e5, end.getTime()));
    const details = await paypal.searchTransactions(cursor, next);
    for (const d of details) {
      const txn = normalize(d);
      if (!txn.id || txn.kind === 'conversion' || txn.kind === 'deposit' && txn.amount === 0) continue;
      store.db.transactions[txn.id] = { ...store.db.transactions[txn.id], ...txn };
      count++;
    }
    cursor = next;
  }
  store.db.meta.lastSync = new Date().toISOString();
  store.save();
  return { synced: count };
}

module.exports = { syncFromPayPal, normalize };
