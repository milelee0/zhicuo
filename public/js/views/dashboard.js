/* ==========================================================================
   知错 · 智能错题本 —— 总览 Dashboard
   纸感编辑风：暖米纸面 + 深墨 + 朱砂批注 + 鼠尾草掌握色
   依赖：../api.js、../ui.js（见 BUILD_CONTRACT.md 第 5 节）
   ========================================================================== */

import { api } from '../api.js';
import {
  escapeHtml,
  icon,
  fmtRelative,
  masteryLabel,
  difficultyLabel,
  subjectClass,
  ring,
} from '../ui.js';

/* ---------------------------------------------------------------- 常量 */

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
const BUCKET_COLORS = ['#C94B36', '#C79A4B', '#3E5C76', '#4E7C6A'];
const WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const TONE_BY_ERROR = {
  概念不清: 'red',
  审题失误: 'gold',
  计算失误: 'blue',
  方法不当: 'sage',
  迁移不足: 'olive',
  表达不规范: 'slate',
  其他: 'muted',
};

/* -------------------------------------------------------------- 运行时 */

let session = null;
let runSeq = 0;

/* ------------------------------------------------------------ 小工具 */

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

function nowParts() {
  const d = new Date();
  return {
    y: d.getFullYear(),
    m: pad2(d.getMonth() + 1),
    d: pad2(d.getDate()),
    wd: WEEK_CN[d.getDay()] || '',
  };
}

function todayMD() {
  const p = nowParts();
  return `${p.m}-${p.d}`;
}

function totals(stats) {
  return (stats && stats.totals) || {};
}

