# 部署到 Cloudflare Workers + D1

这是与本地 Node 版并存的 **Cloudflare 版本**。前端完全复用 `public/`，后端由 `cloudflare/worker.mjs` 提供，题目/练习/设置存在 Cloudflare D1；**照片原图只保存在当前浏览器的 IndexedDB 中，不上传云端**（AI 识别时会临时传给 AI 服务）。访问由 `APP_PASSWORD` 保护。

## 结构

```
wrangler.toml                 # Worker + Assets + D1 配置
cloudflare/
  worker.mjs                  # 路由、登录鉴权、API、静态资源
  db.mjs                      # D1 数据层 + 掌握度/统计/队列
  migrations/
    0001_init.sql             # 建表
    0002_seed.sql             # 14 道示例题（从本地 data/db.json 生成）
scripts/build-cloudflare-seed.mjs
```

## 第一次部署

前置：Node.js 20+、Cloudflare 账号、`npm install` 已执行。

```powershell
# 1. 登录 Cloudflare（浏览器授权）
npm run cf:login

# 2. 创建 D1 数据库
node scripts/cf.mjs d1 create zhicuo
```

把命令返回的 `database_id` 填进 [wrangler.toml](../wrangler.toml)：

```toml
[[d1_databases]]
binding = "DB"
database_name = "zhicuo"
database_id = "这里填写真实的 UUID"
migrations_dir = "cloudflare/migrations"
```

```powershell
# 3. 初始化远程数据库（建表 + 导入 14 道示例题）
npm run cf:migrate

# 4. 设置访问密码（必须；否则 Worker 会返回 503）
node scripts/cf.mjs secret put APP_PASSWORD
# 可选：用于签名登录 Cookie 的独立密钥，建议设置
node scripts/cf.mjs secret put APP_SECRET

# 5. 部署
npm run cf:deploy
```

部署成功后会得到 `https://zhicuo.<你的子域>.workers.dev`。打开后先输入 `APP_PASSWORD`。

### 绑定自定义域名（推荐，workers.dev 在部分网络不可达）

如果 `workers.dev` 打不开，可以绑定 Cloudflare 上已有的域名：

```powershell
$env:CLOUDFLARE_ACCOUNT_ID='你的 Account ID'
node scripts/cf-domain.mjs zhicuo.你的域名.com zhicuo 你的ZoneID
```

脚本调用 Cloudflare Workers Custom Domains API，自动创建 DNS 与证书（域名需已托管在同一个 Cloudflare 账号）。也可以直接在 Cloudflare 控制台 **Workers & Pages → zhicuo → Settings → Domains & Routes** 添加 Custom Domain。

自定义域名同样受网络环境影响；中国大陆网络访问 Cloudflare 免费节点可能不稳定，必要时使用代理/VPN，或部署到国内服务器。

### 浏览器授权超时？用 API Token 一键部署

如果 OAuth 登录页无法完成（例如不在那台电脑旁），可以让脚本使用 API Token：

1. 打开 <https://dash.cloudflare.com/profile/api-tokens> → **Create Token** → **Custom token**；
2. 权限：
   - Account → **Workers Scripts** → Edit
   - Account → **D1** → Edit
   - Account → **Account Settings** → Read
   - User → **User Details** → Read
3. Account Resources 选择你的账号；
4. 创建后，在本项目根目录新建 `.cf-token`（已 gitignore）：

```ini
CLOUDFLARE_ACCOUNT_ID=你的 Account ID
CLOUDFLARE_API_TOKEN=你的 Token
```

5. 运行一键部署：

```powershell
node scripts/cf-deploy.mjs
```

脚本会自动创建/复用 D1 `zhicuo`、写入 `wrangler.toml`、导入 14 道题、生成访问密码、设置 Secrets、部署 Worker，并把地址和密码写入 `dist/cloudflare-access.txt`；部署结束后自动删除 `.cf-token`。部署后建议到 Cloudflare 后台撤销该 Token。

> 不要使用 Global API Key，也不要把账号密码发给任何人。

