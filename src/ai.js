// Provider-neutral AI layer. Works with Claude (Anthropic) and any OpenAI-compatible API:
// OpenAI, Google Gemini, Groq, OpenRouter, DeepSeek, Mistral, or your own endpoint.
// Two things the app needs: a forced structured answer, and a tool-using agent loop.
const Anthropic = require('@anthropic-ai/sdk');
const { CATEGORIES } = require('./categories');
const store = require('./store');

const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT || 400);

const PROVIDERS = {
  anthropic: { label: 'Claude (Anthropic)', short: 'Claude', kind: 'anthropic', model: 'claude-sonnet-5-5', fast: 'claude-haiku-5-5', keyHint: 'sk-ant-', keysUrl: 'https://console.anthropic.com/settings/keys' },
  openai: { label: 'OpenAI', short: 'OpenAI', kind: 'openai', base: 'https://api.openai.com/v1', model: 'gpt-5.6-terra', keyHint: 'sk-', keysUrl: 'https://platform.openai.com/api-keys' },
  gemini: { label: 'Google Gemini', short: 'Gemini', kind: 'openai', base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-flash-latest', keyHint: 'AIza', keysUrl: 'https://aistudio.google.com/apikey' },
  groq: { label: 'Groq', short: 'Groq', kind: 'openai', base: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b', keyHint: 'gsk_', keysUrl: 'https://console.groq.com/keys' },
  openrouter: { label: 'OpenRouter', short: 'OpenRouter', kind: 'openai', base: 'https://openrouter.ai/api/v1', model: 'openai/gpt-oss-120b', keyHint: 'sk-or-', keysUrl: 'https://openrouter.ai/settings/keys' },
  deepseek: { label: 'DeepSeek', short: 'DeepSeek', kind: 'openai', base: 'https://api.deepseek.com/v1', model: 'deepseek-chat', keyHint: 'sk-', keysUrl: 'https://platform.deepseek.com/api_keys' },
  mistral: { label: 'Mistral', short: 'Mistral', kind: 'openai', base: 'https://api.mistral.ai/v1', model: 'mistral-large-latest', keyHint: '', keysUrl: 'https://console.mistral.ai/api-keys' },
  custom: { label: 'Other (OpenAI-compatible)', short: 'AI', kind: 'openai', base: '', model: '', keyHint: '', keysUrl: '' },
};

// Guess the provider from the shape of a key.
function detect(key = '') {
  if (key.startsWith('sk-ant-')) return 'anthropic';
  if (key.startsWith('sk-or-')) return 'openrouter';
  if (key.startsWith('gsk_')) return 'groq';
  if (key.startsWith('AIza')) return 'gemini';
  if (key.startsWith('sk-')) return 'openai';
  return null;
}

// Active config: the visitor's own (Settings) wins, else the server's .env.
function config() {
  const s = store.db.settings || {};
  if (s.aiKey && s.aiProvider) {
    const p = PROVIDERS[s.aiProvider] || PROVIDERS.custom;
    return { provider: s.aiProvider, key: s.aiKey, base: s.aiBaseUrl || p.base, model: s.aiModel || p.model, fast: s.aiModel || p.fast || p.model, source: 'user' };
  }
  const envKey = process.env.AI_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (envKey) {
    const provider = process.env.AI_PROVIDER || (process.env.AI_API_KEY ? detect(envKey) || 'custom' : 'anthropic');
    const p = PROVIDERS[provider] || PROVIDERS.custom;
    const model = process.env.AI_MODEL || process.env.ANTHROPIC_MODEL || p.model;
    return { provider, key: envKey, base: process.env.AI_BASE_URL || p.base, model, fast: process.env.ANTHROPIC_FAST_MODEL || (process.env.AI_MODEL ? model : p.fast || model), source: 'server' };
  }
  return null;
}
const enabled = () => Boolean(config());
const describe = () => {
  const c = config();
  return c ? { provider: c.provider, label: (PROVIDERS[c.provider] || PROVIDERS.custom).label, short: (PROVIDERS[c.provider] || PROVIDERS.custom).short, model: c.model, source: c.source } : null;
};

// ---------- usage cap (only for the server owner's key) ----------
const usage = new Map();
function charge(c) {
  if (c.source === 'user') return;
  const today = new Date().toISOString().slice(0, 10);
  const u = usage.get(c.key);
  if (!u || u.day !== today) { usage.set(c.key, { day: today, calls: 1 }); return; }
  if (u.calls >= DAILY_LIMIT) throw new Error('The demo has used its AI allowance for today. Add your own AI key in Settings.');
  u.calls++;
}

// ---------- Anthropic adapter ----------
const SDK = Anthropic.default || Anthropic;
const anthropicClients = new Map();
const anth = (key) => { if (!anthropicClients.has(key)) anthropicClients.set(key, new SDK({ apiKey: key })); return anthropicClients.get(key); };

async function anthropicStructured(c, { system, prompt, name, schema, maxTokens, fast }) {
  const res = await anth(c.key).messages.create({
    model: fast ? c.fast : c.model, max_tokens: maxTokens, system,
    tools: [{ name, description: `Return the ${name} result`, input_schema: schema }],
    tool_choice: { type: 'tool', name },
    messages: [{ role: 'user', content: prompt }],
  });
  const block = res.content.find((b) => b.type === 'tool_use');
  if (!block) throw new Error('The AI returned no structured answer');
  return block.input;
}

async function anthropicAgent(c, { system, history, question, tools, runTool, maxSteps }) {
  const messages = [...history, { role: 'user', content: question }];
  const used = [];
  for (let step = 0; step < maxSteps; step++) {
    charge(c);
    const res = await anth(c.key).messages.create({
      model: c.model, max_tokens: 1200, system, messages,
      tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
    });
    messages.push({ role: 'assistant', content: res.content });
    const calls = res.content.filter((b) => b.type === 'tool_use');
    if (!calls.length || res.stop_reason !== 'tool_use') return { answer: res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim(), toolsUsed: used };
    messages.push({ role: 'user', content: calls.map((call) => { used.push(call.name); return { type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(runTool(call.name, call.input || {})) }; }) });
  }
  return { answer: 'That question needed too many steps. Try asking it more simply.', toolsUsed: used };
}

// ---------- OpenAI-compatible adapter ----------
async function chat(c, body) {
  const base = String(c.base || '').replace(/\/+$/, '');
  if (!base) throw Object.assign(new Error('Add the API base URL for your AI provider.'), { status: 400 });
  // OpenAI's newer models only accept max_completion_tokens; others accept max_tokens.
  if (body.max_tokens && c.provider === 'openai') { body.max_completion_tokens = Math.max(body.max_tokens * 4, 4000); delete body.max_tokens; }
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json', ...(c.provider === 'openrouter' ? { 'X-Title': 'SpendGuard' } : {}) },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = {}; }
  if (Array.isArray(data)) data = data[0] || {};
  if (!res.ok) {
    const msg = data.error?.message || data.message || text.slice(0, 160) || res.statusText;
    throw Object.assign(new Error(msg), { status: res.status, providerError: true });
  }
  return data;
}

function parseArgs(msg) {
  const call = msg?.tool_calls?.[0];
  const raw = call?.function?.arguments ?? msg?.content ?? '';
  if (typeof raw === 'object') return raw;
  const m = String(raw).match(/\{[\s\S]*\}/);
  if (!m) throw new Error('The AI returned no structured answer');
  return JSON.parse(m[0]);
}

async function openaiStructured(c, { system, prompt, name, schema, maxTokens }) {
  const base = {
    model: c.model, max_tokens: maxTokens,
    messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
    tools: [{ type: 'function', function: { name, description: `Return the ${name} result`, parameters: schema } }],
  };
  try {
    const data = await chat(c, { ...base, tool_choice: { type: 'function', function: { name } } });
    return parseArgs(data.choices?.[0]?.message);
  } catch (e) {
    // Some providers don't support naming the tool; ask for any tool call instead.
    if (e.status === 400 && /tool_choice|tool choice/i.test(e.message)) {
      const data = await chat(c, { ...base, tool_choice: 'required' });
      return parseArgs(data.choices?.[0]?.message);
    }
    throw e;
  }
}

async function openaiAgent(c, { system, history, question, tools, runTool, maxSteps }) {
  const messages = [{ role: 'system', content: system }, ...history, { role: 'user', content: question }];
  const used = [];
  for (let step = 0; step < maxSteps; step++) {
    charge(c);
    const data = await chat(c, { model: c.model, max_tokens: 1200, messages, tools: tools.map((t) => ({ type: 'function', function: t })), tool_choice: 'auto' });
    const msg = data.choices?.[0]?.message || {};
    const calls = msg.tool_calls || [];
    if (!calls.length) return { answer: String(msg.content || '').trim(), toolsUsed: used };
    messages.push({ ...msg, role: 'assistant', content: msg.content ?? null });
    for (const call of calls) {
      used.push(call.function.name);
      let args = {}; try { args = JSON.parse(call.function.arguments || '{}'); } catch {}
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(runTool(call.function.name, args)) });
    }
  }
  return { answer: 'That question needed too many steps. Try asking it more simply.', toolsUsed: used };
}

