// 知错 · Cloudflare Worker + D1 冒烟测试
// 前置：wrangler dev --local --port 8788 --var APP_PASSWORD:test123
// 用法：node scripts/cf-smoke.mjs http://127.0.0.1:8788 test123
const BASE = process.argv[2] || 'http://127.0.0.1:8788';
const PASSWORD = process.argv[3] || 'test123';

let passed = 0;
let failed = 0;
let cookie = '';

function ok(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function req(path, options = {}) {
  const headers = { ...(options.body instanceof URLSearchParams ? {} : { 'Content-Type': 'application/json' }), ...(options.headers || {}) };
  if (cookie && !options.noAuth) headers.cookie = cookie;
  const res = await fetch(BASE + path, { ...options, headers, redirect: options.redirect || 'manual' });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data, text, headers: res.headers, location: res.headers.get('location') };
}

async function main() {
  console.log(`\nCloudflare Worker 冒烟 → ${BASE}\n`);

  const unauth = await req('/api/stats', { noAuth: true });
  ok('未登录 API 返回 401', unauth.status === 401, `HTTP ${unauth.status}`);

  const loginPage = await req('/login', { noAuth: true });
  ok('登录页可访问', loginPage.status === 200 && loginPage.text.includes('知错'));

  const wrong = await req('/login', {
    method: 'POST',
    body: new URLSearchParams({ password: 'wrong-password', next: '/' }),
    noAuth: true,
  });
  ok('错误密码被拒绝', wrong.status === 401, `HTTP ${wrong.status}`);

  const login = await req('/login', {
    method: 'POST',
    body: new URLSearchParams({ password: PASSWORD, next: '/' }),
    noAuth: true,
  });
  ok('登录成功并返回 302', login.status === 302 && Boolean(login.headers.get('set-cookie')), `HTTP ${login.status}`);

  const health = await req('/api/health');
  ok('GET /api/health', health.status === 200 && health.data.ok === true, `HTTP ${health.status}`);

  const boot = await req('/api/bootstrap');
  ok('GET /api/bootstrap', boot.status === 200 && Boolean(boot.data.meta), `HTTP ${boot.status}`);

  const stats = await req('/api/stats');
  ok('GET /api/stats', stats.status === 200 && stats.data.totals.questions === 14, `q=${stats.data?.totals?.questions}`);
  ok('stats 周期结构', stats.data?.activity?.length === 14 && stats.data?.forecast?.length === 7);

  const list = await req('/api/questions?limit=5');
  ok('GET /api/questions', list.status === 200 && list.data.items.length > 0, `HTTP ${list.status}`);

  const analyze = await req('/api/analyze', {
    method: 'POST',
    body: JSON.stringify({
      text: '已知函数 f(x)=x²−4x+3，求 f(x) 在 [0,3] 上的最值。',
      studentWork: '我只算了顶点，没有比较端点。',
      subject: '数学',
      grade: '高一',
    }),
  });
  const a = analyze.data?.analysis;
  ok('POST /api/analyze（demo）', analyze.status === 200 && Boolean(a), `HTTP ${analyze.status}`);
  ok('分析含错因/掌握评估/变式', Boolean(a?.errorType && a?.masteryAssessment?.length && a?.variants?.length));

  const imageDemo = await req('/api/analyze', {
    method: 'POST',
    body: JSON.stringify({ imageDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' }),
  });
  ok('图片 demo 返回 422', imageDemo.status === 422, `HTTP ${imageDemo.status}`);

  const queue = await req('/api/practice/queue?mode=due&count=5');
  ok('GET /api/practice/queue', queue.status === 200 && Array.isArray(queue.data.items), `HTTP ${queue.status}`);

  const settings = await req('/api/settings');
  ok('GET /api/settings 脱敏', settings.status === 200 && !JSON.stringify(settings.data).includes('apiKey'));

  const created = await req('/api/questions', {
    method: 'POST',
    body: JSON.stringify({
      text: 'Cloudflare 冒烟测试题目：求 2+3 的值。',
      answer: '5',
      analysis: '2+3=5。',
      subject: '数学',
      grade: '高一',
      difficulty: 1,
      knowledgePoints: ['冒烟测试'],
      variants: [{ text: '求 3+3。', answer: '6', analysis: '3+3=6。', hint: '按定义相加。' }],
    }),
  });
  ok('POST /api/questions', created.status === 200 && Boolean(created.data.question?.id), `HTTP ${created.status}`);
  const q = created.data?.question;

  if (q) {
    ok('新题 mastery=20/status=new', q.mastery === 20 && q.status === 'new');
    const attempt = await req(`/api/questions/${encodeURIComponent(q.id)}/attempts`, {
      method: 'POST',
      body: JSON.stringify({ result: 'mastered', variantId: q.variants?.[0]?.id || null }),
    });
    ok('POST attempts +16', attempt.status === 200 && attempt.data.delta === 16, `HTTP ${attempt.status}`);

    const patched = await req(`/api/questions/${encodeURIComponent(q.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ notes: 'Cloudflare 备注' }),
    });
    ok('PATCH 题目', patched.status === 200 && patched.data.question?.notes === 'Cloudflare 备注');

    const del = await req(`/api/questions/${encodeURIComponent(q.id)}`, { method: 'DELETE' });
    ok('DELETE 题目', del.status === 200 && del.data.ok === true);
  }

  // 图片上传到 D1 + /uploads 回读
  const pixel =
    'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/AP/EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEABj8Cf//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8hf//aAAwDAQACAAMAAAAQH//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z';
  const withImage = await req('/api/questions', {
    method: 'POST',
    body: JSON.stringify({ text: '图片冒烟测试', answer: '略', subject: '数学', imageDataUrl: pixel }),
  });
  ok('图片题创建', withImage.status === 200 && Boolean(withImage.data.question?.imageUrl), `HTTP ${withImage.status}`);
  if (withImage.data?.question) {
    const imageUrl = withImage.data.question.imageUrl;
    const img = await req(imageUrl);
    ok('GET /uploads 回读图片', img.status === 200 && (img.headers.get('content-type') || '').startsWith('image/'), `HTTP ${img.status}`);
    await req(`/api/questions/${encodeURIComponent(withImage.data.question.id)}`, { method: 'DELETE' });
  }

  const page = await req('/');
  ok('认证后静态首页', page.status === 200 && page.text.includes('知错'));
  const js = await req('/js/app.js');
  ok('静态 JS', js.status === 200 && js.text.includes('import'));

  const exported = await req('/api/export');
  ok('GET /api/export', exported.status === 200 && Array.isArray(exported.data.questions));
  ok('export 无明文 key', !JSON.stringify(exported.data.settings).includes('apiKey'));

  const logout = await req('/logout');
  ok('退出登录', logout.status === 302);
  const afterLogout = await req('/api/stats');
  ok('退出后 API 401', afterLogout.status === 401, `HTTP ${afterLogout.status}`);

  console.log(`\n结果：${passed} 通过，${failed} 失败\n`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
  console.error('Worker 冒烟异常：', err);
  process.exitCode = 1;
});
