// Per-browser JSON store. Each visitor (cookie session) gets their own data and keys,
// so one person's PayPal or Claude keys are never used for someone else.
const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');

const DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const SINGLE_FILE = process.env.DB_FILE; // tests / scripts: one fixed file
const ctx = new AsyncLocalStorage();
const sessions = new Map(); // sid -> db
const timers = new Map();

const EMPTY = () => ({
  transactions: {},   // id -> normalized transaction
  categoryCache: {},  // id -> { category, merchant, recurring, source }
  budgets: [],        // { id, category, limit, mode: 'alert'|'block' }
  alerts: [],         // dismissed alert ids
  intents: {},        // guarded payment attempts
  insightsCache: {},
  settings: {},       // user's own keys: { paypalClientId, paypalSecret, anthropicKey, savedAt }
  meta: { lastSync: null, seeded: false, createdAt: new Date().toISOString() },
});

const fileFor = (sid) => SINGLE_FILE || path.join(DIR, 'sessions', `${sid.replace(/[^a-zA-Z0-9_-]/g, '')}.json`);

function load(sid) {
  if (sessions.has(sid)) return sessions.get(sid);
  let db;
  try { db = { ...EMPTY(), ...JSON.parse(fs.readFileSync(fileFor(sid), 'utf8')) }; } catch { db = EMPTY(); }
  sessions.set(sid, db);
  return db;
}

const currentSid = () => ctx.getStore()?.sid || 'default';

function save(sid = currentSid()) {
  clearTimeout(timers.get(sid));
  timers.set(sid, setTimeout(() => {
    const db = sessions.get(sid);
    if (!db) return;
    const file = fileFor(sid);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(db), { mode: 0o600 });
  }, 150));
}

function reset({ keepSettings = true } = {}) {
  const sid = currentSid();
  const old = sessions.get(sid);
  const fresh = EMPTY();
  if (keepSettings && old) fresh.settings = old.settings;
  sessions.set(sid, fresh);
  save(sid);
}

// Run `fn` with the given browser session as the "current" store.
const run = (sid, fn) => ctx.run({ sid }, fn);

module.exports = { get db() { return load(currentSid()); }, save, reset, run, currentSid };
