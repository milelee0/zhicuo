package com.zhicuo.app.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONObject
import java.time.Instant

class QuestionStore(context: Context) : SQLiteOpenHelper(context, "zhicuo.db", null, 1) {
    private val appContext = context.applicationContext

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE questions (" +
                "id TEXT PRIMARY KEY, " +
                "data TEXT NOT NULL, " +
                "updated_at TEXT NOT NULL)"
        )
        seedFromAssets(db)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        db.execSQL("DROP TABLE IF EXISTS questions")
        onCreate(db)
    }

    private fun seedFromAssets(db: SQLiteDatabase) {
        val raw = runCatching {
            appContext.assets.open("seed.json").bufferedReader(Charsets.UTF_8).use { it.readText() }
        }.getOrNull() ?: return
        val root = runCatching { JSONObject(raw) }.getOrNull() ?: return
        val list = root.optJSONArray("questions") ?: return
        db.beginTransaction()
        try {
            for (i in 0 until list.length()) {
                val obj = list.optJSONObject(i) ?: continue
                val question = Question.fromJson(obj)
                if (question.text.isBlank()) continue
                db.insertWithOnConflict("questions", null, valuesOf(question), SQLiteDatabase.CONFLICT_REPLACE)
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    private fun valuesOf(question: Question): ContentValues = ContentValues().apply {
        put("id", question.id)
        put("data", question.toJson().toString())
        put("updated_at", question.updatedAt)
    }

    fun all(): List<Question> {
        val out = mutableListOf<Question>()
        readableDatabase.query(
            "questions", arrayOf("data"), null, null, null, null, "updated_at DESC"
        ).use { cursor ->
            while (cursor.moveToNext()) {
                runCatching { Question.fromJson(JSONObject(cursor.getString(0))) }
                    .getOrNull()?.let { out.add(it) }
            }
        }
        return out
    }

    fun get(id: String): Question? {
        readableDatabase.query(
            "questions", arrayOf("data"), "id = ?", arrayOf(id), null, null, null
        ).use { cursor ->
            if (cursor.moveToFirst()) {
                return runCatching { Question.fromJson(JSONObject(cursor.getString(0))) }.getOrNull()
            }
        }
        return null
    }

    fun upsert(question: Question) {
        writableDatabase.insertWithOnConflict(
            "questions", null, valuesOf(question), SQLiteDatabase.CONFLICT_REPLACE
        )
    }

    fun delete(id: String) {
        writableDatabase.delete("questions", "id = ?", arrayOf(id))
    }

    /** 只删除内置示例题（id 形如 q_001 ... q_014），不影响用户自己录入的题。 */
    fun deleteSamples(): Int {
        return writableDatabase.delete("questions", "id GLOB ?", arrayOf("q_0[0-9][0-9]"))
    }

    fun count(): Int {
        readableDatabase.rawQuery("SELECT COUNT(*) FROM questions", null).use { cursor ->
            return if (cursor.moveToFirst()) cursor.getInt(0) else 0
        }
    }

    fun recordAttempt(id: String, result: String, variantId: String?): Question? {
        val question = get(id) ?: return null
        val delta = when (result) {
            "mastered" -> 16
            "fuzzy" -> 4
            else -> -8
        }
        val mastery = (question.mastery + delta).coerceIn(0, 100)
        val now = Instant.now().toString()
        val attempts = question.attempts + Attempt(
            id = newId("a"),
            variantId = variantId,
            result = result,
            at = now
        )
        val updated = question.copy(
            mastery = mastery,
            status = deriveStatus(mastery, attempts),
            attempts = attempts,
            reviewCount = question.reviewCount + 1,
            nextReviewAt = nextReviewFrom(mastery),
            updatedAt = now
        )
        upsert(updated)
        return updated
    }

    fun toggleStar(id: String): Question? {
        val question = get(id) ?: return null
        val updated = question.copy(starred = !question.starred, updatedAt = Instant.now().toString())
        upsert(updated)
        return updated
    }
}
