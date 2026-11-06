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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.zhicuo.app.data.Question

@Composable
fun BookScreen(
    questions: List<Question>,
    onAdd: () -> Unit,
    onOpenDetail: (String) -> Unit,
    onToggleStar: (String) -> Unit
) {
    var query by remember { mutableStateOf("") }
    var subject by remember { mutableStateOf("") }
    val subjects = questions.map { it.subject }.distinct()
    val filtered = questions.filter { q ->
        (subject.isEmpty() || q.subject == subject) &&
            (query.isBlank() || listOf(q.text, q.answer, q.analysis, q.knowledgePoints.joinToString(" "), q.errorReason)
                .joinToString("\n").contains(query, ignoreCase = true))
    }

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(18.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        item {
            Kicker("NOTEBOOK / 错题本")
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("错题本", style = MaterialTheme.typography.headlineMedium)
                Spacer(Modifier.width(8.dp))
                Text("共 ${questions.size} 道", color = Ink3, fontSize = 11.sp)
                Spacer(Modifier.weight(1f))
                IconButton(onClick = onAdd) {
                    Icon(Icons.Default.Add, contentDescription = "录入错题", tint = Red)
                }
            }
            Text(
                "按学科、掌握度与错因筛一遍，找到今天最该重做的那几道。",
                style = MaterialTheme.typography.bodySmall,
                color = Ink3
            )
            Spacer(Modifier.height(14.dp))
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("搜索题干 / 答案 / 知识点", fontSize = 13.sp) },
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null, tint = Ink3) },
                singleLine = true,
                shape = androidx.compose.foundation.shape.RoundedCornerShape(8.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedContainerColor = Paper2,
                    unfocusedContainerColor = Paper2,
                    focusedBorderColor = Ink,
                    unfocusedBorderColor = Line
                )
            )
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                FilterChip("全部", subject.isEmpty()) { subject = "" }
                subjects.take(4).forEach { s ->
                    FilterChip(s, subject == s) { subject = if (subject == s) "" else s }
                }
            }
            Spacer(Modifier.height(4.dp))
            Text("筛出 ${filtered.size} 道", color = Ink3, fontSize = 10.sp)
        }

        if (filtered.isEmpty()) {
            item { EmptyState("没有找到相关错题", "换个关键词，或者去录入一道新错题。") }
        } else {
            items(filtered, key = { it.id }) { question ->
                BookCard(question, onOpen = { onOpenDetail(question.id) }, onStar = { onToggleStar(question.id) })
            }
        }
        item { Spacer(Modifier.height(8.dp)) }
    }
}

@Composable
private fun FilterChip(text: String, active: Boolean, onClick: () -> Unit) {
    Text(
        text,
        color = if (active) Paper2 else Ink2,
        fontSize = 11.sp,
        modifier = Modifier
            .clickable(onClick = onClick)
            .then(
                if (active) Modifier.background(Ink, androidx.compose.foundation.shape.RoundedCornerShape(14.dp))
                else Modifier.background(Paper2, androidx.compose.foundation.shape.RoundedCornerShape(14.dp))
            )
            .padding(horizontal = 11.dp, vertical = 6.dp)
    )
}

@Composable
private fun BookCard(question: Question, onOpen: () -> Unit, onStar: () -> Unit) {
    InkCard(Modifier.fillMaxWidth()) {
        Column(Modifier.clickable(onClick = onOpen)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                SubjectTag(question.subject)
                Spacer(Modifier.width(8.dp))
                DifficultyDots(question.difficulty)
                Spacer(Modifier.weight(1f))
                IconButton(onClick = onStar, modifier = Modifier.height(28.dp)) {
                    Icon(
                        Icons.Default.Star,
                        contentDescription = "收藏",
                        tint = if (question.starred) Gold else Line
                    )
                }
            }
            Spacer(Modifier.height(8.dp))
            Text(
                question.text,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
                style = MaterialTheme.typography.bodyLarge
            )
            Spacer(Modifier.height(9.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                question.knowledgePoints.take(3).forEach {
                    TagChip(it, tone = Color(0xFFDCE4EA), textColor = Color(0xFF3E5C76))
                }
                if (question.errorType.isNotBlank()) {
                    TagChip(question.errorType, tone = RedSoft, textColor = RedDeep)
                }
            }
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                MasteryBar(question.mastery, Modifier.weight(1f))
                Spacer(Modifier.width(8.dp))
                Text(formatRelative(question.updatedAt), color = Ink3, fontSize = 9.sp)
            }
        }
    }
}
