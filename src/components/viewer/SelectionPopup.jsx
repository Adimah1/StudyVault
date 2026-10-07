import { Layers, NotebookPen } from 'lucide-react';

export default function SelectionPopup({ selection, onCard, onNote }) {
  const above = selection.top > 90;
  const style = {
    left: Math.max(120, Math.min(window.innerWidth - 120, selection.x)),
    top: above ? selection.top - 8 : selection.bottom + 8,
    transform: `translate(-50%, ${above ? '-100%' : '0'})`,
  };
  const btn = 'flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-text hover:bg-hover';

  return (
    <div
      style={style}
      // Keep the text selection alive while clicking the buttons.
      onMouseDown={(e) => e.preventDefault()}
      className="sv-pop fixed z-50 flex items-center gap-0.5 rounded-lg border border-line bg-elevated p-1 shadow-2xl"
    >
      <button className={btn} onClick={onCard}>
        <Layers size={14} className="text-accent" /> Add to Flashcards
      </button>
      <div className="h-4 w-px bg-line" />
      <button className={btn} onClick={onNote}>
        <NotebookPen size={14} className="text-accent" /> Add to Notes
      </button>
    </div>
  );
}
