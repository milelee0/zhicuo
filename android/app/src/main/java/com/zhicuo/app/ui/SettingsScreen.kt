package com.zhicuo.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.zhicuo.app.data.AiSettings
import com.zhicuo.app.data.PROVIDERS
import com.zhicuo.app.data.ProviderPreset
import com.zhicuo.app.data.guessProvider

@Composable
fun SettingsScreen(
    settings: AiSettings,
    onSave: (AiSettings) -> Unit,
    onClearSamples: () -> Unit,
    onExportPdf: () -> Unit
) {
    var provider by remember(settings) { mutableStateOf(guessProvider(settings.baseUrl)) }
    var baseUrl by remember(settings) { mutableStateOf(settings.baseUrl) }
    var model by remember(settings) { mutableStateOf(settings.model) }
    var apiKey by remember(settings) { mutableStateOf(settings.apiKey) }
    var showKey by remember { mutableStateOf(false) }
    var advanced by remember { mutableStateOf(provider.id == "custom") }
    var confirmClear by remember { mutableStateOf(false) }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(18.dp)
    ) {
        Kicker("SYSTEM / 设置")
        Spacer(Modifier.height(12.dp))
        Text("把工具，调成顺手的样子。", style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(6.dp))
        Text(
            "选一个服务商，填 API Key 就能拍照识别。文字和图片共用同一个多模态模型，不需要分开填两个模型。",
            color = Ink3,
            style = MaterialTheme.typography.bodySmall
        )
        Spacer(Modifier.height(16.dp))

        InkCard(Modifier.fillMaxWidth()) {
            Column {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("AI 服务", style = MaterialTheme.typography.titleLarge)
                    Spacer(Modifier.weight(1f))
                    TagChip(
                        if (settings.hasKey) "已配置" else "未配置",
                        tone = if (settings.hasKey) SageSoft else GoldSoft,
                        textColor = if (settings.hasKey) Sage else ColorGold
                    )
                }
                Spacer(Modifier.height(12.dp))
                Text("选择服务商", color = Ink2, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(6.dp))
                Row(
                    Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    PROVIDERS.forEach { item ->
                        ProviderChip(item, provider.id == item.id) {
                            provider = item
                            if (item.baseUrl.isNotBlank()) baseUrl = item.baseUrl
                            if (item.models.isNotEmpty()) model = item.models.first()
                            advanced = item.id == "custom"
                        }
                    }
                }
                if (provider.note.isNotBlank()) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        provider.note,
                        color = if (provider.supportsImage) Ink3 else RedDeep,
                        fontSize = 10.sp,
                        lineHeight = 15.sp
                    )
                }
                Spacer(Modifier.height(12.dp))
                if (provider.models.isNotEmpty()) {
                    Text("模型（支持拍照的模型已排在前面）", color = Ink2, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.height(6.dp))
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        provider.models.forEach { name ->
                            ModelChip(name, model == name) { model = name }
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                }
                if (advanced || provider.id == "custom") {
                    SettingsField("API 地址", baseUrl, { baseUrl = it }, "https://.../v1")
                    Spacer(Modifier.height(10.dp))
                    SettingsField("模型名", model, { model = it }, "qwen-vl-max / gpt-4o")
                    Spacer(Modifier.height(10.dp))
                } else {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("当前：$baseUrl", color = Ink3, fontSize = 9.sp, modifier = Modifier.weight(1f))
                        TextButton(onClick = { advanced = true }) { Text("手动修改", color = Ink3, fontSize = 10.sp) }
                    }
                }
                Spacer(Modifier.height(10.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(
                        value = apiKey,
                        onValueChange = { apiKey = it },
                        modifier = Modifier.weight(1f),
                        label = { Text("API Key", fontSize = 11.sp) },
                        singleLine = true,
                        visualTransformation = if (showKey) VisualTransformation.None else PasswordVisualTransformation(),
                        shape = RoundedCornerShape(8.dp),
                        colors = fieldColors()
                    )
                    Spacer(Modifier.width(8.dp))
                    Switch(
                        checked = showKey,
                        onCheckedChange = { showKey = it },
                        colors = SwitchDefaults.colors(checkedTrackColor = Sage)
                    )
                }
                Spacer(Modifier.height(8.dp))
                Text(
                    "API Key 只保存在本机 SharedPreferences；拍照时图片会临时发给所选 AI 服务商。",
                    color = Ink3,
                    fontSize = 10.sp,
                    lineHeight = 15.sp
                )
                Spacer(Modifier.height(14.dp))
                PrimaryButton("保存设置", Modifier.fillMaxWidth()) {
                    onSave(
                        AiSettings(
                            baseUrl = baseUrl.trim(),
                            model = model.trim(),
                            apiKey = apiKey.trim()
                        )
                    )
                }
            }
        }

        Spacer(Modifier.height(14.dp))
        InkCard(Modifier.fillMaxWidth(), background = Paper) {
            Column {
                Text("本地数据", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(6.dp))
                Text(
                    "错题、练习记录、照片全部在应用私有目录。示例题可以单独清空，不影响你自己录入的题。",
                    style = MaterialTheme.typography.bodySmall
                )
                Spacer(Modifier.height(10.dp))
                TextButton(onClick = { confirmClear = true }) {
                    Text("清空内置示例题", color = RedDeep, fontSize = 12.sp)
                }
                TextButton(onClick = onExportPdf) {
                    Text("导出全部错题 PDF（含答案解析）", color = Ink, fontSize = 12.sp)
                }
                Text("当前版本：0.4.0 · local-first MVP", color = Ink3, fontSize = 10.sp)
            }
        }

        Spacer(Modifier.height(14.dp))
        InkCard(Modifier.fillMaxWidth(), background = GoldSoft) {
            Column {
                Text("拍照识别模型推荐", color = ColorGold, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                Spacer(Modifier.height(4.dp))
                Text(
                    "通义千问 qwen-vl-max（国内直连、稳定）\nOpenAI gpt-4o（需可访问 OpenAI）\n智谱 glm-4v-plus（国内）\n\nDeepSeek 文本模型不支持图片；如果只选 DeepSeek，拍照会提示换模型。",
                    color = ColorGold,
                    fontSize = 10.5.sp,
                    lineHeight = 16.sp
                )
            }
        }
        Spacer(Modifier.height(24.dp))
    }

    if (confirmClear) {
        AlertDialog(
            onDismissRequest = { confirmClear = false },
            title = { Text("清空内置示例题？") },
            text = { Text("只会删除 id 为 q_001~q_014 的 14 道示例题；你自己拍/录入的错题不受影响。") },
            confirmButton = {
                TextButton(onClick = {
                    confirmClear = false
                    onClearSamples()
                }) { Text("清空示例", color = RedDeep) }
            },
            dismissButton = {
                TextButton(onClick = { confirmClear = false }) { Text("取消") }
            }
        )
    }
}

