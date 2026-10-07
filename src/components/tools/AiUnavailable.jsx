import { CloudOff } from 'lucide-react';

/** Shown to students when no working AI key is bundled. Never asks them for a key. */
export default function AiUnavailable() {
  return (
    <div className="rounded-xl border border-line bg-bg p-4 text-sm">
      <div className="flex items-center gap-2 font-medium">
        <CloudOff size={15} className="text-faint" /> AI unavailable
      </div>
      <p className="mt-1.5 leading-6 text-muted">AI features are currently unavailable. Please contact the app provider.</p>
    </div>
  );
}
