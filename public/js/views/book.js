/* ==========================================================================
   知错 · 智能错题本 —— 错题本 Book
   纸质索引卡 + 详情抽屉 + 编辑/删除
   依赖：../api.js、../ui.js（见 BUILD_CONTRACT.md 第 5 节）
   ========================================================================== */

import { api } from '../api.js';
import {
  escapeHtml,
  icon,
  fmtDate,
  fmtRelative,
  masteryLabel,
  difficultyLabel,
  subjectClass,
  openDrawer,
  closeDrawer,
  openModal,
  confirmDialog,
  debounce,
  toast,
  ring,
} from '../ui.js';

/* ---------------------------------------------------------------- 常量 */

const ERROR_TYPES = ['概念不清', '审题失误', '计算失误', '方法不当', '迁移不足', '表达不规范', '其他'];

const SUBJECT_COLORS = {
  数学: '#3E5C76',
  物理: '#4A5578',
  化学: '#C79A4B',
  英语: '#4E7C6A',
  语文: '#C94B36',
  生物: '#6E8B4F',
  历史: '#8A6A4B',
  地理: '#46787A',
  政治: '#7E5A6A',
};
const SUBJECT_FALLBACK = '#7C7C72';
const MASTERY_TONES = ['new', 'low', 'mid', 'high'];
const RESULT_META = {
  mastered: { label: '掌握', tone: 'sage' },
  fuzzy: { label: '模糊', tone: 'gold' },
  failed: { label: '未掌握', tone: 'red' },
};
const STATUS_LABELS = { new: '新录入', learning: '巩固中', mastered: '已掌握' };
const WEAK_LEVELS = ['未掌握', '薄弱'];
const LEVEL_TONE = {
  未掌握: 'red',
  薄弱: 'gold',
  基本掌握: 'sage',
  熟练: 'sage-strong',
};
const SORTS = [
  { v: 'updated', t: '最近更新' },
  { v: 'mastery', t: '掌握度低 → 高' },
  { v: 'difficulty', t: '难度高 → 低' },
];

/* -------------------------------------------------------------- 运行时 */

let session = null;
let all = [];
let currentDetailId = null;
let runSeq = 0;
const filters = {
  q: '',
  subject: '',
  status: '',
  difficulty: '',
  starred: false,
  sort: 'updated',
  tag: '',
  errorType: '',
};

/* ---------------------------------------------------------------- 工具 */

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clampPct(v) {
  return Math.max(0, Math.min(100, Math.round(num(v, 0))));
}

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

function subjectColor(subject) {
  return SUBJECT_COLORS[String(subject || '').trim()] || SUBJECT_FALLBACK;
}

function clip(text, max) {
  const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function nl2br(text) {
  return escapeHtml(String(text == null ? '' : text)).replace(/\r?\n/g, '<br>');
}

function errorMessage(err, fallback) {
  if (err && typeof err.message === 'string' && err.message.trim()) return err.message;
  if (err && typeof err.error === 'string' && err.error.trim()) return err.error;
  return fallback;
}

function dateText(iso, style) {
  try {
    const out = fmtDate(iso, style || 'short');
    return out ? String(out) : '—';
  } catch (err) {
    return '—';
  }
}

function relText(iso) {
  try {
    const out = fmtRelative(iso);
    return out ? String(out) : '—';
  } catch (err) {
    return '—';
  }
}

function masteryTone(value) {
  let tone = '';
  try {
    const m = masteryLabel(value);
    tone = m && m.tone ? String(m.tone) : '';
  } catch (err) {
    tone = '';
  }
  return MASTERY_TONES.indexOf(tone) >= 0 ? tone : 'mid';
}

function masteryText(value) {
  try {
    const m = masteryLabel(value);
    return (m && m.label) || '稳步积累';
  } catch (err) {
    return '稳步积累';
  }
}

function safeSubjectClass(subject) {
  try {
    const cls = subjectClass(subject);
    return cls ? String(cls).replace(/[^a-zA-Z0-9_-]/g, '') : '';
  } catch (err) {
    return '';
  }
}

function diffDots(level) {
  const n = Math.max(1, Math.min(5, Math.round(num(level, 3))));
  let out = '<span class="diff-dots" aria-hidden="true">';
  for (let i = 1; i <= 5; i += 1) out += `<i class="${i <= n ? 'on' : ''}"></i>`;
  return `${out}</span>`;
}

function masteryBar(value) {
  return `<span class="mastery-bar bk-mbar bk-tone-${masteryTone(value)}"><i style="width:${clampPct(
    value
  )}%"></i></span>`;
}

function safeRing(value, size, stroke) {
  try {
    return String(ring(clampPct(value), size, stroke) || '');
  } catch (err) {
    return '';
  }
}

function splitSteps(text) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw) return [];
  let parts = raw
    .split(/\r?\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 1) {
    const markers = /(?=\s*(?:\d{1,2}[.、)）]|[①②③④⑤⑥⑦⑧⑨⑩]|第[一二三四五六七八九十]步))/;
    const split = raw.split(markers).map((s) => s.trim()).filter(Boolean);
    if (split.length > 1) parts = split;
  }
  return parts;
}

function parseKnowledgePoints(raw) {
  return String(raw || '')
    .split(/[,，、;；\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s, i, arr) => arr.indexOf(s) === i);
}

function normalize(item) {
  const q = Object.assign({}, item || {});
  const safeArray = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
  q.id = String(q.id == null ? '' : q.id);
  q.text = String(q.text == null ? '' : q.text);
  q.answer = String(q.answer == null ? '' : q.answer);
  q.analysis = String(q.analysis == null ? '' : q.analysis);
  q.commonMistakes = safeArray(q.commonMistakes).map((v) => String(v));
  q.knowledgePoints = safeArray(q.knowledgePoints).map((v) => String(v));
  q.knowledgeGuide = safeArray(q.knowledgeGuide).map((g) => ({
    point: String((g && g.point) || ''),
    concept: String((g && g.concept) || ''),
    keyPoints: safeArray(g && g.keyPoints).map((v) => String(v)),
    pitfalls: safeArray(g && g.pitfalls).map((v) => String(v)),
    checklist: safeArray(g && g.checklist).map((v) => String(v)),
  }));
  q.variants = safeArray(q.variants).map((v, i) => ({
    id: String((v && v.id) || `v_${i + 1}`),
    text: String((v && v.text) || ''),
    answer: String((v && v.answer) || ''),
    analysis: String((v && v.analysis) || ''),
    hint: String((v && v.hint) || ''),
    point: String((v && v.point) || ''),
  }));
  q.studentWork = String(q.studentWork || '');
  q.masteryAssessment = safeArray(q.masteryAssessment).map((m) => ({
    point: String((m && m.point) || ''),
    level: String((m && m.level) || ''),
    evidence: String((m && m.evidence) || ''),
    gap: String((m && m.gap) || ''),
    microLesson: String((m && m.microLesson) || ''),
  }));
  q.targetedAdvice = String(q.targetedAdvice || '');
  q.attempts = safeArray(q.attempts).map((a, i) => ({
    id: String((a && a.id) || `a_${i + 1}`),
    variantId: a && a.variantId ? String(a.variantId) : null,
    result: a && RESULT_META[a.result] ? a.result : 'fuzzy',
    at: String((a && a.at) || ''),
  }));
  q.difficulty = Math.max(1, Math.min(5, Math.round(num(q.difficulty, 3))));
  q.mastery = clampPct(q.mastery);
  q.status = STATUS_LABELS[q.status] ? q.status : 'new';
  q.subject = String(q.subject || '未分类');
  q.grade = String(q.grade || '');
  q.source = String(q.source || '');
  q.errorType = String(q.errorType || '');
  q.errorReason = String(q.errorReason || '');
  q.remedy = String(q.remedy || '');
  q.notes = String(q.notes || '');
  q.imageUrl = q.imageUrl ? String(q.imageUrl) : '';
  q.starred = !!q.starred;
  q.reviewCount = Math.max(0, Math.round(num(q.reviewCount)));
  q.createdAt = String(q.createdAt || '');
  q.updatedAt = String(q.updatedAt || q.createdAt || '');
  q.nextReviewAt = String(q.nextReviewAt || '');
  return q;
}

