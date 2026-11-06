// 知错 · 智能错题本 —— 零依赖 HTTP 服务
// 启动：node server/index.mjs  （默认 http://127.0.0.1:8787，可用 PORT 覆盖）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import * as store from './store.mjs';
import * as ai from './ai.mjs';
import {
  AppError,
  SUBJECTS,
  GRADES,
  DIFFICULTIES,
  UPLOAD_DIR,
  makeId
} from './store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(HERE, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const MAX_BODY = 20 * 1024 * 1024;

function parsePort(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : 8787;
}

const PORT = parsePort(process.env.PORT);
const HOST = (process.env.HOST || '127.0.0.1').trim() || '127.0.0.1';

// ---------------------------------------------------------------- 响应工具

function sendJson(res, status, payload, extraHeaders = {}) {
  let body;
  try {
    body = Buffer.from(JSON.stringify(payload), 'utf8');
  } catch (err) {
    status = 500;
    body = Buffer.from(JSON.stringify({ error: '响应序列化失败' }), 'utf8');
  }
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*',
    ...extraHeaders
  });
  if (res.req && res.req.method === 'HEAD') res.end();
  else res.end(body);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

function contentType(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function isInside(baseDir, target) {
  const rel = path.relative(baseDir, target);
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function sendFile(req, res, file, cacheControl = 'no-cache') {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (err) {
    return false;
  }
  if (!stat.isFile()) return false;
  res.writeHead(200, {
    'Content-Type': contentType(file),
    'Content-Length': stat.size,
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff'
  });
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  const stream = fs.createReadStream(file);
  stream.on('error', () => {
    try {
      res.destroy();
    } catch (err) {
      /* ignore */
    }
  });
  stream.pipe(res);
  return true;
}

// ---------------------------------------------------------------- 请求体

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) {
        failed = true;
        reject(new AppError(413, `请求体过大，上限 ${Math.round(limit / 1024 / 1024)}MB`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!failed) resolve(Buffer.concat(chunks));
    });
    req.on('error', (err) => {
      if (!failed) {
        failed = true;
        reject(new AppError(400, `读取请求体失败：${err.message}`));
      }
    });
  });
}

async function readJsonBody(req) {
  const buffer = await readBody(req);
  if (!buffer.length) return {};
  let data;
  try {
    data = JSON.parse(buffer.toString('utf8'));
  } catch (err) {
    throw new AppError(400, '请求体不是合法的 JSON');
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new AppError(400, '请求体必须是 JSON 对象');
  }
  return data;
}

function queryObject(searchParams) {
  const result = {};
  for (const [key, value] of searchParams.entries()) result[key] = value;
  return result;
}

