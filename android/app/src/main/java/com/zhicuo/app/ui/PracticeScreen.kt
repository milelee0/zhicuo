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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.zhicuo.app.data.Question

@Composable
fun PracticeScreen(
    questions: List<Question>,
    initialQuestionId: String?,
    onAttempt: (String, String?, String) -> Question?,
    onFinished: () -> Unit,
    onOpenSettings: () -> Unit
) {
    val queue = remember(initialQuestionId, questions.size) {
        if (initialQuestionId != null) {
            questions.filter { it.id == initialQuestionId }
        } else {
            val due = questions.filter { it.dueNow() }
            if (due.isNotEmpty()) due else questions.shuffled().take(5)
        }
    }
    var index by remember { mutableIntStateOf(0) }
    var revealed by remember { mutableStateOf(false) }
    var hint by remember { mutableStateOf(false) }
    val results = remember { mutableStateListOf<String>() }
    var lastDelta by remember { mutableStateOf(0) }
    var finished by remember { mutableStateOf(false) }

    LaunchedEffect(initialQuestionId, questions.size) {
        index = 0
        revealed = false
        hint = false
        results.clear()
        finished = false
    }

    if (queue.isEmpty()) {
        Column(Modifier.fillMaxSize().padding(18.dp)) {
            Kicker("DRILL / 举一反三")
            Spacer(Modifier.height(12.dp))
            Text("还没有可练习的错题", style = MaterialTheme.typography.headlineMedium)
            Spacer(Modifier.height(8.dp))
            EmptyState("先去录入一道错题", "有了错题和变式题，就可以开始练了。")
        }
        return
    }

    if (finished) {
        val mastered = results.count { it == "mastered" }
        val fuzzy = results.count { it == "fuzzy" }
        val failed = results.count { it == "failed" }
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(18.dp)
        ) {
            Kicker("DRILL / 本组总结")
            Spacer(Modifier.height(12.dp))
            Text("这一组练完了。", style = MaterialTheme.typography.headlineMedium)
            Spacer(Modifier.height(6.dp))
            Text("自评不是考试分数，是给下一次复习定时。", color = Ink3, style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(18.dp))
            InkCard(Modifier.fillMaxWidth()) {
                Column {
                    Text("${mastered} / ${results.size}", fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace, fontSize = 34.sp, fontWeight = FontWeight.Bold)
                    Text("已掌握", color = Ink3, fontSize = 11.sp)
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                        ResultStat("掌握", mastered, Sage)
                        ResultStat("模糊", fuzzy, Gold)
                        ResultStat("不会", failed, Red)
                    }
                }
            }
            Spacer(Modifier.height(18.dp))
            PrimaryButton("再来一组", Modifier.fillMaxWidth()) {
                index = 0
                revealed = false
                hint = false
                results.clear()
                finished = false
            }
            Spacer(Modifier.height(8.dp))
            Text(
                "去「错题本」看完整解析与掌握指南",
                modifier = Modifier.fillMaxWidth().clickable { onFinished() },
                color = Ink3,
                fontSize = 11.sp
            )
        }
        return
    }

    val question = queue.getOrNull(index) ?: queue.first()
    val variant = question.variants.firstOrNull()
    val shownText = variant?.text ?: question.text
    val shownAnswer = variant?.answer ?: question.answer
    val shownAnalysis = variant?.analysis ?: question.analysis
    val shownHint = variant?.hint ?: "先自己写思路，再看答案。"

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(18.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Kicker("DRILL / 举一反三")
            Spacer(Modifier.weight(1f))
            Text("第 ${index + 1} / ${queue.size} 题", color = Ink3, fontSize = 10.sp)
        }
        Spacer(Modifier.height(10.dp))
        Text(
            if (variant != null) "换一种问法，再练一次。" else "先弄懂原题。",
            style = MaterialTheme.typography.headlineMedium
        )
        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            SubjectTag(question.subject)
            Spacer(Modifier.width(8.dp))
            if (variant?.point?.isNotBlank() == true) TagChip("针对：${variant.point}", tone = SageSoft, textColor = Sage)
            Spacer(Modifier.weight(1f))
            Text("掌握度 ${question.mastery}%", color = Ink3, fontSize = 10.sp)
        }
        Spacer(Modifier.height(14.dp))
        InkCard(Modifier.fillMaxWidth()) {
            Column {
                Text(shownText, style = MaterialTheme.typography.bodyLarge)
                if (question.imagePath != null && fileExists(question.imagePath)) {
                    Spacer(Modifier.height(8.dp))
                    QuestionImage(question.imagePath)
                }
                Spacer(Modifier.height(12.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "看提示",
                        color = Ink2,
                        fontSize = 12.sp,
                        modifier = Modifier.clickable { hint = !hint }
                    )
                    Spacer(Modifier.weight(1f))
                    if (!revealed) {
                        PrimaryButton("查看答案") { revealed = true }
                    }
                }
                if (hint) {
                    Spacer(Modifier.height(8.dp))
                    Text(shownHint, color = Ink3, style = MaterialTheme.typography.bodySmall)
                }
            }
        }

        if (revealed) {
            Spacer(Modifier.height(12.dp))
            InkCard(Modifier.fillMaxWidth(), background = Paper) {
                Column {
                    Text("参考答案", color = RedDeep, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(4.dp))
                    Text(shownAnswer, color = RedDeep, style = MaterialTheme.typography.bodyLarge)
                    Spacer(Modifier.height(10.dp))
                    Text("解析", color = Ink3, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    Text(shownAnalysis, style = MaterialTheme.typography.bodyMedium)
                }
            }
            Spacer(Modifier.height(14.dp))
            Text("这一步，你掌握到什么程度？", color = Ink2, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                AssessButton("已掌握", Sage, Modifier.weight(1f)) {
                    commit(question, variant?.id, "mastered", onAttempt, results) { delta ->
                        lastDelta = delta
                    }
                    if (index + 1 >= queue.size) finished = true else index += 1
                    revealed = false
                    hint = false
                }
                AssessButton("有点模糊", Gold, Modifier.weight(1f)) {
                    commit(question, variant?.id, "fuzzy", onAttempt, results) { delta ->
                        lastDelta = delta
                    }
                    if (index + 1 >= queue.size) finished = true else index += 1
                    revealed = false
                    hint = false
                }
                AssessButton("还是不会", Red, Modifier.weight(1f)) {
                    commit(question, variant?.id, "failed", onAttempt, results) { delta ->
                        lastDelta = delta
                    }
                    if (index + 1 >= queue.size) finished = true else index += 1
                    revealed = false
                    hint = false
                }
            }
            if (lastDelta != 0) {
                Spacer(Modifier.height(6.dp))
                Text(
                    "本次掌握度 ${if (lastDelta > 0) "+" else ""}$lastDelta 分",
                    color = if (lastDelta > 0) Sage else Red,
                    fontSize = 10.sp
                )
            }
        }
        Spacer(Modifier.height(20.dp))
        Text(
            "配置真实 AI 后可生成针对你薄弱点的变式题",
            modifier = Modifier.clickable { onOpenSettings() },
            color = Ink3,
            fontSize = 10.sp
        )
        Spacer(Modifier.height(20.dp))
    }
}

private fun commit(
    question: Question,
    variantId: String?,
    result: String,
    onAttempt: (String, String?, String) -> Question?,
    results: MutableList<String>,
    onDelta: (Int) -> Unit
) {
    val before = question.mastery
    val updated = onAttempt(question.id, variantId, result)
    results.add(result)
    onDelta((updated?.mastery ?: before) - before)
}

@Composable
private fun AssessButton(text: String, color: Color, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Text(
        text,
        color = color,
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = modifier
            .clip(RoundedCornerShape(7.dp))
            .background(color.copy(alpha = 0.12f))
            .clickable(onClick = onClick)
            .padding(vertical = 12.dp),
        textAlign = androidx.compose.ui.text.style.TextAlign.Center
    )
}

@Composable
private fun ResultStat(label: String, value: Int, color: Color) {
    Column {
        Text(value.toString(), color = color, fontWeight = FontWeight.Bold, fontSize = 18.sp)
        Text(label, color = Ink3, fontSize = 10.sp)
    }
}
