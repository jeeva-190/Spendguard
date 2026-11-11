// Realistic sample history for a solo online seller, so the app looks alive
// even when the PayPal sandbox has only a handful of transactions.
const store = require('./store');

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const CUSTOMERS = ['Emily Carter', 'James Lee', 'Sofia Rossi', 'Daniel Kim', 'Aisha Khan', 'Lucas Martin', 'Mia Novak', 'Noah Brown', 'Olivia Chen', 'Arjun Mehta', 'Hannah Weber', 'Ethan Clark'];
const PRODUCTS = ['Handmade Tote Bag', 'Block-print Scarf', 'Brass Earrings', 'Cotton Cushion Cover', 'Macrame Wall Hanging', 'Silk Pocket Square'];

// [counterparty, note, min, max, perMonth, dayOfMonth?]
const RECURRING = [
  ['Pixelpad', 'Pixelpad Pro design subscription', 14.99, 14.99, 3],
  ['Framecraft', 'Framecraft team subscription', 15, 15, 8],
  ['Studio Suite', 'Studio Suite photo editing subscription', 59.99, 59.99, 12],
  ['Notely', 'Notely Plus subscription', 10, 10, 15],
  ['WriteWell', 'WriteWell Premium subscription', 30, 30, 20],
  ['Tunebox', 'Tunebox music streaming plan', 11.99, 11.99, 5],
  ['StreamNest', 'StreamNest video streaming plan', 15.49, 15.49, 9],
  ['CityNet Broadband', 'Internet bill', 18, 18, 2],
];

const VARIABLE = [
  ['SocialBoost Ads', 'Social media ads', 35, 110, 4],
  ['SearchReach Ads', 'Search ads campaign', 25, 80, 2],
  ['SwiftShip Express', 'International shipping label', 9, 34, 7],
  ['Postline', 'Shipping - speed post', 4, 12, 4],
  ['Priya Raman', 'Freelance design work - product photos', 120, 260, 1],
  ['Karthik S', 'Contractor - website fixes', 80, 150, 1],
  ['Weavers Wholesale Co.', 'Wholesale fabric & packaging', 90, 320, 1.5],
  ['QuickBite', 'Food order', 9, 32, 6],
  ['Bean There Cafe', 'Coffee', 4, 9, 6],
  ['Tiffin Run', 'Food delivery', 6, 22, 4],
  ['CityRide', 'Taxi ride', 5, 18, 4],
  ['MegaMart Online', 'Online store purchase', 15, 95, 2.5],
  ['PixelPlay Games', 'Video game purchase', 10, 40, 0.7],
];

function iso(d) { return d.toISOString(); }

