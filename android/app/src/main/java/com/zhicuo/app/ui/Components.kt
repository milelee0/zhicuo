package com.zhicuo.app.ui

import android.graphics.BitmapFactory
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.io.File
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Composable
fun Kicker(text: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.width(16.dp).height(2.dp).background(Red))
        Spacer(Modifier.width(8.dp))
        Text(
            text.uppercase(),
            color = Ink3,
            fontSize = 10.sp,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = 1.6.sp,
            fontFamily = FontFamily.Monospace
        )
    }
}

@Composable
fun PageTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        modifier = modifier,
        style = MaterialTheme.typography.displaySmall
    )
}

@Composable
fun InkCard(
    modifier: Modifier = Modifier,
    background: Color = Paper2,
    content: @Composable () -> Unit
) {
    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(containerColor = background),
        border = BorderStroke(1.dp, Line),
        shape = RoundedCornerShape(10.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Box(Modifier.padding(16.dp)) { content() }
    }
}

@Composable
fun SubjectTag(subject: String) {
    val (bg, fg) = when (subject) {
        "数学" -> Color(0xFFF3DED6) to Color(0xFF9A3B2A)
        "物理" -> Color(0xFFDFE6EC) to Color(0xFF3E5C76)
        "化学" -> Color(0xFFE2E9DC) to Color(0xFF4E6A45)
        "英语" -> Color(0xFFF1E5D1) to Color(0xFF7A5428)
        "语文" -> Color(0xFFF0DFE2) to Color(0xFF8A4350)
        else -> Paper3 to Ink2
    }
    Text(
        subject,
        color = fg,
        fontSize = 10.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier
            .clip(RoundedCornerShape(4.dp))
            .background(bg)
            .padding(horizontal = 8.dp, vertical = 3.dp)
    )
}

@Composable
fun TagChip(text: String, tone: Color = Paper3, textColor: Color = Ink2) {
    Text(
        text,
        color = textColor,
        fontSize = 10.sp,
        modifier = Modifier
            .clip(RoundedCornerShape(4.dp))
            .background(tone)
            .padding(horizontal = 7.dp, vertical = 3.dp)
    )
}

@Composable
fun DifficultyDots(value: Int, modifier: Modifier = Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        repeat(5) { index ->
            Box(
                Modifier
                    .padding(end = 3.dp)
                    .size(5.dp)
                    .clip(CircleShape)
                    .background(if (index < value) Red else Line)
            )
        }
        Spacer(Modifier.width(5.dp))
        Text("难度 $value", color = Ink3, fontSize = 9.sp)
    }
}

@Composable
fun MasteryBar(value: Int, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .weight(1f)
                .height(4.dp)
                .clip(RoundedCornerShape(2.dp))
                .background(Paper3)
        ) {
            Box(
                Modifier
                    .fillMaxWidth(value / 100f)
                    .height(4.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .background(if (value >= 80) Sage else if (value >= 55) Gold else Red)
            )
        }
        Spacer(Modifier.width(8.dp))
        Text("$value%", color = Ink2, fontSize = 10.sp, fontFamily = FontFamily.Monospace)
    }
}

@Composable
fun EmptyState(title: String, desc: String) {
    InkCard(Modifier.fillMaxWidth()) {
        Column(
            Modifier.fillMaxWidth().padding(vertical = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(4.dp))
            Text(desc, style = MaterialTheme.typography.bodySmall, color = Ink3)
        }
    }
}

@Composable
fun PrimaryButton(
    text: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onClick: () -> Unit
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.height(46.dp),
        shape = RoundedCornerShape(8.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = Red,
            contentColor = Paper2,
            disabledContainerColor = Line,
            disabledContentColor = Ink3
        )
    ) {
        Text(text, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun QuestionImage(path: String, modifier: Modifier = Modifier) {
    val bitmap = remember(path) {
        runCatching { BitmapFactory.decodeFile(path) }.getOrNull()
    }
    if (bitmap != null) {
        Image(
            bitmap = bitmap.asImageBitmap(),
            contentDescription = "错题原图",
            modifier = modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp)),
            contentScale = ContentScale.FillWidth
        )
    }
}

fun formatRelative(iso: String): String {
    return runCatching {
        val time = Instant.parse(iso)
        val minutes = java.time.Duration.between(time, Instant.now()).toMinutes()
        when {
            minutes < 1 -> "刚刚"
            minutes < 60 -> "${minutes}分钟前"
            minutes < 24 * 60 -> "${minutes / 60}小时前"
            minutes < 30 * 24 * 60 -> "${minutes / (24 * 60)}天前"
            else -> DateTimeFormatter.ofPattern("M月d日").withZone(ZoneId.systemDefault()).format(time)
        }
    }.getOrDefault("")
}

fun shortDate(iso: String): String = runCatching {
    DateTimeFormatter.ofPattern("M月d日").withZone(ZoneId.systemDefault()).format(Instant.parse(iso))
}.getOrDefault("")

fun fileExists(path: String?): Boolean = path != null && File(path).exists()
