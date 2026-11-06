// 给已部署的 Worker 绑定自定义域名（使用 wrangler OAuth 凭据）
// 用法：node scripts/cf-domain.mjs zhicuo.example.com zhicuo <zone_id>
// 需要环境变量 CLOUDFLARE_ACCOUNT_ID；zone_id 也可用 CLOUDFLARE_ZONE_ID 传入。
import fs from 'node:fs';
import path from 'node:path';

const hostname = process.argv[2];
const service = process.argv[3] || 'zhicuo';
const zoneId = process.argv[4] || process.env.CLOUDFLARE_ZONE_ID || '';
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '';
if (!hostname || !accountId || !zoneId) {
  console.error('用法：node scripts/cf-domain.mjs <hostname> <worker名> <zone_id>（并设置 CLOUDFLARE_ACCOUNT_ID）');
  process.exit(1);
}
const configPath = path.join(process.env.APPDATA || '', 'xdg.config', '.wrangler', 'config', 'default.toml');
const text = fs.readFileSync(configPath, 'utf8');
const match = text.match(/oauth_token\s*=\s*"([^"]+)"/);
if (!match) {
  console.error('未找到 wrangler OAuth Token，请先 npm run cf:login');
  process.exit(1);
}
const token = match[1];
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/domains`, {
  method: 'PUT',
  headers,
  body: JSON.stringify({ environment: 'production', hostname, service, zone_id: zoneId }),
});
const data = await res.json();
console.log(JSON.stringify({ status: res.status, success: data.success, errors: data.errors, result: data.result }, null, 2));