function subjectColor(subject) {
  return SUBJECT_COLORS[String(subject || '').trim()] || SUBJECT_FALLBACK;
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

function errorTone(type) {
  return TONE_BY_ERROR[String(type || '')] || 'muted';
}

function diffLabel(n) {
  try {
    return String(difficultyLabel(n) || '');
  } catch (err) {
    return '';
  }
}

function relTime(iso) {
  try {
    return String(fmtRelative(iso) || '—');
  } catch (err) {
    return '—';
  }
}

function clip(text, max) {
  const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function safeClassSuffix(subject) {
  try {
    const cls = subjectClass(subject);
    return cls ? String(cls).replace(/[^a-zA-Z0-9-]/g, '') : '';
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

function masteryBar(value, extraClass) {
  const pct = clampPct(value);
  const cls = extraClass ? ` ${extraClass}` : '';
  return `<span class="mastery-bar db-mbar db-tone-${masteryTone(value)}${cls}"><i style="width:${pct}%"></i></span>`;
}

/* --------------------------------------------------------- 数据抽取 */

function activityToday(stats) {
  const arr = Array.isArray(stats && stats.activity) ? stats.activity : [];
  if (!arr.length) return null;
  const md = todayMD();
  const hit = arr.find((a) => a && String(a.date) === md);
  return hit ? Math.max(0, num(hit.reviewed)) : 0;
}

function heroNumbers(stats) {
  const t = totals(stats);
  const due = Math.max(0, num(t.due));
  const weeklyReviews = Math.max(0, num(t.weeklyReviews));
  const weeklyAdded = Math.max(0, num(t.weeklyAdded));
  const actToday = activityToday(stats);
  const reviewedToday = actToday === null ? Math.round(weeklyReviews / 7) : actToday;
  const minutes = due > 0 ? Math.max(3, Math.ceil(due * 2.5)) : 0;
  return { due, weeklyReviews, weeklyAdded, reviewedToday, minutes };
}

function encourage(due) {
  if (due === 0) return '今天没有到期的错题。翻翻旧页，或练几道新题，都算加分项。';
  if (due <= 5) return '不多，趁热一口气清掉，晚上就能安心。';
  if (due <= 12) return '一小叠卷子等着翻。稳着来，先做五道。';
  return '别硬扛，先做前五道，剩下的交给这周。';
}

/* ------------------------------------------------------------- 骨架屏 */

function skeletonHtml() {
  const metric = '<div class="db-skel db-skel-metric"></div>';
  return `
  <div class="page db-page db-loading" aria-busy="true" aria-live="polite">
    <div class="db-head">
      <div class="db-head-main">
        <div class="db-skel db-skel-kicker"></div>
        <div class="db-skel db-skel-title"></div>
        <div class="db-skel db-skel-sub"></div>
      </div>
      <div class="db-skel db-skel-date"></div>
    </div>
    <div class="db-hero db-skel-hero">
      <div class="db-skel db-skel-hero-a"></div>
      <div class="db-skel db-skel-hero-b"></div>
    </div>
    <div class="db-metrics">${metric}${metric}${metric}${metric}</div>
    <div class="db-grid db-skel-grid">
      <div class="db-skel db-skel-chart"></div>
      <div class="db-skel db-skel-side"></div>
    </div>
    <span class="db-sr-only">正在加载总览数据…</span>
  </div>`;
}

/* --------------------------------------------------------- 页头 / Hero */

function headHtml(stats) {
  const t = totals(stats);
  const p = nowParts();
  const streak = Math.max(0, num(t.streak));
  return `
  <header class="db-head">
    <div class="db-head-main">
      <div class="db-kicker"><span class="db-kicker-rule" aria-hidden="true"></span>WORKDESK / 总览</div>
      <h1 class="db-title">把错题，<span class="db-hl">变成得分点。</span></h1>
      <p class="db-sub">今天该翻哪几页，已经替你标好了。</p>
    </div>
    <div class="db-head-side">
      <div class="db-date">
        <span class="db-date-num mono">${p.y} / ${p.m} / ${p.d}</span>
        <span class="db-date-day">${escapeHtml(p.wd)} · 在册 ${num(t.questions)} 道错题</span>
      </div>
      <div class="db-streak${streak > 0 ? ' is-on' : ''}" title="连续学习天数">
        <span class="db-streak-flame" aria-hidden="true">${icon('flame', 19)}</span>
        <span class="db-streak-num mono">${streak}</span>
        <span class="db-streak-unit">天<br><em>连续</em></span>
      </div>
    </div>
  </header>`;
}

function heroHtml(stats) {
  const t = totals(stats);
  const { due, weeklyReviews, weeklyAdded, reviewedToday, minutes } = heroNumbers(stats);
  const avg = clampPct(t.avgMastery);
  const dueCta = due > 0 ? '#/practice?start=due' : '#/practice?start=random';
  const dueCtaLabel = due > 0 ? '开始今日复习' : '随机练 8 道';

  const buckets = (Array.isArray(stats.masteryBuckets) ? stats.masteryBuckets : []).filter(Boolean);
  const bucketTotal = buckets.reduce((acc, b) => acc + Math.max(0, num(b.count)), 0);
  const bucketBar = buckets.length
    ? buckets
        .map((b, i) => {
          const c = Math.max(0, num(b.count));
          const w = bucketTotal > 0 ? Math.max(c > 0 ? 4 : 0, Math.round((c / bucketTotal) * 100)) : 0;
          const color = BUCKET_COLORS[i % BUCKET_COLORS.length];
          return `<span class="db-bucket" style="width:${w}%;background:${color}" title="${escapeHtml(
            `${String(b.label || '')} ${c} 道`
          )}"></span>`;
        })
        .join('')
    : '';
  const legend = buckets.length
    ? buckets
        .map((b, i) => {
          const color = BUCKET_COLORS[i % BUCKET_COLORS.length];
          return `<span class="db-legend-item"><i class="db-swatch" style="background:${color}"></i><span class="db-legend-label">${escapeHtml(
            String(b.label || '—')
          )}</span><b class="mono">${Math.max(0, num(b.count))}</b></span>`;
        })
        .join('')
    : '<span class="db-legend-empty small muted">暂无分布数据</span>';

  const note =
    weeklyReviews > 0 || weeklyAdded > 0
      ? `近 7 日复习 ${weeklyReviews} 次，新增 ${weeklyAdded} 道。保持节奏，掌握度会自己往上走。`
      : '本周还没有复习记录。从今天开始，把节奏立起来。';

  return `
  <section class="db-hero">
    <div class="db-hero-main paper-card">
      <span class="db-tape db-tape-a" aria-hidden="true"></span>
      <span class="db-tape db-tape-b" aria-hidden="true"></span>
      <div class="db-hero-kicker mono">TODAY / 今日复习</div>
      <div class="db-hero-figure">
        <span class="db-due">${due}</span>
        <span class="db-due-unit">道<br><em>待复习</em></span>
      </div>
      <p class="db-hero-line">${escapeHtml(encourage(due))}</p>
      <div class="db-hero-meta">
        <span class="db-hero-meta-item">${icon('check', 14)}<span>今日已复习 <b class="mono">${reviewedToday}</b> 道</span></span>
        <span class="db-hero-meta-item">${icon('clock', 14)}<span>${
          minutes > 0 ? `预计 <b class="mono">${minutes}</b> 分钟` : '无需排队'
        }</span></span>
      </div>
      <div class="db-hero-actions">
        <a class="btn btn-primary db-hero-cta" href="${dueCta}">${icon('practice', 17)}<span>${escapeHtml(
          dueCtaLabel
        )}</span>${icon('arrow-right', 16)}</a>
        <a class="btn btn-line" href="#/book?status=due">看这批错题</a>
      </div>
      <div class="db-hero-foot">
        <span class="mono">近 7 日 ${weeklyReviews} 次复习</span>
        <span class="db-hero-foot-sep" aria-hidden="true">·</span>
        <span>掌握度靠累积，不必一次到位</span>
      </div>
    </div>

    <div class="db-mastery paper-card">
      <div class="db-mastery-head">
        <span class="db-eyebrow mono">MASTERY / 总掌握度</span>
      </div>
      <div class="db-mastery-body">
        <div class="db-ring">${ring(avg, 96, 8)}</div>
        <div class="db-mastery-figure">
          <span class="db-avg mono">${avg}<i>%</i></span>
          <span class="db-avg-label">${escapeHtml(masteryText(avg))}</span>
        </div>
      </div>
      <div class="db-buckets" role="img" aria-label="掌握度四档分布">${bucketBar}</div>
      <div class="db-bucket-legend">${legend}</div>
      <p class="db-mastery-note">${escapeHtml(note)}</p>
    </div>
  </section>`;
}

/* ------------------------------------------------------------- 指标条 */

function metricsHtml(stats) {
  const t = totals(stats);
  const qTotal = Math.max(0, num(t.questions));
  const mastered = Math.max(0, num(t.mastered));
  const avg = clampPct(t.avgMastery);
  const due = Math.max(0, num(t.due));
  const fresh = Math.max(0, num(t.new));
  const learning = Math.max(0, num(t.learning));
  const masteredPct = qTotal > 0 ? Math.round((mastered / qTotal) * 100) : 0;

  const items = [
    { k: '错题总数', v: String(qTotal), s: `新录入 ${fresh} 道`, tone: 'ink' },
    { k: '待复习', v: String(due), s: due > 0 ? '今日到期' : '已清空', tone: 'red' },
    {
      k: '已掌握',
      v: String(mastered),
      s: qTotal > 0 ? `占全部 ${masteredPct}%` : '还没有掌握记录',
      tone: 'sage',
    },
    { k: '平均掌握度', v: String(avg), unit: '%', s: `待巩固 ${learning} 道`, tone: 'blue' },
  ];

  return `<section class="db-metrics" aria-label="关键指标">${items
    .map(
      (m) => `
    <div class="db-metric db-metric-${m.tone}">
      <span class="db-metric-k">${escapeHtml(m.k)}</span>
      <span class="db-metric-v mono">${escapeHtml(m.v)}${
        m.unit ? `<i class="db-metric-unit">${escapeHtml(m.unit)}</i>` : ''
      }</span>
      <span class="db-metric-s">${escapeHtml(m.s)}</span>
    </div>`
    )
    .join('')}</section>`;
}

/* ------------------------------------------------------------- 学习节奏 */

function chartHtml(stats) {
  const arr = (Array.isArray(stats.activity) ? stats.activity : []).filter(Boolean).slice(-14);
  const body = arr.length
    ? (() => {
        let max = 1;
        arr.forEach((a) => {
          max = Math.max(max, Math.max(0, num(a.added)), Math.max(0, num(a.reviewed)));
        });
        const md = todayMD();
        const bars = arr
          .map((a) => {
            const added = Math.max(0, num(a.added));
            const reviewed = Math.max(0, num(a.reviewed));
            const hA = added ? Math.max(8, Math.round((added / max) * 100)) : 0;
            const hR = reviewed ? Math.max(8, Math.round((reviewed / max) * 100)) : 0;
            const isToday = String(a.date) === md;
            return `<div class="db-day${isToday ? ' is-today' : ''}" title="${escapeHtml(
              `${String(a.date || '')} · 新增 ${added} · 复习 ${reviewed}`
            )}">
              <div class="db-day-bars">
                <i class="db-bar db-bar-add${hA ? '' : ' is-zero'}"${hA ? ` style="height:${hA}%"` : ''}></i>
                <i class="db-bar db-bar-rev${hR ? '' : ' is-zero'}"${hR ? ` style="height:${hR}%"` : ''}></i>
              </div>
            </div>`;
          })
          .join('');
        const labels = arr
          .map((a, i) => {
            const isToday = String(a.date) === md;
            const show = i % 2 === 0 || i === arr.length - 1;
            const txt = String(a.date || '').slice(3);
            return `<span class="db-x${isToday ? ' is-today' : ''}">${show ? escapeHtml(txt) : '&nbsp;'}</span>`;
          })
          .join('');
        const sumAdded = arr.reduce((acc, a) => acc + Math.max(0, num(a.added)), 0);
        const sumReviewed = arr.reduce((acc, a) => acc + Math.max(0, num(a.reviewed)), 0);
        return `
        <div class="db-chart" role="img" aria-label="近两周每日新增与复习错题数柱状图，最高 ${max} 道">
          <div class="db-chart-axis"><span class="mono">${max}</span><span class="mono">0</span></div>
          <div class="db-chart-main">
            <div class="db-chart-bars">${bars}</div>
            <div class="db-chart-x">${labels}</div>
          </div>
        </div>
        <div class="db-chart-foot small muted">近 14 天新增 <b class="mono">${sumAdded}</b> 道 · 复习 <b class="mono">${sumReviewed}</b> 次</div>`;
      })()
    : '<div class="db-mini-empty">还没有学习记录，今天做一道就是第一格。</div>';

  return `
  <section class="card card-pad db-card db-card-chart" aria-label="近两周学习节奏">
    <div class="db-card-head">
      <div>
        <h2 class="db-card-title">近两周学习节奏</h2>
        <p class="db-card-sub small muted">每天新增与复习的错题数量</p>
      </div>
      <div class="db-legend">
        <span class="db-legend-item"><i class="db-swatch db-swatch-add"></i>新增</span>
        <span class="db-legend-item"><i class="db-swatch db-swatch-rev"></i>复习</span>
      </div>
    </div>
    ${body}
  </section>`;
}

/* ----------------------------------------------------------- 薄弱知识点 */

function weakHtml(stats) {
  const rows = (Array.isArray(stats.knowledge) ? stats.knowledge : [])
    .filter((k) => k && k.tag)
    .slice()
    .sort(
      (a, b) =>
        num(a.avgMastery) - num(b.avgMastery) || num(b.total) - num(a.total)
    )
    .slice(0, 5);

  const body = rows.length
    ? rows
        .map((k, i) => {
          const pct = clampPct(k.avgMastery);
          const total = Math.max(0, num(k.total));
          const tone = masteryTone(k.avgMastery);
          const color = subjectColor(k.subject);
          const href = `#/book?tag=${encodeURIComponent(String(k.tag))}`;
          return `
        <a class="db-weak-row" href="${escapeHtml(href)}" title="查看「${escapeHtml(String(k.tag))}」相关错题">
          <span class="db-weak-rank mono">${pad2(i + 1)}</span>
          <span class="db-weak-main">
            <span class="db-weak-top">
              <i class="db-weak-dot" style="background:${color}" aria-hidden="true"></i>
              <span class="db-weak-name">${escapeHtml(String(k.tag))}</span>
              <span class="db-weak-count mono">${total} 题</span>
            </span>
            ${masteryBar(k.avgMastery, 'db-mbar-sm')}
          </span>
          <span class="db-weak-num mono">${pct}%</span>
        </a>`;
        })
        .join('')
    : '<div class="db-mini-empty">还没有知识点数据。录入错题后，这里会告诉你哪里最该补。</div>';

  return `
  <section class="card card-pad db-card db-card-weak" aria-label="薄弱知识点">
    <div class="db-card-head">
      <div>
        <h2 class="db-card-title">薄弱知识点</h2>
        <p class="db-card-sub small muted">掌握度最低的五个考点</p>
      </div>
      <a class="db-card-link small" href="#/mastery">掌握度全景 ${icon('arrow-right', 13)}</a>
    </div>
    <div class="db-weak-list">${body}</div>
  </section>`;
}

/* ------------------------------------------------------------- 错因分布 */

function errorsHtml(stats) {
  const all = (Array.isArray(stats.errorTypes) ? stats.errorTypes : []).filter((e) => e && e.type);
  const total = all.reduce((acc, e) => acc + Math.max(0, num(e.count)), 0);
  const rows = all.slice(0, 7);
  const body = rows.length
    ? rows
        .map((e) => {
          const count = Math.max(0, num(e.count));
          const w = total > 0 ? Math.max(5, Math.round((count / total) * 100)) : 0;
          const tone = errorTone(e.type);
          const href = `#/book?errorType=${encodeURIComponent(String(e.type))}`;
          return `
        <a class="db-errow" href="${escapeHtml(href)}" title="筛出「${escapeHtml(String(e.type))}」的错题">
          <span class="db-errow-top">
            <span class="db-errow-name">${escapeHtml(String(e.type))}</span>
            <span class="db-errow-count mono">${count}</span>
          </span>
          <span class="db-errow-track"><i class="db-tone-${tone}" style="width:${w}%"></i></span>
        </a>`;
        })
        .join('')
    : '<div class="db-mini-empty">还没有错因数据。录入或分析错题后，这里会显示你最容易栽在哪。</div>';

  return `
  <section class="card card-pad db-card db-card-errors" aria-label="错因分布">
    <div class="db-card-head">
      <div>
        <h2 class="db-card-title">错因分布</h2>
        <p class="db-card-sub small muted">同类错误出现得越多，越值得先修</p>
      </div>
      <span class="db-card-stamp mono" aria-hidden="true">${total} 次</span>
    </div>
    <div class="db-errow-list">${body}</div>
  </section>`;
}

/* ------------------------------------------------------------- 最近录入 */

function recentHtml(stats) {
  const recent = (Array.isArray(stats.recent) ? stats.recent : []).filter(Boolean).slice(0, 5);
  const body = recent.length
    ? recent
        .map((q) => {
          const color = subjectColor(q.subject);
          const pct = clampPct(q.mastery);
          const text = clip(q.text, 46);
          const suffix = safeClassSuffix(q.subject);
          return `
        <button type="button" class="db-recent-row" data-open-q="${escapeHtml(String(q.id || ''))}" title="查看这道错题">
          <span class="db-recent-subj${suffix ? ` ${suffix}` : ''}" style="--subj:${color}">${escapeHtml(
            String(q.subject || '未分类')
          )}</span>
          <span class="db-recent-text">${escapeHtml(text || '（无题干）')}</span>
          <span class="db-recent-error">${
            q.errorType ? escapeHtml(String(q.errorType)) : ''
          }</span>
          <span class="db-recent-diff" title="难度 ${escapeHtml(diffLabel(q.difficulty))}">${diffDots(
            q.difficulty
          )}</span>
          <span class="db-recent-mastery">
            ${masteryBar(q.mastery, 'db-mbar-xs')}
            <b class="mono">${pct}</b>
          </span>
          <span class="db-recent-time" data-rel="${escapeHtml(String(q.updatedAt || ''))}">${escapeHtml(
            relTime(q.updatedAt)
          )}</span>
        </button>`;
        })
        .join('')
    : '<div class="db-mini-empty">还没有录入记录。<a href="#/add">录入第一道错题</a>，这里就会长出第一行。</div>';

  return `
  <section class="card card-pad db-card db-card-recent" aria-label="最近录入">
    <div class="db-card-head">
      <div>
        <h2 class="db-card-title">最近录入</h2>
        <p class="db-card-sub small muted">刚进本子的五道错题</p>
      </div>
      <a class="db-card-link small" href="#/book">全部错题 ${icon('arrow-right', 13)}</a>
    </div>
    <div class="db-recent-list">${body}</div>
  </section>`;
}

/* ------------------------------------------------------------- 本周速览 */

function weekHtml(stats) {
  const t = totals(stats);
  const added = Math.max(0, num(t.weeklyAdded));
  const reviews = Math.max(0, num(t.weeklyReviews));
  const mastered = Math.max(0, num(t.mastered));
  const forecast = (Array.isArray(stats.forecast) ? stats.forecast : []).filter(Boolean).slice(0, 7);
  const maxF = forecast.reduce((acc, f) => Math.max(acc, Math.max(0, num(f.count))), 0) || 1;
  const forecastBars = forecast.length
    ? forecast
        .map((f) => {
          const c = Math.max(0, num(f.count));
          const h = c ? Math.max(12, Math.round((c / maxF) * 100)) : 6;
          return `<span class="db-fbar${c ? '' : ' is-zero'}" style="height:${h}%" title="${escapeHtml(
            `${String(f.date || '')} 预计 ${c} 道`
          )}"></span>`;
        })
        .join('')
    : '<span class="small muted">暂无预测</span>';

  const totalForecast = forecast.reduce((acc, f) => acc + Math.max(0, num(f.count)), 0);

  return `
  <section class="card card-pad db-card db-card-week" aria-label="本周速览">
    <div class="db-week-stats">
      <div class="db-week-stat">
        <span class="db-week-k">本周新增</span>
        <b class="db-week-v mono">${added}</b>
        <span class="db-week-s small muted">道</span>
      </div>
      <div class="db-week-stat">
        <span class="db-week-k">本周复习</span>
        <b class="db-week-v mono">${reviews}</b>
        <span class="db-week-s small muted">次</span>
      </div>
      <div class="db-week-stat">
        <span class="db-week-k">累计掌握</span>
        <b class="db-week-v mono">${mastered}</b>
        <span class="db-week-s small muted">道</span>
      </div>
      <div class="db-week-forecast">
        <div class="db-week-forecast-head">
          <span class="db-week-k">未来 7 天复习预测</span>
          <span class="small muted">共 <b class="mono">${totalForecast}</b> 道</span>
        </div>
        <div class="db-fbars" role="img" aria-label="未来七天每天预计复习数量">${forecastBars}</div>
      </div>
    </div>
  </section>`;
}

/* --------------------------------------------------------------- 空状态 */

function emptyHtml() {
  return `
  <section class="db-empty paper-card">
    <span class="db-tape db-tape-a" aria-hidden="true"></span>
    <div class="db-empty-mark" aria-hidden="true">${icon('book', 30)}</div>
    <h2 class="db-empty-title">本子还是空的。</h2>
    <p class="db-empty-desc">录入第一道错题，知错会替你拆解错因、给出掌握指南，并在合适的时候提醒你回来复习。</p>
    <a class="btn btn-primary db-empty-cta" href="#/add">${icon('plus', 16)}录入第一道错题</a>
    <div class="db-empty-hint small muted">支持拍照、粘贴文字或手动录入</div>
  </section>`;
}

/* ----------------------------------------------------------- 错误 / 绑定 */

function errorHtml(message) {
  return `
  <div class="page db-page">
    <div class="db-error paper-card" role="alert">
      <div class="db-error-icon" aria-hidden="true">${icon('alert', 24)}</div>
      <h2 class="db-error-title">总览数据没有加载出来</h2>
      <p class="db-error-desc">${escapeHtml(message || '请检查本地服务是否已启动，然后再试一次。')}</p>
      <div class="db-error-actions">
        <button type="button" class="btn btn-primary" data-retry>${icon('refresh', 16)}重新加载</button>
        <a class="btn btn-line" href="#/book">先去错题本</a>
      </div>
    </div>
  </div>`;
}

function bind(s) {
  if (!s || !s.root) return;
  s.root.querySelectorAll('[data-open-q]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-open-q');
      if (id) openQuestionById(s, id);
    });
  });
}

