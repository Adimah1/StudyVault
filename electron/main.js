'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, protocol } = require('electron');
const path = require('path');
const fsp = require('fs/promises');

const { openDatabase } = require('./db');
const { scanLibrary, indexFile } = require('./scanner');
const aiService = require('./services/aiService');

// Spaced-repetition scheduler (shared/srs.mjs, also used by mobile); loaded before IPC is registered.
let schedule = null;

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const DIST_DIR = path.join(__dirname, '..', 'dist');
const APP_ORIGIN = 'app://studyvault';

// Production content security policy (dev relies on Vite's inline HMR scripts).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self' blob: data:",
].join('; ');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
};

// Serve the built renderer from a privileged custom scheme instead of file://,
// so ES modules and the pdf.js web worker load like they would on the web.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

// Optional separate profile (database + settings), e.g. for testing.
if (process.env.STUDYVAULT_USER_DATA) app.setPath('userData', process.env.STUDYVAULT_USER_DATA);

// Load the bundled .env (GEMINI_API_KEY, optional GEMINI_MODEL).
aiService.init();

let db = null;
let mainWindow = null;
let scanning = false;

/* ------------------------------------------------------------------ settings */

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  if (value === null || value === undefined) {
    db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  } else {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
      key,
      String(value),
    );
  }
}

function publicSettings() {
  return {
    rootFolder: getSetting('rootFolder'),
    theme: getSetting('theme', 'dark'),
    aiAvailable: aiService.status().available,
  };
}

/* ------------------------------------------------------------------- helpers */

const now = () => Date.now();

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function getFile(id) {
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(Number(id));
  if (!file) throw new Error('File not found in library.');
  return file;
}

function publicFile(f) {
  return {
    id: f.id,
    name: f.name,
    ext: f.ext,
    rel_path: f.rel_path,
    page_count: f.page_count,
    char_count: f.char_count,
    parse_error: f.parse_error,
  };
}

function cardRow(id) {
  return db
    .prepare('SELECT c.*, f.name AS file_name, f.ext AS file_ext FROM flashcards c LEFT JOIN files f ON f.id = c.file_id WHERE c.id = ?')
    .get(id);
}

/** Attach the next-due interval for each grade so the UI can label the buttons. */
function withPreviews(card) {
  const t = now();
  return { ...card, previews: [0, 1, 2, 3].map((g) => schedule(card, g, t).due_at - t) };
}

function toFtsQuery(q) {
  const tokens = (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).slice(0, 8);
  return tokens.map((t) => `"${t}"*`).join(' ');
}

async function runScan() {
  const root = getSetting('rootFolder');
  if (!root) return { ok: false, error: 'No study folder selected.' };
  if (scanning) return { ok: false, busy: true };
  scanning = true;
  send('scan:progress', { running: true, phase: 'discovering', done: 0, total: 0 });
  try {
    const summary = await scanLibrary(db, root, (p) => send('scan:progress', { running: true, ...p }));
    send('scan:progress', { running: false, ...summary });
    return { ok: true, ...summary };
  } catch (err) {
    send('scan:progress', { running: false, error: err.message });
    return { ok: false, error: err.message };
  } finally {
    scanning = false;
  }
}

/* ----------------------------------------------------------------------- AI */

function documentPages(fileId) {
  const pages = db.prepare('SELECT page_number, content FROM pages WHERE file_id = ? ORDER BY page_number').all(fileId);
  const chars = pages.reduce((n, p) => n + p.content.trim().length, 0);
  if (chars < 50) {
    throw new Error('This document has no extractable text (it may be a scanned image), so AI tools can’t read it.');
  }
  return pages;
}

async function cachedAi(kind, fileId, opts, produce) {
  const file = getFile(fileId);
  const cached = db.prepare('SELECT content, model, created_at FROM ai_cache WHERE file_id = ? AND kind = ?').get(file.id, kind);
  if (cached && !opts.force) {
    return { value: JSON.parse(cached.content), model: cached.model, created_at: cached.created_at, cached: true };
  }
  if (opts.cachedOnly) return null;
  const pages = documentPages(file.id);
  const value = await produce(file, pages);
  const model = aiService.activeModel();
  const created_at = now();
  db.prepare(
    `INSERT INTO ai_cache (file_id, kind, content, model, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(file_id, kind) DO UPDATE SET content = excluded.content, model = excluded.model, created_at = excluded.created_at`,
  ).run(file.id, kind, JSON.stringify(value), model, created_at);
  return { value, model, created_at, cached: false };
}

