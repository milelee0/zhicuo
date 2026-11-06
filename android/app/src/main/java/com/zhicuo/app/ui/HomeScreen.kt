package com.zhicuo.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.zhicuo.app.data.Question

@Composable
fun HomeScreen(
    questions: List<Question>,
    onAdd: () -> Unit,
    onOpenBook: () -> Unit,
    onOpenDetail: (String) -> Unit,
    onPracticeDue: () -> Unit
) {
    val due = questions.filter { it.dueNow() }
    val mastered = questions.count { it.status == "mastered" }
    val avg = if (questions.isEmpty()) 0 else questions.sumOf { it.mastery } / questions.size
    val recent = questions.sortedByDescending { it.updatedAt }.take(4)

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 18.dp, vertical = 20.dp)
    ) {
        Kicker("WORKDESK / 今日")
        Spacer(Modifier.height(12.dp))
        Text("把错题，\n变成得分点。", style = androidx.compose.material3.MaterialTheme.typography.displaySmall)
        Spacer(Modifier.height(8.dp))
        Text(
            "今天该翻哪几页，已经替你标好了。",
            style = androidx.compose.material3.MaterialTheme.typography.bodyMedium,
            color = Ink3
        )
        Spacer(Modifier.height(20.dp))

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StatCell("错题总数", questions.size.toString(), Modifier.weight(1f))
            StatCell("今日待复习", due.size.toString(), Modifier.weight(1f))
            StatCell("已掌握", mastered.toString(), Modifier.weight(1f))
            StatCell("平均掌握", "$avg%", Modifier.weight(1f))
        }

        Spacer(Modifier.height(16.dp))
        InkCard(Modifier.fillMaxWidth(), background = Paper) {
            Column {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("TODAY / 今日复习", color = Ink3, fontSize = 10.sp, fontFamily = FontFamily.Monospace)
                    Spacer(Modifier.weight(1f))
                    BoxDot(if (due.isNotEmpty()) Red else Sage)
                }
                Spacer(Modifier.height(10.dp))
                Row(verticalAlignment = Alignment.Bottom) {
                    Text(
                        due.size.toString(),
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Bold,
                        fontSize = 46.sp,
                        color = Ink
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        if (due.isEmpty()) "今天没有到期的题" else "道题等待复习",
                        color = Ink3,
                        modifier = Modifier.padding(bottom = 8.dp)
                    )
                }
                Spacer(Modifier.height(10.dp))
                PrimaryButton(
                    if (due.isEmpty()) "随机练一组" else "开始今日复习",
                    Modifier.fillMaxWidth(),
                    onClick = onPracticeDue
                )
                Spacer(Modifier.height(8.dp))
                Row {
                    Text("看错题本", color = Ink3, modifier = Modifier.clickable(onClick = onOpenBook))
                    Spacer(Modifier.weight(1f))
                    Text("录入错题", color = Red, modifier = Modifier.clickable(onClick = onAdd))
                }
            }
        }

        Spacer(Modifier.height(20.dp))
        SectionHead("今日复习", if (due.isEmpty()) "没有到期" else "${due.size} 道")
        if (due.isEmpty()) {
            EmptyState("今天没有到期的错题", "可以去「错题本」里挑一道，或者先录入新错题。")
        } else {
            due.take(3).forEach { question ->
                QuestionMiniCard(question) { onOpenDetail(question.id) }
                Spacer(Modifier.height(10.dp))
            }
        }

        Spacer(Modifier.height(20.dp))
        SectionHead("最近录入", "${questions.size} 道")
        if (recent.isEmpty()) {
            EmptyState("错题本还是空的", "拍一张照片，让 AI 替你看一眼。")
        } else {
            recent.forEach { question ->
                QuestionMiniCard(question) { onOpenDetail(question.id) }
                Spacer(Modifier.height(10.dp))
            }
        }
        Spacer(Modifier.height(20.dp))
    }
}

@Composable
private fun StatCell(label: String, value: String, modifier: Modifier = Modifier) {
    Column(
        modifier
            .clip(RoundedCornerShape(8.dp))
            .background(Paper2)
            .padding(horizontal = 10.dp, vertical = 12.dp)
    ) {
        Text(value, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, fontSize = 22.sp, color = Ink)
        Text(label, color = Ink3, fontSize = 9.sp, lineHeight = 13.sp)
    }
}

@Composable
fun SectionHead(title: String, trail: String) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        Box(Modifier.width(3.dp).height(15.dp).background(Red))
        Spacer(Modifier.width(8.dp))
        Text(title, style = androidx.compose.material3.MaterialTheme.typography.titleLarge)
        Spacer(Modifier.weight(1f))
        Text(trail, color = Ink3, fontSize = 10.sp)
    }
    Spacer(Modifier.height(10.dp))
}

@Composable
private fun BoxDot(color: Color) {
    androidx.compose.foundation.layout.Box(
        Modifier
            .size(7.dp)
            .clip(CircleShape)
            .background(color)
    )
}

@Composable
fun QuestionMiniCard(question: Question, onClick: () -> Unit) {
    InkCard(Modifier.fillMaxWidth()) {
        Column(Modifier.clickable(onClick = onClick)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                SubjectTag(question.subject)
                Spacer(Modifier.width(8.dp))
                DifficultyDots(question.difficulty)
                Spacer(Modifier.weight(1f))
                Text(formatRelative(question.updatedAt), color = Ink3, fontSize = 9.sp)
            }
            Spacer(Modifier.height(8.dp))
            Text(
                question.text,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                style = androidx.compose.material3.MaterialTheme.typography.bodyLarge
            )
            Spacer(Modifier.height(10.dp))
            MasteryBar(question.mastery)
        }
    }
}
