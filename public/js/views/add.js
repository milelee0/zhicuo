// 知错 · 录入错题（拍照 / 粘贴 / 文本 → AI 识别诊断 → 入库）
import { api, fileToDataUrl } from '../api.js';
import { saveLocalImage, localImageRef } from '../imageStore.js';
import {
  $,
  $$,
  escapeHtml,
  icon,
  toast,
  openModal,
  difficultyLabel,
  subjectClass,
  loadingBlock,
} from '../ui.js';

const SAMPLE_TEXT =
  '已知函数 f(x) = x² − 4x + 3，求 f(x) 在区间 [0, 3] 上的最大值和最小值。';

const SUBJECTS = ['数学', '物理', '化学', '英语', '语文', '生物', '历史', '地理', '政治'];
const GRADES = ['高一', '高二', '高三'];
const ERROR_TYPES = ['概念不清', '审题失误', '计算失误', '方法不当', '迁移不足', '表达不规范', '其他'];
const MASTERY_LEVELS = ['未掌握', '薄弱', '基本掌握', '熟练'];

const STEP_LABELS = ['识读题目文字', '拆解考点与难度', '诊断错因', '生成掌握指南与变式'];

let state = null;
let cleanupFns = [];
let timers = [];

function cleanupAll() {
  cleanupFns.forEach((fn) => {
    try {
      fn();
    } catch (err) {
      console.error(err);
    }
  });
  cleanupFns = [];
  timers.forEach((t) => clearTimeout(t) || clearInterval(t));
  timers = [];
}

