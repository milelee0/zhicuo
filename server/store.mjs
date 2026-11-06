// 知错 · 智能错题本 —— JSON 持久化、统计与掌握度算法
// 零依赖：只使用 Node 内置模块。所有写操作先改内存，再用「临时文件 + rename」原子落盘。
import fs from 'node:fs';
import path from 'node:path';
import { AppError } from './shared.mjs';
import {
  DATA_DIR,
  DB_FILE,
  UPLOAD_DIR,
  ERROR_TYPE_LIST,
  loadSeedQuestions,
  makeId,
  normalizeErrorType,
  normalizeKnowledgeGuide,
  normalizeMasteryAssessment
} from './seed.mjs';

export { AppError };
export {
  DATA_DIR,
  DB_FILE,
  UPLOAD_DIR,
  makeId,
  normalizeErrorType,
  normalizeKnowledgeGuide,
  normalizeMasteryAssessment
};
export { ERROR_TYPE_LIST, MASTERY_LEVEL_LIST } from './seed.mjs';

export const SUBJECTS = ['数学', '物理', '化学', '英语', '语文', '生物', '历史', '地理', '政治'];
export const GRADES = ['高一', '高二', '高三'];
export const DIFFICULTIES = [1, 2, 3, 4, 5];
export const VALID_RESULTS = ['mastered', 'fuzzy', 'failed'];
export const VALID_STATUS = ['new', 'learning', 'mastered'];

export const DEFAULT_SETTINGS = {
  name: '同学',
  ai: {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    visionModel: '',
    apiKey: ''
  }
};

const DAY = 86400000;
const RESULT_DELTA = { mastered: 16, fuzzy: 4, failed: -8 };
const STATUS_SET = new Set(VALID_STATUS);
const RESULT_SET = new Set(VALID_RESULTS);

let state = null;

// ---------------------------------------------------------------- 基础工具

