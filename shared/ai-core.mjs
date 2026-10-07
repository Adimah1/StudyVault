// Gemini logic shared by desktop and mobile: prompts, retries, model fallback and
// student-friendly error messages. Each app supplies how to get the key and build a client.

export const DEFAULT_MODEL = 'gemini-3.8-flash';
// Tried in order if the configured model is retired or not enabled for the key's project.
export const FALLBACK_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest'];
export const PLACEHOLDER_KEY = 'YOUR_KEY_HERE';

const MAX_CHARS = 60000;
const MAX_ATTEMPTS = 3; // per model, for transient failures

export const MESSAGES = {
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

export class AiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export const cleanKey = (k) => {
  const key = String(k || '').trim();
  return key && key !== PLACEHOLDER_KEY ? key : null;
};

/**
 * Classify a Gemini / network error.
 *   daily   – free-tier daily quota used up (not retryable today)
 *   minute  – per-minute rate limit (retry after a short wait)
 *   busy    – 5xx / overloaded (retry, then try another model)
 *   offline – network failure (retry)
 *   model   – model retired or not enabled for this key (try the next model)
 *   auth    – invalid / revoked key, permission denied
 */
export function classify(err) {
  const status = typeof err?.status === 'number' ? err.status : null;
  const text = String(err?.message || err || '');
  const delay = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(text);
  const retryAfterMs = delay ? Math.ceil(Number(delay[1]) * 1000) : null;

  if (status === 429 || /RESOURCE_EXHAUSTED/.test(text)) {
    return { kind: /PerDay|per day/i.test(text) ? 'daily' : /PerMinute|per minute/i.test(text) || retryAfterMs ? 'minute' : 'daily', retryAfterMs };
  }
  if (status === 404 || /NOT_FOUND|is not found|not supported for generateContent|no longer available/i.test(text)) return { kind: 'model' };
  if (status && status >= 500) return { kind: 'busy', retryAfterMs };
  if (!status && /fetch failed|Failed to fetch|NetworkError|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket|network|timed? ?out|aborted/i.test(text)) {
    return { kind: 'offline' };
  }
  if (status === 400 || status === 401 || status === 403) return { kind: 'auth' };
  return { kind: 'other' };
}

/** Map any SDK / network error to a student-friendly AiError. */
export function toFriendly(err, log = console) {
  if (err instanceof AiError) return err;
  log.error?.('[ai] Gemini request failed:', err?.status ?? '', String(err?.message || err).slice(0, 800));
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

function parseJson(text) {
  return JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object} opts
 * @param {() => string|null} opts.getKey        current API key (null = AI unavailable)
 * @param {() => string} opts.getModel           configured model id
 * @param {(key: string) => Promise<any>} opts.createClient  returns a GoogleGenAI instance
 * @param {number} [opts.maxRetryWaitMs]
 * @param {Console} [opts.log]
 */
export function createAi({ getKey, getModel, createClient, maxRetryWaitMs = 20000, log = console }) {
  const clients = new Map();
  const missingModels = new Map(); // key -> Set of models that returned "not found"
  let lastGoodModel = null;

  async function clientFor(key) {
    if (!clients.has(key)) clients.set(key, await createClient(key));
    return clients.get(key);
  }

  /** generateContent with retries (backoff, honoring retryDelay) and model fallback. */
  async function callGemini(apiKey, request) {
    const ai = await clientFor(apiKey);
    if (!missingModels.has(apiKey)) missingModels.set(apiKey, new Set());
    const missing = missingModels.get(apiKey);
    const models = [getModel() || DEFAULT_MODEL, ...FALLBACK_MODELS].filter((m, i, all) => all.indexOf(m) === i && !missing.has(m));

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
            log.warn?.(`[ai] model ${m} unavailable, trying the next one`);
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
          await sleep(Math.min(maxRetryWaitMs, retryAfterMs ?? backoff) + Math.random() * 300);
        }
      }
    }
    throw lastErr;
  }

  async function generate(prompt, { json = false, key = null } = {}) {
    const apiKey = key || getKey();
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
        throw toFriendly(err, log);
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
    const k = cleanKey(key) || getKey();
    if (!k) return { ok: false, message: 'No key configured.' };
    try {
      await callGemini(k, { contents: 'Reply with the single word: OK', config: { httpOptions: { timeout: 30000 } } });
      return { ok: true, message: `Key works with ${activeModel()}.` };
    } catch (err) {
      return { ok: false, message: `${toFriendly(err, log).message}\n\nDetail: ${String(err?.message || err).slice(0, 400)}` };
    }
  }

  const activeModel = () => lastGoodModel || getModel() || DEFAULT_MODEL;

  return { generate, summarize, quiz, keyTerms, cardFromText, testKey, activeModel, _clients: clients };
}
