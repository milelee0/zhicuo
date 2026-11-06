// 知错 · 组卷打印
// 依赖：api.questions；ui 的 escapeHtml / icon / difficultyLabel / subjectClass / loadingBlock；
//       exporter.js 的 exportQuestionSet（PDF / PNG 导出）。
// 打印：window.print() + body.printing，样式全部收敛在 paper.css 的 @media print 中。

import { api } from '../api.js';
import {
  escapeHtml,
  icon,
  difficultyLabel,
  subjectClass,
  loadingBlock,
} from '../ui.js';
import { exportQuestionSet } from '../exporter.js';

const SORTS = [
  { key: 'recent', label: '最近录入' },
  { key: 'difficulty', label: '难度由高到低' },
  { key: 'mastery', label: '掌握度低优先' },
];

const QUICK_COUNTS = [
  { value: 10, label: '10 题' },
  { value: 15, label: '15 题' },
  { value: 20, label: '20 题' },
  { value: 30, label: '30 题' },
  { value: 0, label: '全部' },
];

const DIFFICULTIES = [1, 2, 3, 4, 5];

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

function dots(count) {
  const level = Math.max(1, Math.min(5, Number(count) || 3));
  let html = '';
  for (let i = 0; i < 5; i += 1) html += `<i class="${i < level ? 'on' : ''}"></i>`;
  return html;
}

function blankHeight(question) {
  const level = Math.max(1, Math.min(5, Number(question.difficulty) || 3));
  return Math.min(120, Math.max(60, 52 + level * 14));
}

// 把题干末尾的 A/B/C/D 选项拆出来，选项按需排版
function splitOptions(text) {
  const lines = String(text === null || text === undefined ? '' : text).split(/\r?\n/);
  const head = [];
  const options = [];
  let optionMode = false;
  lines.forEach((line) => {
    if (/^\s*[A-Da-d][\.、．)）]/.test(line)) {
      optionMode = true;
      options.push(line.trim());
    } else if (optionMode && line.trim()) {
      options[options.length - 1] = `${options[options.length - 1]} ${line.trim()}`;
    } else if (!optionMode) {
      head.push(line);
    }
  });
  return { head: head.join('\n'), options };
}

