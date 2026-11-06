// 知错 · 智能错题本 —— AI 引擎（OpenAI 兼容 live 引擎 + 零配置 demo 引擎）
// live：POST {baseUrl}/chat/completions，支持 image_url 视觉输入，90 秒超时，严格 JSON 解析。
// demo：未配置 Key / AI_MOCK=1 时使用；返回明确标注「示例」的完整分析，图片请求返回 422。
import { AppError, ERROR_TYPE_LIST, MASTERY_LEVEL_LIST, SUBJECTS, GRADES } from './shared.mjs';

const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';
const DEFAULT_MODEL = 'deepseek-chat';
const DEFAULT_TIMEOUT_MS = 90000;
const IMAGE_DEMO_ERROR =
  '演示模式暂无法识别图片，请在设置中配置视觉模型，或直接粘贴题目文字';

function env(name) {
  // Cloudflare Worker 通过 globalThis.__ZC_ENV__ 注入 secret / vars；
  // Node 本地运行则回退到 process.env。
  const injected = globalThis.__ZC_ENV__;
  if (injected && typeof injected[name] === 'string') return injected[name].trim();
  const value = typeof process !== 'undefined' && process.env ? process.env[name] : '';
  return typeof value === 'string' ? value.trim() : '';
}

function s(value) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function strArray(value, limit = 10) {
  if (!Array.isArray(value)) return [];
  return value.map((x) => s(x).trim()).filter(Boolean).slice(0, limit);
}

// ---------------------------------------------------------------- 配置解析

/**
 * 配置优先级：页面保存的 settings.ai > 环境变量 AI_API_KEY / AI_BASE_URL / AI_MODEL / AI_VISION_MODEL。
 * 由于默认设置里预填了官方地址与模型，这里把「仍等于默认值」视为用户未显式保存，从而让环境变量生效。
 */
export function resolveConfig(settings) {
  const ai = (settings && settings.ai) || {};
  const mock = env('AI_MOCK').toLowerCase();
  const forceDemo = mock === '1' || mock === 'true' || mock === 'yes';

  const savedBaseUrl = s(ai.baseUrl).trim();
  const envBaseUrl = env('AI_BASE_URL');
  let baseUrl =
    savedBaseUrl && savedBaseUrl !== DEFAULT_BASE_URL
      ? savedBaseUrl
      : envBaseUrl || savedBaseUrl || DEFAULT_BASE_URL;

  const savedModel = s(ai.model).trim();
  const envModel = env('AI_MODEL');
  const model =
    savedModel && savedModel !== DEFAULT_MODEL
      ? savedModel
      : envModel || savedModel || DEFAULT_MODEL;

  const savedVision = s(ai.visionModel).trim();
  const visionModel = savedVision || env('AI_VISION_MODEL') || model;

  const apiKey = s(ai.apiKey).trim() || env('AI_API_KEY');
  const mode = forceDemo ? 'demo' : apiKey ? 'live' : 'demo';

  return {
    mode,
    forceDemo,
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, '') || DEFAULT_BASE_URL,
    model,
    visionModel
  };
}

function providerLabel(baseUrl) {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    if (host.includes('deepseek')) return 'DeepSeek';
    if (host.includes('openai')) return 'OpenAI';
    if (host.includes('dashscope') || host.includes('aliyuncs')) return '阿里云百炼';
    if (host.includes('moonshot')) return 'Moonshot';
    if (host.includes('bigmodel') || host.includes('zhipu')) return '智谱 AI';
    if (host.includes('openrouter')) return 'OpenRouter';
    if (host.includes('localhost') || host.includes('127.0.0.1')) return '本地模型';
    return host || '自定义接口';
  } catch (err) {
    return '自定义接口';
  }
}

/** /api/health 的 AI 状态（含视觉模型，前端据此显示「拍照识别是否可用」） */
export function healthInfo(settings) {
  const cfg = resolveConfig(settings);
  const demo = cfg.mode === 'demo';
  return {
    mode: cfg.mode,
    model: demo ? 'demo' : cfg.model,
    provider: demo ? '演示模式' : providerLabel(cfg.baseUrl),
    visionModel: demo ? '' : cfg.visionModel
  };
}

/** /api/settings 的脱敏视图（永不回传明文 apiKey） */
export function settingsView(settings) {
  const cfg = resolveConfig(settings);
  const ai = (settings && settings.ai) || {};
  return {
    name: s(settings && settings.name) || '同学',
    ai: {
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      visionModel: s(ai.visionModel).trim() || env('AI_VISION_MODEL') || '',
      hasKey: Boolean(cfg.apiKey),
      mode: cfg.mode
    }
  };
}

