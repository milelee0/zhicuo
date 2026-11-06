package com.zhicuo.app.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

val Paper = Color(0xFFF3EDE0)
val Paper2 = Color(0xFFFBF7EC)
val Paper3 = Color(0xFFE9E1D0)
val Ink = Color(0xFF1E2533)
val Ink2 = Color(0xFF454C5C)
val Ink3 = Color(0xFF7C7C72)
val Red = Color(0xFFC94B36)
val RedDeep = Color(0xFFA33A28)
val RedSoft = Color(0xFFF3DCD5)
val Sage = Color(0xFF4E7C6A)
val SageSoft = Color(0xFFDEE9E1)
val Gold = Color(0xFFC79A4B)
val GoldSoft = Color(0xFFF1E5CC)
val Line = Color(0xFFD8CEBC)

private val colors = lightColorScheme(
    primary = Red,
    onPrimary = Paper2,
    secondary = Ink,
    onSecondary = Paper2,
    background = Paper,
    onBackground = Ink,
    surface = Paper2,
    onSurface = Ink,
    surfaceVariant = Paper3,
    onSurfaceVariant = Ink2,
    outline = Line,
    error = RedDeep
)

private val typography = Typography(
    displaySmall = TextStyle(
        fontFamily = FontFamily.Serif,
        fontWeight = FontWeight.Bold,
        fontSize = 34.sp,
        lineHeight = 44.sp,
        color = Ink
    ),
    headlineMedium = TextStyle(
        fontFamily = FontFamily.Serif,
        fontWeight = FontWeight.Bold,
        fontSize = 26.sp,
        lineHeight = 34.sp,
        color = Ink
    ),
    titleLarge = TextStyle(
        fontFamily = FontFamily.Serif,
        fontWeight = FontWeight.Bold,
        fontSize = 20.sp,
        lineHeight = 28.sp,
        color = Ink
    ),
    titleMedium = TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 15.sp,
        lineHeight = 22.sp,
        color = Ink
    ),
    bodyLarge = TextStyle(fontSize = 15.sp, lineHeight = 24.sp, color = Ink2),
    bodyMedium = TextStyle(fontSize = 13.sp, lineHeight = 21.sp, color = Ink2),
    bodySmall = TextStyle(fontSize = 11.sp, lineHeight = 17.sp, color = Ink3),
    labelLarge = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
)

@Composable
fun ZhiCuoTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = colors,
        typography = typography,
        content = content
    )
}
