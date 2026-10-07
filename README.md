# StudyVault

A study app for **Windows / macOS / Linux and Android** that turns your PDFs, PowerPoints, Word documents and text files
into an interactive study environment. On desktop, files are **read in place** and never moved or modified; on Android
you import them into the app.

## Download

From the [latest release](https://github.com/Adimah1/StudyVault/releases/latest):

- **Windows (64-bit):** `StudyVault-Setup-<version>.exe`. If Windows shows "Windows protected your PC", click **More info → Run anyway** (the installer isn't code-signed yet).
- **Android 7+:** `StudyVault-<version>.apk`. Open it on your phone and allow "Install unknown apps" for your browser/files app when asked.

## Getting started (developers)

Requirements: **Node.js 20+** (https://nodejs.org).

```bash
npm install        # also rebuilds better-sqlite3 for Electron (postinstall)
npm run dev        # Vite dev server + Electron with hot reload
```

Other scripts:

| Script          | What it does                                         |
| --------------- | ---------------------------------------------------- |
| `npm run build` | Build the renderer into `dist/`                      |
| `npm start`     | Run Electron against the built `dist/`               |
| `npm run dist`  | Build + package an installer into `release/`         |

> `better-sqlite3` is a native module. Prebuilt binaries are downloaded for most platforms; if your platform has none,
> `npm install` compiles it, which needs a C++ toolchain (Windows: "Desktop development with C++" from Visual Studio Build Tools).

## Android app

The same React UI runs on Android through [Capacitor](https://capacitorjs.com). The UI only talks to `window.sv`;
on desktop that's Electron's preload bridge, on mobile it's `src/mobile/backend.js`:

| Concern     | Desktop (Electron)                      | Android (Capacitor)                                  |
| ----------- | --------------------------------------- | ---------------------------------------------------- |
| Files       | Scans a folder, reads files in place    | Files are imported (copied) into the app             |
| Storage     | SQLite (`better-sqlite3`)               | IndexedDB (`src/mobile/idb.js`)                      |
| Search      | SQLite FTS5                             | MiniSearch (`src/mobile/search.js`)                  |
| AI key      | `.env` read by the main process         | `.env` baked into the bundle at build time           |

Shared logic lives in `shared/` (spaced repetition, PPTX/PDF parsing, Gemini prompts/retries) and is used by both.

Requirements: JDK 21 and the Android SDK (platform 36, build-tools 35). Then:

```bash
npm run mobile:dev     # try the mobile UI in a browser (phone-size window)
npm run mobile:apk     # build → android/app/build/outputs/apk/debug/app-debug.apk
```

Phone layout: the library is a drawer (☰), study tools open full screen (🔧), long-press text to select it, then tap
**Flashcard** or **Note**. The hidden developer panel opens by tapping the StudyVault logo 5 times.

## AI (Google Gemini) and the bundled key

Students never enter an API key. Whoever builds the installer supplies one:

1. Get a Gemini API key at https://aistudio.google.com/apikey
2. Copy `.env.example` to `.env` and set `GEMINI_API_KEY=...` (optionally `GEMINI_MODEL`, default `gemini-3.8-flash`).
3. `npm run dist`. A `predist` check refuses to package while the key is missing or still the placeholder.
   `electron-builder` copies `.env` into the app's `resources/` folder (`extraResources`), where the main process loads it with `dotenv`.

`.env` is git-ignored; only `.env.example` is committed.

**Replacing an expired key without rebuilding:** press **Ctrl+Shift+D** (Cmd+Shift+D on macOS) to open the hidden developer
panel. Paste a new key; it is tested with a real request, then saved (encrypted with `safeStorage`) through `electron-store`
in the user's app-data folder. It overrides the bundled key until removed.

Students only see friendly messages:
- No key / invalid key / model unavailable → "AI features are currently unavailable. Please contact the app provider."
- HTTP 429, daily quota → "You've hit the daily free limit. Please try again tomorrow." (per-minute 429s get a "wait a minute" message)
- Network failure or Gemini 5xx → a short "try again" message. Technical details go to the main-process log only.

> **Security note:** a key shipped inside an app can be extracted by anyone who installs it. `resources/.env` is a plain
> text file. Restrict the key in Google Cloud Console (API restriction: *Generative Language API* only), keep it on a
> project without billing (or set a budget cap), and rotate it via the developer panel if it leaks. For a large
> audience, put a small proxy server between the app and Gemini instead of shipping the key.
> On the free tier, Google may use submitted content to improve its products; students' documents are sent to Gemini
> when they use AI features.

## Features

- **Library** – pick a root folder; it is scanned recursively for `.pdf .pptx .docx .txt`. Text is extracted once and
  cached in SQLite; rescans only re-parse files whose size/mtime changed. Files that disappear are flagged, not deleted,
  so notes and cards survive a temporary move.
- **Study mode** – three columns: file tree · document viewer · study tools.
  - PDFs render as real pages with `react-pdf` (lazy-rendered, zoom, optional "dim pages" for night reading).
  - DOCX renders as clean HTML (`mammoth`); PPTX renders as slide cards with bullets, tables and speaker notes.
- **Notes** – TipTap rich-text editor, auto-saved per file.
- **Summary / Quiz** – AI summary (cached) and a 5-question multiple-choice quiz; missed questions can become flashcards.
  "Extract key terms" turns AI-picked terms into cards.
- **Highlight & extract** – select text in any document → *Add to Flashcards* or *Add to Notes* (quoted with page number).
- **Flashcards** – review view with spaced repetition (simplified SM-2). *Again* brings a card back a few cards later in the
  same session and in one minute; cards with lapses get shorter intervals and are queued first.
- **Global search** (`Ctrl/Cmd + K`) – SQLite FTS5 across every page of every file, with highlighted snippets; results
  jump to the exact PDF page / slide and highlight the matches.
- **Progress** – active time per file (only counted while the window is focused and you're not idle) and a
  "% read" bar based on the furthest point scrolled; documents reopen where you left off.

## Project structure

```
electron/
  main.js          App lifecycle, window, app:// protocol, all IPC handlers (file system, DB, AI)
  preload.js       contextBridge API exposed to the renderer as window.sv
  db.js            Opens SQLite (better-sqlite3), applies schema.sql
  schema.sql       Database schema
  scanner.js       Recursive folder scan + incremental indexing
  services/aiService.js  Desktop key handling (.env / developer override) on top of shared/ai-core.mjs
  parsers/         pdf, docx (mammoth), pptx, txt (pdf/pptx delegate to shared/)
shared/            Used by desktop and Android
  srs.mjs          Spaced-repetition scheduler
  ai-core.mjs      Gemini prompts, retries, model fallback, friendly errors
  pptx.mjs         PowerPoint parser (JSZip + OOXML)
  pdf-text.mjs     Per-page PDF text extraction (pdf.js)
src/
  App.jsx          Layout + top-level state (three columns on desktop, drawer + sheets on phones)
  mobile/          Android backend: backend.js (window.sv), idb.js, search.js, parsers.js
  components/
    TopBar.jsx, SearchBox.jsx, Home.jsx, Welcome.jsx, SettingsModal.jsx, ui.jsx
    sidebar/Sidebar.jsx            File tree
    viewer/DocumentViewer.jsx      Toolbar, progress, time tracking, highlight popup
    viewer/PdfViewer.jsx           react-pdf renderer
    viewer/HtmlViewer.jsx          DOCX / PPTX / TXT renderer
    tools/ToolsPanel.jsx           Notes · Summary · Quiz tabs
    flashcards/ReviewView.jsx      Spaced-repetition review
    flashcards/CardManager.jsx     Browse / edit / add cards
```

## Database schema (summary)

| Table        | Purpose                                                              |
| ------------ | -------------------------------------------------------------------- |
| `files`      | Absolute path, relative path, type, size/mtime, page count, status   |
| `pages`      | Extracted text per page/slide (+ `pages_fts` FTS5 index via triggers)|
| `file_html`  | Rendered HTML cache for DOCX/PPTX                                    |
| `notes`      | Rich-text note (HTML) per file                                       |
| `flashcards` | Front/back, source, page, SRS state (ease, interval, reps, lapses, due) |
| `reviews`    | Review log                                                           |
| `progress`   | Seconds spent, max scroll %, resume position, last opened            |
| `ai_cache`   | Cached AI summary / quiz per file                                    |
| `settings`   | Root folder, theme, model, encrypted API key                         |

The database lives in Electron's `userData` folder (e.g. `%APPDATA%/StudyVault/studyvault.db` on Windows).

## Notes on choices

- **PDF text extraction** uses `pdfjs-dist` (the same engine as the viewer). `pdf-parse` was tried first, but it bundles
  a 2017 pdf.js that rejected ordinary modern PDFs ("bad XRef entry").
- **better-sqlite3 is pinned to 12.11.1**: it is the newest release with prebuilt binaries for both Electron 33 and
  Node 24, so no C++ compiler is needed. 13.x currently ships none.
- **PPTX parsing** uses JSZip and reads the slide XML directly instead of the `pptx-parser` npm package, which is
  unmaintained and doesn't expose slide order or speaker notes reliably.
- The renderer is sandboxed (`contextIsolation`, no Node integration). It reaches files only by library id through IPC,
  never by raw path, and the Gemini key never leaves the main process.
- **Gemini SDK**: uses `@google/genai`. The older `@google/generative-ai` reached end of support in Nov 2025, and
  `gemini-1.5-flash` was shut down in Sept 2025.
- **electron-store is pinned to v8**: v9+ is ESM-only, while the main process is CommonJS.
- Scanned (image-only) PDFs still display, but have no text for search/AI. OCR is a natural next step.
