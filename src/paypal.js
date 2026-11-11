// PayPal REST client: OAuth, Transaction Search (reporting) and Payouts.
const crypto = require('crypto');

const store = require('./store');

const BASE = process.env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
const tokens = new Map(); // clientId -> { token, exp }

// Keys the visitor added in Settings win; otherwise fall back to the server's .env keys.
function creds() {
  const s = store.db.settings || {};
  if (s.paypalClientId && s.paypalSecret) return { id: s.paypalClientId, secret: s.paypalSecret, source: 'user' };
  if (process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET) return { id: process.env.PAYPAL_CLIENT_ID, secret: process.env.PAYPAL_CLIENT_SECRET, source: 'server' };
  return null;
}
const configured = () => Boolean(creds());

async function token(c = creds()) {
  if (!c) throw new Error('PayPal is not connected. Add your sandbox keys in Settings.');
  const cached = tokens.get(c.id + c.secret.slice(-6));
  if (cached && Date.now() < cached.exp) return cached.token;
  const auth = Buffer.from(`${c.id}:${c.secret}`).toString('base64');
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(`PayPal did not accept these keys: ${data.error_description || res.status}`), { status: 400 });
  tokens.set(c.id + c.secret.slice(-6), { token: data.access_token, exp: Date.now() + (data.expires_in - 60) * 1000 });
  return data.access_token;
}

async function api(method, path, body, c) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await token(c || creds())}`,
      'Content-Type': 'application/json',
      ...(method === 'POST' ? { 'PayPal-Request-Id': crypto.randomUUID() } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(`PayPal ${method} ${path.split('?')[0]} → ${res.status}: ${data.message || data.name || text.slice(0, 200)}`);
    err.status = res.status;
    err.details = data;
    throw err;
  }
  return data;
}

// Transaction Search allows max 31 days per request; we page through results.
async function searchTransactions(start, end) {
  const out = [];
  let page = 1, totalPages = 1;
  do {
    const qs = new URLSearchParams({
      start_date: start.toISOString().replace(/\.\d+Z$/, 'Z'),
      end_date: end.toISOString().replace(/\.\d+Z$/, 'Z'),
      fields: 'transaction_info,payer_info,cart_info',
      page_size: '500',
      page: String(page),
    });
    const data = await api('GET', `/v1/reporting/transactions?${qs}`);
    out.push(...(data.transaction_details || []));
    totalPages = data.total_pages || 1;
    page++;
  } while (page <= totalPages);
  return out;
}

function payoutBody({ receiver, amount, currency = 'USD', note, intentId }) {
  return {
    sender_batch_header: {
      sender_batch_id: `sg_${intentId}`,
      email_subject: 'You have a payment',
      email_message: note || 'Payment sent with SpendGuard',
    },
    items: [{
      recipient_type: 'EMAIL',
      receiver,
      note: note || 'Payment',
      sender_item_id: intentId,
      amount: { value: Number(amount).toFixed(2), currency },
    }],
  };
}

async function createPayout(args) {
  return api('POST', '/v1/payments/payouts', payoutBody(args));
}

// Check keys before saving: can we get a token, and is Transaction Search switched on?
async function verify(id, secret) {
  const c = { id, secret };
  await token(c);
  const end = new Date();
  const start = new Date(end.getTime() - 2 * 864e5);
  const qs = new URLSearchParams({ start_date: start.toISOString().replace(/\.\d+Z$/, 'Z'), end_date: end.toISOString().replace(/\.\d+Z$/, 'Z'), page_size: '1' });
  try {
    await api('GET', `/v1/reporting/transactions?${qs}`, undefined, c);
    return { ok: true, transactionSearch: true };
  } catch (e) {
    if (e.status === 403) return { ok: true, transactionSearch: false };
    throw e;
  }
}

module.exports = { configured, creds, searchTransactions, createPayout, payoutBody, verify, BASE };