/* --------------------------------------------------------------- 路由 */

function parseQuery(ctx) {
  const out = {};
  const q = ctx && ctx.query;
  if (q && typeof q === 'object') {
    Object.keys(q).forEach((k) => {
      if (q[k] != null && q[k] !== '') out[k] = String(q[k]);
    });
  }
  if (!Object.keys(out).length && typeof location !== 'undefined') {
    const hash = String(location.hash || '');
    const idx = hash.indexOf('?');
    if (idx >= 0) {
      try {
        new URLSearchParams(hash.slice(idx + 1)).forEach((v, k) => {
          out[k] = v;
        });
      } catch (err) {
        /* 忽略非法 query */
      }
    }
  }
  return out;
}

function initFilters(query) {
  const status = String(query.status || '');
  const difficulty = String(query.difficulty || '');
  const sort = String(query.sort || '');
  filters.q = String(query.q || '');
  filters.subject = String(query.subject || '');
  filters.status = status === 'due' || status === 'mastered' ? status : '';
  filters.difficulty = ['1', '2', '3', '4', '5'].indexOf(difficulty) >= 0 ? difficulty : '';
  filters.starred = ['1', 'true', 'yes'].indexOf(String(query.starred || '')) >= 0;
  filters.sort = SORTS.some((s) => s.v === sort) ? sort : 'updated';
  filters.tag = String(query.tag || '');
  filters.errorType = String(query.errorType || '');
}

function syncHash() {
  if (typeof location === 'undefined') return;
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.subject) params.set('subject', filters.subject);
  if (filters.status) params.set('status', filters.status);
  if (filters.difficulty) params.set('difficulty', filters.difficulty);
  if (filters.starred) params.set('starred', '1');
  if (filters.sort !== 'updated') params.set('sort', filters.sort);
  if (filters.tag) params.set('tag', filters.tag);
  if (filters.errorType) params.set('errorType', filters.errorType);
  const qs = params.toString();
  const next = `#/book${qs ? `?${qs}` : ''}`;
  if (location.hash === next) return;
  try {
    history.replaceState(null, '', next);
  } catch (err) {
    /* replaceState 不可用时静默失败，不影响筛选 */
  }
}

function go(hash) {
  const ctx = (session && session.ctx) || {};
  if (typeof ctx.navigate === 'function') {
    try {
      ctx.navigate(hash);
      return;
    } catch (err) {
      /* 回退 */
    }
  }
  window.location.hash = hash;
}

function refreshShell() {
  const ctx = (session && session.ctx) || {};
  if (typeof ctx.refreshShell === 'function') {
    try {
      ctx.refreshShell();
    } catch (err) {
      /* 忽略 */
    }
  }
}

/* --------------------------------------------------------------- 过滤 */

function activeFilterCount() {
  let n = 0;
  if (filters.q) n += 1;
  if (filters.subject) n += 1;
  if (filters.status) n += 1;
  if (filters.difficulty) n += 1;
  if (filters.starred) n += 1;
  if (filters.tag) n += 1;
  if (filters.errorType) n += 1;
  return n;
}

function filteredList() {
  const keyword = filters.q.trim().toLowerCase();
  const list = all.filter((q) => {
    if (filters.subject && q.subject !== filters.subject) return false;
    if (filters.status === 'due' && q.status === 'mastered') return false;
    if (filters.status === 'mastered' && q.status !== 'mastered') return false;
    if (filters.difficulty && String(q.difficulty) !== filters.difficulty) return false;
    if (filters.starred && !q.starred) return false;
    if (filters.errorType && q.errorType !== filters.errorType) return false;
    if (filters.tag) {
      const hit = q.knowledgePoints.some(
        (p) => p === filters.tag || p.indexOf(filters.tag) >= 0 || filters.tag.indexOf(p) >= 0
      );
      if (!hit) return false;
    }
    if (keyword) {
      const hay = `${q.text} ${q.answer} ${q.knowledgePoints.join(' ')} ${q.notes} ${q.errorReason}`.toLowerCase();
      if (hay.indexOf(keyword) < 0) return false;
    }
    return true;
  });

  const time = (iso) => {
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : 0;
  };

  list.sort((a, b) => {
    if (filters.sort === 'mastery') {
      if (a.mastery !== b.mastery) return a.mastery - b.mastery;
      return time(b.updatedAt) - time(a.updatedAt);
    }
    if (filters.sort === 'difficulty') {
      if (a.difficulty !== b.difficulty) return b.difficulty - a.difficulty;
      return time(b.updatedAt) - time(a.updatedAt);
    }
    return time(b.updatedAt) - time(a.updatedAt);
  });

  return list;
}

/* -------------------------------------------------------------- 片段 */

function chipsHtml() {
  const counts = new Map();
  all.forEach((q) => {
    const s = q.subject || '未分类';
    counts.set(s, (counts.get(s) || 0) + 1);
  });
  const subjects = Array.from(counts.keys()).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  const parts = [
    `<button type="button" class="chip${filters.subject ? '' : ' active'}" data-subject-chip="" aria-pressed="${
      filters.subject ? 'false' : 'true'
    }">全部 <b class="mono">${all.length}</b></button>`,
  ];
  subjects.forEach((s) => {
    const active = filters.subject === s;
    parts.push(
      `<button type="button" class="chip${active ? ' active' : ''}" data-subject-chip="${escapeHtml(
        s
      )}" aria-pressed="${active ? 'true' : 'false'}">${escapeHtml(s)} <b class="mono">${
        counts.get(s) || 0
      }</b></button>`
    );
  });
  return parts.join('');
}

function activeFiltersHtml() {
  const items = [];
  if (filters.tag) items.push({ key: 'tag', label: `知识点：${filters.tag}` });
  if (filters.errorType) items.push({ key: 'errorType', label: `错因：${filters.errorType}` });
  if (filters.q) items.push({ key: 'q', label: `搜索：${filters.q}` });
  if (filters.difficulty) items.push({ key: 'difficulty', label: `难度 ${filters.difficulty}` });
  if (filters.status) {
    items.push({ key: 'status', label: filters.status === 'due' ? '待复习' : '已掌握' });
  }
  if (filters.starred) items.push({ key: 'starred', label: '仅收藏' });
  if (!items.length) return '';
  return [
    '<span class="bk-active-label mono">已筛</span>',
    items
      .map(
        (it) =>
          `<button type="button" class="bk-active-chip" data-clear-filter="${it.key}">${escapeHtml(
            it.label
          )}${icon('x', 12)}</button>`
      )
      .join(''),
    '<button type="button" class="bk-active-reset" data-reset-filters>清除全部</button>',
  ].join('');
}

function statusOptions() {
  return [
    ['', '全部状态'],
    ['due', '待复习'],
    ['mastered', '已掌握'],
  ]
    .map(
      ([v, label]) =>
        `<option value="${v}"${filters.status === v ? ' selected' : ''}>${label}</option>`
    )
    .join('');
}

function difficultyOptions() {
  let out = `<option value=""${filters.difficulty === '' ? ' selected' : ''}>全部难度</option>`;
  for (let i = 1; i <= 5; i += 1) {
    out += `<option value="${i}"${filters.difficulty === String(i) ? ' selected' : ''}>难度 ${i}</option>`;
  }
  return out;
}