function openQuestionById(s, id) {
  const ctx = (s && s.ctx) || {};
  if (typeof ctx.openQuestion === 'function') {
    try {
      ctx.openQuestion(id);
      return;
    } catch (err) {
      /* 回退到路由 */
    }
  }
  const hash = `#/book?open=${encodeURIComponent(id)}`;
  if (typeof ctx.navigate === 'function') {
    try {
      ctx.navigate(hash);
      return;
    } catch (err) {
      /* 回退到 location */
    }
  }
  window.location.hash = hash;
}

/* --------------------------------------------------------------- 渲染 */

function render(s) {
  const stats = s.stats || {};
  const t = totals(stats);
  const isEmpty = num(t.questions) === 0;
  let html = `<div class="page db-page">${headHtml(stats)}`;
  if (isEmpty) {
    html += emptyHtml();
  } else {
    html += heroHtml(stats);
    html += metricsHtml(stats);
    html += `<div class="db-grid">${chartHtml(stats)}${weakHtml(stats)}${recentHtml(
      stats
    )}${errorsHtml(stats)}</div>`;
    html += weekHtml(stats);
  }
  html += '</div>';
  s.root.innerHTML = html;
  bind(s);
}

function renderError(s, message) {
  s.root.innerHTML = errorHtml(message);
  const retry = s.root.querySelector('[data-retry]');
  if (retry) {
    retry.addEventListener('click', () => {
      if (session !== s) return;
      s.root.innerHTML = skeletonHtml();
      load(s);
    });
  }
}

