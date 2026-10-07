import { useState } from 'react';
import { FolderSearch } from 'lucide-react';
import { sv, errorMessage } from '../lib/api';
import { Button, Modal } from './ui.jsx';

export default function SettingsModal({ settings, onClose, onSaved, onChangeFolder }) {
  const [theme, setTheme] = useState(settings.theme || 'dark');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      onSaved(await sv.settings.set({ theme }));
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="space-y-6">
        <section>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-faint">Study folder</div>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1 truncate rounded-md border border-line bg-bg px-3 py-2 text-sm text-muted" title={settings.rootFolder}>
              {settings.rootFolder}
            </div>
            <Button onClick={onChangeFolder}>
              <FolderSearch size={14} /> Change
            </Button>
          </div>
        </section>

        <section>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-faint">Appearance</div>
          <div className="flex gap-2">
            {['dark', 'light'].map((t) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className={`h-9 flex-1 rounded-md border text-sm capitalize ${theme === t ? 'border-accent bg-accent/10 text-text' : 'border-line text-muted hover:bg-hover'}`}
              >
                {t}
              </button>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-faint">AI features</div>
          <p className={`text-sm ${settings.aiAvailable ? 'text-muted' : 'text-danger'}`}>
            {settings.aiAvailable
              ? 'Summaries, quizzes and AI flashcards are ready to use.'
              : 'AI features are currently unavailable. Please contact the app provider.'}
          </p>
        </section>

        {error && <div className="text-sm text-danger">{error}</div>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
