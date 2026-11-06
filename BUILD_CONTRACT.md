# 知错 · 智能错题本 — 开发契约

> 所有成员必须遵守本文件。文件所有权按任务写作用域执行，不要改动他人文件。
> 运行环境：Windows，Node v24，零 npm 依赖（仅 Node 内置模块），前端为原生 ES Modules，无构建步骤。

## 1. 产品与信息架构

「知错」是一个 AI 智能错题管理系统，定位：高中生的纸质错题本数字化 + AI 教研助手。
视觉方向：**纸张与墨色的编辑排版 / 学习手账**。暖米色纸面、深墨蓝、朱砂红批注、鼠尾草绿掌握色。
禁止：紫色渐变、通用 SaaS 蓝紫风、Inter/Roboto/Arial 字体、圆角过大（>16px）的胶囊卡片堆叠。

导航（hash 路由）：

| hash | 名称 | 说明 |
|---|---|---|
| `#/dashboard` | 总览 | 今日复习、数据概览、薄弱知识点、最近错题 |
| `#/book` | 错题本 | 筛选、搜索、卡片列表、详情抽屉、编辑/删除 |
| `#/add` | 录入错题 | 拍照/粘贴/文本输入 → AI 识别解答打标 → 确认入库 |
| `#/practice` | 举一反三 | 变式题训练、自评、掌握度更新、练习总结 |
| `#/paper` | 组卷打印 | 筛题/勾选、A4 试卷预览、打印（含答案页） |
| `#/mastery` | 掌握度 | 掌握分布、学科/知识点掌握、复习预测、学习轨迹 |
| `#/settings` | 设置 | AI 服务配置、连接测试、数据导出 |

侧栏另有「今日待复习」角标与 AI 状态（演示模式/已连接）。

## 2. 文件所有权

| 文件 | 负责人 |
|---|---|
| `server/**`, `data/seed.json` | backend |
| `public/index.html`, `public/css/base.css`, `public/js/app.js`, `api.js`, `ui.js`, `icons.js`, `views/add.js`, `views/settings.js`, `css/add.css`, `css/settings.css` | lead |
| `public/views/dashboard.js`, `book.js`, `css/dashboard.css`, `css/book.css` | views-core |
| `public/js/views/practice.js`, `paper.js`, `mastery.js`, `css/practice.css`, `paper.css`, `mastery.css` | views-practice |
| `README.md`, 最终联调 | lead |

其他文件只读。需要新增共享能力时先告知 Lead，不要私自改 `ui.js` / `base.css`。

## 3. 数据模型

```ts
type Result = 'mastered' | 'fuzzy' | 'failed';

interface Variant {
  id: string;
  text: string;
  answer: string;
  analysis: string;
  hint: string;
  point?: string;          // 该变式针对的知识点
}

interface MasteryAssessment {
  point: string;           // 知识点
  level: '未掌握' | '薄弱' | '基本掌握' | '熟练';
  evidence: string;        // 学生解题步骤中的证据
  gap: string;             // 具体知识缺口
  microLesson: string;     // 针对缺口的 2-4 句微型讲解
}

interface Attempt {
  id: string;
  variantId: string | null;
  result: Result;
  at: string; // ISO
}

interface KnowledgeGuide {
  point: string;           // 知识点名
  concept: string;         // 课本概念/定理的通俗复述
  keyPoints: string[];     // 必须掌握的 2-4 条要点
  pitfalls: string[];      // 常见陷阱 1-3 条
  checklist: string[];     // 自检清单 2-3 条（能复述/能套用/能辨析）
}

interface Question {
  id: string;              // q_xxx
  text: string;            // 题干（可含换行）
  answer: string;          // 最终答案
  analysis: string;        // 分步解析
  commonMistakes: string[];// 易错点
  errorType: string;       // 错因类型：概念不清/审题失误/计算失误/方法不当/迁移不足/表达不规范/其他
  errorReason: string;     // 错因剖析（结合题目具体步骤，2-4 句）
  remedy: string;          // 掌握指导：补概念→重做→变式→复盘的 3-5 步行动建议
  knowledgeGuide: KnowledgeGuide[]; // 每个核心知识点一条
  knowledgePoints: string[];
  studentWork: string;     // 学生自己的解题过程 / 错答 / 卡点
  masteryAssessment: MasteryAssessment[]; // 逐知识点掌握评估
  targetedAdvice: string;  // 针对该学生的下一步行动建议
  difficulty: 1 | 2 | 3 | 4 | 5;
  mastery: number;         // 0-100
  status: 'new' | 'learning' | 'mastered';
  subject: string;         // 数学/物理/化学/英语/语文/生物/历史/地理/政治
  grade: string;           // 高一/高二/高三
  source: string;          // 来源，如「期中卷 · 第 12 题」
  imageUrl: string | null; // /uploads/xxx.jpg
  starred: boolean;
  notes: string;
  variants: Variant[];
  attempts: Attempt[];
  reviewCount: number;
  createdAt: string;
  updatedAt: string;
  nextReviewAt: string;
}
```

