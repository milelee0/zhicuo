// 知错 · 智能错题本 —— 种子数据装载器
// 把 data/seed.json 里的“相对日期 / 简写字段”展开成完整的 Question 结构。
// 种子文件只保存内容与相对时间，因此任何一天首次启动都能得到合理的时间分布。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(HERE, '..');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const DB_FILE = path.join(DATA_DIR, 'db.json');
export const SEED_FILE = path.join(DATA_DIR, 'seed.json');

const DAY = 86400000;
const RESULTS = new Set(['mastered', 'fuzzy', 'failed']);

/** 错因类型（与前端、AI 提示词保持一致） */
export const ERROR_TYPE_LIST = [
  '概念不清',
  '审题失误',
  '计算失误',
  '方法不当',
  '迁移不足',
  '表达不规范',
  '其他'
];
const ERROR_TYPES = new Set(ERROR_TYPE_LIST);

/** 知识点掌握等级（由低到高） */
export const MASTERY_LEVEL_LIST = ['未掌握', '薄弱', '基本掌握', '熟练'];
const MASTERY_LEVELS = new Set(MASTERY_LEVEL_LIST);

/** 生成 q_xxx / v_xxx / a_xxx 形式的短 id */
export function makeId(prefix = 'q') {
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${time}${rand}`;
}

function s(value) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 取 now 之前 daysAgo 天的 hour:minute；若该时间点还没到（仅当天），回退到数分钟前 */
function atDaysAgo(nowMs, daysAgo, hour, minute) {
  const d = new Date(startOfDay(nowMs));
  d.setDate(d.getDate() - Math.max(0, Math.round(daysAgo)));
  d.setHours(hour, minute, 0, 0);
  let ms = d.getTime();
  if (ms > nowMs) ms = nowMs - (5 + (Math.abs(minute) % 40)) * 60000;
  return new Date(ms).toISOString();
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((x) => s(x).trim()).filter(Boolean).slice(0, 20);
  }
  if (typeof value === 'string') {
    return value
      .split(/\r?\n|[,，、;；]/)
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 20);
  }
  return [];
}

/** {point, concept, keyPoints[], pitfalls[], checklist[]} */
export function normalizeKnowledgeGuide(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      point: s(item && item.point).trim(),
      concept: s(item && item.concept).trim(),
      keyPoints: normalizeStringArray(item && item.keyPoints),
      pitfalls: normalizeStringArray(item && item.pitfalls),
      checklist: normalizeStringArray(item && item.checklist)
    }))
    .filter((item) => item.point);
}

/** {point, level, evidence, gap, microLesson} */
export function normalizeMasteryAssessment(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      point: s(item && item.point).trim(),
      level: MASTERY_LEVELS.has(item && item.level) ? item.level : '薄弱',
      evidence: s(item && item.evidence).trim(),
      gap: s(item && item.gap).trim(),
      microLesson: s(item && item.microLesson).trim()
    }))
    .filter((item) => item.point);
}

export function normalizeErrorType(value) {
  const type = s(value).trim();
  return ERROR_TYPES.has(type) ? type : '其他';
}

function normalizeSeedQuestion(item, index, nowMs) {
  if (!item || typeof item !== 'object' || !s(item.text).trim()) return null;

  const id = s(item.id).trim() || `q_${String(index + 1).padStart(3, '0')}`;
  const createdDaysAgo = clampInt(item.createdDaysAgo, 0, 21, 14);
  const createdAt = atDaysAgo(nowMs, createdDaysAgo, 19, 30 + (index % 20));

  const variants = (Array.isArray(item.variants) ? item.variants : [])
    .map((v) => ({
      id: makeId('v'),
      text: s(v && v.text).trim(),
      answer: s(v && v.answer).trim(),
      analysis: s(v && v.analysis).trim(),
      hint: s(v && v.hint).trim(),
      point: s(v && v.point).trim() || s(item && item.knowledgePoints && item.knowledgePoints[0]).trim() || ''
    }))
    .filter((v) => v.text);

  const attempts = [];
  (Array.isArray(item.attempts) ? item.attempts : []).forEach((a, ai) => {
    if (!a || typeof a !== 'object') return;
    const result = RESULTS.has(a.result) ? a.result : 'fuzzy';
    const daysAgo = clampInt(a.daysAgo, 0, 21, 3);
    let at = atDaysAgo(nowMs, daysAgo, 20, (ai * 7 + 5) % 50);
    const createdMs = new Date(createdAt).getTime();
    if (new Date(at).getTime() < createdMs) {
      at = new Date(Math.min(nowMs - 60000, createdMs + 3600000)).toISOString();
    }
    let variantId = null;
    if (Number.isInteger(a.variantIndex) && variants[a.variantIndex]) {
      variantId = variants[a.variantIndex].id;
    }
    attempts.push({ id: makeId('a'), variantId, result, at });
  });
  attempts.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  const mastery = clampInt(item.mastery, 0, 100, 20);
  let updatedAt = createdAt;
  attempts.forEach((a) => {
    if (a.at > updatedAt) updatedAt = a.at;
  });

  // 下次复习时间：支持绝对 ISO，也支持 nextReviewInDays（0 = 今天到期，负数 = 已逾期）
  let nextReviewAt = null;
  if (typeof item.nextReviewAt === 'string' && item.nextReviewAt.trim()) {
    const d = new Date(item.nextReviewAt);
    if (!Number.isNaN(d.getTime())) nextReviewAt = d.toISOString();
  }
  if (!nextReviewAt && item.nextReviewInDays !== undefined && item.nextReviewInDays !== null) {
    const offset = clampInt(item.nextReviewInDays, -30, 60, 0);
    const due = new Date(startOfDay(nowMs) + offset * DAY);
    due.setHours(8, 0, 0, 0);
    if (offset <= 0 && due.getTime() > nowMs) {
      // 0 天且当前还没到早 8 点：安排为几小时前，保证“今日到期”成立
      nextReviewAt = new Date(nowMs - (2 + (index % 4)) * 3600000).toISOString();
    } else {
      nextReviewAt = due.toISOString();
    }
  }

  const knowledgePoints = normalizeStringArray(item.knowledgePoints);

  return {
    id,
    text: s(item.text).trim(),
    answer: s(item.answer).trim(),
    analysis: s(item.analysis).trim(),
    commonMistakes: normalizeStringArray(item.commonMistakes),
    errorType: normalizeErrorType(item.errorType),
    errorReason: s(item.errorReason).trim(),
    remedy: s(item.remedy).trim(),
    knowledgeGuide: normalizeKnowledgeGuide(item.knowledgeGuide),
    knowledgePoints: knowledgePoints.length ? knowledgePoints : ['综合'],
    studentWork: s(item.studentWork).trim(),
    masteryAssessment: normalizeMasteryAssessment(item.masteryAssessment),
    targetedAdvice: s(item.targetedAdvice).trim(),
    difficulty: clampInt(item.difficulty, 1, 5, 3),
    mastery,
    subject: s(item.subject).trim() || '数学',
    grade: s(item.grade).trim() || '高一',
    source: s(item.source).trim() || '手抄错题',
    imageUrl: typeof item.imageUrl === 'string' && item.imageUrl.trim() ? item.imageUrl.trim() : null,
    starred: item.starred === true,
    notes: s(item.notes).trim(),
    variants,
    attempts,
    reviewCount: Math.max(attempts.length, clampInt(item.reviewCount, 0, 9999, attempts.length)),
    createdAt,
    updatedAt,
    nextReviewAt
  };
}

/** 读取并展开 data/seed.json；文件缺失或损坏时返回空数组，由调用方兜底。 */
export function loadSeedQuestions(nowMs = Date.now()) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  } catch (err) {
    console.warn(`[seed] 读取 ${SEED_FILE} 失败：${err.message}`);
    return [];
  }
  const list = Array.isArray(raw) ? raw : Array.isArray(raw && raw.questions) ? raw.questions : [];
  const questions = [];
  list.forEach((item, index) => {
    const q = normalizeSeedQuestion(item, index, nowMs);
    if (q) questions.push(q);
  });
  return questions;
}
