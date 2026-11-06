// 知错 · Cloudflare D1 数据层
// 复用与本地 Node 服务一致的数据结构、掌握度算法与统计口径。
import {
  AppError,
  ERROR_TYPE_LIST,
  MASTERY_LEVEL_LIST,
  SUBJECTS,
  GRADES,
  DIFFICULTIES,
} from '../server/shared.mjs';

const DAY = 86400000;
const TZ_OFFSET = 8 * 3600000; // 以北京时间做日历统计
const RESULT_DELTA = { mastered: 16, fuzzy: 4, failed: -8 };
const RESULT_SET = new Set(Object.keys(RESULT_DELTA));
const STATUS_SET = new Set(['new', 'learning', 'mastered']);
const ERROR_TYPE_SET = new Set(ERROR_TYPE_LIST);
const MASTERY_LEVEL_SET = new Set(MASTERY_LEVEL_LIST);

export const DEFAULT_SETTINGS = {
  name: '同学',
  ai: {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    visionModel: '',
    apiKey: '',
  },
};

export { ERROR_TYPE_LIST, MASTERY_LEVEL_LIST, SUBJECTS, GRADES, DIFFICULTIES };

function s(value) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
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

function normalizeStringArray(value, limit = 20) {
  if (Array.isArray(value)) {
    return value.map((x) => s(x).trim()).filter(Boolean).slice(0, limit);
  }
  if (typeof value === 'string') {
    return value
      .split(/\r?\n|[,，、;；]/)
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, limit);
  }
  return [];
}

function normalizeSubject(value) {
  const subject = s(value).trim();
  return SUBJECTS.includes(subject) ? subject : subject || '数学';
}

function normalizeGrade(value) {
  const grade = s(value).trim();
  return GRADES.includes(grade) ? grade : grade || '高一';
}

function normalizeErrorType(value) {
  const type = s(value).trim();
  return ERROR_TYPE_SET.has(type) ? type : '其他';
}

function normalizeVariants(value) {
  const list = Array.isArray(value) ? value : [];
  return list
    .filter((v) => v && typeof v === 'object' && s(v.text).trim())
    .slice(0, 8)
    .map((v) => ({
      id: typeof v.id === 'string' && v.id ? v.id : makeId('v'),
      text: s(v.text).trim(),
      answer: s(v.answer).trim(),
      analysis: s(v.analysis).trim(),
      hint: s(v.hint).trim(),
      ...(s(v.point).trim() ? { point: s(v.point).trim() } : {}),
    }));
}

function normalizeKnowledgeGuide(value) {
  const list = Array.isArray(value) ? value : [];
  return list
    .filter((g) => g && typeof g === 'object' && (s(g.point).trim() || s(g.concept).trim()))
    .slice(0, 8)
    .map((g) => ({
      point: s(g.point).trim(),
      concept: s(g.concept).trim(),
      keyPoints: normalizeStringArray(g.keyPoints, 8),
      pitfalls: normalizeStringArray(g.pitfalls, 8),
      checklist: normalizeStringArray(g.checklist, 8),
    }));
}

function normalizeMasteryAssessment(value) {
  const list = Array.isArray(value) ? value : [];
  return list
    .filter((a) => a && typeof a === 'object' && s(a.point).trim())
    .slice(0, 8)
    .map((a) => ({
      point: s(a.point).trim(),
      level: MASTERY_LEVEL_SET.has(a.level) ? a.level : '薄弱',
      evidence: s(a.evidence).trim(),
      gap: s(a.gap).trim(),
      microLesson: s(a.microLesson).trim(),
    }));
}

