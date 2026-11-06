package com.zhicuo.app.data

/** 常用 OpenAI 兼容服务商预设：选服务商 → 自动带出地址和推荐多模态模型。 */
data class ProviderPreset(
    val id: String,
    val name: String,
    val baseUrl: String,
    val models: List<String>,
    val note: String = "",
    val supportsImage: Boolean = true
)

val PROVIDERS: List<ProviderPreset> = listOf(
    ProviderPreset(
        id = "qwen",
        name = "通义千问",
        baseUrl = "https://dashscope.aliyuncs.com/compatible-mode/v1",
        models = listOf("qwen-vl-max", "qwen-vl-plus", "qwen-plus"),
        note = "推荐：qwen-vl-max 同时支持文字和拍照识别"
    ),
    ProviderPreset(
        id = "openai",
        name = "OpenAI",
        baseUrl = "https://api.openai.com/v1",
        models = listOf("gpt-4o", "gpt-4o-mini", "gpt-4.1"),
        note = "gpt-4o 支持图片；国内网络需可访问 OpenAI"
    ),
    ProviderPreset(
        id = "zhipu",
        name = "智谱 GLM",
        baseUrl = "https://open.bigmodel.cn/api/paas/v4",
        models = listOf("glm-4v-plus", "glm-4v-flash", "glm-4-plus"),
        note = "glm-4v 系列支持图片识别"
    ),
    ProviderPreset(
        id = "moonshot",
        name = "Moonshot Kimi",
        baseUrl = "https://api.moonshot.cn/v1",
        models = listOf("moonshot-v1-8k-vision-preview", "moonshot-v1-32k"),
        note = "视觉模型请以 Kimi 控制台当前模型名为准"
    ),
    ProviderPreset(
        id = "deepseek",
        name = "DeepSeek",
        baseUrl = "https://api.deepseek.com/v1",
        models = listOf("deepseek-chat", "deepseek-reasoner"),
        note = "DeepSeek 文本模型暂不支持拍照识别；拍照请选通义/OpenAI/智谱",
        supportsImage = false
    ),
    ProviderPreset(
        id = "custom",
        name = "自定义",
        baseUrl = "",
        models = emptyList(),
        note = "手动填写任何 OpenAI 兼容接口地址与多模态模型名"
    )
)

fun guessProvider(baseUrl: String): ProviderPreset {
    val url = baseUrl.trim()
    return PROVIDERS.firstOrNull { it.id != "custom" && it.baseUrl.isNotBlank() && url.startsWith(it.baseUrl) }
        ?: PROVIDERS.firstOrNull { it.id == "custom" }
        ?: PROVIDERS.first()
}