/* ---------------------------------------------------------------------- IPC */

function handle(channel, fn) {
  ipcMain.handle(channel, (_event, ...args) => fn(...args));
}

function registerIpc() {
  // Settings
  handle('settings:get', () => publicSettings());
  handle('settings:set', (patch = {}) => {
    if (patch.theme) setSetting('theme', patch.theme === 'light' ? 'light' : 'dark');
    return publicSettings();
  });

  // Library
  handle('library:chooseFolder', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose your Root Study Folder',
      properties: ['openDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const root = path.resolve(res.filePaths[0]);
    setSetting('rootFolder', root);
    return root;
  });
  handle('library:scan', () => runScan());
  handle('library:list', () => {
    const root = getSetting('rootFolder');
    if (!root) return [];
    return db
      .prepare(
        `SELECT f.id, f.name, f.ext, f.rel_path, f.page_count, f.char_count, f.parse_error,
                COALESCE(p.seconds_spent, 0)  AS seconds_spent,
                COALESCE(p.max_scroll_pct, 0) AS max_scroll_pct,
                p.last_opened_at,
                (SELECT COUNT(*) FROM flashcards c WHERE c.file_id = f.id) AS card_count
         FROM files f LEFT JOIN progress p ON p.file_id = f.id
         WHERE f.root = ? AND f.missing = 0
         ORDER BY f.rel_path COLLATE NOCASE`,
      )
      .all(root);
  });

  // Files
  handle('file:content', async (id) => {
    let file = getFile(id);
    let stat;
    try {
      stat = await fsp.stat(file.path);
    } catch {
      throw new Error('This file is no longer available on disk.');
    }
    // Re-index on open if the file was edited since we cached it.
    if (stat.size !== file.size || Math.floor(stat.mtimeMs) !== file.mtime_ms) {
      await indexFile(db, file.root, file.path, stat);
      file = getFile(id);
    }
    db.prepare(
      'INSERT INTO progress (file_id, last_opened_at) VALUES (?, ?) ON CONFLICT(file_id) DO UPDATE SET last_opened_at = excluded.last_opened_at',
    ).run(file.id, now());

    const kind = file.ext === 'pdf' ? 'pdf' : file.ext === 'txt' ? 'text' : 'html';
    let html = null;
    let text = null;
    if (kind === 'html') html = db.prepare('SELECT html FROM file_html WHERE file_id = ?').get(file.id)?.html ?? '';
    if (kind === 'text') text = (await fsp.readFile(file.path, 'utf8')).replace(/^﻿/, '');
    const progress = db.prepare('SELECT max_scroll_pct, last_position, seconds_spent FROM progress WHERE file_id = ?').get(file.id);
    return { file: publicFile(file), kind, html, text, progress };
  });
  handle('file:readBinary', async (id) => fsp.readFile(getFile(id).path));
  handle('file:openExternal', async (id) => {
    const err = await shell.openPath(getFile(id).path);
    if (err) throw new Error(err);
  });
  handle('file:reveal', (id) => shell.showItemInFolder(getFile(id).path));

  // Notes
  handle('notes:get', (fileId) => db.prepare('SELECT content_html, updated_at FROM notes WHERE file_id = ?').get(fileId) || null);
  handle('notes:save', (fileId, html) => {
    getFile(fileId);
    db.prepare(
      `INSERT INTO notes (file_id, content_html, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(file_id) DO UPDATE SET content_html = excluded.content_html, updated_at = excluded.updated_at`,
    ).run(fileId, String(html ?? ''), now());
    return true;
  });

  // Progress
  handle('progress:tick', (fileId, seconds) => {
    const s = Math.max(0, Math.min(300, Math.round(Number(seconds) || 0)));
    if (!s) return;
    db.prepare(
      'INSERT INTO progress (file_id, seconds_spent) VALUES (?, ?) ON CONFLICT(file_id) DO UPDATE SET seconds_spent = seconds_spent + excluded.seconds_spent',
    ).run(fileId, s);
  });
  handle('progress:scroll', (fileId, { pct = 0, position = 0 } = {}) => {
    const clamp = (x) => Math.max(0, Math.min(1, Number(x) || 0));
    db.prepare(
      `INSERT INTO progress (file_id, max_scroll_pct, last_position) VALUES (@id, @pct, @pos)
       ON CONFLICT(file_id) DO UPDATE SET max_scroll_pct = MAX(max_scroll_pct, excluded.max_scroll_pct), last_position = excluded.last_position`,
    ).run({ id: fileId, pct: clamp(pct), pos: clamp(position) });
  });

  // Global search
  handle('search:query', (q) => {
    const root = getSetting('rootFolder');
    const query = String(q || '').trim();
    if (!root || query.length < 2) return [];
    const results = [];

    const like = `%${query.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    for (const f of db
      .prepare(`SELECT id, name, rel_path, ext FROM files WHERE root = ? AND missing = 0 AND name LIKE ? ESCAPE '\\' ORDER BY name LIMIT 5`)
      .all(root, like)) {
      results.push({ type: 'file', fileId: f.id, name: f.name, relPath: f.rel_path, ext: f.ext, page: null, snippet: null });
    }

    const fts = toFtsQuery(query);
    if (fts) {
      try {
        const rows = db
          .prepare(
            `SELECT p.file_id, p.page_number, f.name, f.rel_path, f.ext,
                    snippet(pages_fts, 0, char(1), char(2), '…', 18) AS snippet
             FROM pages_fts
             JOIN pages p ON p.id = pages_fts.rowid
             JOIN files f ON f.id = p.file_id
             WHERE pages_fts MATCH ? AND f.root = ? AND f.missing = 0
             ORDER BY rank
             LIMIT 40`,
          )
          .all(fts, root);
        for (const r of rows) {
          results.push({
            type: 'text',
            fileId: r.file_id,
            name: r.name,
            relPath: r.rel_path,
            ext: r.ext,
            page: r.page_number,
            snippet: r.snippet.replace(/\s+/g, ' '),
          });
        }
      } catch (err) {
        console.warn('[search]', err.message);
      }
    }
    return results;
  });

  // Flashcards
  handle('cards:list', ({ fileId = null } = {}) =>
    db
      .prepare(
        `SELECT c.*, f.name AS file_name, f.ext AS file_ext FROM flashcards c LEFT JOIN files f ON f.id = c.file_id
         WHERE (@fileId IS NULL OR c.file_id = @fileId) ORDER BY c.created_at DESC`,
      )
      .all({ fileId }),
  );
  handle('cards:due', ({ fileId = null, cram = false } = {}) => {
    const base = `SELECT c.*, f.name AS file_name, f.ext AS file_ext FROM flashcards c LEFT JOIN files f ON f.id = c.file_id`;
    const rows = cram
      ? db
          .prepare(
            `${base} WHERE (@fileId IS NULL OR c.file_id = @fileId)
             ORDER BY (c.lapses + 1.0) / (c.repetitions + 1) DESC, c.ease ASC, RANDOM() LIMIT 100`,
          )
          .all({ fileId })
      : db
          .prepare(
            `${base} WHERE c.due_at <= @now AND (@fileId IS NULL OR c.file_id = @fileId)
             ORDER BY c.lapses DESC, c.due_at ASC LIMIT 100`,
          )
          .all({ fileId, now: now() });
    return rows.map(withPreviews);
  });
  handle('cards:stats', ({ fileId = null } = {}) =>
    db
      .prepare(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN due_at <= @now THEN 1 ELSE 0 END), 0) AS due,
                COALESCE(SUM(CASE WHEN last_reviewed_at IS NULL THEN 1 ELSE 0 END), 0) AS new_count,
                COALESCE(SUM(CASE WHEN interval_days >= 21 THEN 1 ELSE 0 END), 0) AS mature
         FROM flashcards WHERE (@fileId IS NULL OR file_id = @fileId)`,
      )
      .get({ fileId, now: now() }),
  );
  handle('cards:create', (input) => {
    const list = (Array.isArray(input) ? input : [input])
      .map((c) => ({
        file_id: c.fileId ?? null,
        front: String(c.front || '').trim().slice(0, 5000),
        back: String(c.back || '').trim().slice(0, 10000),
        source: ['highlight', 'ai', 'quiz', 'manual'].includes(c.source) ? c.source : 'manual',
        page_number: c.page ?? null,
        due_at: now(),
        created_at: now(),
      }))
      .filter((c) => c.front && c.back);
    if (!list.length) throw new Error('A flashcard needs both a front and a back.');
    const insert = db.prepare(
      `INSERT INTO flashcards (file_id, front, back, source, page_number, due_at, created_at)
       VALUES (@file_id, @front, @back, @source, @page_number, @due_at, @created_at)`,
    );
    return db.transaction(() => list.map((c) => Number(insert.run(c).lastInsertRowid)))();
  });
  handle('cards:update', (id, { front, back }) => {
    front = String(front || '').trim();
    back = String(back || '').trim();
    if (!front || !back) throw new Error('A flashcard needs both a front and a back.');
    db.prepare('UPDATE flashcards SET front = ?, back = ? WHERE id = ?').run(front, back, id);
    return cardRow(id);
  });
  handle('cards:delete', (id) => {
    db.prepare('DELETE FROM flashcards WHERE id = ?').run(id);
    return true;
  });
  handle('cards:review', (id, grade) => {
    const card = cardRow(id);
    if (!card) throw new Error('Card not found.');
    const g = Math.max(0, Math.min(3, Number(grade) | 0));
    const t = now();
    const next = schedule(card, g, t);
    db.transaction(() => {
      db.prepare(
        `UPDATE flashcards SET ease = @ease, interval_days = @interval_days, repetitions = @repetitions,
                lapses = @lapses, due_at = @due_at, last_reviewed_at = @t WHERE id = @id`,
      ).run({ ...next, t, id });
      db.prepare('INSERT INTO reviews (card_id, grade, reviewed_at) VALUES (?, ?, ?)').run(id, g, t);
    })();
    return withPreviews(cardRow(id));
  });

  // AI (Gemini)
  handle('ai:summary', (fileId, opts = {}) => cachedAi('summary', fileId, opts, (f, pages) => aiService.summarize(f.name, pages)));
  handle('ai:quiz', (fileId, opts = {}) => cachedAi('quiz', fileId, opts, (f, pages) => aiService.quiz(f.name, pages)));
  handle('ai:keyTerms', (fileId) => {
    const file = getFile(fileId);
    return aiService.keyTerms(file.name, documentPages(file.id));
  });
  handle('ai:cardFromText', (text) => aiService.cardFromText(String(text || '').slice(0, 4000)));

  // Hidden developer panel (Ctrl+Shift+D): replace the bundled key if it expires.
  handle('dev:aiStatus', () => aiService.status());
  handle('dev:testKey', (key) => aiService.testKey(key));
  handle('dev:setKey', async (key) => {
    const result = await aiService.testKey(key);
    if (result.ok) aiService.setOverrideKey(key);
    return { ...result, status: aiService.status() };
  });
  handle('dev:clearKey', () => {
    aiService.clearOverrideKey();
    return aiService.status();
  });
}