// ---------- public API ----------
function friendly(e, c) {
  const name = (PROVIDERS[c.provider] || PROVIDERS.custom).label;
  if (e.status === 401 || e.status === 403) return Object.assign(new Error(`${name} did not accept this key. Check you copied all of it.`), { status: 400 });
  if (e.status === 404 || /model/i.test(e.message) && e.status === 400) return Object.assign(new Error(`${name} could not use the model "${c.model}": ${e.message}`), { status: 400 });
  if (e.status === 429) return Object.assign(new Error(`${name} says this key is out of credit or rate-limited.`), { status: 400 });
  return e;
}

async function structured({ system, prompt, name, schema, maxTokens = 2000, fast = false }, c = config()) {
  if (!c) throw new Error('AI is off. Add an AI key in Settings.');
  charge(c);
  try {
    return c.provider === 'anthropic' || (PROVIDERS[c.provider]?.kind === 'anthropic')
      ? await anthropicStructured(c, { system, prompt, name, schema, maxTokens, fast })
      : await openaiStructured(c, { system, prompt, name, schema, maxTokens });
  } catch (e) { throw friendly(e, c); }
}

async function runAgent(opts) {
  const c = config();
  if (!c) throw new Error('AI is off. Add an AI key in Settings.');
  const o = { maxSteps: 6, history: [], ...opts };
  try {
    return PROVIDERS[c.provider]?.kind === 'anthropic' ? await anthropicAgent(c, o) : await openaiAgent(c, o);
  } catch (e) { throw friendly(e, c); }
}