/** 兼容：带 /chat/completions、带 /v1、或不带 /v1 的 baseUrl */
export function resolveChatUrl(baseUrl) {
  let base = s(baseUrl).trim().replace(/\/+$/, '');
  if (!base) base = DEFAULT_BASE_URL;
  if (/\/chat\/completions$/i.test(base)) return base;
  if (/\/v1$/i.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

// ---------------------------------------------------------------- HTTP 调用

async function callChat(config, messages, options = {}) {
  const {
    maxTokens = 3000,
    temperature = 0.3,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    label = 'AI 请求'
  } = options;
  const url = resolveChatUrl(config.baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();

  try {
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          temperature,
          max_tokens: maxTokens,
          stream: false
        }),
        signal: controller.signal
      });
    } catch (err) {
      if (err && err.name === 'AbortError') {
        throw new AppError(
          504,
          `${label}超时（超过 ${Math.round(timeoutMs / 1000)} 秒），请稍后重试`
        );
      }
      throw new AppError(
        502,
        `无法连接 AI 服务：${err && err.message ? err.message : '网络错误'}。请检查接口地址与网络连接。`
      );
    }

    const rawText = await response.text();
    if (!response.ok) {
      let detail = '';
      try {
        const parsed = JSON.parse(rawText);
        detail = s(parsed && parsed.error && parsed.error.message) || s(parsed && parsed.message);
      } catch (err) {
        detail = rawText.slice(0, 200);
      }
      if (response.status === 401 || response.status === 403) {
        throw new AppError(502, `AI 服务鉴权失败（HTTP ${response.status}），请检查 API Key 是否正确。`);
      }
      if (response.status === 429) {
        throw new AppError(502, 'AI 服务请求过于频繁（HTTP 429），请稍后重试。');
      }
      if (response.status === 404) {
        throw new AppError(
          502,
          'AI 接口地址不存在（HTTP 404），请检查 baseUrl 是否需要包含 /v1。'
        );
      }
      throw new AppError(
        502,
        `AI 服务返回错误（HTTP ${response.status}）${detail ? `：${detail.slice(0, 300)}` : ''}`
      );
    }

    let data;
    try {
      data = JSON.parse(rawText);
    } catch (err) {
      throw new AppError(502, 'AI 服务返回了非 JSON 响应，请检查接口地址是否为 OpenAI 兼容接口。');
    }

    const content = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : null;
    let text = '';
    if (typeof content === 'string') {
      text = content.trim();
    } else if (Array.isArray(content)) {
      text = content
        .map((part) => (typeof part === 'string' ? part : s(part && part.text)))
        .join('')
        .trim();
    }
    if (!text) {
      throw new AppError(502, 'AI 服务没有返回有效内容，请更换模型后重试。');
    }
    return {
      content: text,
      model: s(data && data.model) || config.model,
      ms: Date.now() - started
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 去掉 ```json 围栏、截取第一个平衡的大括号，再 JSON.parse */
export function parseJsonLoose(raw) {
  let text = s(raw).trim();
  if (!text) throw new Error('empty');
  text = text.replace(/^```(?:json|JSON)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

  const start = text.indexOf('{');
  if (start < 0) throw new Error('no json object');

  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) throw new Error('unbalanced json object');
  return JSON.parse(text.slice(start, end + 1));
}

async function requestJson(config, messages, options = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const attemptMessages =
      attempt === 0
        ? messages
        : [
            ...messages,
            {
              role: 'user',
              content:
                '你上一次的输出不是合法 JSON。请只输出一个合法的 JSON 对象，不要使用 markdown 代码块，不要输出任何解释文字。'
            }
          ];
    const { content, model, ms } = await callChat(config, attemptMessages, {
      ...options,
      temperature: attempt === 0 ? (options.temperature ?? 0.3) : 0
    });
    try {
      return { json: parseJsonLoose(content), model, ms };
    } catch (err) {
      lastError = err;
    }
  }
  throw new AppError(
    502,
    `AI 返回内容解析失败（已自动重试一次），请稍后重试或更换模型。${lastError ? '' : ''}`
  );
}

// ---------------------------------------------------------------- 提示词

const ANALYZE_SYSTEM_PROMPT = `你是「知错」智能错题本的高中教研助手。工作流程：
1. 识别题目（文字或图片，图片可能是拍照的试卷 / 作业，可能包含学生的手写解题过程与错误笔迹）；
2. 独立解答题目，给出正确答案与分步解析；
3. 判定错因类型，并结合学生解题过程分析「错在哪一步、暴露了哪个知识点掌握不足」；
4. 给出课本知识点的掌握指南（概念、要点、陷阱、自检清单）；
5. 针对薄弱点生成 2 道举一反三的变式题。

请严格按下面的 JSON 结构输出，只输出一个 JSON 对象，不要输出 markdown 代码块、不要任何额外文字：
{
  "recognizedText": "识别出的完整题干",
  "subject": "数学/物理/化学/英语/语文/生物/历史/地理/政治 之一",
  "grade": "高一/高二/高三 之一",
  "knowledgePoints": ["2-3 个具体知识点"],
  "difficulty": 1-5 的整数,
  "difficultyReason": "一句话说明难度判断依据",
  "answer": "最终答案（简洁、正确）",
  "analysis": "分步解析（换行分步骤，讲清思路与关键步骤）",
  "commonMistakes": ["2-3 条常见易错点"],
  "studentWork": "学生自己的解题过程/错答/卡点（若图片中有手写过程，请先完整识别抄录；若用户只给了文字题，留空字符串或说明未提供）",
  "errorType": "概念不清/审题失误/计算失误/方法不当/迁移不足/表达不规范/其他 之一",
  "errorReason": "结合学生具体步骤的错因剖析，2-4 句：错在哪一步、为什么错、暴露了什么",
  "remedy": "3-5 步掌握指导：先补哪个概念 → 如何重做 → 做哪类变式 → 如何复盘自检",
  "knowledgeGuide": [
    {
      "point": "知识点名，必须与 knowledgePoints 中的某一项一致",
      "concept": "课本概念/定理的通俗复述（2-3 句）",
      "keyPoints": ["必须掌握的 2-4 条要点"],
      "pitfalls": ["常见陷阱 1-3 条"],
      "checklist": ["自检清单 2-3 条（能复述/能套用/能辨析）"]
    }
  ],
  "masteryAssessment": [
    {
      "point": "知识点名",
      "level": "未掌握/薄弱/基本掌握/熟练 之一",
      "evidence": "引用学生步骤中的具体证据；未提供过程时说明为初步判断",
      "gap": "具体知识缺口",
      "microLesson": "针对该缺口的 2-4 句微型讲解，给出可立即执行的动作"
    }
  ],
  "targetedAdvice": "针对该学生的下一步行动建议：先补哪个概念、做哪类题、如何自检（3 步左右）",
  "variants": [
    {"text": "变式题 1 题干", "answer": "答案", "analysis": "解析", "hint": "提示", "point": "该变式针对的知识点"},
    {"text": "变式题 2 题干", "answer": "答案", "analysis": "解析", "hint": "提示", "point": "该变式针对的知识点"}
  ]
}

判定标准与要求：
1. 「解题过程优先于最终答案」：如果学生提供了 studentWork（或图片中有手写过程），必须先逐步复述学生的思路，指出第一处出错的步骤及其知识根源；不要只给标准答案。
2. level 判定：完全想不起来定义/公式 → 未掌握；方向对但关键步骤错 → 薄弱；方法对、个别计算或书写错 → 基本掌握；能独立、规范、快速完成 → 熟练。
3. 数学公式使用可读的纯文本，如 x²、√3、≤、∈、α，不要使用 LaTeX 或 $ 符号。
4. 答案必须正确；解析要分步骤；涉及计算时写出关键中间结果。
5. 变式题必须围绕本题知识点（填 point），与原题不同但难度相当，并给出完整答案与解析。
6. knowledgeGuide 至少 1 条且与 knowledgePoints 对齐；masteryAssessment 至少 1 条。`;

