// 知错 · 掌握度
// 依赖：api.stats / api.questions；ui 的 escapeHtml / icon / ring / masteryLabel / subjectClass /
//       fmtRelative / loadingBlock。图表全部内联 SVG / CSS，无第三方库。

import { api } from '../api.js';
import {
  escapeHtml,
  icon,
  ring,
  masteryLabel,
  subjectClass,
  fmtRelative,
  loadingBlock,
} from '../ui.js';

const BUCKET_ORDER = ['未掌握', '初识', '熟练', '已掌握'];
const BUCKET_KEY_ORDER = { new: 0, low: 1, mid: 2, high: 3, learning: 2, mastered: 3 };

const RESULT_LABEL = {
  mastered: { label: '已掌握', tone: 'sage' },
  fuzzy: { label: '有点模糊', tone: 'gold' },
  failed: { label: '还是不会', tone: 'red' },
};

const ERROR_ADVICE = {
  概念不清: '回到课本定义，用一句话复述概念，再重做原题。',
  审题失误: '做题先圈关键词，把「题目要求什么」写在草稿第一行。',
  计算失误: '把计算步骤写全，每一步都回头验算一次。',
  方法不当: '对比标准解法的第一步，找出自己选错方法的信号。',
  迁移不足: '同一知识点连做 3 道变式题，建立题型识别。',
  表达不规范: '对照标准答案的书写格式，补全必要步骤与单位。',
  其他: '把这道题的错因写进笔记，一周后回看一次。',
};

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

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value) {
  return Math.round(num(value));
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

  const navigate = (hash) => {
    if (typeof ctx.navigate === 'function') ctx.navigate(hash);
    else location.hash = hash;
  };

  const S = {
    loading: true,
    error: '',
    stats: (ctx.state && ctx.state.stats) || null,
    questions: [],
  };
  if (S.stats) S.loading = false;

  // ---------- 派生数据 ----------

  function totals() {
    return (S.stats && S.stats.totals) || {};
  }

  function masteryValue() {
    return Math.max(0, Math.min(100, round(totals().avgMastery)));
  }

  function buckets() {
    const list = S.stats && Array.isArray(S.stats.masteryBuckets) ? S.stats.masteryBuckets : [];
    const order = (bucket) => {
      const key = String(bucket.key || '').toLowerCase();
      if (Object.prototype.hasOwnProperty.call(BUCKET_KEY_ORDER, key)) return BUCKET_KEY_ORDER[key];
      const label = String(bucket.label || '');
      const index = BUCKET_ORDER.findIndex((name) => label.includes(name));
      if (index >= 0) return index;
      if (label.includes('待巩固') || label.includes('薄弱')) return 1;
      if (label.includes('较熟练') || label.includes('掌握中')) return 2;
      return 4;
    };
    return list.slice().sort((a, b) => order(a) - order(b));
  }

  function bucketTone(bucket, index) {
    const label = String(bucket.label || '');
    const key = String(bucket.key || '').toLowerCase();
    if (label.includes('已掌握') || key === 'high' || key === 'mastered') return 'sage';
    if (label.includes('熟练') || key === 'mid') return 'blue';
    if (label.includes('待巩固') || label.includes('初识') || key === 'low') return 'gold';
    if (label.includes('未掌握') || key === 'new') return 'red';
    return ['red', 'gold', 'blue', 'sage'][index % 4];
  }

  function avgReviewCount() {
    if (!S.questions.length) return null;
    const sum = S.questions.reduce((acc, question) => acc + num(question.reviewCount), 0);
    return sum / S.questions.length;
  }

  function subjects() {
    const list = S.stats && Array.isArray(S.stats.subjects) ? S.stats.subjects : [];
    return list
      .slice()
      .filter((item) => item && item.subject)
      .sort((a, b) => num(b.total) - num(a.total));
  }

  function knowledge() {
    const list = S.stats && Array.isArray(S.stats.knowledge) ? S.stats.knowledge : [];
    return list
      .slice()
      .filter((item) => item && item.tag)
      .sort((a, b) => num(a.avgMastery) - num(b.avgMastery))
      .slice(0, 12);
  }

  // 从题目明细聚合逐知识点掌握评估
  function assessmentSummary() {
    const counts = { 未掌握: 0, 薄弱: 0, 基本掌握: 0, 熟练: 0 };
    const weak = new Map();
    S.questions.forEach((question) => {
      const list = Array.isArray(question.masteryAssessment) ? question.masteryAssessment : [];
      list.forEach((item) => {
        if (!item || !item.level) return;
        if (counts[item.level] !== undefined) counts[item.level] += 1;
        if ((item.level === '未掌握' || item.level === '薄弱') && item.point) {
          weak.set(item.point, (weak.get(item.point) || 0) + 1);
        }
      });
    });
    const total = Object.values(counts).reduce((acc, value) => acc + value, 0);
    return {
      counts,
      total,
      weak: [...weak.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
    };
  }

  function errorTypes() {
    const list = S.stats && Array.isArray(S.stats.errorTypes) ? S.stats.errorTypes : [];
    return list.filter((item) => item && item.type && num(item.count) > 0);
  }

  function forecast() {
    const list = S.stats && Array.isArray(S.stats.forecast) ? S.stats.forecast : [];
    return list.slice(0, 7);
  }

  function activity() {
    const list = S.stats && Array.isArray(S.stats.activity) ? S.stats.activity : [];
    return list.slice(-14);
  }

  function forecastAdvice() {
    const list = forecast();
    if (!list.length) return '';
    const total = list.reduce((acc, item) => acc + num(item.count), 0);
    const today = num(list[0].count);
    if (!total) return '未来 7 天没有到期复习，可以随机抽练保持手感。';
    let peak = list[0];
    list.forEach((item) => {
      if (num(item.count) > num(peak.count)) peak = item;
    });
    const parts = [`未来 7 天共 ${total} 题待复习`];
    if (num(peak.count)) parts.push(`${peak.date} 最集中（${num(peak.count)} 题）`);
    parts.push(today ? `今天有 ${today} 题，先清掉今日复习最省力。` : '今天没有到期复习，适合做一组随机抽练。');
    return `${parts.join('，')}`;
  }

  function masteryTone(value) {
    const level = num(value);
    if (level >= 70) return 'sage';
    if (level >= 40) return 'gold';
    return 'red';
  }

  function recentAttempts() {
    const events = [];
    S.questions.forEach((question) => {
      const list = Array.isArray(question.attempts) ? question.attempts : [];
      list.forEach((attempt) => {
        events.push({ question, attempt });
      });
    });
    events.sort((a, b) => {
      const left = new Date(a.attempt.at || 0).getTime() || 0;
      const right = new Date(b.attempt.at || 0).getTime() || 0;
      return right - left;
    });
    return events.slice(0, 8);
  }

  // ---------- 渲染块 ----------

  function pageHeadHtml() {
    return `<header class="page-head ma-head">
      <div>
        <div class="page-kicker">MASTERY · 掌握度</div>
        <h1 class="page-title">掌握度</h1>
        <p class="page-sub">不是做了多少题，而是真正收回了多少分。</p>
      </div>
      <div class="ma-range">
        <span class="ma-range-tag">${icon('clock', 14)}<span>近 14 天</span></span>
        <span class="small muted">统计口径：掌握度与复习记录</span>
      </div>
    </header>`;
  }

  function metricCard(label, value, unit, iconName) {
    return `<article class="card card-pad ma-metric">
      <span class="ma-metric-ico">${icon(iconName, 18)}</span>
      <span class="ma-metric-value mono">${escapeHtml(String(value))}${unit ? `<em>${escapeHtml(unit)}</em>` : ''}</span>
      <span class="ma-metric-label">${escapeHtml(label)}</span>
    </article>`;
  }

  function bucketRow(bucket, index, total) {
    const count = num(bucket.count);
    const percent = total ? Math.round((count / total) * 100) : 0;
    const tone = bucketTone(bucket, index);
    return `<div class="ma-bucket tone-${tone}">
      <span class="ma-bucket-top">
        <span class="ma-bucket-dot" aria-hidden="true"></span>
        <span class="ma-bucket-label">${escapeHtml(bucket.label || bucket.key || '未命名')}</span>
        <span class="ma-bucket-count mono">${count}</span>
        <span class="ma-bucket-pct small muted">${percent}%</span>
      </span>
      <span class="ma-bucket-track"><i style="width:${percent}%"></i></span>
    </div>`;
  }

  function subjectRow(item) {
    const total = num(item.total);
    const mastered = num(item.mastered);
    const avg = Math.max(0, Math.min(100, round(item.avgMastery)));
    const suffix = subjectClass(item.subject);
    return `<div class="ma-subject ma-subject-${suffix}">
      <div class="ma-subject-top">
        <span class="ma-subject-name"><i class="ma-subject-dot" aria-hidden="true"></i>${escapeHtml(item.subject)}</span>
        <span class="ma-subject-nums small muted">${mastered} / ${total} 题 · 掌握 <b class="mono">${avg}</b></span>
      </div>
      <div class="mastery-bar ma-subject-bar"><i style="width:${avg}%"></i></div>
    </div>`;
  }

  function knowledgeCard(item) {
    const avg = Math.max(0, Math.min(100, round(item.avgMastery)));
    const tone = masteryTone(avg);
    const label = masteryLabel(avg);
    return `<button type="button" class="ma-kcard tone-${tone}" data-tag="${escapeHtml(item.tag)}" aria-label="查看知识点 ${escapeHtml(item.tag)} 的错题">
      <span class="ma-kcard-top">
        <span class="ma-kcard-tag">${escapeHtml(item.tag)}</span>
        <span class="ma-kcard-num mono">${avg}</span>
      </span>
      <span class="ma-kcard-meta small muted">${num(item.total)} 题 · ${escapeHtml(label.label)}</span>
      <span class="ma-kcard-track"><i style="width:${avg}%"></i></span>
    </button>`;
  }

  function errorTypeCard() {
    const list = errorTypes();
    if (!list.length) return '';
    const total = list.reduce((acc, item) => acc + num(item.count), 0);
    const max = Math.max(1, ...list.map((item) => num(item.count)));
    const top = list[0];
    const advice = ERROR_ADVICE[top.type] || '针对高频错因做专项练习，比盲目刷题更省时间。';
    return `<section class="card card-pad ma-errors" aria-labelledby="maErrorsTitle">
      <div class="ma-section-head">
        <h2 class="ma-section-title" id="maErrorsTitle">错因分布</h2>
        <span class="small muted">共 ${total} 条</span>
      </div>
      <div class="ma-err-list">
        ${list.slice(0, 6).map((item) => {
          const count = num(item.count);
          const width = Math.round((count / max) * 100);
          const share = total ? Math.round((count / total) * 100) : 0;
          return `<div class="ma-err-row">
            <span class="ma-err-name">${escapeHtml(item.type)}</span>
            <span class="ma-err-track"><i style="width:${width}%"></i></span>
            <span class="ma-err-count mono">${count} <em>${share}%</em></span>
          </div>`;
        }).join('')}
      </div>
      <p class="ma-tip">${icon('spark', 14)} 错得最多的是「${escapeHtml(top.type)}」：${escapeHtml(advice)}</p>
    </section>`;
  }

  function assessmentCard(info) {
    const levels = ['未掌握', '薄弱', '基本掌握', '熟练'];
    const tones = { 未掌握: 'red', 薄弱: 'gold', 基本掌握: 'blue', 熟练: 'sage' };
    return `<section class="card card-pad ma-assessment" aria-labelledby="maAssessmentTitle">
      <div class="ma-section-head">
        <h2 class="ma-section-title" id="maAssessmentTitle">知识掌握评估</h2>
        <span class="small muted">${info.total} 条逐点评估</span>
      </div>
      <div class="ma-level-list">
        ${levels.map((level) => {
          const count = info.counts[level] || 0;
          const percent = info.total ? Math.round((count / info.total) * 100) : 0;
          return `<div class="ma-level-row tone-${tones[level]}">
            <span class="ma-level-name">${level}</span>
            <span class="ma-level-track"><i style="width:${percent}%"></i></span>
            <span class="ma-level-count mono">${count}</span>
          </div>`;
        }).join('')}
      </div>
      ${info.weak.length
        ? `<div class="ma-weak-block">
            <span class="label">待补薄弱点</span>
            <div class="ma-weak-chips">
              ${info.weak.map(([point, count]) => `<button type="button" class="tag tag-gold ma-weak-chip" data-tag="${escapeHtml(point)}" title="查看该知识点的错题">${escapeHtml(point)}<em>${count}</em></button>`).join('')}
            </div>
            <p class="ma-tip">${icon('target', 14)} 这些点在「举一反三」里会被优先抽到，建议先做一组薄弱攻坚。</p>
          </div>`
        : '<p class="ma-empty-line small muted">逐点评估都达到「基本掌握」以上，保持这个节奏。</p>'}
    </section>`;
  }

  function forecastChart() {
    const list = forecast();
    if (!list.length) {
      return `<p class="ma-empty-line small muted">暂无复习预测数据。</p>`;
    }
    const max = Math.max(1, ...list.map((item) => num(item.count)));
    return `<div class="ma-fcast" role="img" aria-label="未来 7 天待复习数量">
      ${list.map((item, index) => {
        const count = num(item.count);
        const height = count ? Math.max(8, Math.round((count / max) * 100)) : 2;
        return `<div class="ma-fcast-col${index === 0 ? ' is-today' : ''}">
          <span class="ma-fcast-count mono">${count || ''}</span>
          <span class="ma-fcast-track"><i style="height:${height}%"></i></span>
          <span class="ma-fcast-date">${escapeHtml(item.date || '')}</span>
          ${index === 0 ? '<span class="ma-fcast-flag">今天</span>' : '<span class="ma-fcast-flag" aria-hidden="true"></span>'}
        </div>`;
      }).join('')}
    </div>`;
  }

  function activityChart() {
    const days = activity();
    if (!days.length) return '';
    const width = 720;
    const height = 210;
    const padLeft = 30;
    const padRight = 10;
    const padTop = 14;
    const padBottom = 40;
    const innerWidth = width - padLeft - padRight;
    const innerHeight = height - padTop - padBottom;
    const max = Math.max(1, ...days.map((day) => Math.max(num(day.added), num(day.reviewed))));
    const step = innerWidth / days.length;
    const barWidth = Math.max(3, Math.min(13, step * 0.26));
    const baseline = padTop + innerHeight;
    let svg = `<svg class="ma-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="近 ${days.length} 天新增错题与复习数量对比">`;
    for (let line = 0; line <= 4; line += 1) {
      const y = baseline - (innerHeight / 4) * line;
      const value = Math.round((max / 4) * line);
      svg += `<line class="ma-grid" x1="${padLeft}" y1="${y.toFixed(1)}" x2="${width - padRight}" y2="${y.toFixed(1)}" />`;
      svg += `<text class="ma-axis" x="${padLeft - 7}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${value}</text>`;
    }
    days.forEach((day, index) => {
      const center = padLeft + step * index + step / 2;
      const added = num(day.added);
      const reviewed = num(day.reviewed);
      const addedHeight = (added / max) * innerHeight;
      const reviewedHeight = (reviewed / max) * innerHeight;
      svg += `<rect class="ma-bar-added" x="${(center - barWidth - 1).toFixed(1)}" y="${(baseline - addedHeight).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(added ? 2 : 0, addedHeight).toFixed(1)}" rx="1.5"><title>${escapeHtml(day.date || '')} 新增 ${added}</title></rect>`;
      svg += `<rect class="ma-bar-reviewed" x="${(center + 1).toFixed(1)}" y="${(baseline - reviewedHeight).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(reviewed ? 2 : 0, reviewedHeight).toFixed(1)}" rx="1.5"><title>${escapeHtml(day.date || '')} 复习 ${reviewed}</title></rect>`;
      if ((days.length - 1 - index) % 2 === 0) {
        svg += `<text class="ma-axis" x="${center.toFixed(1)}" y="${(baseline + 19).toFixed(1)}" text-anchor="middle">${escapeHtml(day.date || '')}</text>`;
      }
    });
    svg += '</svg>';
    return svg;
  }

  function timelineHtml() {
    const events = recentAttempts();
    if (!events.length) {
      return `<p class="ma-empty-line small muted">还没有练习记录，去「举一反三」做一组，这里会出现学习轨迹。</p>`;
    }
    return `<ul class="ma-timeline">
      ${events.map(({ question, attempt }) => {
        const meta = RESULT_LABEL[attempt.result] || RESULT_LABEL.fuzzy;
        return `<li class="ma-tl-row">
          <span class="ma-tl-dot tone-${meta.tone}" aria-hidden="true"></span>
          <span class="ma-tl-text">${escapeHtml(excerpt(question.text, 56))}</span>
          <span class="tag tag-${meta.tone}">${escapeHtml(meta.label)}</span>
          <span class="ma-tl-time small muted">${escapeHtml(fmtRelative(attempt.at))}</span>
        </li>`;
      }).join('')}
    </ul>`;
  }

  function activityBlock() {
    const chart = activityChart();
    if (chart) {
      return `<div class="ma-legend">
          <span class="ma-legend-item"><i class="ma-legend-dot added"></i>新增错题</span>
          <span class="ma-legend-item"><i class="ma-legend-dot reviewed"></i>复习</span>
        </div>
        <div class="ma-chart-wrap">${chart}</div>`;
    }
    return timelineHtml();
  }

  function mainHtml() {
    const totalQuestions = num(totals().questions);
    const bucketList = buckets();
    const subjectList = subjects();
    const knowledgeList = knowledge();
    const mastered = num(totals().mastered);
    const streak = num(totals().streak);
    const avgReview = avgReviewCount();
    const advice = forecastAdvice();
    const assessmentInfo = assessmentSummary();

    return `<div class="page ma-page">
      ${pageHeadHtml()}

      <div class="ma-top">
        <section class="card card-pad ma-overview" aria-labelledby="maOverviewTitle">
          <div class="ma-overview-head">
            <h2 class="ma-section-title" id="maOverviewTitle">整体掌握</h2>
            <span class="small muted">共 ${totalQuestions} 道错题</span>
          </div>
          <div class="ma-overview-body">
            <div class="ma-ring-wrap">
              ${ring(masteryValue(), 160, 10)}
              <span class="ma-ring-caption">平均掌握度</span>
            </div>
            <div class="ma-buckets">
              ${bucketList.length
                ? bucketList.map((bucket, index) => bucketRow(bucket, index, totalQuestions)).join('')
                : '<p class="ma-empty-line small muted">暂时没有掌握度分布数据。</p>'}
            </div>
          </div>
        </section>

        <div class="ma-metrics">
          ${metricCard('已掌握题数', mastered, '题', 'circle-check')}
          ${metricCard('平均复习次数', avgReview === null ? '—' : avgReview.toFixed(1), '次', 'refresh')}
          ${metricCard('连续学习天数', streak, '天', 'flame')}
        </div>
      </div>

      <div class="ma-row2">
        <section class="card card-pad ma-subjects" aria-labelledby="maSubjectsTitle">
          <div class="ma-section-head">
            <h2 class="ma-section-title" id="maSubjectsTitle">学科掌握</h2>
            <span class="small muted">按题量排序</span>
          </div>
          ${subjectList.length
            ? `<div class="ma-subject-list">${subjectList.map(subjectRow).join('')}</div>`
            : '<p class="ma-empty-line small muted">还没有学科数据。</p>'}
        </section>
        ${errorTypeCard()}
      </div>

      <div class="ma-row-k${assessmentInfo.total ? '' : ' is-single'}">
        <section class="card card-pad ma-knowledge" aria-labelledby="maKnowledgeTitle">
          <div class="ma-section-head">
            <h2 class="ma-section-title" id="maKnowledgeTitle">知识点矩阵</h2>
            <span class="small muted">掌握度由低到高 · 点击查看错题</span>
          </div>
          ${knowledgeList.length
            ? `<div class="ma-kgrid">${knowledgeList.map(knowledgeCard).join('')}</div>`
            : '<p class="ma-empty-line small muted">还没有知识点数据，录入错题时补充知识点即可。</p>'}
        </section>
        ${assessmentInfo.total ? assessmentCard(assessmentInfo) : ''}
      </div>

      <div class="ma-row2">
        <section class="card card-pad ma-forecast" aria-labelledby="maForecastTitle">
          <div class="ma-section-head">
            <h2 class="ma-section-title" id="maForecastTitle">复习预测</h2>
            <span class="small muted">未来 7 天</span>
          </div>
          ${forecastChart()}
          ${advice ? `<p class="ma-tip">${icon('spark', 14)} ${escapeHtml(advice)}</p>` : ''}
        </section>

        <section class="card card-pad ma-activity" aria-labelledby="maActivityTitle">
          <div class="ma-section-head">
            <h2 class="ma-section-title" id="maActivityTitle">学习轨迹</h2>
            <span class="small muted">近 14 天</span>
          </div>
          ${activityBlock()}
        </section>
      </div>
    </div>`;
  }

  function loadingHtml() {
    return `<div class="page ma-page">
      ${pageHeadHtml()}
      <div class="ma-skel-grid">
        <div class="ma-skel-card card card-pad ma-skel-lg"></div>
        <div class="ma-skel-col">
          <div class="ma-skel-card card card-pad ma-skel-sm"></div>
          <div class="ma-skel-card card card-pad ma-skel-sm"></div>
          <div class="ma-skel-card card card-pad ma-skel-sm"></div>
        </div>
      </div>
      <div class="card card-pad">${loadingBlock('正在计算掌握度…')}</div>
    </div>`;
  }

  function errorHtml() {
    return `<div class="page ma-page">
      ${pageHeadHtml()}
      <div class="card card-pad ma-error">
        <div class="ma-error-ico">${icon('alert', 28)}</div>
        <h2 class="ma-error-title">掌握度加载失败</h2>
        <p class="ma-error-desc">${escapeHtml(S.error || '请检查网络或服务状态后重试。')}</p>
        <div class="ma-error-actions">
          <button type="button" class="btn btn-primary" data-act="retry">${icon('refresh', 16)}<span>重新加载</span></button>
          <button type="button" class="btn btn-line" data-act="go-dashboard">返回总览</button>
        </div>
      </div>
    </div>`;
  }

  function emptyHtml() {
    return `<div class="page ma-page">
      ${pageHeadHtml()}
      <div class="card card-pad ma-error">
        <div class="ma-error-ico">${icon('mastery', 28)}</div>
        <h2 class="ma-error-title">还没有可以统计的错题</h2>
        <p class="ma-error-desc">先录入几道错题并完成自评，掌握度分布、知识点矩阵和复习预测就会自动生成。</p>
        <div class="ma-error-actions">
          <button type="button" class="btn btn-primary" data-act="go-add">${icon('plus', 16)}<span>录入错题</span></button>
          <button type="button" class="btn btn-line" data-act="go-practice">去练习</button>
        </div>
      </div>
    </div>`;
  }

  function render() {
    if (disposed) return;
    if (S.loading) root.innerHTML = loadingHtml();
    else if (S.error) root.innerHTML = errorHtml();
    else if (!num(totals().questions)) root.innerHTML = emptyHtml();
    else root.innerHTML = mainHtml();
  }

  // ---------- 加载 ----------

  async function load() {
    if (!S.stats) {
      S.loading = true;
      render();
    }
    S.error = '';
    try {
      const stats = await api.stats();
      if (disposed) return;
      S.stats = stats && typeof stats === 'object' ? stats : {};
      S.loading = false;
      render();
      try {
        const res = await api.questions({ limit: 200 });
        if (disposed) return;
        S.questions = res && Array.isArray(res.items) ? res.items : [];
        render();
      } catch (error) {
        /* 题目明细只影响平均复习次数与时间线，失败时保持已有统计 */
        if (!disposed) render();
      }
    } catch (error) {
      if (disposed) return;
      S.loading = false;
      S.error = errText(error);
      render();
    }
  }

  // ---------- 事件与生命周期 ----------

  const onClick = (event) => {
    if (disposed) return;
    const node = event.target && event.target.closest ? event.target.closest('[data-act],[data-tag]') : null;
    if (!node || !root.contains(node)) return;
    if (node.dataset.tag) {
      navigate(`#/book?tag=${encodeURIComponent(node.dataset.tag)}`);
      return;
    }
    switch (node.dataset.act) {
      case 'retry':
        load();
        break;
      case 'go-add':
        navigate('#/add');
        break;
      case 'go-book':
        navigate('#/book');
        break;
      case 'go-practice':
        navigate('#/practice');
        break;
      case 'go-dashboard':
        navigate('#/dashboard');
        break;
      default:
        break;
    }
  };

  function startView() {
    root.addEventListener('click', onClick);
    addCleanup(() => root.removeEventListener('click', onClick));
    S.loading = !S.stats;
    render();
    load();
  }

  function destroyView() {
    if (cleanupRan) return;
    cleanupRan = true;
    disposed = true;
    cleanups.forEach((fn) => fn());
    cleanups.length = 0;
  }

  return { start: startView, destroy: destroyView };
}