function clampCount(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

// ---------------------------------------------------------------- 元信息

function buildMeta() {
  const questions = store.getQuestions();
  const sources = [...new Set(questions.map((q) => q.source).filter(Boolean))].slice(0, 24);
  return {
    subjects: SUBJECTS.slice(),
    grades: GRADES.slice(),
    difficulties: DIFFICULTIES.slice(),
    sources,
    errorTypes: store.ERROR_TYPE_LIST.slice(),
    masteryLevels: store.MASTERY_LEVEL_LIST.slice()
  };
}

// ---------------------------------------------------------------- API 路由

async function handleApi(req, res, pathname, search) {
  const method = req.method || 'GET';
  const settings = () => store.getRawSettings();

  if (pathname === '/api/health' && method === 'GET') {
    return sendJson(res, 200, { ok: true, ai: ai.healthInfo(settings()) });
  }

  if (pathname === '/api/bootstrap' && method === 'GET') {
    return sendJson(res, 200, {
      settings: ai.settingsView(settings()),
      meta: buildMeta()
    });
  }

  if (pathname === '/api/stats' && method === 'GET') {
    return sendJson(res, 200, store.buildStats());
  }

  if (pathname === '/api/questions' && method === 'GET') {
    return sendJson(res, 200, store.listQuestions(queryObject(search)));
  }

  if (pathname === '/api/questions' && method === 'POST') {
    const body = await readJsonBody(req);
    return sendJson(res, 200, { question: store.createQuestion(body) });
  }

  if (pathname === '/api/analyze' && method === 'POST') {
    const body = await readJsonBody(req);
    const result = await ai.analyze({
      text: body.text,
      imageDataUrl: body.imageDataUrl,
      studentWork: body.studentWork,
      subject: body.subject,
      grade: body.grade,
      settings: settings()
    });
    result.analysis.variants = (result.analysis.variants || []).map((variant) => ({
      ...variant,
      id: makeId('v')
    }));
    return sendJson(res, 200, result);
  }

  if (pathname === '/api/practice/queue' && method === 'GET') {
    return sendJson(
      res,
      200,
      store.buildPracticeQueue({
        mode: search.get('mode') || 'due',
        count: search.get('count'),
        subject: search.get('subject') || ''
      })
    );
  }

  if (pathname === '/api/ai/test' && method === 'POST') {
    await readJsonBody(req);
    return sendJson(res, 200, await ai.testConnection(settings()));
  }

  if (pathname === '/api/settings' && method === 'GET') {
    return sendJson(res, 200, ai.settingsView(settings()));
  }

  if (pathname === '/api/settings' && method === 'PUT') {
    const body = await readJsonBody(req);
    store.updateSettings(body);
    return sendJson(res, 200, ai.settingsView(settings()));
  }

  if (pathname === '/api/export' && method === 'GET') {
    const filename = `cuotiben-export-${new Date().toISOString().slice(0, 10)}.json`;
    return sendJson(
      res,
      200,
      {
        exportedAt: new Date().toISOString(),
        questions: store.getQuestions(),
        settings: ai.settingsView(settings())
      },
      { 'Content-Disposition': `attachment; filename="${filename}"` }
    );
  }

  let match;

  if ((match = /^\/api\/questions\/([^/]+)$/.exec(pathname))) {
    const id = match[1];
    if (method === 'GET') {
      return sendJson(res, 200, { question: store.getQuestion(id) });
    }
    if (method === 'PATCH') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, { question: store.updateQuestion(id, body) });
    }
    if (method === 'DELETE') {
      store.deleteQuestion(id);
      return sendJson(res, 200, { ok: true });
    }
    throw new AppError(405, `接口不支持 ${method} 方法`);
  }

  if ((match = /^\/api\/questions\/([^/]+)\/attempts$/.exec(pathname))) {
    if (method !== 'POST') throw new AppError(405, `接口不支持 ${method} 方法`);
    const body = await readJsonBody(req);
    return sendJson(res, 200, store.recordAttempt(match[1], body));
  }

  if ((match = /^\/api\/questions\/([^/]+)\/variants$/.exec(pathname))) {
    if (method !== 'POST') throw new AppError(405, `接口不支持 ${method} 方法`);
    const body = await readJsonBody(req);
    const id = match[1];
    const question = store.getQuestion(id);
    const count = clampCount(body.count, 1, 5, 2);
    const generated = await ai.generateVariants(question, count, settings());
    const withIds = generated.map((variant) => ({ ...variant, id: makeId('v') }));
    const { question: updated, variants } = store.addVariants(id, withIds);
    return sendJson(res, 200, { question: updated, variants });
  }

  throw new AppError(404, `接口不存在：${method} ${pathname}`);
}

// ---------------------------------------------------------------- 静态资源

async function serveUpload(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    throw new AppError(405, `不支持 ${req.method} 方法`);
  }
  const name = pathname.slice('/uploads/'.length);
  if (
    !name ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('..') ||
    name.includes('\0')
  ) {
    throw new AppError(404, '图片不存在');
  }
  const file = path.resolve(UPLOAD_DIR, name);
  if (!isInside(UPLOAD_DIR, file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new AppError(404, '图片不存在');
  }
  sendFile(req, res, file);
}

