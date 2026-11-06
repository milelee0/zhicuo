// 知错 · 端到端冒烟测试（需先启动服务：node server/index.mjs）
// 用法：node scripts/smoke.mjs [baseUrl]
const BASE = process.argv[2] || 'http://127.0.0.1:8787';

let passed = 0;
let failed = 0;

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
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data, headers: res.headers };
}

async function main() {
  console.log(`\n知错 API 冒烟测试 → ${BASE}\n`);

  const health = await req('/api/health');
  ok('GET /api/health', health.status === 200 && health.data.ok === true, `HTTP ${health.status}`);
  ok('AI 状态含 mode', ['live', 'demo'].includes(health.data?.ai?.mode), JSON.stringify(health.data?.ai));

  const boot = await req('/api/bootstrap');
  ok('GET /api/bootstrap', boot.status === 200 && Boolean(boot.data.meta), `HTTP ${boot.status}`);
  ok('meta.subjects 非空', Array.isArray(boot.data?.meta?.subjects) && boot.data.meta.subjects.length > 0);

  const stats = await req('/api/stats');
  ok('GET /api/stats', stats.status === 200 && Boolean(stats.data.totals), `HTTP ${stats.status}`);
  ok('stats.totals.questions 为数字', typeof stats.data?.totals?.questions === 'number');
  ok('stats.activity 长度 14', stats.data?.activity?.length === 14, String(stats.data?.activity?.length));
  ok('stats.forecast 长度 7', stats.data?.forecast?.length === 7, String(stats.data?.forecast?.length));

  const list = await req('/api/questions?limit=5');
  ok('GET /api/questions', list.status === 200 && Array.isArray(list.data.items), `HTTP ${list.status}`);
  const first = list.data?.items?.[0];
  ok('题目含新字段', !first || ('studentWork' in first && 'masteryAssessment' in first && 'targetedAdvice' in first));

  if (first) {
    const detail = await req(`/api/questions/${encodeURIComponent(first.id)}`);
    ok('GET /api/questions/:id', detail.status === 200 && detail.data.question?.id === first.id);
  }

  const analyze = await req('/api/analyze', {
    method: 'POST',
    body: JSON.stringify({
      text: '已知函数 f(x)=x²−4x+3，求 f(x) 在区间 [0,3] 上的最大值和最小值。',
      studentWork: '我先求对称轴 x=2，然后直接说最小值是 f(2)=-1，最大值是 f(0)=3，没有比较端点。',
      subject: '数学',
      grade: '高一',
    }),
  });
  const a = analyze.data?.analysis;
  ok('POST /api/analyze（文本）', analyze.status === 200 && Boolean(a), `HTTP ${analyze.status}`);
  ok('分析含错因字段', Boolean(a?.errorType && a?.errorReason && a?.remedy));
  ok('分析含掌握指南', Array.isArray(a?.knowledgeGuide) && a.knowledgeGuide.length > 0);
  ok('分析含掌握评估', Array.isArray(a?.masteryAssessment) && a.masteryAssessment.length > 0);
  ok('分析含变式题', Array.isArray(a?.variants) && a.variants.length >= 2, String(a?.variants?.length));
  ok('演示模式标记', analyze.data?.meta?.engine === 'demo' || a?.engine === 'demo');

  const imageDemo = await req('/api/analyze', {
    method: 'POST',
    body: JSON.stringify({ imageDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' }),
  });
  ok('POST /api/analyze（图片 demo 应 4xx）', imageDemo.status === 422, `HTTP ${imageDemo.status}`);

  const queue = await req('/api/practice/queue?mode=due&count=5');
  ok('GET /api/practice/queue', queue.status === 200 && Array.isArray(queue.data.items), `HTTP ${queue.status}`);

  const settings = await req('/api/settings');
  ok('GET /api/settings 不回传明文 key', settings.status === 200 && !JSON.stringify(settings.data).includes('"apiKey"'));

  const exportRes = await req('/api/export');
  ok('GET /api/export', exportRes.status === 200 && Array.isArray(exportRes.data.questions));

  // 写入链路：创建 → 自评 → 变式补充（demo 仅验证结构）→ 删除
  const create = await req('/api/questions', {
    method: 'POST',
    body: JSON.stringify({
      text: '冒烟测试题目：求 1+1 的值。',
      answer: '2',
      analysis: '1+1=2。',
      subject: '数学',
      grade: '高一',
      difficulty: 1,
      knowledgePoints: ['冒烟测试'],
      variants: [{ text: '求 2+2 的值。', answer: '4', analysis: '2+2=4。', hint: '按定义相加。' }],
    }),
  });
  ok('POST /api/questions', create.status === 200 && Boolean(create.data.question?.id), `HTTP ${create.status}`);
  const created = create.data?.question;

  if (created) {
    ok('新题 mastery=20 且 status=new', created.mastery === 20 && created.status === 'new');
    const attempt = await req(`/api/questions/${encodeURIComponent(created.id)}/attempts`, {
      method: 'POST',
      body: JSON.stringify({ result: 'mastered', variantId: created.variants?.[0]?.id || null }),
    });
    ok('POST /api/questions/:id/attempts', attempt.status === 200 && attempt.data.delta === 16, `HTTP ${attempt.status}`);
    const patched = await req(`/api/questions/${encodeURIComponent(created.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ notes: '冒烟测试备注' }),
    });
    ok('PATCH /api/questions/:id', patched.status === 200 && patched.data.question?.notes === '冒烟测试备注');
    const deleted = await req(`/api/questions/${encodeURIComponent(created.id)}`, { method: 'DELETE' });
    ok('DELETE /api/questions/:id', deleted.status === 200 && deleted.data.ok === true);
  }

  // 静态资源
  const html = await fetch(BASE + '/');
  const htmlText = await html.text();
  ok('GET / 返回应用页面', html.status === 200 && htmlText.includes('知错'));
  const css = await fetch(BASE + '/css/base.css');
  ok('GET /css/base.css', css.status === 200);

  console.log(`\n结果：${passed} 通过，${failed} 失败\n`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
  console.error('冒烟测试异常：', err);
  process.exit(1);
});
