import { useEffect } from 'react';
import { NotebookPen, Sparkles, ListChecks, ArrowLeft } from 'lucide-react';
import NotesTab from './NotesTab.jsx';
import SummaryTab from './SummaryTab.jsx';
import QuizTab from './QuizTab.jsx';

const TABS = [
  { id: 'notes', label: 'Notes', Icon: NotebookPen },
  { id: 'summary', label: 'Summary', Icon: Sparkles },
  { id: 'quiz', label: 'Quiz', Icon: ListChecks },
];

export default function ToolsPanel({ file, tab, onTab, aiAvailable, onCardsChanged, onClose = null }) {
  useEffect(() => {
    const onAppend = (e) => e.detail.fileId === file.id && onTab('notes');
    window.addEventListener('sv:append-note', onAppend);
    return () => window.removeEventListener('sv:append-note', onAppend);
  }, [file.id, onTab]);

  const shared = { file, aiAvailable, onCardsChanged };

  return (
    // onClose is set in phone layout, where the panel covers the document full-screen.
    <aside className={`flex shrink-0 flex-col border-l border-line bg-panel ${onClose ? 'w-full' : 'w-[380px]'}`}>
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-2">
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Back to document"
            className="mr-1 flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted hover:bg-hover hover:text-text"
          >
            <ArrowLeft size={15} /> Document
          </button>
        )}
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
