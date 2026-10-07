import { Clock, Files, Layers, BookOpenCheck } from 'lucide-react';
import { Button, FileIcon, ProgressBar } from './ui.jsx';
import { formatDuration } from '../lib/format';

export default function Home({ files, dueCount, onOpen, onReview }) {
  const totalSeconds = files.reduce((n, f) => n + f.seconds_spent, 0);
  const started = files.filter((f) => f.max_scroll_pct > 0).length;
  const completed = files.filter((f) => f.max_scroll_pct >= 0.98).length;
  const recent = files
    .filter((f) => f.last_opened_at)
    .sort((a, b) => b.last_opened_at - a.last_opened_at)
    .slice(0, 6);

  const stats = [
    [Files, 'Files', files.length],
    [Clock, 'Time studied', formatDuration(totalSeconds)],
    [BookOpenCheck, 'Started / finished', `${started} / ${completed}`],
    [Layers, 'Cards due', dueCount],
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-8 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">Ready to study?</h1>
        <p className="mt-1 text-sm text-muted">Pick a file from the library, search with Ctrl K, or review your flashcards.</p>

        <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
          {stats.map(([Icon, label, value]) => (
            <div key={label} className="rounded-xl border border-line bg-panel p-4">
              <Icon size={15} className="text-faint" />
              <div className="mt-3 text-xl font-semibold tabular-nums">{value}</div>
              <div className="text-xs text-muted">{label}</div>
            </div>
          ))}
        </div>

        {dueCount > 0 && (
          <div className="mt-4 flex items-center justify-between rounded-xl border border-accent/30 bg-accent/10 px-4 py-3">
            <span className="text-sm">
              You have <b>{dueCount}</b> flashcard{dueCount === 1 ? '' : 's'} due for review.
            </span>
            <Button variant="primary" size="sm" onClick={onReview}>
              Start review
            </Button>
          </div>
        )}

        {recent.length > 0 && (
          <>
            <h2 className="mb-3 mt-10 text-xs font-semibold uppercase tracking-wider text-faint">Continue where you left off</h2>
            <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
              {recent.map((f) => (
                <button key={f.id} onClick={() => onOpen(f.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-hover">
                  <FileIcon ext={f.ext} size={16} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{f.name}</div>
                    <div className="truncate text-xs text-faint">{f.rel_path}</div>
                  </div>
                  <div className="w-28 shrink-0">
                    <ProgressBar value={f.max_scroll_pct} />
                    <div className="mt-1 text-right text-[11px] text-faint">
                      {Math.round(f.max_scroll_pct * 100)}% · {formatDuration(f.seconds_spent)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