const VARIANTS_SYSTEM_PROMPT = `你是「知错」智能错题本的高中教研助手。请根据给定错题（可含学生解题过程与薄弱知识点），生成 2-4 道举一反三的变式题，帮助学生在同一知识点上迁移应用。
只输出一个 JSON 对象，不要 markdown 代码块，不要额外文字：
{
  "variants": [
    {"text": "变式题题干", "answer": "正确答案", "analysis": "分步解析", "hint": "只提示第一步或关键思路", "point": "该题针对的知识点"}
  ]
}
要求：变式题与原题同知识点、不同设问或数据；难度与原题相当；答案必须正确；解析分步骤；数学公式用纯文本（x²、√3、≤），不要 LaTeX。`;

// ---------------------------------------------------------------- 学科 / 知识点识别（demo 引擎与兜底共用）

const SUBJECT_KEYWORDS = {
  数学: [
    '函数', '方程', '不等式', '集合', '数列', '向量', '三角', '导数', '概率', '椭圆',
    '双曲线', '抛物线', '坐标', '证明', '求值', '极值', '单调', '交点', 'sin', 'cos',
    'tan', 'log', '²', '√', '∠', '△', '⊆', '∈'
  ],
  物理: [
    '速度', '加速度', '位移', '牛顿', '电场', '磁场', '电流', '电压', '电阻', '功率',
    '能量', '动量', '摩擦', '重力', '洛伦兹', '匀强', '匀变速', '小球', '斜面', '弹簧',
    '压强', '波长', '电容器', '带电粒子'
  ],
  化学: [
    '溶液', '反应', '氧化', '还原', '离子', '摩尔', 'mol', '物质', '元素', '化合物',
    '盐酸', '硫酸', '氢氧化', '浓度', '平衡', '催化剂', '电子转移', '沉淀', '气体',
    '碳酸钙', '氯气', '二氧化锰', '化学式'
  ],
  英语: [
    'the ', ' a ', ' an ', ' to ', ' of ', ' is ', ' are ', ' was ', ' were ', ' has ',
    ' have ', ' which', ' that ', '填空', '单词', '语法', '时态', '从句', '翻译', '阅读',
    '写作', 'English', '______', 'by the time', 'not until'
  ],
  语文: [
    '诗句', '文言', '作者', '修辞', '病句', '成语', '字音', '字形', '阅读', '作文',
    '散文', '小说', '默写', '翻译', '《', '》', '实词', '词类活用', '主语'
  ],
  生物: ['细胞', '光合', '呼吸作用', '遗传', '基因', 'DNA', '蛋白质', '酶', '生态', '种群', '免疫'],
  历史: ['朝代', '历史', '革命', '战争', '条约', '古代', '近代', '世纪', '改革', '王朝'],
  地理: ['气候', '地形', '洋流', '大气', '地球', '经纬', '人口', '城市', '农业', '季风', '板块'],
  政治: ['经济', '政治', '文化', '哲学', '价值', '市场', '政府', '法治', '民主', '唯物']
};

