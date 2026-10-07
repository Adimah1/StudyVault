import { useRef } from 'react';
import { PanelLeft, PanelRight, Settings, Sun, Moon, BookOpen, Layers, Menu, Wrench } from 'lucide-react';
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
  onSecretTap,
  narrow,
}) {
  // 5 quick taps on the logo open the hidden developer panel (phones have no Ctrl+Shift+D).
  const taps = useRef([]);
  const onLogoTap = () => {
    const t = Date.now();
    taps.current = [...taps.current.filter((x) => t - x < 2000), t];
    if (taps.current.length >= 5) {
      taps.current = [];
      onSecretTap?.();
    }
  };

  const tab = (id, label, Icon, badge) => (
    <button
      onClick={() => onView(id)}
      aria-label={label}
      className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
        view === id ? 'bg-hover text-text shadow-sm' : 'text-muted hover:text-text'
      }`}
    >
      <Icon size={14} />
      {!narrow && label}
      {badge > 0 && <span className="rounded-full bg-accent px-1.5 text-[10px] leading-4 text-white">{badge}</span>}
    </button>
  );

  return (
    <header className="flex h-12 shrink-0 items-center gap-1.5 border-b border-line bg-panel px-2 sm:gap-2 sm:px-3">
      <IconButton title="Toggle file tree" active={showSidebar} onClick={onToggleSidebar}>
        {narrow ? <Menu size={18} /> : <PanelLeft size={17} />}
      </IconButton>
      <div className="flex select-none items-center gap-2 pr-1 text-sm font-semibold tracking-tight sm:pr-2" onClick={onLogoTap}>
        <span className="grid h-6 w-6 place-items-center rounded-md bg-accent/15 text-accent">
          <BookOpen size={14} />
        </span>
        {!narrow && 'StudyVault'}
      </div>
      <div className="flex items-center gap-0.5 rounded-lg border border-line bg-bg p-0.5">
        {tab('study', 'Study', BookOpen)}
        {tab('review', 'Review', Layers, dueCount)}
      </div>

      <div className="flex min-w-0 flex-1 justify-center sm:px-4">
        <SearchBox onSelect={onSearchSelect} compact={narrow} />
      </div>

      {!narrow && (
        <IconButton title={theme === 'light' ? 'Dark mode' : 'Light mode'} onClick={onToggleTheme}>
          {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
        </IconButton>
      )}
      {!narrow && (
        <IconButton title="Settings" onClick={onOpenSettings}>
          <Settings size={16} />
        </IconButton>
      )}
      {narrow ? (
        onToggleTools ? (
          <IconButton title="Study tools" active={showTools} onClick={onToggleTools}>
            <Wrench size={16} />
          </IconButton>
        ) : (
          <IconButton title="Settings" onClick={onOpenSettings}>
            <Settings size={16} />
          </IconButton>
        )
      ) : (
        <IconButton
          title="Toggle study tools"
          active={showTools && !!onToggleTools}
          disabled={!onToggleTools}
          onClick={onToggleTools || undefined}
        >
          <PanelRight size={17} />
        </IconButton>
      )}
    </header>
  );
}
