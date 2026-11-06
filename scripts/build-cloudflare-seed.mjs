// 生成 Cloudflare D1 初始化与种子 SQL（从本地 data/db.json 导出当前 14 道题）
// 用法：node scripts/build-cloudflare-seed.mjs
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const db = JSON.parse(fs.readFileSync(path.join(root, 'data/db.json'), 'utf8'));
const outDir = path.join(root, 'cloudflare/migrations');
fs.mkdirSync(outDir, { recursive: true });

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

const schema = `-- 知错 · Cloudflare D1 初始化
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
`;

let seed = `-- 知错 · 种子数据（由 data/db.json 生成，可按需替换为自己的错题）\n`;
db.questions.forEach((q) => {
  seed += `INSERT OR REPLACE INTO questions (id, data, created_at, updated_at) VALUES (${sqlString(
    q.id
  )}, ${sqlString(JSON.stringify(q))}, ${sqlString(q.createdAt)}, ${sqlString(q.updatedAt)});\n`;
});
const settings = { name: db.settings?.name || '同学', ai: db.settings?.ai || {} };
// 不把本地 API Key 写入云端的 SQL 种子文件
if (settings.ai) settings.ai.apiKey = '';
seed += `INSERT OR REPLACE INTO settings (id, data) VALUES (1, ${sqlString(JSON.stringify(settings))});\n`;

fs.writeFileSync(path.join(outDir, '0001_init.sql'), schema, 'utf8');
fs.writeFileSync(path.join(outDir, '0002_seed.sql'), seed, 'utf8');
console.log(`写入 cloudflare/migrations/0001_init.sql`);
console.log(`写入 cloudflare/migrations/0002_seed.sql（${db.questions.length} 道题）`);
