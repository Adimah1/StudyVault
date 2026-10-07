// Mobile implementation of the `window.sv` API that electron/preload.js provides on desktop.
// The React UI talks only to window.sv, so it runs unchanged on top of this.
//
// Differences from desktop:
//   - Files are imported (copied) into the app, since phones don't let apps scan folders.
//   - Data lives in IndexedDB; search uses MiniSearch instead of SQLite FTS5.
//   - Gemini is called directly from the app with the key baked in at build time.
import { idb } from './idb.js';
import { parseFile, SUPPORTED } from './parsers.js';
import { createSearchIndex } from './search.js';
import { schedule, previews } from '../../shared/srs.mjs';
import { createAi, cleanKey, DEFAULT_MODEL } from '../../shared/ai-core.mjs';

const LIBRARY_NAME = 'My library';
const DEFAULT_FOLDER = 'My files';
const ACCEPT = '.pdf,.docx,.pptx,.txt,application/pdf,text/plain,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

// Injected by vite.config.mjs for `--mode mobile` builds only (from .env).
const BUNDLED_KEY = typeof __SV_GEMINI_KEY__ !== 'undefined' ? __SV_GEMINI_KEY__ : '';
const BUNDLED_MODEL = typeof __SV_GEMINI_MODEL__ !== 'undefined' ? __SV_GEMINI_MODEL__ : '';

const now = () => Date.now();
const extOf = (name) => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');

