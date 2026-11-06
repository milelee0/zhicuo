-- 知错 · Cloudflare D1 初始化
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_questions_updated ON questions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_questions_created ON questions(created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);
