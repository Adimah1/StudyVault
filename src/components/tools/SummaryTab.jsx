import { useEffect, useMemo, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Sparkles, RotateCcw, Layers, Check } from 'lucide-react';
import { sv, errorMessage } from '../../lib/api';
import { useToast } from '../../lib/toast.jsx';
import { Button, Spinner } from '../ui.jsx';
import AiUnavailable from './AiUnavailable.jsx';

export default function SummaryTab({ file, aiAvailable, onCardsChanged }) {
  const toast = useToast();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [terms, setTerms] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [termsLoading, setTermsLoading] = useState(false);

  useEffect(() => {
    sv.ai
      .summary(file.id, { cachedOnly: true })
      .then(setSummary)
      .catch(() => {});
  }, [file.id]);

  const generate = async (force) => {
    setLoading(true);
    setError(null);
    try {
      setSummary(await sv.ai.summary(file.id, { force }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const extractTerms = async () => {
    setTermsLoading(true);
    setError(null);
    try {
      const cards = await sv.ai.keyTerms(file.id);
      setTerms(cards);
      setSelected(new Set(cards.map((_, i) => i)));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setTermsLoading(false);
    }
  };

  const addTerms = async () => {
    const cards = terms.filter((_, i) => selected.has(i)).map((c) => ({ ...c, fileId: file.id, source: 'ai' }));
    if (!cards.length) return;
    await sv.cards.create(cards);
    toast(`Added ${cards.length} flashcard${cards.length === 1 ? '' : 's'}`);
    setTerms(null);
    onCardsChanged();
  };

  const html = useMemo(() => (summary ? DOMPurify.sanitize(marked.parse(summary.value || '')) : ''), [summary]);

  return (
    <div className="h-full overflow-y-auto p-4">
      {!aiAvailable && !summary ? (
        <AiUnavailable />
      ) : (
        <>
          <div className="flex items-center gap-2">
            {!summary ? (
              <Button variant="primary" onClick={() => generate(false)} disabled={loading || !aiAvailable} className="flex-1">
                {loading ? <Spinner size={14} /> : <Sparkles size={14} />} {loading ? 'Summarizing…' : 'Generate summary'}
              </Button>
            ) : (
              <>
                <span className="flex-1 text-xs text-faint">
                  {summary.model} · {new Date(summary.created_at).toLocaleDateString()}
                </span>
                <Button size="sm" variant="ghost" onClick={() => generate(true)} disabled={loading || !aiAvailable}>
                  {loading ? <Spinner size={13} /> : <RotateCcw size={13} />} Regenerate
                </Button>
              </>
            )}
          </div>

          {error && <div className="mt-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>}

          {summary && <div className="sv-prose prose prose-sm mt-4 max-w-none" dangerouslySetInnerHTML={{ __html: html }} />}

          {aiAvailable && (
            <div className="mt-6 border-t border-line pt-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-faint">Key terms → Flashcards</div>
              <p className="mt-1 text-xs leading-5 text-muted">Let AI pick the essential terms from this document and turn them into cards.</p>
              {!terms ? (
                <Button size="sm" className="mt-3" onClick={extractTerms} disabled={termsLoading}>
                  {termsLoading ? <Spinner size={13} /> : <Layers size={13} />} {termsLoading ? 'Extracting…' : 'Extract key terms'}
                </Button>
              ) : (
                <div className="mt-3 space-y-1.5">
                  {terms.map((c, i) => {
                    const on = selected.has(i);
                    return (
                      <button
                        key={i}
                        onClick={() =>
                          setSelected((s) => {
                            const n = new Set(s);
                            on ? n.delete(i) : n.add(i);
                            return n;
                          })
                        }
                        className={`flex w-full gap-2.5 rounded-lg border p-2.5 text-left ${on ? 'border-accent/40 bg-accent/5' : 'border-line opacity-60'}`}
                      >
                        <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border ${on ? 'border-accent bg-accent text-white' : 'border-line'}`}>
                          {on && <Check size={11} />}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{c.front}</span>
                          <span className="block text-xs leading-5 text-muted">{c.back}</span>
                        </span>
                      </button>
                    );
                  })}
                  <div className="flex gap-2 pt-2">
                    <Button size="sm" variant="primary" onClick={addTerms} disabled={!selected.size}>
                      Add {selected.size} card{selected.size === 1 ? '' : 's'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setTerms(null)}>
                      Discard
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
