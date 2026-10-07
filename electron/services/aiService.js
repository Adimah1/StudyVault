'use strict';

// All Gemini calls live here, in the main process, so the API key never reaches the renderer.
//
// Key resolution order:
//   1. Developer override saved from the hidden panel (Ctrl+Shift+D), stored in userData via electron-store
//   2. GEMINI_API_KEY from the .env file bundled with the app (resources/.env when packaged)
// Students never see or enter a key; every failure is reported with a friendly message.

const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');
const Store = require('electron-store');

const DEFAULT_MODEL = 'gemini-3.8-flash';
// Tried in order if the configured model is retired or not enabled for the key's project.
const FALLBACK_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest'];
const PLACEHOLDER = 'YOUR_KEY_HERE';
const MAX_CHARS = 60000;
const MAX_ATTEMPTS = 3; // per model, for transient failures
const MAX_RETRY_WAIT_MS = 20000;

const MESSAGES = {
  unavailable: 'AI features are currently unavailable. Please contact the app provider.',
  dailyLimit: "You've hit the daily free limit. Please try again tomorrow.",
  minuteLimit: 'The AI is getting too many requests right now. Please wait a minute and try again.',
  busy: 'The AI service is busy right now. Please try again in a few minutes.',
  offline: "Couldn't reach the AI service. Check your internet connection and try again.",
  badOutput: 'The AI returned an unreadable response. Please try again.',
  empty: 'The AI couldn’t produce a response for this document. Please try again.',
};

const SYSTEM =
  'You are StudyVault, a study assistant. You produce clear, accurate study material grounded ONLY in the document the user provides. Never invent facts that are not in the document.';

class AiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/* --------------------------------------------------------------- key handling */

function bundledEnvPath() {
  return app.isPackaged ? path.join(process.resourcesPath, '.env') : path.join(__dirname, '..', '..', '.env');
}

// .env is re-read whenever it changes on disk, so adding a key takes effect without a restart.
let envMtime = null;
function refreshEnv() {
  const file = bundledEnvPath();
  let mtime;
  try {
    mtime = fs.statSync(file).mtimeMs;
  } catch {
    return;
  }
  if (mtime === envMtime) return;
  envMtime = mtime;
  require('dotenv').config({ path: file, override: true, quiet: true });
}

function init() {
  refreshEnv();
}

let store = null;
function devStore() {
  if (!store) store = new Store({ name: 'developer-settings', clearInvalidConfig: true });
  return store;
}

const cleanKey = (k) => {
  const key = String(k || '').trim();
  return key && key !== PLACEHOLDER ? key : null;
};

function overrideKey() {
  const saved = devStore().get('geminiApiKey');
  if (!saved) return null;
  try {
    if (saved.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(saved.slice(4), 'base64'));
    return saved.replace(/^raw:/, '');
  } catch {
    return null;
  }
}

function resolveKey() {
  refreshEnv();
  const override = cleanKey(overrideKey());
  if (override) return { key: override, source: 'override' };
  const bundled = cleanKey(process.env.GEMINI_API_KEY);
  if (bundled) return { key: bundled, source: 'bundled' };
  return { key: null, source: 'none' };
}

function model() {
  refreshEnv();
  return (process.env.GEMINI_MODEL || '').trim() || DEFAULT_MODEL;
}

// The model that actually answered last (may be a fallback).
let lastGoodModel = null;
function activeModel() {
  return lastGoodModel || model();
}

function setOverrideKey(key) {
  const k = cleanKey(key);
  if (!k) throw new Error('Enter a key.');
  const value = safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(k).toString('base64') : 'raw:' + k;
  devStore().set('geminiApiKey', value);
}

function clearOverrideKey() {
  devStore().delete('geminiApiKey');
}

function status() {
  const { key, source } = resolveKey();
  return {
    available: !!key,
    source, // 'override' | 'bundled' | 'none'
    model: activeModel(),
    keyHint: key ? `…${key.slice(-4)}` : null,
    envFile: bundledEnvPath(),
  };
}

/* ------------------------------------------------------------------ Gemini */

let sdkPromise = null;
const loadSdk = () => (sdkPromise ||= import('@google/genai')); // ESM-only package

const clients = new Map();
async function clientFor(key) {
  if (!clients.has(key)) {
    const { GoogleGenAI } = await loadSdk();
    clients.set(key, new GoogleGenAI({ apiKey: key }));
  }
  return clients.get(key);
}