function errorTypeOptions() {
  const present = new Set();
  all.forEach((q) => {
    if (q.errorType) present.add(q.errorType);
  });
  const list = ERROR_TYPES.filter((t) => present.has(t)).concat(
    Array.from(present).filter((t) => ERROR_TYPES.indexOf(t) < 0)
  );
  if (filters.errorType && list.indexOf(filters.errorType) < 0) list.unshift(filters.errorType);
  return (
    `<option value=""${filters.errorType === '' ? ' selected' : ''}>全部错因</option>` +
    list
      .map(
        (t) =>
          `<option value="${escapeHtml(t)}"${
            filters.errorType === t ? ' selected' : ''
          }>${escapeHtml(t)}</option>`
      )
      .join('')
  );
}

function sortOptions() {
  return SORTS.map(
    (s) => `<option value="${s.v}"${filters.sort === s.v ? ' selected' : ''}>${s.t}</option>`
  ).join('');
}

/* ---------------------------------------------------------------- 骨架 */

function skeletonHtml() {
  const card = '<div class="bk-skel bk-skel-card"></div>';
  return `
  <div class="page bk-page bk-loading" aria-busy="true" aria-live="polite">
    <div class="bk-head">
      <div>
        <div class="bk-skel bk-skel-kicker"></div>
        <div class="bk-skel bk-skel-title"></div>
        <div class="bk-skel bk-skel-sub"></div>
      </div>
      <div class="bk-skel bk-skel-btn"></div>
    </div>
    <div class="bk-skel bk-skel-filter"></div>
    <div class="bk-grid bk-skel-grid">${card}${card}${card}${card}${card}${card}</div>
    <span class="bk-sr-only">正在加载错题本…</span>
  </div>`;
}

/* ---------------------------------------------------------------- 外壳 */

function shellHtml(s) {
  return `
  <div class="page bk-page">
    <header class="bk-head">
      <div class="bk-head-main">
        <div class="bk-kicker"><span class="bk-kicker-rule" aria-hidden="true"></span>NOTEBOOK / 错题本</div>
        <div class="bk-title-row">
          <h1 class="bk-title">错题本</h1>
          <span class="bk-count mono" data-count>共 0 道</span>
        </div>
        <p class="bk-sub">按学科、掌握度与错因筛一遍，找到今天最该重做的那几道。</p>
      </div>
      <div class="bk-head-actions">
        <span class="bk-head-hint small muted">点卡片看答案、错因诊断与掌握指南</span>
        <a class="btn btn-primary bk-add" href="#/add">${icon('plus', 16)}录入错题</a>
      </div>
    </header>

    <div class="bk-filter paper-card">
      <div class="bk-filter-top">
        <label class="bk-search">
          <span class="bk-search-icon" aria-hidden="true">${icon('search', 16)}</span>
          <input class="bk-search-input" type="search" data-search placeholder="搜索题干 / 答案 / 知识点…"
            value="${escapeHtml(filters.q)}" autocomplete="off" aria-label="搜索错题">
          <button type="button" class="bk-search-clear" data-clear-search aria-label="清空搜索"${
            filters.q ? '' : ' hidden'
          }>${icon('x', 14)}</button>
        </label>
        <div class="bk-filter-selects">
          <label class="bk-ctl"><span class="bk-ctl-label">状态</span><select class="select bk-select" data-filter="status" aria-label="按状态筛选">${statusOptions()}</select></label>
          <label class="bk-ctl"><span class="bk-ctl-label">难度</span><select class="select bk-select" data-filter="difficulty" aria-label="按难度筛选">${difficultyOptions()}</select></label>
          <label class="bk-ctl"><span class="bk-ctl-label">错因</span><select class="select bk-select" data-filter="errorType" aria-label="按错因筛选">${errorTypeOptions()}</select></label>
          <label class="bk-ctl"><span class="bk-ctl-label">排序</span><select class="select bk-select" data-filter="sort" aria-label="排序方式">${sortOptions()}</select></label>
          <button type="button" class="bk-star-toggle${filters.starred ? ' is-on' : ''}" data-toggle-star aria-pressed="${
            filters.starred ? 'true' : 'false'
          }">${icon('star', 14)}<span>收藏</span></button>
        </div>
      </div>
      <div class="bk-chips" data-chips>${chipsHtml()}</div>
      <div class="bk-active" data-active${activeFilterCount() ? '' : ' hidden'}>${activeFiltersHtml()}</div>
    </div>

    <div class="bk-list" data-list aria-live="polite"></div>
  </div>`;
}

/* ---------------------------------------------------------------- 卡片 */

function cardHtml(q, index) {
  const color = subjectColor(q.subject);
  const subjCls = safeSubjectClass(q.subject);
  const tone = masteryTone(q.mastery);
  const kps = q.knowledgePoints.slice(0, 3);
  const extra = Math.max(0, q.knowledgePoints.length - kps.length);
  const mastered = q.status === 'mastered';
  const idAttr = escapeHtml(q.id);
  const title = clip(q.text, 60) || '（无题干）';

  return `
  <article class="bk-card${mastered ? ' is-mastered' : ''}${q.starred ? ' is-starred' : ''}" data-qid="${idAttr}"
    tabindex="0" role="button" aria-label="${escapeHtml(`${q.subject}，${title}`)}" style="--i:${index}">
    <span class="bk-card-tab" style="background:${color}" aria-hidden="true"></span>
    <div class="bk-card-head">
      <span class="bk-subj${subjCls ? ` ${subjCls}` : ''}" style="--subj:${color}">${escapeHtml(q.subject)}</span>
      ${mastered ? '<span class="bk-stamp">已攻克</span>' : ''}
      <span class="bk-card-diff">${diffDots(q.difficulty)}</span>
      <div class="bk-card-tools">
        <button type="button" class="bk-icon-btn${q.starred ? ' is-on' : ''}" data-act="star" data-qid="${idAttr}"
          aria-label="${q.starred ? '取消收藏' : '收藏'}" aria-pressed="${q.starred ? 'true' : 'false'}">${icon('star', 15)}</button>
        <button type="button" class="bk-icon-btn" data-act="more" data-qid="${idAttr}"
          aria-label="更多操作" aria-haspopup="menu">${icon('more', 15)}</button>
        <div class="bk-menu" role="menu">
          <button type="button" class="bk-menu-item" role="menuitem" data-act="edit" data-qid="${idAttr}">${icon('edit', 14)}编辑</button>
          <button type="button" class="bk-menu-item is-danger" role="menuitem" data-act="del" data-qid="${idAttr}">${icon('trash', 14)}删除</button>
        </div>
      </div>
    </div>
    <p class="bk-card-text">${nl2br(clip(q.text, 140)) || '（无题干内容）'}</p>
    <div class="bk-card-tags">
      ${kps
        .map(
          (p) =>
            `<button type="button" class="tag tag-muted bk-tag" data-tag="${escapeHtml(p)}">${escapeHtml(p)}</button>`
        )
        .join('')}
      ${extra > 0 ? `<span class="tag tag-muted bk-tag is-more">+${extra}</span>` : ''}
      ${q.errorType ? `<span class="bk-card-error">${escapeHtml(q.errorType)}</span>` : ''}
    </div>
    <div class="bk-card-foot">
      <span class="bk-mastery">${masteryBar(q.mastery)}<b class="mastery-num mono">${clampPct(q.mastery)}</b></span>
      <span class="bk-card-date" title="更新于 ${escapeHtml(dateText(q.updatedAt))}">${escapeHtml(
        relText(q.updatedAt)
      )}</span>
    </div>
  </article>`;
}

