package com.zhicuo.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.zhicuo.app.data.Assessment
import com.zhicuo.app.data.Guide
import com.zhicuo.app.data.Question
import com.zhicuo.app.data.Variant

@Composable
fun DetailScreen(
    question: Question,
    onBack: () -> Unit,
    onPractice: () -> Unit,
    onDelete: () -> Unit
) {
    var confirmDelete by remember { mutableStateOf(false) }
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 18.dp, vertical = 12.dp),
            verticalAlignment = androidx.compose.ui.Alignment.CenterVertically
        ) {
            Text("← 返回", color = Ink2, modifier = Modifier.clickable(onClick = onBack))
            Spacer(Modifier.weight(1f))
            Text("错题详情", color = Ink3, fontSize = 10.sp)
            Spacer(Modifier.width(12.dp))
            Text(
                "删除",
                color = RedDeep,
                fontSize = 12.sp,
                modifier = Modifier.clickable { confirmDelete = true }
            )
        }
        Column(Modifier.padding(horizontal = 18.dp)) {
            Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                SubjectTag(question.subject)
                Spacer(Modifier.width(8.dp))
                Text(question.grade, color = Ink3, fontSize = 10.sp)
                Spacer(Modifier.width(8.dp))
                DifficultyDots(question.difficulty)
                Spacer(Modifier.weight(1f))
                Text(question.masteryLabel(), color = if (question.mastery >= 80) Sage else Gold, fontSize = 11.sp)
            }
            Spacer(Modifier.height(14.dp))
            Text(question.text, style = MaterialTheme.typography.bodyLarge)
            if (fileExists(question.imagePath)) {
                Spacer(Modifier.height(12.dp))
                question.imagePath?.let { QuestionImage(it) }
            }
            Spacer(Modifier.height(14.dp))
            MasteryBar(question.mastery)

            if (question.studentWork.isNotBlank()) {
                SectionCard("我的解题过程") {
                    Text(question.studentWork, style = MaterialTheme.typography.bodyMedium, color = Ink2)
                }
            }

            if (question.errorReason.isNotBlank() || question.errorType.isNotBlank()) {
                Spacer(Modifier.height(14.dp))
                InkCard(Modifier.fillMaxWidth(), background = RedSoft) {
                    Column {
                        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                            TagChip(question.errorType, tone = Red, textColor = Paper2)
                            Spacer(Modifier.width(8.dp))
                            Text("错因诊断", color = RedDeep, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                        }
                        if (question.errorReason.isNotBlank()) {
                            Spacer(Modifier.height(8.dp))
                            Text(question.errorReason, style = MaterialTheme.typography.bodyMedium, color = RedDeep)
                        }
                    }
                }
            }

            if (question.masteryAssessment.isNotEmpty()) {
                Spacer(Modifier.height(14.dp))
                Text("知识掌握评估", style = MaterialTheme.typography.titleLarge)
                Spacer(Modifier.height(8.dp))
                question.masteryAssessment.forEach { AssessmentCard(it) }
            }

            Spacer(Modifier.height(16.dp))
            Text("答案与解析", style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(8.dp))
            InkCard(Modifier.fillMaxWidth()) {
                Column {
                    Text("答案", color = RedDeep, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(4.dp))
                    Text(question.answer, color = RedDeep, style = MaterialTheme.typography.bodyLarge)
                    Spacer(Modifier.height(12.dp))
                    HorizontalDivider(color = Line)
                    Spacer(Modifier.height(12.dp))
                    Text("解析", color = Ink3, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(4.dp))
                    Text(question.analysis, style = MaterialTheme.typography.bodyMedium)
                    if (question.commonMistakes.isNotEmpty()) {
                        Spacer(Modifier.height(10.dp))
                        Text("易错点", color = Ink3, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        question.commonMistakes.forEach {
                            Text("· $it", style = MaterialTheme.typography.bodySmall, color = Ink2)
                        }
                    }
                }
            }

            if (question.knowledgeGuide.isNotEmpty()) {
                Spacer(Modifier.height(16.dp))
                Text("知识点掌握指南", style = MaterialTheme.typography.titleLarge)
                Spacer(Modifier.height(8.dp))
                question.knowledgeGuide.forEach { GuideCard(it) }
            }

            if (question.variants.isNotEmpty()) {
                Spacer(Modifier.height(16.dp))
                Text("举一反三", style = MaterialTheme.typography.titleLarge)
                Spacer(Modifier.height(8.dp))
                question.variants.forEach { VariantCard(it) }
            }

            Spacer(Modifier.height(18.dp))
            PrimaryButton("针对薄弱点练习", Modifier.fillMaxWidth(), onClick = onPractice)
            Spacer(Modifier.height(8.dp))
            TextButton(onClick = { confirmDelete = true }, modifier = Modifier.fillMaxWidth()) {
                Text("删除这道错题", color = RedDeep, fontSize = 12.sp)
            }
            Spacer(Modifier.height(24.dp))
        }
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("删除这道错题？") },
            text = { Text("删除后本机无法恢复，但不会影响其他题目。") },
            confirmButton = {
                TextButton(onClick = {
                    confirmDelete = false
                    onDelete()
                }) { Text("删除", color = RedDeep) }
            },
            dismissButton = {
                TextButton(onClick = { confirmDelete = false }) { Text("取消") }
            }
        )
    }
}