function options(list, current) {
  return list.map((s) => `<option value="${escapeHtml(s)}" ${s === current ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('');
}

function difficultyButtons(current = 3) {
  return [1, 2, 3, 4, 5]
    .map(
      (n) =>
        `<button type="button" data-diff="${n}" class="${Number(current) === n ? 'active' : ''}">
          <span class="diff-dots">${Array.from({ length: n }, () => '<i class="on"></i>').join('')}${Array.from(
            { length: 5 - n },
            () => '<i></i>'
          ).join('')}</span>
          <span>${difficultyLabel(n)}</span>
        </button>`
    )
    .join('');
}

function stepBar(active) {
  const items = [
    ['01', '题目'],
    ['02', 'AI 诊断'],
    ['03', '入库'],
  ];
  return `<ol class="flow-steps">
    ${items
      .map(
        ([no, label], i) => `<li class="${i + 1 < active ? 'done' : i + 1 === active ? 'active' : ''}">
          <span class="flow-no">${no}</span><span>${label}</span>
        </li>`
      )
      .join('<li class="flow-line"></li>')}
  </ol>`;
}

function emptyAnalysis() {
  return `<div class="analysis-empty">
    <div class="empty-diagram" aria-hidden="true">
      <div class="sheet">
        <span class="sheet-line w80"></span><span class="sheet-line w95"></span><span class="sheet-line w60"></span>
        <span class="sheet-mark">×</span>
        <span class="sheet-circle"></span>
      </div>
      <div class="lens">${icon('search', 26)}</div>
      <span class="float-tag t1">错因</span>
      <span class="float-tag t2">知识点</span>
      <span class="float-tag t3">变式</span>
    </div>
    <h3 class="analysis-empty-title">让 AI 先替你看一眼</h3>
    <p class="analysis-empty-desc">
      拍下题目和你写错的步骤，AI 会识别题干、给出完整解答，判断错因，并整理对应课本知识点的掌握指南。
    </p>
    <div class="empty-feature-row">
      <span>${icon('brain', 15)} 错因诊断</span>
      <span>${icon('layers', 15)} 知识点</span>
      <span>${icon('practice', 15)} 举一反三</span>
    </div>
  </div>`;
}

function renderAnalyzing() {
  return `<div class="analyzing">
    <div class="scan-visual" aria-hidden="true">
      <div class="scan-page">
        <div class="scan-head"></div>
        <div class="scan-line l1"></div><div class="scan-line l2"></div><div class="scan-line l3"></div>
        <div class="scan-line l4"></div><div class="scan-line l5"></div>
        <div class="scan-beam"></div>
      </div>
      <span class="scan-badge">${icon('spark', 16)} AI 研读中</span>
    </div>
    <h3 class="analyzing-title">正在把这道题拆开看</h3>
    <ol class="ai-steps">
      ${STEP_LABELS.map(
        (label, i) => `<li data-step="${i}">
          <span class="step-dot"></span>
          <span class="step-label">${label}</span>
          <span class="step-state">${i === 0 ? '进行中' : '等待'}</span>
        </li>`
      ).join('')}
    </ol>
    <p class="analyzing-note">通常需要 5–20 秒，请不要关闭页面</p>
  </div>`;
}

function analysisError(message, extra = '') {
  return `<div class="analysis-error">
    <div class="error-art">${icon('alert', 26)}</div>
    <h3>这次没读懂</h3>
    <p>${escapeHtml(message)}</p>
    ${extra}
    <div class="row" style="justify-content:center;margin-top:16px">
      <button class="btn btn-line btn-sm" id="err-retry">${icon('refresh', 15)} 再试一次</button>
      <a class="btn btn-ghost btn-sm" href="#/settings">检查 AI 设置</a>
    </div>
  </div>`;
}

function renderAnalysis(analysis, meta) {
  const guide = Array.isArray(analysis.knowledgeGuide) ? analysis.knowledgeGuide : [];
  const variants = Array.isArray(analysis.variants) ? analysis.variants : [];
  const isDemo = meta?.engine === 'demo' || analysis.engine === 'demo';
  const demoBanner = isDemo
    ? `<div class="demo-banner">
        ${icon('spark', 15)}
        <span>当前为<strong>演示分析</strong>：结果由内置教研规则生成，并非真实识别。配置 AI 密钥后可获得针对你作答步骤的诊断。</span>
        <a href="#/settings">去配置</a>
      </div>`
    : '';
  const engineBadge = isDemo
    ? '<span class="badge badge-gold">演示分析</span>'
    : `<span class="badge badge-sage">${icon('spark', 12)} ${escapeHtml(meta?.model || 'AI 已分析')}</span>`;

  return `${demoBanner}
  <div class="analysis-result-head">
    <div>
      <div class="analysis-kicker">AI DIAGNOSIS / 解析结果 ${engineBadge}</div>
      <h2 class="analysis-title">先看错因，再看答案</h2>
    </div>
    <div class="row gap-6">
      <button class="btn btn-ghost btn-sm" id="reanalyze">${icon('refresh', 15)} 重新分析</button>
    </div>
  </div>

  <div class="analysis-form">
    <section class="af-section">
      <div class="af-sec-head"><span class="af-no">01</span><h3>题目</h3><span class="af-hint">识别结果可直接修改</span></div>
      <div class="field">
        <textarea class="textarea af-text" id="af-text" rows="4" placeholder="题目文字">${escapeHtml(analysis.recognizedText || '')}</textarea>
      </div>
      <div class="af-grid-3">
        <div class="field">
          <label class="label">学科</label>
          <select class="select" id="af-subject">${options(SUBJECTS, analysis.subject)}</select>
        </div>
        <div class="field">
          <label class="label">年级</label>
          <select class="select" id="af-grade">${options(GRADES, analysis.grade)}</select>
        </div>
        <div class="field">
          <label class="label">来源</label>
          <input class="input" id="af-source" placeholder="如：期中卷 第 12 题" value="" />
        </div>
      </div>
      <div class="field">
        <label class="label">难度 <span class="hint">${escapeHtml(analysis.difficultyReason || '')}</span></label>
        <div class="segmented diff-seg" id="af-difficulty">${difficultyButtons(analysis.difficulty)}</div>
      </div>
      <div class="field">
        <label class="label">知识点 <span class="hint">用逗号或顿号分隔</span></label>
        <input class="input" id="af-tags" value="${escapeHtml((analysis.knowledgePoints || []).join('、'))}" />
        <div class="tag-row mt-8" id="af-tag-preview">${(analysis.knowledgePoints || [])
          .map((t) => `<span class="tag tag-blue">${escapeHtml(t)}</span>`)
          .join('')}</div>
      </div>
    </section>

    <section class="af-section">
      <div class="af-sec-head"><span class="af-no">02</span><h3>解答</h3><span class="af-hint">最终答案与分步解析</span></div>
      <div class="field">
        <label class="label">正确答案</label>
        <textarea class="textarea answer-text" id="af-answer" rows="2">${escapeHtml(analysis.answer || '')}</textarea>
      </div>
      <div class="field">
        <label class="label">分步解析</label>
        <textarea class="textarea" id="af-analysis" rows="5">${escapeHtml(analysis.analysis || '')}</textarea>
      </div>
      <div class="field">
        <label class="label">易错点 <span class="hint">每行一条</span></label>
        <textarea class="textarea" id="af-mistakes" rows="2">${escapeHtml((analysis.commonMistakes || []).join('\n'))}</textarea>
      </div>
    </section>

    <section class="af-section af-error-section">
      <div class="af-sec-head"><span class="af-no red">03</span><h3>错因诊断</h3><span class="af-hint">像老师一样在错处画圈</span></div>
      <div class="field">
        <label class="label">我的解题过程 <span class="hint">AI 会对照你的步骤分析</span></label>
        <textarea class="textarea" id="af-student-work" rows="3" placeholder="你当时的思路、错误答案或卡点">${escapeHtml(
          analysis.studentWork || ''
        )}</textarea>
      </div>
      <div class="field">
        <label class="label">错因类型</label>
        <select class="select" id="af-error-type">
          ${options(ERROR_TYPES, analysis.errorType || '概念不清')}
        </select>
      </div>
      <div class="field">
        <label class="label">错因剖析</label>
        <textarea class="textarea" id="af-error-reason" rows="3">${escapeHtml(analysis.errorReason || '')}</textarea>
      </div>
      <div class="field">
        <label class="label">掌握指导</label>
        <textarea class="textarea" id="af-remedy" rows="3">${escapeHtml(analysis.remedy || '')}</textarea>
      </div>
    </section>

    <section class="af-section">
      <div class="af-sec-head"><span class="af-no">04</span><h3>知识掌握评估</h3><span class="af-hint">从解题过程，看你真正会到哪一步</span></div>
      <div class="assess-list" id="af-assess">
        ${
          (analysis.masteryAssessment || []).length
            ? analysis.masteryAssessment.map((a, i) => assessCard(a, i)).join('')
            : '<p class="muted small">AI 暂未生成掌握评估，可补上解题过程后重新分析。</p>'
        }
      </div>
      <div class="field" style="margin-top:14px">
        <label class="label">下一步针对性建议</label>
        <textarea class="textarea targeted-advice" id="af-targeted-advice" rows="3" placeholder="先补哪个概念、做哪类题、怎么自检">${escapeHtml(
          analysis.targetedAdvice || ''
        )}</textarea>
      </div>
    </section>

    <section class="af-section">
      <div class="af-sec-head"><span class="af-no">05</span><h3>知识点掌握指南</h3><span class="af-hint">回到课本，把概念补上</span></div>
      <div class="guide-list" id="af-guides">
        ${
          guide.length
            ? guide.map((g, i) => guideCard(g, i)).join('')
            : '<p class="muted small">AI 暂未生成掌握指南，可在保存后于错题详情查看。</p>'
        }
      </div>
    </section>

    <section class="af-section">
      <div class="af-sec-head"><span class="af-no">06</span><h3>举一反三</h3><span class="af-hint">已生成 ${
        variants.length
      } 道变式题，可勾选入库</span></div>
      <div class="variant-list" id="af-variants">
        ${variants.length ? variants.map((v, i) => variantCard(v, i)).join('') : '<p class="muted small">暂未生成变式题。</p>'}
      </div>
    </section>

    <div class="save-bar">
      <div class="save-meta">
        ${icon('bookOpen', 18)}
        <div><strong>确认入库</strong><span>之后可在错题本中复习、组卷与追踪掌握度</span></div>
      </div>
      <div class="row">
        <button class="btn btn-ghost" id="discard">放弃</button>
        <button class="btn btn-red btn-lg" id="save-question">${icon('check', 18)} 保存到错题本</button>
      </div>
    </div>
  </div>`;
}

function guideCard(g, i) {
  return `<article class="guide-card" data-guide="${i}">
    <div class="guide-head">
      <span class="guide-index">${String(i + 1).padStart(2, '0')}</span>
      <input class="guide-point" data-g="point" value="${escapeHtml(g.point || '')}" placeholder="知识点名称" />
      <span class="tag tag-sage">课本要点</span>
    </div>
    <div class="field">
      <label class="label">概念复述</label>
      <textarea class="textarea" data-g="concept" rows="2">${escapeHtml(g.concept || '')}</textarea>
    </div>
    <div class="guide-cols">
      <div class="field">
        <label class="label">必须掌握 <span class="hint">每行一条</span></label>
        <textarea class="textarea" data-g="keyPoints" rows="3">${escapeHtml((g.keyPoints || []).join('\n'))}</textarea>
      </div>
      <div class="field">
        <label class="label">常见陷阱 <span class="hint">每行一条</span></label>
        <textarea class="textarea" data-g="pitfalls" rows="3">${escapeHtml((g.pitfalls || []).join('\n'))}</textarea>
      </div>
    </div>
    <div class="field">
      <label class="label">自检清单 <span class="hint">每行一条，能打勾才算掌握</span></label>
      <textarea class="textarea" data-g="checklist" rows="2">${escapeHtml((g.checklist || []).join('\n'))}</textarea>
    </div>
  </article>`;
}

function levelClass(level) {
  return { 未掌握: 'none', 薄弱: 'weak', 基本掌握: 'ok', 熟练: 'good' }[level] || 'weak';
}

function assessCard(a, i) {
  const level = MASTERY_LEVELS.includes(a.level) ? a.level : '薄弱';
  return `<article class="assess-card level-${levelClass(level)}" data-assess="${i}">
    <div class="assess-head">
      <span class="assess-index">${String(i + 1).padStart(2, '0')}</span>
      <input class="assess-point" data-a="point" value="${escapeHtml(a.point || '')}" placeholder="知识点名称" />
      <select class="select assess-level" data-a="level" aria-label="掌握等级">
        ${MASTERY_LEVELS.map((lv) => `<option value="${lv}" ${lv === level ? 'selected' : ''}>${lv}</option>`).join('')}
      </select>
    </div>
    <div class="assess-row">
      <div class="field">
        <label class="label">解题步骤中的证据</label>
        <textarea class="textarea" data-a="evidence" rows="2" placeholder="你写到哪一步、哪里出现了偏差">${escapeHtml(
          a.evidence || ''
        )}</textarea>
      </div>
      <div class="field">
        <label class="label">具体知识缺口</label>
        <textarea class="textarea" data-a="gap" rows="2" placeholder="缺的是概念、方法还是计算">${escapeHtml(a.gap || '')}</textarea>
      </div>
    </div>
    <div class="field">
      <label class="label">针对这个缺口，这样补</label>
      <textarea class="textarea" data-a="microLesson" rows="2" placeholder="2-4 句微型讲解">${escapeHtml(
        a.microLesson || ''
      )}</textarea>
    </div>
  </article>`;
}

function variantCard(v, i) {
  return `<article class="variant-card" data-variant="${i}">
    <div class="variant-head">
      <div class="row"><span class="variant-no">变式 ${String(i + 1).padStart(2, '0')}</span>
      <span class="tag tag-muted">举一反三</span></div>
      <label class="switch"><input type="checkbox" data-v="include" checked /><span class="track"></span>收入错题本</label>
    </div>
    <textarea class="textarea" data-v="text" rows="3">${escapeHtml(v.text || '')}</textarea>
    <div class="variant-meta">
      <div class="field"><label class="label">答案</label><textarea class="textarea" data-v="answer" rows="2">${escapeHtml(
        v.answer || ''
      )}</textarea></div>
      <div class="field"><label class="label">解析</label><textarea class="textarea" data-v="analysis" rows="2">${escapeHtml(
        v.analysis || ''
      )}</textarea></div>
    </div>
    <div class="field"><label class="label">提示</label><input class="input" data-v="hint" value="${escapeHtml(v.hint || '')}" /></div>
    <div class="field"><label class="label">针对知识点</label><input class="input" data-v="point" value="${escapeHtml(
      v.point || ''
    )}" placeholder="该变式主要练哪个知识点" /></div>
  </article>`;
}

function shell(meta) {
  const subjects = meta?.subjects?.length ? meta.subjects : SUBJECTS;
  const grades = meta?.grades?.length ? meta.grades : GRADES;
  return `<div class="page add-page">
    <header class="page-head">
      <div>
        <div class="page-kicker">INTAKE / 拍照录入</div>
        <h1 class="page-title">拍下来，<em>弄懂它</em>。</h1>
        <p class="page-sub">拍摄课本、练习册或试卷上的错题（连同你的作答），AI 会识别题目、完整解答、诊断错因，并给出对应课本知识点的掌握指南。</p>
      </div>
      <div class="page-actions">${stepBar(1)}</div>
    </header>

    <div class="add-layout">
      <section class="card intake-card" id="intake-card">
        <div class="intake-head">
          <div class="intake-tabs" role="tablist">
            <button class="intake-tab active" data-mode="photo" role="tab">${icon('camera', 17)} 拍照 / 图片</button>
            <button class="intake-tab" data-mode="text" role="tab">${icon('pen', 16)} 输入文字</button>
          </div>
          <span class="badge badge-muted" id="ai-mode-badge">AI 待命</span>
        </div>

        <div class="intake-body">
          <div class="photo-panel" id="photo-panel">
            <div class="drop-zone" id="drop-zone" tabindex="0" role="button" aria-label="上传错题图片">
              <input type="file" id="file-input" accept="image/*" capture="environment" hidden />
              <div class="drop-icon">${icon('camera', 26)}</div>
              <p class="drop-title">拍一张错题照片</p>
              <p class="drop-desc">支持课本、练习册、试卷；把题干和你的作答一起拍进去，诊断会更准。</p>
              <div class="drop-actions">
                <button type="button" class="btn btn-line btn-sm" id="pick-file">${icon('image', 15)} 选择图片</button>
                <button type="button" class="btn btn-ghost btn-sm" id="use-camera">${icon('camera', 15)} 打开摄像头</button>
              </div>
              <p class="drop-tip">也可以直接 <kbd class="kbd">Ctrl V</kbd> 粘贴截图，或拖拽图片到这里</p>
            </div>
            <div class="photo-preview" id="photo-preview" hidden>
              <div class="photo-frame"><img id="photo-img" alt="待分析的错题照片" /></div>
              <div class="photo-side">
                <div class="photo-ok">${icon('circle-check', 16)} 图片已就绪</div>
                <p class="small muted">请确认题目与作答清晰可见。拍摄时尽量正对页面、避免反光。</p>
                <div class="row">
                  <button class="btn btn-line btn-sm" id="replace-photo">${icon('refresh', 14)} 换一张</button>
                  <button class="btn btn-ghost btn-sm" id="remove-photo">${icon('trash', 14)} 移除</button>
                </div>
              </div>
            </div>
          </div>

          <div class="text-panel" id="text-panel" hidden>
            <div class="field">
              <label class="label">题目文字 <span class="hint"><span id="char-count">0</span> / 1200</span></label>
              <textarea class="textarea intake-text" id="intake-text" rows="8" maxlength="1200"
                placeholder="把题目和你的错误答案一起输入，AI 会据此诊断错因。例如：&#10;已知函数 f(x)=x²−4x+3，求 f(x) 在 [0,3] 上的最值。&#10;我的答案：最小值 0，最大值 3（错了）"></textarea>
            </div>
            <button class="btn btn-ghost btn-sm" id="fill-sample">${icon('spark', 14)} 填入一道示例题</button>
          </div>

          <div class="intake-meta">
            <div class="field">
              <label class="label">学科 <span class="hint">可留空自动识别</span></label>
              <select class="select" id="intake-subject"><option value="">自动识别</option>${options(subjects, '')}</select>
            </div>
            <div class="field">
              <label class="label">年级</label>
              <select class="select" id="intake-grade"><option value="">自动识别</option>${options(grades, '')}</select>
            </div>
          </div>

          <div class="field student-work-field">
            <label class="label">我的解题过程 <span class="hint">选填 · 强烈建议，诊断更准</span></label>
            <textarea class="textarea" id="intake-student-work" rows="3" maxlength="1500"
              placeholder="写下你当时的思路、错误答案或卡在哪一步。例如：我先求导，令 f'(x)=0，得到 x=2，然后直接说最小值是 f(2)…"></textarea>
            <p class="field-hint">拍照里已包含你的作答时可以留空，AI 会从笔迹中读取解题步骤。</p>
          </div>

          <div class="field">
            <label class="label">题目来源 <span class="hint">选填</span></label>
            <input class="input" id="intake-source" placeholder="如：数学练习册 P42 · 第 8 题" maxlength="80" />
          </div>

          <div class="intake-tip">
            ${icon('brain', 16)}
            <span>AI 会结合你写错的步骤判断错因，并整理该知识点在课本中的概念、要点与常见陷阱。</span>
          </div>
        </div>

        <footer class="intake-foot">
          <span class="demo-note" id="demo-note">未配置 AI 时将以演示模式给出示例解析</span>
          <button class="btn btn-red btn-lg" id="analyze-btn" disabled>${icon('spark', 18)} 开始 AI 诊断</button>
        </footer>
      </section>

      <section class="card analysis-card" id="analysis-card">
        <div class="analysis-card-inner" id="analysis-inner">${emptyAnalysis()}</div>
      </section>
    </div>
  </div>`;
}

function setStepBar(root, step) {
  const bar = root.querySelector('.flow-steps');
  if (!bar) return;
  const items = Array.from(bar.children).filter((el) => el.tagName === 'LI' && !el.classList.contains('flow-line'));
  items.forEach((li, i) => {
    li.classList.toggle('done', i + 1 < step);
    li.classList.toggle('active', i + 1 === step);
  });
}

function updateAnalyzeButton(root) {
  const btn = root.querySelector('#analyze-btn');
  if (!btn) return;
  const hasText = state.mode === 'text' ? state.text.trim().length > 2 : Boolean(state.imageDataUrl);
  btn.disabled = !hasText;
}

function setPhoto(root, dataUrl) {
  state.imageDataUrl = dataUrl;
  const preview = root.querySelector('#photo-preview');
  const zone = root.querySelector('#drop-zone');
  const img = root.querySelector('#photo-img');
  if (dataUrl) {
    img.src = dataUrl;
    preview.hidden = false;
    zone.hidden = true;
  } else {
    img.removeAttribute('src');
    preview.hidden = true;
    zone.hidden = false;
  }
  updateAnalyzeButton(root);
}

async function acceptFile(root, file) {
  if (!file) return;
  try {
    const dataUrl = await fileToDataUrl(file);
    setPhoto(root, dataUrl);
    toast('图片已就绪，可以开始诊断', 'success');
  } catch (err) {
    toast(err.message || '图片读取失败', 'error');
  }
}

function openCamera(root) {
  if (!navigator.mediaDevices?.getUserMedia) {
    toast('当前浏览器不支持摄像头，请使用选择图片', 'info');
    root.querySelector('#file-input')?.click();
    return;
  }
  const body = document.createElement('div');
  body.className = 'camera-modal';
  body.innerHTML = `<div class="camera-stage"><video autoplay playsinline muted></video><span class="camera-hint">把题目放进画面，保持稳定</span></div>
    <canvas hidden></canvas>
    <p class="small muted mt-8">若无法调用摄像头，可取消后使用系统相机上传。</p>`;
  const video = body.querySelector('video');
  let stream = null;
  const modal = openModal({
    title: '拍摄错题',
    subtitle: 'CAMERA / 对准页面',
    body,
    width: 640,
    actions: [
      { label: '取消', type: 'ghost' },
      {
        label: '拍下这一页',
        type: 'primary',
        close: false,
        onClick: async (entry) => {
          const canvas = body.querySelector('canvas');
          const w = video.videoWidth;
          const h = video.videoHeight;
          if (!w || !h) {
            toast('画面还没准备好，请稍等一秒', 'info');
            return false;
          }
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(video, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
          setPhoto(root, dataUrl);
          entry.close();
          toast('已拍下，可以开始诊断', 'success');
          return false;
        },
      },
    ],
    onClose: () => {
      stream?.getTracks().forEach((t) => t.stop());
    },
  });
  navigator.mediaDevices
    .getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
    .then((s) => {
      stream = s;
      video.srcObject = s;
      video.play().catch(() => {});
    })
    .catch((err) => {
      console.error(err);
      modal.close();
      toast('无法打开摄像头，已切换为选择图片', 'info');
      root.querySelector('#file-input')?.click();
    });
}

function readAnalysisFromDom(root) {
  const guides = $$('.guide-card', root).map((card) => ({
    point: card.querySelector('[data-g="point"]').value.trim(),
    concept: card.querySelector('[data-g="concept"]').value.trim(),
    keyPoints: splitLines(card.querySelector('[data-g="keyPoints"]').value),
    pitfalls: splitLines(card.querySelector('[data-g="pitfalls"]').value),
    checklist: splitLines(card.querySelector('[data-g="checklist"]').value),
  }));
  const assessments = $$('.assess-card', root).map((card) => ({
    point: card.querySelector('[data-a="point"]').value.trim() || '未命名知识点',
    level: card.querySelector('[data-a="level"]').value,
    evidence: card.querySelector('[data-a="evidence"]').value.trim(),
    gap: card.querySelector('[data-a="gap"]').value.trim(),
    microLesson: card.querySelector('[data-a="microLesson"]').value.trim(),
  }));
  const variants = $$('.variant-card', root).map((card) => {
    const include = card.querySelector('[data-v="include"]').checked;
    return {
      include,
      text: card.querySelector('[data-v="text"]').value.trim(),
      answer: card.querySelector('[data-v="answer"]').value.trim(),
      analysis: card.querySelector('[data-v="analysis"]').value.trim(),
      hint: card.querySelector('[data-v="hint"]').value.trim(),
      point: card.querySelector('[data-v="point"]').value.trim(),
    };
  });
  const diffBtn = root.querySelector('#af-difficulty button.active');
  return {
    text: root.querySelector('#af-text').value.trim(),
    answer: root.querySelector('#af-answer').value.trim(),
    analysis: root.querySelector('#af-analysis').value.trim(),
    commonMistakes: splitLines(root.querySelector('#af-mistakes').value),
    errorType: root.querySelector('#af-error-type').value,
    errorReason: root.querySelector('#af-error-reason').value.trim(),
    remedy: root.querySelector('#af-remedy').value.trim(),
    studentWork: root.querySelector('#af-student-work').value.trim(),
    masteryAssessment: assessments,
    targetedAdvice: root.querySelector('#af-targeted-advice').value.trim(),
    knowledgeGuide: guides,
    knowledgePoints: splitTags(root.querySelector('#af-tags').value),
    difficulty: Number(diffBtn?.dataset.diff || 3),
    subject: root.querySelector('#af-subject').value,
    grade: root.querySelector('#af-grade').value,
    source: root.querySelector('#af-source').value.trim(),
    variants: variants.filter((v) => v.include && v.text),
  };
}

function splitLines(value) {
  return String(value || '')
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitTags(value) {
  return String(value || '')
    .split(/[,，、;；\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function bindAnalysis(root, ctx, analysis, meta) {
  const inner = root.querySelector('#analysis-inner');
  inner.innerHTML = renderAnalysis(analysis, meta);
  setStepBar(root, 2);

  const tagInput = inner.querySelector('#af-tags');
  const tagPreview = inner.querySelector('#af-tag-preview');
  tagInput?.addEventListener('input', () => {
    tagPreview.innerHTML = splitTags(tagInput.value)
      .map((t) => `<span class="tag tag-blue">${escapeHtml(t)}</span>`)
      .join('');
  });

  $$('.assess-card', inner).forEach((card) => {
    card.querySelector('[data-a="level"]')?.addEventListener('change', (e) => {
      card.classList.remove('level-none', 'level-weak', 'level-ok', 'level-good');
      card.classList.add(`level-${levelClass(e.target.value)}`);
    });
  });

  inner.querySelector('#reanalyze')?.addEventListener('click', () => runAnalyze(root, ctx, true));
  inner.querySelector('#discard')?.addEventListener('click', async () => {
    const ok = await ctx.confirm({
      title: '放弃这次分析？',
      message: '已修改的内容不会保存。',
      confirmText: '放弃',
      danger: true,
    });
    if (!ok) return;
    state.analysis = null;
    inner.innerHTML = emptyAnalysis();
    setStepBar(root, 1);
    root.querySelector('#analyze-btn').disabled = false;
  });

  inner.querySelector('#save-question')?.addEventListener('click', async () => {
    const data = readAnalysisFromDom(inner);
    if (!data.text) {
      toast('题目文字不能为空', 'error');
      return;
    }
    if (!data.answer) {
      toast('请先补上正确答案', 'error');
      return;
    }
    const btn = inner.querySelector('#save-question');
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner" style="border-top-color:#fff"></span> 正在入库…`;
    try {
      const localImages = Boolean(ctx.state?.features?.localImages);
      let localImageUrl = '';
      if (state.imageDataUrl && localImages) {
        const imageId = await saveLocalImage(state.imageDataUrl);
        localImageUrl = localImageRef(imageId);
      }
      const payload = {
        ...data,
        ...(localImageUrl
          ? { imageUrl: localImageUrl }
          : { imageDataUrl: state.imageDataUrl || undefined }),
        aiMeta: { engine: meta?.engine || 'demo', model: meta?.model || '', ms: meta?.ms || 0 },
      };
      const { question } = await api.createQuestion(payload);
      setStepBar(root, 3);
      toast('已收入错题本，开始把它弄懂吧', 'success');
      setTimeout(() => ctx.navigate(`#/book?open=${encodeURIComponent(question.id)}`), 420);
    } catch (err) {
      console.error(err);
      toast(err.message || '保存失败', 'error');
      btn.disabled = false;
      btn.innerHTML = `${icon('check', 18)} 保存到错题本`;
    }
  });
}