function emptyAllHtml() {
  return `
  <div class="empty bk-empty">
    <div class="bk-empty-icon" aria-hidden="true">${icon('book', 28)}</div>
    <h2 class="bk-empty-title">错题本还是空的</h2>
    <p class="bk-empty-desc">录入第一道错题，AI 会拆解错因、生成变式题与掌握指南，之后在这里按知识点复盘。</p>
    <a class="btn btn-primary bk-empty-cta" href="#/add">${icon('plus', 16)}去录入</a>
  </div>`;
}

function emptyFilteredHtml() {
  return `
  <div class="empty bk-empty">
    <div class="bk-empty-icon" aria-hidden="true">${icon('filter', 26)}</div>
    <h2 class="bk-empty-title">没有符合条件的错题</h2>
    <p class="bk-empty-desc">换个关键词，或清除筛选看看全部 ${all.length} 道错题。</p>
    <button type="button" class="btn btn-line bk-empty-cta" data-reset-filters>清除筛选</button>
  </div>`;
}

/* ------------------------------------------------------------ 详情抽屉 */

function detailTop(q) {
  return `
  <div class="bk-detail-top">
    <span class="bk-subj bk-subj-lg" style="--subj:${subjectColor(q.subject)}">${escapeHtml(q.subject)}</span>
    ${q.grade ? `<span class="tag tag-muted">${escapeHtml(q.grade)}</span>` : ''}
    <span class="bk-status bk-status-${q.status}">${escapeHtml(STATUS_LABELS[q.status] || '未归类')}</span>
    <span class="bk-detail-diff">${diffDots(q.difficulty)}<em>${escapeHtml(
      String(difficultyLabel(q.difficulty) || '')
    )}</em></span>
  </div>`;
}

function detailMastery(q) {
  return `
  <div class="bk-detail-mastery">
    <div class="bk-detail-ring">${safeRing(q.mastery, 76, 6)}</div>
    <div class="bk-detail-fig">
      <span class="bk-detail-num mono">${clampPct(q.mastery)}<i>%</i></span>
      <span class="small muted">${escapeHtml(masteryText(q.mastery))} · 已复习 ${num(q.reviewCount)} 次</span>
    </div>
    <div class="bk-detail-next">
      <span class="small muted">下次复习</span>
      <b>${escapeHtml(dateText(q.nextReviewAt))}</b>
    </div>
  </div>`;
}

function guideBlock(label, kind, items) {
  if (!Array.isArray(items) || !items.length) return '';
  return `
  <div class="bk-guide-block bk-guide-${kind}">
    <span class="bk-guide-label">${escapeHtml(label)}</span>
    <ul>${items.map((it) => `<li>${nl2br(it)}</li>`).join('')}</ul>
  </div>`;
}

function guideHtml(list, qid) {
  const guides = Array.isArray(list) ? list : [];
  if (!guides.length) {
    return '<div class="bk-mini-empty">这道题还没有生成掌握指南。可在录入页让 AI 补全，或先看上面的答案与解析。</div>';
  }
  return guides
    .map((g, i) => {
      const point = String((g && g.point) || '');
      const concept = String((g && g.concept) || '');
      return `
      <details class="bk-guide"${i === 0 ? ' open' : ''}>
        <summary class="bk-guide-sum">
          <span class="bk-guide-idx mono">${pad2(i + 1)}</span>
          <span class="bk-guide-point">${escapeHtml(point || '知识点')}</span>
          <span class="bk-guide-chev" aria-hidden="true">${icon('chevron-down', 14)}</span>
        </summary>
        <div class="bk-guide-body">
          ${concept ? `<p class="bk-guide-concept">${nl2br(concept)}</p>` : ''}
          ${guideBlock('要点', 'key', g && g.keyPoints)}
          ${guideBlock('陷阱', 'pit', g && g.pitfalls)}
          ${guideBlock('自检', 'check', g && g.checklist)}
          <button type="button" class="btn btn-sm btn-line bk-guide-cta" data-practice="${escapeHtml(qid)}">
            ${icon('practice', 14)}重做变式
          </button>
        </div>
      </details>`;
    })
    .join('');
}

function variantsHtml(q) {
  if (!q.variants.length) {
    return '<div class="bk-mini-empty">还没有变式题。到练习页可以按知识点生成，再回来对照。</div>';
  }
  return q.variants
    .map(
      (v, i) => `
    <div class="bk-variant">
      <div class="bk-variant-head">
        <span class="bk-variant-idx mono">变式 ${i + 1}</span>
        ${
          v.point
            ? `<span class="bk-variant-point">${icon('target', 11)}${escapeHtml(v.point)}</span>`
            : ''
        }
        ${v.hint ? `<span class="small muted">提示：${nl2br(v.hint)}</span>` : ''}
      </div>
      <p class="bk-variant-text">${nl2br(v.text) || '（无题干）'}</p>
      <details class="bk-fold bk-fold-sub">
        <summary class="bk-fold-sum">${icon('check', 13)}<span>答案</span><span class="bk-fold-chev">${icon(
        'chevron-down',
        12
      )}</span></summary>
        <div class="bk-fold-body">
          <div class="bk-variant-answer">${nl2br(v.answer) || '—'}</div>
          ${v.analysis ? `<p class="small muted bk-variant-analysis">${nl2br(v.analysis)}</p>` : ''}
        </div>
      </details>
    </div>`
    )
    .join('');
}

function attemptsList(q) {
  const time = (iso) => {
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : 0;
  };
  return q.attempts
    .slice()
    .sort((a, b) => time(b.at) - time(a.at))
    .slice(0, 8);
}

function timelineHtml(q) {
  const list = attemptsList(q);
  if (!list.length) {
    return '<div class="bk-mini-empty">还没有练习记录。练一次，就能看到掌握度怎么变。</div>';
  }
  return `<ol class="bk-timeline">${list
    .map((a) => {
      const meta = RESULT_META[a.result] || RESULT_META.fuzzy;
      return `<li class="bk-tl-item bk-tl-${a.result}">
        <span class="bk-tl-dot" aria-hidden="true"></span>
        <span class="bk-tl-result">${escapeHtml(meta.label)}</span>
        <span class="bk-tl-mode small muted">${a.variantId ? '变式题' : '原题'}</span>
        <span class="bk-tl-time small muted" data-rel="${escapeHtml(a.at)}">${escapeHtml(relText(a.at))}</span>
      </li>`;
    })
    .join('')}</ol>`;
}

function studentWorkHtml(q) {
  if (!q.studentWork) return '';
  return `
  <details class="bk-fold bk-fold-work" open>
    <summary class="bk-fold-sum">${icon('edit', 14)}<span>我的解题过程</span><span class="bk-fold-chev">${icon(
    'chevron-down',
    13
  )}</span></summary>
    <div class="bk-fold-body bk-fold-paper">
      <div class="bk-work">${nl2br(q.studentWork)}</div>
      <p class="bk-work-note small muted">保留原始步骤，方便对照到底卡在哪一步。</p>
    </div>
  </details>`;
}