// Check a key + model before saving: one tiny structured call proves key, model and tool support.
async function verify({ provider, key, model, base }) {
  const p = PROVIDERS[provider];
  if (!p) throw Object.assign(new Error('Pick your AI provider.'), { status: 400 });
  const c = { provider, key, model: model || p.model, fast: model || p.fast || p.model, base: base || p.base, source: 'user' };
  if (!c.model) throw Object.assign(new Error('Type the model name to use.'), { status: 400 });
  try {
    const out = await structured({
      system: 'You are a connection test.', prompt: 'Reply through the tool with ok set to true.', name: 'connection_test',
      schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }, maxTokens: 50,
    }, c);
    if (!out || typeof out !== 'object') throw new Error('unexpected reply');
    return { ok: true, model: c.model, base: c.base };
  } catch (e) {
    const err = e.status === 400 ? e : friendly(e, c);
    throw Object.assign(new Error(err.message.startsWith(p.label) ? err.message : `Could not use ${p.label}: ${err.message}`), { status: 400 });
  }
}

// ---------- Classification ----------
async function classifyBatch(txns) {
  const lines = txns.map((t) => ({ id: t.id, direction: t.direction, kind: t.kind, amount: t.amount, counterparty: t.counterparty, note: (t.note || '').slice(0, 140) }));
  const out = await structured({
    fast: true,
    name: 'categorize',
    system:
      'You categorize PayPal transactions for a small online business owner who also uses PayPal personally. ' +
      `Use ONLY these categories: ${CATEGORIES.join(', ')}. Money coming in from customers is "Sales Income". ` +
      'Refunds paid to customers are "Refunds". Bank withdrawals are "Transfers". Also give a short clean merchant name ' +
      'and whether it looks like a recurring subscription. Return one result per transaction id.',
    prompt: `Categorize each transaction:\n${JSON.stringify(lines)}`,
    schema: {
      type: 'object',
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, category: { type: 'string', enum: CATEGORIES }, merchant: { type: 'string' }, recurring: { type: 'boolean' } },
            required: ['id', 'category', 'merchant', 'recurring'],
          },
        },
      },
      required: ['results'],
    },
    maxTokens: 4000,
  });
  return (out.results || []).filter((r) => CATEGORIES.includes(r.category));
}

module.exports = { PROVIDERS, detect, config, enabled, describe, structured, runAgent, verify, classifyBatch };