async function runAnalyze(root, ctx, isRetry = false) {
  const inner = root.querySelector('#analysis-inner');
  const text = state.text.trim();
  const studentWork = root.querySelector('#intake-student-work')?.value.trim() || '';
  const subject = root.querySelector('#intake-subject').value;
  const grade = root.querySelector('#intake-grade').value;
  const source = root.querySelector('#intake-source').value.trim();
  if (!text && !state.imageDataUrl) {
    toast('请先拍照或输入题目', 'info');
    return;
  }
  setStepBar(root, 2);
  inner.innerHTML = renderAnalyzing();
  const stepEls = $$('.ai-steps li', inner);
  let step = 0;
  const advance = () => {
    stepEls.forEach((li, i) => {
      li.classList.toggle('active', i === step);
      li.classList.toggle('done', i < step);
      const st = li.querySelector('.step-state');
      st.textContent = i < step ? '完成' : i === step ? '进行中' : '等待';
    });
    step = Math.min(STEP_LABELS.length - 1, step + 1);
  };
  advance();
  const timer = setInterval(advance, 900);
  timers.push(timer);

  try {
    const { analysis, meta } = await api.analyze({
      text: text || undefined,
      imageDataUrl: state.imageDataUrl || undefined,
      studentWork: studentWork || undefined,
      subject: subject || undefined,
      grade: grade || undefined,
    });
    clearInterval(timer);
    state.analysis = analysis;
    const finalMeta = { ...meta, engine: meta?.engine || analysis.engine };
    bindAnalysis(root, ctx, analysis, finalMeta);
    if (finalMeta.engine === 'demo') {
      toast('演示模式：已生成示例分析', 'info');
    } else {
      toast('AI 诊断完成，请核对后入库', 'success');
    }
    if (source) {
      const src = root.querySelector('#af-source');
      if (src) src.value = source;
    }
    // 分析结果面板滚入视野（窄屏）
    if (window.innerWidth < 1100) {
      root.querySelector('#analysis-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } catch (err) {
    clearInterval(timer);
    console.error(err);
    const isImage = Boolean(state.imageDataUrl) && !text;
    const extra =
      isImage && (err.status === 422 || /图片|视觉/.test(err.message || ''))
        ? `<div class="row" style="justify-content:center;margin-top:10px"><button class="btn btn-line btn-sm" id="switch-text">${icon('pen', 15)} 改为输入文字</button></div>`
        : '';
    inner.innerHTML = analysisError(err.message || 'AI 分析失败，请稍后重试', extra);
    inner.querySelector('#err-retry')?.addEventListener('click', () => runAnalyze(root, ctx, true));
    inner.querySelector('#switch-text')?.addEventListener('click', () => switchMode(root, 'text'));
  }
}

function switchMode(root, mode) {
  state.mode = mode;
  $$('.intake-tab', root).forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  root.querySelector('#photo-panel').hidden = mode !== 'photo';
  root.querySelector('#text-panel').hidden = mode !== 'text';
  updateAnalyzeButton(root);
}

export async function mount(root, ctx) {
  cleanupAll();
  state = {
    mode: 'photo',
    imageDataUrl: '',
    text: '',
    analysis: null,
    meta: null,
  };
  const meta = ctx.state?.meta || {};
  state.meta = meta;
  root.innerHTML = shell(meta);

  const modeBadge = root.querySelector('#ai-mode-badge');
  const ai = ctx.state?.settings?.ai;
  if (modeBadge) modeBadge.textContent = ai?.mode === 'live' ? `AI · ${ai.model}` : '演示模式';
  if (ai?.mode === 'live') {
    const note = root.querySelector('#demo-note');
    if (note) note.textContent = `已连接 ${ai.model}${ai.visionModel ? ' · 视觉模型 ' + ai.visionModel : ''}`;
  } else {
    root.querySelector('#demo-note').textContent = '未配置 AI 密钥，将以演示模式生成示例分析';
  }

  // tabs
  $$('.intake-tab', root).forEach((btn) => {
    btn.addEventListener('click', () => switchMode(root, btn.dataset.mode));
  });

  // 拍照/上传
  const fileInput = root.querySelector('#file-input');
  root.querySelector('#pick-file')?.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });
  root.querySelector('#use-camera')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openCamera(root);
  });
  root.querySelector('#drop-zone')?.addEventListener('click', () => fileInput.click());
  root.querySelector('#drop-zone')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput?.addEventListener('change', () => {
    acceptFile(root, fileInput.files?.[0]);
    fileInput.value = '';
  });
  const zone = root.querySelector('#drop-zone');
  ['dragenter', 'dragover'].forEach((ev) =>
    zone?.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.add('dragging');
    })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    zone?.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.remove('dragging');
    })
  );
  zone?.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) acceptFile(root, file);
  });
  root.querySelector('#replace-photo')?.addEventListener('click', () => fileInput.click());
  root.querySelector('#remove-photo')?.addEventListener('click', () => setPhoto(root, ''));

  // 文本
  const textarea = root.querySelector('#intake-text');
  const count = root.querySelector('#char-count');
  textarea?.addEventListener('input', () => {
    state.text = textarea.value;
    count.textContent = String(textarea.value.length);
    updateAnalyzeButton(root);
  });
  root.querySelector('#fill-sample')?.addEventListener('click', () => {
    textarea.value = SAMPLE_TEXT;
    textarea.dispatchEvent(new Event('input'));
    toast('已填入示例题目', 'info');
  });

  root.querySelector('#analyze-btn')?.addEventListener('click', () => runAnalyze(root, ctx));

  // 粘贴截图（视图内）
  const onPaste = (e) => {
    if (!root.isConnected) return;
    const item = Array.from(e.clipboardData?.items || []).find((i) => i.type.startsWith('image/'));
    if (!item) return;
    const file = item.getAsFile();
    if (file) {
      e.preventDefault();
      switchMode(root, 'photo');
      acceptFile(root, file);
    }
  };
  document.addEventListener('paste', onPaste);
  cleanupFns.push(() => document.removeEventListener('paste', onPaste));
}

export function destroy() {
  cleanupAll();
}