const KNOWLEDGE_KEYWORDS = {
  数学: {
    集合: ['集合', '子集', '包含', '⊆'],
    一元二次不等式: ['二次不等式', '不等式', 'x²'],
    函数与导数: ['导数', "f'", '极值', '单调区间', '切线', '函数'],
    数列: ['数列', '等差', '等比', '通项', '前 n 项和', 'a₁', 'aₙ'],
    三角函数: ['sin', 'cos', 'tan', '三角', '象限角'],
    平面向量: ['向量', '数量积', '夹角', 'a·b'],
    圆锥曲线: ['椭圆', '双曲线', '抛物线', '离心率', '焦距'],
    概率统计: ['概率', '期望', '方差', '分布列', '统计']
  },
  物理: {
    匀变速直线运动: ['匀加速', '匀变速', '加速度', '位移', '速度公式', '刹车'],
    牛顿运动定律: ['牛顿', '合力', '受力', '摩擦力', '质量', '支持力'],
    电场: ['电场', '电荷', '电容器', '场强', '电压', '电势'],
    磁场: ['磁场', '洛伦兹力', '磁感应强度', '带电粒子', '圆周运动'],
    机械能: ['动能', '势能', '机械能', '功', '功率', '自由落体'],
    动量: ['动量', '冲量', '碰撞'],
    电路: ['电阻', '电流', '欧姆', '串联', '并联', '电动势']
  },
  化学: {
    物质的量: ['物质的量', 'mol', '摩尔', '摩尔质量', '气体摩尔体积', '阿伏加德罗'],
    离子反应: ['离子方程式', '离子反应', '沉淀', '拆写', '难溶'],
    氧化还原反应: ['氧化剂', '还原剂', '氧化还原', '电子转移', '化合价'],
    化学平衡: ['化学平衡', '平衡移动', '转化率', '催化剂'],
    元素及其化合物: ['盐酸', '硫酸', '氢氧化', '碳酸钙', '氯气', '二氧化锰', '硝酸']
  },
  英语: {
    时态: ['过去完成时', '一般过去时', '现在完成时', '时态', 'had ', 'has '],
    非谓语动词: ['非谓语', '过去分词', '现在分词', 'written', 'to do', '作定语'],
    定语从句: ['定语从句', 'which', 'who', 'that', 'where'],
    倒装句: ['倒装', 'not until', 'hardly', 'only then', 'did he'],
    虚拟语气: ['虚拟语气', 'were', 'would have']
  },
  语文: {
    文言实词: ['文言', '实词', '词类活用', '《', '军', '王', '目'],
    病句辨析: ['病句', '语病', '成分残缺', '搭配不当', '修改', '主语'],
    古诗鉴赏: ['诗', '词', '赏析', '杜甫', '李白', '意象'],
    成语运用: ['成语', '不刊之论', '望文生义'],
    现代文阅读: ['现代文', '阅读', '散文', '小说', '作用题']
  }
};

function countOccurrences(text, keyword) {
  const haystack = text.toLowerCase();
  const needle = keyword.toLowerCase();
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while (true) {
    const found = haystack.indexOf(needle, index);
    if (found < 0) break;
    count += 1;
    index = found + needle.length;
  }
  return count;
}

export function detectSubject(text, hint = '') {
  const clean = s(text);
  const validHint = s(hint).trim();
  if (SUBJECTS.includes(validHint)) return validHint;
  const latin = (clean.match(/[A-Za-z]/g) || []).length;
  const han = (clean.match(/[\u4e00-\u9fa5]/g) || []).length;
  const scores = {};
  Object.entries(SUBJECT_KEYWORDS).forEach(([subject, keywords]) => {
    scores[subject] = keywords.reduce((sum, kw) => sum + countOccurrences(clean, kw), 0);
  });
  if (latin > 20 && latin >= han * 1.2) scores['英语'] += 8;
  let best = '数学';
  let bestScore = 0;
  Object.entries(scores).forEach(([subject, score]) => {
    if (score > bestScore) {
      best = subject;
      bestScore = score;
    }
  });
  return bestScore > 0 ? best : '数学';
}

export function detectKnowledgePoints(text, subject) {
  const clean = s(text);
  const map = KNOWLEDGE_KEYWORDS[subject] || {};
  const scored = Object.entries(map)
    .map(([tag, keywords]) => [tag, keywords.reduce((sum, kw) => sum + countOccurrences(clean, kw), 0)])
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1]);
  const tags = scored.slice(0, 3).map(([tag]) => tag);
  return tags.length ? tags : [`${subject}综合`];
}

export function detectGrade(text, hint = '') {
  const validHint = s(hint).trim();
  if (GRADES.includes(validHint)) return validHint;
  const clean = s(text);
  if (clean.includes('高三') || clean.includes('高考') || clean.includes('一轮复习')) return '高三';
  if (clean.includes('高二')) return '高二';
  if (clean.includes('高一') || clean.includes('必修一') || clean.includes('必修1')) return '高一';
  return '高二';
}

function detectDifficulty(text) {
  const clean = s(text);
  let score = 2;
  if (clean.length > 40) score += 1;
  if (clean.length > 90) score += 1;
  ['证明', '取值范围', '恒成立', '综合', '分类讨论', '最值', '压轴', '求参数', '讨论'].forEach(
    (keyword) => {
      if (clean.includes(keyword)) score += 1;
    }
  );
  return clampInt(score, 1, 5, 3);
}

// ---------------------------------------------------------------- 错因诊断（demo）

const ERROR_HINTS = [
  { type: '计算失误', keywords: ['算错', '计算', '粗心', '算成', '得数', '约分', '代入错', '符号错'] },
  { type: '审题失误', keywords: ['看错', '没看清', '审题', '忽略', '漏看', '条件看', '题目要求'] },
  { type: '概念不清', keywords: ['公式', '概念', '定义', '定理', '不明白', '不会', '忘了', '记错'] },
  { type: '方法不当', keywords: ['思路', '方法', '不知道怎么做', '硬算', '没思路', '方向错'] },
  { type: '迁移不足', keywords: ['换个', '变式', '类似', '没做过', '迁移', '新题'] },
  { type: '表达不规范', keywords: ['格式', '步骤', '书写', '单位', '答题卡', '符号没写'] }
];

