import { Layers, NotebookPen } from 'lucide-react';

const isTouch = () => window.matchMedia('(pointer: coarse)').matches;

export default function SelectionPopup({ selection, onCard, onNote }) {
  const touch = isTouch();
  const narrow = window.innerWidth < 480;
  // Phones show their own copy/share bar above the selection, so we go below it there.
  const fitsBelow = selection.bottom + 64 < window.innerHeight;
  const above = touch ? !fitsBelow : selection.top > 90;
  // Keep the whole popup on screen (half its approximate width from either edge).
  const half = narrow ? 100 : 140;
  const style = {
    left: Math.max(half + 8, Math.min(window.innerWidth - half - 8, selection.x)),
    top: above ? selection.top - 8 : selection.bottom + (touch ? 14 : 8),
    transform: `translate(-50%, ${above ? '-100%' : '0'})`,
  };
  const btn = `flex items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-text hover:bg-hover ${touch ? 'h-10' : 'h-8'}`;

  return (
    <div
      style={style}
      // Keep the text selection alive while clicking the buttons.
      onMouseDown={(e) => e.preventDefault()}
      className="sv-pop fixed z-50 flex items-center gap-0.5 whitespace-nowrap rounded-lg border border-line bg-elevated p-1 shadow-2xl"
    >
      <button className={btn} onClick={onCard}>
        <Layers size={14} className="text-accent" /> {narrow ? 'Flashcard' : 'Add to Flashcards'}
      </button>
      <div className="h-4 w-px bg-line" />
      <button className={btn} onClick={onNote}>
        <NotebookPen size={14} className="text-accent" /> {narrow ? 'Note' : 'Add to Notes'}
      </button>
    </div>
  );
}