function s(value) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function isoOr(value, fallback) {
  if (typeof value === 'string' && value.trim()) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return fallback;
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

function normalizeSubject(value) {
  const subject = s(value).trim();
  return subject || '数学';
}

function normalizeGrade(value) {
  const grade = s(value).trim();
  return GRADES.includes(grade) ? grade : grade || '高一';
}

export function normalizeVariants(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((v) => ({
      id: typeof (v && v.id) === 'string' && v.id ? v.id : makeId('v'),
      text: s(v && v.text).trim(),
      answer: s(v && v.answer).trim(),
      analysis: s(v && v.analysis).trim(),
      hint: s(v && v.hint).trim(),
      point: s(v && v.point).trim()
    }))
    .filter((v) => v.text)
    .slice(0, 20);
}

function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function localDateKey(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function shortDate(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dayStartOffset(ms, offsetDays) {
  const d = new Date(startOfDay(ms));
  d.setDate(d.getDate() + offsetDays);
  return d.getTime();
}

// ---------------------------------------------------------------- 掌握度算法

/** 复习间隔天数：mastery 越高间隔越长，取值集合为 1/2/4/7/15/30 天 */
export function masteryIntervalDays(mastery) {
  const m = clampInt(mastery, 0, 100, 0);
  if (m >= 95) return 30;
  if (m >= 80) return 15;
  if (m >= 60) return 7;
  if (m >= 40) return 4;
  if (m >= 20) return 2;
  return 1;
}

export function nextReviewFrom(mastery, fromMs = Date.now()) {
  return new Date(fromMs + masteryIntervalDays(mastery) * DAY).toISOString();
}

/** status 推导：mastery>=80 且有一次「掌握」自评 → mastered；否则按分数落到 learning / new */
export function deriveStatus(mastery, attemptsOrMasteredCount = []) {
  const masteredCount = Array.isArray(attemptsOrMasteredCount)
    ? attemptsOrMasteredCount.filter((a) => a && a.result === 'mastered').length
    : Number(attemptsOrMasteredCount) || 0;
  const m = clampInt(mastery, 0, 100, 0);
  if (m >= 80 && masteredCount >= 1) return 'mastered';
  if (m >= 20) return 'learning';
  return 'new';
}

// ---------------------------------------------------------------- 初始化 / 持久化

function defaultSettings() {
  return clone(DEFAULT_SETTINGS);
}

function mergeSettings(base, incoming) {
  const settings = base;
  if (incoming && typeof incoming === 'object') {
    if (typeof incoming.name === 'string' && incoming.name.trim()) settings.name = incoming.name.trim();
    const ai = incoming.ai && typeof incoming.ai === 'object' ? incoming.ai : {};
    if (typeof ai.baseUrl === 'string' && ai.baseUrl.trim()) settings.ai.baseUrl = ai.baseUrl.trim();
    if (typeof ai.model === 'string') settings.ai.model = ai.model.trim();
    if (typeof ai.visionModel === 'string') settings.ai.visionModel = ai.visionModel.trim();
    if (typeof ai.apiKey === 'string') settings.ai.apiKey = ai.apiKey.trim();
  }
  return settings;
}

function normalizeQuestion(raw) {
  if (!raw || typeof raw !== 'object' || !s(raw.text).trim()) return null;
  const nowIso = new Date().toISOString();
  const variants = normalizeVariants(raw.variants);
  const attempts = (Array.isArray(raw.attempts) ? raw.attempts : [])
    .map((a) => ({
      id: typeof (a && a.id) === 'string' && a.id ? a.id : makeId('a'),
      variantId:
        typeof (a && a.variantId) === 'string' && a.variantId
          ? a.variantId
          : null,
      result: RESULT_SET.has(a && a.result) ? a.result : 'fuzzy',
      at: isoOr(a && a.at, nowIso)
    }))
    .sort((a, b) => new Date(a.at) - new Date(b.at));
  const mastery = clampInt(raw.mastery, 0, 100, 20);
  const status = STATUS_SET.has(raw.status)
    ? raw.status
    : deriveStatus(mastery, attempts);
  const createdAt = isoOr(raw.createdAt, nowIso);
  let updatedAt = isoOr(raw.updatedAt, createdAt);
  attempts.forEach((a) => {
    if (a.at > updatedAt) updatedAt = a.at;
  });
  const nextReviewAt = isoOr(raw.nextReviewAt, null) || nextReviewFrom(mastery, Date.now());

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : makeId('q'),
    text: s(raw.text).trim(),
    answer: s(raw.answer).trim(),
    analysis: s(raw.analysis).trim(),
    commonMistakes: normalizeStringArray(raw.commonMistakes),
    errorType: normalizeErrorType(raw.errorType),
    errorReason: s(raw.errorReason).trim(),
    remedy: s(raw.remedy).trim(),
    knowledgeGuide: normalizeKnowledgeGuide(raw.knowledgeGuide),
    knowledgePoints: normalizeStringArray(raw.knowledgePoints),
    studentWork: s(raw.studentWork).trim(),
    masteryAssessment: normalizeMasteryAssessment(raw.masteryAssessment),
    targetedAdvice: s(raw.targetedAdvice).trim(),
    difficulty: clampInt(raw.difficulty, 1, 5, 3),
    mastery,
    status,
    subject: normalizeSubject(raw.subject),
    grade: normalizeGrade(raw.grade),
    source: s(raw.source).trim(),
    imageUrl:
      typeof raw.imageUrl === 'string' && raw.imageUrl.trim() ? raw.imageUrl.trim() : null,
    starred: raw.starred === true,
    notes: s(raw.notes).trim(),
    variants,
    attempts,
    reviewCount: Math.max(
      attempts.length,
      clampInt(raw.reviewCount, 0, 100000, attempts.length)
    ),
    createdAt,
    updatedAt,
    nextReviewAt
  };
}

function persist() {
  if (!state) return;
  const tmpFile = `${DB_FILE}.tmp`;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmpFile, DB_FILE);
  } catch (err) {
    console.error('[store] 数据写入失败：', err);
    throw new AppError(500, '数据保存失败，请检查 data 目录的写入权限');
  }
}

