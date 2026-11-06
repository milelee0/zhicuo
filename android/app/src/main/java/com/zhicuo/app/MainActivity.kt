package com.zhicuo.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import com.zhicuo.app.data.AiSettings
import com.zhicuo.app.data.Question
import com.zhicuo.app.data.QuestionStore
import com.zhicuo.app.data.SettingsStore
import com.zhicuo.app.ui.AddScreen
import com.zhicuo.app.ui.BookScreen
import com.zhicuo.app.ui.DetailScreen
import com.zhicuo.app.ui.HomeScreen
import com.zhicuo.app.ui.Ink
import com.zhicuo.app.ui.Ink3
import com.zhicuo.app.ui.Paper
import com.zhicuo.app.ui.Paper2
import com.zhicuo.app.ui.PracticeScreen
import com.zhicuo.app.ui.Red
import com.zhicuo.app.ui.SettingsScreen
import com.zhicuo.app.ui.ZhiCuoTheme
import com.zhicuo.app.util.PdfExporter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {
    private lateinit var store: QuestionStore
    private lateinit var settingsStore: SettingsStore

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = QuestionStore(this)
        settingsStore = SettingsStore(this)
        setContent {
            ZhiCuoTheme {
                AppRoot(store, settingsStore)
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        store.close()
    }
}

private data class Tab(val key: String, val label: String, val icon: ImageVector)

@Composable
private fun AppRoot(store: QuestionStore, settingsStore: SettingsStore) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var questions by remember { mutableStateOf<List<Question>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }
    var tab by rememberSaveable { mutableStateOf("home") }
    var selectedId by remember { mutableStateOf<String?>(null) }
    var practiceSeed by remember { mutableStateOf<String?>(null) }
    var settings by remember { mutableStateOf(settingsStore.load()) }

    LaunchedEffect(Unit) {
        questions = withContext(Dispatchers.IO) { store.all() }
        loaded = true
    }

    fun reload() {
        questions = store.all()
    }

    val tabs = listOf(
        Tab("home", "总览", Icons.Default.Home),
        Tab("book", "错题本", Icons.Default.List),
        Tab("add", "录入", Icons.Default.Add),
        Tab("practice", "练习", Icons.Default.PlayArrow),
        Tab("settings", "设置", Icons.Default.Settings)
    )
    val selected = selectedId?.let { id -> questions.firstOrNull { it.id == id } }

    Scaffold(
        containerColor = Paper,
        bottomBar = {
            NavigationBar(containerColor = Paper2, contentColor = Ink) {
                tabs.forEach { item ->
                    NavigationBarItem(
                        selected = tab == item.key && selected == null,
                        onClick = {
                            tab = item.key
                            selectedId = null
                            if (item.key != "practice") practiceSeed = null
                        },
                        icon = { Icon(item.icon, contentDescription = item.label) },
                        label = { Text(item.label, fontSize = 10.sp) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = Paper2,
                            selectedTextColor = Red,
                            indicatorColor = Ink,
                            unselectedIconColor = Ink3,
                            unselectedTextColor = Ink3
                        )
                    )
                }
            }
        }
    ) { padding ->
        Box(
            Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            if (!loaded) {
                Box(Modifier.fillMaxSize()) {
                    Text("正在打开错题本…", modifier = Modifier.padding(24.dp), color = Ink3)
                }
            } else if (selected != null) {
                DetailScreen(
                    question = selected,
                    onBack = { selectedId = null },
                    onPractice = {
                        practiceSeed = selected.id
                        selectedId = null
                        tab = "practice"
                    },
                    onDelete = {
                        store.delete(selected.id)
                        selectedId = null
                        reload()
                    }
                )
            } else {
                when (tab) {
                    "home" -> HomeScreen(
                        questions = questions,
                        onAdd = { tab = "add" },
                        onOpenBook = { tab = "book" },
                        onOpenDetail = { selectedId = it },
                        onPracticeDue = {
                            practiceSeed = null
                            tab = "practice"
                        }
                    )

                    "book" -> BookScreen(
                        questions = questions,
                        onAdd = { tab = "add" },
                        onOpenDetail = { selectedId = it },
                        onToggleStar = { id ->
                            store.toggleStar(id)
                            reload()
                        }
                    )

                    "add" -> AddScreen(
                        settings = settings,
                        onSettingsNeeded = { tab = "settings" },
                        onSaved = { question ->
                            store.upsert(question)
                            reload()
                            tab = "book"
                            selectedId = question.id
                        }
                    )

                    "practice" -> PracticeScreen(
                        questions = questions,
                        initialQuestionId = practiceSeed,
                        onAttempt = { id, variantId, result ->
                            val updated = store.recordAttempt(id, result, variantId)
                            reload()
                            updated
                        },
                        onFinished = {
                            reload()
                            tab = "book"
                        },
                        onOpenSettings = { tab = "settings" }
                    )

                    "settings" -> SettingsScreen(
                        settings = settings,
                        onSave = {
                            settings = it
                            settingsStore.save(it)
                        },
                        onClearSamples = {
                            store.deleteSamples()
                            reload()
                        },
                        onExportPdf = {
                            scope.launch {
                                val file = withContext(Dispatchers.IO) {
                                    PdfExporter.export(context, questions, includeAnswers = true)
                                }
                                val uri = FileProvider.getUriForFile(
                                    context,
                                    "${context.packageName}.fileprovider",
                                    file
                                )
                                val intent = Intent(Intent.ACTION_SEND).apply {
                                    type = "application/pdf"
                                    putExtra(Intent.EXTRA_STREAM, uri)
                                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                }
                                context.startActivity(Intent.createChooser(intent, "分享或打印 PDF"))
                            }
                        }
                    )
                }
            }
        }
    }
}
