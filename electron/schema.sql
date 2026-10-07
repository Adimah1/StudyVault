-- StudyVault SQLite schema. Executed on every startup; all statements are idempotent.

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- One row per study file found under a root folder. Files are read in place;
-- `path` is the absolute path on disk. Rows are never deleted when a file
-- disappears (so notes/flashcards survive a temporary move); they are flagged `missing`.
CREATE TABLE IF NOT EXISTS files (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  root        TEXT    NOT NULL,
  path        TEXT    NOT NULL UNIQUE,
  rel_path    TEXT    NOT NULL,            -- relative to root, always '/'-separated
  name        TEXT    NOT NULL,
  ext         TEXT    NOT NULL,            -- 'pdf' | 'docx' | 'pptx' | 'txt'
  size        INTEGER NOT NULL DEFAULT 0,
  mtime_ms    INTEGER NOT NULL DEFAULT 0,
  page_count  INTEGER NOT NULL DEFAULT 0,  -- PDF pages / PPTX slides / 1 for docx & txt
  char_count  INTEGER NOT NULL DEFAULT 0,
  indexed_at  INTEGER,
  parse_error TEXT,
  missing     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_files_root ON files(root, missing);

-- Cached extracted text, one row per page (PDF) or slide (PPTX).
CREATE TABLE IF NOT EXISTS pages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id     INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  content     TEXT    NOT NULL DEFAULT '',
  UNIQUE(file_id, page_number)
);

-- Full-text index over `pages`, kept in sync by triggers.
CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
  content,
  content='pages',
  content_rowid='id',
  tokenize='porter unicode61'
);
CREATE TRIGGER IF NOT EXISTS pages_ai AFTER INSERT ON pages BEGIN
  INSERT INTO pages_fts(rowid, content) VALUES (new.id, new.content);
END;
CREATE TRIGGER IF NOT EXISTS pages_ad AFTER DELETE ON pages BEGIN
  INSERT INTO pages_fts(pages_fts, rowid, content) VALUES ('delete', old.id, old.content);
END;
CREATE TRIGGER IF NOT EXISTS pages_au AFTER UPDATE ON pages BEGIN
  INSERT INTO pages_fts(pages_fts, rowid, content) VALUES ('delete', old.id, old.content);
  INSERT INTO pages_fts(rowid, content) VALUES (new.id, new.content);
END;

-- Rendered HTML for DOCX/PPTX so the viewer doesn't re-parse on every open.
CREATE TABLE IF NOT EXISTS file_html (
  file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  html    TEXT NOT NULL
);

-- One rich-text note document per file.
CREATE TABLE IF NOT EXISTS notes (
  file_id      INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  content_html TEXT    NOT NULL DEFAULT '',
  updated_at   INTEGER NOT NULL
);

-- Flashcards with spaced-repetition state.
CREATE TABLE IF NOT EXISTS flashcards (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id          INTEGER REFERENCES files(id) ON DELETE SET NULL,
  front            TEXT    NOT NULL,
  back             TEXT    NOT NULL,
  source           TEXT    NOT NULL DEFAULT 'manual', -- 'highlight' | 'ai' | 'quiz' | 'manual'
  page_number      INTEGER,
  ease             REAL    NOT NULL DEFAULT 2.5,
  interval_days    REAL    NOT NULL DEFAULT 0,
  repetitions      INTEGER NOT NULL DEFAULT 0,
  lapses           INTEGER NOT NULL DEFAULT 0,
  due_at           INTEGER NOT NULL,
  created_at       INTEGER NOT NULL,
  last_reviewed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_flashcards_due ON flashcards(due_at);
CREATE INDEX IF NOT EXISTS idx_flashcards_file ON flashcards(file_id);

-- Review log (useful for future stats / algorithm tuning).
CREATE TABLE IF NOT EXISTS reviews (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id     INTEGER NOT NULL REFERENCES flashcards(id) ON DELETE CASCADE,
  grade       INTEGER NOT NULL,   -- 0 again, 1 hard, 2 good, 3 easy
  reviewed_at INTEGER NOT NULL
);

-- Per-file study progress.
CREATE TABLE IF NOT EXISTS progress (
  file_id        INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  seconds_spent  INTEGER NOT NULL DEFAULT 0,
  max_scroll_pct REAL    NOT NULL DEFAULT 0,  -- 0..1, furthest point read
  last_position  REAL    NOT NULL DEFAULT 0,  -- 0..1, scroll position to resume at
  last_opened_at INTEGER
);

-- Cached AI output (summary, quiz) per file. Cleared when the file changes.
CREATE TABLE IF NOT EXISTS ai_cache (
  file_id    INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  kind       TEXT    NOT NULL,
  content    TEXT    NOT NULL,   -- JSON
  model      TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (file_id, kind)
);