function detectErrorType(studentWork, difficulty) {
  const work = s(studentWork);
  if (work) {
    let best = '其他';
    let bestScore = 0;
    ERROR_HINTS.forEach((hint) => {
      const score = hint.keywords.reduce((sum, kw) => sum + (work.includes(kw) ? 1 : 0), 0);
      if (score > bestScore) {
        best = hint.type;
        bestScore = score;
      }
    });
    if (bestScore > 0) return best;
  }
  if (difficulty >= 4) return '方法不当';
  if (difficulty === 1) return '计算失误';
  return '审题失误';
}

function levelForErrorType(errorType) {
  if (errorType === '未掌握') return '未掌握';
  if (errorType === '概念不清' || errorType === '方法不当') return '薄弱';
  if (errorType === '计算失误' || errorType === '审题失误') return '基本掌握';
  if (errorType === '迁移不足' || errorType === '表达不规范') return '基本掌握';
  return '薄弱';
}

function microLessonFor(point, errorType) {
  const actions = {
    概念不清: `回到课本，把「${point}」的定义、公式和适用条件各抄一遍，再合上书复述；然后用一道最基础的例题验证自己能否独立写出第一步。`,
    审题失误: `动笔前先圈出「已知、所求、限制条件」三类信息，把本题漏掉的条件写在题号旁；再遮住答案重做一遍，对照自己第一次漏了什么。`,
    计算失误: `把每一步中间结果写下来，代入前先检查符号与单位；完成后用另一种方法（估算、逆运算或代回原式）验算一次。`,
    方法不当: `先判断题目属于「${point}」的哪一类模型，再选择方法；把标准解法的第一步固定成模板，避免一上来就硬算。`,
    迁移不足: `把本题与教材例题并排比较，找出「结构相同、数据不同」的地方；先仿照例题做一道，再独立完成一道变式题。`,
    表达不规范: `按「已知 → 公式 → 代入 → 结果 → 作答」五步书写，检查单位、符号和结论句；用评分标准逐条自检。`,
    其他: `先复述题目条件和目标，再对照解析标出卡住的位置，把卡点写成一句话后逐条解决。`
  };
  return actions[errorType] || actions['其他'];
}

function buildDemoGuide(point, subject, errorType) {
  const subjectKeyPoints = {
    数学: ['记准定义域与适用条件', '把条件翻译成方程/不等式/图象关系', '每一步变形都要可逆并说明依据'],
    物理: ['先画受力图或运动过程图', '统一单位，规定正方向', '区分状态量与过程量，代入前先写公式'],
    化学: ['先写化学式并配平', '标注化合价与电子转移方向', '注意条件（浓度、温度、状态）'],
    英语: ['先判断句子成分与谓语', '再判断时态/语态/非谓语关系', '最后检查主谓一致与拼写'],
    语文: ['先确定考点（实词/病句/手法）', '结合上下文语境推断', '用规范术语分点作答']
  };
  const keyPoints = subjectKeyPoints[subject] || ['明确概念的定义与适用条件', '按步骤规范书写', '完成后回代检验'];
  return {
    point,
    concept: `【示例指南】「${point}」是${subject}中的核心考点之一：先弄清它的定义与适用条件，再把它与题目条件对应起来。（演示模式生成，配置 AI 后可获得针对本题的课本级讲解）`,
    keyPoints: keyPoints.slice(0, 3),
    pitfalls: [
      `只记结论、忽略「${point}」的适用条件`,
      errorType === '计算失误' ? '中间步骤跳步导致符号或数值出错' : '审题时漏看限制条件'
    ],
    checklist: [
      `能否不看书写出「${point}」的定义或公式？`,
      '能否独立完成一道同类型基础题并说明每一步依据？',
      '能否指出本题最容易出错的一个地方？'
    ]
  };
}

function buildDemoMasteryAssessment(kps, studentWork, errorType, difficulty) {
  const work = s(studentWork).trim();
  const point = kps[0] || '核心考点';
  if (work) {
    const excerpt = work.length > 46 ? `${work.slice(0, 46)}…` : work;
    return [
      {
        point,
        level: levelForErrorType(errorType),
        evidence: `你的解题过程中写道「${excerpt}」。`,
        gap:
          errorType === '概念不清'
            ? `对「${point}」的定义与适用条件还不熟，导致无法正确起步。`
            : errorType === '计算失误'
              ? '思路基本正确，但中间计算/符号处理不稳定，导致结果出错。'
              : errorType === '审题失误'
                ? '没有把题目中的限制条件完整转化为解题信息。'
                : errorType === '方法不当'
                  ? `没有选到「${point}」对应的标准解法，步骤方向偏离。`
                  : errorType === '迁移不足'
                    ? '对熟悉题型能处理，但题目稍作变化后找不到对应模型。'
                    : '解题步骤与书写不规范，关键依据没有交代清楚。',
        microLesson: microLessonFor(point, errorType)
      }
    ];
  }
  return [
    {
      point,
      level: difficulty >= 4 ? '薄弱' : '基本掌握',
      evidence: '未提供解题过程，评估为初步判断（演示模式）。',
      gap: `「${point}」的条件转化与规范书写还需要通过具体步骤确认。`,
      microLesson: microLessonFor(point, difficulty >= 4 ? '方法不当' : '审题失误')
    }
  ];
}

function buildDemoRemedy(kp, errorType) {
  return [
    `1. 补概念：重读课本「${kp}」的定义与例题，合上书复述关键条件；`,
    `2. 重做：遮住答案完整重做本题，重点检查${errorType === '计算失误' ? '每一步中间结果与符号' : '题目条件是否用全'}；`,
    '3. 变式：完成下面 2 道变式题，只允许看提示，不允许直接看答案；',
    '4. 复盘：用一句话写下这次错因，并在 3 天后安排一次复习。'
  ].join('\n');
}

