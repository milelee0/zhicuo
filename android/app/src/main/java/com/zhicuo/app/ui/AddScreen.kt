package com.zhicuo.app.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.zhicuo.app.ai.AiAnalyzer
import com.zhicuo.app.data.AiSettings
import com.zhicuo.app.data.Analysis
import com.zhicuo.app.data.Question
import com.zhicuo.app.util.ImageUtils
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

@Composable
fun AddScreen(
    settings: AiSettings,
    onSettingsNeeded: () -> Unit,
    onSaved: (Question) -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var imageFile by remember { mutableStateOf<File?>(null) }
    var analyzing by remember { mutableStateOf(false) }
    var analysis by remember { mutableStateOf<Analysis?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var cameraFile by remember { mutableStateOf<File?>(null) }
    var autoAnalyze by remember { mutableStateOf(false) }

    val cameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        if (ok) {
            val file = cameraFile
            if (file != null && file.exists()) {
                imageFile = null
                analysis = null
                error = null
                // 压缩放到 IO，完成后触发自动识别
                scope.launch {
                    val compressed = withContext(Dispatchers.IO) {
                        ImageUtils.compressCameraFile(context, file)
                    }
                    if (compressed == null) {
                        error = "照片处理失败，请重新拍一张。"
                    } else {
                        imageFile = compressed
                        autoAnalyze = true
                    }
                }
            }
        }
    }
    val galleryLauncher = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        if (uri != null) {
            analysis = null
            error = null
            scope.launch {
                val compressed = withContext(Dispatchers.IO) {
                    ImageUtils.saveFromUri(context, uri)
                }
                if (compressed == null) {
                    error = "照片读取失败，请换一张或重新拍照。"
                } else {
                    imageFile = compressed
                    autoAnalyze = true
                }
            }
        }
    }

    LaunchedEffect(imageFile?.absolutePath, autoAnalyze, settings.hasKey) {
        if (!autoAnalyze || imageFile == null) return@LaunchedEffect
        autoAnalyze = false
        if (!settings.hasKey) {
            error = "拍照识别需要先配置 AI Key 和多模态模型。"
            return@LaunchedEffect
        }
        analyzing = true
        error = null
        try {
            analysis = AiAnalyzer.analyze(settings, "", "", imageFile)
        } catch (e: Exception) {
            error = e.message ?: "AI 识别失败"
        } finally {
            analyzing = false
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 18.dp, vertical = 20.dp)
    ) {
        Kicker("INTAKE / 拍照录入")
        Spacer(Modifier.height(12.dp))
        Text("拍下来，弄懂它。", style = MaterialTheme.typography.displaySmall)
        Spacer(Modifier.height(6.dp))
        Text(
            "不用手动输入题目和答案。拍一张题目的照片，AI 会识别题干、你的手写作答，完成解答、错因诊断和知识点评估。",
            style = MaterialTheme.typography.bodySmall,
            color = Ink3
        )
        Spacer(Modifier.height(16.dp))

        if (!settings.hasKey) {
            InkCard(Modifier.fillMaxWidth(), background = GoldSoft) {
                Column {
                    Text("拍照识别需要多模态模型", fontWeight = FontWeight.Bold, color = ColorGoldText)
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "当前未配置 AI。请先在设置中选择服务商、填写 API Key 和多模态模型（如 qwen-vl-max / gpt-4o / glm-4v-plus），否则照片无法识别。",
                        style = MaterialTheme.typography.bodySmall,
                        color = ColorGoldText
                    )
                    TextButton(onClick = onSettingsNeeded) { Text("去设置 AI", color = RedDeep) }
                }
            }
            Spacer(Modifier.height(12.dp))
        }

        InkCard(Modifier.fillMaxWidth()) {
            Column {
                if (imageFile == null) {
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .padding(vertical = 18.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text("拍一张错题照片", style = MaterialTheme.typography.titleLarge)
                        Spacer(Modifier.height(6.dp))
                        Text(
                            "把题干和你的作答一起拍进去，识别与错因诊断会更准。",
                            style = MaterialTheme.typography.bodySmall,
                            color = Ink3
                        )
                        Spacer(Modifier.height(14.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            PhotoButton("拍照", Modifier.weight(1f)) {
                                val temp = ImageUtils.newCameraFile(context)
                                cameraFile = temp
                                cameraLauncher.launch(ImageUtils.uriFor(context, temp))
                            }
                            PhotoButton("从相册选择", Modifier.weight(1f)) {
                                galleryLauncher.launch("image/*")
                            }
                        }
                    }
                } else {
                    QuestionImage(imageFile!!.absolutePath)
                    Spacer(Modifier.height(10.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            if (analyzing) "AI 正在识别与解答…" else if (analysis != null) "识别完成" else "照片已就绪",
                            color = if (analysis != null) Sage else Ink3,
                            fontSize = 11.sp
                        )
                        Spacer(Modifier.weight(1f))
                        TextButton(onClick = {
                            val temp = ImageUtils.newCameraFile(context)
                            cameraFile = temp
                            cameraLauncher.launch(ImageUtils.uriFor(context, temp))
                        }) { Text("重拍", color = Ink2) }
                        TextButton(onClick = {
                            imageFile = null
                            analysis = null
                            error = null
                        }) { Text("移除", color = RedDeep) }
                    }
                }
            }
        }

        if (analyzing) {
            Spacer(Modifier.height(16.dp))
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically
            ) {
                CircularProgressIndicator(Modifier.size(18.dp), color = Red, strokeWidth = 2.dp)
                Spacer(Modifier.width(8.dp))
                Text("正在读题、解答、判断错因…", color = Ink3, fontSize = 12.sp)
            }
        }

        error?.let {
            Spacer(Modifier.height(12.dp))
            Text(it, color = RedDeep, fontSize = 12.sp)
            if (imageFile != null && settings.hasKey) {
                TextButton(onClick = { autoAnalyze = true }) { Text("重新识别", color = Red) }
            }
        }

        analysis?.let { result ->
            Spacer(Modifier.height(16.dp))
            InkCard(Modifier.fillMaxWidth(), background = Color(0xFFFDF2E0)) {
                Column {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        TagChip(
                            if (result.engine == "live") "AI 识别" else "演示分析",
                            tone = if (result.engine == "live") SageSoft else GoldSoft,
                            textColor = if (result.engine == "live") Sage else ColorGoldText
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(result.subject, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                        Spacer(Modifier.weight(1f))
                        Text("难度 ${result.difficulty}", color = Ink3, fontSize = 10.sp)
                    }
                    Spacer(Modifier.height(10.dp))
                    Text("识别出的题目", color = Ink3, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(3.dp))
                    Text(result.recognizedText, style = MaterialTheme.typography.bodyMedium)
                    Spacer(Modifier.height(10.dp))
                    Text("答案", color = RedDeep, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    Text(result.answer, color = RedDeep, style = MaterialTheme.typography.bodyMedium)
                    Spacer(Modifier.height(8.dp))
                    Text("解析", color = Ink3, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    Text(result.analysis, style = MaterialTheme.typography.bodySmall)
                    if (result.errorReason.isNotBlank()) {
                        Spacer(Modifier.height(8.dp))
                        Text("错因诊断", color = Red, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        Text(result.errorReason, style = MaterialTheme.typography.bodySmall)
                    }
                    if (result.masteryAssessment.isNotEmpty()) {
                        Spacer(Modifier.height(8.dp))
                        Text("掌握评估", color = Ink3, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        result.masteryAssessment.forEach {
                            Text("${it.point} · ${it.level}：${it.microLesson}", style = MaterialTheme.typography.bodySmall)
                        }
                    }
                    Spacer(Modifier.height(12.dp))
                    PrimaryButton("保存到错题本", Modifier.fillMaxWidth()) {
                        onSaved(result.toQuestion(imageFile?.absolutePath))
                    }
                }
            }
        }

        Spacer(Modifier.height(12.dp))
        Text(
            "照片只保存在本机；识别时会把图片临时发给 AI 服务商。",
            color = Ink3,
            fontSize = 10.sp
        )
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun PhotoButton(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    TextButton(
        onClick = onClick,
        modifier = modifier
            .clip(RoundedCornerShape(8.dp))
            .background(Paper3)
    ) {
        Icon(Icons.Default.Add, contentDescription = null, tint = Ink2, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(5.dp))
        Text(text, color = Ink, fontSize = 12.sp)
    }
}

private val ColorGoldText = androidx.compose.ui.graphics.Color(0xFF7D5C1F)