function assessmentHtml(q) {
  const list = Array.isArray(q.masteryAssessment) ? q.masteryAssessment : [];
  const advice = q.targetedAdvice;
  if (!list.length && !advice) return '';

  const blocks = list
    .map((m) => {
      const tone = LEVEL_TONE[m.level] || 'muted';
      const rows = [];
      if (m.evidence) {
        rows.push(
          `<div class="bk-assess-row"><span class="bk-assess-k">证据</span><p>${nl2br(m.evidence)}</p></div>`
        );
      }
      if (m.gap) {
        rows.push(
          `<div class="bk-assess-row"><span class="bk-assess-k">缺口</span><p>${nl2br(m.gap)}</p></div>`
        );
      }
      return `
      <div class="bk-assess">
        <div class="bk-assess-head">
          <span class="bk-assess-point">${escapeHtml(m.point || '知识点')}</span>
          <span class="bk-level bk-lv-${tone}">${escapeHtml(m.level || '未评估')}</span>
        </div>
        ${rows.length ? `<div class="bk-assess-rows">${rows.join('')}</div>` : ''}
        ${
          m.microLesson
            ? `<div class="bk-micro"><span class="bk-micro-k">${icon(
                'spark',
                12
              )}微型讲解</span><p>${nl2br(m.microLesson)}</p></div>`
            : ''
        }
      </div>`;
    })
    .join('');

  return `
  <section class="bk-sec">
    <div class="bk-sec-head">
      <h4 class="bk-sec-title">知识掌握评估</h4>
      <span class="bk-sec-meta small muted">根据你的解题过程判断</span>
    </div>
    ${
      blocks
        ? `<div class="bk-assess-list">${blocks}</div>`
        : '<div class="bk-mini-empty">还没有掌握评估数据。</div>'
    }
    ${
      advice
        ? `<div class="bk-advice"><span class="bk-advice-k">${icon(
            'target',
            13
          )}下一步建议</span><p>${nl2br(advice)}</p></div>`
        : ''
    }
  </section>`;
}

function detailBody(q) {
  const image = q.imageUrl
    ? `<button type="button" class="bk-figure" data-zoom="${escapeHtml(q.imageUrl)}" aria-label="查看题目原图">
        <img src="${escapeHtml(q.imageUrl)}" alt="题目原图" loading="lazy">
        <span class="bk-figure-zoom">${icon('eye', 14)}查看原图</span>
      </button>`
    : '';

  const mistakes = q.commonMistakes.length
    ? `<section class="bk-sec">
        <h4 class="bk-sec-title">易错点</h4>
        <ul class="bk-mistakes">${q.commonMistakes
          .map((m) => `<li><i aria-hidden="true"></i>${nl2br(m)}</li>`)
          .join('')}</ul>
      </section>`
    : '';

  const tags = q.knowledgePoints.length
    ? `<section class="bk-sec">
        <h4 class="bk-sec-title">知识点</h4>
        <div class="bk-tag-row">${q.knowledgePoints
          .map(
            (p) =>
              `<button type="button" class="tag tag-muted bk-filter-tag" data-filter-tag="${escapeHtml(
                p
              )}">${escapeHtml(p)}</button>`
          )
          .join('')}</div>
      </section>`
    : '';

  const notes = q.notes
    ? `<section class="bk-sec">
        <h4 class="bk-sec-title">备注</h4>
        <p class="bk-notes">${nl2br(q.notes)}</p>
      </section>`
    : '';

  const steps = splitSteps(q.analysis);
  const work = studentWorkHtml(q);
  const assess = assessmentHtml(q);

  return `
  <div class="bk-detail">
    ${detailTop(q)}
    ${detailMastery(q)}

    <section class="bk-sec">
      <div class="bk-sec-head">
        <h4 class="bk-sec-title">题干</h4>
        <span class="bk-sec-meta small muted">${escapeHtml(q.source || '来源未标注')}</span>
      </div>
      <p class="bk-question">${nl2br(q.text) || '<span class="muted">（无题干内容）</span>'}</p>
      ${image}
    </section>

    ${work}

    <section class="bk-sec bk-sec-diagnosis">
      <h4 class="bk-sec-title">错因诊断</h4>
      <div class="bk-diagnosis">
        <div class="bk-diagnosis-head">
          <span class="bk-error-chip">${icon('alert', 13)}${escapeHtml(q.errorType || '未归类')}</span>
          <span class="small muted">红笔批注</span>
        </div>
        <p class="bk-diagnosis-text">${
          nl2br(q.errorReason) ||
          '<span class="muted">还没有写错因剖析。点「编辑」补一句：这次到底错在哪一步。</span>'
        }</p>
      </div>
    </section>

    ${assess}

    <details class="bk-fold" open>
      <summary class="bk-fold-sum">${icon('check', 14)}<span>答案与解析</span><span class="bk-fold-chev">${icon(
    'chevron-down',
    13
  )}</span></summary>
      <div class="bk-fold-body">
        <div class="bk-answer">
          <span class="bk-answer-k">答案</span>
          <div class="bk-answer-v">${nl2br(q.answer) || '—'}</div>
        </div>
        ${
          steps.length > 1
            ? `<ol class="bk-steps">${steps.map((s) => `<li>${nl2br(s)}</li>`).join('')}</ol>`
            : `<p class="bk-analysis">${nl2br(steps[0] || '暂无解析。')}</p>`
        }
      </div>
    </details>

    <section class="bk-sec">
      <div class="bk-sec-head">
        <h4 class="bk-sec-title">掌握指南</h4>
        <span class="bk-sec-meta small muted">按知识点逐条过一遍</span>
      </div>
      <div class="bk-guides">${guideHtml(q.knowledgeGuide, q.id)}</div>
      ${
        q.remedy
          ? `<div class="bk-remedy">
              <span class="bk-remedy-k">${icon('target', 14)}补救路线</span>
              <p>${nl2br(q.remedy)}</p>
            </div>`
          : ''
      }
    </section>

    ${mistakes}
    ${tags}

    <details class="bk-fold">
      <summary class="bk-fold-sum">${icon('layers', 14)}<span>变式题</span><span class="bk-fold-count mono">${
    q.variants.length
  }</span><span class="bk-fold-chev">${icon('chevron-down', 13)}</span></summary>
      <div class="bk-fold-body bk-variants">${variantsHtml(q)}</div>
    </details>

    <section class="bk-sec">
      <div class="bk-sec-head">
        <h4 class="bk-sec-title">练习记录</h4>
        <span class="bk-sec-meta small muted">最近 ${Math.min(8, q.attempts.length)} 次</span>
      </div>
      ${timelineHtml(q)}
    </section>

    ${notes}
  </div>`;
}

function detailFooter(q) {
  const weak = (Array.isArray(q.masteryAssessment) ? q.masteryAssessment : []).filter(
    (m) => WEAK_LEVELS.indexOf(m.level) >= 0
  );
  const weakNames = weak
    .map((m) => m.point)
    .filter(Boolean)
    .slice(0, 3);
  const hint = weakNames.length
    ? `会优先练：${weakNames.join(' · ')}`
    : '优先从这道题的变式题开始，先补最薄弱的知识点。';

  return `
  <div class="bk-detail-footer">
    <div class="bk-detail-actions">
      <button type="button" class="btn btn-primary bk-act-weak" data-do="weak">${icon(
        'target',
        15
      )}针对薄弱点出题</button>
      <button type="button" class="btn btn-ghost btn-sm" data-do="practice">${icon(
        'practice',
        14
      )}开始练习</button>
      <button type="button" class="btn btn-line btn-sm" data-do="edit">${icon('edit', 14)}编辑</button>
      <button type="button" class="btn btn-line btn-sm" data-do="star" aria-pressed="${
        q.starred ? 'true' : 'false'
      }">${icon('star', 14)}${q.starred ? '取消收藏' : '收藏'}</button>
      <button type="button" class="btn btn-ghost btn-sm bk-danger" data-do="delete">${icon(
        'trash',
        14
      )}删除</button>
    </div>
    <p class="bk-detail-hint small muted">${escapeHtml(hint)}</p>
  </div>`;
}

/* ------------------------------------------------------------ 详情交互 */

function openDetail(id) {
  const q = all.find((x) => x.id === String(id));
  if (!q) {
    toast('没有找到这道错题，可能已被删除', 'error');
    return;
  }
  // 避免详情抽屉叠加：已有抽屉且没有弹窗时先关掉
  if (document.querySelector('.drawer') && !document.querySelector('.modal')) {
    try {
      closeDrawer();
    } catch (err) {
      /* 忽略 */
    }
  }
  currentDetailId = q.id;
  try {
    const drawer = openDrawer({
      title: `${q.subject} · ${String(difficultyLabel(q.difficulty) || '')}`,
      subtitle: `录入于 ${dateText(q.createdAt)} · 复习 ${num(q.reviewCount)} 次`,
      body: detailBody(q),
      footer: detailFooter(q),
      width: 560,
    });
    if (session) session.drawer = drawer;
  } catch (err) {
    toast('详情面板打开失败，请刷新后重试', 'error');
  }
}

function closeDetailSilently() {
  currentDetailId = null;
  try {
    closeDrawer();
  } catch (err) {
    /* 忽略 */
  }
}

function startPractice(id) {
  const key = String(id || '');
  if (!key) return;
  closeDetailSilently();
  go(`#/practice?question=${encodeURIComponent(key)}`);
}