`status` 由服务端根据 mastery/attempts 推导，但允许通过 PATCH 手动传 `status`。mastery 规则（服务端统一执行）：
- 新建：20 分，status=new
- 自评 `mastered`：+16；`fuzzy`：+4；`failed`：-8；限制 0-100
- mastery >= 80 且掌握型自评 >= 1 次 → status=mastered；mastery 20-79 → learning；否则 new
- 每次自评 `reviewCount++`，按 mastery 计算 `nextReviewAt`（间隔 1/2/4/7/15/30 天）

## 4. HTTP API

统一返回 JSON；错误 `{ "error": "中文错误信息" }`，HTTP 4xx/5xx。
`Content-Type: application/json`，请求体上限 20MB（图片）。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | `{ok:true, ai:{mode:'live'|'demo', model, provider}}` |
| GET | `/api/bootstrap` | `{settings:{name, ai:{mode, model, baseUrl, hasKey, visionModel}}, meta:{subjects, grades, difficulties, sources?}}` |
| GET | `/api/stats` | 见下方 Stats |
| GET | `/api/questions` | query: `subject,status,difficulty,tag,q,starred,due,sort,limit`，返回 `{items:[Question], total}` |
| GET | `/api/questions/:id` | `{question}` |
| POST | `/api/questions` | body: `{text,answer,analysis,commonMistakes,errorType,errorReason,remedy,knowledgeGuide,knowledgePoints,studentWork,masteryAssessment,targetedAdvice,difficulty,subject,grade,source,notes,variants,imageDataUrl,aiMeta}` → `{question}` |
| PATCH | `/api/questions/:id` | 任意 Question 字段，返回 `{question}` |
| DELETE | `/api/questions/:id` | `{ok:true}` |
| POST | `/api/questions/:id/attempts` | `{variantId?, result}` → `{question, delta, statusChanged}` |
| POST | `/api/questions/:id/variants` | `{count?}` 调 AI 补充变式题 → `{question, variants}`（失败返回 502 + error） |
| GET | `/api/practice/queue` | query `mode=due|weak|random|subject&count=8&subject=` → `{items:[{questionId, questionText, subject, mastery, variant:Variant|null}], mode}` |
| POST | `/api/analyze` | `{text?, imageDataUrl?, studentWork?, subject?, grade?}` → `{analysis: Analysis, meta:{engine:'live'|'demo', model, ms}}` |
| POST | `/api/ai/test` | `{ok, message, latency, engine}`（无 key 时 ok=false 但返回演示模式说明） |
| GET | `/api/settings` | 脱敏：apiKey 返回 `hasKey`，不回传明文 |
| PUT | `/api/settings` | `{name?, ai?:{baseUrl?,model?,visionModel?,apiKey?,clearKey?}}` → 更新后的脱敏 settings |
| GET | `/api/export` | 完整数据 `{exportedAt, questions, settings(不含 key)}`，Content-Disposition attachment |

`Analysis` 结构：
```ts
{
  recognizedText: string;
  subject: string;
  grade: string;
  knowledgePoints: string[];
  difficulty: 1|2|3|4|5;
  difficultyReason: string;
  answer: string;
  analysis: string;
  commonMistakes: string[];
  studentWork: string;
  masteryAssessment: MasteryAssessment[];
  targetedAdvice: string;
  errorType: string;
  errorReason: string;
  remedy: string;
  knowledgeGuide: KnowledgeGuide[]; // 与 knowledgePoints 对齐，至少 1 条
  variants: Variant[]; // 2 条，id 由服务端补
  engine: 'live' | 'demo';
}
```