export function makeId(prefix = 'q') {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const rand = Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 12);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function normalizeQuestion(raw) {
  if (!raw || typeof raw !== 'object' || !s(raw.text).trim()) return null;
  const nowIso = new Date().toISOString();
  const variants = normalizeVariants(raw.variants);
  const attempts = (Array.isArray(raw.attempts) ? raw.attempts : [])
    .map((a) => ({
      id: typeof (a && a.id) === 'string' && a.id ? a.id : makeId('a'),
      variantId: typeof (a && a.variantId) === 'string' && a.variantId ? a.variantId : null,
      result: RESULT_SET.has(a && a.result) ? a.result : 'fuzzy',
      at: isoOr(a && a.at, nowIso),
    }))
    .sort((a, b) => new Date(a.at) - new Date(b.at));
  const mastery = clampInt(raw.mastery, 0, 100, 20);
  const status = STATUS_SET.has(raw.status) ? raw.status : deriveStatus(mastery, attempts);
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
    source: s(raw.source).trim() || '手动录入',
    imageUrl: typeof raw.imageUrl === 'string' && raw.imageUrl.trim() ? raw.imageUrl.trim() : null,
    starred: raw.starred === true,
    notes: s(raw.notes).trim(),
    variants,
    attempts,
    reviewCount: Math.max(attempts.length, clampInt(raw.reviewCount, 0, 9999, attempts.length)),
    createdAt,
    updatedAt,
    nextReviewAt,
  };
}

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

export function deriveStatus(mastery, attempts = []) {
  const masteredCount = Array.isArray(attempts)
    ? attempts.filter((a) => a && a.result === 'mastered').length
    : Number(attempts) || 0;
  const m = clampInt(mastery, 0, 100, 0);
  if (m >= 80 && masteredCount >= 1) return 'mastered';
  if (m >= 20) return 'learning';
  return 'new';
}

export function isDue(question, nowMs = Date.now()) {
  return question.status !== 'mastered' && new Date(question.nextReviewAt).getTime() <= nowMs;
}

// ---------------------------------------------------------------- 持久化

