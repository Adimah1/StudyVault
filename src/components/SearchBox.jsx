import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { sv } from '../lib/api';
import { pageLabel } from '../lib/format';
import { FileIcon, Spinner } from './ui.jsx';

/** Renders an FTS snippet whose matches are wrapped in \u0001 … \u0002 (never raw HTML). */
function Snippet({ text }) {
  const parts = text.split(/(\u0001[\s\S]*?\u0002)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('\u0001') ? (
          <mark key={i} className="rounded-sm bg-warning/30 px-px text-text">
            {p.slice(1, -1)}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export default function SearchBox({ onSelect, compact = false }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Ctrl/Cmd+K focuses search from anywhere.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    const t = setTimeout(async () => {
      const r = await sv.search.query(query);
      if (!alive) return;
      setResults(r);
      setActive(0);
      setLoading(false);
    }, 180);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (r) => {
    onSelect(r.fileId, { page: r.page, term: r.type === 'text' ? q.trim() : null });
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter' && results[active]) {
      choose(results[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  const showDropdown = open && q.trim().length >= 2;

  return (
    <div className="relative w-full max-w-xl">
      <div className="flex h-8 items-center gap-2 rounded-lg border border-line bg-bg px-2.5 text-sm focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/15">
        <Search size={14} className="shrink-0 text-faint" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          placeholder={compact ? 'Search…' : 'Search all study materials…'}
          enterKeyHint="search"
          className="min-w-0 flex-1 bg-transparent text-text placeholder:text-faint focus:outline-none"
        />
        {loading ? <Spinner size={13} className="text-faint" /> : !compact && <kbd>Ctrl K</kbd>}
      </div>

      {showDropdown && (
        <div
          ref={listRef}
          onMouseDown={(e) => e.preventDefault()}
          className={`sv-pop z-40 max-h-[60vh] overflow-y-auto rounded-xl border border-line bg-elevated p-1.5 shadow-2xl ${
            compact ? 'fixed left-2 right-2 top-[calc(3.25rem+var(--sv-safe-top,0px))]' : 'absolute left-0 right-0 top-10'
          }`}
        >
          {!loading && results.length === 0 && <div className="px-3 py-6 text-center text-sm text-muted">No matches for “{q.trim()}”</div>}
          {results.map((r, i) => (
            <button
              key={`${r.type}-${r.fileId}-${r.page}-${i}`}
              data-idx={i}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(r)}
              className={`flex w-full gap-2.5 rounded-lg px-2.5 py-2 text-left ${i === active ? 'bg-hover' : ''}`}
            >
              <FileIcon ext={r.ext} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-sm font-medium">{r.name}</span>
                  {pageLabel(r.ext, r.page) && <span className="shrink-0 text-xs text-accent">{pageLabel(r.ext, r.page)}</span>}
                  {r.type === 'file' && <span className="shrink-0 text-xs text-faint">file name</span>}
                </div>
                {r.snippet ? (
                  <div className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted">
                    <Snippet text={r.snippet} />
                  </div>
                ) : (
                  <div className="truncate text-xs text-faint">{r.relPath}</div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