`Stats`：
```ts
{
  totals: { questions, due, mastered, learning, new:number, avgMastery, weeklyAdded, weeklyReviews, streak },
  masteryBuckets: [{key,label,count}],           // 四档
  subjects: [{subject,total,mastered,avgMastery}],
  knowledge: [{tag,subject,total,avgMastery,failed}],
  errorTypes: [{type,count}],                    // 错因分布，按 count 降序
  activity: [{date:'MM-DD',added,reviewed}],     // 近 14 天
  forecast: [{date:'MM-DD',count}],              // 未来 7 天
  recent: Question[],                            // 最近 6 条
  due: Question[],                               // 待复习最多 6 条
  last7: [{date, count}]
}
```

## 5. 前端模块契约

`public/index.html` 提供：
```html
<div id="app">
  <aside id="sidebar">…shell…</aside>
  <main id="main">
    <header id="topbar">…</header>
    <div id="view"></div>
  </main>
</div>
<div id="overlay-root"></div>
<div id="toast-root"></div>
```

路由 `app.js`：`location.hash` → 动态 `import('./views/<name>.js')` → `view.mount(document.getElementById('view'), ctx)`。
每个视图模块必须：
```js
export async function mount(root, ctx) { /* 渲染并绑定 */ }
export function destroy() { /* 可选：清理定时器/监听 */ }
```
`ctx`：
```js
{
  navigate(hash),              // 如 ctx.navigate('#/book')
  toast(msg, type),            // type: 'success'|'error'|'info'
  confirm({title, message, confirmText, danger}) -> Promise<boolean>,
  refreshShell(),              // 刷新侧栏角标/AI 状态
  openQuestion(id),            // 打开全局错题详情抽屉（book 视图提供）
  state,                       // {settings, meta, stats}
  onCleanup(fn)                // 注册视图卸载回调
}
```

`ui.js` 必须导出（实现由 Lead 提供，view 直接 import）：
```js
export const $, $$;                    // querySelector helpers, scoped 可选
export function escapeHtml(s);
export function icon(name, size=18);   // 名称见 icons.js: dashboard,book,plus,practice,paper,mastery,settings,search,camera,image,spark,check,x,trash,edit,print,star,arrow-right,arrow-left,clock,flame,chevron-down,refresh,download,eye,filter,more,alert,circle-check,layers,target
export function fmtDate(iso, style='short'); // '2026-11-04' | 'short' -> '11月4日' | 'rel' -> '3天前'
export function fmtRelative(iso);
export function masteryLabel(v);       // {label, tone} tone: new|low|mid|high
export function difficultyLabel(n);    // 1..5
export function subjectClass(subject); // 返回 css class 后缀 math/physics/...
export function toast(msg, type);      // 全局
export function openDrawer({title, subtitle, body, footer, width}); // 返回 {close, root}
export function closeDrawer();
export function openModal({title, body, actions, width}); // actions:[{label,type,onClick,close}]
export function confirmDialog(opts);   // Promise<boolean>
export function debounce(fn, ms);
export function emptyState({iconName,title,desc,actionLabel,onAction});
export function loadingBlock(text);
export function mountSparkline(el, values, opts); // 可选
export function ring(value, size=64, stroke=5); // 返回 SVG 字符串
```

`api.js` 必须导出：
```js
export const api = {
  get(path), post(path, body), patch(path, body), del(path),
  bootstrap(), stats(), questions(params), question(id),
  createQuestion(data), updateQuestion(id, data), deleteQuestion(id),
  attempt(id, data), generateVariants(id, count),
  analyze(data), testAI(), settings(), updateSettings(data),
  practiceQueue(params), exportUrl
};
```

### 5.1 练习册导出模块 `public/js/exporter.js`（Lead 提供，views-practice 直接 import）

支持把一组题目导出为 **A4 图片（PNG）或 PDF**（PDF 内嵌 JPEG 页面，无需任何第三方库，中文正常显示）。供「举一反三」练习册与「组卷」导出使用。

