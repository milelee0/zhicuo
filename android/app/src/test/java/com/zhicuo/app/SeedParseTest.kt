package com.zhicuo.app

import com.zhicuo.app.data.Question
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class SeedParseTest {
    @Test
    fun seedJsonParsesAllQuestions() {
        val file = File("src/main/assets/seed.json")
        assertTrue("seed.json 不存在：${file.absolutePath}", file.exists())
        val root = JSONObject(file.readText(Charsets.UTF_8))
        val array = root.getJSONArray("questions")
        assertEquals(14, array.length())
        var withVariants = 0
        var withGuide = 0
        for (i in 0 until array.length()) {
            val q = Question.fromJson(array.getJSONObject(i))
            assertTrue("题干为空: $i", q.text.isNotBlank())
            assertTrue("答案为空: $i", q.answer.isNotBlank())
            assertTrue("知识点为空: $i", q.knowledgePoints.isNotEmpty())
            if (q.variants.isNotEmpty()) withVariants++
            if (q.knowledgeGuide.isNotEmpty()) withGuide++
        }
        assertTrue("至少一半题目应有变式题", withVariants >= 7)
        assertTrue("至少一半题目应有掌握指南", withGuide >= 7)
    }

    @Test
    fun questionRoundTripKeepsCoreFields() {
        val file = File("src/main/assets/seed.json")
        val array = JSONObject(file.readText(Charsets.UTF_8)).getJSONArray("questions")
        val original = Question.fromJson(array.getJSONObject(0))
        val restored = Question.fromJson(original.toJson())
        assertEquals(original.id, restored.id)
        assertEquals(original.text, restored.text)
        assertEquals(original.knowledgePoints, restored.knowledgePoints)
        assertEquals(original.mastery, restored.mastery)
        assertEquals(original.variants.size, restored.variants.size)
        assertEquals(original.masteryAssessment.size, restored.masteryAssessment.size)
    }
}