function buildDemoVariants(kp, subject, studentWork, count = 2) {
  const work = s(studentWork).trim();
  const variants = [
    {
      text: `【示例变式 1】围绕「${kp}」，把原题中的关键数据换成另一组数值，求同样的目标量。`,
      answer: '【示例解析 · 非标准答案】代入新数据后按同一思路计算。',
      analysis: `【示例解析】沿用「${kp}」的公式与步骤，更换数据重新求解，注意运算顺序。`,
      hint: '先写出公式，再代入数据。',
      point: kp
    },
    {
      text: `【示例变式 2】围绕「${kp}」，把问题改成由结果反求条件（逆向设问）。`,
      answer: '【示例解析 · 非标准答案】把所求量设为未知数，列方程反推。',
      analysis: `【示例解析】按「${kp}」的关系式建立方程，解出未知条件并检验取值范围。`,
      hint: '把要求解的量设为未知数。',
      point: kp
    },
    {
      text: `【示例变式 3】围绕「${kp}」，增加一个干扰条件，判断它对结果是否有影响。`,
      answer: '【示例解析 · 非标准答案】先判断该条件是否参与「${kp}」的核心关系式。',
      analysis: `【示例解析】逐一检查条件与「${kp}」公式中变量的对应关系，排除无关条件。`,
      hint: '先列出核心公式，再逐条对照条件。',
      point: kp
    }
  ];
  const result = variants.slice(0, Math.max(2, Math.min(3, count)));
  if (work) {
    result[0].analysis += `\n（结合你的步骤：先找出与「${kp}」不一致的那一步，再重新列式。）`;
  }
  return result;
}

// ---------------------------------------------------------------- demo 分析

function demoAnalysis(text, { subject, grade, studentWork }) {
  const cleanText = s(text).trim();
  const subjectName = detectSubject(cleanText, subject);
  const gradeName = detectGrade(cleanText, grade);
  const knowledgePoints = detectKnowledgePoints(cleanText, subjectName);
  const difficulty = detectDifficulty(cleanText);
  const work = s(studentWork).trim();
  const errorType = detectErrorType(work, difficulty);
  const point = knowledgePoints[0];
  const point2 = knowledgePoints[1] || point;

  const evidence = work
    ? `你的解题过程里写道「${work.length > 46 ? `${work.slice(0, 46)}…` : work}」。`
    : '你还没有提供解题过程，以下判断为基于题目的初步推测。';
  const errorReason = [
    `【示例诊断 · 非真实 AI 分析】${evidence}`,
    `从题干看，本题考查「${point}」，属于「${errorType}」型问题：${microLessonFor(point, errorType)}`
  ].join('\n');

  const answer = [
    '【示例解析 · 非标准答案】演示模式不提供真实标准答案。',
    `本题围绕「${point}」考查，建议的求解方向是：${microLessonFor(point, errorType)}`
  ].join('');

  const analysis = [
    '【示例解析】',
    '一、审题：圈出已知条件、所求量以及限制条件，判断本题考查「' + point + '」。',
    `二、思路：回忆${subjectName}中「${point}」的定义/公式/定理，把条件逐条翻译成可计算的关系。`,
    '三、求解：按步骤代入并写出关键中间结果，注意符号与单位。',
    work
      ? `四、对照你的步骤：${microLessonFor(point, errorType)}`
      : '四、自查：做完后回代检验，判断结果是否落在题目要求的范围内。',
    '说明：以上是演示模式生成的通用解题框架，并非对本题的真实解答；配置 AI 后可以获得逐题分步解析。'
  ].join('\n');

  const knowledgeGuide = knowledgePoints.slice(0, 2).map((kp) =>
    buildDemoGuide(kp, subjectName, errorType)
  );

  const variants = buildDemoVariants(point, subjectName, work, 2).map((variant, index) => ({
    ...variant,
    point: index === 1 ? point2 : point
  }));

  const masteryAssessment = buildDemoMasteryAssessment(
    knowledgePoints,
    work,
    errorType,
    difficulty
  );
  if (knowledgePoints.length > 1 && work) {
    masteryAssessment.push({
      point: point2,
      level: errorType === '概念不清' ? '薄弱' : '基本掌握',
      evidence: `结合题干与你的步骤，本题考查了「${point2}」，但你的过程没有体现对应判断。`,
      gap: `「${point2}」的适用条件与本题条件的对应关系尚未在步骤中体现。`,
      microLesson: microLessonFor(point2, errorType === '计算失误' ? '审题失误' : errorType)
    });
  }

  const targetedAdvice = [
    `1. 先补「${point}」：重看课本定义与一道例题，合上书用自己的话复述一遍；`,
    `2. 再做 2 道针对「${point}」的变式题，限时 10 分钟，做完立刻对照解析；`,
    `3. 明天用 3 分钟重做本题，重点检查${errorType === '计算失误' ? '计算与符号' : '条件是否用全'}，把仍卡住的地方记到错题本备注里。`
  ].join('\n');

  return {
    recognizedText: cleanText,
    subject: subjectName,
    grade: gradeName,
    knowledgePoints,
    difficulty,
    difficultyReason: `演示模式根据题干长度与关键词粗略判断为 ${difficulty} 星；配置 AI 后可获得更准确的难度判断。`,
    answer,
    analysis,
    commonMistakes: [
      `忽略「${point}」的适用条件或取值范围`,
      errorType === '计算失误' ? '中间步骤跳步导致符号或数值错误' : '审题时漏看限制条件'
    ],
    studentWork: work,
    masteryAssessment,
    targetedAdvice,
    errorType,
    errorReason,
    remedy: `【示例指导】\n${buildDemoRemedy(point, errorType)}`,
    knowledgeGuide,
    variants,
    engine: 'demo'
  };
}