async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    throw new AppError(405, `不支持 ${req.method} 方法`);
  }
  const rel = pathname.replace(/^\/+/, '');
  // 防目录穿越：拒绝 .. 段、反斜杠与空字节，再校验解析后的路径仍在 public 内
  if (
    rel &&
    (rel.includes('\\') || rel.includes('\0') || rel.split('/').some((segment) => segment === '..'))
  ) {
    throw new AppError(403, '禁止访问该路径');
  }
  const candidates = [];
  if (rel) {
    candidates.push(rel);
    candidates.push(path.join(rel, 'index.html'));
  }
  for (const candidate of candidates) {
    const target = path.resolve(PUBLIC_DIR, candidate);
    if (!isInside(PUBLIC_DIR, target)) continue;
    if (fs.existsSync(target) && fs.statSync(target).isFile()) {
      sendFile(req, res, target);
      return;
    }
  }
  // SPA 回退
  const indexFile = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(indexFile) && fs.statSync(indexFile).isFile()) {
    sendFile(req, res, indexFile);
    return;
  }
  throw new AppError(404, '前端页面尚未生成（public/index.html 不存在）');
}

// ---------------------------------------------------------------- 服务

async function handleRequest(req, res) {
  const started = Date.now();
  let pathname = '/';
  try {
    let url;
    try {
      url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    } catch (err) {
      throw new AppError(400, '请求地址格式不正确');
    }
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch (err) {
      throw new AppError(400, '请求地址包含非法字符');
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400'
      });
      res.end();
      return;
    }

    if (pathname === '/api') {
      throw new AppError(404, '接口不存在，请使用 /api/health 等接口');
    }
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname, url.searchParams);
    } else if (pathname.startsWith('/uploads/')) {
      await serveUpload(req, res, pathname);
    } else {
      await serveStatic(req, res, pathname);
    }
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500;
    if (status >= 500) {
      console.error(`[server] ${req.method} ${pathname} ->`, err);
    }
    if (!res.headersSent) {
      sendJson(res, status, {
        error: err instanceof AppError ? err.message : '服务器内部错误，请稍后重试'
      });
    } else {
      try {
        res.end();
      } catch (closeErr) {
        /* ignore */
      }
    }
  } finally {
    if (pathname.startsWith('/api')) {
      console.log(`[api] ${req.method} ${pathname} ${res.statusCode} ${Date.now() - started}ms`);
    }
  }
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error('[server] 未捕获的请求错误：', err);
    if (!res.headersSent) sendJson(res, 500, { error: '服务器内部错误，请稍后重试' });
    else {
      try {
        res.end();
      } catch (closeErr) {
        /* ignore */
      }
    }
  });
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(
      `\n[启动失败] 端口 ${PORT} 已被占用。请关闭占用该端口的进程，或换一个端口启动：\n` +
        `  $env:PORT=8799; node server/index.mjs\n`
    );
  } else {
    console.error('[启动失败]', err);
  }
  process.exit(1);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n收到 ${signal}，正在保存数据并停止服务…`);
  try {
    store.flush();
  } catch (err) {
    console.error('[shutdown] 保存失败：', err.message);
  }
  server.close(() => {
    console.log('数据已保存，服务已停止。');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  console.error('[未捕获异常]', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[未处理的 Promise 拒绝]', err);
});

store.initStore();
const startupAi = ai.healthInfo(store.getRawSettings());

function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const [name, list] of Object.entries(nets)) {
    for (const item of list || []) {
      if (item.family !== 'IPv4' || item.internal) continue;
      if (item.address.startsWith('169.254.')) continue;
      out.push({ name, address: item.address });
    }
  }
  return out;
}

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  知错 · 智能错题本');
  console.log(`  ➜  本机访问：http://127.0.0.1:${PORT}`);
  if (HOST === '0.0.0.0') {
    const addresses = lanAddresses();
    if (addresses.length) {
      addresses.forEach((item) => {
        console.log(`  ➜  手机访问：http://${item.address}:${PORT}  （同一 Wi-Fi · ${item.name}）`);
      });
    } else {
      console.log('  ➜  手机访问：未检测到局域网 IPv4，请检查 Wi-Fi 连接');
    }
    console.log('  ➜  注意：当前已开放到局域网，请仅在可信 Wi-Fi 下使用');
  }
  console.log(
    `  ➜  AI 引擎：${
      startupAi.mode === 'live'
        ? `live · ${startupAi.model} · ${startupAi.provider}`
        : 'demo（未配置 API Key，分析结果会明确标注为示例）'
    }`
  );
  console.log('  ➜  按 Ctrl+C 停止服务');
  console.log('');
});
