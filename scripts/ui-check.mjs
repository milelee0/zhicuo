// 知错 · 浏览器 UI 冒烟测试（通过 Edge CDP，不依赖第三方库）
// 前置：启动 http://127.0.0.1:8787；脚本会自动拉起一个独立 headless Edge
// 用法：node scripts/ui-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import os from 'node:os';

const CDP_PORT = 9223;
const CDP = process.env.CDP_URL || `http://127.0.0.1:${CDP_PORT}`;
const APP = process.env.APP_URL || 'http://127.0.0.1:8787';
const UI_PASSWORD = process.env.UI_PASSWORD || '';
const OUT = path.resolve('docs/shots');
fs.mkdirSync(OUT, { recursive: true });

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startBrowser() {
  const edge = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
  if (!edge) throw new Error('未找到 Edge/Chrome 浏览器');
  const profile = path.join(os.tmpdir(), `zhicuo-ui-check-${Date.now()}`);
  const child = spawn(
    edge,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--disable-extensions',
      '--disable-background-networking',
      `--remote-debugging-port=${CDP_PORT}`,
      '--window-size=1440,1100',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true }
  );
  for (let i = 0; i < 50; i += 1) {
    try {
      await fetch(`${CDP}/json/version`);
      return child;
    } catch {
      await sleep(200);
    }
  }
  throw new Error('浏览器 CDP 启动超时');
}

function stopBrowser(child) {
  if (!child?.pid) return;
  try {
    execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }
}