/** 首次启动：db.json 不存在时从 seed.json 初始化；损坏时备份后重新播种 */
export function initStore() {
  if (state) return state;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  if (fs.existsSync(DB_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      const questions = (Array.isArray(parsed && parsed.questions) ? parsed.questions : [])
        .map(normalizeQuestion)
        .filter(Boolean);
      state = {
        version: 1,
        settings: mergeSettings(defaultSettings(), parsed && parsed.settings),
        questions
      };
      return state;
    } catch (err) {
      const backup = `${DB_FILE}.corrupt-${Date.now()}.bak`;
      try {
        fs.renameSync(DB_FILE, backup);
        console.warn(`[store] db.json 解析失败，已备份为 ${path.basename(backup)}，将重新播种。`);
      } catch (renameErr) {
        console.warn('[store] db.json 解析失败且无法备份：', renameErr.message);
      }
    }
  }

  const seeded = loadSeedQuestions(Date.now())
    .map(normalizeQuestion)
    .filter(Boolean);
  state = {
    version: 1,
    settings: defaultSettings(),
    questions: seeded
  };
  persist();
  console.log(`[store] 已初始化 data/db.json，导入种子错题 ${seeded.length} 道。`);
  return state;
}

/** 强制把当前内存状态落盘（SIGINT / 退出前调用） */
export function flush() {
  try {
    if (state) persist();
  } catch (err) {
    console.error('[store] flush 失败：', err.message);
  }
}

function ensureState() {
  if (!state) initStore();
  return state;
}

// ---------------------------------------------------------------- 读取

export function getQuestions() {
  return ensureState().questions;
}

export function getRawSettings() {
  return ensureState().settings;
}

export function findQuestion(id) {
  const key = s(id);
  return ensureState().questions.find((q) => q.id === key) || null;
}

export function getQuestion(id) {
  const question = findQuestion(id);
  if (!question) throw new AppError(404, '错题不存在，可能已被删除');
  return question;
}