// ---------------------------------------------------------------- live 结果归一化

function normalizeGuideList(value, knowledgePoints, subject, errorType) {
  const list = Array.isArray(value) ? value : [];
  const guides = list
    .map((item) => ({
      point: s(item && item.point).trim(),
      concept: s(item && item.concept).trim(),
      keyPoints: strArray(item && item.keyPoints, 6),
      pitfalls: strArray(item && item.pitfalls, 4),
      checklist: strArray(item && item.checklist, 4)
    }))
    .filter((item) => item.point && (item.concept || item.keyPoints.length));
  if (guides.length) return guides;
  return knowledgePoints.slice(0, 2).map((point) => buildDemoGuide(point, subject, errorType));
}

function normalizeMasteryList(value, knowledgePoints, studentWork, errorType, difficulty) {
  const list = Array.isArray(value) ? value : [];
  const items = list
    .map((item) => ({
      point: s(item && item.point).trim(),
      level: MASTERY_LEVEL_LIST.includes(item && item.level) ? item.level : '薄弱',
      evidence: s(item && item.evidence).trim(),
      gap: s(item && item.gap).trim(),
      microLesson: s(item && item.microLesson).trim()
    }))
    .filter((item) => item.point)
    .slice(0, 5);
  if (items.length) return items;
  return buildDemoMasteryAssessment(knowledgePoints, studentWork, errorType, difficulty);
}

function normalizeAnalysisJson(json, { text = '', subject = '', grade = '', studentWork = '', engine = 'live' }) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new AppError(502, 'AI 返回的数据结构不正确，请重试。');
  }
  const cleanText = s(text).trim();
  const recognized = s(json.recognizedText).trim() || cleanText;

  const subjectRaw = s(json.subject).trim();
  const subjectName = SUBJECTS.includes(subjectRaw)
    ? subjectRaw
    : SUBJECTS.includes(s(subject).trim())
      ? s(subject).trim()
      : detectSubject(recognized || cleanText, '');

  const gradeRaw = s(json.grade).trim();
  const gradeName = GRADES.includes(gradeRaw)
    ? gradeRaw
    : GRADES.includes(s(grade).trim())
      ? s(grade).trim()
      : detectGrade(recognized || cleanText, '');

  let knowledgePoints = Array.isArray(json.knowledgePoints)
    ? strArray(json.knowledgePoints, 6)
    : [];
  if (!knowledgePoints.length) knowledgePoints = detectKnowledgePoints(recognized, subjectName);

  const difficulty = clampInt(json.difficulty, 1, 5, 3);
  const work = s(json.studentWork).trim() || s(studentWork).trim();
  const errorTypeRaw = s(json.errorType).trim();
  const errorType = ERROR_TYPE_LIST.includes(errorTypeRaw)
    ? errorTypeRaw
    : detectErrorType(work, difficulty);

  const variantsRaw = Array.isArray(json.variants) ? json.variants : [];
  const variants = variantsRaw
    .map((v) => ({
      text: s(v && v.text).trim(),
      answer: s(v && v.answer).trim(),
      analysis: s(v && v.analysis).trim(),
      hint: s(v && v.hint).trim(),
      point: s(v && v.point).trim() || knowledgePoints[0] || ''
    }))
    .filter((v) => v.text)
    .slice(0, 2);
  while (variants.length < 2) {
    variants.push({
      text: `【补充变式】围绕「${knowledgePoints[0] || '本题知识点'}」再做一道同类题（AI 未返回足够变式，可点击重新生成）。`,
      answer: '（待 AI 生成）',
      analysis: '',
      hint: '回顾本题的解题步骤。',
      point: knowledgePoints[0] || ''
    });
  }

  return {
    recognizedText: recognized,
    subject: subjectName,
    grade: gradeName,
    knowledgePoints,
    difficulty,
    difficultyReason: s(json.difficultyReason).trim() || '根据题干条件与常见设问综合判断。',
    answer: s(json.answer).trim() || '（AI 未给出明确答案，请结合解析核对）',
    analysis: s(json.analysis).trim() || '（AI 未返回解析，请重试）',
    commonMistakes: strArray(json.commonMistakes, 6),
    studentWork: work,
    masteryAssessment: normalizeMasteryList(
      json.masteryAssessment,
      knowledgePoints,
      work,
      errorType,
      difficulty
    ),
    targetedAdvice:
      s(json.targetedAdvice).trim() ||
      `先补「${knowledgePoints[0] || '核心概念'}」的定义与适用条件，再做 2 道同知识点变式，最后复盘错因。`,
    errorType,
    errorReason: s(json.errorReason).trim() || '（AI 未返回错因剖析，请重试）',
    remedy:
      s(json.remedy).trim() ||
      `1. 补概念：重读「${knowledgePoints[0] || '相关知识点'}」的定义与例题；\n2. 重做本题并对照解析；\n3. 完成 2 道变式题；\n4. 复盘错因并安排复习。`,
    knowledgeGuide: normalizeGuideList(
      json.knowledgeGuide,
      knowledgePoints,
      subjectName,
      errorType
    ),
    variants,
    engine
  };
}

// ---------------------------------------------------------------- 对外：分析

