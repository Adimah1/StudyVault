import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sv, errorMessage, isMobile } from './lib/api';
import { useToast } from './lib/toast.jsx';
import { useIsNarrow } from './lib/useMediaQuery';
import { Spinner } from './components/ui.jsx';
import TopBar from './components/TopBar.jsx';
import Sidebar from './components/sidebar/Sidebar.jsx';
import Welcome from './components/Welcome.jsx';
import Home from './components/Home.jsx';
import DocumentViewer from './components/viewer/DocumentViewer.jsx';
import ToolsPanel from './components/tools/ToolsPanel.jsx';
import ReviewView from './components/flashcards/ReviewView.jsx';
import FlashcardModal from './components/flashcards/FlashcardModal.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import DevPanel from './components/DevPanel.jsx';

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
}

export default function App() {
  const toast = useToast();
  const narrow = useIsNarrow(); // phone layout: drawer + full-screen tools
  const mobile = isMobile(); // running on the in-app (Capacitor/browser) backend
  const [settings, setSettings] = useState(null);
  const [files, setFiles] = useState([]);
  const [scan, setScan] = useState({ running: false });
  const [view, setView] = useState('study'); // 'study' | 'review'
  const [activeId, setActiveId] = useState(null);
  const [jump, setJump] = useState(null); // { fileId, page, term, nonce }
  const [showSidebar, setShowSidebar] = useState(() => !window.matchMedia('(max-width: 767px)').matches);
  const [showTools, setShowTools] = useState(() => !window.matchMedia('(max-width: 767px)').matches);
  const [toolsTab, setToolsTab] = useState('notes');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  const [cardDraft, setCardDraft] = useState(null);
  const [dueCount, setDueCount] = useState(0);

  const activeFile = useMemo(() => files.find((f) => f.id === activeId) || null, [files, activeId]);

  const refreshFiles = useCallback(async () => setFiles(await sv.library.list()), []);
  const refreshDue = useCallback(async () => setDueCount((await sv.cards.stats({})).due), []);

  const startScan = useCallback(() => {
    sv.library.scan().then((res) => {
      if (res && !res.ok && res.error) toast(res.error, 'error');
    });
  }, [toast]);

  // Boot: show the cached library instantly, then rescan in the background.
  useEffect(() => {
    (async () => {
      const s = await sv.settings.get();
      applyTheme(s.theme);
      setSettings(s);
      if (s.rootFolder) {
        await refreshFiles();
        startScan();
      }
      refreshDue();
    })();
  }, [refreshFiles, refreshDue, startScan]);

  useEffect(
    () =>
      sv.library.onScanProgress((p) => {
        setScan(p);
        if (!p.running) refreshFiles();
        else if (p.phase === 'indexing' && p.done > 0 && p.done % 25 === 0) refreshFiles();
      }),
    [refreshFiles],
  );

  // Re-check AI availability when the window regains focus (e.g. after a key is added to .env).
  useEffect(() => {
    const onFocus = () =>
      sv.settings.get().then((s) => setSettings((prev) => (prev && prev.aiAvailable !== s.aiAvailable ? { ...prev, aiAvailable: s.aiAvailable } : prev)));
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // Hidden developer panel for the app provider (not linked in the UI).
  // Desktop: Ctrl+Shift+D. Phone: tap the StudyVault logo 5 times quickly.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setDevOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Refresh the due badge periodically (cards become due over time).
  useEffect(() => {
    const t = setInterval(refreshDue, 60000);
    return () => clearInterval(t);
  }, [refreshDue]);

  // Leaving phone layout (e.g. window resized) restores the side columns.
  useEffect(() => {
    if (!narrow) {
      setShowSidebar(true);
      setShowTools(true);
    }
  }, [narrow]);

  const chooseFolder = async () => {
    const root = await sv.library.chooseFolder();
    if (!root) return;
    setSettings((s) => ({ ...s, rootFolder: root }));
    if (!mobile) {
      // Desktop: a different root folder is a different library.
      setActiveId(null);
      setFiles([]);
    }
    startScan();
  };

  const openFile = useCallback(
    (fileId, { page = null, term = null } = {}) => {
      setActiveId(fileId);
      setView('study');
      setJump({ fileId, page, term, nonce: Date.now() });
      if (narrow) {
        setShowSidebar(false);
        setShowTools(false);
      }
    },
    [narrow],
  );

  const removeFile = useCallback(
    async (fileId) => {
      if (!window.confirm('Remove this file from your library? Its notes are deleted; flashcards are kept.')) return;
      await sv.file.remove(fileId);
      setActiveId(null);
      await refreshFiles();
      toast('File removed');
    },
    [refreshFiles, toast],
  );

  const toggleTheme = async () => {
    const theme = settings.theme === 'light' ? 'dark' : 'light';
    applyTheme(theme);
    setSettings(await sv.settings.set({ theme }));
  };

  const onTimeTick = useCallback((fileId, seconds) => {
    setFiles((list) => list.map((f) => (f.id === fileId ? { ...f, seconds_spent: f.seconds_spent + seconds } : f)));
  }, []);

  const onReadProgress = useCallback((fileId, pct) => {
    setFiles((list) => list.map((f) => (f.id === fileId && pct > f.max_scroll_pct ? { ...f, max_scroll_pct: pct } : f)));
  }, []);

  const onAddNote = useCallback(
    ({ text, page }) => {
      setShowTools(true);
      setToolsTab('notes');
      window.dispatchEvent(new CustomEvent('sv:append-note', { detail: { fileId: activeId, text, page } }));
    },
    [activeId],
  );

  const onAddCard = useCallback(({ text, page }) => setCardDraft({ fileId: activeId, front: '', back: text, page }), [activeId]);

  const onCardsChanged = useCallback(() => {
    refreshDue();
    refreshFiles();
  }, [refreshDue, refreshFiles]);

  // Android back button: close the top-most layer first, then go home, then exit.
  const backState = useRef({});
  backState.current = { devOpen, settingsOpen, cardDraft, narrow, showSidebar, showTools, view, activeId };
  useEffect(() => {
    if (!mobile) return;
    let handle;
    import('@capacitor/app')
      .then(({ App: CapApp }) =>
        CapApp.addListener('backButton', () => {
          const s = backState.current;
          if (s.devOpen) setDevOpen(false);
          else if (s.cardDraft) setCardDraft(null);
          else if (s.settingsOpen) setSettingsOpen(false);
          else if (s.narrow && s.showSidebar) setShowSidebar(false);
          else if (s.narrow && s.showTools && s.activeId) setShowTools(false);
          else if (s.view === 'review') setView('study');
          else if (s.activeId) setActiveId(null);
          else CapApp.exitApp();
        }),
      )
      .then((h) => (handle = h))
      .catch(() => {}); // not running inside Capacitor (e.g. browser preview)
    return () => handle?.remove();
  }, [mobile]);

  if (!settings) {
    return (
      <div className="grid h-full place-items-center text-muted">
        <Spinner size={20} />
      </div>
    );
  }

  if (!settings.rootFolder) return <Welcome onChoose={chooseFolder} mobile={mobile} />;

  const sidebar = (
    <Sidebar
      root={settings.rootFolder}
      files={files}
      activeId={view === 'study' ? activeId : null}
      onOpen={(id) => openFile(id)}
      scan={scan}
      onRescan={startScan}
      onChangeFolder={chooseFolder}
      mobile={mobile}
      narrow={narrow}
    />
  );

  return (
    <div className="flex h-full flex-col">
      <TopBar
        view={view}
        onView={(v) => {
          setView(v);
          if (narrow) setShowSidebar(false);
        }}
        dueCount={dueCount}
        onSearchSelect={openFile}
        showSidebar={showSidebar}
        onToggleSidebar={() => setShowSidebar((v) => !v)}
        showTools={showTools}
        onToggleTools={view === 'study' && activeFile ? () => setShowTools((v) => !v) : null}
        theme={settings.theme}
        onToggleTheme={toggleTheme}
        onOpenSettings={() => setSettingsOpen(true)}
        onSecretTap={() => setDevOpen(true)}
        narrow={narrow}
      />

      <div className="relative flex min-h-0 flex-1">
        {showSidebar &&
          (narrow ? (
            <div className="absolute inset-0 z-30 flex">
              <div className="h-full w-[85%] max-w-xs shadow-2xl">{sidebar}</div>
              <button aria-label="Close library" className="flex-1 bg-black/50" onClick={() => setShowSidebar(false)} />
            </div>
          ) : (
            sidebar
          ))}

        <main className="flex min-w-0 flex-1 flex-col bg-bg">
          {view === 'review' ? (
            <ReviewView activeFile={activeFile} onOpenFile={openFile} onChanged={onCardsChanged} narrow={narrow} />
          ) : activeFile ? (
            <DocumentViewer
              key={activeFile.id}
              file={activeFile}
              jump={jump}
              onTimeTick={onTimeTick}
              onReadProgress={onReadProgress}
              onAddCard={onAddCard}
              onAddNote={onAddNote}
              onRemove={mobile ? () => removeFile(activeFile.id) : null}
              narrow={narrow}
            />
          ) : (
            <Home
              files={files}
              dueCount={dueCount}
              onOpen={openFile}
              onReview={() => setView('review')}
              onImport={mobile ? chooseFolder : null}
            />
          )}
        </main>

        {/* Kept mounted while hidden so "Add to Notes" always reaches the editor. */}
        {view === 'study' && activeFile && (
          <div className={showTools ? (narrow ? 'absolute inset-0 z-20 flex' : 'flex') : 'hidden'}>
            <ToolsPanel
              key={activeFile.id}
              file={activeFile}
              tab={toolsTab}
              onTab={setToolsTab}
              aiAvailable={settings.aiAvailable}
              onCardsChanged={onCardsChanged}
              onClose={narrow ? () => setShowTools(false) : null}
            />
          </div>
        )}
      </div>

      {cardDraft && (
        <FlashcardModal
          draft={cardDraft}
          aiAvailable={settings.aiAvailable}
          onClose={() => setCardDraft(null)}
          onSaved={() => {
            setCardDraft(null);
            toast('Flashcard added');
            onCardsChanged();
          }}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          settings={settings}
          mobile={mobile}
          onClose={() => setSettingsOpen(false)}
          onSaved={(s) => {
            setSettings(s);
            applyTheme(s.theme);
          }}
          onChangeFolder={() => {
            setSettingsOpen(false);
            chooseFolder().catch((e) => toast(errorMessage(e), 'error'));
          }}
        />
      )}

      {devOpen && <DevPanel onClose={() => setDevOpen(false)} onChanged={() => sv.settings.get().then(setSettings)} />}
    </div>
  );
}
