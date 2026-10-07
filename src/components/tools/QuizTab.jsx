import { useEffect, useState } from 'react';
import { ListChecks, RotateCcw, Check, X, Layers } from 'lucide-react';
import { sv, errorMessage } from '../../lib/api';
import { useToast } from '../../lib/toast.jsx';
import { Button, Spinner } from '../ui.jsx';
import AiUnavailable from './AiUnavailable.jsx';

const LETTERS = ['A', 'B', 'C', 'D'];

export default function QuizTab({ file, aiAvailable, onCardsChanged }) {
  const toast = useToast();
  const [quiz, setQuiz] = useState(null);
  const [answers, setAnswers] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [savedMissed, setSavedMissed] = useState(false);

  useEffect(() => {
    sv.ai
      .quiz(file.id, { cachedOnly: true })
      .then(setQuiz)
      .catch(() => {});
  }, [file.id]);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      setQuiz(await sv.ai.quiz(file.id, { force: true }));
      setAnswers({});
      setSavedMissed(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const questions = quiz?.value?.questions || [];
  const answered = Object.keys(answers).length;
  const score = questions.filter((q, i) => answers[i] === q.answerIndex).length;
  const done = questions.length > 0 && answered === questions.length;
  const missed = questions.filter((q, i) => done && answers[i] !== q.answerIndex);

  const saveMissed = async () => {
    await sv.cards.create(
      missed.map((q) => ({
        fileId: file.id,
        front: q.question,
        back: `${q.options[q.answerIndex]}${q.explanation ? `\n\n${q.explanation}` : ''}`,
        source: 'quiz',
      })),
    );
    setSavedMissed(true);
    toast(`Added ${missed.length} card${missed.length === 1 ? '' : 's'} for review`);
    onCardsChanged();
  };

  if (!aiAvailable && !quiz) {
    return (
      <div className="p-4">
        <AiUnavailable />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      {questions.length === 0 ? (
        <Button variant="primary" className="w-full" onClick={generate} disabled={loading}>
          {loading ? <Spinner size={14} /> : <ListChecks size={14} />} {loading ? 'Writing questions…' : 'Generate 5-question quiz'}
        </Button>
      ) : (
        <div className="flex items-center justify-between">
          <span className="text-xs text-faint">
            {answered}/{questions.length} answered
          </span>
          <Button size="sm" variant="ghost" onClick={generate} disabled={loading || !aiAvailable}>
            {loading ? <Spinner size={13} /> : <RotateCcw size={13} />} New quiz
          </Button>
        </div>
      )}

      {error && <div className="mt-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>}

      <ol className="mt-4 space-y-5">
        {questions.map((q, qi) => {
          const chosen = answers[qi];
          const locked = chosen !== undefined;
          return (
            <li key={qi}>
              <div className="text-sm font-medium leading-6">
                <span className="mr-1.5 text-faint">{qi + 1}.</span>
                {q.question}
              </div>
              <div className="mt-2 space-y-1.5">
                {q.options.map((opt, oi) => {
                  const correct = oi === q.answerIndex;
                  let cls = 'border-line hover:bg-hover';
                  if (locked && correct) cls = 'border-success/50 bg-success/10';
                  else if (locked && oi === chosen) cls = 'border-danger/50 bg-danger/10';
                  else if (locked) cls = 'border-line opacity-60';
                  return (
                    <button
                      key={oi}
                      disabled={locked}
                      onClick={() => setAnswers((a) => ({ ...a, [qi]: oi }))}
                      className={`flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${cls}`}
                    >
                      <span className="mt-px w-4 shrink-0 text-xs font-semibold text-faint">{LETTERS[oi]}</span>
                      <span className="flex-1 leading-5">{opt}</span>
                      {locked && correct && <Check size={15} className="mt-0.5 shrink-0 text-success" />}
                      {locked && !correct && oi === chosen && <X size={15} className="mt-0.5 shrink-0 text-danger" />}
                    </button>
                  );
                })}
              </div>
              {locked && q.explanation && <p className="mt-2 text-xs leading-5 text-muted">{q.explanation}</p>}
            </li>
          );
        })}
      </ol>

      {done && (
        <div className="mt-6 rounded-xl border border-line bg-bg p-4">
          <div className="text-2xl font-semibold tabular-nums">
            {score} / {questions.length}
          </div>
          <div className="text-xs text-muted">
            {score === questions.length ? 'Perfect — nicely done.' : 'Review the ones you missed while they’re fresh.'}
          </div>
          {missed.length > 0 && (
            <Button size="sm" className="mt-3" onClick={saveMissed} disabled={savedMissed}>
              <Layers size={13} /> {savedMissed ? 'Added to flashcards' : `Add ${missed.length} missed to flashcards`}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