export async function allQuestions(env) {
  const { results } = await env.DB.prepare('SELECT data FROM questions').all();
  return (results || [])
    .map((row) => {
      try {
        return normalizeQuestion(JSON.parse(row.data));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export async function getQuestion(env, id) {
  const row = await env.DB.prepare('SELECT data FROM questions WHERE id = ?').bind(id).first();
  if (!row) return null;
  try {
    return normalizeQuestion(JSON.parse(row.data));
  } catch {
    return null;
  }
}

export async function saveQuestion(env, question) {
  await env.DB.prepare(
    'INSERT INTO questions (id, data, created_at, updated_at) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
  )
    .bind(question.id, JSON.stringify(question), question.createdAt, question.updatedAt)
    .run();
}

export async function deleteQuestion(env, id) {
  const existing = await getQuestion(env, id);
  if (!existing) throw new AppError(404, '错题不存在或已被删除');
  await env.DB.prepare('DELETE FROM questions WHERE id = ?').bind(id).run();
  return true;
}

export async function createQuestion(env, payload = {}) {
  const text = s(payload.text).trim();
  if (!text) throw new AppError(400, '题干不能为空，请先录入题目内容');
  const id = makeId('q');
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  let imageUrl = null;
  if (typeof payload.imageDataUrl === 'string' && payload.imageDataUrl.trim()) {
    imageUrl = await saveImage(env, payload.imageDataUrl);
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
    mastery: 20,
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
    nextReviewAt: nextReviewFrom(20, now),
  });
  await saveQuestion(env, question);
  return question;
}

export async function updateQuestion(env, id, patch = {}) {
  const q = await getQuestion(env, id);
  if (!q) throw new AppError(404, '错题不存在或已被删除');
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
    q.imageUrl = typeof body.imageUrl === 'string' && body.imageUrl.trim() ? body.imageUrl.trim() : null;
  }
  if (typeof body.imageDataUrl === 'string' && body.imageDataUrl.trim()) {
    q.imageUrl = await saveImage(env, body.imageDataUrl);
  }
  if ('commonMistakes' in body) q.commonMistakes = normalizeStringArray(body.commonMistakes);
  if ('knowledgePoints' in body) q.knowledgePoints = normalizeStringArray(body.knowledgePoints);
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
    if (!STATUS_SET.has(body.status)) throw new AppError(400, '状态取值范围为 new / learning / mastered');
    q.status = body.status;
  } else if ('mastery' in body) {
    q.status = deriveStatus(q.mastery, q.attempts);
  }

  q.updatedAt = new Date().toISOString();
  await saveQuestion(env, q);
  return q;
}

export async function recordAttempt(env, id, payload = {}) {
  const q = await getQuestion(env, id);
  if (!q) throw new AppError(404, '错题不存在或已被删除');
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
  await saveQuestion(env, q);

  return { question: q, delta: newMastery - oldMastery, statusChanged: q.status !== oldStatus };
}

export async function addVariants(env, id, variants) {
  const q = await getQuestion(env, id);
  if (!q) throw new AppError(404, '错题不存在或已被删除');
  const added = normalizeVariants(variants);
  if (!added.length) throw new AppError(400, '没有可添加的变式题');
  q.variants.push(...added);
  q.updatedAt = new Date().toISOString();
  await saveQuestion(env, q);
  return { question: q, variants: added };
}

// ---------------------------------------------------------------- 设置

function mergeSettings(base, incoming) {
  const settings = clone(base);
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

export async function getSettings(env) {
  const row = await env.DB.prepare('SELECT data FROM settings WHERE id = 1').first();
  let stored = {};
  if (row) {
    try {
      stored = JSON.parse(row.data);
    } catch {
      stored = {};
    }
  }
  return mergeSettings(DEFAULT_SETTINGS, stored);
}

export async function updateSettings(env, patch = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new AppError(400, '请求体格式不正确');
  }
  const current = await getSettings(env);
  if ('name' in patch) {
    const name = s(patch.name).trim();
    if (name) current.name = name.slice(0, 40);
  }
  if (patch.ai && typeof patch.ai === 'object' && !Array.isArray(patch.ai)) {
    const ai = patch.ai;
    if ('baseUrl' in ai) {
      const baseUrl = s(ai.baseUrl).trim();
      if (baseUrl) {
        if (!/^https?:\/\//i.test(baseUrl)) {
          throw new AppError(400, 'AI 接口地址必须以 http:// 或 https:// 开头');
        }
        current.ai.baseUrl = baseUrl.slice(0, 500);
      }
    }
    if ('model' in ai) current.ai.model = s(ai.model).trim().slice(0, 120);
    if ('visionModel' in ai) current.ai.visionModel = s(ai.visionModel).trim().slice(0, 120);
    if (ai.clearKey === true) current.ai.apiKey = '';
    else if ('apiKey' in ai && typeof ai.apiKey === 'string' && ai.apiKey.trim()) {
      current.ai.apiKey = ai.apiKey.trim().slice(0, 400);
    }
  }
  await env.DB.prepare('INSERT INTO settings (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data')
    .bind(JSON.stringify(current))
    .run();
  return current;
}

// ---------------------------------------------------------------- 图片

export async function saveImage(env, dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.trim()) throw new AppError(400, '图片数据为空');
  const match = /^data:(image\/(?:png|jpe?g|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.trim());
  if (!match) throw new AppError(400, '图片格式无效，请上传 JPG / PNG / WebP 格式的图片');
  const mime = match[1].toLowerCase();
  const base64 = match[2].replace(/\s+/g, '');
  const bytes = Math.floor((base64.length * 3) / 4);
  if (bytes > 8 * 1024 * 1024) throw new AppError(400, '图片过大，请压缩后再上传（上限 8MB）');
  const id = makeId('img');
  await env.DB.prepare('INSERT INTO images (id, mime, data, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, mime, base64, new Date().toISOString())
    .run();
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : mime.includes('gif') ? 'gif' : 'jpg';
  return `/uploads/${id}.${ext}`;
}

export async function getImage(env, name) {
  const id = String(name || '').replace(/\.(png|jpe?g|webp|gif)$/i, '');
  if (!id.startsWith('img_')) return null;
  const row = await env.DB.prepare('SELECT mime, data FROM images WHERE id = ?').bind(id).first();
  if (!row) return null;
  return { mime: row.mime, base64: row.data };
}

// ---------------------------------------------------------------- 列表 / 统计

export async function listQuestions(env, params = {}) {
  let questions = await allQuestions(env);
  const subject = s(params.subject).trim();
  const status = s(params.status).trim();
  const difficulty = s(params.difficulty).trim();
  const tag = s(params.tag).trim();
  const qtext = s(params.q).trim().toLowerCase();
  const starred = s(params.starred).trim();
  const due = s(params.due).trim();
  const sort = s(params.sort).trim() || 'recent';
  const limit = clampInt(params.limit, 1, 500, 200);

  if (subject) questions = questions.filter((q) => q.subject === subject);
  if (status) {
    if (status === 'due') questions = questions.filter((q) => isDue(q));
    else if (status === 'new+learning' || status === 'active') {
      questions = questions.filter((q) => q.status !== 'mastered');
    } else questions = questions.filter((q) => q.status === status);
  }
  if (difficulty) questions = questions.filter((q) => String(q.difficulty) === difficulty);
  if (starred === '1' || starred === 'true') questions = questions.filter((q) => q.starred);
  if (tag) questions = questions.filter((q) => (q.knowledgePoints || []).includes(tag));
  if (qtext) {
    questions = questions.filter((q) =>
      [q.text, q.answer, q.analysis, q.notes, q.errorReason, ...(q.knowledgePoints || [])]
        .join('\n')
        .toLowerCase()
        .includes(qtext)
    );
  }
  if (due === '1' || due === 'true') questions = questions.filter((q) => isDue(q));

  const byDate = (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt);
  if (sort === 'mastery-asc') questions.sort((a, b) => a.mastery - b.mastery);
  else if (sort === 'mastery-desc') questions.sort((a, b) => b.mastery - a.mastery);
  else if (sort === 'difficulty-desc') questions.sort((a, b) => b.difficulty - a.difficulty);
  else if (sort === 'created') questions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  else if (sort === 'due') {
    questions.sort((a, b) => new Date(a.nextReviewAt) - new Date(b.nextReviewAt) || a.mastery - b.mastery);
  } else questions.sort(byDate);

  return { items: questions.slice(0, limit), total: questions.length };
}

function dateKey(ms) {
  const d = new Date(ms + TZ_OFFSET);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate()
  ).padStart(2, '0')}`;
}

function shortDate(ms) {
  const d = new Date(ms + TZ_OFFSET);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function dayStart(ms) {
  const d = new Date(ms + TZ_OFFSET);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() - TZ_OFFSET;
}

function computeStreak(questions, nowMs) {
  const activeDays = new Set();
  questions.forEach((q) => {
    activeDays.add(dateKey(new Date(q.createdAt).getTime()));
    q.attempts.forEach((a) => activeDays.add(dateKey(new Date(a.at).getTime())));
  });
  let cursor = dayStart(nowMs);
  if (!activeDays.has(dateKey(cursor))) cursor -= DAY;
  let streak = 0;
  while (activeDays.has(dateKey(cursor)) && streak < 10000) {
    streak += 1;
    cursor -= DAY;
  }
  return streak;
}

export async function buildStats(env, nowMs = Date.now()) {
  const questions = await allQuestions(env);
  const dueList = questions
    .filter((q) => isDue(q, nowMs))
    .sort((a, b) => new Date(a.nextReviewAt) - new Date(b.nextReviewAt) || a.mastery - b.mastery);

  const totalMastery = questions.reduce((sum, q) => sum + q.mastery, 0);
  const weeklyReviews = questions.reduce(
    (sum, q) => sum + q.attempts.filter((a) => new Date(a.at).getTime() >= nowMs - 7 * DAY).length,
    0
  );
  const totals = {
    questions: questions.length,
    due: dueList.length,
    mastered: questions.filter((q) => q.status === 'mastered').length,
    learning: questions.filter((q) => q.status === 'learning').length,
    new: questions.filter((q) => q.status === 'new').length,
    avgMastery: questions.length ? Math.round(totalMastery / questions.length) : 0,
    weeklyAdded: questions.filter((q) => new Date(q.createdAt).getTime() >= nowMs - 7 * DAY).length,
    weeklyReviews,
    streak: computeStreak(questions, nowMs),
  };

  const bucketDefs = [
    { key: 'new', label: '未掌握', test: (m) => m < 20 },
    { key: 'low', label: '待巩固', test: (m) => m >= 20 && m < 50 },
    { key: 'mid', label: '较熟练', test: (m) => m >= 50 && m < 80 },
    { key: 'high', label: '已掌握', test: (m) => m >= 80 },
  ];
  const masteryBuckets = bucketDefs.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    count: questions.filter((q) => bucket.test(q.mastery)).length,
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
      avgMastery: row.total ? Math.round(row.sum / row.total) : 0,
    }))
    .sort((a, b) => b.total - a.total || b.avgMastery - a.avgMastery);

  const knowledgeMap = new Map();
  questions.forEach((q) => {
    q.knowledgePoints.forEach((tag) => {
      if (!knowledgeMap.has(tag)) {
        knowledgeMap.set(tag, { tag, subject: q.subject, total: 0, sum: 0, failed: 0 });
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
      failed: row.failed,
    }))
    .sort((a, b) => a.avgMastery - b.avgMastery || b.total - a.total);

  const errorTypeMap = new Map();
  questions.forEach((q) => {
    if (!q.errorType) return;
    errorTypeMap.set(q.errorType, (errorTypeMap.get(q.errorType) || 0) + 1);
  });
  const errorTypes = [...errorTypeMap.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type, 'zh-Hans-CN'));

  const activity = [];
  for (let offset = 13; offset >= 0; offset -= 1) {
    const dayMs = dayStart(nowMs - offset * DAY);
    const key = dateKey(dayMs);
    const added = questions.filter((q) => dateKey(new Date(q.createdAt).getTime()) === key).length;
    const reviewed = questions.reduce(
      (sum, q) => sum + q.attempts.filter((a) => dateKey(new Date(a.at).getTime()) === key).length,
      0
    );
    activity.push({ date: shortDate(dayMs), added, reviewed });
  }

  const forecast = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const dayMs = dayStart(nowMs + offset * DAY);
    const key = dateKey(dayMs);
    const count = questions.filter(
      (q) =>
        q.status !== 'mastered' && dateKey(new Date(q.nextReviewAt).getTime()) === key
    ).length;
    forecast.push({ date: shortDate(dayMs), count });
  }

  const recent = questions
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 6);

  const last7 = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const dayMs = dayStart(nowMs - offset * DAY);
    const key = dateKey(dayMs);
    const count = questions.reduce(
      (sum, q) => sum + q.attempts.filter((a) => dateKey(new Date(a.at).getTime()) === key).length,
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
    last7,
  };
}

// ---------------------------------------------------------------- 练习队列

export async function buildPracticeQueue(env, params = {}) {
  const rawMode = s(params.mode).trim().toLowerCase();
  const mode = ['due', 'weak', 'random', 'subject'].includes(rawMode) ? rawMode : 'due';
  const count = clampInt(params.count, 1, 20, 8);
  const subject = s(params.subject).trim();
  const now = Date.now();
  const pool = (await allQuestions(env)).filter((q) => (subject ? q.subject === subject : true));

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
  } else if (mode === 'weak') ordered = pool.slice().sort(byWeakness);
  else if (mode === 'subject') {
    ordered = pool
      .slice()
      .sort((a, b) => (isDue(a, now) ? 0 : 1) - (isDue(b, now) ? 0 : 1) || byNextReview(a, b));
  } else {
    const dueList = pool.filter((q) => isDue(q, now)).sort(byNextReview);
    const rest = pool.filter((q) => !isDue(q, now)).sort(byWeakness);
    ordered = [...dueList, ...rest];
  }

  return {
    mode,
    items: ordered.slice(0, count).map((q) => ({
      questionId: q.id,
      questionText: q.text,
      subject: q.subject,
      mastery: q.mastery,
      variant: q.variants && q.variants.length ? clone(q.variants[0]) : null,
    })),
  };
}

export async function buildMeta(env) {
  const questions = await allQuestions(env);
  const sources = [...new Set(questions.map((q) => q.source).filter(Boolean))].slice(0, 24);
  return {
    subjects: SUBJECTS.slice(),
    grades: GRADES.slice(),
    difficulties: DIFFICULTIES.slice(),
    sources,
    errorTypes: ERROR_TYPE_LIST.slice(),
    masteryLevels: MASTERY_LEVEL_LIST.slice(),
  };
}
