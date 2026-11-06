package com.zhicuo.app.data

data class AiSettings(
    val baseUrl: String = "https://dashscope.aliyuncs.com/compatible-mode/v1",
    val model: String = "qwen-vl-max",
    val apiKey: String = ""
) {
    val hasKey: Boolean get() = apiKey.isNotBlank()
    val mode: String get() = if (hasKey) "live" else "demo"
}

class SettingsStore(context: android.content.Context) {
    private val prefs = context.getSharedPreferences("zhicuo_settings", android.content.Context.MODE_PRIVATE)

    fun load(): AiSettings = AiSettings(
        baseUrl = prefs.getString("baseUrl", AiSettings().baseUrl).orEmpty(),
        model = prefs.getString("model", AiSettings().model).orEmpty(),
        apiKey = prefs.getString("apiKey", "").orEmpty()
    )

    fun save(settings: AiSettings) {
        prefs.edit()
            .putString("baseUrl", settings.baseUrl.trim())
            .putString("model", settings.model.trim())
            .putString("apiKey", settings.apiKey.trim())
            .apply()
    }
}
