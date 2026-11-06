# 知错 · Android 本地优先版（MVP 0.4.0）

这是 Android 原生 local-first 原型，目标：**错题、照片、练习记录全部存本机，AI 只在分析时调用大模型接口**。

## 当前能力（0.4.0）

- 首页：错题总数、待复习、已掌握、平均掌握度；今日复习与最近录入
- 错题本：本地搜索、学科筛选、卡片列表、收藏、详情
- 详情：题干/原图、我的解题过程、错因诊断、知识掌握评估、答案与解析、掌握指南、变式题、删除
- **录入（拍照为主）**：系统相机拍照 / 相册选图 → 自动上传给多模态模型 → 识别题干与手写作答 → 解答、错因诊断、知识点评估 → 一键保存；不需要手动输入题目和答案
- 举一反三：今日到期优先；变式题 / 原题；提示、查看答案、三档自评；自动更新掌握度和下次复习时间
- 设置：服务商预设（通义千问 / OpenAI / 智谱 GLM / Moonshot Kimi / DeepSeek / 自定义）、模型、API Key（只存本机）
- **导出 PDF**：全部错题 + 答案解析，A4 排版，可分享/打印
- **清空内置示例题**：只删 `q_001~q_014`，不影响自己拍的题
- 本地种子：首次启动从 assets 导入 14 道示例错题

## 技术结构

```
android/
├─ app/src/main/java/com/zhicuo/app/
│  ├─ MainActivity.kt        # Compose 外壳、底部导航、状态
│  ├─ data/Question.kt       # 题目/变式/指南/评估模型 + JSON 序列化
│  ├─ data/QuestionStore.kt  # SQLiteOpenHelper 本地存储 + 种子导入
│  ├─ data/Settings.kt       # AI 配置（SharedPreferences）
│  ├─ data/Providers.kt      # 服务商预设
│  ├─ ai/AiAnalyzer.kt       # OpenAI 兼容多模态接口 + 本地演示分析
│  ├─ ui/                    # Compose 页面与主题
│  └─ util/ImageUtils.kt     # 拍照/相册图片压缩与本地保存
│  └─ util/PdfExporter.kt    # 本地生成 A4 PDF（题目页 + 答案解析页）
├─ app/src/main/assets/seed.json
├─ app/build.gradle.kts
└─ gradlew / gradlew.bat
```

- 无 Room、无导航库、无网络库：SQLite + `org.json` + `HttpURLConnection`，依赖少、构建快。
- 照片：`filesDir/images/*.jpg`，数据库只存路径；相机临时文件在 `cacheDir/images`，由 FileProvider 共享。
- 数据：`filesDir/../databases/zhicuo.db`（SQLite）。
- AI Key：只存本机 SharedPreferences；不会上传到自建服务器。
- 照片只在本机；只有拍照识别那一刻会把图片临时发给所选 AI 服务商。

## 构建

环境：JDK 17、Android SDK（compileSdk 35）、Node 不需要。

```powershell
cd android
$env:JAVA_HOME='C:\Program Files\Microsoft\jdk-17.0.21.21-hotspot'
.\gradlew.bat :app:assembleDebug
```

APK：

```
android/app/build/outputs/apk/debug/app-debug.apk
```

安装到手机（开启 USB 调试）：

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r app\build\outputs\apk\debug\app-debug.apk
```

也可以把 APK 发到手机，用文件管理器安装（需允许安装未知来源）。

## 手机试用步骤

1. 安装 `zhicuo-android-0.4.0.apk`（首次需允许「安装未知应用」）。
2. 打开 App，先看内置 14 道示例题，熟悉错题本 / 详情 / 练习。
3. 进「设置」→ 选服务商（推荐 **通义千问**，国内直连）→ 选 `qwen-vl-max` → 粘贴 API Key → 保存。
4. 进「录入」→「拍照」，把题干和你的手写作答一起拍进去 → 等 AI 识别 → 检查结果 → 保存到错题本。
5. 在「练习」里做变式题，三档自评（已掌握 / 有点模糊 / 还是不会），掌握度和下次复习时间会自动更新。
6. 「设置」→「导出全部错题 PDF」，可分享到微信/打印。
7. 不想看示例题时，「设置」→「清空内置示例题」。

## 配置 AI

打开 App →「设置」：

- 选择服务商：通义千问 / OpenAI / 智谱 GLM / Moonshot Kimi / DeepSeek / 自定义
- 选择模型：如 `qwen-vl-max`、`gpt-4o`、`glm-4v-plus`
- 填 API Key（只存本机）
- **文字和拍照共用一个多模态模型**，不需要分别填文本/视觉模型
- DeepSeek 文本模型不支持图片；拍照识别请选通义/OpenAI/智谱

没有 Key 时仍可浏览示例题、练习、导出 PDF；拍照识别会提示先配置多模态模型。

## 当前限制 / 下一阶段

1. **已在 Android 15 模拟器验证**启动、错题本/详情、拍照录入、AI 请求链路（假 Key 返回 401 的错误提示）、PDF 导出、练习自评与清空示例，见 `docs/android-runtime-check.md`；真机请重点测试拍照、相册、真实 AI 识别。
2. 已支持导出全部错题 PDF；暂无按条件勾选组卷、复习通知、桌面小组件。
3. 无多端同步；换机需后续做备份/导入（JSON 导出）。
4. AI 返回内容可能存在错误，入库前请在详情里核对。
5. 单题单图；一页多题需要分多次拍。
6. 在线下载：[GitHub Release](https://github.com/milelee0/zhicuo/releases/download/v0.4.0/zhicuo-android-0.4.0.apk) ｜ Cloudflare <https://zhicuo.tseril.xyz/downloads/zhicuo-android-0.4.0.apk>（均无需登录）。

## 后续计划

- 真机反馈修复
- 按条件勾选组卷、备份/导入
- 复习通知（WorkManager）
- 知识点本地索引（SQLite FTS5）与知识图谱版本更新
- 可选：云同步/多端（仅在你确认需要后）