## 本地预览 Worker

```powershell
# 1. 复制环境变量模板并修改密码
Copy-Item .dev.vars.example .dev.vars
# 编辑 .dev.vars：APP_PASSWORD=你的密码，APP_SECRET=随机长字符串

# 2. 初始化本地 D1（数据保存在 .wrangler/state）
npm run cf:migrate:local

# 3. 启动本地 Worker（默认 8788，与本地 Node 服务 8787 互不冲突）
npm run cf:dev
```

> 上面的 npm 脚本通过 `scripts/cf.mjs` 调用 Wrangler，会自动把 `TEMP`/`TMP` 指向项目内 `.tmp`，避免 Windows 上 workerd 的 `CreateDirectory: #5 拒绝访问`（miniflare 临时目录问题）。如果你直接运行 `npx wrangler` 遇到该错误，也可以手动设置：
> ```powershell
> $env:TEMP='D:\AI\cuotiben\.tmp'; $env:TMP='D:\AI\cuotiben\.tmp'
> ```

## 用本地数据生成 D1 种子

`0002_seed.sql` 是从本地 `data/db.json` 生成的。如果你在本地积累了自己的错题，希望云端从这份数据开始：

```powershell
node scripts/build-cloudflare-seed.mjs
# 重新生成 cloudflare/migrations/0002_seed.sql
```

- 首次部署：直接随 migration 导入；
- 已经部署过：可以 `node scripts/cf.mjs d1 execute zhicuo --remote --file=cloudflare/migrations/0002_seed.sql` 把本地题覆盖/补进云端（`INSERT OR REPLACE`，会覆盖同 id 题目）。
- 云端已有数据后不要随意重跑 migration，避免覆盖；日常备份用：

```powershell
node scripts/cf.mjs d1 export zhicuo --remote --output=backup.sql
```

## AI 配置

两种方式任选：

1. **设置页填写**（和本地版一样）：API Key 存入 D1，`/api/settings` 永远不会回传明文；适合个人使用。
2. **Worker Secrets**：
   ```powershell
   npx wrangler secret put AI_API_KEY
   npx wrangler secret put AI_BASE_URL      # 可选
   npx wrangler secret put AI_MODEL         # 可选
   npx wrangler secret put AI_VISION_MODEL  # 拍照识别建议设置
   ```
   当设置页没有显式保存自定义值时，会自动使用这些环境变量。

## 数据与安全

- 所有错题、练习记录、设置都在你的 Cloudflare D1 中；照片原图只存在上传它的那台设备的浏览器 IndexedDB 里。
- Worker 默认要求 `APP_PASSWORD`，登录 Cookie 为 HttpOnly + HMAC 签名，7 天有效；密码修改后旧会话立即失效。
- 建议再开启 **Cloudflare Access** 或至少使用强密码；不要把无密码版本暴露在公网。
- 免费额度：Workers 每天 10 万请求、D1 免费额度对个人错题本足够；仅 AI 调用费用由你的 AI 服务商收取。
- **照片本地存储的取舍**：换设备/换浏览器/清理浏览器数据后，旧照片不会再显示，但题目、答案、掌握度和练习记录仍在云端。若希望照片跨设备同步，可以改为 R2 存储（需要额外绑定 R2 并调整 `cloudflare/db.mjs` 的图片函数）。

## 测试

```powershell
# Worker 本地启动后（.dev.vars 里的密码）
node scripts/cf-smoke.mjs http://127.0.0.1:8788 你的密码

# 可选：浏览器 UI 全流程（含登录、IndexedDB 照片本地存储）
$env:APP_URL='http://127.0.0.1:8788'; $env:UI_PASSWORD='你的密码'; node scripts/ui-check.mjs
```

覆盖：登录/错误密码/未登录 401、health/bootstrap/stats、题目 CRUD、AI demo 分析与图片 422、练习队列、设置脱敏、图片上传 API（保留给旧客户端；网页端照片走 IndexedDB）、export、退出登录、静态资源。当前实测：Worker API 27/27、浏览器 UI 24/24。


