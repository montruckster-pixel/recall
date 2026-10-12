/**
 * AI integration — server-side only.
 *
 * Default provider is Google Gemini (the sandbox's gateway is pre-configured via
 * GEMINI_BASE_URL + GENAI_PROXY_TOKEN). OpenAI and Anthropic are supported as
 * alternatives. Keys are read from the environment and never sent to the client.
 *
 * Every call:
 *   - is size-limited and time-limited,
 *   - requests JSON output and validates the parsed shape,
 *   - retries transient failures a bounded number of times,
 *   - records usage against the user's monthly AI credit allowance.
 */
import { get, run, nowIso } from './db.js';
import { id, HttpError, monthKey } from './util.js';

const MAX_INPUT_CHARS = Number(process.env.AI_MAX_INPUT_CHARS || 24000);
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 90000);
const MAX_RETRIES = Number(process.env.AI_MAX_RETRIES || 2);

export function aiProvider() {
  const explicit = (process.env.AI_PROVIDER || '').toLowerCase();
  if (explicit) return explicit;
  if (process.env.GEMINI_BASE_URL || process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return 'none';
}

export function aiConfig() {
  const provider = aiProvider();
  const model = process.env.AI_MODEL || defaultModel(provider);
  const configured = provider !== 'none' && Boolean(apiKey(provider));
  return {
    provider,
    model,
    configured,
    // Surfaced to the client so the UI can show a clear setup state.
    message: configured
      ? `AI processing via ${provider} (${model}).`
      : 'AI is not configured. Set AI_PROVIDER and the matching API key to enable document processing and question generation.',
  };
}

function defaultModel(provider) {
  if (provider === 'openai') return 'gpt-4o-mini';
  if (provider === 'anthropic') return 'claude-3-5-sonnet-latest';
  return 'gemini-2.5-flash';
}

function apiKey(provider) {
  if (provider === 'gemini') return process.env.GENAI_PROXY_TOKEN || process.env.GEMINI_API_KEY || '';
  if (provider === 'openai') return process.env.OPENAI_API_KEY || '';
  if (provider === 'anthropic') return process.env.ANTHROPIC_API_KEY || '';
  return '';
}

export class AiNotConfigured extends HttpError {
  constructor() {
    super(503, aiConfig().message, 'ai_not_configured');
  }
}

function truncate(text) {
  const s = String(text || '');
  if (s.length <= MAX_INPUT_CHARS) return s;
  return s.slice(0, MAX_INPUT_CHARS) + '\n\n[...content truncated for processing...]';
}

/** Low-level JSON generation. Returns the parsed object. */
export async function generateJson({ system, prompt, schema = null, temperature = 0.3, maxOutputTokens = 8192 }) {
  if (!aiConfig().configured) throw new AiNotConfigured();
  const provider = aiProvider();
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const text = await callProvider({ provider, system, prompt: truncate(prompt), schema, temperature, maxOutputTokens });
      return parseJsonLoose(text);
    } catch (err) {
      lastErr = err;
      if (err instanceof AiNotConfigured || err.status === 400) throw err;
      if (attempt < MAX_RETRIES) await sleep(600 * (attempt + 1));
    }
  }
  throw new HttpError(502, `AI request failed: ${lastErr?.message || 'unknown error'}`, 'ai_failed');
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function withTimeout(promise, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await promise(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function callProvider({ provider, system, prompt, schema, temperature, maxOutputTokens }) {
  if (provider === 'gemini') return callGemini({ system, prompt, schema, temperature, maxOutputTokens });
  if (provider === 'openai') return callOpenAi({ system, prompt, schema, temperature, maxOutputTokens });
  if (provider === 'anthropic') return callAnthropic({ system, prompt, schema, temperature, maxOutputTokens });
  throw new AiNotConfigured();
}

async function callGemini({ system, prompt, schema, temperature, maxOutputTokens }) {
  const base = (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
  const root = base.endsWith('/v1beta') ? base.slice(0, -'/v1beta'.length) : base;
  const model = process.env.AI_MODEL || defaultModel('gemini');
  const key = apiKey('gemini');
  const url = `${root}/v1beta/models/${model}:streamGenerateContent?alt=sse`;

  const generationConfig = { temperature, maxOutputTokens, responseMimeType: 'application/json' };
  if (schema) generationConfig.responseSchema = schema;

  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig,
  };
  if (system) payload.system_instruction = { parts: [{ text: system }] };

  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
    // The sandbox gateway authenticates with the proxy token and requires an
    // allowlisted User-Agent. On plain Google Gemini, GEMINI_API_KEY is used.
    'User-Agent': process.env.AI_USER_AGENT || 'creao-skill-html/1.0',
    'x-goog-api-key': key,
  };

  const text = await withTimeout(async (signal) => {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), signal });
    if (!res.ok) throw new HttpError(res.status, `Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`, 'ai_http');
    const raw = await res.text();
    return parseGeminiSse(raw);
  }, TIMEOUT_MS);
  return text;
}

