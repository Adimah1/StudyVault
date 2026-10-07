import { useEffect } from 'react';
import { NotebookPen, Sparkles, ListChecks } from 'lucide-react';
import NotesTab from './NotesTab.jsx';
import SummaryTab from './SummaryTab.jsx';
import QuizTab from './QuizTab.jsx';

const TABS = [
  { id: 'notes', label: 'Notes', Icon: NotebookPen },
  { id: 'summary', label: 'Summary', Icon: Sparkles },
  { id: 'quiz', label: 'Quiz', Icon: ListChecks },
];

export default function ToolsPanel({ file, tab, onTab, aiAvailable, onCardsChanged }) {
  useEffect(() => {
    const onAppend = (e) => e.detail.fileId === file.id && onTab('notes');
    window.addEventListener('sv:append-note', onAppend);
    return () => window.removeEventListener('sv:append-note', onAppend);
  }, [file.id, onTab]);

  const shared = { file, aiAvailable, onCardsChanged };

  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-l border-line bg-panel">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-2">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => onTab(id)}
            className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors ${
              tab === id ? 'bg-hover text-text' : 'text-muted hover:text-text'
            }`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>
      {/* All tabs stay mounted so the editor and generated content survive tab switches. */}
      <div className="relative min-h-0 flex-1">
        <div className={tab === 'notes' ? 'h-full' : 'hidden'}>
          <NotesTab fileId={file.id} />
        </div>
        <div className={tab === 'summary' ? 'h-full' : 'hidden'}>
          <SummaryTab {...shared} />
        </div>
        <div className={tab === 'quiz' ? 'h-full' : 'hidden'}>
          <QuizTab {...shared} />
        </div>
      </div>
    </aside>
  );
}