export function listQuestions(params = {}) {
  const query = params || {};
  let items = ensureState().questions.slice();

  if (query.subject) {
    const set = new Set(String(query.subject).split(',').map((x) => x.trim()).filter(Boolean));
    if (set.size) items = items.filter((q) => set.has(q.subject));
  }
  if (query.grade) {
    const set = new Set(String(query.grade).split(',').map((x) => x.trim()).filter(Boolean));
    if (set.size) items = items.filter((q) => set.has(q.grade));
  }
  if (query.status) {
    const set = new Set(String(query.status).split(',').map((x) => x.trim()).filter(Boolean));
    if (set.size) items = items.filter((q) => set.has(q.status));
  }
  if (query.difficulty) {
    const set = new Set(
      String(query.difficulty)
        .split(',')
        .map((x) => Number(x))
        .filter((n) => Number.isFinite(n))
    );
    if (set.size) items = items.filter((q) => set.has(q.difficulty));
  }
  const tag = s(query.tag || query.knowledge).trim().toLowerCase();
  if (tag) {
    items = items.filter((q) =>
      q.knowledgePoints.some((point) => point.toLowerCase().includes(tag))
    );
  }
  const needle = s(query.q).trim().toLowerCase();
  if (needle) {
    items = items.filter((q) => {
      const haystack = [
        q.text,
        q.answer,
        q.analysis,
        q.source,
        q.notes,
        q.studentWork,
        q.errorReason,
        ...q.knowledgePoints,
        ...q.commonMistakes
      ]
        .join('\n')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }
  if (query.starred === 'true' || query.starred === '1') {
    items = items.filter((q) => q.starred);
  }
  if (query.due === 'true' || query.due === '1') {
    items = items.filter((q) => isDue(q));
  }

  const sort = s(query.sort).trim().toLowerCase() || 'newest';
  const byCreatedDesc = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);
  const byCreatedAsc = (a, b) => new Date(a.createdAt) - new Date(b.createdAt);
  const byMasteryAsc = (a, b) => a.mastery - b.mastery || byCreatedDesc(a, b);
  const byMasteryDesc = (a, b) => b.mastery - a.mastery || byCreatedDesc(a, b);
  const byDifficultyDesc = (a, b) => b.difficulty - a.difficulty || byCreatedDesc(a, b);
  const byNextReviewAsc = (a, b) =>
    new Date(a.nextReviewAt) - new Date(b.nextReviewAt) || a.mastery - b.mastery;

  if (sort === 'oldest' || sort === 'old') items.sort(byCreatedAsc);
  else if (sort === 'updated') items.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  else if (sort === 'mastery' || sort === 'mastery-asc') items.sort(byMasteryAsc);
  else if (sort === 'mastery-desc') items.sort(byMasteryDesc);
  else if (sort === 'difficulty') items.sort(byDifficultyDesc);
  else if (sort === 'due' || sort === 'next-review') items.sort(byNextReviewAsc);
  else items.sort(byCreatedDesc);

  const total = items.length;
  const limit = clampInt(query.limit, 1, 500, 0);
  if (limit > 0) items = items.slice(0, limit);
  return { items, total };
}

export function isDue(question, nowMs = Date.now()) {
  return (
    question.status !== 'mastered' &&
    new Date(question.nextReviewAt).getTime() <= nowMs
  );
}

// ---------------------------------------------------------------- 写入

export function createQuestion(payload = {}) {
  ensureState();
  const text = s(payload.text).trim();
  if (!text) throw new AppError(400, '题干不能为空，请先录入题目内容');
  const id = makeId('q');
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const mastery = 20;
  let imageUrl = null;
  if (typeof payload.imageDataUrl === 'string' && payload.imageDataUrl.trim()) {
    imageUrl = saveImageForQuestion(id, payload.imageDataUrl);
  } else if (typeof payload.imageUrl === 'string' && payload.imageUrl.trim()) {
    imageUrl = payload.imageUrl.trim();
  }

  const question = normalizeQuestion({
    id,
    text: text.slice(0, 20000),
    answer: payload.answer,
    analysis: payload.analysis,
    commonMistakes: payload.commonMistakes,
    errorType: payload.errorType,
    errorReason: payload.errorReason,
    remedy: payload.remedy,
    knowledgeGuide: payload.knowledgeGuide,
    knowledgePoints: payload.knowledgePoints,
    studentWork: payload.studentWork,
    masteryAssessment: payload.masteryAssessment,
    targetedAdvice: payload.targetedAdvice,
    difficulty: payload.difficulty,
    mastery,
    status: 'new',
    subject: payload.subject,
    grade: payload.grade,
    source: payload.source || '手动录入',
    imageUrl,
    starred: payload.starred === true,
    notes: payload.notes,
    variants: payload.variants,
    attempts: [],
    reviewCount: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
    nextReviewAt: nextReviewFrom(mastery, now)
  });

  state.questions.unshift(question);
  persist();
  return question;
}

export function updateQuestion(id, patch = {}) {
  ensureState();
  const q = getQuestion(id);
  const body = patch && typeof patch === 'object' ? patch : {};

  if ('text' in body) {
    const text = s(body.text).trim();
    if (!text) throw new AppError(400, '题干不能为空');
    q.text = text.slice(0, 20000);
  }
  ['answer', 'analysis', 'source', 'notes', 'errorReason', 'remedy', 'targetedAdvice'].forEach(
    (key) => {
      if (key in body) q[key] = s(body[key]);
    }
  );
  if ('studentWork' in body) q.studentWork = s(body.studentWork).trim();
  if ('subject' in body) q.subject = normalizeSubject(body.subject);
  if ('grade' in body) q.grade = normalizeGrade(body.grade);
  if ('starred' in body) q.starred = body.starred === true;
  if ('difficulty' in body) q.difficulty = clampInt(body.difficulty, 1, 5, q.difficulty);
  if ('imageUrl' in body) {
    q.imageUrl =
      typeof body.imageUrl === 'string' && body.imageUrl.trim() ? body.imageUrl.trim() : null;
  }
  if (typeof body.imageDataUrl === 'string' && body.imageDataUrl.trim()) {
    q.imageUrl = saveImageForQuestion(q.id, body.imageDataUrl);
  }
  if ('commonMistakes' in body) q.commonMistakes = normalizeStringArray(body.commonMistakes);
  if ('knowledgePoints' in body) {
    q.knowledgePoints = normalizeStringArray(body.knowledgePoints);
  }
  if ('variants' in body) q.variants = normalizeVariants(body.variants);
  if ('knowledgeGuide' in body) q.knowledgeGuide = normalizeKnowledgeGuide(body.knowledgeGuide);
  if ('masteryAssessment' in body) {
    q.masteryAssessment = normalizeMasteryAssessment(body.masteryAssessment);
  }
  if ('errorType' in body) q.errorType = normalizeErrorType(body.errorType);
  if ('mastery' in body) q.mastery = clampInt(body.mastery, 0, 100, q.mastery);
  if ('nextReviewAt' in body) {
    const iso = isoOr(body.nextReviewAt, null);
    if (iso) q.nextReviewAt = iso;
  }
  if ('status' in body) {
    if (!STATUS_SET.has(body.status)) {
      throw new AppError(400, '状态取值范围为 new / learning / mastered');
    }
    q.status = body.status;
  } else if ('mastery' in body) {
    q.status = deriveStatus(q.mastery, q.attempts);
  }

  q.updatedAt = new Date().toISOString();
  persist();
  return q;
}

export function deleteQuestion(id) {
  ensureState();
  const q = getQuestion(id);
  const index = state.questions.indexOf(q);
  if (index >= 0) state.questions.splice(index, 1);
  persist();
  return true;
}

/** 自评：更新 mastery / attempts / reviewCount / status / nextReviewAt */
export function recordAttempt(id, payload = {}) {
  ensureState();
  const q = getQuestion(id);
  const result = payload && payload.result;
  if (!RESULT_SET.has(result)) {
    throw new AppError(400, '自评结果必须是 mastered（掌握）、fuzzy（模糊）或 failed（不会）');
  }
  let variantId = null;
  if (payload.variantId !== undefined && payload.variantId !== null && payload.variantId !== '') {
    variantId = String(payload.variantId);
    if (!q.variants.some((v) => v.id === variantId)) {
      throw new AppError(400, '变式题不存在，无法记录自评');
    }
  }

  const oldMastery = q.mastery;
  const oldStatus = q.status;
  const newMastery = clampInt(oldMastery + RESULT_DELTA[result], 0, 100, oldMastery);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  q.attempts.push({ id: makeId('a'), variantId, result, at: nowIso });
  q.reviewCount = (q.reviewCount || 0) + 1;
  q.mastery = newMastery;
  q.status = deriveStatus(newMastery, q.attempts);
  q.nextReviewAt = nextReviewFrom(newMastery, now);
  q.updatedAt = nowIso;
  persist();

  return {
    question: q,
    delta: newMastery - oldMastery,
    statusChanged: q.status !== oldStatus
  };
}

/** 追加 AI 生成的变式题 */
export function addVariants(id, variants) {
  ensureState();
  const q = getQuestion(id);
  const added = normalizeVariants(variants);
  if (!added.length) throw new AppError(400, '没有可添加的变式题');
  q.variants.push(...added);
  q.updatedAt = new Date().toISOString();
  persist();
  return { question: q, variants: added };
}

/** 把 base64 data URL 图片落盘为 data/uploads/<id>.jpg，返回 /uploads/<id>.jpg */
export function saveImageForQuestion(id, dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.trim()) {
    throw new AppError(400, '图片数据为空');
  }
  const match = /^data:(image\/(?:png|jpe?g|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i.exec(
    dataUrl.trim()
  );
  if (!match) {
    throw new AppError(400, '图片格式无效，请上传 JPG / PNG / WebP 格式的图片');
  }
  let buffer;
  try {
    buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  } catch (err) {
    throw new AppError(400, '图片数据无法解码');
  }
  if (!buffer.length) throw new AppError(400, '图片数据为空');
  if (buffer.length > 15 * 1024 * 1024) {
    throw new AppError(413, '图片过大，单张图片请控制在 15MB 以内');
  }
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const safeId = String(id).replace(/[^A-Za-z0-9_-]/g, '_');
  const filename = `${safeId}.jpg`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), buffer);
  return `/uploads/${filename}`;
}