export async function createMobileBackend() {
  navigator.storage?.persist?.().catch(() => {});

  /* ------------------------------------------------------------- state */
  let files = await idb.getAll('files'); // kept in memory; small
  const searchIndex = createSearchIndex();
  for (const f of files) {
    const rec = await idb.get('pages', f.id);
    if (rec) searchIndex.addFile(f.id, rec.pages);
  }

  let overrideKey = cleanKey(await idb.get('settings', 'geminiApiKey'));
  const getKey = () => overrideKey || cleanKey(BUNDLED_KEY);
  const getModel = () => BUNDLED_MODEL || DEFAULT_MODEL;
  const ai = createAi({
    getKey,
    getModel,
    createClient: async (key) => {
      const { GoogleGenAI } = await import('@google/genai');
      return new GoogleGenAI({ apiKey: key });
    },
  });

  function aiStatus() {
    const key = getKey();
    return {
      available: !!key,
      source: overrideKey ? 'override' : key ? 'bundled' : 'none',
      model: ai.activeModel(),
      keyHint: key ? `…${key.slice(-4)}` : null,
      envFile: '.env (baked in when the mobile app is built)',
    };
  }

  const progressListeners = new Set();
  const emit = (p) => progressListeners.forEach((cb) => cb(p));
  let pending = []; // File objects waiting to be imported by scan()

  /* ----------------------------------------------------------- helpers */
  const getFile = (id) => {
    const f = files.find((x) => x.id === Number(id));
    if (!f) throw new Error('File not found in library.');
    return f;
  };

  const settingsGet = async () => ({
    // Non-null once the student has started, so the app skips the welcome screen.
    rootFolder: files.length || (await idb.get('settings', 'started')) ? LIBRARY_NAME : null,
    theme: (await idb.get('settings', 'theme')) || 'dark',
    aiAvailable: !!getKey(),
  });

  async function pickFiles() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = ACCEPT;
      let settled = false;
      const finish = (list) => {
        if (settled) return;
        settled = true;
        resolve(list);
      };
      input.addEventListener('change', () => finish([...(input.files || [])]));
      input.addEventListener('cancel', () => finish([]));
      input.click();
    });
  }

  async function importOne(file, folder) {
    const ext = extOf(file.name);
    const buffer = await file.arrayBuffer();
    const rel_path = `${folder}/${file.name}`;
    let parsed = { pages: [], html: null };
    let parse_error = null;
    try {
      parsed = await parseFile(ext, buffer);
    } catch (err) {
      parse_error = err?.message || String(err);
    }
    const pages = parsed.pages.map((p) => String(p || '').replace(/\u0000/g, ''));

    // Re-importing the same file into the same folder replaces it but keeps notes/cards/progress.
    const existing = files.find((f) => f.rel_path === rel_path);
    const record = {
      ...(existing ? { id: existing.id } : {}),
      name: file.name,
      ext,
      rel_path,
      size: file.size,
      page_count: pages.length,
      char_count: pages.reduce((n, p) => n + p.trim().length, 0),
      parse_error,
      indexed_at: now(),
    };
    const id = await idb.put('files', record);
    record.id = id;
    await idb.put('blobs', buffer, id);
    await idb.put('pages', { pages }, id);
    if (parsed.html) await idb.put('html', parsed.html, id);
    else await idb.delete('html', id);
    await idb.delete('aiCache', `${id}:summary`);
    await idb.delete('aiCache', `${id}:quiz`);
    searchIndex.addFile(id, pages);
    files = existing ? files.map((f) => (f.id === id ? record : f)) : [...files, record];
  }

  async function cardsWithFile(list) {
    return list.map((c) => {
      const f = files.find((x) => x.id === c.file_id);
      return { ...c, file_name: f?.name ?? null, file_ext: f?.ext ?? null };
    });
  }

  async function filePages(id) {
    const rec = await idb.get('pages', id);
    const pages = (rec?.pages || []).map((content, i) => ({ page_number: i + 1, content }));
    if (pages.reduce((n, p) => n + p.content.trim().length, 0) < 50) {
      throw new Error('This document has no extractable text (it may be a scanned image), so AI tools can’t read it.');
    }
    return pages;
  }

  async function cachedAi(kind, fileId, opts, produce) {
    const file = getFile(fileId);
    const key = `${file.id}:${kind}`;
    const cached = await idb.get('aiCache', key);
    if (cached && !opts.force) return { ...cached, cached: true };
    if (opts.cachedOnly) return null;
    const value = await produce(file, await filePages(file.id));
    const entry = { value, model: ai.activeModel(), created_at: now() };
    await idb.put('aiCache', entry, key);
    return { ...entry, cached: false };
  }

  /* --------------------------------------------------------------- API */
  return {
    platform: 'mobile',

    settings: {
      get: settingsGet,
      set: async (patch = {}) => {
        if (patch.theme) await idb.put('settings', patch.theme === 'light' ? 'light' : 'dark', 'theme');
        return settingsGet();
      },
    },

    library: {
      // On mobile "choosing a folder" means picking files to import.
      chooseFolder: async () => {
        const picked = (await pickFiles()).filter((f) => SUPPORTED.includes(extOf(f.name)));
        if (!picked.length) return null;
        const folder = (window.prompt('Put these files in which folder? (e.g. a subject name)', DEFAULT_FOLDER) || DEFAULT_FOLDER)
          .replace(/[\\/]+/g, '-')
          .trim() || DEFAULT_FOLDER;
        pending.push(...picked.map((file) => ({ file, folder })));
        await idb.put('settings', true, 'started');
        return LIBRARY_NAME;
      },
      scan: async () => {
        const queue = pending;
        pending = [];
        const summary = { total: queue.length, indexed: 0, skipped: 0, removed: 0, errors: 0 };
        for (let i = 0; i < queue.length; i++) {
          emit({ running: true, phase: 'indexing', done: i, total: queue.length, current: queue[i].file.name });
          try {
            await importOne(queue[i].file, queue[i].folder);
            summary.indexed++;
          } catch (err) {
            console.error('[import]', err);
            summary.errors++;
          }
        }
        emit({ running: false, ...summary });
        return { ok: true, ...summary };
      },
      list: async () => {
        const progress = new Map((await Promise.all(files.map(async (f) => [f.id, await idb.get('progress', f.id)]))));
        const cards = await idb.getAll('cards');
        return files
          .map((f) => {
            const p = progress.get(f.id) || {};
            return {
              id: f.id,
              name: f.name,
              ext: f.ext,
              rel_path: f.rel_path,
              page_count: f.page_count,
              char_count: f.char_count,
              parse_error: f.parse_error,
              seconds_spent: p.seconds_spent || 0,
              max_scroll_pct: p.max_scroll_pct || 0,
              last_opened_at: p.last_opened_at || null,
              card_count: cards.filter((c) => c.file_id === f.id).length,
            };
          })
          .sort((a, b) => a.rel_path.localeCompare(b.rel_path, undefined, { sensitivity: 'base', numeric: true }));
      },
      onScanProgress: (cb) => {
        progressListeners.add(cb);
        return () => progressListeners.delete(cb);
      },
    },

    file: {
      content: async (id) => {
        const file = getFile(id);
        const progress = (await idb.get('progress', file.id)) || {};
        await idb.put('progress', { ...progress, last_opened_at: now() }, file.id);
        const kind = file.ext === 'pdf' ? 'pdf' : file.ext === 'txt' ? 'text' : 'html';
        const html = kind === 'html' ? (await idb.get('html', file.id)) || '' : null;
        const text = kind === 'text' ? (await idb.get('pages', file.id))?.pages?.[0] || '' : null;
        return { file, kind, html, text, progress };
      },
      readBinary: async (id) => new Uint8Array(await idb.get('blobs', getFile(id).id)),
      openExternal: async () => {},
      reveal: async () => {},
      remove: async (id) => {
        const file = getFile(id);
        for (const store of ['blobs', 'pages', 'html', 'notes', 'progress']) await idb.delete(store, file.id);
        await idb.delete('aiCache', `${file.id}:summary`);
        await idb.delete('aiCache', `${file.id}:quiz`);
        await idb.delete('files', file.id);
        // Keep flashcards (like desktop's ON DELETE SET NULL) but unlink them.
        for (const c of await idb.getAll('cards')) {
          if (c.file_id === file.id) await idb.put('cards', { ...c, file_id: null, page_number: null });
        }
        searchIndex.removeFile(file.id);
        files = files.filter((f) => f.id !== file.id);
        return true;
      },
    },

    notes: {
      get: async (fileId) => (await idb.get('notes', fileId)) || null,
      save: async (fileId, html) => {
        await idb.put('notes', { content_html: String(html ?? ''), updated_at: now() }, fileId);
        return true;
      },
    },

    progress: {
      tick: async (fileId, seconds) => {
        const s = Math.max(0, Math.min(300, Math.round(Number(seconds) || 0)));
        if (!s) return;
        const p = (await idb.get('progress', fileId)) || {};
        await idb.put('progress', { ...p, seconds_spent: (p.seconds_spent || 0) + s }, fileId);
      },
      scroll: async (fileId, { pct = 0, position = 0 } = {}) => {
        const clamp = (x) => Math.max(0, Math.min(1, Number(x) || 0));
        const p = (await idb.get('progress', fileId)) || {};
        await idb.put('progress', { ...p, max_scroll_pct: Math.max(p.max_scroll_pct || 0, clamp(pct)), last_position: clamp(position) }, fileId);
      },
    },

    search: {
      query: async (q) => {
        const query = String(q || '').trim();
        if (query.length < 2) return [];
        const lower = query.toLowerCase();
        const byName = files
          .filter((f) => f.name.toLowerCase().includes(lower))
          .slice(0, 5)
          .map((f) => ({ type: 'file', fileId: f.id, name: f.name, relPath: f.rel_path, ext: f.ext, page: null, snippet: null }));
        const byText = searchIndex.search(query).flatMap((r) => {
          const f = files.find((x) => x.id === r.fileId);
          return f ? [{ type: 'text', fileId: f.id, name: f.name, relPath: f.rel_path, ext: f.ext, page: r.page, snippet: r.snippet }] : [];
        });
        return [...byName, ...byText];
      },
    },

    cards: {
      list: async ({ fileId = null } = {}) =>
        cardsWithFile(
          (await idb.getAll('cards')).filter((c) => fileId == null || c.file_id === fileId).sort((a, b) => b.created_at - a.created_at),
        ),
      due: async ({ fileId = null, cram = false } = {}) => {
        const t = now();
        let list = (await idb.getAll('cards')).filter((c) => fileId == null || c.file_id === fileId);
        if (cram) {
          list = list
            .map((c) => ({ c, r: Math.random() }))
            .sort((a, b) => (b.c.lapses + 1) / (b.c.repetitions + 1) - (a.c.lapses + 1) / (a.c.repetitions + 1) || a.c.ease - b.c.ease || a.r - b.r)
            .map((x) => x.c);
        } else {
          list = list.filter((c) => c.due_at <= t).sort((a, b) => b.lapses - a.lapses || a.due_at - b.due_at);
        }
        return (await cardsWithFile(list.slice(0, 100))).map((c) => ({ ...c, previews: previews(c, t) }));
      },
      stats: async ({ fileId = null } = {}) => {
        const t = now();
        const list = (await idb.getAll('cards')).filter((c) => fileId == null || c.file_id === fileId);
        return {
          total: list.length,
          due: list.filter((c) => c.due_at <= t).length,
          new_count: list.filter((c) => !c.last_reviewed_at).length,
          mature: list.filter((c) => c.interval_days >= 21).length,
        };
      },
      create: async (input) => {
        const list = (Array.isArray(input) ? input : [input])
          .map((c) => ({
            file_id: c.fileId ?? null,
            front: String(c.front || '').trim().slice(0, 5000),
            back: String(c.back || '').trim().slice(0, 10000),
            source: ['highlight', 'ai', 'quiz', 'manual'].includes(c.source) ? c.source : 'manual',
            page_number: c.page ?? null,
            ease: 2.5,
            interval_days: 0,
            repetitions: 0,
            lapses: 0,
            due_at: now(),
            created_at: now(),
            last_reviewed_at: null,
          }))
          .filter((c) => c.front && c.back);
        if (!list.length) throw new Error('A flashcard needs both a front and a back.');
        const ids = [];
        for (const c of list) ids.push(await idb.add('cards', c));
        return ids;
      },
      update: async (id, { front, back }) => {
        front = String(front || '').trim();
        back = String(back || '').trim();
        if (!front || !back) throw new Error('A flashcard needs both a front and a back.');
        const card = await idb.get('cards', id);
        await idb.put('cards', { ...card, front, back });
        return (await cardsWithFile([{ ...card, front, back }]))[0];
      },
      delete: async (id) => {
        await idb.delete('cards', id);
        return true;
      },
      review: async (id, grade) => {
        const card = await idb.get('cards', id);
        if (!card) throw new Error('Card not found.');
        const g = Math.max(0, Math.min(3, Number(grade) | 0));
        const t = now();
        const updated = { ...card, ...schedule(card, g, t), last_reviewed_at: t };
        await idb.put('cards', updated);
        await idb.add('reviews', { card_id: id, grade: g, reviewed_at: t });
        const [withFile] = await cardsWithFile([updated]);
        return { ...withFile, previews: previews(updated, t) };
      },
    },

    ai: {
      summary: (fileId, opts = {}) => cachedAi('summary', fileId, opts, (f, pages) => ai.summarize(f.name, pages)),
      quiz: (fileId, opts = {}) => cachedAi('quiz', fileId, opts, (f, pages) => ai.quiz(f.name, pages)),
      keyTerms: async (fileId) => {
        const file = getFile(fileId);
        return ai.keyTerms(file.name, await filePages(file.id));
      },
      cardFromText: (text) => ai.cardFromText(String(text || '').slice(0, 4000)),
    },

    dev: {
      aiStatus: async () => aiStatus(),
      testKey: (key) => ai.testKey(key),
      setKey: async (key) => {
        const result = await ai.testKey(key);
        if (result.ok) {
          overrideKey = cleanKey(key);
          await idb.put('settings', overrideKey, 'geminiApiKey');
        }
        return { ...result, status: aiStatus() };
      },
      clearKey: async () => {
        overrideKey = null;
        await idb.delete('settings', 'geminiApiKey');
        return aiStatus();
      },
    },
  };
}
