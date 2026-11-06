// 知错 · 举一反三（变式训练）
// 依赖：api.practiceQueue / api.question / api.attempt；ui 的 escapeHtml / icon / ring / openModal 等；
//       exporter.js 的 exportQuestionSet（Lead 提供，用于导出练习册 PDF / PNG）。

import { api } from '../api.js';
import {
  escapeHtml,
  icon,
  ring,
  openModal,
  fmtDate,
  loadingBlock,
} from '../ui.js';
import { exportQuestionSet } from '../exporter.js';

const SUBJECTS = ['数学', '物理', '化学', '英语', '语文', '生物', '历史', '地理', '政治'];

const MODES = [
  {
    key: 'due',
    name: '今日复习',
    iconName: 'clock',
    desc: '按遗忘曲线到期，先把今天该收的分收回来。',
    tag: '推荐',
  },
  {
    key: 'weak',
    name: '薄弱攻坚',
    iconName: 'target',
    desc: '掌握度低、错得最多的知识点优先出场。',
  },
  {
    key: 'random',
    name: '随机抽练',
    iconName: 'practice',
    desc: '打散顺序随机抽取，检验是不是真的会了。',
  },
  {
    key: 'subject',
    name: '按学科',
    iconName: 'layers',
    desc: '集中一个学科做专项，适合考前突击。',
  },
];

const ASSESS = [
  {
    key: 'mastered',
    label: '已掌握',
    tone: 'sage',
    iconName: 'circle-check',
    kbd: '1',
    delta: 16,
    desc: '能独立讲清每一步',
  },
  {
    key: 'fuzzy',
    label: '有点模糊',
    tone: 'gold',
    iconName: 'alert',
    kbd: '2',
    delta: 4,
    desc: '思路对，细节还不稳',
  },
  {
    key: 'failed',
    label: '还是不会',
    tone: 'red',
    iconName: 'x',
    kbd: '3',
    delta: -8,
    desc: '需要回到原题重看',
  },
];

const ASSESS_MAP = ASSESS.reduce((map, item) => {
  map[item.key] = item;
  return map;
}, {});

// 逐知识点掌握评估的等级配色
const LEVEL_TONE = {
  未掌握: 'red',
  薄弱: 'gold',
  基本掌握: 'blue',
  熟练: 'sage',
};
const WEAK_LEVELS = new Set(['未掌握', '薄弱']);

let instance = null;

export async function mount(root, ctx) {
  if (instance) instance.destroy();
  instance = createView(root, ctx || {});
  await instance.start();
}

export function destroy() {
  if (!instance) return;
  instance.destroy();
  instance = null;
}

function readQuery(ctx) {
  const raw = ctx && ctx.query;
  if (raw && typeof raw === 'object') return raw;
  const out = {};
  const hash = typeof location !== 'undefined' && location.hash ? location.hash : '';
  const mark = hash.indexOf('?');
  if (mark >= 0) {
    const params = new URLSearchParams(hash.slice(mark + 1));
    params.forEach((value, key) => {
      out[key] = value;
    });
  }
  return out;
}

function errText(error) {
  if (!error) return '请求失败，请稍后再试';
  if (typeof error === 'string') return error;
  return error.message || '请求失败，请稍后再试';
}

function pad2(num) {
  return String(num).padStart(2, '0');
}

function dateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function excerpt(text, max) {
  const raw = String(text === null || text === undefined ? '' : text)
    .replace(/\s+/g, ' ')
    .trim();
  return raw.length > max ? `${raw.slice(0, max)}…` : raw;
}

