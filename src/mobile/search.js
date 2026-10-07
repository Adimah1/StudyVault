// Full-text search for the mobile build (MiniSearch in place of SQLite FTS5).
// Results use the same snippet format as desktop: matches wrapped in \u0001 … \u0002.
import MiniSearch from 'minisearch';

const docId = (fileId, page) => `${fileId}:${page}`;
const words = (q) => (String(q).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).slice(0, 8);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function createSearchIndex() {
  const index = new MiniSearch({
    fields: ['text'],
    storeFields: ['fileId', 'page'],
    searchOptions: { prefix: true, fuzzy: 0.15, combineWith: 'AND' },
  });
  const texts = new Map(); // docId -> page text (for snippets)
  const byFile = new Map(); // fileId -> docIds

  function addFile(fileId, pages) {
    removeFile(fileId);
    const ids = [];
    pages.forEach((text, i) => {
      const id = docId(fileId, i + 1);
      if (!text.trim()) return;
      index.add({ id, fileId, page: i + 1, text });
      texts.set(id, text);
      ids.push(id);
    });
    byFile.set(fileId, ids);
  }

  function removeFile(fileId) {
    for (const id of byFile.get(fileId) || []) {
      index.discard(id);
      texts.delete(id);
    }
    byFile.delete(fileId);
  }

  function snippet(text, terms) {
    const flat = text.replace(/\s+/g, ' ');
    const re = new RegExp(`(?<![\\p{L}\\p{N}])(${terms.map(escapeRe).join('|')})[\\p{L}\\p{N}]*`, 'giu');
    const first = re.exec(flat);
    const at = first ? first.index : 0;
    const start = Math.max(0, at - 70);
    const end = Math.min(flat.length, at + 110);
    const cut = flat.slice(start, end).replace(re, (m) => `\u0001${m}\u0002`);
    return (start > 0 ? '…' : '') + cut + (end < flat.length ? '…' : '');
  }

  function search(query, limit = 40) {
    const terms = words(query);
    if (!terms.length) return [];
    return index
      .search(terms.join(' '))
      .slice(0, limit)
      .map((r) => ({ fileId: r.fileId, page: r.page, snippet: snippet(texts.get(r.id) || '', terms) }));
  }

  return { addFile, removeFile, search };
}
