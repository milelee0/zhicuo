package com.zhicuo.app.data

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

data class Variant(
    val id: String,
    val text: String,
    val answer: String,
    val analysis: String,
    val hint: String,
    val point: String = ""
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("text", text)
        put("answer", answer)
        put("analysis", analysis)
        put("hint", hint)
        put("point", point)
    }

    companion object {
        fun fromJson(o: JSONObject): Variant = Variant(
            id = o.optString("id").ifBlank { newId("v") },
            text = o.optString("text"),
            answer = o.optString("answer"),
            analysis = o.optString("analysis"),
            hint = o.optString("hint"),
            point = o.optString("point")
        )
    }
}

data class Guide(
    val point: String,
    val concept: String,
    val keyPoints: List<String>,
    val pitfalls: List<String>,
    val checklist: List<String>
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("point", point)
        put("concept", concept)
        put("keyPoints", keyPoints.toJsonArray())
        put("pitfalls", pitfalls.toJsonArray())
        put("checklist", checklist.toJsonArray())
    }

    companion object {
        fun fromJson(o: JSONObject): Guide = Guide(
            point = o.optString("point"),
            concept = o.optString("concept"),
            keyPoints = o.optJSONArray("keyPoints").strings(),
            pitfalls = o.optJSONArray("pitfalls").strings(),
            checklist = o.optJSONArray("checklist").strings()
        )
    }
}

data class Assessment(
    val point: String,
    val level: String,
    val evidence: String,
    val gap: String,
    val microLesson: String
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("point", point)
        put("level", level)
        put("evidence", evidence)
        put("gap", gap)
        put("microLesson", microLesson)
    }

    companion object {
        fun fromJson(o: JSONObject): Assessment = Assessment(
            point = o.optString("point"),
            level = o.optString("level", "薄弱"),
            evidence = o.optString("evidence"),
            gap = o.optString("gap"),
            microLesson = o.optString("microLesson")
        )
    }
}

data class Attempt(
    val id: String,
    val variantId: String?,
    val result: String,
    val at: String
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("variantId", variantId ?: JSONObject.NULL)
        put("result", result)
        put("at", at)
    }

    companion object {
        fun fromJson(o: JSONObject): Attempt = Attempt(
            id = o.optString("id").ifBlank { newId("a") },
            variantId = if (o.isNull("variantId")) null else o.optString("variantId"),
            result = o.optString("result", "fuzzy"),
            at = o.optString("at", Instant.now().toString())
        )
    }
}

data class Question(
    val id: String,
    val text: String,
    val answer: String,
    val analysis: String,
    val commonMistakes: List<String> = emptyList(),
    val errorType: String = "其他",
    val errorReason: String = "",
    val remedy: String = "",
    val knowledgeGuide: List<Guide> = emptyList(),
    val knowledgePoints: List<String> = emptyList(),
    val studentWork: String = "",
    val masteryAssessment: List<Assessment> = emptyList(),
    val targetedAdvice: String = "",
    val difficulty: Int = 3,
    val mastery: Int = 20,
    val status: String = "new",
    val subject: String = "数学",
    val grade: String = "高一",
    val source: String = "手动录入",
    val imagePath: String? = null,
    val starred: Boolean = false,
    val notes: String = "",
    val variants: List<Variant> = emptyList(),
    val attempts: List<Attempt> = emptyList(),
    val reviewCount: Int = 0,
    val createdAt: String = Instant.now().toString(),
    val updatedAt: String = Instant.now().toString(),
    val nextReviewAt: String = nextReviewFrom(20)
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("text", text)
        put("answer", answer)
        put("analysis", analysis)
        put("commonMistakes", commonMistakes.toJsonArray())
        put("errorType", errorType)
        put("errorReason", errorReason)
        put("remedy", remedy)
        put("knowledgeGuide", JSONArray().also { a -> knowledgeGuide.forEach { a.put(it.toJson()) } })
        put("knowledgePoints", knowledgePoints.toJsonArray())
        put("studentWork", studentWork)
        put("masteryAssessment", JSONArray().also { a -> masteryAssessment.forEach { a.put(it.toJson()) } })
        put("targetedAdvice", targetedAdvice)
        put("difficulty", difficulty)
        put("mastery", mastery)
        put("status", status)
        put("subject", subject)
        put("grade", grade)
        put("source", source)
        put("imageUrl", imagePath ?: JSONObject.NULL)
        put("starred", starred)
        put("notes", notes)
        put("variants", JSONArray().also { a -> variants.forEach { a.put(it.toJson()) } })
        put("attempts", JSONArray().also { a -> attempts.forEach { a.put(it.toJson()) } })
        put("reviewCount", reviewCount)
        put("createdAt", createdAt)
        put("updatedAt", updatedAt)
        put("nextReviewAt", nextReviewAt)
    }

    fun masteryLabel(): String = when {
        mastery >= 80 -> "已掌握"
        mastery >= 55 -> "较熟练"
        mastery >= 30 -> "薄弱"
        else -> "未掌握"
    }

    fun dueNow(): Boolean = status != "mastered" && runCatching {
        Instant.parse(nextReviewAt).isBefore(Instant.now())
    }.getOrDefault(false)

    companion object {
        fun fromJson(o: JSONObject): Question {
            val image = if (o.isNull("imageUrl")) null else o.optString("imageUrl").ifBlank { null }
            return Question(
                id = o.optString("id").ifBlank { newId("q") },
                text = o.optString("text"),
                answer = o.optString("answer"),
                analysis = o.optString("analysis"),
                commonMistakes = o.optJSONArray("commonMistakes").strings(),
                errorType = o.optString("errorType", "其他"),
                errorReason = o.optString("errorReason"),
                remedy = o.optString("remedy"),
                knowledgeGuide = o.optJSONArray("knowledgeGuide").objects { Guide.fromJson(it) },
                knowledgePoints = o.optJSONArray("knowledgePoints").strings(),
                studentWork = o.optString("studentWork"),
                masteryAssessment = o.optJSONArray("masteryAssessment").objects { Assessment.fromJson(it) },
                targetedAdvice = o.optString("targetedAdvice"),
                difficulty = o.optInt("difficulty", 3).coerceIn(1, 5),
                mastery = o.optInt("mastery", 20).coerceIn(0, 100),
                status = o.optString("status", "new"),
                subject = o.optString("subject", "数学"),
                grade = o.optString("grade", "高一"),
                source = o.optString("source", "手动录入"),
                imagePath = image,
                starred = o.optBoolean("starred"),
                notes = o.optString("notes"),
                variants = o.optJSONArray("variants").objects { Variant.fromJson(it) },
                attempts = o.optJSONArray("attempts").objects { Attempt.fromJson(it) },
                reviewCount = o.optInt("reviewCount"),
                createdAt = o.optString("createdAt", Instant.now().toString()),
                updatedAt = o.optString("updatedAt", Instant.now().toString()),
                nextReviewAt = o.optString("nextReviewAt", nextReviewFrom(20))
            )
        }
    }
}

