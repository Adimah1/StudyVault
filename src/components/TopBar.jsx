import { PanelLeft, PanelRight, Settings, Sun, Moon, BookOpen, Layers } from 'lucide-react';
import { IconButton } from './ui.jsx';
import SearchBox from './SearchBox.jsx';

export default function TopBar({
  view,
  onView,
  dueCount,
  onSearchSelect,
  showSidebar,
  onToggleSidebar,
  showTools,
  onToggleTools,
  theme,
  onToggleTheme,
  onOpenSettings,
}) {
  const tab = (id, label, Icon, badge) => (
    <button
      onClick={() => onView(id)}
      className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
        view === id ? 'bg-hover text-text shadow-sm' : 'text-muted hover:text-text'
      }`}
    >
      <Icon size={14} />
      {label}
      {badge > 0 && <span className="rounded-full bg-accent px-1.5 text-[10px] leading-4 text-white">{badge}</span>}
    </button>
  );

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-panel px-3">
      <IconButton title="Toggle file tree" active={showSidebar} onClick={onToggleSidebar}>
        <PanelLeft size={17} />
      </IconButton>
      <div className="flex select-none items-center gap-2 pr-2 text-sm font-semibold tracking-tight">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-accent/15 text-accent">
          <BookOpen size={14} />
        </span>
        StudyVault
      </div>
      <div className="flex items-center gap-0.5 rounded-lg border border-line bg-bg p-0.5">
        {tab('study', 'Study', BookOpen)}
        {tab('review', 'Review', Layers, dueCount)}
      </div>

      <div className="flex flex-1 justify-center px-4">
        <SearchBox onSelect={onSearchSelect} />
      </div>

      <IconButton title={theme === 'light' ? 'Dark mode' : 'Light mode'} onClick={onToggleTheme}>
        {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
      </IconButton>
      <IconButton title="Settings" onClick={onOpenSettings}>
        <Settings size={16} />
      </IconButton>
      <IconButton title="Toggle study tools" active={showTools && !!onToggleTools} disabled={!onToggleTools} onClick={onToggleTools || undefined}>
        <PanelRight size={17} />
      </IconButton>
    </header>
  );
}