async function load(s) {
  let stats = null;
  try {
    stats = await api.stats();
  } catch (err) {
    if (session !== s) return;
    const msg =
      (err && (err.message || err.error)) || '请检查本地服务是否已启动，然后再试一次。';
    renderError(s, String(msg));
    return;
  }
  if (session !== s) return;
  s.stats = stats || {};
  render(s);
}

/* --------------------------------------------------------------- 生命周期 */

function refreshRelatives() {
  if (!session || !session.root) return;
  session.root.querySelectorAll('[data-rel]').forEach((el) => {
    const iso = el.getAttribute('data-rel');
    if (!iso) return;
    const next = relTime(iso);
    if (next && el.textContent !== next) el.textContent = next;
  });
}

function cleanupSession(s) {
  if (!s || s.done) return;
  s.done = true;
  if (s.timer) {
    clearInterval(s.timer);
    s.timer = null;
  }
  if (session === s) session = null;
}

export function destroy() {
  if (session) cleanupSession(session);
  session = null;
}

export async function mount(root, ctx) {
  destroy();
  const s = { root, ctx: ctx || {}, timer: null, done: false, stats: null, run: ++runSeq };
  session = s;

  if (ctx && typeof ctx.onCleanup === 'function') {
    try {
      ctx.onCleanup(() => cleanupSession(s));
    } catch (err) {
      /* 忽略：app.js 未实现也不会影响渲染 */
    }
  }

  root.innerHTML = skeletonHtml();
  await load(s);

  if (session !== s || s.done) return;
  s.timer = setInterval(refreshRelatives, 60000);
  if (ctx && typeof ctx.onCleanup === 'function') {
    /* 定时器已在 cleanupSession 中清理，这里只需保证再次注册无害 */
  }
}
