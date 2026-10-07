import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { sv, errorMessage } from '../../lib/api';
import { Button, Modal, Spinner, inputClass } from '../ui.jsx';

export default function FlashcardModal({ draft, aiAvailable, onClose, onSaved }) {
  const [front, setFront] = useState(draft.front || '');
  const [back, setBack] = useState(draft.back || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const suggest = async () => {
    setBusy(true);
    setError(null);
    try {
      const card = await sv.ai.cardFromText(back);
      setFront(card.front);
      // Long highlights are condensed; short ones are kept verbatim.
      if (back.length > 280) setBack(card.back);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!front.trim() || !back.trim()) return setError('Both sides need some text.');
    try {
      await sv.cards.create({ fileId: draft.fileId, front, back, page: draft.page, source: 'highlight' });
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const onKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') save();
  };

  return (
    <Modal title="New flashcard" onClose={onClose}>
      <div className="space-y-4" onKeyDown={onKeyDown}>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-sm">Front — question or prompt</label>
            {aiAvailable && (
              <button onClick={suggest} disabled={busy} className="flex items-center gap-1 text-xs text-accent hover:underline disabled:opacity-50">
                {busy ? <Spinner size={12} /> : <Sparkles size={12} />} Suggest with AI
              </button>
            )}
          </div>
          <textarea
            autoFocus
            rows={2}
            value={front}
            onChange={(e) => setFront(e.target.value)}
            placeholder="e.g. What is the role of the mitochondria?"
            className={`${inputClass} resize-none`}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm">Back — answer</label>
          <textarea rows={6} value={back} onChange={(e) => setBack(e.target.value)} className={`${inputClass} resize-y`} />
          {draft.page && <div className="mt-1 text-xs text-faint">Linked to page {draft.page}</div>}
        </div>
        {error && <div className="text-sm text-danger">{error}</div>}
        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto text-xs text-faint">
            <kbd>Ctrl</kbd> + <kbd>Enter</kbd> to save
          </span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            Add card
          </Button>
        </div>
      </div>
    </Modal>
  );
}