function createView(root, ctx) {
  let disposed = false;
  let cleanupRan = false;
  const cleanups = [];
  const timers = new Set();

  const addCleanup = (fn) => {
    let done = false;
    const wrapped = () => {
      if (done) return;
      done = true;
      try {
        fn();
      } catch (error) {
        /* 清理失败不影响视图卸载 */
      }
    };
    cleanups.push(wrapped);
    if (typeof ctx.onCleanup === 'function') ctx.onCleanup(wrapped);
  };

  const toast = (message, type) => {
    if (typeof ctx.toast === 'function') ctx.toast(message, type);
  };
  const navigate = (hash) => {
    if (typeof ctx.navigate === 'function') ctx.navigate(hash);
    else location.hash = hash;
  };
  const askConfirm = async (options) => {
    if (typeof ctx.confirm === 'function') {
      try {
        return Boolean(await ctx.confirm(options));
      } catch (error) {
        return false;
      }
    }
    return true;
  };

  const wait = (ms) => new Promise((resolve) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      resolve();
    }, ms);
    timers.add(timer);
  });

  const query = readQuery(ctx);
  const details = new Map();

  const S = {
    phase: 'setup',
    bootText: '正在准备题目…',
    mode: 'due',
    count: 10,
    subject: '',
    queue: [],
    index: 0,
    results: [],
    origin: null,
    detail: null,
    detailState: 'idle',
    hintOpen: false,
    answerOpen: false,
    busy: false,
    busyResult: '',
    feedback: null,
    startBusy: false,
    error: '',
    prep: null,
    stats: (ctx.state && ctx.state.stats) || null,
    loadToken: 0,
  };

  // ---------- 基础数据 ----------

  function subjectOptions() {
    const meta = ctx.state && ctx.state.meta;
    const fromMeta = meta && Array.isArray(meta.subjects) ? meta.subjects.filter(Boolean) : [];
    if (fromMeta.length) return fromMeta;
    const fromStats = S.stats && Array.isArray(S.stats.subjects)
      ? S.stats.subjects.map((item) => item.subject).filter(Boolean)
      : [];
    if (fromStats.length) return [...new Set(fromStats)];
    return SUBJECTS.slice();
  }

  function originName() {
    if (!S.origin) return '自由练习';
    if (S.origin.type === 'single') return '单题变式练习';
    const mode = MODES.find((item) => item.key === S.origin.mode);
    return mode ? mode.name : '练习';
  }

  function modeNote() {
    const mode = MODES.find((item) => item.key === S.mode) || MODES[0];
    if (S.mode === 'subject') {
      return `将从「${S.subject || '未选学科'}」中挑 ${S.count} 道题。`;
    }
    return `${mode.name} · ${S.count} 题 · ${mode.desc}`;
  }

  function promptOf(item, detail) {
    if (!item) return '';
    if (item.variant && item.variant.text) return item.variant.text;
    if (detail && detail.text) return detail.text;
    return item.questionText || '';
  }

  function assessmentsOf(detail) {
    const list = detail && Array.isArray(detail.masteryAssessment) ? detail.masteryAssessment : [];
    return list.filter((item) => item && (item.point || item.level));
  }

  function pickVariant(question) {
    const list = question && Array.isArray(question.variants) ? question.variants.filter(Boolean) : [];
    if (!list.length) return null;
    const weakPoints = new Set(
      assessmentsOf(question)
        .filter((item) => WEAK_LEVELS.has(item.level))
        .map((item) => item.point)
        .filter(Boolean)
    );
    const matched = list.find((variant) => variant.point && weakPoints.has(variant.point));
    return matched || list[0];
  }

  function loadStats() {
    api.stats()
      .then((stats) => {
        if (disposed) return;
        if (stats && typeof stats === 'object') S.stats = stats;
        if (S.phase === 'setup') render();
      })
      .catch(() => {
        /* 状态区允许降级为占位，不阻塞练习 */
      });
  }

  // ---------- 渲染：单题模式 · 本题掌握评估 ----------

  function evalItemHtml(item) {
    const tone = LEVEL_TONE[item.level] || 'gold';
    return `<li class="pr-eval-item tone-${tone}">
      <div class="pr-eval-head">
        <span class="pr-eval-point">${escapeHtml(item.point || '知识点')}</span>
        <span class="tag tag-${tone}">${escapeHtml(item.level || '待评估')}</span>
      </div>
      ${item.evidence ? `<p class="pr-eval-line"><b>依据</b>${escapeHtml(item.evidence)}</p>` : ''}
      ${item.gap ? `<p class="pr-eval-line"><b>缺口</b>${escapeHtml(item.gap)}</p>` : ''}
      ${item.microLesson ? `<p class="pr-eval-lesson">${escapeHtml(item.microLesson)}</p>` : ''}
    </li>`;
  }

  function prepHtml() {
    const prep = S.prep || {};
    const question = prep.question || {};
    const assessment = assessmentsOf(question);
    const weak = assessment.filter((item) => WEAK_LEVELS.has(item.level));
    const variant = prep.variant || null;
    const advice = question.targetedAdvice || '';
    const points = Array.isArray(question.knowledgePoints) ? question.knowledgePoints : [];
    return `<div class="page pr-page pr-prep">
      <header class="page-head pr-head">
        <div class="pr-head-main">
          <div class="page-kicker">DIAGNOSIS · 本题掌握评估</div>
          <h1 class="page-title">先看清卡在哪一步</h1>
          <p class="page-sub">系统根据你的解题过程评估了每个知识点。读懂微型讲解，再开始变式练习。</p>
        </div>
        <div class="pr-head-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-act="setup">${icon('arrow-left', 16)}<span>返回模式选择</span></button>
        </div>
      </header>

      <div class="pr-prep-grid">
        <section class="card card-pad pr-prep-card" aria-labelledby="prPrepQuestionTitle">
          <div class="pr-section-head">
            <h2 class="pr-section-title" id="prPrepQuestionTitle">原题</h2>
            <span class="small muted">${escapeHtml(question.subject || '综合')}</span>
          </div>
          <div class="pr-qtag-row">
            ${points.slice(0, 4).map((point) => `<span class="tag tag-blue">${escapeHtml(point)}</span>`).join('')}
            ${question.errorType ? `<span class="tag tag-red">错因 · ${escapeHtml(question.errorType)}</span>` : ''}
          </div>
          <div class="pr-qtext pr-prep-text">${escapeHtml(question.text || '')}</div>
          ${question.studentWork ? `<div class="pr-student-work">
            <span class="label">${icon('pen', 14)} 你的解题过程</span>
            <p>${escapeHtml(question.studentWork)}</p>
          </div>` : ''}
        </section>

        <section class="card card-pad pr-prep-card pr-prep-eval" aria-labelledby="prEvalTitle">
          <div class="pr-section-head">
            <h2 class="pr-section-title" id="prEvalTitle">本题掌握评估</h2>
            <span class="small muted">${assessment.length ? `${assessment.length} 个知识点` : '暂无评估数据'}</span>
          </div>
          ${assessment.length
            ? `<ul class="pr-eval-list">${assessment.map(evalItemHtml).join('')}</ul>`
            : '<p class="small muted pr-prep-empty">这道题暂时没有逐点评估数据，可以直接做一遍变式，把过程写完整。</p>'}
          ${advice ? `<div class="pr-advice">${icon('spark', 16)}<div><b>针对性建议</b><p>${escapeHtml(advice)}</p></div></div>` : ''}
          ${variant ? `<div class="pr-target-note">${icon('target', 16)}<span>本次练习：变式题${variant.point ? `，针对「${escapeHtml(variant.point)}」` : ''}${weak.length ? ` · 薄弱点 ${weak.map((item) => escapeHtml(item.point)).join('、')}` : ''}</span></div>` : '<div class="pr-target-note">' + icon('target', 16) + '<span>这道题还没有变式，将用原题练习。</span></div>'}
          <button type="button" class="btn btn-primary pr-prep-start" data-act="start-single">
            ${icon('practice', 17)}<span>开始变式练习</span>
          </button>
        </section>
      </div>
    </div>`;
  }

  // ---------- 渲染：首页 ----------

  function modeCard(mode) {
    const active = S.mode === mode.key;
    return `<button type="button" class="pr-mode${active ? ' active' : ''}" role="radio" aria-checked="${active}" data-mode="${mode.key}">
      <span class="pr-mode-top">
        <span class="pr-mode-ico">${icon(mode.iconName, 18)}</span>
        ${mode.tag ? `<span class="pr-mode-tag">${escapeHtml(mode.tag)}</span>` : ''}
      </span>
      <span class="pr-mode-name">${escapeHtml(mode.name)}</span>
      <span class="pr-mode-desc">${escapeHtml(mode.desc)}</span>
    </button>`;
  }

  function setupHtml() {
    const stats = S.stats;
    const totals = (stats && stats.totals) || {};
    const due = Number.isFinite(Number(totals.due)) && stats ? Number(totals.due) : null;
    const mastered = Number.isFinite(Number(totals.mastered)) && stats ? Number(totals.mastered) : null;
    const weak = ((stats && stats.knowledge) || [])
      .slice()
      .sort((a, b) => (Number(a.avgMastery) || 0) - (Number(b.avgMastery) || 0))
      .slice(0, 4);
    const subjects = subjectOptions();
    if (S.mode === 'subject' && !S.subject) S.subject = subjects[0] || '';

    return `
    <div class="page pr-page">
      <header class="page-head pr-head">
        <div class="pr-head-main">
          <div class="page-kicker">PRACTICE · 变式训练</div>
          <h1 class="page-title">举一反三</h1>
          <p class="page-sub">同一道错题，换三种问法再练一次。做过不算会，能讲清才算收回分数。</p>
        </div>
        <div class="pr-head-actions">
          <button type="button" class="btn btn-line btn-sm" data-act="export" aria-label="导出练习册">${icon('download', 16)}<span>导出练习册</span></button>
          <span class="pr-head-stamp"><span class="stamp">练</span></span>
        </div>
      </header>

      <div class="pr-setup">
        <section class="card card-pad pr-modes-card" aria-labelledby="prModesTitle">
          <div class="pr-section-head">
            <h2 class="pr-section-title" id="prModesTitle">选择练习方式</h2>
            <span class="small muted">四种模式，选一种开始</span>
          </div>
          <div class="pr-modes" role="radiogroup" aria-label="练习模式">
            ${MODES.map(modeCard).join('')}
          </div>

          <div class="pr-subject-wrap${S.mode === 'subject' ? ' is-open' : ''}"${S.mode === 'subject' ? '' : ' hidden'}>
            <span class="label">练习学科</span>
            <div class="pr-chips">
              ${subjects.map((subject) => `<button type="button" class="chip${S.subject === subject ? ' active' : ''}" data-subject="${escapeHtml(subject)}" aria-pressed="${S.subject === subject}">${escapeHtml(subject)}</button>`).join('')}
            </div>
          </div>

          <div class="pr-count-row">
            <span class="label">题量</span>
            <div class="segmented" role="group" aria-label="练习题量">
              ${[5, 10, 15].map((num) => `<button type="button" data-count="${num}" class="${S.count === num ? 'active' : ''}" aria-pressed="${S.count === num}">${num} 题</button>`).join('')}
            </div>
            <span class="small muted pr-count-tip">建议 10 题一组，专注 15 分钟</span>
          </div>

          ${S.error ? `<div class="pr-alert" role="alert">${icon('alert', 16)}<span>${escapeHtml(S.error)}</span><button type="button" class="btn btn-line btn-sm" data-act="start">重试</button></div>` : ''}
        </section>

        <aside class="pr-side">
          <section class="card card-pad pr-status-card" aria-labelledby="prStatusTitle">
            <div class="pr-section-head">
              <h2 class="pr-section-title" id="prStatusTitle">今天的状态</h2>
              ${icon('flame', 16)}
            </div>
            <div class="pr-status-grid">
              <div class="pr-status-item">
                <span class="pr-status-num mono">${due === null ? '—' : due}</span>
                <span class="small muted">今日待复习</span>
              </div>
              <div class="pr-status-item">
                <span class="pr-status-num mono">${mastered === null ? '—' : mastered}</span>
                <span class="small muted">已掌握题目</span>
              </div>
            </div>
            <div class="divider"></div>
            <div class="pr-weak">
              <span class="label">薄弱知识点</span>
              ${weak.length
                ? `<div class="pr-weak-tags">${weak.map((item) => `<button type="button" class="tag tag-gold pr-weak-tag" data-tag="${escapeHtml(item.tag)}" title="查看该知识点的错题">${escapeHtml(item.tag)}<em>${Math.round(Number(item.avgMastery) || 0)}</em></button>`).join('')}</div>
                   <p class="small muted">掌握度越低越靠前，会自动进入「薄弱攻坚」。</p>`
                : `<p class="small muted">还没有足够的数据判断薄弱点，先录入几道错题吧。</p>`}
            </div>
          </section>

          <button type="button" class="btn btn-primary pr-start" data-act="start"${S.startBusy ? ' disabled' : ''} aria-label="开始练习">
            <span>${S.startBusy ? '正在组题…' : '开始练习'}</span>
            <span class="pr-start-arrow">${icon('arrow-right', 18)}</span>
          </button>
          <p class="small muted pr-start-note">${escapeHtml(modeNote())}</p>
        </aside>
      </div>
    </div>`;
  }

  // ---------- 渲染：练习中 ----------

  function feedbackHtml() {
    const fb = S.feedback;
    if (!fb) return '';
    const preset = ASSESS_MAP[fb.result] || ASSESS_MAP.fuzzy;
    const sign = fb.delta > 0 ? '+' : '';
    return `<div class="pr-feedback" role="status" aria-live="polite">
      <span class="pr-feedback-flag tone-${preset.tone}">${escapeHtml(preset.label)}</span>
      <span class="pr-feedback-delta mono">${sign}${fb.delta} 分</span>
      <span class="pr-feedback-mastery mono">掌握度 ${fb.before} → ${fb.after}</span>
    </div>`;
  }

  function tagsHtml(item, detail) {
    const subject = item.subject || (detail && detail.subject) || '综合';
    const points = detail && Array.isArray(detail.knowledgePoints) ? detail.knowledgePoints : [];
    const variantPoint = item.variant && item.variant.point
      ? `<span class="tag tag-gold">针对 · ${escapeHtml(item.variant.point)}</span>`
      : '';
    return [
      `<span class="tag tag-muted">${escapeHtml(subject)}</span>`,
      item.variant ? '<span class="tag tag-gold">变式题</span>' : '<span class="tag tag-muted">原题</span>',
      variantPoint,
    ]
      .concat(points.slice(0, 3).map((point) => `<span class="tag tag-blue">${escapeHtml(point)}</span>`))
      .join('');
  }

  function questionCardHtml(item) {
    const detail = S.detail || null;
    const tags = tagsHtml(item, detail);
    const errorType = detail && detail.errorType
      ? `<span class="tag tag-red pr-error-tag" title="这道题的错因">错因 · ${escapeHtml(detail.errorType)}</span>`
      : '';

    if (S.detailState === 'loading') {
      return `<section class="card pr-qcard">
        <div class="pr-qcard-body">
          <div class="pr-qtag-row">${tags}</div>
          <div class="pr-skel pr-skel-line"></div>
          <div class="pr-skel pr-skel-line short"></div>
          <div class="pr-skel pr-skel-box"></div>
          <p class="small muted">正在取题…</p>
        </div>
      </section>`;
    }

    if (S.detailState === 'error') {
      return `<section class="card pr-qcard">
        <div class="pr-qcard-body">
          <div class="pr-error-block" role="alert">
            ${icon('alert', 20)}
            <div>
              <strong>题目加载失败</strong>
              <p class="small muted">可能是网络或服务暂时不可用，重试一次即可。</p>
            </div>
          </div>
          <div class="pr-error-actions">
            <button type="button" class="btn btn-line btn-sm" data-act="retry-detail">重新加载</button>
            <button type="button" class="btn btn-ghost btn-sm" data-act="exit">退出练习</button>
          </div>
        </div>
      </section>`;
    }

    const text = promptOf(item, detail);
    const hint = item.variant ? item.variant.hint || '' : '';
    const imageUrl = !item.variant && detail && detail.imageUrl ? detail.imageUrl : '';
    return `<section class="card pr-qcard">
      <div class="pr-qcard-body">
        <div class="pr-qtag-row">
          ${tags}
          ${errorType}
        </div>
        <div class="pr-qtext" tabindex="0">${escapeHtml(text)}</div>
        ${imageUrl ? `<figure class="pr-qimg"><img src="${escapeHtml(imageUrl)}" alt="题目配图" loading="lazy"></figure>` : ''}
        ${S.hintOpen ? `<div class="pr-hint">
            <span class="pr-hint-label">${icon('spark', 14)} 提示</span>
            <p>${escapeHtml(hint || '这道题没有额外提示。先回忆相关知识点，把第一步写下来，再对照答案。')}</p>
          </div>` : ''}
        ${S.answerOpen ? answerHtml(item, detail) : ''}
      </div>
      <div class="pr-qcard-foot">
        ${S.answerOpen ? assessHtml() : `<div class="pr-foot-left">
            <button type="button" class="btn btn-ghost" data-act="hint" aria-expanded="${S.hintOpen}">${icon('eye', 16)}<span>${S.hintOpen ? '收起提示' : '看提示'}</span></button>
            <span class="small muted">先在草稿纸上写完整过程，再看答案</span>
          </div>
          <button type="button" class="btn btn-primary" data-act="reveal">${icon('check', 16)}<span>查看答案</span></button>`}
      </div>
    </section>`;
  }

  function answerHtml(item, detail) {
    const variant = item.variant || null;
    const answer = variant ? variant.answer || '' : (detail && detail.answer) || '';
    const analysis = variant ? variant.analysis || '' : (detail && detail.analysis) || '';
    const mistakes = detail && Array.isArray(detail.commonMistakes) ? detail.commonMistakes.filter(Boolean) : [];
    const errorReason = detail && detail.errorReason ? detail.errorReason : '';
    const remedy = detail && detail.remedy ? detail.remedy : '';
    return `<div class="pr-answer">
      <div class="pr-answer-head">${icon('check', 16)}<span>参考答案</span></div>
      <div class="pr-answer-main">${escapeHtml(answer || '暂无参考答案')}</div>
      <div class="pr-answer-block">
        <h3 class="pr-answer-title">分步解析</h3>
        <p class="pr-answer-text">${escapeHtml(analysis || '暂无解析内容。')}</p>
      </div>
      ${mistakes.length ? `<div class="pr-answer-block">
        <h3 class="pr-answer-title">易错点</h3>
        <ul class="pr-answer-list">${mistakes.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      </div>` : ''}
      ${errorReason ? `<div class="pr-answer-block">
        <h3 class="pr-answer-title">错因剖析</h3>
        <p class="pr-answer-text">${escapeHtml(errorReason)}</p>
      </div>` : ''}
      ${remedy ? `<div class="pr-answer-block pr-answer-remedy">
        <h3 class="pr-answer-title">怎么补</h3>
        <p class="pr-answer-text">${escapeHtml(remedy)}</p>
      </div>` : ''}
    </div>`;
  }

  function assessHtml() {
    return `<div class="pr-assess">
      <div class="pr-assess-q">${icon('target', 16)}<span>这一步，你掌握到什么程度？</span></div>
      <div class="pr-assess-btns">
        ${ASSESS.map((preset) => {
          const loading = S.busy && S.busyResult === preset.key;
          return `<button type="button" class="btn pr-assess-btn tone-${preset.tone}${loading ? ' is-loading' : ''}" data-result="${preset.key}"${S.busy ? ' disabled' : ''} aria-label="自评：${preset.label}">
            ${icon(preset.iconName, 18)}
            <span class="pr-assess-label">${loading ? '提交中…' : preset.label}</span>
            <span class="kbd">${preset.kbd}</span>
          </button>`;
        }).join('')}
      </div>
    </div>`;
  }

  function practiceHtml() {
    const item = S.queue[S.index];
    if (!item) return emptyHtml();
    const total = S.queue.length;
    const mastery = Math.round(Number(item.mastery) || 0);
    const percent = Math.round(((S.index + 1) / total) * 100);
    return `<div class="page pr-page pr-practice">
      <header class="pr-bar">
        <div class="pr-bar-left">
          <div class="pr-progress-text">
            <span class="muted small">第</span>
            <strong class="mono">${S.index + 1}</strong>
            <span class="muted small">/ ${total} 题</span>
          </div>
          <div class="pr-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${S.index + 1}" aria-label="练习进度">
            <i style="width:${percent}%"></i>
          </div>
        </div>
        <div class="pr-bar-right">
          <div class="pr-mastery-mini" title="这道题当前掌握度">
            ${ring(mastery, 44, 4)}
            <span class="small muted">掌握度</span>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" data-act="exit" aria-label="退出练习">
            ${icon('x', 16)}<span>退出</span>
          </button>
        </div>
      </header>

      ${questionCardHtml(item)}
      ${feedbackHtml()}

      <p class="pr-kbd-tip small muted">键盘 <span class="kbd">1</span> 已掌握 · <span class="kbd">2</span> 有点模糊 · <span class="kbd">3</span> 还是不会</p>
    </div>`;
  }

  // ---------- 渲染：总结 ----------

  function resultStat(key, count, total) {
    const preset = ASSESS_MAP[key];
    const percent = total ? Math.round((count / total) * 100) : 0;
    return `<div class="pr-sum-stat tone-${preset.tone}">
      <span class="pr-sum-stat-ico">${icon(preset.iconName, 18)}</span>
      <span class="pr-sum-stat-num mono">${count}</span>
      <span class="pr-sum-stat-label">${escapeHtml(preset.label)}</span>
      <span class="pr-sum-stat-bar"><i style="width:${percent}%"></i></span>
    </div>`;
  }

  function sessionInsights() {
    const tagCount = new Map();
    const errorCount = new Map();
    S.results.forEach((result) => {
      const detail = details.get(result.questionId);
      const points = detail && Array.isArray(detail.knowledgePoints) ? detail.knowledgePoints : [];
      points.forEach((point) => tagCount.set(point, (tagCount.get(point) || 0) + 1));
      if (detail && detail.errorType) {
        errorCount.set(detail.errorType, (errorCount.get(detail.errorType) || 0) + 1);
      }
    });
    return {
      tags: [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
      errors: [...errorCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
    };
  }

  function insightsHtml() {
    const insights = sessionInsights();
    if (!insights.tags.length && !insights.errors.length) return '';
    const topError = insights.errors[0];
    return `<section class="card card-pad pr-insights" aria-labelledby="prInsightsTitle">
      <div class="pr-section-head">
        <h2 class="pr-section-title" id="prInsightsTitle">本组复盘</h2>
        <span class="small muted">知识点与错因，决定下一组练什么</span>
      </div>
      ${insights.tags.length ? `<div class="pr-insight-row">
        <span class="label">涉及知识点</span>
        <div class="pr-chips">${insights.tags.map(([tag, count]) => `<button type="button" class="tag tag-blue pr-insight-tag" data-tag="${escapeHtml(tag)}" title="查看该知识点的错题">${escapeHtml(tag)}<em>${count}</em></button>`).join('')}</div>
      </div>` : ''}
      ${topError ? `<div class="pr-insight-row">
        <span class="label">薄弱错因</span>
        <div class="pr-insight-errors">
          ${insights.errors.map(([type, count]) => `<span class="tag tag-red">${escapeHtml(type)}<em>${count}</em></span>`).join('')}
        </div>
      </div>
      <p class="small muted pr-insight-note">${icon('spark', 14)} 本组错因集中在「${escapeHtml(topError[0])}」，建议回到原题看一遍解析，再做一组同类变式巩固。</p>` : ''}
    </section>`;
  }

  function weakPointsFromSession() {
    const map = new Map();
    S.results.forEach((result) => {
      const detail = details.get(result.questionId);
      assessmentsOf(detail).forEach((item) => {
        if (!WEAK_LEVELS.has(item.level) || !item.point) return;
        const existing = map.get(item.point);
        if (existing) {
          existing.count += 1;
          if (item.level === '未掌握') existing.level = '未掌握';
          if (!existing.microLesson && item.microLesson) existing.microLesson = item.microLesson;
          if (!existing.gap && item.gap) existing.gap = item.gap;
        } else {
          map.set(item.point, {
            point: item.point,
            level: item.level,
            count: 1,
            microLesson: item.microLesson || '',
            gap: item.gap || '',
          });
        }
      });
    });
    return [...map.values()].sort((a, b) => {
      const rank = (level) => (level === '未掌握' ? 1 : 0);
      return rank(b.level) - rank(a.level) || b.count - a.count;
    });
  }

  function targetedAdviceFromSession() {
    const seen = new Set();
    S.results.forEach((result) => {
      const detail = details.get(result.questionId);
      const advice = detail && detail.targetedAdvice ? String(detail.targetedAdvice).trim() : '';
      if (advice) seen.add(advice);
    });
    return [...seen].slice(0, 2);
  }

  function weaknessHtml() {
    const weak = weakPointsFromSession();
    const adviceList = targetedAdviceFromSession();
    if (!weak.length && !adviceList.length) return '';
    const topLevel = weak[0] ? weak[0].level : '';
    return `<section class="card card-pad pr-weakness" aria-labelledby="prWeaknessTitle">
      <div class="pr-section-head">
        <h2 class="pr-section-title" id="prWeaknessTitle">本次暴露的薄弱点</h2>
        <span class="small muted">${weak.length ? `${weak.length} 个知识点需要回收` : '没有明显薄弱点'}</span>
      </div>
      ${weak.length
        ? `<ul class="pr-weak-list">
            ${weak.map((item) => `<li class="pr-weak-item tone-${LEVEL_TONE[item.level] || 'gold'}">
              <div class="pr-weak-top">
                <span class="pr-weak-point">${escapeHtml(item.point)}</span>
                <span class="tag tag-${LEVEL_TONE[item.level] || 'gold'}">${escapeHtml(item.level)}</span>
                <span class="pr-weak-times small muted">涉及 ${item.count} 题</span>
              </div>
              ${item.microLesson || item.gap ? `<p class="pr-weak-lesson">${escapeHtml(item.microLesson || item.gap)}</p>` : ''}
            </li>`).join('')}
          </ul>`
        : '<p class="small muted pr-weak-empty">本组没有出现「未掌握 / 薄弱」的知识点，可以挑战更高难度。</p>'}
      ${adviceList.length ? `<div class="pr-advice">${icon('spark', 16)}<div><b>针对性建议</b>${adviceList.map((advice) => `<p>${escapeHtml(advice)}</p>`).join('')}</div></div>` : ''}
      ${weak.length ? `<div class="pr-weak-actions">
        <button type="button" class="btn btn-primary" data-act="again-weak">
          ${icon('target', 16)}<span>针对这些点再练一组</span>
        </button>
        <span class="small muted">${topLevel === '未掌握' ? '会优先抽取未掌握知识点的题' : '会用「薄弱攻坚」模式重新组题'}</span>
      </div>` : ''}
    </section>`;
  }

  function summaryHtml() {
    const total = S.results.length;
    const counts = { mastered: 0, fuzzy: 0, failed: 0 };
    let totalDelta = 0;
    S.results.forEach((result) => {
      counts[result.result] = (counts[result.result] || 0) + 1;
      totalDelta += Number(result.delta) || 0;
    });
    const accuracy = total ? Math.round(((counts.mastered + counts.fuzzy * 0.5) / total) * 100) : 0;
    const deltaText = `${totalDelta >= 0 ? '+' : ''}${totalDelta}`;

    return `<div class="page pr-page pr-summary">
      <header class="page-head pr-sum-head">
        <div class="pr-head-main">
          <div class="page-kicker">SESSION SUMMARY · 练习回顾</div>
          <h1 class="page-title">这一组练完了</h1>
          <p class="page-sub">${escapeHtml(originName())} · 共 ${total} 题 · 掌握度合计 ${deltaText} 分</p>
        </div>
        <div class="pr-head-actions">
          <button type="button" class="btn btn-line btn-sm" data-act="export-summary" aria-label="导出本次练习册">${icon('download', 16)}<span>导出本次练习册</span></button>
          <span class="stamp">阅</span>
        </div>
      </header>

      <div class="pr-sum-top">
        <section class="card card-pad pr-sum-ringcard">
          <div class="pr-sum-ring">
            ${ring(accuracy, 148, 10)}
          </div>
          <div class="pr-sum-ring-text">
            <span class="pr-sum-ring-label">本次正确率</span>
            <span class="small muted">正确率 = 已掌握 + 有点模糊 × 0.5</span>
          </div>
        </section>

        <section class="card card-pad pr-sum-stats" aria-label="本组自评分布">
          ${resultStat('mastered', counts.mastered, total)}
          ${resultStat('fuzzy', counts.fuzzy, total)}
          ${resultStat('failed', counts.failed, total)}
        </section>

        <section class="card card-pad pr-sum-delta">
          <span class="label">本次掌握度变化</span>
          <strong class="pr-sum-delta-num mono ${totalDelta >= 0 ? 'up' : 'down'}">${deltaText} 分</strong>
          <p class="small muted">${totalDelta >= 0 ? '每一道自评都记进了遗忘曲线，继续保持。' : '不会的题已经回到待复习队列，明天再见一次。'}</p>
        </section>
      </div>

      ${insightsHtml()}

      ${weaknessHtml()}

      <section class="card pr-sum-listcard" aria-labelledby="prResultTitle">
        <div class="card-head">
          <h2 class="pr-section-title" id="prResultTitle">每题结果</h2>
          <span class="small muted">自评结果已同步到错题本</span>
        </div>
        <ol class="pr-res-list">
          ${S.results.map((result, index) => {
            const preset = ASSESS_MAP[result.result] || ASSESS_MAP.fuzzy;
            const delta = Number(result.delta) || 0;
            return `<li class="pr-res-row">
              <span class="pr-res-no mono">${pad2(index + 1)}</span>
              <span class="tag tag-muted pr-res-subject">${escapeHtml(result.subject || '综合')}</span>
              <span class="pr-res-text">${escapeHtml(excerpt(result.text, 64))}</span>
              <span class="tag tag-${preset.tone}">${escapeHtml(preset.label)}</span>
              <span class="pr-res-delta mono ${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '+' : ''}${delta}</span>
            </li>`;
          }).join('')}
        </ol>
      </section>

      <div class="pr-sum-actions">
        <button type="button" class="btn btn-primary" data-act="again">${icon('refresh', 16)}<span>再来一组</span></button>
        <button type="button" class="btn btn-line" data-act="book">${icon('book', 16)}<span>查看错题本</span></button>
        <button type="button" class="btn btn-ghost" data-act="dashboard">${icon('dashboard', 16)}<span>返回总览</span></button>
      </div>
    </div>`;
  }

  // ---------- 渲染：空 / 加载 ----------

  function emptyHtml() {
    return `<div class="page pr-page">
      <header class="page-head pr-head">
        <div class="pr-head-main">
          <div class="page-kicker">PRACTICE · 变式训练</div>
          <h1 class="page-title">举一反三</h1>
          <p class="page-sub">今天没有到期复习，也没有满足条件的薄弱题。先随机抽练，或去错题本挑一道。</p>
        </div>
      </header>
      <div class="card card-pad">
        <div class="empty">
          <div class="empty-art">${icon('practice', 30)}</div>
          <h2 class="empty-title">暂时没有可练的题</h2>
          <p class="empty-desc">换一个模式，或者先去录入一道错题。题库有内容后，这里会自动排出练习队列。</p>
          <div class="pr-empty-actions">
            <button type="button" class="btn btn-primary" data-act="random-start">随机抽练一组</button>
            <button type="button" class="btn btn-line" data-act="book">去错题本</button>
            <button type="button" class="btn btn-ghost" data-act="setup">换个模式</button>
          </div>
        </div>
      </div>
    </div>`;
  }

  function bootHtml() {
    return `<div class="page pr-page">
      <header class="page-head pr-head">
        <div class="pr-head-main">
          <div class="page-kicker">PRACTICE · 变式训练</div>
          <h1 class="page-title">举一反三</h1>
        </div>
      </header>
      <div class="pr-boot">${loadingBlock(S.bootText || '正在准备题目…')}</div>
    </div>`;
  }

  function render() {
    if (disposed) return;
    let html = '';
    if (S.phase === 'practice') html = practiceHtml();
    else if (S.phase === 'summary') html = summaryHtml();
    else if (S.phase === 'empty') html = emptyHtml();
    else if (S.phase === 'boot') html = bootHtml();
    else if (S.phase === 'prep') html = prepHtml();
    else html = setupHtml();
    root.innerHTML = html;
  }

  // ---------- 取题 ----------

  async function loadDetail() {
    const token = (S.loadToken += 1);
    const item = S.queue[S.index];
    if (!item) return;
    const cached = details.get(item.questionId);
    if (cached) {
      S.detail = cached;
      S.detailState = 'ready';
      render();
      return;
    }
    S.detail = null;
    S.detailState = 'loading';
    render();
    try {
      const res = await api.question(item.questionId);
      if (disposed || token !== S.loadToken) return;
      const question = res && res.question ? res.question : res;
      if (!question) throw new Error('题目不存在');
      details.set(item.questionId, question);
      S.detail = question;
      S.detailState = 'ready';
      render();
    } catch (error) {
      if (disposed || token !== S.loadToken) return;
      S.detailState = 'error';
      render();
    }
  }

  // ---------- 流程 ----------

  function beginSession(items, origin, prefetched) {
    const list = Array.isArray(items) ? items.slice() : [];
    S.phase = list.length ? 'practice' : 'empty';
    S.queue = list;
    S.index = 0;
    S.results = [];
    S.origin = origin || null;
    S.feedback = null;
    S.hintOpen = false;
    S.answerOpen = false;
    S.busy = false;
    S.busyResult = '';
    S.startBusy = false;
    S.error = '';
    details.clear();
    if (prefetched && prefetched.id) details.set(prefetched.id, prefetched);
    S.detail = prefetched || null;
    S.detailState = prefetched ? 'ready' : 'loading';
    S.loadToken += 1;
    render();
    if (!prefetched && S.phase === 'practice') loadDetail();
  }

  async function start(mode, count, subject) {
    if (S.startBusy) return;
    const nextMode = mode || S.mode;
    const nextCount = Number(count) || S.count;
    const nextSubject = typeof subject === 'string' ? subject : S.subject;
    S.mode = nextMode;
    S.count = nextCount;
    S.subject = nextSubject;
    S.startBusy = true;
    S.error = '';
    S.phase = 'setup';
    render();
    try {
      const params = { mode: S.mode, count: S.count };
      if (S.mode === 'subject' && S.subject) params.subject = S.subject;
      const res = await api.practiceQueue(params);
      if (disposed) return;
      const items = res && Array.isArray(res.items) ? res.items : [];
      if (!items.length) {
        S.startBusy = false;
        S.phase = 'empty';
        S.queue = [];
        render();
        return;
      }
      beginSession(items, { type: 'queue', mode: S.mode, count: S.count, subject: S.subject });
    } catch (error) {
      if (disposed) return;
      S.startBusy = false;
      S.error = errText(error);
      S.phase = 'setup';
      render();
      toast(errText(error), 'error');
    }
  }

  async function startFromQuestion(id) {
    S.phase = 'boot';
    S.bootText = '正在读取这道题的掌握评估…';
    S.startBusy = false;
    render();
    try {
      const res = await api.question(id);
      if (disposed) return;
      const question = res && res.question ? res.question : res;
      if (!question) throw new Error('题目不存在');
      details.set(question.id, question);
      S.detail = question;
      S.detailState = 'ready';
      S.loadToken += 1;
      S.prep = { question, variant: pickVariant(question) };
      S.phase = 'prep';
      render();
    } catch (error) {
      if (disposed) return;
      S.phase = 'setup';
      S.error = errText(error);
      render();
      toast(errText(error), 'error');
    }
  }

  function startSingle() {
    const prep = S.prep;
    if (!prep || !prep.question) {
      S.phase = 'setup';
      render();
      return;
    }
    const question = prep.question;
    const item = {
      questionId: question.id,
      questionText: question.text,
      subject: question.subject,
      mastery: question.mastery,
      variant: prep.variant || null,
    };
    beginSession([item], { type: 'single', id: question.id }, question);
  }

  async function assess(result) {
    if (S.busy || disposed) return;
    const preset = ASSESS_MAP[result];
    const item = S.queue[S.index];
    if (!preset || !item) return;
    S.busy = true;
    S.busyResult = result;
    render();
    const before = Math.round(Number(item.mastery) || 0);
    try {
      const variantId = item.variant && item.variant.id ? item.variant.id : null;
      const res = await api.attempt(item.questionId, { variantId, result });
      if (disposed) return;
      const delta = Number.isFinite(Number(res && res.delta)) ? Number(res.delta) : preset.delta;
      const after = res && res.question && Number.isFinite(Number(res.question.mastery))
        ? Math.round(Number(res.question.mastery))
        : Math.max(0, Math.min(100, before + delta));
      item.mastery = after;
      S.results.push({
        questionId: item.questionId,
        text: promptOf(item, S.detail),
        subject: item.subject || (S.detail && S.detail.subject) || '综合',
        variantId,
        result,
        delta,
        masteryBefore: before,
        masteryAfter: after,
      });
      S.answerOpen = false;
      S.hintOpen = false;
      S.feedback = { result, delta, before, after };
      render();
      if (typeof ctx.refreshShell === 'function') {
        try {
          ctx.refreshShell();
        } catch (error) {
          /* 侧栏刷新失败不影响练习 */
        }
      }
      await wait(820);
      if (disposed) return;
      S.feedback = null;
      S.busy = false;
      S.busyResult = '';
      advance();
    } catch (error) {
      if (disposed) return;
      S.busy = false;
      S.busyResult = '';
      render();
      toast(errText(error), 'error');
    }
  }

  function advance() {
    if (S.index + 1 >= S.queue.length) {
      S.phase = 'summary';
      S.detail = null;
      S.detailState = 'idle';
      render();
      return;
    }
    S.index += 1;
    S.detail = null;
    S.detailState = 'loading';
    S.hintOpen = false;
    S.answerOpen = false;
    render();
    loadDetail();
  }

  async function exitPractice() {
    const ok = await askConfirm({
      title: '退出本次练习？',
      message: '已经完成的自评会保留，未作答的题目不会记录。',
      confirmText: '退出练习',
      danger: true,
    });
    if (!ok || disposed) return;
    S.feedback = null;
    S.busy = false;
    S.busyResult = '';
    if (S.results.length) {
      S.phase = 'summary';
      render();
    } else {
      S.phase = 'setup';
      S.queue = [];
      render();
      toast('已退出练习', 'info');
    }
  }

  function again() {
    const origin = S.origin;
    if (!origin) {
      S.phase = 'setup';
      S.queue = [];
      render();
      return;
    }
    if (origin.type === 'single' && origin.id) {
      startFromQuestion(origin.id);
      return;
    }
    S.phase = 'setup';
    S.queue = [];
    S.results = [];
    S.index = 0;
    render();
    start(origin.mode || S.mode, origin.count || S.count, origin.subject || '');
  }

  // ---------- 练习册导出 ----------

  async function buildQuestionsFromItems(items) {
    const missing = items.filter((item) => item && item.questionId && !details.has(item.questionId));
    await Promise.all(missing.map(async (item) => {
      try {
        const res = await api.question(item.questionId);
        if (disposed) return;
        const detail = res && res.question ? res.question : res;
        if (detail) details.set(item.questionId, detail);
      } catch (error) {
        /* 单题失败不影响整册导出 */
      }
    }));
    if (disposed) return [];
    return items.map((item) => {
      if (!item || !item.questionId) return null;
      const detail = details.get(item.questionId) || null;
      const base = {
        text: (detail && detail.text) || item.questionText || '',
        answer: (detail && detail.answer) || '',
        analysis: (detail && detail.analysis) || '',
        knowledgePoints: (detail && detail.knowledgePoints) || [],
        knowledgeGuide: (detail && detail.knowledgeGuide) || [],
        errorType: (detail && detail.errorType) || '',
        errorReason: (detail && detail.errorReason) || '',
        subject: item.subject || (detail && detail.subject) || '综合',
        difficulty: (detail && detail.difficulty) || 3,
      };
      if (item.variant) {
        return {
          ...base,
          text: item.variant.text || base.text,
          answer: item.variant.answer || base.answer,
          analysis: item.variant.analysis || base.analysis,
        };
      }
      return base;
    }).filter(Boolean);
  }

  async function collectSetupQuestions() {
    const params = { mode: S.mode, count: S.count };
    if (S.mode === 'subject' && S.subject) params.subject = S.subject;
    const res = await api.practiceQueue(params);
    const items = res && Array.isArray(res.items) ? res.items : [];
    return buildQuestionsFromItems(items);
  }

  function knowledgeSubtitle() {
    const tags = new Map();
    S.results.forEach((result) => {
      const detail = details.get(result.questionId);
      (detail && Array.isArray(detail.knowledgePoints) ? detail.knowledgePoints : []).forEach((tag) => {
        tags.set(tag, (tags.get(tag) || 0) + 1);
      });
    });
    if (!tags.size && S.mode === 'subject' && S.subject) return `学科：${S.subject}`;
    const top = [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([tag]) => tag);
    if (top.length) return `知识点：${top.join('、')}`;
    return originName();
  }

  function openExportModal(kind) {
    const defaultTitle = '知错 · 举一反三练习册';
    const subtitle = `${knowledgeSubtitle()} · ${fmtDate(new Date().toISOString(), 'long')}`;
    const body = `<div class="pr-export-form">
      <div class="field">
        <label class="label" for="prExTitle">练习册标题</label>
        <input class="input" id="prExTitle" type="text" maxlength="40" value="${escapeHtml(defaultTitle)}" />
      </div>
      <div class="field">
        <span class="label">导出格式</span>
        <div class="segmented" role="group" aria-label="导出格式" data-role="format">
          <button type="button" class="active" data-format="pdf" aria-pressed="true">PDF</button>
          <button type="button" data-format="png" aria-pressed="false">图片 PNG</button>
        </div>
      </div>
      <label class="switch">
        <input type="checkbox" id="prExAnswers" checked />
        <span class="track" aria-hidden="true"></span>
        <span>附答案与掌握指南</span>
      </label>
      <p class="small muted">生成 A4 练习册：PDF 可直接打印，PNG 逐页下载。可反复打印使用。</p>
    </div>`;

    const entry = openModal({
      title: '导出练习册',
      subtitle: '生成可反复打印的 A4 练习册',
      body,
      width: 460,
      actions: [
        { label: '取消', type: 'ghost' },
        {
          label: '开始导出',
          type: 'primary',
          onClick: async (dialog) => {
            const titleEl = dialog.root.querySelector('#prExTitle');
            const answersEl = dialog.root.querySelector('#prExAnswers');
            const activeFormat = dialog.root.querySelector('[data-format].active');
            const title = (titleEl && titleEl.value ? titleEl.value : '').trim() || defaultTitle;
            const format = activeFormat && activeFormat.dataset.format === 'png' ? 'png' : 'pdf';
            const includeAnswers = answersEl ? Boolean(answersEl.checked) : true;
            try {
              toast('正在生成练习册，请稍候…', 'info');
              const questions = kind === 'summary'
                ? await buildQuestionsFromItems(S.queue)
                : await collectSetupQuestions();
              if (disposed) return false;
              if (!questions.length) {
                toast('没有可导出的题目', 'info');
                return false;
              }
              const result = await exportQuestionSet({
                title,
                subtitle,
                questions,
                includeAnswers,
                includeGuide: true,
                format,
                filename: `知错-举一反三-${dateStamp()}`,
              });
              const pages = result && result.pages ? `${result.pages} 页` : '';
              toast(`已生成${pages}${format === 'png' ? '图片' : ' PDF'}`, 'success');
            } catch (error) {
              toast(errText(error), 'error');
              return false;
            }
          },
        },
      ],
    });

    const formatWrap = entry.root.querySelector('[data-role="format"]');
    if (formatWrap) {
      formatWrap.addEventListener('click', (event) => {
        const target = event.target.closest('[data-format]');
        if (!target) return;
        Array.from(formatWrap.querySelectorAll('[data-format]')).forEach((btn) => {
          const active = btn === target;
          btn.classList.toggle('active', active);
          btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
      });
    }
  }

  // ---------- 事件 ----------

  const onClick = (event) => {
    if (disposed) return;
    const node = event.target && event.target.closest
      ? event.target.closest('[data-act],[data-mode],[data-count],[data-subject],[data-result],[data-tag]')
      : null;
    if (!node || !root.contains(node)) return;
    const data = node.dataset;

    if (data.act) {
      switch (data.act) {
        case 'start':
          start(S.mode, S.count, S.subject);
          break;
        case 'random-start':
          S.mode = 'random';
          start('random', S.count, '');
          break;
        case 'exit':
          exitPractice();
          break;
        case 'hint':
          S.hintOpen = !S.hintOpen;
          render();
          break;
        case 'reveal':
          S.answerOpen = true;
          render();
          break;
        case 'retry-detail':
          loadDetail();
          break;
        case 'start-single':
          startSingle();
          break;
        case 'again':
          again();
          break;
        case 'again-weak':
          start('weak', S.count, '');
          break;
        case 'book':
          navigate('#/book');
          break;
        case 'dashboard':
          navigate('#/dashboard');
          break;
        case 'setup':
          S.phase = 'setup';
          S.queue = [];
          S.results = [];
          S.detail = null;
          S.detailState = 'idle';
          render();
          break;
        case 'export':
          openExportModal('setup');
          break;
        case 'export-summary':
          openExportModal('summary');
          break;
        default:
          break;
      }
      return;
    }

    if (data.mode) {
      S.mode = data.mode;
      if (S.mode === 'subject' && !S.subject) S.subject = subjectOptions()[0] || '';
      render();
      return;
    }
    if (data.count) {
      S.count = Number(data.count) || 10;
      render();
      return;
    }
    if (data.subject) {
      S.subject = data.subject;
      render();
      return;
    }
    if (data.result) {
      assess(data.result);
      return;
    }
    if (data.tag) {
      navigate(`#/book?tag=${encodeURIComponent(data.tag)}`);
    }
  };

  const onKeyDown = (event) => {
    if (disposed) return;
    const target = event.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
    if (S.phase !== 'practice' || !S.answerOpen || S.busy) return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
    const map = { 1: 'mastered', 2: 'fuzzy', 3: 'failed' };
    const result = map[event.key];
    if (!result) return;
    event.preventDefault();
    assess(result);
  };

  // ---------- 生命周期 ----------

  async function startView() {
    render();
    loadStats();
    root.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeyDown);
    addCleanup(() => root.removeEventListener('click', onClick));
    addCleanup(() => document.removeEventListener('keydown', onKeyDown));

    if (query.question) {
      await startFromQuestion(String(query.question));
      return;
    }
    if (query.start) {
      const mode = String(query.start);
      if (MODES.some((item) => item.key === mode)) {
        const count = Number(query.count) || 10;
        const subject = query.subject ? String(query.subject) : '';
        await start(mode, count, subject);
      }
    }
  }

  function destroyView() {
    if (cleanupRan) return;
    cleanupRan = true;
    disposed = true;
    timers.forEach((timer) => clearTimeout(timer));
    timers.clear();
    cleanups.forEach((fn) => fn());
    cleanups.length = 0;
  }

  return { start: startView, destroy: destroyView };
}