// ---------------------------------------------------------------- 练习队列

export function buildPracticeQueue(params = {}) {
  ensureState();
  const rawMode = s(params.mode).trim().toLowerCase();
  const mode = ['due', 'weak', 'random', 'subject'].includes(rawMode) ? rawMode : 'due';
  const count = clampInt(params.count, 1, 20, 8);
  const subject = s(params.subject).trim();
  const now = Date.now();

  const pool = subject
    ? state.questions.filter((q) => q.subject === subject)
    : state.questions.slice();

  const byNextReview = (a, b) =>
    new Date(a.nextReviewAt) - new Date(b.nextReviewAt) || a.mastery - b.mastery;
  const byWeakness = (a, b) => {
    const aMastered = a.status === 'mastered' ? 1 : 0;
    const bMastered = b.status === 'mastered' ? 1 : 0;
    return (
      aMastered - bMastered ||
      a.mastery - b.mastery ||
      new Date(a.createdAt) - new Date(b.createdAt)
    );
  };

  let ordered;
  if (mode === 'random') {
    ordered = pool.slice();
    for (let i = ordered.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    }
  } else if (mode === 'weak') {
    ordered = pool.slice().sort(byWeakness);
  } else if (mode === 'subject') {
    ordered = pool
      .slice()
      .sort((a, b) => (isDue(a, now) ? 0 : 1) - (isDue(b, now) ? 0 : 1) || byNextReview(a, b));
  } else {
    const dueList = pool.filter((q) => isDue(q, now)).sort(byNextReview);
    const rest = pool.filter((q) => !isDue(q, now)).sort(byWeakness);
    ordered = [...dueList, ...rest];
  }

  const items = ordered.slice(0, count).map((q) => {
    const variant = q.variants && q.variants.length ? clone(q.variants[0]) : null;
    return {
      questionId: q.id,
      questionText: q.text,
      subject: q.subject,
      mastery: q.mastery,
      variant
    };
  });
  return { items, mode };
}

