// 知错 · Cloudflare Worker 入口
// 静态资源由 Workers Assets 提供，/api/* 与 /uploads/* 由本 Worker 处理，数据存 D1。
import * as db from './db.mjs';
import * as ai from '../server/ai.mjs';
import { AppError } from '../server/shared.mjs';

const COOKIE = 'zc_session';
const SESSION_TTL = 7 * 86400;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });
}

function html(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-frame-options': 'DENY',
      'referrer-policy': 'same-origin',
      ...headers,
    },
  });
}

function injectEnv(env) {
  globalThis.__ZC_ENV__ = {
    AI_API_KEY: env.AI_API_KEY || '',
    AI_BASE_URL: env.AI_BASE_URL || '',
    AI_MODEL: env.AI_MODEL || '',
    AI_VISION_MODEL: env.AI_VISION_MODEL || '',
    AI_MOCK: env.AI_MOCK || '',
  };
}

// ---------------------------------------------------------------- 会话

function b64url(bytes) {
  let binary = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  arr.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function cookieValue(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return '';
}

async function sign(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return b64url(new Uint8Array(sig));
}

function safeEqual(a, b) {
  const x = String(a);
  const y = String(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

async function isAuthed(request, env) {
  if (!env.APP_PASSWORD) return false;
  const token = cookieValue(request, COOKIE);
  if (!token) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Math.floor(Date.now() / 1000)) return false;
  const expected = await sign(env.APP_SECRET || env.APP_PASSWORD, exp);
  return safeEqual(sig, expected);
}

async function sessionCookie(env, secure = false) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL;
  const sig = await sign(env.APP_SECRET || env.APP_PASSWORD, String(exp));
  return `${COOKIE}=${exp}.${sig}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL}${
    secure ? '; Secure' : ''
  }`;
}

function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function safeNext(value) {
  const next = String(value || '').trim();
  if (!next.startsWith('/') || next.startsWith('//')) return '/';
  return next;
}

function loginPage({ error = '', next = '/', setup = false } = {}) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>登录 · 知错</title><style>
:root{--paper:#F3EDE0;--paper2:#FBF7EC;--ink:#1E2533;--red:#C94B36;--line:#D8CEBC;--muted:#7C7C72}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#F3EDE0;background-image:radial-gradient(rgba(30,37,51,.06) 1px,transparent 1px);background-size:22px 22px;color:#1E2533;font-family:"PingFang SC","Microsoft YaHei",sans-serif}
.card{width:min(390px,100%);background:#FBF7EC;border:1px solid #D8CEBC;border-radius:12px;box-shadow:6px 6px 0 rgba(30,37,51,.12);padding:28px 26px;position:relative}
.card:before{content:"";position:absolute;top:-9px;left:28px;width:64px;height:18px;background:rgba(199,154,75,.32);transform:rotate(-2deg)}
.seal{width:44px;height:44px;display:grid;place-items:center;background:#C94B36;color:#FBF7EC;font-family:"KaiTi","STKaiti",serif;font-size:25px;border-radius:6px;box-shadow:inset 0 0 0 2px rgba(251,247,236,.35);margin-bottom:16px}
h1{font-family:"Songti SC","SimSun",serif;font-size:27px;margin:0 0 6px}p{color:#7C7C72;font-size:12.5px;line-height:1.7;margin:0 0 20px}
label{display:block;font-size:12px;font-weight:600;margin-bottom:6px}
input{width:100%;height:42px;padding:0 12px;border:1px solid #D8CEBC;border-radius:7px;background:#fffdf7;font:inherit;outline:none}input:focus{border-color:#1E2533;box-shadow:0 0 0 3px rgba(30,37,51,.07)}
button{width:100%;height:44px;margin-top:16px;border:0;border-radius:7px;background:#C94B36;color:#FBF7EC;font:inherit;font-weight:600;cursor:pointer}
.err{background:#F3DCD5;color:#A33A28;border-radius:7px;padding:9px 11px;font-size:12px;margin-bottom:14px}
.tip{margin-top:16px;padding-top:14px;border-top:1px dashed #D8CEBC;color:#7C7C72;font-size:10.5px;line-height:1.7}code{font-family:Consolas,monospace;background:rgba(30,37,51,.06);padding:1px 4px;border-radius:3px}
</style></head><body><main class="card">
<div class="seal">知</div>
<h1>知错 · 私有错题本</h1>
<p>${setup ? '还没有设置访问密码。请先在 Cloudflare Worker 里配置 APP_PASSWORD。' : '输入访问密码，继续整理你的错题。'}</p>
${error ? `<div class="err">${error.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))}</div>` : ''}
${
  setup
    ? `<div class="tip">在项目目录运行：<br><code>npx wrangler secret put APP_PASSWORD</code><br>然后重新打开此页面。</div>`
    : `<form method="post" action="/login">
        <input type="hidden" name="next" value="${safeNext(next).replace(/"/g, '&quot;')}">
        <label for="password">访问密码</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
        <button type="submit">进入错题本</button>
      </form>
      <div class="tip">这是个人部署，题目数据保存在你的 Cloudflare D1，照片只保存在当前浏览器。连续输错不会锁定，但请使用足够长的密码。</div>`
}
</main></body></html>`;
}

// ---------------------------------------------------------------- 业务 API

async function readJson(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 20 * 1024 * 1024) throw new AppError(413, '请求体过大，上限 20MB');
  let data;
  try {
    data = await request.json();
  } catch {
    throw new AppError(400, '请求体不是合法的 JSON');
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new AppError(400, '请求体必须是 JSON 对象');
  }
  return data;
}

function queryObject(url) {
  const out = {};
  url.searchParams.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

async function handleApi(request, env, url) {
  const method = request.method.toUpperCase();
  const pathname = url.pathname;
  const settings = await db.getSettings(env);

  if (pathname === '/api/health' && method === 'GET') {
    return json({ ok: true, ai: ai.healthInfo(settings) });
  }

  if (pathname === '/api/bootstrap' && method === 'GET') {
    return json({
      settings: ai.settingsView(settings),
      meta: await db.buildMeta(env),
      features: { cloud: true, localImages: true },
    });
  }

  if (pathname === '/api/stats' && method === 'GET') {
    return json(await db.buildStats(env));
  }

  if (pathname === '/api/questions' && method === 'GET') {
    return json(await db.listQuestions(env, queryObject(url)));
  }

  if (pathname === '/api/questions' && method === 'POST') {
    const body = await readJson(request);
    return json({ question: await db.createQuestion(env, body) });
  }

  const questionMatch = pathname.match(/^\/api\/questions\/([^/]+)$/);
  if (questionMatch && ['GET', 'PATCH', 'DELETE'].includes(method)) {
    const id = decodeURIComponent(questionMatch[1]);
    if (method === 'GET') {
      const question = await db.getQuestion(env, id);
      if (!question) throw new AppError(404, '错题不存在或已被删除');
      return json({ question });
    }
    if (method === 'PATCH') {
      const body = await readJson(request);
      return json({ question: await db.updateQuestion(env, id, body) });
    }
    await db.deleteQuestion(env, id);
    return json({ ok: true });
  }

  const attemptMatch = pathname.match(/^\/api\/questions\/([^/]+)\/attempts$/);
  if (attemptMatch && method === 'POST') {
    const body = await readJson(request);
    return json(await db.recordAttempt(env, decodeURIComponent(attemptMatch[1]), body));
  }

  const variantsMatch = pathname.match(/^\/api\/questions\/([^/]+)\/variants$/);
  if (variantsMatch && method === 'POST') {
    const id = decodeURIComponent(variantsMatch[1]);
    const question = await db.getQuestion(env, id);
    if (!question) throw new AppError(404, '错题不存在或已被删除');
    const body = await readJson(request).catch(() => ({}));
    const count = Math.min(5, Math.max(1, Number(body.count) || 2));
    const variants = await ai.generateVariants(question, count, settings);
    return json(await db.addVariants(env, id, variants));
  }

  if (pathname === '/api/analyze' && method === 'POST') {
    const body = await readJson(request);
    return json(
      await ai.analyze({
        text: body.text,
        imageDataUrl: body.imageDataUrl,
        studentWork: body.studentWork,
        subject: body.subject,
        grade: body.grade,
        settings,
      })
    );
  }

  if (pathname === '/api/practice/queue' && method === 'GET') {
    return json(await db.buildPracticeQueue(env, queryObject(url)));
  }

  if (pathname === '/api/ai/test' && method === 'POST') {
    return json(await ai.testConnection(settings));
  }

  if (pathname === '/api/settings' && method === 'GET') {
    return json(ai.settingsView(settings));
  }

  if (pathname === '/api/settings' && method === 'PUT') {
    const body = await readJson(request);
    const updated = await db.updateSettings(env, body);
    return json(ai.settingsView(updated));
  }

  if (pathname === '/api/export' && method === 'GET') {
    const questions = await db.allQuestions(env);
    return json(
      {
        exportedAt: new Date().toISOString(),
        questions,
        settings: ai.settingsView(settings),
      },
      200,
      {
        'content-disposition': `attachment; filename="cuotiben-export-${new Date()
          .toISOString()
          .slice(0, 10)}.json"`,
      }
    );
  }

  throw new AppError(404, '接口不存在');
}

// ---------------------------------------------------------------- 入口

export default {
  async fetch(request, env) {
    injectEnv(env);
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    // 登录 / 登出
    if (url.pathname === '/login') {
      if (method === 'GET') {
        if (!env.APP_PASSWORD) return html(loginPage({ setup: true }), 503);
        if (await isAuthed(request, env)) return Response.redirect(new URL('/', url).toString(), 302);
        return html(loginPage({ next: safeNext(url.searchParams.get('next')) }));
      }
      if (method === 'POST') {
        if (!env.APP_PASSWORD) return html(loginPage({ setup: true }), 503);
        const form = await request.formData();
        const password = String(form.get('password') || '');
        const next = safeNext(form.get('next') || url.searchParams.get('next') || '/');
        if (!safeEqual(password, env.APP_PASSWORD)) {
          return html(loginPage({ error: '密码不正确，请重试。', next }), 401);
        }
        return new Response(null, {
          status: 302,
          headers: {
            location: next,
            'set-cookie': await sessionCookie(env, url.protocol === 'https:'),
            'cache-control': 'no-store',
          },
        });
      }
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (url.pathname === '/logout') {
      return new Response(null, {
        status: 302,
        headers: { location: '/login', 'set-cookie': clearCookie(), 'cache-control': 'no-store' },
      });
    }

    if (!env.APP_PASSWORD) {
      if (url.pathname.startsWith('/api/')) {
        return json({ error: '服务尚未设置访问密码，请配置 APP_PASSWORD 后再使用' }, 503);
      }
      return html(loginPage({ setup: true }), 503);
    }

    const authed = await isAuthed(request, env);
    if (!authed && !url.pathname.startsWith('/downloads/')) {
      if (url.pathname.startsWith('/api/')) {
        return json({ error: '登录已过期，请重新登录', login: '/login' }, 401);
      }
      const next = encodeURIComponent(`/${url.searchParams.toString() ? '?' + url.searchParams : ''}`);
      return Response.redirect(new URL(`/login?next=${next}`, url).toString(), 302);
    }

    // 图片
    if (url.pathname.startsWith('/uploads/')) {
      const image = await db.getImage(env, url.pathname.slice('/uploads/'.length));
      if (!image) return new Response('Not Found', { status: 404 });
      const binary = atob(image.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return new Response(bytes, {
        headers: {
          'content-type': image.mime,
          'cache-control': 'private, max-age=86400',
          'x-content-type-options': 'nosniff',
        },
      });
    }

    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        if (err instanceof AppError) return json({ error: err.message }, err.status);
        console.error('[worker] API 错误', err);
        return json({ error: `服务内部错误：${err && err.message ? err.message : '未知错误'}` }, 500);
      }
    }

    // 静态资源（public/）
    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) return assetResponse;
      if (url.pathname === '/') return env.ASSETS.fetch(new URL('/index.html', url).toString());
      return assetResponse;
    }
    return new Response('Not Found', { status: 404 });
  },
};