function openLightbox(url) {
  if (!url) return;
  try {
    openModal({
      title: '题目原图',
      width: 860,
      body: `<div class="bk-lightbox"><img src="${escapeHtml(url)}" alt="题目原图"></div>`,
      actions: [{ label: '关闭', type: 'ghost', close: true }],
    });
  } catch (err) {
    toast('原图打开失败', 'error');
  }
}

/* ------------------------------------------------------------ 编辑弹窗 */

function editFormHtml(q) {
  return `
  <div class="bk-edit">
    <div class="field">
      <label class="label" for="bk-e-text">题干</label>
      <textarea class="textarea" id="bk-e-text" rows="4">${escapeHtml(q.text)}</textarea>
    </div>
    <div class="field">
      <label class="label" for="bk-e-answer">答案</label>
      <textarea class="textarea" id="bk-e-answer" rows="2">${escapeHtml(q.answer)}</textarea>
    </div>
    <div class="field">
      <label class="label" for="bk-e-analysis">解析</label>
      <textarea class="textarea" id="bk-e-analysis" rows="4">${escapeHtml(q.analysis)}</textarea>
    </div>
    <div class="field">
      <label class="label" for="bk-e-work">我的解题过程</label>
      <textarea class="textarea" id="bk-e-work" rows="3" placeholder="写下当时是怎么想的、卡在哪一步、错答是什么">${escapeHtml(
        q.studentWork
      )}</textarea>
    </div>
    <div class="field">
      <label class="label" for="bk-e-kp">知识点（逗号分隔）</label>
      <input class="input" id="bk-e-kp" type="text" value="${escapeHtml(q.knowledgePoints.join('，'))}"
        placeholder="如：二次函数，最值">
    </div>
    <div class="field">
      <span class="label">难度</span>
      <div class="segmented" id="bk-e-diff" data-value="${q.difficulty}" role="group" aria-label="难度">
        ${[1, 2, 3, 4, 5]
          .map(
            (n) =>
              `<button type="button" data-diff="${n}" class="${
                n === q.difficulty ? 'active' : ''
              }" aria-pressed="${n === q.difficulty ? 'true' : 'false'}">${n}</button>`
          )
          .join('')}
      </div>
    </div>
    <div class="field">
      <label class="label" for="bk-e-error">错因类型</label>
      <select class="select" id="bk-e-error">
        ${ERROR_TYPES.map(
          (t) =>
            `<option value="${escapeHtml(t)}"${t === q.errorType ? ' selected' : ''}>${escapeHtml(t)}</option>`
        ).join('')}
      </select>
    </div>
    <div class="field">
      <label class="label" for="bk-e-reason">错因剖析</label>
      <textarea class="textarea" id="bk-e-reason" rows="3">${escapeHtml(q.errorReason)}</textarea>
    </div>
    <div class="field">
      <label class="label" for="bk-e-notes">备注</label>
      <textarea class="textarea" id="bk-e-notes" rows="2">${escapeHtml(q.notes)}</textarea>
    </div>
  </div>`;
}

function fieldValue(id) {
  const el = typeof document !== 'undefined' ? document.getElementById(id) : null;
  return el ? String(el.value == null ? '' : el.value) : '';
}

function selectDifficulty(btn) {
  const group = btn.closest('#bk-e-diff');
  if (!group) return;
  const value = String(btn.getAttribute('data-diff') || '3');
  group.setAttribute('data-value', value);
  group.querySelectorAll('button[data-diff]').forEach((b) => {
    const on = b === btn;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function closeModalSafe(modal) {
  if (modal && typeof modal.close === 'function') {
    try {
      modal.close();
      return;
    } catch (err) {
      /* 回退到 DOM 清理 */
    }
  }
  const root = document.getElementById('overlay-root');
  if (root && root.lastElementChild) {
    root.lastElementChild.remove();
  }
  ['no-scroll', 'modal-open', 'is-locked', 'overflow-hidden'].forEach((cls) =>
    document.body.classList.remove(cls)
  );
  document.body.style.overflow = '';
}

function openEdit(id) {
  const q = all.find((x) => x.id === String(id));
  if (!q) {
    toast('没有找到这道错题', 'error');
    return;
  }
  let modal = null;
  try {
    modal = openModal({
      title: `编辑错题 · ${q.subject}`,
      width: 620,
      body: editFormHtml(q),
      actions: [
        { label: '取消', type: 'ghost', close: true },
        {
          label: '保存修改',
          type: 'primary',
          close: false,
          onClick: () => submitEdit(q.id, modal),
        },
      ],
    });
  } catch (err) {
    toast('编辑面板打开失败', 'error');
  }
}

async function submitEdit(id, modal) {
  const text = fieldValue('bk-e-text').trim();
  if (!text) {
    toast('题干不能为空', 'error');
    return;
  }
  const diffEl = document.getElementById('bk-e-diff');
  const payload = {
    text,
    answer: fieldValue('bk-e-answer').trim(),
    analysis: fieldValue('bk-e-analysis').trim(),
    studentWork: fieldValue('bk-e-work').trim(),
    knowledgePoints: parseKnowledgePoints(fieldValue('bk-e-kp')),
    difficulty: Math.max(1, Math.min(5, Math.round(num(diffEl && diffEl.getAttribute('data-value'), 3)))),
    errorType: fieldValue('bk-e-error'),
    errorReason: fieldValue('bk-e-reason').trim(),
    notes: fieldValue('bk-e-notes').trim(),
  };

  try {
    const res = await api.updateQuestion(id, payload);
    const server = res && (res.question || (res.id ? res : null));
    const idx = all.findIndex((x) => x.id === String(id));
    if (idx >= 0) {
      all[idx] = normalize(Object.assign({}, all[idx], server || payload));
    }
    closeModalSafe(modal);
    toast('修改已保存', 'success');
    if (session) {
      renderList(session);
      syncUI(session);
      openDetail(id);
    }
    refreshShell();
  } catch (err) {
    toast(errorMessage(err, '保存失败，请稍后再试'), 'error');
  }
}

/* -------------------------------------------------------- 收藏 / 删除 */

function updateStarButtons(q) {
  if (!session || !session.root) return;
  const card = session.root.querySelector(`.bk-card[data-qid="${cssEscape(q.id)}"]`);
  if (card) {
    card.classList.toggle('is-starred', q.starred);
    const star = card.querySelector('[data-act="star"]');
    if (star) {
      star.classList.toggle('is-on', q.starred);
      star.setAttribute('aria-pressed', q.starred ? 'true' : 'false');
      star.setAttribute('aria-label', q.starred ? '取消收藏' : '收藏');
    }
  }
  const footerBtn = document.querySelector('.bk-detail-actions [data-do="star"]');
  if (footerBtn && currentDetailId === q.id) {
    footerBtn.innerHTML = `${icon('star', 15)}${q.starred ? '取消收藏' : '收藏'}`;
    footerBtn.setAttribute('aria-pressed', q.starred ? 'true' : 'false');
  }
}

function cssEscape(value) {
  return String(value == null ? '' : value).replace(/["\\]/g, '\\$&');
}

async function toggleStar(id) {
  const q = all.find((x) => x.id === String(id));
  if (!q) return;
  const next = !q.starred;
  q.starred = next;
  updateStarButtons(q);
  try {
    const res = await api.updateQuestion(q.id, { starred: next });
    const server = res && (res.question || (res.id ? res : null));
    if (server && server.id) Object.assign(q, normalize(server));
    updateStarButtons(q);
    if (session) renderList(session);
    toast(next ? '已加入收藏' : '已取消收藏', 'success');
  } catch (err) {
    q.starred = !next;
    updateStarButtons(q);
    toast(errorMessage(err, '收藏操作失败'), 'error');
  }
}

async function confirmAction(opts) {
  const ctx = (session && session.ctx) || {};
  if (typeof ctx.confirm === 'function') {
    try {
      return !!(await ctx.confirm(opts));
    } catch (err) {
      /* 回退 */
    }
  }
  try {
    return !!(await confirmDialog(opts));
  } catch (err) {
    return false;
  }
}

async function removeQuestion(id) {
  const q = all.find((x) => x.id === String(id));
  if (!q) return;
  const ok = await confirmAction({
    title: '删除这道错题？',
    message: `「${clip(q.text, 42)}」将从错题本中移除，练习记录与掌握指南会一并删除，且无法恢复。`,
    confirmText: '删除',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.deleteQuestion(q.id);
    all = all.filter((x) => x.id !== q.id);
    if (currentDetailId === q.id) closeDetailSilently();
    if (session) {
      renderList(session);
      syncUI(session);
    }
    toast('已删除这道错题', 'success');
    refreshShell();
  } catch (err) {
    toast(errorMessage(err, '删除失败，请稍后再试'), 'error');
  }
}

/* ------------------------------------------------------------ 列表更新 */

function updateCount(s, shown) {
  if (!s || !s.root) return;
  const el = s.root.querySelector('[data-count]');
  if (!el) return;
  const total = all.length;
  el.textContent = shown === total ? `共 ${total} 道` : `筛出 ${shown} / ${total} 道`;
  el.classList.toggle('is-filtered', shown !== total);
}

function renderList(s) {
  if (!s || s.done || !s.root) return;
  const listEl = s.root.querySelector('[data-list]');
  if (!listEl) return;
  const list = filteredList();
  updateCount(s, list.length);
  if (!all.length) {
    listEl.innerHTML = emptyAllHtml();
    return;
  }
  if (!list.length) {
    listEl.innerHTML = emptyFilteredHtml();
    return;
  }
  listEl.innerHTML = `<div class="bk-grid">${list.map((q, i) => cardHtml(q, i)).join('')}</div>`;
}

function syncUI(s) {
  if (!s || s.done || !s.root) return;
  const chips = s.root.querySelector('[data-chips]');
  if (chips) chips.innerHTML = chipsHtml();
  const active = s.root.querySelector('[data-active]');
  if (active) {
    const html = activeFiltersHtml();
    active.innerHTML = html;
    active.hidden = !html;
  }
  s.root.querySelectorAll('[data-filter]').forEach((sel) => {
    const key = sel.getAttribute('data-filter');
    if (key && key in filters) sel.value = filters[key];
    else if (key === 'starred') sel.value = filters.starred ? '1' : '';
  });
  const starBtn = s.root.querySelector('[data-toggle-star]');
  if (starBtn) {
    starBtn.classList.toggle('is-on', filters.starred);
    starBtn.setAttribute('aria-pressed', filters.starred ? 'true' : 'false');
  }
  const clearBtn = s.root.querySelector('[data-clear-search]');
  if (clearBtn) clearBtn.hidden = !filters.q;
  if (s.searchInput && s.searchInput.value !== filters.q) s.searchInput.value = filters.q;
}

function applyFilters(s) {
  if (!s || s.done) return;
  syncUI(s);
  renderList(s);
  syncHash();
}

function resetFilters() {
  filters.q = '';
  filters.subject = '';
  filters.status = '';
  filters.difficulty = '';
  filters.starred = false;
  filters.sort = 'updated';
  filters.tag = '';
  filters.errorType = '';
  if (session) {
    if (session.searchInput) session.searchInput.value = '';
    applyFilters(session);
  } else {
    syncHash();
  }
}

function clearFilterKey(key) {
  if (key === 'starred') filters.starred = false;
  else if (key === 'q') {
    filters.q = '';
    if (session && session.searchInput) session.searchInput.value = '';
  } else if (key && key in filters) filters[key] = '';
  if (session) applyFilters(session);
}

function applyTagFilter(tag) {
  filters.tag = String(tag || '');
  closeDetailSilently();
  if (!session) return;
  applyFilters(session);
  const listEl = session.root && session.root.querySelector('[data-list]');
  if (listEl && listEl.scrollIntoView) {
    try {
      listEl.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } catch (err) {
      listEl.scrollIntoView();
    }
  }
}

/* ---------------------------------------------------------- 全局事件 */

function closeAllMenus() {
  const open = document.querySelectorAll('.bk-card.is-menu-open');
  open.forEach((card) => card.classList.remove('is-menu-open'));
}

function toggleMenu(btn) {
  const card = btn.closest('.bk-card');
  if (!card) return;
  const wasOpen = card.classList.contains('is-menu-open');
  closeAllMenus();
  if (!wasOpen) card.classList.add('is-menu-open');
}

function onDocumentClick(ev) {
  const target = ev.target;
  if (!target || typeof target.closest !== 'function') return;

  if (!target.closest('.bk-card-tools')) closeAllMenus();

  const act = target.closest('[data-act]');
  if (act) {
    const qid = act.getAttribute('data-qid') || '';
    const kind = act.getAttribute('data-act');
    if (kind === 'star') {
      ev.preventDefault();
      toggleStar(qid);
      return;
    }
    if (kind === 'more') {
      ev.preventDefault();
      toggleMenu(act);
      return;
    }
    if (kind === 'edit') {
      ev.preventDefault();
      closeAllMenus();
      closeDetailSilently();
      openEdit(qid);
      return;
    }
    if (kind === 'del') {
      ev.preventDefault();
      closeAllMenus();
      removeQuestion(qid);
      return;
    }
  }

  const doEl = target.closest('[data-do]');
  if (doEl && currentDetailId) {
    ev.preventDefault();
    const action = doEl.getAttribute('data-do');
    if (action === 'practice' || action === 'weak') startPractice(currentDetailId);
    else if (action === 'edit') {
      const id = currentDetailId;
      closeDetailSilently();
      openEdit(id);
    } else if (action === 'star') toggleStar(currentDetailId);
    else if (action === 'delete') removeQuestion(currentDetailId);
    return;
  }

  const zoom = target.closest('[data-zoom]');
  if (zoom) {
    ev.preventDefault();
    openLightbox(zoom.getAttribute('data-zoom'));
    return;
  }

  const practiceBtn = target.closest('[data-practice]');
  if (practiceBtn) {
    ev.preventDefault();
    startPractice(practiceBtn.getAttribute('data-practice'));
    return;
  }

  if (target.closest('[data-reset-filters]')) {
    ev.preventDefault();
    resetFilters();
    return;
  }

  const clearFilter = target.closest('[data-clear-filter]');
  if (clearFilter) {
    ev.preventDefault();
    clearFilterKey(clearFilter.getAttribute('data-clear-filter'));
    return;
  }

  const filterTag = target.closest('[data-filter-tag]');
  if (filterTag) {
    ev.preventDefault();
    applyTagFilter(filterTag.getAttribute('data-filter-tag'));
    return;
  }

  const tagBtn = target.closest('[data-tag]');
  if (tagBtn) {
    ev.preventDefault();
    applyTagFilter(tagBtn.getAttribute('data-tag'));
    return;
  }

  const diffBtn = target.closest('#bk-e-diff [data-diff]');
  if (diffBtn) {
    ev.preventDefault();
    selectDifficulty(diffBtn);
    return;
  }

  const card = target.closest('.bk-card');
  if (card) {
    const id = card.getAttribute('data-qid');
    if (id) openDetail(id);
  }
}

function onDocumentKeydown(ev) {
  if (ev.key === 'Escape') {
    closeAllMenus();
    return;
  }
  const target = ev.target;
  if (!target || typeof target.closest !== 'function') return;
  const card = target.closest('.bk-card');
  if (!card) return;
  if (ev.key !== 'Enter' && ev.key !== ' ') return;
  // 卡片内部的按钮/链接/输入框自己处理键盘事件，不要重复打开详情
  if (target.closest('button, a, input, select, textarea, summary')) return;
  ev.preventDefault();
  const id = card.getAttribute('data-qid');
  if (id) openDetail(id);
}

/* ------------------------------------------------------------ 生命周期 */

function installGlobalOpener() {
  try {
    window.__zhicuoOpenQuestion = openQuestion;
  } catch (err) {
    /* 忽略 */
  }
}

function uninstallGlobalOpener() {
  try {
    if (window.__zhicuoOpenQuestion === openQuestion) {
      delete window.__zhicuoOpenQuestion;
    }
  } catch (err) {
    try {
      window.__zhicuoOpenQuestion = undefined;
    } catch (e2) {
      /* 忽略 */
    }
  }
}

export function openQuestion(id) {
  const key = String(id == null ? '' : id);
  if (!key) return false;
  const hit = all.find((x) => x.id === key);
  if (hit) {
    openDetail(key);
    return true;
  }
  if (session && !all.length) {
    fetchSingle(key);
    return true;
  }
  toast('没有找到这道错题，可能已被删除', 'error');
  return false;
}

async function fetchSingle(id) {
  try {
    const res = await api.question(id);
    const q = res && (res.question || res);
    if (!q || !q.id) throw new Error('没有找到这道错题');
    const item = normalize(q);
    all = [item].concat(all.filter((x) => x.id !== item.id));
    if (session) {
      renderList(session);
      syncUI(session);
      openDetail(item.id);
    }
  } catch (err) {
    toast(errorMessage(err, '打开错题失败'), 'error');
  }
}

function cleanupSession(s) {
  if (!s || s.done) return;
  s.done = true;
  if (s.onSearch && typeof s.onSearch.cancel === 'function') {
    try {
      s.onSearch.cancel();
    } catch (err) {
      /* 忽略 */
    }
  }
  if (s.docClick) document.removeEventListener('click', s.docClick);
  if (s.docKey) document.removeEventListener('keydown', s.docKey);
  try {
    closeDrawer();
  } catch (err) {
    /* 忽略 */
  }
  currentDetailId = null;
  uninstallGlobalOpener();
  if (session === s) session = null;
}

export function destroy() {
  if (session) cleanupSession(session);
  session = null;
}

async function load(s) {
  let res = null;
  try {
    res = await api.questions({});
  } catch (err) {
    if (session !== s) return;
    renderError(s, errorMessage(err, '请检查本地服务是否已启动，然后再试一次。'));
    return;
  }
  if (session !== s) return;
  const items = Array.isArray(res) ? res : res && Array.isArray(res.items) ? res.items : [];
  all = items.map(normalize);
  s.total = res && typeof res.total === 'number' ? res.total : all.length;
  s.root.innerHTML = shellHtml(s);
  bindShell(s);
  renderList(s);
  syncUI(s);
  if (s.preOpen) {
    const id = s.preOpen;
    s.preOpen = '';
    openDetail(id);
  }
}

function renderError(s, message) {
  s.root.innerHTML = `
  <div class="page bk-page">
    <div class="bk-error paper-card" role="alert">
      <div class="bk-error-icon" aria-hidden="true">${icon('alert', 24)}</div>
      <h2 class="bk-error-title">错题本没有加载出来</h2>
      <p class="bk-error-desc">${escapeHtml(message || '请检查本地服务是否已启动，然后再试一次。')}</p>
      <div class="bk-error-actions">
        <button type="button" class="btn btn-primary" data-retry>${icon('refresh', 16)}重新加载</button>
        <a class="btn btn-line" href="#/add">去录入错题</a>
      </div>
    </div>
  </div>`;
  const retry = s.root.querySelector('[data-retry]');
  if (retry) {
    retry.addEventListener('click', () => {
      if (session !== s || s.done) return;
      s.root.innerHTML = skeletonHtml();
      load(s);
    });
  }
}

function bindShell(s) {
  const root = s.root;
  s.searchInput = root.querySelector('[data-search]');
  s.onSearch = debounce(() => {
    if (!session || session !== s) return;
    filters.q = String(s.searchInput && s.searchInput.value ? s.searchInput.value : '').trim();
    applyFilters(s);
  }, 300);

  if (s.searchInput) {
    s.searchInput.addEventListener('input', s.onSearch);
    s.searchInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        if (typeof s.onSearch.cancel === 'function') s.onSearch.cancel();
        filters.q = String(s.searchInput.value || '').trim();
        applyFilters(s);
      }
    });
  }

  const clearSearch = root.querySelector('[data-clear-search]');
  if (clearSearch) {
    clearSearch.addEventListener('click', () => {
      if (s.searchInput) s.searchInput.value = '';
      filters.q = '';
      applyFilters(s);
      if (s.searchInput) s.searchInput.focus();
    });
  }

  root.querySelectorAll('[data-filter]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const key = sel.getAttribute('data-filter');
      if (!key || !(key in filters)) return;
      if (key === 'starred') filters.starred = sel.value === '1';
      else filters[key] = String(sel.value || '');
      applyFilters(s);
    });
  });

  const starToggle = root.querySelector('[data-toggle-star]');
  if (starToggle) {
    starToggle.addEventListener('click', () => {
      filters.starred = !filters.starred;
      applyFilters(s);
    });
  }

  const chips = root.querySelector('[data-chips]');
  if (chips) {
    chips.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-subject-chip]');
      if (!btn) return;
      filters.subject = btn.getAttribute('data-subject-chip') || '';
      applyFilters(s);
    });
  }
}

/* ---------------------------------------------------------------- 入口 */

export async function mount(root, ctx) {
  destroy();

  const query = parseQuery(ctx);
  initFilters(query);
  all = [];
  currentDetailId = null;

  const s = {
    root,
    ctx: ctx || {},
    run: ++runSeq,
    done: false,
    drawer: null,
    searchInput: null,
    onSearch: null,
    preOpen: String(query.open || ''),
    total: 0,
  };
  session = s;

  if (ctx && typeof ctx.onCleanup === 'function') {
    try {
      ctx.onCleanup(() => cleanupSession(s));
    } catch (err) {
      /* 忽略 */
    }
  }

  installGlobalOpener();
  s.docClick = (ev) => {
    if (session === s && !s.done) onDocumentClick(ev);
  };
  s.docKey = (ev) => {
    if (session === s && !s.done) onDocumentKeydown(ev);
  };
  document.addEventListener('click', s.docClick);
  document.addEventListener('keydown', s.docKey);

  root.innerHTML = skeletonHtml();
  await load(s);
  if (session !== s || s.done) return;
  syncHash();
}