```js
import { exportQuestionSet } from '../exporter.js';
await exportQuestionSet({
  title: '知错 · 举一反三练习册',
  subtitle: '知识点：二次函数最值 · 2026-11-04',
  questions: [{ text, answer, analysis, knowledgePoints, subject, difficulty }],
  includeAnswers: true,     // 是否附答案与解析页
  includeGuide: true,       // 答案页附「掌握指南」要点
  format: 'pdf' | 'png',    // png 多页时逐页下载
  filename: '知错-举一反三-二次函数',
});
// 返回 {pages:number, format}; 失败 throw Error，请 toast 提示
```
`exporter.js` 内会用 canvas 按 150dpi A4（1240×1754）绘制：页眉标题/副标题/姓名栏、编号题目、答题留白、答案页、页码；PDF 采用最小 PDF 结构封装的 JPEG 图像页。视图只负责组装 `questions` 和交互，不要自行实现 canvas/PDF。

## 6. 设计系统（base.css 提供，view 只能用这些 token/类）

```css
:root{
  --paper:#F3EDE0; --paper-2:#FBF7EC; --paper-3:#E9E1D0;
  --ink:#1E2533; --ink-2:#454C5C; --ink-3:#7C7C72;
  --red:#C94B36; --red-deep:#A33A28; --red-soft:#F3DCD5;
  --sage:#4E7C6A; --sage-soft:#DEE9E1;
  --gold:#C79A4B; --gold-soft:#F1E5CC;
  --blue:#3E5C76; --blue-soft:#DCE4EA;
  --line:#D8CEBC; --line-strong:#B9AD97;
  --shadow-sm:2px 2px 0 rgba(30,37,51,.10);
  --shadow:4px 4px 0 rgba(30,37,51,.12);
  --shadow-lg:8px 10px 0 rgba(30,37,51,.10);
  --radius:10px; --radius-sm:6px;
  --font-display:"Songti SC","STSong","Noto Serif CJK SC","Source Han Serif SC",serif;
  --font-body:"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif;
  --font-mono:"Cascadia Code","JetBrains Mono","Consolas",monospace;
}
```
通用类：
- 布局：`.page`, `.page-head`, `.page-title`, `.page-kicker`, `.page-sub`, `.grid`, `.row`, `.between`, `.gap-*`
- 卡片：`.card`, `.card-pad`, `.card-head`, `.paper-card`, `.tape`（胶带装饰）
- 按钮：`.btn`, `.btn-primary`（墨色）, `.btn-red`, `.btn-ghost`, `.btn-line`, `.btn-sm`, `.btn-icon`, `.btn:disabled`
- 表单：`.field`, `.label`, `.input`, `.textarea`, `.select`, `.segmented`, `.segmented button.active`, `.switch`
- 标签：`.tag`, `.tag-red`, `.tag-sage`, `.tag-gold`, `.tag-blue`, `.tag-muted`, `.chip`, `.chip.active`
- 难度：`.diff-dots`（内部 `<i class="on">`）
- 掌握：`.mastery-bar`（内 `.mastery-bar > i` 宽度 %）、`.mastery-num`
- 空状态：`.empty`
- 通用：`.mono`, `.muted`, `.small`, `.divider`, `.badge`, `.kbd`, `.stamp`（朱砂印章旋转）
- 抽屉/弹窗/toast 由 ui.js 生成，类名 `.drawer-*`, `.modal-*`, `.toast-*` 已含在 base.css。
- 页面进入动画：`.page` 自动 fade-up；不要重复定义。

响应式：≥1180 三列/侧栏固定 236px；768-1180 两列；<768 侧栏变为底部 tab（base.css 处理），视图内 grid 自行折叠。

## 7. 质量要求

- 所有用户可见文案中文；空状态、加载态、错误态齐全。
- 所有渲染进 innerHTML 的用户数据必须 `escapeHtml`；事件用 addEventListener，不使用内联 onclick。
- 图表用内联 SVG / CSS，不引外部 CDN、不加载外部字体/图片。
- 打印：`@media print` 只显示 `.print-sheet`；组卷页负责。
- 不写 `alert/confirm` 原生弹窗，用 `ui.confirmDialog`。
- 每个视图在 `mount` 中自行拉取所需数据；失败时展示可重试错误块，不白屏。
- 提交前用 `node --check` 检查每个 JS 文件。
- 种子数据 14 道左右真实、答案正确的高中错题，覆盖 5 个学科、不同难度/掌握度/日期，确保总览图表有内容。

## 8. 本地运行

```powershell
$node = 'C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
& $node server/index.mjs   # http://127.0.0.1:8787
```

演示模式：未配置 AI key 时 `/api/analyze` 返回 `engine:'demo'` 的可用分析（明确标注示例），配置后走 OpenAI 兼容接口。
