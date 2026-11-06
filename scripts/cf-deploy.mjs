// 知错 · 一键部署到 Cloudflare（读取 .cf-token）
// 用法：node scripts/cf-deploy.mjs [数据库名]
// .cf-token 格式：
//   CLOUDFLARE_ACCOUNT_ID=xxxxxxxx
//   CLOUDFLARE_API_TOKEN=xxxxxxxx
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const tokenFile = path.join(root, '.cf-token');
const dbName = process.argv[2] || 'zhicuo';
const workerName = 'zhicuo';
const tomlFile = path.join(root, 'wrangler.toml');
const resultFile = path.join(root, 'dist', 'cloudflare-access.txt');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

if (!fs.existsSync(tokenFile)) {
  console.error(`未找到 ${tokenFile}。请先按说明写入 CLOUDFLARE_ACCOUNT_ID 和 CLOUDFLARE_API_TOKEN。`);
  process.exit(1);
}

const tokenEnv = {};
fs.readFileSync(tokenFile, 'utf8')
  .split(/\r?\n/)
  .forEach((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (m) tokenEnv[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });

if (!tokenEnv.CLOUDFLARE_ACCOUNT_ID || !tokenEnv.CLOUDFLARE_API_TOKEN) {
  console.error('.cf-token 需要同时包含 CLOUDFLARE_ACCOUNT_ID 和 CLOUDFLARE_API_TOKEN。');
  process.exit(1);
}

const env = {
  ...process.env,
  CLOUDFLARE_ACCOUNT_ID: tokenEnv.CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_API_TOKEN: tokenEnv.CLOUDFLARE_API_TOKEN,
  TEMP: path.join(root, '.tmp'),
  TMP: path.join(root, '.tmp'),
};
fs.mkdirSync(env.TEMP, { recursive: true });
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });

function run(args, { input, allowFail = false } = {}) {
  console.log(`\n$ npx ${args.join(' ')}`);
  const res = spawnSync(npx, ['wrangler', ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
    input,
    shell: process.platform === 'win32',
    timeout: 180000,
  });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  if (out.trim()) console.log(out.trim());
  if (res.status !== 0 && !allowFail) {
    throw new Error(`命令失败（退出码 ${res.status}）：npx wrangler ${args.join(' ')}`);
  }
  return { status: res.status, out };
}

function printProgress(text) {
  console.log(`\n== ${text} ==`);
}

try {
  printProgress('检查 Cloudflare 登录');
  run(['whoami']);

  printProgress(`查找 / 创建 D1 数据库 ${dbName}`);
  let databaseId = '';
  const list = run(['d1', 'list', '--json'], { allowFail: true });
  if (list.out) {
    try {
      const start = list.out.indexOf('[');
      const end = list.out.lastIndexOf(']');
      const rows = start >= 0 && end > start ? JSON.parse(list.out.slice(start, end + 1)) : [];
      const found = rows.find((row) => (row.name || row.database_name) === dbName);
      databaseId = found?.uuid || found?.id || '';
    } catch {
      databaseId = '';
    }
  }
  if (!databaseId) {
    const created = run(['d1', 'create', dbName], { allowFail: true });
    const matches = created.out.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (!matches) {
      throw new Error('未能从 wrangler d1 create 输出中解析 database_id，请手动创建并在 wrangler.toml 填写。');
    }
    databaseId = matches[0];
  }
  console.log(`D1 database_id: ${databaseId}`);

  printProgress('写入 wrangler.toml');
  let toml = fs.readFileSync(tomlFile, 'utf8');
  toml = toml.replace(/database_id\s*=\s*"[^"]*"/, `database_id = "${databaseId}"`);
  toml = toml.replace(/name\s*=\s*"[^"]*"/, `name = "${workerName}"`);
  fs.writeFileSync(tomlFile, toml, 'utf8');

  printProgress('应用远程 D1 迁移');
  run(['d1', 'migrations', 'apply', dbName, '--remote'], { allowFail: false });

  printProgress('生成并设置访问密码');
  const password = crypto.randomBytes(12).toString('base64url');
  run(['secret', 'put', 'APP_PASSWORD'], { input: `${password}\n` });
  const secret = crypto.randomBytes(24).toString('base64url');
  run(['secret', 'put', 'APP_SECRET'], { input: `${secret}\n` });

  printProgress('部署 Worker');
  const deploy = run(['deploy']);

  const urlMatch = deploy.out.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/i);
  const url = urlMatch ? urlMatch[0] : `https://${workerName}.<你的子域>.workers.dev`;
  const text = [
    '知错 · Cloudflare 部署信息',
    `访问地址：${url}`,
    `访问密码：${password}`,
    '',
    '说明：',
    '- 题目/练习记录/设置保存在 Cloudflare D1。',
    '- 照片原图只保存在当前浏览器 IndexedDB，不上传 D1。',
    '- 修改密码：node scripts/cf.mjs secret put APP_PASSWORD',
    '- 备份 D1：node scripts/cf.mjs d1 export zhicuo --remote --output=backup.sql',
    '',
    `部署时间：${new Date().toISOString()}`,
  ].join('\n');
  fs.writeFileSync(resultFile, text, 'utf8');

  console.log('\n================ 部署成功 ================');
  console.log(text);
  console.log(`\n信息已保存到：${resultFile}`);
} catch (err) {
  console.error(`\n部署失败：${err.message}`);
  console.error('你可以把上面的完整输出发给我，我根据错误继续处理。');
  process.exitCode = 1;
} finally {
  // 不在磁盘上保留 Token
  try {
    fs.rmSync(tokenFile, { force: true });
    console.log('\n已删除 .cf-token（如部署失败，重新部署时需再次写入）。');
  } catch {
    /* ignore */
  }
}
