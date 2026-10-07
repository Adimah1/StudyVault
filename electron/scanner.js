'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { parseFile, SUPPORTED_EXTENSIONS } = require('./parsers');

const SKIP_DIRS = new Set(['node_modules', '$RECYCLE.BIN', 'System Volume Information']);

function toRel(root, full) {
  return path.relative(root, full).split(path.sep).join('/');
}

async function walk(dir, out) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return; // unreadable folder: skip it, keep scanning the rest
  }
  for (const entry of entries) {
    // Hidden files/folders and Office lock files ("~$Lecture.docx")
    if (entry.name.startsWith('.') || entry.name.startsWith('~$') || SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, out);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).slice(1).toLowerCase();
      if (SUPPORTED_EXTENSIONS.has(ext)) out.push(full);
    }
  }
}

const statementCache = new WeakMap();
function statements(db) {
  let s = statementCache.get(db);
  if (s) return s;
  s = {
    getByPath: db.prepare('SELECT id, size, mtime_ms, indexed_at FROM files WHERE path = ?'),
    touch: db.prepare('UPDATE files SET root = ?, rel_path = ?, missing = 0 WHERE id = ?'),
    upsert: db.prepare(`
      INSERT INTO files (root, path, rel_path, name, ext, size, mtime_ms, page_count, char_count, indexed_at, parse_error, missing)
      VALUES (@root, @path, @rel_path, @name, @ext, @size, @mtime_ms, @page_count, @char_count, @indexed_at, @parse_error, 0)
      ON CONFLICT(path) DO UPDATE SET
        root = excluded.root, rel_path = excluded.rel_path, name = excluded.name, ext = excluded.ext,
        size = excluded.size, mtime_ms = excluded.mtime_ms, page_count = excluded.page_count,
        char_count = excluded.char_count, indexed_at = excluded.indexed_at,
        parse_error = excluded.parse_error, missing = 0
      RETURNING id`),
    deletePages: db.prepare('DELETE FROM pages WHERE file_id = ?'),
    insertPage: db.prepare('INSERT INTO pages (file_id, page_number, content) VALUES (?, ?, ?)'),
    upsertHtml: db.prepare('INSERT INTO file_html (file_id, html) VALUES (?, ?) ON CONFLICT(file_id) DO UPDATE SET html = excluded.html'),
    deleteHtml: db.prepare('DELETE FROM file_html WHERE file_id = ?'),
    clearAi: db.prepare('DELETE FROM ai_cache WHERE file_id = ?'),
    activeInRoot: db.prepare('SELECT id, path FROM files WHERE root = ? AND missing = 0'),
    markMissing: db.prepare('UPDATE files SET missing = 1 WHERE id = ?'),
  };
  statementCache.set(db, s);
  return s;
}

/** Parse one file and (re)write its cached text/HTML. Returns the file id. */
async function indexFile(db, root, fullPath, stat) {
  const st = stat || (await fsp.stat(fullPath));
  const ext = path.extname(fullPath).slice(1).toLowerCase();

  let parsed = { pages: [], html: null };
  let parseError = null;
  try {
    parsed = await parseFile(fullPath, ext);
  } catch (err) {
    parseError = (err && err.message) || String(err);
  }
  const pages = (parsed.pages || []).map((p) => String(p || '').replace(/\u0000/g, ''));

  const s = statements(db);
  const row = {
    root,
    path: fullPath,
    rel_path: toRel(root, fullPath),
    name: path.basename(fullPath),
    ext,
    size: st.size,
    mtime_ms: Math.floor(st.mtimeMs),
    page_count: pages.length,
    char_count: pages.reduce((n, p) => n + p.trim().length, 0),
    indexed_at: Date.now(),
    parse_error: parseError,
  };

  return db.transaction(() => {
    const { id } = s.upsert.get(row);
    s.deletePages.run(id);
    pages.forEach((content, i) => s.insertPage.run(id, i + 1, content));
    if (parsed.html) s.upsertHtml.run(id, parsed.html);
    else s.deleteHtml.run(id);
    s.clearAi.run(id); // content changed, cached summary/quiz is stale
    return id;
  })();
}

/**
 * Recursively scan `root`, (re)index new or modified files and flag files that
 * disappeared. Unchanged files (same size + mtime) are skipped, so rescans are fast.
 */
async function scanLibrary(db, root, onProgress = () => {}) {
  if (!fs.existsSync(root)) {
    throw new Error(`Study folder not found: ${root}`);
  }
  const s = statements(db);
  const found = [];
  onProgress({ phase: 'discovering', done: 0, total: 0, current: '' });
  await walk(root, found);

  const summary = { total: found.length, indexed: 0, skipped: 0, removed: 0, errors: 0 };
  for (let i = 0; i < found.length; i++) {
    const full = found[i];
    const rel = toRel(root, full);
    onProgress({ phase: 'indexing', done: i, total: found.length, current: rel });
    try {
      const st = await fsp.stat(full);
      const existing = s.getByPath.get(full);
      if (existing && existing.indexed_at && existing.size === st.size && existing.mtime_ms === Math.floor(st.mtimeMs)) {
        s.touch.run(root, rel, existing.id);
        summary.skipped++;
        continue;
      }
      await indexFile(db, root, full, st);
      summary.indexed++;
    } catch (err) {
      summary.errors++;
      console.error(`[scan] ${full}:`, err);
    }
    // Yield so IPC (and the UI) stays responsive during large scans.
    await new Promise((resolve) => setImmediate(resolve));
  }

  const seen = new Set(found);
  for (const row of s.activeInRoot.all(root)) {
    if (!seen.has(row.path)) {
      s.markMissing.run(row.id);
      summary.removed++;
    }
  }
  onProgress({ phase: 'done', done: found.length, total: found.length, current: '' });
  return summary;
}

module.exports = { scanLibrary, indexFile };
