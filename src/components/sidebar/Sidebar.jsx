import { useMemo, useState } from 'react';
import { ChevronRight, Folder, FolderOpen, FolderSearch, RefreshCw, TriangleAlert, Filter, FilePlus2 } from 'lucide-react';
import { FileIcon, IconButton, ProgressBar } from '../ui.jsx';
import { formatDuration } from '../../lib/format';

function buildTree(files) {
  const root = { name: '', path: '', folders: new Map(), files: [] };
  for (const f of files) {
    const parts = f.rel_path.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const path = parts.slice(0, i + 1).join('/');
      if (!node.folders.has(parts[i])) node.folders.set(parts[i], { name: parts[i], path, folders: new Map(), files: [] });
      node = node.folders.get(parts[i]);
    }
    node.files.push(f);
  }
  return root;
}

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

function loadCollapsed() {
  try {
    return new Set(JSON.parse(localStorage.getItem('sv.collapsed') || '[]'));
  } catch {
    return new Set();
  }
}

export default function Sidebar({ root, files, activeId, onOpen, scan, onRescan, onChangeFolder, mobile = false, narrow = false }) {
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState(loadCollapsed);

  const tree = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return buildTree(f ? files.filter((x) => x.rel_path.toLowerCase().includes(f)) : files);
  }, [files, filter]);

  const toggle = (path) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      try {
        localStorage.setItem('sv.collapsed', JSON.stringify([...next]));
      } catch {}
      return next;
    });

  const rootName = root.split(/[\\/]/).filter(Boolean).pop() || root;
  const ctx = { activeId, onOpen, collapsed: filter ? new Set() : collapsed, toggle };

  return (
    <aside className={`flex shrink-0 flex-col border-r border-line bg-panel ${narrow ? 'h-full w-full' : 'w-72'}`}>
      <div className="flex items-center gap-1 px-3 pb-2 pt-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-faint">Library</div>
          <div className="truncate text-sm font-medium" title={root}>
            {rootName}
          </div>
        </div>
        {mobile ? (
          <IconButton title="Import files" onClick={onChangeFolder} disabled={scan.running} className="text-accent">
            <FilePlus2 size={17} />
          </IconButton>
        ) : (
          <>
            <IconButton title="Rescan folder" onClick={onRescan} disabled={scan.running}>
              <RefreshCw size={15} className={scan.running ? 'animate-spin' : ''} />
            </IconButton>
            <IconButton title="Change study folder" onClick={onChangeFolder}>
              <FolderSearch size={15} />
            </IconButton>
          </>
        )}
      </div>

      {scan.running && (
        <div className="mx-3 mb-2 rounded-md border border-line bg-bg px-2.5 py-2">
          <div className="flex justify-between text-xs text-muted">
            <span>{scan.phase === 'discovering' ? 'Finding files…' : 'Indexing'}</span>
            {scan.total > 0 && (
              <span className="tabular-nums">
                {scan.done} / {scan.total}
              </span>
            )}
          </div>
          <ProgressBar value={scan.total ? scan.done / scan.total : 0} className="mt-1.5" />
          {scan.current && <div className="mt-1 truncate text-[11px] text-faint">{scan.current}</div>}
        </div>
      )}

      <div className="px-3 pb-2">
        <div className="flex h-7 items-center gap-2 rounded-md border border-line bg-bg px-2 text-xs">
          <Filter size={12} className="text-faint" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter files"
            className="min-w-0 flex-1 bg-transparent text-text placeholder:text-faint focus:outline-none"
          />
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        {files.length === 0 && !scan.running && (
          <div className="px-3 py-8 text-center text-xs leading-5 text-muted">
            {mobile ? 'No files yet. Tap the + button to import PDFs, slides or documents.' : 'No PDF, PPTX, DOCX or TXT files found in this folder.'}
          </div>
        )}
        <Children node={tree} depth={0} ctx={ctx} />
      </nav>

      <div className="border-t border-line px-3 py-2 text-[11px] text-faint">
        {files.length} file{files.length === 1 ? '' : 's'} · {formatDuration(files.reduce((n, f) => n + f.seconds_spent, 0))} studied
      </div>
    </aside>
  );
}

function Children({ node, depth, ctx }) {
  return (
    <>
      {[...node.folders.values()].sort(byName).map((folder) => (
        <FolderNode key={folder.path} node={folder} depth={depth} ctx={ctx} />
      ))}
      {[...node.files].sort(byName).map((file) => (
        <FileRow key={file.id} file={file} depth={depth} ctx={ctx} />
      ))}
    </>
  );
}

function FolderNode({ node, depth, ctx }) {
  const isCollapsed = ctx.collapsed.has(node.path);
  return (
    <div>
      <button
        onClick={() => ctx.toggle(node.path)}
        className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-[13px] text-muted hover:bg-hover hover:text-text"
        style={{ paddingLeft: 6 + depth * 14 }}
      >
        <ChevronRight size={13} className={`shrink-0 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} />
        {isCollapsed ? <Folder size={14} className="shrink-0 text-faint" /> : <FolderOpen size={14} className="shrink-0 text-faint" />}
        <span className="truncate">{node.name}</span>
      </button>
      {!isCollapsed && <Children node={node} depth={depth + 1} ctx={ctx} />}
    </div>
  );
}

function FileRow({ file, depth, ctx }) {
  const active = file.id === ctx.activeId;
  const pct = file.max_scroll_pct || 0;
  return (
    <button
      onClick={() => ctx.onOpen(file.id)}
      title={`${file.rel_path}\nRead: ${Math.round(pct * 100)}% · Time: ${formatDuration(file.seconds_spent)}${
        file.parse_error ? `\n⚠ ${file.parse_error}` : ''
      }`}
      className={`flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-[13px] transition-colors ${
        active ? 'bg-accent/15 text-text' : 'text-muted hover:bg-hover hover:text-text'
      }`}
      style={{ paddingLeft: 6 + depth * 14 + 19 }}
    >
      <FileIcon ext={file.ext} size={14} />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{file.name}</span>
        {pct > 0 && (
          <span className="mt-1 block h-[2px] overflow-hidden rounded-full bg-line">
            <span className="block h-full rounded-full bg-accent/70" style={{ width: `${Math.round(pct * 100)}%` }} />
          </span>
        )}
      </span>
      {file.parse_error && <TriangleAlert size={12} className="shrink-0 text-warning" />}
    </button>
  );
}