/**
 * Classify a Gemini / network error.
 *   daily   – free-tier daily quota used up (not retryable today)
 *   minute  – per-minute rate limit (retry after a short wait)
 *   busy    – 5xx / overloaded (retry, then try another model)
 *   offline – network failure (retry)
 *   model   – model retired or not enabled for this key (try the next model)
 *   auth    – invalid / revoked key, permission denied
 */
function classify(err) {
  const status = typeof err?.status === 'number' ? err.status : null;
  const text = String(err?.message || err || '');
  const delay = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(text);
  const retryAfterMs = delay ? Math.ceil(Number(delay[1]) * 1000) : null;

  if (status === 429 || /RESOURCE_EXHAUSTED/.test(text)) {
    return { kind: /PerDay|per day/i.test(text) ? 'daily' : /PerMinute|per minute/i.test(text) || retryAfterMs ? 'minute' : 'daily', retryAfterMs };
  }
  if (status === 404 || /NOT_FOUND|is not found|not supported for generateContent|no longer available/i.test(text)) return { kind: 'model' };
  if (status && status >= 500) return { kind: 'busy', retryAfterMs };
  if (!status && /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket|network|timed? ?out|aborted/i.test(text)) {
    return { kind: 'offline' };
  }
  if (status === 400 || status === 401 || status === 403) return { kind: 'auth' };
  return { kind: 'other' };
}

/** Map any SDK / network error to a student-friendly AiError; log the technical detail. */
function toFriendly(err) {
  if (err instanceof AiError) return err;
  const status = typeof err?.status === 'number' ? err.status : '';
  console.error('[ai] Gemini request failed:', status, String(err?.message || err).slice(0, 800));
  switch (classify(err).kind) {
    case 'daily':
      return new AiError('rate_limit', MESSAGES.dailyLimit);
    case 'minute':
      return new AiError('rate_limit', MESSAGES.minuteLimit);
    case 'busy':
      return new AiError('busy', MESSAGES.busy);
    case 'offline':
      return new AiError('offline', MESSAGES.offline);
    default:
      // Invalid / revoked key, every model unavailable, anything unexpected.
      return new AiError('unavailable', MESSAGES.unavailable);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Models that returned "not found" for a given key, so we don't keep asking for them.
const missingModels = new Map();

/**
 * Call generateContent with retries (transient errors, exponential backoff, honoring
 * Gemini's retryDelay) and fall back to other Flash models if one is unavailable.
 */
async function callGemini(apiKey, request) {
  const ai = await clientFor(apiKey);
  if (!missingModels.has(apiKey)) missingModels.set(apiKey, new Set());
  const missing = missingModels.get(apiKey);
  const models = [model(), ...FALLBACK_MODELS].filter((m, i, all) => all.indexOf(m) === i && !missing.has(m));

  let lastErr = new AiError('unavailable', MESSAGES.unavailable);
  for (const m of models) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await ai.models.generateContent({ ...request, model: m });
        lastGoodModel = m;
        return response;
      } catch (err) {
        lastErr = err;
        const { kind, retryAfterMs } = classify(err);
        if (kind === 'model') {
          console.warn(`[ai] model ${m} unavailable, trying the next one`);
          missing.add(m);
          break; // next model
        }
        const retryable = kind === 'busy' || kind === 'offline' || kind === 'minute';
        if (!retryable) throw err;
        if (attempt === MAX_ATTEMPTS) {
          if (kind === 'busy') break; // overloaded: another model may have capacity
          throw err;
        }
        const backoff = 1500 * 2 ** (attempt - 1);
        await sleep(Math.min(MAX_RETRY_WAIT_MS, retryAfterMs ?? backoff) + Math.random() * 300);
      }
    }
  }
  throw lastErr;
}

function parseJson(text) {
  return JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
}

async function generate(prompt, { json = false, key = null } = {}) {
  const apiKey = key || resolveKey().key;
  if (!apiKey) throw new AiError('unavailable', MESSAGES.unavailable);

  const request = {
    contents: prompt,
    config: {
      systemInstruction: SYSTEM,
      ...(json ? { responseMimeType: 'application/json' } : {}),
      httpOptions: { timeout: 120000 },
    },
  };

  // An empty or malformed answer is usually a one-off; ask once more before giving up.
  let failure = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let response;
    try {
      response = await callGemini(apiKey, request);
    } catch (err) {
      throw toFriendly(err);
    }
    const text = (response?.text || '').trim();
    if (!text) {
      failure = new AiError('empty', MESSAGES.empty);
      continue;
    }
    if (!json) return text;
    try {
      return parseJson(text);
    } catch {
      failure = new AiError('bad_output', MESSAGES.badOutput);
    }
  }
  throw failure;
}

