package com.zhicuo.app.util

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import com.zhicuo.app.data.Question
import java.io.File
import java.io.FileOutputStream

/** 本地生成 A4 PDF：题目页 + 可选的答案与解析页。 */
object PdfExporter {
    private const val PAGE_W = 1240
    private const val PAGE_H = 1754
    private const val MARGIN = 86
    private const val CONTENT_W = PAGE_W - MARGIN * 2

    private val ink = Color.rgb(30, 37, 51)
    private val red = Color.rgb(201, 75, 54)
    private val gray = Color.rgb(124, 124, 114)
    private val line = Color.rgb(216, 206, 188)

    fun export(context: Context, questions: List<Question>, includeAnswers: Boolean = true): File {
        val dir = File(context.cacheDir, "exports").apply { mkdirs() }
        val file = File(dir, "知错-错题重练卷-${System.currentTimeMillis()}.pdf")
        val document = PdfDocument()
        val titlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = ink
            textSize = 44f
            typeface = Typeface.create(Typeface.SERIF, Typeface.BOLD)
        }
        val bodyPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = ink
            textSize = 25f
            typeface = Typeface.DEFAULT
        }
        val smallPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = gray
            textSize = 18f
            typeface = Typeface.DEFAULT
        }
        val answerPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = red
            textSize = 23f
            typeface = Typeface.DEFAULT_BOLD
        }
        val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = line
            strokeWidth = 1.2f
        }

        var pageNo = 1
        var page = document.startPage(PdfDocument.PageInfo.Builder(PAGE_W, PAGE_H, pageNo).create())
        var canvas = page.canvas
        var y = 110f
        canvas.drawText("知错 · 错题重练卷", MARGIN.toFloat(), y, titlePaint)
        y += 42f
        canvas.drawText("错题重练 · 共 ${questions.size} 题 · 生成于 ${shortDate()}", MARGIN.toFloat(), y, smallPaint)
        y += 24f
        canvas.drawLine(MARGIN.toFloat(), y, (PAGE_W - MARGIN).toFloat(), y, linePaint)
        y += 42f

        questions.forEachIndexed { index, question ->
            val lines = wrap(question.text, CONTENT_W - 50f, bodyPaint)
            val blockHeight = 50f + lines.size * 36f + 150f
            if (y + blockHeight > PAGE_H - 100f) {
                document.finishPage(page)
                pageNo += 1
                page = document.startPage(PdfDocument.PageInfo.Builder(PAGE_W, PAGE_H, pageNo).create())
                canvas = page.canvas
                y = 110f
                canvas.drawText("知错 · 错题重练卷（续）", MARGIN.toFloat(), y, smallPaint)
                y += 34f
            }
            canvas.drawCircle(MARGIN + 15f, y - 8f, 15f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = red })
            val numPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.WHITE
                textSize = 16f
                textAlign = Paint.Align.CENTER
                typeface = Typeface.DEFAULT_BOLD
            }
            canvas.drawText((index + 1).toString(), MARGIN + 15f, y - 2f, numPaint)
            canvas.drawText(
                "${question.subject} · 难度 ${question.difficulty}",
                MARGIN + 44f,
                y - 14f,
                smallPaint
            )
            y += 18f
            lines.forEach { lineText ->
                canvas.drawText(lineText, MARGIN + 44f, y, bodyPaint)
                y += 36f
            }
            y += 12f
            repeat(4) {
                canvas.drawLine(MARGIN + 44f, y, (PAGE_W - MARGIN).toFloat(), y, linePaint)
                y += 32f
            }
            y += 26f
        }

        if (includeAnswers) {
            document.finishPage(page)
            pageNo += 1
            page = document.startPage(PdfDocument.PageInfo.Builder(PAGE_W, PAGE_H, pageNo).create())
            canvas = page.canvas
            y = 120f
            canvas.drawText("参考答案与解析", MARGIN.toFloat(), y, titlePaint)
            y += 34f
            canvas.drawLine(MARGIN.toFloat(), y, (PAGE_W - MARGIN).toFloat(), y, linePaint)
            y += 40f
            questions.forEachIndexed { index, question ->
                val answerLines = wrap(question.answer.ifBlank { "（略）" }, CONTENT_W - 50f, answerPaint)
                val analysisLines = wrap(question.analysis.ifBlank { "（暂无解析）" }, CONTENT_W - 50f, bodyPaint)
                val need = 40f + answerLines.size * 32f + analysisLines.size * 32f + 26f
                if (y + need > PAGE_H - 90f) {
                    document.finishPage(page)
                    pageNo += 1
                    page = document.startPage(PdfDocument.PageInfo.Builder(PAGE_W, PAGE_H, pageNo).create())
                    canvas = page.canvas
                    y = 100f
                    canvas.drawText("参考答案与解析（续）", MARGIN.toFloat(), y, smallPaint)
                    y += 34f
                }
                canvas.drawText("第 ${index + 1} 题", MARGIN.toFloat(), y, smallPaint)
                y += 28f
                answerLines.forEach {
                    canvas.drawText(it, MARGIN + 40f, y, answerPaint)
                    y += 32f
                }
                y += 6f
                analysisLines.forEach {
                    canvas.drawText(it, MARGIN + 40f, y, bodyPaint)
                    y += 32f
                }
                y += 24f
            }
        }

        document.finishPage(page)
        FileOutputStream(file).use { document.writeTo(it) }
        document.close()
        return file
    }

    private fun wrap(text: String, maxWidth: Float, paint: Paint): List<String> {
        val out = mutableListOf<String>()
        text.split('\n').forEach { paragraph ->
            if (paragraph.isEmpty()) {
                out.add("")
                return@forEach
            }
            var line = ""
            paragraph.forEach { ch ->
                val test = line + ch
                if (paint.measureText(test) > maxWidth && line.isNotEmpty()) {
                    out.add(line)
                    line = ch.toString()
                } else {
                    line = test
                }
            }
            if (line.isNotEmpty()) out.add(line)
        }
        return out.ifEmpty { listOf("") }
    }

    private fun shortDate(): String {
        val now = java.time.LocalDate.now()
        return "${now.year}/${now.monthValue}/${now.dayOfMonth}"
    }
}