/* ------------------------------------------------------------------- window */

function openExternalSafe(url) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
}

function registerAppProtocol() {
  protocol.handle('app', async (request) => {
    const { pathname } = new URL(request.url);
    let rel = decodeURIComponent(pathname);
    if (!rel || rel === '/') rel = '/index.html';
    const filePath = path.normalize(path.join(DIST_DIR, rel));
    if (!filePath.startsWith(DIST_DIR + path.sep)) return new Response('Forbidden', { status: 403 });
    try {
      const data = await fsp.readFile(filePath);
      return new Response(data, {
        headers: {
          'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
          'Content-Security-Policy': CSP,
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    title: 'StudyVault',
    backgroundColor: '#111113',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Links inside documents open in the system browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = DEV_URL ? url.startsWith(DEV_URL) : url.startsWith(APP_ORIGIN);
    if (!allowed) {
      event.preventDefault();
      openExternalSafe(url);
    }
  });

  if (DEV_URL) mainWindow.loadURL(DEV_URL);
  else mainWindow.loadURL(`${APP_ORIGIN}/index.html`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    ({ schedule } = await import('../shared/srs.mjs'));
    db = openDatabase(path.join(app.getPath('userData'), 'studyvault.db'));
    // Remove settings left over from the OpenAI version.
    db.prepare("DELETE FROM settings WHERE key IN ('openaiApiKey', 'openaiModel')").run();
    registerAppProtocol();
    registerIpc();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    try {
      db?.close();
    } catch {}
  });
}