function createView(root, ctx) {
  let disposed = false;
  let cleanupRan = false;
  const cleanups = [];
  let observer = null;
  let resizeBound = false;

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

  const S = {
    loading: true,
    error: '',
    questions: [],
    selected: [],
    filters: { subject: '', dmin: 1, dmax: 5, sort: 'recent' },
    target: 10,
    title: '知错 · 错题重练卷',
    subtitle: '错题重练 · 巩固薄弱知识点',
    showSubtitle: true,
    showMeta: true,
    includeAnswers: true,
    busy: false,
  };

  // ---------- 数据 ----------

  function subjectOptions() {
    const fromMeta = ctx.state && ctx.state.meta && Array.isArray(ctx.state.meta.subjects)
      ? ctx.state.meta.subjects.filter(Boolean)
      : [];
    const present = [...new Set(S.questions.map((question) => question.subject).filter(Boolean))];
    if (fromMeta.length) {
      const ordered = fromMeta.filter((subject) => present.includes(subject));
      const rest = present.filter((subject) => !ordered.includes(subject));
      return ordered.concat(rest);
    }
    return present;
  }

  function filteredQuestions() {
    const filters = S.filters;
    const min = Number(filters.dmin) || 1;
    const max = Number(filters.dmax) || 5;
    const low = Math.min(min, max);
    const high = Math.max(min, max);
    const list = S.questions.filter((question) => {
      if (filters.subject && question.subject !== filters.subject) return false;
      const difficulty = Number(question.difficulty) || 3;
      return difficulty >= low && difficulty <= high;
    });
    const time = (question) => {
      const value = new Date(question.updatedAt || question.createdAt || 0).getTime();
      return Number.isNaN(value) ? 0 : value;
    };
    if (filters.sort === 'difficulty') {
      list.sort((a, b) => (Number(b.difficulty) || 3) - (Number(a.difficulty) || 3) || (Number(a.mastery) || 0) - (Number(b.mastery) || 0));
    } else if (filters.sort === 'mastery') {
      list.sort((a, b) => (Number(a.mastery) || 0) - (Number(b.mastery) || 0) || time(b) - time(a));
    } else {
      list.sort((a, b) => time(b) - time(a));
    }
    return list;
  }

  function selectedQuestions() {
    const map = new Map(S.questions.map((question) => [question.id, question]));
    return S.selected.map((id) => map.get(id)).filter(Boolean);
  }

  function subtitleText() {
    return S.showSubtitle ? S.subtitle.trim() : '';
  }

  function pagesCount() {
    return 1 + (S.includeAnswers && S.selected.length ? 1 : 0);
  }

  // ---------- 页面骨架 ----------

  function pageHeadHtml() {
    return `<header class="page-head pp-head">
      <div>
        <div class="page-kicker">PAPER · 组卷打印</div>
        <h1 class="page-title">组卷打印</h1>
        <p class="page-sub">从错题本挑题，实时排成一张 A4 卷子。打印或导出，答案页都会另起一页。</p>
      </div>
      <div class="pp-head-note">
        <span class="stamp">卷</span>
        <span class="small muted">A4 210 × 297 mm · 页边距 18mm</span>
      </div>
    </header>`;
  }

  function controlsHtml() {
    const subjects = subjectOptions();
    const selectedCount = S.selected.length;
    return `<aside class="pp-console" aria-label="组卷控制台">
      <section class="pp-block">
        <h2 class="pp-block-title">试卷信息</h2>
        <div class="field">
          <label class="label" for="ppTitle">试卷标题</label>
          <input class="input" id="ppTitle" type="text" maxlength="40" value="${escapeHtml(S.title)}" />
        </div>
        <div class="field">
          <label class="label" for="ppSubtitle">副标题</label>
          <input class="input" id="ppSubtitle" type="text" maxlength="50" value="${escapeHtml(S.subtitle)}" />
        </div>
        <div class="pp-switches">
          <label class="switch">
            <input type="checkbox" id="ppShowSubtitle"${S.showSubtitle ? ' checked' : ''} />
            <span class="track" aria-hidden="true"></span>
            <span>显示副标题</span>
          </label>
          <label class="switch">
            <input type="checkbox" id="ppShowMeta"${S.showMeta ? ' checked' : ''} />
            <span class="track" aria-hidden="true"></span>
            <span>姓名 / 班级 / 得分栏</span>
          </label>
        </div>
      </section>

      <section class="pp-block">
        <h2 class="pp-block-title">筛选与排序</h2>
        <div class="field">
          <label class="label" for="ppSubject">学科</label>
          <select class="select" id="ppSubject">
            <option value="">全部学科</option>
            ${subjects.map((subject) => `<option value="${escapeHtml(subject)}"${S.filters.subject === subject ? ' selected' : ''}>${escapeHtml(subject)}</option>`).join('')}
          </select>
        </div>
        <div class="pp-range">
          <div class="field">
            <label class="label" for="ppDiffMin">最低难度</label>
            <select class="select" id="ppDiffMin">
              ${DIFFICULTIES.map((level) => `<option value="${level}"${Number(S.filters.dmin) === level ? ' selected' : ''}>${escapeHtml(difficultyLabel(level))}</option>`).join('')}
            </select>
          </div>
          <span class="pp-range-sep" aria-hidden="true">—</span>
          <div class="field">
            <label class="label" for="ppDiffMax">最高难度</label>
            <select class="select" id="ppDiffMax">
              ${DIFFICULTIES.map((level) => `<option value="${level}"${Number(S.filters.dmax) === level ? ' selected' : ''}>${escapeHtml(difficultyLabel(level))}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="field">
          <label class="label" for="ppSort">排序</label>
          <select class="select" id="ppSort">
            ${SORTS.map((sort) => `<option value="${sort.key}"${S.filters.sort === sort.key ? ' selected' : ''}>${escapeHtml(sort.label)}</option>`).join('')}
          </select>
        </div>
        <div class="pp-quick">
          <span class="label">快速题量</span>
          <div class="segmented" role="group" aria-label="快速选择题量">
            ${QUICK_COUNTS.map((item) => `<button type="button" data-target="${item.value}" class="${S.target === item.value ? 'active' : ''}" aria-pressed="${S.target === item.value}">${item.label}</button>`).join('')}
          </div>
          <p class="small muted">按当前筛选自动勾选前 N 题，可再手动调整。</p>
        </div>
      </section>

      <section class="pp-block pp-bank-block">
        <div class="pp-bank-head">
          <h2 class="pp-block-title">题库 <span class="pp-bank-count" data-count="filtered">${filteredQuestions().length}</span></h2>
          <div class="pp-bank-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-act="select-all">全选</button>
            <button type="button" class="btn btn-ghost btn-sm" data-act="clear">清空</button>
          </div>
        </div>
        <div class="pp-selected-line">
          <span class="pp-selected-badge">已选 <b data-count="selected">${selectedCount}</b> 题</span>
          <span class="small muted" data-role="selected-note">按勾选顺序编号</span>
        </div>
        <div class="pp-bank" id="ppBank" aria-live="polite"></div>
      </section>

      <section class="pp-block">
        <label class="switch">
          <input type="checkbox" id="ppIncludeAnswers"${S.includeAnswers ? ' checked' : ''} />
          <span class="track" aria-hidden="true"></span>
          <span>附参考答案与解析（另起一页）</span>
        </label>
      </section>

      <div class="pp-console-actions">
        <button type="button" class="btn btn-primary pp-print-btn" data-act="print"${selectedCount ? '' : ' disabled'}>
          ${icon('print', 17)}<span>打印试卷</span>
        </button>
        <div class="pp-export-row">
          <button type="button" class="btn btn-line btn-sm" data-act="export-pdf"${selectedCount ? '' : ' disabled'}>
            ${icon('download', 15)}<span>导出 PDF</span>
          </button>
          <button type="button" class="btn btn-line btn-sm" data-act="export-png"${selectedCount ? '' : ' disabled'}>
            ${icon('image', 15)}<span>导出图片</span>
          </button>
        </div>
        <p class="small muted pp-print-hint">打印只保留试卷本身；PDF / PNG 适合发到班级群或反复练习。</p>
      </div>
    </aside>`;
  }

  function stageHtml() {
    return `<section class="pp-stage" aria-label="A4 试卷预览">
      <div class="pp-stage-bar">
        <span class="pp-stage-title">${icon('paper', 16)}<span>预览</span></span>
        <span class="small muted" data-role="pages">${pagesCount()} 页 · 已选 <b data-count="selected">${S.selected.length}</b> 题</span>
      </div>
      <div class="pp-preview" id="ppPreview">
        <div class="pp-scale-wrap" id="ppScaleWrap">
          <div class="pp-stack" id="ppStack"></div>
        </div>
      </div>
    </section>`;
  }

  function renderPage() {
    root.innerHTML = `<div class="page pp-page">
      ${pageHeadHtml()}
      <div class="pp-workbench">
        ${controlsHtml()}
        ${stageHtml()}
      </div>
    </div>`;
    renderBank();
    syncPreview();
    observePreview();
  }

  function renderLoading() {
    root.innerHTML = `<div class="page pp-page">
      ${pageHeadHtml()}
      <div class="card card-pad pp-loading">${loadingBlock('正在整理题库…')}</div>
    </div>`;
  }

  function renderErrorPage() {
    root.innerHTML = `<div class="page pp-page">
      ${pageHeadHtml()}
      <div class="card card-pad pp-error">
        <div class="pp-error-ico">${icon('alert', 26)}</div>
        <h2 class="pp-error-title">题库加载失败</h2>
        <p class="pp-error-desc">${escapeHtml(S.error || '请检查网络或服务状态后重试。')}</p>
        <div class="pp-error-actions">
          <button type="button" class="btn btn-primary" data-act="retry">${icon('refresh', 16)}<span>重新加载</span></button>
          <button type="button" class="btn btn-line" data-act="go-book">去错题本</button>
        </div>
      </div>
    </div>`;
  }

  function renderEmptyPage() {
    root.innerHTML = `<div class="page pp-page">
      ${pageHeadHtml()}
      <div class="card card-pad pp-error">
        <div class="pp-error-ico">${icon('book', 26)}</div>
        <h2 class="pp-error-title">题库还是空的</h2>
        <p class="pp-error-desc">先录入几道错题，再来组卷。也可以先去错题本看看现有内容。</p>
        <div class="pp-error-actions">
          <button type="button" class="btn btn-primary" data-act="go-add">${icon('plus', 16)}<span>录入错题</span></button>
          <button type="button" class="btn btn-line" data-act="go-book">去错题本</button>
          <button type="button" class="btn btn-ghost" data-act="retry">刷新题库</button>
        </div>
      </div>
    </div>`;
  }

  // ---------- 题库列表 ----------

  function bankRowHtml(question) {
    const checked = S.selected.includes(question.id);
    const subject = question.subject || '综合';
    const assessment = Array.isArray(question.masteryAssessment) ? question.masteryAssessment : [];
    const weakPoint = assessment.find((item) => item && item.point && (item.level === '未掌握' || item.level === '薄弱'));
    const weakTag = weakPoint
      ? `<span class="pp-bank-chip pp-bank-chip-gold" title="薄弱知识点">薄弱 · ${escapeHtml(weakPoint.point)}</span>`
      : '';
    const errorTag = question.errorType
      ? `<span class="pp-bank-chip pp-bank-chip-red" title="主要错因">${escapeHtml(question.errorType)}</span>`
      : '';
    return `<label class="pp-bank-row${checked ? ' is-checked' : ''}">
      <input type="checkbox" data-qid="${escapeHtml(question.id)}"${checked ? ' checked' : ''} aria-label="选择题目：${escapeHtml(excerpt(question.text, 30))}" />
      <span class="pp-bank-main">
        <span class="pp-bank-text">${escapeHtml(excerpt(question.text, 90))}</span>
        <span class="pp-bank-meta">
          <span class="pp-subject pp-subject-${subjectClass(subject)}">${escapeHtml(subject)}</span>
          <span class="pp-diff"><span class="diff-dots" aria-hidden="true">${dots(question.difficulty)}</span><span class="small muted">${escapeHtml(difficultyLabel(question.difficulty))}</span></span>
          <span class="small muted">掌握 ${Math.round(Number(question.mastery) || 0)}</span>
          ${weakTag}
          ${errorTag}
        </span>
      </span>
    </label>`;
  }

  function renderBank() {
    const bank = root.querySelector('#ppBank');
    if (!bank) return;
    const list = filteredQuestions();
    if (!list.length) {
      bank.innerHTML = `<div class="pp-bank-empty">
        <p class="small muted">当前筛选下没有题目，试试放宽学科或难度范围。</p>
        <button type="button" class="btn btn-ghost btn-sm" data-act="reset-filter">重置筛选</button>
      </div>`;
      syncConsole();
      return;
    }
    bank.innerHTML = list.map(bankRowHtml).join('');
    syncConsole();
  }

  // ---------- 控制台状态 ----------

  function syncConsole() {
    if (!root.querySelector('.pp-console')) return;
    const selectedCount = S.selected.length;
    const filteredCount = filteredQuestions().length;
    root.querySelectorAll('[data-count="selected"]').forEach((el) => {
      el.textContent = String(selectedCount);
    });
    root.querySelectorAll('[data-count="filtered"]').forEach((el) => {
      el.textContent = String(filteredCount);
    });

    const disabled = selectedCount === 0 || S.busy;
    root.querySelectorAll('[data-act="print"],[data-act="export-pdf"],[data-act="export-png"]').forEach((btn) => {
      btn.disabled = disabled;
    });
    root.querySelectorAll('[data-act="export-pdf"],[data-act="export-png"]').forEach((btn) => {
      if (S.busy) btn.classList.add('is-busy');
      else btn.classList.remove('is-busy');
    });

    root.querySelectorAll('[data-target]').forEach((btn) => {
      const active = Number(btn.dataset.target) === S.target;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    const filteredIds = new Set(filteredQuestions().map((question) => question.id));
    const hidden = S.selected.filter((id) => !filteredIds.has(id)).length;
    const note = root.querySelector('[data-role="selected-note"]');
    if (note) {
      note.textContent = hidden
        ? `其中 ${hidden} 题不在当前筛选内`
        : '按勾选顺序编号';
    }

    const pages = root.querySelector('[data-role="pages"]');
    if (pages) {
      const total = pagesCount();
      pages.innerHTML = `${total} 页 · 已选 <b data-count="selected">${selectedCount}</b> 题`;
    }
  }

  // ---------- A4 预览 ----------

  function sheetHeadHtml(kind, pageNo, totalPages) {
    const title = S.title.trim() || '未命名试卷';
    const sub = subtitleText();
    return `<header class="ps-head">
      <div class="ps-head-top">
        <h2 class="ps-title">${escapeHtml(kind === 'answers' ? '参考答案与解析' : title)}</h2>
        <span class="ps-page-no">第 ${pageNo} / ${totalPages} 页</span>
      </div>
      <p class="ps-sub"${sub ? '' : ' hidden'}>${escapeHtml(sub)}</p>
      ${S.showMeta && kind === 'paper' ? `<div class="ps-meta">
        <span class="ps-meta-item">班级：<i></i></span>
        <span class="ps-meta-item">姓名：<i></i></span>
        <span class="ps-meta-item">得分：<i></i></span>
      </div>` : ''}
      ${kind === 'answers' && S.showMeta ? `<p class="ps-meta-note">${escapeHtml(title)}${sub ? ` · ${escapeHtml(sub)}` : ''}</p>` : ''}
      <div class="ps-rule" aria-hidden="true"></div>
    </header>`;
  }

  function questionBlockHtml(question, index) {
    const { head, options } = splitOptions(question.text);
    const subject = question.subject || '综合';
    return `<section class="ps-q" aria-label="第 ${index + 1} 题">
      <div class="ps-q-head">
        <span class="ps-q-no">${index + 1}</span>
        <span class="ps-q-meta">${escapeHtml(subject)} · ${escapeHtml(difficultyLabel(question.difficulty))}</span>
      </div>
      <div class="ps-q-text">${escapeHtml(head || question.text)}</div>
      ${options.length ? `<div class="ps-q-options">${options.map((option) => `<span class="ps-opt">${escapeHtml(option)}</span>`).join('')}</div>` : ''}
      ${question.imageUrl ? `<figure class="ps-q-img"><img src="${escapeHtml(question.imageUrl)}" alt="第 ${index + 1} 题配图" /></figure>` : ''}
      <div class="ps-q-space" style="height:${blankHeight(question)}px" aria-hidden="true"></div>
    </section>`;
  }

  function paperSheetHtml(items, pageNo, totalPages) {
    return `<article class="print-sheet ps-paper" aria-label="A4 试卷预览">
      ${sheetHeadHtml('paper', pageNo, totalPages)}
      <div class="ps-body">
        ${items.map(questionBlockHtml).join('')}
      </div>
      <footer class="ps-foot">
        <span>知错 · 错题本</span>
        <span>共 ${items.length} 题</span>
      </footer>
    </article>`;
  }

  function answersSheetHtml(items, pageNo, totalPages) {
    return `<article class="print-sheet ps-answers" aria-label="参考答案与解析预览">
      ${sheetHeadHtml('answers', pageNo, totalPages)}
      <div class="ps-body">
        ${items.map((question, index) => {
          const mistakes = Array.isArray(question.commonMistakes) ? question.commonMistakes.filter(Boolean) : [];
          return `<section class="ps-ans">
            <div class="ps-ans-head">
              <span class="ps-q-no">${index + 1}</span>
              <span class="ps-ans-label">答案</span>
              <span class="ps-ans-subject">${escapeHtml(question.subject || '综合')}</span>
            </div>
            <div class="ps-ans-answer">${escapeHtml(question.answer || '略')}</div>
            ${question.analysis ? `<div class="ps-ans-analysis">${escapeHtml(question.analysis)}</div>` : ''}
            ${mistakes.length ? `<div class="ps-ans-mistakes"><b>易错点</b>${mistakes.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>` : ''}
          </section>`;
        }).join('')}
      </div>
      <footer class="ps-foot">
        <span>知错 · 错题本</span>
        <span>答案页</span>
      </footer>
    </article>`;
  }

  function placeholderHtml() {
    return `<div class="pp-placeholder">
      <div class="pp-placeholder-art">${icon('paper', 34)}</div>
      <h3 class="pp-placeholder-title">A4 预览</h3>
      <p>在左侧勾选题目，这里会实时排成一张 A4 试卷；打开「附答案解析」会多出一页答案。</p>
    </div>`;
  }

  function syncPreview() {
    const stack = root.querySelector('#ppStack');
    if (!stack) return;
    const items = selectedQuestions();
    if (!items.length) {
      stack.innerHTML = placeholderHtml();
    } else {
      const totalPages = pagesCount();
      let html = paperSheetHtml(items, 1, totalPages);
      if (S.includeAnswers) html += answersSheetHtml(items, 2, totalPages);
      stack.innerHTML = html;
    }
    stack.querySelectorAll('img').forEach((img) => {
      if (!img.complete) img.addEventListener('load', fit, { once: true });
    });
    syncConsole();
    requestAnimationFrame(fit);
  }

  function updateChrome() {
    const stack = root.querySelector('#ppStack');
    if (!stack) return;
    const titleEl = stack.querySelector('.ps-title');
    if (titleEl) titleEl.textContent = S.title.trim() || '未命名试卷';
    const subEl = stack.querySelector('.ps-sub');
    if (subEl) {
      const value = S.subtitle.trim();
      subEl.textContent = value;
      if (S.showSubtitle && value) subEl.removeAttribute('hidden');
      else subEl.setAttribute('hidden', '');
    }
    requestAnimationFrame(fit);
  }

  function fit() {
    const preview = root.querySelector('#ppPreview');
    const wrap = root.querySelector('#ppScaleWrap');
    const stack = root.querySelector('#ppStack');
    if (!preview || !wrap || !stack) return;
    const available = Math.max(240, preview.clientWidth - 34);
    const scale = Math.max(0.3, Math.min(1, available / 794));
    stack.style.transform = `scale(${scale})`;
    wrap.style.height = `${Math.max(0, Math.ceil(stack.offsetHeight * scale))}px`;
  }

  function observePreview() {
    const preview = root.querySelector('#ppPreview');
    if (!preview) return;
    if (typeof ResizeObserver === 'function') {
      if (!observer) {
        observer = new ResizeObserver(() => fit());
        addCleanup(() => {
          if (observer) {
            observer.disconnect();
            observer = null;
          }
        });
      }
      observer.disconnect();
      observer.observe(preview);
    }
    fit();
  }

  // ---------- 打印 / 导出 ----------

  function printPaper() {
    if (!S.selected.length) {
      toast('请先勾选要打印的题目', 'info');
      return;
    }
    const cleanup = () => {
      document.body.classList.remove('printing');
    };
    document.body.classList.add('printing');
    window.addEventListener('afterprint', cleanup, { once: true });
    try {
      window.print();
    } catch (error) {
      toast('打印面板没有打开，可以改用「导出 PDF」', 'error');
    } finally {
      setTimeout(cleanup, 900);
    }
  }

  async function doExport(format) {
    if (S.busy) return;
    const items = selectedQuestions();
    if (!items.length) {
      toast('请先勾选要导出的题目', 'info');
      return;
    }
    S.busy = true;
    syncConsole();
    try {
      toast('正在生成试卷，请稍候…', 'info');
      const result = await exportQuestionSet({
        title: S.title.trim() || '知错 · 错题重练卷',
        subtitle: subtitleText(),
        questions: items.map((question) => ({
          text: question.text,
          answer: question.answer,
          analysis: question.analysis,
          knowledgePoints: question.knowledgePoints || [],
          knowledgeGuide: question.knowledgeGuide || [],
          errorType: question.errorType || '',
          errorReason: question.errorReason || '',
          subject: question.subject,
          difficulty: question.difficulty,
        })),
        includeAnswers: S.includeAnswers,
        includeGuide: true,
        format,
        filename: `知错-错题重练卷-${dateStamp()}`,
      });
      const pages = result && result.pages ? `${result.pages} 页` : '';
      toast(`已生成${pages}${format === 'png' ? '图片' : ' PDF'}`, 'success');
    } catch (error) {
      toast(errText(error), 'error');
    } finally {
      if (!disposed) {
        S.busy = false;
        syncConsole();
      }
    }
  }

  // ---------- 事件 ----------

  const onClick = (event) => {
    if (disposed) return;
    const actionEl = event.target && event.target.closest ? event.target.closest('[data-act]') : null;
    if (actionEl && root.contains(actionEl)) {
      switch (actionEl.dataset.act) {
        case 'print':
          printPaper();
          break;
        case 'export-pdf':
          doExport('pdf');
          break;
        case 'export-png':
          doExport('png');
          break;
        case 'retry':
          loadQuestions();
          break;
        case 'go-book':
          navigate('#/book');
          break;
        case 'go-add':
          navigate('#/add');
          break;
        case 'select-all': {
          const ids = filteredQuestions().map((question) => question.id);
          ids.forEach((id) => {
            if (!S.selected.includes(id)) S.selected.push(id);
          });
          renderBank();
          syncPreview();
          break;
        }
        case 'clear':
          S.selected = [];
          renderBank();
          syncPreview();
          break;
        case 'reset-filter':
          S.filters = { subject: '', dmin: 1, dmax: 5, sort: 'recent' };
          renderBank();
          syncFilterSelects();
          break;
        default:
          break;
      }
      return;
    }

    const targetEl = event.target.closest ? event.target.closest('[data-target]') : null;
    if (targetEl && root.contains(targetEl)) {
      const value = Number(targetEl.dataset.target) || 0;
      S.target = value;
      const list = filteredQuestions();
      S.selected = (value ? list.slice(0, value) : list).map((question) => question.id);
      renderBank();
      syncPreview();
    }
  };

  const onChange = (event) => {
    if (disposed) return;
    const el = event.target;
    if (!el) return;

    if (el.id === 'ppSubject') {
      S.filters.subject = el.value;
      renderBank();
      return;
    }
    if (el.id === 'ppDiffMin') {
      S.filters.dmin = Number(el.value) || 1;
      if (Number(S.filters.dmin) > Number(S.filters.dmax)) S.filters.dmax = S.filters.dmin;
      syncFilterSelects();
      renderBank();
      return;
    }
    if (el.id === 'ppDiffMax') {
      S.filters.dmax = Number(el.value) || 5;
      if (Number(S.filters.dmax) < Number(S.filters.dmin)) S.filters.dmin = S.filters.dmax;
      syncFilterSelects();
      renderBank();
      return;
    }
    if (el.id === 'ppSort') {
      S.filters.sort = el.value;
      renderBank();
      return;
    }
    if (el.id === 'ppShowSubtitle') {
      S.showSubtitle = Boolean(el.checked);
      syncPreview();
      return;
    }
    if (el.id === 'ppShowMeta') {
      S.showMeta = Boolean(el.checked);
      syncPreview();
      return;
    }
    if (el.id === 'ppIncludeAnswers') {
      S.includeAnswers = Boolean(el.checked);
      syncPreview();
      return;
    }
    if (el.matches && el.matches('input[data-qid]')) {
      const id = el.dataset.qid;
      if (el.checked) {
        if (!S.selected.includes(id)) S.selected.push(id);
      } else {
        S.selected = S.selected.filter((item) => item !== id);
      }
      const row = el.closest('.pp-bank-row');
      if (row) row.classList.toggle('is-checked', el.checked);
      syncPreview();
    }
  };

  const onInput = (event) => {
    if (disposed) return;
    const el = event.target;
    if (!el) return;
    if (el.id === 'ppTitle') {
      S.title = el.value;
      updateChrome();
      return;
    }
    if (el.id === 'ppSubtitle') {
      S.subtitle = el.value;
      updateChrome();
    }
  };

  function syncFilterSelects() {
    const min = root.querySelector('#ppDiffMin');
    const max = root.querySelector('#ppDiffMax');
    const subject = root.querySelector('#ppSubject');
    const sort = root.querySelector('#ppSort');
    if (min) min.value = String(S.filters.dmin);
    if (max) max.value = String(S.filters.dmax);
    if (subject) subject.value = S.filters.subject;
    if (sort) sort.value = S.filters.sort;
  }

  // ---------- 加载 ----------

  async function loadQuestions() {
    S.loading = true;
    S.error = '';
    renderLoading();
    try {
      const res = await api.questions({ limit: 200 });
      if (disposed) return;
      const items = res && Array.isArray(res.items) ? res.items : Array.isArray(res) ? res : [];
      S.questions = items;
      S.loading = false;
      if (!items.length) {
        renderEmptyPage();
        return;
      }
      const initial = filteredQuestions().slice(0, S.target);
      S.selected = initial.map((question) => question.id);
      renderPage();
    } catch (error) {
      if (disposed) return;
      S.loading = false;
      S.error = errText(error);
      renderErrorPage();
    }
  }

  // ---------- 生命周期 ----------

  function startView() {
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('input', onInput);
    addCleanup(() => root.removeEventListener('click', onClick));
    addCleanup(() => root.removeEventListener('change', onChange));
    addCleanup(() => root.removeEventListener('input', onInput));

    if (!resizeBound) {
      resizeBound = true;
      const onResize = () => fit();
      window.addEventListener('resize', onResize);
      addCleanup(() => window.removeEventListener('resize', onResize));
    }

    loadQuestions();
  }

  function destroyView() {
    if (cleanupRan) return;
    cleanupRan = true;
    disposed = true;
    document.body.classList.remove('printing');
    cleanups.forEach((fn) => fn());
    cleanups.length = 0;
  }

  return { start: startView, destroy: destroyView };
}