export async function analyze({ text = '', imageDataUrl = '', studentWork = '', subject = '', grade = '', settings } = {}) {
  const cfg = resolveConfig(settings);
  const started = Date.now();
  const cleanText = s(text).trim();
  const cleanWork = s(studentWork).trim();
  const image = s(imageDataUrl).trim();

  if (cfg.mode === 'demo') {
    if (image) throw new AppError(422, IMAGE_DEMO_ERROR);
    if (!cleanText) throw new AppError(400, '请提供题目文字或图片');
    const analysis = demoAnalysis(cleanText, { subject, grade, studentWork: cleanWork });
    return {
      analysis,
      meta: { engine: 'demo', model: 'demo', ms: Math.max(0, Date.now() - started) }
    };
  }

  if (!cleanText && !image) throw new AppError(400, '请提供题目文字或图片');

  const hints = [
    s(subject).trim() ? `学科提示：${s(subject).trim()}` : '',
    s(grade).trim() ? `年级提示：${s(grade).trim()}` : '',
    cleanWork ? '用户提供了自己的解题过程，请优先分析学生的步骤。' : ''
  ]
    .filter(Boolean)
    .join('；');

  const userText = [
    `请识别并解答下面这道高中题目${hints ? `（${hints}）` : ''}：`,
    cleanText || '（题目在图片中，请先识别图片文字与手写过程）',
    cleanWork ? `\n学生写的解题过程 / 错答 / 卡点：\n${cleanWork}` : ''
  ].join('\n');

  const userContent = image
    ? [
        { type: 'text', text: userText },
        { type: 'image_url', image_url: { url: image } }
      ]
    : userText;

  const messages = [
    { role: 'system', content: ANALYZE_SYSTEM_PROMPT },
    { role: 'user', content: userContent }
  ];

  const { json, model } = await requestJson(cfg, messages, {
    maxTokens: 4000,
    temperature: 0.2
  });
  const analysis = normalizeAnalysisJson(json, {
    text: cleanText,
    subject,
    grade,
    studentWork: cleanWork,
    engine: 'live'
  });
  return {
    analysis,
    meta: { engine: 'live', model: model || cfg.model, ms: Math.max(0, Date.now() - started) }
  };
}

// ---------------------------------------------------------------- 对外：补充变式题

export async function generateVariants(question, count = 2, settings) {
  const cfg = resolveConfig(settings);
  const n = clampInt(count, 1, 5, 2);
  const knowledgePoints = (question && question.knowledgePoints) || [];
  const point = knowledgePoints[0] || '核心知识点';

  if (cfg.mode === 'demo') {
    if (question && question.imageUrl) {
      // 仍可基于文字生成示例变式，图片只用于展示
    }
    return buildDemoVariants(point, (question && question.subject) || '数学', question && question.studentWork, n).slice(0, n);
  }

  const weak = (question.masteryAssessment || [])
    .filter((item) => item.level === '未掌握' || item.level === '薄弱')
    .map((item) => `${item.point}（${item.gap || item.level}）`)
    .join('；');

  const userText = [
    '请针对下面这道错题生成变式题：',
    `题干：${s(question.text)}`,
    `答案：${s(question.answer)}`,
    `知识点：${knowledgePoints.join('、') || '未标注'}`,
    `错因类型：${s(question.errorType) || '未标注'}`,
    s(question.errorReason) ? `错因分析：${s(question.errorReason)}` : '',
    s(question.studentWork) ? `学生解题过程：${s(question.studentWork)}` : '',
    weak ? `学生薄弱点：${weak}` : '',
    `请生成 ${n} 道变式题，优先针对学生的薄弱点。`
  ]
    .filter(Boolean)
    .join('\n');

  const messages = [
    { role: 'system', content: VARIANTS_SYSTEM_PROMPT },
    { role: 'user', content: userText }
  ];

  const { json } = await requestJson(cfg, messages, { maxTokens: 2600, temperature: 0.4 });
  const list = Array.isArray(json && json.variants)
    ? json.variants
    : Array.isArray(json)
      ? json
      : [];
  const variants = list
    .map((v) => ({
      text: s(v && v.text).trim(),
      answer: s(v && v.answer).trim(),
      analysis: s(v && v.analysis).trim(),
      hint: s(v && v.hint).trim(),
      point: s(v && v.point).trim() || point
    }))
    .filter((v) => v.text)
    .slice(0, n);

  if (!variants.length) {
    throw new AppError(502, 'AI 没有生成有效的变式题，请稍后重试。');
  }
  return variants;
}

// ---------------------------------------------------------------- 对外：连接测试

export async function testConnection(settings) {
  const cfg = resolveConfig(settings);
  if (cfg.mode !== 'live') {
    return {
      ok: false,
      engine: 'demo',
      latency: 0,
      message:
        '当前为演示模式：未配置 API Key。AI 分析会返回明确标注「示例」的内容；在设置页填写 API Key 后可获得真实解析。'
    };
  }
  const started = Date.now();
  try {
    await callChat(
      cfg,
      [{ role: 'user', content: '请只回复两个字：正常' }],
      { maxTokens: 16, temperature: 0, timeoutMs: 30000, label: 'AI 连接测试' }
    );
    const latency = Math.max(1, Date.now() - started);
    return {
      ok: true,
      engine: 'live',
      latency,
      message: `连接成功：${providerLabel(cfg.baseUrl)} · ${cfg.model}（用时 ${latency} ms）`
    };
  } catch (err) {
    return {
      ok: false,
      engine: 'live',
      latency: Math.max(0, Date.now() - started),
      message: err instanceof AppError ? err.message : `连接失败：${err && err.message ? err.message : '未知错误'}`
    };
  }
}
