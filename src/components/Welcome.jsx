import { BookOpen, FolderOpen, Search, Layers, Sparkles } from 'lucide-react';
import { Button } from './ui.jsx';

export default function Welcome({ onChoose }) {
  const points = [
    [FolderOpen, 'Your files stay where they are — StudyVault reads them in place.'],
    [Search, 'Instant full-text search across every PDF, slide deck and document.'],
    [Layers, 'Highlight passages to build flashcards with spaced repetition.'],
    [Sparkles, 'AI summaries, quizzes and flashcards, built in.'],
  ];
  return (
    <div className="grid h-full place-items-center bg-bg px-6">
      <div className="w-full max-w-md">
        <div className="mb-6 grid h-11 w-11 place-items-center rounded-xl bg-accent/15 text-accent">
          <BookOpen size={22} />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome to StudyVault</h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          Pick the folder where you keep your course materials. Every PDF, PowerPoint, Word document and text file inside it
          (including subfolders) becomes part of your study library.
        </p>
        <ul className="mt-6 space-y-3">
          {points.map(([Icon, text]) => (
            <li key={text} className="flex gap-3 text-sm text-muted">
              <Icon size={16} className="mt-0.5 shrink-0 text-faint" />
              {text}
            </li>
          ))}
        </ul>
        <Button variant="primary" className="mt-8 w-full" onClick={onChoose}>
          <FolderOpen size={16} /> Choose study folder
        </Button>
      </div>
    </div>
  );
}