@Composable
private fun ProviderChip(provider: ProviderPreset, active: Boolean, onClick: () -> Unit) {
    Text(
        provider.name,
        color = if (active) Paper2 else Ink2,
        fontSize = 11.sp,
        fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
        modifier = Modifier
            .clip(RoundedCornerShape(14.dp))
            .background(if (active) Ink else Paper2)
            .clickable(onClick = onClick)
            .padding(horizontal = 11.dp, vertical = 7.dp)
    )
}

@Composable
private fun ModelChip(name: String, active: Boolean, onClick: () -> Unit) {
    Text(
        name,
        color = if (active) RedDeep else Ink3,
        fontSize = 10.sp,
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(if (active) RedSoft else Paper3)
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 6.dp)
    )
}

@Composable
private fun SettingsField(label: String, value: String, onChange: (String) -> Unit, placeholder: String) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        modifier = Modifier.fillMaxWidth(),
        label = { Text(label, fontSize = 11.sp) },
        placeholder = { Text(placeholder, fontSize = 11.sp, color = Ink3) },
        singleLine = true,
        shape = RoundedCornerShape(8.dp),
        colors = fieldColors()
    )
}

@Composable
private fun fieldColors() = OutlinedTextFieldDefaults.colors(
    focusedContainerColor = Paper2,
    unfocusedContainerColor = Paper2,
    focusedBorderColor = Ink,
    unfocusedBorderColor = Line
)

private val ColorGold = androidx.compose.ui.graphics.Color(0xFF7D5C1F)