data class Analysis(
    val recognizedText: String,
    val subject: String,
    val grade: String,
    val knowledgePoints: List<String>,
    val difficulty: Int,
    val difficultyReason: String,
    val answer: String,
    val analysis: String,
    val commonMistakes: List<String>,
    val errorType: String,
    val errorReason: String,
    val remedy: String,
    val knowledgeGuide: List<Guide>,
    val studentWork: String,
    val masteryAssessment: List<Assessment>,
    val targetedAdvice: String,
    val variants: List<Variant>,
    val engine: String = "demo"
) {
    fun toQuestion(imagePath: String?): Question = Question(
        id = newId("q"),
        text = recognizedText.ifBlank { "" },
        answer = answer,
        analysis = analysis,
        commonMistakes = commonMistakes,
        errorType = errorType,
        errorReason = errorReason,
        remedy = remedy,
        knowledgeGuide = knowledgeGuide,
        knowledgePoints = knowledgePoints,
        studentWork = studentWork,
        masteryAssessment = masteryAssessment,
        targetedAdvice = targetedAdvice,
        difficulty = difficulty,
        mastery = 20,
        status = "new",
        subject = subject,
        grade = grade,
        imagePath = imagePath,
        variants = variants,
        nextReviewAt = nextReviewFrom(20)
    )
}

fun newId(prefix: String): String = "${prefix}_${System.currentTimeMillis().toString(36)}${UUID.randomUUID().toString().take(6)}"

fun nextReviewFrom(mastery: Int): String {
    val days = when {
        mastery >= 95 -> 30L
        mastery >= 80 -> 15L
        mastery >= 60 -> 7L
        mastery >= 40 -> 4L
        mastery >= 20 -> 2L
        else -> 1L
    }
    return Instant.now().plus(days, ChronoUnit.DAYS).toString()
}

fun deriveStatus(mastery: Int, attempts: List<Attempt>): String {
    if (mastery >= 80 && attempts.any { it.result == "mastered" }) return "mastered"
    return if (mastery >= 20) "learning" else "new"
}

private fun List<String>.toJsonArray(): JSONArray = JSONArray().also { a -> forEach { a.put(it) } }

private fun JSONArray?.strings(): List<String> {
    if (this == null) return emptyList()
    val out = mutableListOf<String>()
    for (i in 0 until length()) {
        val value = optString(i).trim()
        if (value.isNotEmpty()) out.add(value)
    }
    return out
}

private fun <T> JSONArray?.objects(transform: (JSONObject) -> T): List<T> {
    if (this == null) return emptyList()
    val out = mutableListOf<T>()
    for (i in 0 until length()) {
        optJSONObject(i)?.let { out.add(transform(it)) }
    }
    return out
}