function parseGeminiSse(raw) {
  const parts = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('data:')) continue;
    const body = t.slice(5).trim();
    if (!body || body === '[DONE]') continue;
    try {
      const chunk = JSON.parse(body);
      for (const c of chunk.candidates || []) {
        for (const p of c?.content?.parts || []) if (p.text) parts.push(p.text);
      }
    } catch { /* skip malformed chunk */ }
  }
  const text = parts.join('');
  if (!text) throw new Error('empty AI response');
  return text;
}

async function callOpenAi({ system, prompt, temperature, maxOutputTokens }) {
  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = process.env.AI_MODEL || defaultModel('openai');
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });
  const text = await withTimeout(async (signal) => {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey('openai')}` },
      body: JSON.stringify({ model, messages, temperature, max_tokens: maxOutputTokens, response_format: { type: 'json_object' } }),
      signal,
    });
    if (!res.ok) throw new HttpError(res.status, `OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`, 'ai_http');
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }, TIMEOUT_MS);
  if (!text) throw new Error('empty AI response');
  return text;
}

async function callAnthropic({ system, prompt, temperature, maxOutputTokens }) {
  const base = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
  const model = process.env.AI_MODEL || defaultModel('anthropic');
  const text = await withTimeout(async (signal) => {
    const res = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey('anthropic'),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxOutputTokens,
        temperature,
        system: system ? `${system}\nRespond with a single valid JSON object and nothing else.` : 'Respond with a single valid JSON object and nothing else.',
        messages: [{ role: 'user', content: prompt }],
      }),
      signal,
    });
    if (!res.ok) throw new HttpError(res.status, `Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`, 'ai_http');
    const data = await res.json();
    return (data.content || []).map((b) => b.text || '').join('');
  }, TIMEOUT_MS);
  if (!text) throw new Error('empty AI response');
  return text;
}

/** Extract the first balanced JSON value from a model response. */
export function parseJsonLoose(text) {
  if (typeof text !== 'string') return text;
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try { return JSON.parse(s); } catch { /* continue */ }
  const start = s.search(/[[{]/);
  if (start === -1) throw new Error('AI response contained no JSON');
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0; let inStr = false; let esc = false;
  for (let i = start; i < s.length; i += 1) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(s.slice(start, i + 1));
      }
    }
  }
  throw new Error('AI response JSON was incomplete');
}

// ---- Usage metering -------------------------------------------------------

export function aiUsageThisMonth(userId) {
  const row = get(
    'SELECT COALESCE(SUM(units),0) AS units FROM ai_usage WHERE user_id = ? AND month = ?',
    [userId, monthKey()],
  );
  return row?.units || 0;
}

export function recordAiUsage(userId, kind, units = 1) {
  run(
    'INSERT INTO ai_usage (id, user_id, month, kind, units, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id('aiu_'), userId, monthKey(), kind, units, nowIso()],
  );
}