async function getPageTarget() {
  // 新建一个干净的标签页，避免 edge:// 内部页无法导航
  try {
    const created = await fetch(`${CDP}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
    if (created.ok) return created.json();
  } catch {
    /* 回退到已有页面 */
  }
  const list = await (await fetch(`${CDP}/json/list`)).json();
  return list.find((t) => t.type === 'page' && t.url === 'about:blank') || list.find((t) => t.type === 'page');
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  const events = [];
  const errors = [];
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id) {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
      return;
    }
    events.push(msg);
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params?.exceptionDetails;
      errors.push(`[exception] ${d?.text || ''} ${d?.exception?.description || ''}`.trim());
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
      errors.push(`[console.error] ${(msg.params.args || []).map((a) => a.value || a.description || '').join(' ')}`);
    }
    if (msg.method === 'Log.entryAdded' && msg.params?.entry?.level === 'error') {
      errors.push(`[log] ${msg.params.entry.text}`);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 30000);
    });
  return new Promise((resolve, reject) => {
    ws.addEventListener('open', async () => {
      await send('Page.enable');
      await send('Runtime.enable');
      await send('Log.enable');
      await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
      resolve({ ws, send, events, errors });
    });
    ws.addEventListener('error', reject);
  });
}

async function main() {
  const target = await getPageTarget();
  if (!target) throw new Error('没有找到可用的浏览器页面');
  const cdp = await connect(target.webSocketDebuggerUrl);
  const { send, errors } = cdp;

  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result?.value;
  }

  async function waitFor(expression, timeout = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        if (await evaluate(expression)) return true;
      } catch {
        /* ignore */
      }
      await sleep(300);
    }
    throw new Error(`等待超时：${expression}`);
  }

  async function goto(hash, readySelector) {
    await send('Page.navigate', { url: `${APP}/${hash}` });
    await waitFor(`document.readyState === 'complete'`, 15000);
    if (readySelector) await waitFor(`Boolean(document.querySelector(${JSON.stringify(readySelector)}))`, 20000);
    await sleep(800);
  }

  async function shot(name, fullPage = false) {
    const params = { format: 'png', captureBeyondViewport: fullPage };
    if (fullPage) {
      const metrics = await send('Page.getLayoutMetrics');
      const { width, height } = metrics.cssContentSize;
      params.clip = { x: 0, y: 0, width, height: Math.min(height, 4000), scale: 1 };
    }
    const { data } = await send('Page.captureScreenshot', params);
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
    console.log(`  · 截图 ${name}.png`);
  }

  async function loginIfNeeded() {
    if (!UI_PASSWORD) return;
    await send('Page.navigate', { url: `${APP}/login` });
    await waitFor(`document.readyState === 'complete' && Boolean(document.querySelector('input[name=password]'))`, 20000);
    await evaluate(`(() => {
      document.querySelector('input[name=password]').value = ${JSON.stringify(UI_PASSWORD)};
      document.querySelector('form').submit();
    })()`);
    await waitFor(`location.pathname === '/' && document.readyState === 'complete'`, 20000);
    await sleep(1200);
  }

  const checks = [];
  const check = (name, condition) => {
    checks.push({ name, ok: Boolean(condition) });
    console.log(`  ${condition ? '✓' : '✗'} ${name}`);
  };

  console.log('\nUI 冒烟测试\n');

  await loginIfNeeded();

  // 1. 总览
  await goto('#/dashboard', '#view .page');
  await waitFor(`document.body.innerText.includes('把错题')`, 15000);
  const dashText = await evaluate('document.body.innerText');
  check('总览渲染', dashText.includes('今日复习') && dashText.includes('薄弱知识点'));
  await shot('e2e-dashboard');

  // 2. 错题本 + 详情抽屉
  await goto('#/book', '.bk-card');
  check('错题本卡片', (await evaluate('document.querySelectorAll(".bk-card").length')) > 0);
  await evaluate('document.querySelector(".bk-card").click()');
  await waitFor(`Boolean(document.querySelector('.drawer'))`, 8000);
  await sleep(600);
  const drawerText = await evaluate('document.querySelector(".drawer")?.innerText || ""');
  check('详情抽屉含错因诊断', drawerText.includes('错因诊断'));
  check('详情抽屉含掌握指南', drawerText.includes('掌握指南') || drawerText.includes('知识掌握'));
  await shot('e2e-book-detail');
  await evaluate('document.querySelector(".drawer [data-close]")?.click()');
  await sleep(400);

  // 3. 录入页文本分析
  await goto('#/add', '.intake-card');
  await evaluate('document.querySelector(".intake-tab[data-mode=text]").click()');
  await sleep(300);
  await evaluate(`(() => {
    const ta = document.querySelector('#intake-text');
    ta.value = '已知函数 f(x)=x²−4x+3，求 f(x) 在区间 [0,3] 上的最大值和最小值。';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const work = document.querySelector('#intake-student-work');
    work.value = '我先算对称轴 x=2，得到最小值 f(2)=-1，然后直接说最大值是 f(0)=3，没有比较端点。';
    document.querySelector('#analyze-btn').click();
  })()`);
  await waitFor(
    `Boolean(document.querySelector('.analysis-result-head') || document.querySelector('.analysis-error'))`,
    30000
  );
  const analysisOk = await evaluate(`Boolean(document.querySelector('.analysis-result-head'))`);
  check('AI 演示分析返回', analysisOk);
  if (analysisOk) {
    const analysisText = await evaluate('document.querySelector("#analysis-inner").innerText');
    check('分析含知识掌握评估', analysisText.includes('知识掌握评估'));
    check('分析含掌握指南', analysisText.includes('知识点掌握指南'));
    check('分析含举一反三', analysisText.includes('举一反三'));
    await sleep(3200); // 等 toast 淡出，截图更干净
    await shot('e2e-analysis', true);

    // 保存入库 → 自动打开错题详情 → 删除测试数据
    const idsBefore = await evaluate(
      `fetch('/api/questions?limit=500').then((r) => r.json()).then((d) => (d.items || []).map((q) => q.id))`
    );
    await evaluate('document.querySelector("#save-question").click()');
    await waitFor(`Boolean(document.querySelector('.drawer'))`, 20000);
    check('分析结果可保存入库并打开详情', true);
    const idsAfter = await evaluate(
      `fetch('/api/questions?limit=500').then((r) => r.json()).then((d) => (d.items || []).map((q) => q.id))`
    );
    const addedId = idsAfter.find((id) => !idsBefore.includes(id));
    if (addedId) {
      const deleted = await evaluate(
        `fetch('/api/questions/${encodeURIComponent(addedId)}', { method: 'DELETE' }).then((r) => r.status)`
      );
      check('清理测试题目', deleted === 200);
    } else {
      check('清理测试题目', false, '没有找到新增题目');
    }
  } else {
    console.log('  分析错误：', await evaluate('document.querySelector("#analysis-inner").innerText'));
  }

  // 4. 举一反三：开始练习 → 看答案
  await goto('#/practice', '.pr-start');
  await evaluate('document.querySelector(".pr-start").click()');
  await waitFor(`Boolean(document.querySelector('[data-act="reveal"]') || document.querySelector('.pr-empty'))`, 20000);
  const hasQuestion = await evaluate(`Boolean(document.querySelector('[data-act="reveal"]'))`);
  check('练习题目加载', hasQuestion);
  if (hasQuestion) {
    await shot('e2e-practice-question');
    await evaluate('document.querySelector(\'[data-act="reveal"]\').click()');
    await waitFor(`Boolean(document.querySelector('[data-result="mastered"]'))`, 8000);
    check('答案与自评按钮出现', true);
    await shot('e2e-practice-answer');
  }

  // 5. 组卷打印
  await goto('#/paper', '.ps-title');
  check('组卷 A4 预览', (await evaluate('document.querySelectorAll(".ps-title").length')) > 0);
  await shot('e2e-paper');

  // 6. 掌握度
  await goto('#/mastery', '#view .page');
  await waitFor(`document.body.innerText.includes('掌握度')`, 12000);
  check('掌握度页面', (await evaluate('document.body.innerText')).includes('知识掌握评估'));
  await shot('e2e-mastery');

  // 7. 设置
  await goto('#/settings', '#ai-form');
  check('设置页 AI 表单', (await evaluate('document.querySelectorAll("#ai-form input").length')) >= 3);
  await shot('e2e-settings');

  // 8. 打印媒体：只保留试卷
  await goto('#/paper', '.ps-title');
  await send('Emulation.setEmulatedMedia', { media: 'print' });
  await sleep(500);
  const printState = await evaluate(`({
    sidebar: getComputedStyle(document.querySelector('#sidebar')).display,
    topbar: getComputedStyle(document.querySelector('#topbar')).display,
    sheet: getComputedStyle(document.querySelector('.print-sheet')).display
  })`);
  check('打印媒体隐藏侧栏/顶栏', printState.sidebar === 'none' && printState.topbar === 'none');
  check('打印媒体保留试卷', printState.sheet !== 'none');
  await shot('e2e-print-preview');
  await send('Emulation.setEmulatedMedia', { media: 'screen' });

  // 9. 练习册导出（PDF / PNG）
  const dlDir = path.join(OUT, 'downloads');
  fs.mkdirSync(dlDir, { recursive: true });
  fs.readdirSync(dlDir).forEach((f) => fs.rmSync(path.join(dlDir, f), { force: true }));
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir, eventsEnabled: true });
  const exportResult = await evaluate(`(async () => {
    const m = await import('/js/exporter.js');
    const questions = [
      { text: '已知函数 f(x)=x²−4x+3，求 f(x) 在 [0,3] 上的最值。', answer: '最大值 3，最小值 −1', analysis: '对称轴 x=2，比较端点与顶点。', subject: '数学', difficulty: 3, knowledgePoints: ['二次函数'], errorType: '概念不清', errorReason: '忽略端点比较', knowledgeGuide: [{ point: '二次函数最值', concept: '闭区间最值要比较顶点和端点。', keyPoints: ['先求对称轴', '再比端点'], pitfalls: ['只算顶点'] }] },
      { text: '求 1+1 的值。', answer: '2', analysis: '按加法定义。', subject: '数学', difficulty: 1, knowledgePoints: ['整数加法'] }
    ];
    const pdf = await m.exportQuestionSet({ title: '导出测试卷', subtitle: '自动化测试', questions, includeAnswers: true, format: 'pdf', filename: 'ui-check-export' });
    const png = await m.exportQuestionSet({ title: '导出测试卷', questions, includeAnswers: false, format: 'png', filename: 'ui-check-export-png' });
    return { pdf, png };
  })()`, true);
  await sleep(2500);
  const downloads = fs.readdirSync(dlDir);
  check('导出 PDF 文件', downloads.some((f) => f.endsWith('.pdf')));
  check('导出 PNG 图片', downloads.some((f) => f.endsWith('.png')));
  const pdfFile = downloads.find((f) => f.endsWith('.pdf'));
  if (pdfFile) {
    const buf = fs.readFileSync(path.join(dlDir, pdfFile));
    check('PDF 文件头正确', buf.subarray(0, 5).toString() === '%PDF-');
  }
  const pngFile = downloads.find((f) => f.endsWith('.png'));
  if (pngFile) {
    const buf = fs.readFileSync(path.join(dlDir, pngFile));
    check('PNG 文件头正确', buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a');
  }

  // 10. 照片本地存储（仅 Cloudflare 版：题目元数据在云端，图片 IndexedDB）
  if (UI_PASSWORD) {
    const localImageResult = await evaluate(`(async () => {
      const store = await import('/js/imageStore.js');
      const { api } = await import('/js/api.js');
      const dataUrl = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
      const imageId = await store.saveLocalImage(dataUrl);
      const created = await api.createQuestion({
        text: '本地照片存储测试（自动清理）',
        answer: '略',
        subject: '数学',
        imageUrl: store.localImageRef(imageId)
      });
      const fetched = await api.question(created.question.id);
      const hydrated = String(fetched.question.imageUrl || '').startsWith('data:image/');
      await api.deleteQuestion(created.question.id);
      await store.deleteLocalImage(imageId);
      return { hydrated, imageUrl: String(fetched.question.imageUrl || '').slice(0, 20) };
    })()`);
    check('照片本地存储并回填', localImageResult?.hydrated, JSON.stringify(localImageResult));
  }

  // 11. 移动端总览
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await goto('#/dashboard', '#view .page');
  await sleep(600);
  check('移动端侧栏变底部导航', await evaluate(`getComputedStyle(document.querySelector('.sidebar')).position === 'fixed'`));
  check(
    '移动端搜索图标可见',
    await evaluate(`(() => {
      const box = document.querySelector('#search-trigger [data-icon]');
      if (!box) return false;
      const r = box.getBoundingClientRect();
      return getComputedStyle(box).display !== 'none' && r.width > 8 && r.height > 8;
    })()`)
  );
  await shot('e2e-mobile-dashboard');

  const failed = checks.filter((c) => !c.ok);
  console.log(`\nUI 检查：${checks.length - failed.length}/${checks.length} 通过`);
  if (errors.length) {
    console.log('\n捕获到前端错误：');
    [...new Set(errors)].slice(0, 20).forEach((e) => console.log('  -', e));
  } else {
    console.log('\n未捕获到前端 JS 错误');
  }
  cdp.ws.close();
  process.exitCode = failed.length || errors.length ? 1 : 0;
}

main().catch((err) => {
  console.error('\nUI 冒烟异常：', err);
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 200);
});
