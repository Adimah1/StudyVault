import { useEffect, useState } from 'react';
import { Wrench } from 'lucide-react';
import { sv, errorMessage } from '../lib/api';
import { Button, Modal, Spinner, inputClass } from './ui.jsx';

const SOURCE_LABEL = {
  override: 'Developer override (saved on this computer)',
  bundled: 'Bundled .env file',
  none: 'No key configured',
};

/**
 * Developer-only panel (Ctrl+Shift+D). Lets whoever distributes the app replace an
 * expired bundled key without rebuilding. Not linked anywhere in the student UI.
 */
export default function DevPanel({ onClose, onChanged }) {
  const [status, setStatus] = useState(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    sv.dev.aiStatus().then(setStatus);
  }, []);

  const run = async (fn) => {
    setBusy(true);
    setResult(null);
    try {
      await fn();
    } catch (e) {
      setResult({ ok: false, message: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      const r = await sv.dev.setKey(key);
      setResult(r);
      setStatus(r.status);
      if (r.ok) {
        setKey('');
        onChanged();
      }
    });

  const test = () => run(async () => setResult(await sv.dev.testKey(key)));

  const clear = () =>
    run(async () => {
      setStatus(await sv.dev.clearKey());
      setResult({ ok: true, message: 'Override removed. The bundled .env key is used again.' });
      onChanged();
    });

  return (
    <Modal title="Developer settings" onClose={onClose}>
      <div className="space-y-5 text-sm">
        <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <Wrench size={13} className="mt-0.5 shrink-0" />
          For the app provider only. Students don’t need to change anything here.
        </div>

        {status ? (
          <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 text-xs">
            <dt className="text-faint">AI status</dt>
            <dd className={status.available ? 'text-success' : 'text-danger'}>{status.available ? 'Key configured' : 'Unavailable'}</dd>
            <dt className="text-faint">Key source</dt>
            <dd>
              {SOURCE_LABEL[status.source]} {status.keyHint && <span className="text-faint">({status.keyHint})</span>}
            </dd>
            <dt className="text-faint">Model</dt>
            <dd>{status.model}</dd>
            <dt className="text-faint">.env path</dt>
            <dd className="break-all text-muted">{status.envFile}</dd>
          </dl>
        ) : (
          <Spinner />
        )}

        <div>
          <label className="mb-1 block">Override Gemini API key</label>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Paste a new key (leave empty to test the current one)"
            className={inputClass}
            autoComplete="off"
          />
          <p className="mt-1.5 text-xs text-faint">The key is verified with a test request before it’s saved (encrypted) on this computer.</p>
        </div>

        {result && (
          <pre
            className={`max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border px-3 py-2 font-sans text-xs [overflow-wrap:anywhere] ${
              result.ok ? 'border-success/30 bg-success/10 text-success' : 'border-danger/30 bg-danger/10 text-danger'
            }`}
          >
            {result.message}
          </pre>
        )}

        <div className="flex items-center gap-2">
          {status?.source === 'override' && (
            <Button variant="danger" onClick={clear} disabled={busy}>
              Remove override
            </Button>
          )}
          <div className="flex-1" />
          <Button onClick={test} disabled={busy}>
            {busy && <Spinner size={13} />} Test
          </Button>
          <Button variant="primary" onClick={save} disabled={busy || !key.trim()}>
            Save key
          </Button>
        </div>
      </div>
    </Modal>
  );
}
