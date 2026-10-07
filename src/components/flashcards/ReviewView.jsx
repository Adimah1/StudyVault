import { useCallback, useEffect, useState } from 'react';
import { Layers, PartyPopper, Repeat, FileText } from 'lucide-react';
import { sv } from '../../lib/api';
import { formatInterval, pageLabel } from '../../lib/format';
import { Button, Spinner } from '../ui.jsx';
import CardManager from './CardManager.jsx';

const GRADES = [
  { label: 'Again', key: '1', cls: 'border-danger/40 text-danger hover:bg-danger/10' },
  { label: 'Hard', key: '2', cls: 'border-warning/40 text-warning hover:bg-warning/10' },
  { label: 'Good', key: '3', cls: 'border-success/40 text-success hover:bg-success/10' },
  { label: 'Easy', key: '4', cls: 'border-accent/40 text-accent hover:bg-accent/10' },
];

function Segmented({ value, onChange, options }) {
  return (
    <div className="flex gap-0.5 rounded-lg border border-line bg-panel p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={`h-7 rounded-md px-3 text-xs font-medium disabled:opacity-40 ${value === o.value ? 'bg-hover text-text' : 'text-muted hover:text-text'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function ReviewView({ activeFile, onOpenFile, onChanged, narrow = false }) {
  const [scope, setScope] = useState(activeFile ? 'file' : 'all');
  const [mode, setMode] = useState('review');
  const fileId = scope === 'file' && activeFile ? activeFile.id : null;

  const [queue, setQueue] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [stats, setStats] = useState(null);
  const [cram, setCram] = useState(false);
  const [session, setSession] = useState({ reviewed: 0, correct: 0 });
  const [busy, setBusy] = useState(false);

  const refreshStats = useCallback(() => sv.cards.stats({ fileId }).then(setStats), [fileId]);

  const load = useCallback(
    async (cramMode) => {
      setCram(cramMode);
      setRevealed(false);
      setQueue(null);
      setQueue(await sv.cards.due({ fileId, cram: cramMode }));
      refreshStats();
    },
    [fileId, refreshStats],
  );

  useEffect(() => {
    if (mode !== 'review') return;
    setSession({ reviewed: 0, correct: 0 });
    load(false);
  }, [mode, load]);

  const current = queue?.[0];

  const grade = useCallback(
    async (g) => {
      if (!current || busy) return;
      setBusy(true);
      try {
        const updated = await sv.cards.review(current.id, g);
        setQueue((q) => {
          const rest = q.slice(1);
          if (g !== 0) return rest;
          // Missed cards come back a few cards later in this session.
          const at = Math.min(3, rest.length);
          return [...rest.slice(0, at), updated, ...rest.slice(at)];
        });
        setSession((s) => ({ reviewed: s.reviewed + 1, correct: s.correct + (g > 0 ? 1 : 0) }));
        setRevealed(false);
        refreshStats();
        onChanged();
      } finally {
        setBusy(false);
      }
    },
    [current, busy, refreshStats, onChanged],
  );

  useEffect(() => {
    if (mode !== 'review' || !current) return;
    const onKey = (e) => {
      if (e.target instanceof Element && e.target.closest('input, textarea, [contenteditable="true"]')) return;
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault();
        grade(Number(e.key) - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, current, revealed, grade]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={`flex h-11 shrink-0 items-center border-b border-line ${narrow ? 'gap-2 px-2' : 'gap-3 px-4'}`}>
        {!narrow && <Layers size={16} className="text-accent" />}
        {!narrow && <span className="text-sm font-medium">Flashcards</span>}
        <Segmented
          value={scope}
          onChange={setScope}
          options={[
            { value: 'all', label: narrow ? 'All' : 'All cards' },
            { value: 'file', label: narrow ? 'This doc' : 'This document', disabled: !activeFile },
          ]}
        />
        <div className="flex-1" />
        {stats && !narrow && (
          <div className="flex gap-4 text-xs text-muted">
            <span>
              <b className="text-text">{stats.due}</b> due
            </span>
            <span>
              <b className="text-text">{stats.new_count}</b> new
            </span>
            <span>
              <b className="text-text">{stats.mature}</b> mature
            </span>
            <span>
              <b className="text-text">{stats.total}</b> total
            </span>
          </div>
        )}
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'review', label: 'Review' },
            { value: 'manage', label: 'Manage' },
          ]}
        />
      </div>

      {mode === 'manage' ? (
        <CardManager fileId={fileId} onChanged={onChanged} onOpenFile={onOpenFile} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-5 sm:px-6 sm:py-10">
          {queue === null ? (
            <div className="grid place-items-center py-20 text-muted">
              <Spinner size={20} />
            </div>
          ) : !current ? (
            <EmptyState stats={stats} session={session} cram={cram} onCram={() => load(true)} />
          ) : (
            <div className="mx-auto w-full max-w-2xl">
              <div className="mb-3 flex justify-between text-xs text-faint">
                <span>
                  {queue.length} card{queue.length === 1 ? '' : 's'} left{cram ? ' · cram mode' : ''}
                </span>
                {session.reviewed > 0 && (
                  <span>
                    {session.correct}/{session.reviewed} recalled this session
                  </span>
                )}
              </div>

              <div className="flex min-h-[260px] flex-col rounded-2xl border border-line bg-panel p-5 shadow-sm sm:min-h-[300px] sm:p-8">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-faint">Question</div>
                <div className="mt-3 whitespace-pre-wrap text-lg leading-relaxed sm:text-xl">{current.front}</div>
                {revealed && (
                  <>
                    <div className="my-6 h-px bg-line" />
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-faint">Answer</div>
                    <div className="mt-3 whitespace-pre-wrap text-[15px] leading-7 text-text/90">{current.back}</div>
                  </>
                )}
                <div className="mt-auto flex items-center justify-between pt-8 text-xs text-faint">
                  {current.file_id && current.file_name ? (
                    <button
                      onClick={() => onOpenFile(current.file_id, { page: current.page_number })}
                      className="flex min-w-0 items-center gap-1.5 hover:text-text"
                    >
                      <FileText size={12} />
                      <span className="truncate">{current.file_name}</span>
                      {pageLabel(current.file_ext, current.page_number) && <span>· {pageLabel(current.file_ext, current.page_number)}</span>}
                    </button>
                  ) : (
                    <span />
                  )}
                  {current.lapses > 0 && (
                    <span className="flex items-center gap-1" title="Times forgotten — shown more often">
                      <Repeat size={12} /> missed {current.lapses}×
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-5">
                {!revealed ? (
                  <Button variant="primary" className="h-11 w-full" onClick={() => setRevealed(true)}>
                    Show answer <kbd className="ml-2 border-white/30 bg-white/10 text-white">Space</kbd>
                  </Button>
                ) : (
                  <div className="grid grid-cols-4 gap-2">
                    {GRADES.map((g, i) => (
                      <button
                        key={g.label}
                        disabled={busy}
                        onClick={() => grade(i)}
                        className={`flex h-14 flex-col items-center justify-center rounded-lg border bg-panel text-sm font-medium transition-colors disabled:opacity-50 ${g.cls}`}
                      >
                        {g.label}
                        <span className="text-[11px] font-normal text-faint">
                          {formatInterval(current.previews[i])} · {g.key}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyState({ stats, session, cram, onCram }) {
  if (stats && stats.total === 0) {
    return (
      <div className="mx-auto max-w-md text-center">
        <Layers size={28} className="mx-auto text-faint" />
        <h2 className="mt-4 text-lg font-semibold">No flashcards yet</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Highlight any passage in a document and choose <b>Add to Flashcards</b>, extract key terms from the Summary tab, or add
          missed quiz questions. You can also write cards by hand under <b>Manage</b>.
        </p>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-md text-center">
      <PartyPopper size={28} className="mx-auto text-accent" />
      <h2 className="mt-4 text-lg font-semibold">{cram ? 'Cram session complete' : 'All caught up'}</h2>
      <p className="mt-2 text-sm text-muted">
        {session.reviewed > 0
          ? `You reviewed ${session.reviewed} card${session.reviewed === 1 ? '' : 's'} and recalled ${session.correct}.`
          : 'Nothing is due right now. Cards you got wrong will come back sooner.'}
      </p>
      <Button className="mt-6" onClick={onCram}>
        <Repeat size={14} /> Review anyway (weakest first)
      </Button>
    </div>
  );
}
