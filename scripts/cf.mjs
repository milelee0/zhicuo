// 知错 · Wrangler 包装器
// Windows 下 workerd/miniflare 可能因系统 TEMP 不可写而报 CreateDirectory 拒绝访问，
// 这里把 TEMP/TMP 指向项目内 .tmp，并保持其余环境不变。
// 用法：node scripts/cf.mjs <wrangler 参数...>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const tmp = path.join(root, '.tmp');
fs.mkdirSync(tmp, { recursive: true });

const args = ['wrangler', ...process.argv.slice(2)];
const isWin = process.platform === 'win32';
const command = isWin ? 'npx.cmd' : 'npx';
const child = spawn(command, args, {
  cwd: root,
  stdio: 'inherit',
  shell: isWin,
  env: {
    ...process.env,
    TEMP: tmp,
    TMP: tmp,
  },
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`wrangler 被信号 ${signal} 终止`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code == null ? 1 : code;
});