// ---------------------------------------------------------------- 统计

function computeStreak(questions, nowMs) {
  const activeDays = new Set();
  questions.forEach((q) => {
    activeDays.add(localDateKey(new Date(q.createdAt).getTime()));
    q.attempts.forEach((a) => activeDays.add(localDateKey(new Date(a.at).getTime())));
  });
  const cursor = new Date(startOfDay(nowMs));
  if (!activeDays.has(localDateKey(cursor.getTime()))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  let streak = 0;
  while (activeDays.has(localDateKey(cursor.getTime())) && streak < 10000) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function buildStats(nowMs = Date.now()) {
  ensureState();
  const questions = state.questions;
  const dueList = questions.filter((q) => isDue(q, nowMs)).sort(
    (a, b) =>
      new Date(a.nextReviewAt) - new Date(b.nextReviewAt) || a.mastery - b.mastery
  );

  const totalMastery = questions.reduce((sum, q) => sum + q.mastery, 0);
  const weeklyReviews = questions.reduce(
    (sum, q) =>
      sum + q.attempts.filter((a) => new Date(a.at).getTime() >= nowMs - 7 * DAY).length,
    0
  );

  const totals = {
    questions: questions.length,
    due: dueList.length,
    mastered: questions.filter((q) => q.status === 'mastered').length,
    learning: questions.filter((q) => q.status === 'learning').length,
    new: questions.filter((q) => q.status === 'new').length,
    avgMastery: questions.length ? Math.round(totalMastery / questions.length) : 0,
    weeklyAdded: questions.filter((q) => new Date(q.createdAt).getTime() >= nowMs - 7 * DAY)
      .length,
    weeklyReviews,
    streak: computeStreak(questions, nowMs)
  };

  const bucketDefs = [
    { key: 'new', label: '未掌握', test: (m) => m < 20 },
    { key: 'low', label: '待巩固', test: (m) => m >= 20 && m < 50 },
    { key: 'mid', label: '较熟练', test: (m) => m >= 50 && m < 80 },
    { key: 'high', label: '已掌握', test: (m) => m >= 80 }
  ];
  const masteryBuckets = bucketDefs.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    count: questions.filter((q) => bucket.test(q.mastery)).length
  }));

  const subjectMap = new Map();
  questions.forEach((q) => {
    if (!subjectMap.has(q.subject)) {
      subjectMap.set(q.subject, { subject: q.subject, total: 0, mastered: 0, sum: 0 });
    }
    const row = subjectMap.get(q.subject);
    row.total += 1;
    row.sum += q.mastery;
    if (q.status === 'mastered') row.mastered += 1;
  });
  const subjects = [...subjectMap.values()]
    .map((row) => ({
      subject: row.subject,
      total: row.total,
      mastered: row.mastered,
      avgMastery: row.total ? Math.round(row.sum / row.total) : 0
    }))
    .sort((a, b) => b.total - a.total || b.avgMastery - a.avgMastery);

  const knowledgeMap = new Map();
  questions.forEach((q) => {
    q.knowledgePoints.forEach((tag) => {
      if (!knowledgeMap.has(tag)) {
        knowledgeMap.set(tag, {
          tag,
          subject: q.subject,
          total: 0,
          sum: 0,
          failed: 0
        });
      }
      const row = knowledgeMap.get(tag);
      row.total += 1;
      row.sum += q.mastery;
      row.failed += q.attempts.filter((a) => a.result === 'failed').length;
    });
  });
  const knowledge = [...knowledgeMap.values()]
    .map((row) => ({
      tag: row.tag,
      subject: row.subject,
      total: row.total,
      avgMastery: row.total ? Math.round(row.sum / row.total) : 0,
      failed: row.failed
    }))
    .sort((a, b) => a.avgMastery - b.avgMastery || b.total - a.total);

  const errorTypeMap = new Map();
  questions.forEach((q) => {
    if (!q.errorType) return;
    errorTypeMap.set(q.errorType, (errorTypeMap.get(q.errorType) || 0) + 1);
  });
  const errorTypes = ERROR_TYPE_LIST.map((type) => ({
    type,
    count: errorTypeMap.get(type) || 0
  })).sort((a, b) => b.count - a.count || ERROR_TYPE_LIST.indexOf(a.type) - ERROR_TYPE_LIST.indexOf(b.type));

  const activity = [];
  for (let offset = 13; offset >= 0; offset -= 1) {
    const dayMs = dayStartOffset(nowMs, -offset);
    const dayKey = localDateKey(dayMs);
    const added = questions.filter(
      (q) => localDateKey(new Date(q.createdAt).getTime()) === dayKey
    ).length;
    const reviewed = questions.reduce(
      (sum, q) =>
        sum +
        q.attempts.filter((a) => localDateKey(new Date(a.at).getTime()) === dayKey).length,
      0
    );
    activity.push({ date: shortDate(dayMs), added, reviewed });
  }

  const forecast = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const dayMs = dayStartOffset(nowMs, offset);
    const dayKey = localDateKey(dayMs);
    const count = questions.filter(
      (q) =>
        q.status !== 'mastered' &&
        localDateKey(new Date(q.nextReviewAt).getTime()) === dayKey
    ).length;
    forecast.push({ date: shortDate(dayMs), count });
  }

  const recent = questions
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 6);

  const last7 = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const dayMs = dayStartOffset(nowMs, -offset);
    const dayKey = localDateKey(dayMs);
    const count = questions.reduce(
      (sum, q) =>
        sum +
        q.attempts.filter((a) => localDateKey(new Date(a.at).getTime()) === dayKey).length,
      0
    );
    last7.push({ date: shortDate(dayMs), count });
  }

  return {
    totals,
    masteryBuckets,
    subjects,
    knowledge,
    errorTypes,
    activity,
    forecast,
    recent,
    due: dueList.slice(0, 6),
    last7
  };
}