function generate(now = new Date()) {
  const r = rng(20261110);
  const txns = [];
  const add = (t) => {
    // Never create transactions in the future.
    if (new Date(t.date) > now) t.date = iso(new Date(now.getTime() - (20 + r() * 300) * 60000));
    txns.push({ source: 'demo', currency: 'USD', status: 'S', fee: 0, kind: 'payment', ...t });
  };
  let n = 0;

  for (let m = 2; m >= 0; m--) {
    const first = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const lastDay = m === 0 ? now.getDate() : days;
    const isCurrent = m === 0;
    const at = (day, hour = 10 + Math.floor(r() * 10)) =>
      new Date(first.getFullYear(), first.getMonth(), day, hour, Math.floor(r() * 60));

    // Sales income: ~1.3 orders a day
    for (let d = 1; d <= lastDay; d++) {
      const x = r();
      const orders = x < 0.15 ? 0 : x < 0.5 ? 1 : x < 0.85 ? 2 : 3;
      for (let i = 0; i < orders; i++) {
        const amount = +(28 + r() * 130).toFixed(2);
        add({
          id: `DEMO-${++n}`, date: iso(at(d)), amount, direction: 'in',
          counterparty: CUSTOMERS[Math.floor(r() * CUSTOMERS.length)],
          note: `Sale - Order #${4000 + n} - ${PRODUCTS[Math.floor(r() * PRODUCTS.length)]}`,
          fee: +(amount * 0.0349 + 0.49).toFixed(2),
        });
      }
    }

    for (const [cp, note, min, , day] of RECURRING) {
      if (day > lastDay) continue;
      add({ id: `DEMO-${++n}`, date: iso(at(day, 6)), amount: min, direction: 'out', counterparty: cp, note, kind: 'payment' });
    }

    for (const [cp, note, min, max, perMonth] of VARIABLE) {
      // Food spending creeps up this month — gives the AI something to notice.
      const boost = isCurrent && /Food|Coffee/.test(note) ? 2.4 : 1;
      const expected = perMonth * (lastDay / days) * boost;
      const count = Math.floor(expected) + (r() < expected % 1 ? 1 : 0);
      for (let i = 0; i < count; i++) {
        const late = /Food|game/.test(note) && r() < 0.35;
        add({
          id: `DEMO-${++n}`,
          date: iso(at(Math.min(lastDay, 1 + Math.floor(((i + r()) * lastDay) / count)), late ? 23 : undefined)),
          amount: +(min + r() * (max - min)).toFixed(2), direction: 'out', counterparty: cp, note,
          kind: /Freelance|Contractor/.test(note) ? 'payout' : 'payment',
        });
      }
    }

    // One refund a month
    add({ id: `DEMO-${++n}`, date: iso(at(Math.max(1, lastDay - 3))), amount: +(25 + r() * 40).toFixed(2), direction: 'out', kind: 'refund',
      counterparty: CUSTOMERS[Math.floor(r() * CUSTOMERS.length)], note: 'Refund - damaged item' });

    if (!isCurrent) {
      add({ id: `DEMO-${++n}`, date: iso(at(days - 1)), amount: 900, direction: 'out', kind: 'withdrawal',
        counterparty: 'Your bank ••4821', note: 'Withdraw to bank' });
    }
  }

  // A fixed shopping purchase this month so the "$120 shoes" demo reliably hits the Shopping block budget.
  add({ id: `DEMO-${++n}`, date: iso(new Date(now.getFullYear(), now.getMonth(), Math.max(1, now.getDate() - 4), 21, 40)), amount: 64.99,
    direction: 'out', counterparty: 'MegaMart Online', note: 'Online store purchase - wireless earbuds' });

  // A suspicious one-off this month for the anomaly detector.
  const d = Math.max(1, now.getDate() - 2);
  add({ id: `DEMO-${++n}`, date: iso(new Date(now.getFullYear(), now.getMonth(), d, 2, 14)), amount: 449, direction: 'out',
    counterparty: 'XYZ Digital Services', note: 'Annual "growth" package' });

  return txns;
}

const DEFAULT_BUDGETS = [
  { id: 'b-food', category: 'Food & Dining', limit: 220, mode: 'alert' },
  { id: 'b-ads', category: 'Advertising', limit: 400, mode: 'alert' },
  { id: 'b-soft', category: 'Software & Tools', limit: 120, mode: 'alert' },
  { id: 'b-shop', category: 'Shopping', limit: 150, mode: 'block' },
  { id: 'b-all', category: 'ALL', limit: 2600, mode: 'alert' },
];

function seed({ force = false } = {}) {
  const db = store.db;
  if (db.meta.seeded && !force) return 0;
  for (const id of Object.keys(db.transactions)) if (db.transactions[id].source === 'demo') delete db.transactions[id];
  const txns = generate();
  for (const t of txns) db.transactions[t.id] = t;
  if (!db.budgets.length) db.budgets = DEFAULT_BUDGETS.map((b) => ({ ...b }));
  db.meta.seeded = true;
  db.insightsCache = {};
  store.save();
  return txns.length;
}

module.exports = { seed, generate };