@Composable
private fun SectionCard(title: String, content: @Composable () -> Unit) {
    Spacer(Modifier.height(14.dp))
    InkCard(Modifier.fillMaxWidth()) {
        Column {
            Text(title, color = Ink3, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(6.dp))
            content()
        }
    }
}

@Composable
private fun AssessmentCard(item: Assessment) {
    val color = when (item.level) {
        "未掌握" -> Red
        "薄弱" -> Gold
        "基本掌握" -> ColorBlue
        else -> Sage
    }
    InkCard(Modifier.fillMaxWidth()) {
        Column {
            Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                Text(item.point, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.weight(1f))
                TagChip(item.level, tone = color.copy(alpha = 0.15f), textColor = color)
            }
            if (item.evidence.isNotBlank()) {
                Spacer(Modifier.height(6.dp))
                Text("证据：${item.evidence}", style = MaterialTheme.typography.bodySmall)
            }
            if (item.gap.isNotBlank()) {
                Text("缺口：${item.gap}", style = MaterialTheme.typography.bodySmall)
            }
            if (item.microLesson.isNotBlank()) {
                Spacer(Modifier.height(6.dp))
                Text(item.microLesson, style = MaterialTheme.typography.bodyMedium, color = Ink2)
            }
        }
    }
    Spacer(Modifier.height(8.dp))
}

@Composable
private fun GuideCard(guide: Guide) {
    InkCard(Modifier.fillMaxWidth()) {
        Column {
            Text(guide.point, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
            if (guide.concept.isNotBlank()) {
                Spacer(Modifier.height(6.dp))
                Text(guide.concept, style = MaterialTheme.typography.bodyMedium)
            }
            if (guide.keyPoints.isNotEmpty()) {
                Spacer(Modifier.height(6.dp))
                Text("要点", color = Sage, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                guide.keyPoints.forEach { Text("· $it", style = MaterialTheme.typography.bodySmall, color = Ink2) }
            }
            if (guide.pitfalls.isNotEmpty()) {
                Spacer(Modifier.height(6.dp))
                Text("陷阱", color = Red, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                guide.pitfalls.forEach { Text("· $it", style = MaterialTheme.typography.bodySmall, color = Ink2) }
            }
            if (guide.checklist.isNotEmpty()) {
                Spacer(Modifier.height(6.dp))
                Text("自检", color = Gold, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                guide.checklist.forEach { Text("☐ $it", style = MaterialTheme.typography.bodySmall, color = Ink2) }
            }
        }
    }
    Spacer(Modifier.height(8.dp))
}

@Composable
private fun VariantCard(variant: Variant) {
    InkCard(Modifier.fillMaxWidth()) {
        Column {
            Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                TagChip("变式题", tone = GoldSoft, textColor = Gold)
                if (variant.point.isNotBlank()) {
                    Spacer(Modifier.width(6.dp))
                    Text("针对：${variant.point}", color = Ink3, fontSize = 9.sp)
                }
            }
            Spacer(Modifier.height(6.dp))
            Text(variant.text, style = MaterialTheme.typography.bodyMedium)
            if (variant.answer.isNotBlank()) {
                Spacer(Modifier.height(6.dp))
                Text("答案：${variant.answer}", style = MaterialTheme.typography.bodySmall, color = RedDeep)
            }
        }
    }
    Spacer(Modifier.height(8.dp))
}

private val ColorBlue = androidx.compose.ui.graphics.Color(0xFF3E5C76)
