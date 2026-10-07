export function formatDuration(seconds = 0) {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export function formatInterval(ms) {
  const min = ms / 60000;
  if (min < 60) return `${Math.max(1, Math.round(min))}m`;
  const h = min / 60;
  if (h < 24) return `${Math.round(h)}h`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)}d`;
  if (d < 365) return `${Math.round(d / 30)}mo`;
  return `${(d / 365).toFixed(1)}y`;
}

export function pageLabel(ext, page) {
  if (!page) return null;
  if (ext === 'pptx') return `Slide ${page}`;
  if (ext === 'pdf') return `p. ${page}`;
  return null;
}

/** Words from a search query, lower-cased (mirrors the FTS tokenizer in main). */
export function searchTerms(q) {
  return (String(q || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((t) => t.length >= 2).slice(0, 8);
}

export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function termsRegExp(terms) {
  return terms.length ? new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi') : null;
}