/* ----------------------------------------------------------------- prompts */

/** Join page texts with page markers, capped at MAX_CHARS. */
function documentText(pages) {
  let text = '';
  let truncated = false;
  for (const p of pages) {
    const chunk = `\n\n[Page ${p.page_number}]\n${p.content.trim()}`;
    if (text.length + chunk.length > MAX_CHARS) {
      text += chunk.slice(0, MAX_CHARS - text.length);
      truncated = true;
      break;
    }
    text += chunk;
  }
  return { text: text.trim(), truncated };
}

function docPrompt(title, pages, instructions) {
  const { text, truncated } = documentText(pages);
  return (
    `Document: "${title}"\n\n${instructions}` +
    (truncated ? '\n\n(Note: the document was long and has been truncated; work with the part provided.)' : '') +
    `\n\n--- DOCUMENT START ---\n${text}\n--- DOCUMENT END ---`
  );
}

async function summarize(title, pages) {
  return generate(
    docPrompt(
      title,
      pages,
      `Write a study summary in Markdown with exactly these sections:
## Overview
2–3 sentences on what the document covers.
## Key Concepts
Bullet points, each a concept in **bold** followed by a one-line explanation.
## Important Terms
Bullet points in the form **Term** — definition.
## Check Yourself
3 short self-test questions (no answers).
Be concise and precise.`,
    ),
  );
}

async function quiz(title, pages) {
  const data = await generate(
    docPrompt(
      title,
      pages,
      `Create exactly 5 multiple-choice questions that test understanding (not trivia) of this document.
Each question has exactly 4 options and one correct answer. Vary the position of the correct answer.
Respond with JSON only, in this shape:
{"questions":[{"question":"...","options":["...","...","...","..."],"answerIndex":0,"explanation":"One or two sentences on why the answer is correct."}]}`,
    ),
    { json: true },
  );
  const questions = (data.questions || [])
    .filter(
      (q) =>
        q &&
        typeof q.question === 'string' &&
        Array.isArray(q.options) &&
        q.options.length === 4 &&
        Number.isInteger(q.answerIndex) &&
        q.answerIndex >= 0 &&
        q.answerIndex < 4,
    )
    .slice(0, 5)
    .map((q) => ({
      question: q.question.trim(),
      options: q.options.map((o) => String(o).trim()),
      answerIndex: q.answerIndex,
      explanation: String(q.explanation || '').trim(),
    }));
  if (!questions.length) throw new AiError('bad_output', MESSAGES.badOutput);
  return { questions };
}

async function keyTerms(title, pages) {
  const data = await generate(
    docPrompt(
      title,
      pages,
      `Extract the 8–12 most important key terms or concepts a student must memorize from this document.
For each, write a flashcard: "front" is the term or a short question, "back" is a concise, accurate answer (1–3 sentences).
Respond with JSON only: {"cards":[{"front":"...","back":"..."}]}`,
    ),
    { json: true },
  );
  return (data.cards || [])
    .filter((c) => c && c.front && c.back)
    .map((c) => ({ front: String(c.front).trim(), back: String(c.back).trim() }));
}

async function cardFromText(text) {
  const data = await generate(
    `Turn this passage a student highlighted into one flashcard. "front" is a clear question that tests the key idea; "back" is a concise answer taken from the passage.
Respond with JSON only: {"front":"...","back":"..."}

Passage:
${text}`,
    { json: true },
  );
  if (!data.front || !data.back) throw new AiError('bad_output', MESSAGES.badOutput);
  return { front: String(data.front).trim(), back: String(data.back).trim() };
}

/** Developer panel only: check a key with a tiny request. Returns technical detail on failure. */
async function testKey(key) {
  const k = cleanKey(key) || resolveKey().key;
  if (!k) return { ok: false, message: 'No key configured.' };
  try {
    await callGemini(k, { contents: 'Reply with the single word: OK', config: { httpOptions: { timeout: 30000 } } });
    return { ok: true, message: `Key works with ${activeModel()}.` };
  } catch (err) {
    return { ok: false, message: `${toFriendly(err).message}\n\nDetail: ${String(err?.message || err).slice(0, 400)}` };
  }
}

module.exports = {
  init,
  status,
  model,
  activeModel,
  setOverrideKey,
  clearOverrideKey,
  testKey,
  summarize,
  quiz,
  keyTerms,
  cardFromText,
  MESSAGES,
};