// ---------------------------------------------------------------- 设置

/** 更新设置；apiKey 为空或未传表示保留，clearKey:true 表示清空 */
export function updateSettings(patch = {}) {
  ensureState();
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new AppError(400, '请求体格式不正确');
  }
  if ('name' in patch) {
    const name = s(patch.name).trim();
    if (name) state.settings.name = name.slice(0, 40);
  }
  if (patch.ai && typeof patch.ai === 'object' && !Array.isArray(patch.ai)) {
    const ai = patch.ai;
    if ('baseUrl' in ai) {
      const baseUrl = s(ai.baseUrl).trim();
      if (baseUrl) {
        if (!/^https?:\/\//i.test(baseUrl)) {
          throw new AppError(400, 'AI 接口地址必须以 http:// 或 https:// 开头');
        }
        state.settings.ai.baseUrl = baseUrl.slice(0, 500);
      }
    }
    if ('model' in ai) state.settings.ai.model = s(ai.model).trim().slice(0, 120);
    if ('visionModel' in ai) {
      state.settings.ai.visionModel = s(ai.visionModel).trim().slice(0, 120);
    }
    if (ai.clearKey === true) {
      state.settings.ai.apiKey = '';
    } else if ('apiKey' in ai && typeof ai.apiKey === 'string' && ai.apiKey.trim()) {
      state.settings.ai.apiKey = ai.apiKey.trim().slice(0, 400);
    }
  }
  persist();
  return state.settings;
}
