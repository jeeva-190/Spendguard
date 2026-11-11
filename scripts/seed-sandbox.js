// Creates real PayPal SANDBOX payouts from your business account so that
// Transaction Search has genuine data to show. Run once: `npm run seed:sandbox`
// Note: PayPal can take up to ~3 hours before new sandbox transactions appear in Transaction Search.
require('dotenv').config();
const paypal = require('../src/paypal');

const PAYMENTS = [
  ['Freelance design work - product photos', 145.0],
  ['Contractor - website fixes', 90.0],
  ['Wholesale fabric & packaging supplier', 210.5],
  ['Facebook & Instagram ads top-up', 60.0],
  ['Shipping labels', 24.8],
  ['Design app subscription', 14.99],
];

(async () => {
  if (process.env.PAYPAL_ENV === 'live') throw new Error('Refusing to run against LIVE PayPal.');
  if (!paypal.configured()) throw new Error('Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env first.');
  const receiver = process.env.SANDBOX_RECEIVER_EMAIL;
  if (!receiver) throw new Error('Set SANDBOX_RECEIVER_EMAIL to a sandbox PERSONAL account email (developer.paypal.com → Sandbox → Accounts).');
  for (const [note, amount] of PAYMENTS) {
    const r = await paypal.createPayout({ receiver, amount, note, intentId: `seed${Date.now()}${Math.floor(Math.random() * 1e4)}` });
    console.log(`✔ $${amount.toFixed(2)} — ${note} → batch ${r.batch_header.payout_batch_id}`);
  }
  console.log('\nDone. For incoming money, buy something from this business account with your sandbox personal account,');
  console.log('or send it money from sandbox.paypal.com. Then press ⟳ Sync in SpendGuard (may take a while to appear).');
})().catch((e) => { console.error('✖', e.message); process.exit(1); });
