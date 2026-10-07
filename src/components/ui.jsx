import { useEffect } from 'react';
import { FileText, File, Presentation, Loader2, X } from 'lucide-react';

export function Button({ variant = 'subtle', size = 'md', className = '', ...props }) {
  const variants = {
    primary: 'bg-accent text-white hover:bg-accent/90',
    subtle: 'border border-line bg-elevated text-text hover:bg-hover',
    ghost: 'text-muted hover:bg-hover hover:text-text',
    danger: 'text-danger hover:bg-danger/10',
  };
  const sizes = { sm: 'h-7 px-2.5 text-xs', md: 'h-9 px-3.5 text-sm' };
  return (
    <button
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    />
  );
}

export function IconButton({ title, active = false, className = '', ...props }) {
  return (
    <button
      title={title}
      aria-label={title}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-40 ${
        active ? 'bg-hover text-text' : 'text-muted hover:bg-hover hover:text-text'
      } ${className}`}
      {...props}
    />
  );
}

export function Spinner({ size = 16, className = '' }) {
  return <Loader2 size={size} className={`animate-spin ${className}`} />;
}

export function ProgressBar({ value = 0, className = '' }) {
  return (
    <div className={`h-1 overflow-hidden rounded-full bg-line ${className}`}>
      <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

const FILE_ICONS = {
  pdf: { Icon: FileText, color: 'text-rose-400' },
  docx: { Icon: FileText, color: 'text-sky-400' },
  pptx: { Icon: Presentation, color: 'text-amber-400' },
  txt: { Icon: File, color: 'text-muted' },
};

export function FileIcon({ ext, size = 15, className = '' }) {
  const { Icon, color } = FILE_ICONS[ext] || FILE_ICONS.txt;
  return <Icon size={size} className={`shrink-0 ${color} ${className}`} />;
}

export function Modal({ title, onClose, children, width = 'max-w-lg' }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div
        className={`sv-pop w-full ${width} rounded-xl border border-line bg-elevated shadow-2xl`}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <IconButton title="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export const inputClass =
  'w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-text placeholder:text-faint focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/20';
