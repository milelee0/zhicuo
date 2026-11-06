package com.zhicuo.app.ai

import android.util.Base64
import com.zhicuo.app.data.AiSettings
import com.zhicuo.app.data.Analysis
import com.zhicuo.app.data.Assessment
import com.zhicuo.app.data.Guide
import com.zhicuo.app.data.Variant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

object AiAnalyzer {
    private val SYSTEM_PROMPT = """
你是「知错」智能错题本的高中教研助手。请识别题目、完整解答、诊断错因、评估知识掌握、给出课本掌握指南，并生成变式题。
必须只输出一个 JSON 对象，不要 markdown 代码围栏，不要多余说明。字段：
{
 "recognizedText": "题干文字",
 "subject": "数学/物理/化学/英语/语文/生物/历史/地理/政治 之一",
 "grade": "高一/高二/高三 之一",
 "knowledgePoints": ["知识点"],
 "difficulty": 1-5,
 "difficultyReason": "难度理由",
 "answer": "最终答案",
 "analysis": "分步解析",
 "commonMistakes": ["易错点"],
 "errorType": "概念不清/审题失误/计算失误/方法不当/迁移不足/表达不规范/其他 之一",
 "errorReason": "结合学生步骤的错因剖析",
 "remedy": "3-5 步掌握指导",
 "studentWork": "学生解题过程（若提供）",
 "masteryAssessment": [{"point":"知识点","level":"未掌握/薄弱/基本掌握/熟练","evidence":"学生步骤中的证据","gap":"知识缺口","microLesson":"2-4句微型讲解"}],
 "targetedAdvice": "下一步针对性建议",
 "knowledgeGuide": [{"point":"知识点","concept":"概念复述","keyPoints":["要点"],"pitfalls":["陷阱"],"checklist":["自检"]}],
 "variants": [{"text":"变式题","answer":"答案","analysis":"解析","hint":"提示","point":"针对知识点"}]
}
要求：若图片中有学生手写过程，先识别并据此判断错在哪一步；不要只给标准答案。knowledgeGuide 至少 1 条，masteryAssessment 至少 1 条，variants 2 条。
""".trimIndent()

    suspend fun analyze(
        settings: AiSettings,
        text: String,
        studentWork: String,
        image: File?
    ): Analysis = withContext(Dispatchers.IO) {
        if (!settings.hasKey) {
            if (image != null) {
                throw IllegalStateException("还没配置 AI：拍照识别需要多模态模型。请到「设置」选择服务商并填写 API Key，例如通义千问 qwen-vl-max 或 OpenAI gpt-4o。")
            }
            return@withContext demoAnalysis(text, studentWork, settings)
        }
        liveAnalyze(settings, text, studentWork, image)
    }

