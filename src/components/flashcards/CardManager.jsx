import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Search } from 'lucide-react';
import { sv, errorMessage } from '../../lib/api';
import { useToast } from '../../lib/toast.jsx';
import { formatInterval, pageLabel } from '../../lib/format';
import { Button, IconButton, inputClass } from '../ui.jsx';

function dueLabel(dueAt) {
  const ms = dueAt - Date.now();
  return ms <= 0 ? 'due now' : `due in ${formatInterval(ms)}`;
}

export default function CardManager({ fileId, onChanged, onOpenFile }) {
  const toast = useToast();
  const [cards, setCards] = useState([]);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null); // card id | 'new'
  const [draft, setDraft] = useState({ front: '', back: '' });

  const load = () => sv.cards.list({ fileId }).then(setCards);
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? cards.filter((c) => `${c.front} ${c.back}`.toLowerCase().includes(s)) : cards;
  }, [cards, q]);

  const startEdit = (card) => {
    setEditing(card ? card.id : 'new');
    setDraft(card ? { front: card.front, back: card.back } : { front: '', back: '' });
  };

  const save = async () => {
    try {
      if (editing === 'new') await sv.cards.create({ fileId, front: draft.front, back: draft.back, source: 'manual' });
      else await sv.cards.update(editing, draft);
      setEditing(null);
      await load();
      onChanged();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const remove = async (card) => {
    if (!window.confirm('Delete this flashcard?')) return;
    await sv.cards.delete(card.id);
    await load();
    onChanged();
  };

  const editor = (
    <div className="space-y-2 rounded-xl border border-accent/40 bg-panel p-3">
      <textarea
        autoFocus
        rows={2}
        value={draft.front}
        onChange={(e) => setDraft((d) => ({ ...d, front: e.target.value }))}
        placeholder="Front (question)"
        className={`${inputClass} resize-none`}
      />
      <textarea
        rows={3}
        value={draft.back}
        onChange={(e) => setDraft((d) => ({ ...d, back: e.target.value }))}
        placeholder="Back (answer)"
        className={`${inputClass} resize-y`}
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" onClick={save}>
          Save
        </Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-6">
        <div className="flex items-center gap-2">
          <div className="flex h-9 flex-1 items-center gap-2 rounded-md border border-line bg-bg px-3 text-sm">
            <Search size={14} className="text-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${cards.length} cards`}
              className="min-w-0 flex-1 bg-transparent placeholder:text-faint focus:outline-none"
            />
          </div>
          <Button variant="primary" onClick={() => startEdit(null)}>
            <Plus size={14} /> New card
          </Button>
        </div>

        <div className="mt-4 space-y-2">
          {editing === 'new' && editor}
          {filtered.map((c) =>
            editing === c.id ? (
              <div key={c.id}>{editor}</div>
            ) : (
              <div key={c.id} className="group rounded-xl border border-line bg-panel p-3.5">
                <div className="flex gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="whitespace-pre-wrap text-sm font-medium">{c.front}</div>
                    <div className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-muted">{c.back}</div>
                  </div>
                  <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <IconButton title="Edit" onClick={() => startEdit(c)}>
                      <Pencil size={14} />
                    </IconButton>
                    <IconButton title="Delete" onClick={() => remove(c)}>
                      <Trash2 size={14} />
                    </IconButton>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 text-[11px] text-faint">
                  <span>{dueLabel(c.due_at)}</span>
                  <span>{c.source}</span>
                  {c.lapses > 0 && <span>missed {c.lapses}×</span>}
                  {c.file_name && (
                    <button className="truncate hover:text-text" onClick={() => onOpenFile(c.file_id, { page: c.page_number })}>
                      {c.file_name}
                      {pageLabel(c.file_ext, c.page_number) ? ` · ${pageLabel(c.file_ext, c.page_number)}` : ''}
                    </button>
                  )}
                </div>
              </div>
            ),
          )}
          {filtered.length === 0 && editing !== 'new' && <div className="py-16 text-center text-sm text-muted">No cards here yet.</div>}
        </div>
      </div>
    </div>
  );
}