    private fun liveAnalyze(
        settings: AiSettings,
        text: String,
        studentWork: String,
        image: File?
    ): Analysis {
        val url = resolveUrl(settings.baseUrl)
        val userText = buildString {
            append("请识别并解答下面这道高中题目。\n")
            if (text.isNotBlank()) append(text)
            if (studentWork.isNotBlank()) append("\n\n学生解题过程 / 错答 / 卡点：\n").append(studentWork)
            if (image != null) append("\n\n（题目在学生拍摄的图片中，请先识别题干与手写过程。）")
        }
        val messages = JSONArray()
        messages.put(JSONObject().put("role", "system").put("content", SYSTEM_PROMPT))
        val userContent: Any = if (image != null) {
            JSONArray().apply {
                put(JSONObject().put("type", "text").put("text", userText))
                put(
                    JSONObject().put("type", "image_url").put(
                        "image_url",
                        JSONObject().put("url", imageDataUrl(image))
                    )
                )
            }
        } else userText
        messages.put(JSONObject().put("role", "user").put("content", userContent))

        val body = JSONObject().apply {
            put("model", settings.model)
            put("messages", messages)
            put("temperature", 0.2)
            put("max_tokens", 4000)
        }

        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 90_000
            readTimeout = 90_000
            doOutput = true
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("Authorization", "Bearer ${settings.apiKey}")
        }
        try {
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val raw = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            if (status !in 200..299) {
                val friendly = runCatching {
                    JSONObject(raw).optJSONObject("error")?.optString("message")
                }.getOrNull()
                throw IllegalStateException(
                    "AI 接口返回 $status：${friendly?.takeIf { it.isNotBlank() } ?: raw.take(300)}"
                )
            }
            val response = JSONObject(raw)
            val content = response.optJSONArray("choices")
                ?.optJSONObject(0)
                ?.optJSONObject("message")
                ?.optString("content")
                ?: throw IllegalStateException("AI 返回内容为空")
            val json = extractJson(content)
            return parseAnalysis(json, text, studentWork)
        } finally {
            connection.disconnect()
        }
    }

    private fun resolveUrl(baseUrl: String): String {
        var base = baseUrl.trim().trimEnd('/')
        if (base.isBlank()) base = "https://api.deepseek.com/v1"
        if (base.endsWith("/chat/completions")) return base
        if (base.endsWith("/v1")) return "$base/chat/completions"
        return "$base/v1/chat/completions"
    }

    private fun imageDataUrl(file: File): String {
        val bytes = file.readBytes()
        return "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
    }

    private fun extractJson(content: String): JSONObject {
        var text = content.trim()
        if (text.startsWith("```")) {
            text = text.replace(Regex("^```[a-zA-Z]*\\s*"), "").replace(Regex("\\s*```$"), "")
        }
        val start = text.indexOf('{')
        val end = text.lastIndexOf('}')
        if (start < 0 || end <= start) throw IllegalStateException("AI 没有返回合法 JSON")
        return JSONObject(text.substring(start, end + 1))
    }

    private fun parseAnalysis(json: JSONObject, originalText: String, originalWork: String): Analysis {
        val variants = mutableListOf<Variant>()
        json.optJSONArray("variants")?.let { array ->
            for (i in 0 until array.length()) {
                val o = array.optJSONObject(i) ?: continue
                val text = o.optString("text").trim()
                if (text.isNotEmpty()) {
                    variants.add(
                        Variant(
                            id = com.zhicuo.app.data.newId("v"),
                            text = text,
                            answer = o.optString("answer"),
                            analysis = o.optString("analysis"),
                            hint = o.optString("hint"),
                            point = o.optString("point")
                        )
                    )
                }
            }
        }
        val guides = mutableListOf<Guide>()
        json.optJSONArray("knowledgeGuide")?.let { array ->
            for (i in 0 until array.length()) {
                array.optJSONObject(i)?.let { o ->
                    guides.add(
                        Guide(
                            point = o.optString("point"),
                            concept = o.optString("concept"),
                            keyPoints = o.optJSONArray("keyPoints").strings(),
                            pitfalls = o.optJSONArray("pitfalls").strings(),
                            checklist = o.optJSONArray("checklist").strings()
                        )
                    )
                }
            }
        }
        val assessments = mutableListOf<Assessment>()
        json.optJSONArray("masteryAssessment")?.let { array ->
            for (i in 0 until array.length()) {
                array.optJSONObject(i)?.let { o ->
                    assessments.add(
                        Assessment(
                            point = o.optString("point"),
                            level = o.optString("level", "薄弱"),
                            evidence = o.optString("evidence"),
                            gap = o.optString("gap"),
                            microLesson = o.optString("microLesson")
                        )
                    )
                }
            }
        }
        val points = json.optJSONArray("knowledgePoints").strings()
        return Analysis(
            recognizedText = json.optString("recognizedText").ifBlank { originalText },
            subject = json.optString("subject", "数学"),
            grade = json.optString("grade", "高一"),
            knowledgePoints = points,
            difficulty = json.optInt("difficulty", 3).coerceIn(1, 5),
            difficultyReason = json.optString("difficultyReason"),
            answer = json.optString("answer"),
            analysis = json.optString("analysis"),
            commonMistakes = json.optJSONArray("commonMistakes").strings(),
            errorType = json.optString("errorType", "其他"),
            errorReason = json.optString("errorReason"),
            remedy = json.optString("remedy"),
            knowledgeGuide = guides,
            studentWork = json.optString("studentWork").ifBlank { originalWork },
            masteryAssessment = assessments,
            targetedAdvice = json.optString("targetedAdvice"),
            variants = variants,
            engine = "live"
        )
    }

    private fun demoAnalysis(text: String, studentWork: String, settings: AiSettings): Analysis {
        val clean = text.trim()
        if (clean.length < 3) throw IllegalStateException("请先输入题目文字")
        val subject = when {
            Regex("函数|方程|不等式|数列|集合|几何|导数|概率").containsMatchIn(clean) -> "数学"
            Regex("速度|加速度|力|磁场|电场|动量|机械能").containsMatchIn(clean) -> "物理"
            Regex("化学|离子|mol|溶液|氧化|反应|元素").containsMatchIn(clean) -> "化学"
            Regex("英语|单词|语法|从句|时态|write|the ").containsMatchIn(clean) -> "英语"
            Regex("文言|古诗|阅读|作文|修辞|病句").containsMatchIn(clean) -> "语文"
            else -> "数学"
        }
        val point = when (subject) {
            "物理" -> "物理模型与公式"
            "化学" -> "化学基本概念"
            "英语" -> "语法与语境"
            "语文" -> "文本理解"
            else -> "核心知识点"
        }
        val difficulty = when {
            clean.length > 120 -> 4
            clean.length > 70 -> 3
            else -> 2
        }
        val answer = "【示例答案】演示模式不提供真实标准答案。\n请先判断题目考点「$point」，写出已知条件、所求量和限制条件，再按定义/公式逐步推导。"
        val analysis = "【示例解析】\n这是演示模式生成的示例解析，不是真实 AI 分析。\n" +
            "1. 审题：圈出已知、所求与限制条件；\n" +
            "2. 建模：把题目对应到「$point」的定义或公式；\n" +
            "3. 计算：保留关键中间步骤并检查单位/符号；\n" +
            "4. 复盘：回到题目条件检验结果是否合理。"
        val reason = if (studentWork.isNotBlank()) {
            "你写的是「${studentWork.take(80)}」。演示模式只能根据文字给出初步判断：可能卡在对「$point」的条件转化和步骤检验上。"
        } else {
            "未提供解题过程，演示模式仅能给出初步判断：建议补上你的思路，AI 才能定位具体错因。"
        }
        return Analysis(
            recognizedText = clean,
            subject = subject,
            grade = "高一",
            knowledgePoints = listOf(point),
            difficulty = difficulty,
            difficultyReason = "演示模式按题干长度与关键词估计",
            answer = answer,
            analysis = analysis,
            commonMistakes = listOf("只套公式不看条件", "计算跳步、符号出错"),
            errorType = "概念不清",
            errorReason = reason,
            remedy = "1. 回到课本复述「$point」的定义与适用条件；\n2. 遮住答案重做本题，写出每一步理由；\n3. 做 2 道同知识点变式题；\n4. 用一句话总结本题的关键判断。",
            knowledgeGuide = listOf(
                Guide(
                    point = point,
                    concept = "先明确「$point」的定义、公式和适用条件，再与题目条件对应。",
                    keyPoints = listOf("写全已知与所求", "先判断适用条件", "计算过程不跳步"),
                    pitfalls = listOf("忽略限制条件", "把相似公式混用"),
                    checklist = listOf("能复述定义吗？", "能说出适用条件吗？", "能独立重做本题吗？")
                )
            ),
            studentWork = studentWork,
            masteryAssessment = listOf(
                Assessment(
                    point = point,
                    level = "薄弱",
                    evidence = if (studentWork.isNotBlank()) "你的解题过程已记录" else "未提供解题过程，评估为初步判断",
                    gap = "条件转化与步骤检验不完整",
                    microLesson = "把题目条件逐条翻译成公式/不等式，再按「定义—代入—检验」三步走。"
                )
            ),
            targetedAdvice = "先补「$point」的概念与适用条件，再重做本题，最后完成 2 道变式题。\n配置 AI API Key 后可获得针对你解题步骤的真实分析。",
            variants = listOf(
                Variant(
                    id = com.zhicuo.app.data.newId("v"),
                    text = "【示例变式】围绕「$point」改一道同类题：把题目中的一个条件替换为相反或边界情况，重新求解并说明变化。",
                    answer = "略（演示模式）",
                    analysis = "先识别条件变化，再按原方法推导。",
                    hint = "先写清原题条件，再改一个条件。",
                    point = point
                )
            ),
            engine = "demo"
        )
    }
}

private fun JSONArray?.strings(): List<String> {
    if (this == null) return emptyList()
    val out = mutableListOf<String>()
    for (i in 0 until length()) {
        val v = optString(i).trim()
        if (v.isNotEmpty()) out.add(v)
    }
    return out
}
