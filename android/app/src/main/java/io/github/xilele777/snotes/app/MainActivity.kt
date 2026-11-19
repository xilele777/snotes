package io.github.xilele777.snotes.app

import android.os.Bundle
import android.content.Intent
import android.widget.Toast
import io.github.xilele777.snotes.core.data.ShareIntake
import io.github.xilele777.snotes.core.data.NotesRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.MutableStateFlow
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.*
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Modifier
import androidx.compose.material3.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.drop
import io.github.xilele777.snotes.core.data.Appearance
import io.github.xilele777.snotes.core.database.LocalProfile
import io.github.xilele777.snotes.core.sync.SyncWork
import io.github.xilele777.snotes.feature.notes.*
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.graphics.Color
import dagger.hilt.android.AndroidEntryPoint
import io.github.xilele777.snotes.BuildConfig
import javax.inject.Inject
import io.github.xilele777.snotes.feature.editor.EditorPrototypeScreen
import io.github.xilele777.snotes.feature.editor.LocalEditorScreen
import io.github.xilele777.snotes.feature.notes.NotesScreen

class AppIdentity @Inject constructor() {
    val versionName: String get() = BuildConfig.VERSION_NAME
}

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    @Inject lateinit var identity: AppIdentity
    @Inject lateinit var appearance: Appearance
    @Inject lateinit var profile: LocalProfile
    @Inject lateinit var shares: ShareIntake
    @Inject lateinit var repository: NotesRepository
    private val incomingNote = MutableStateFlow<String?>(null)
    private var pendingIntent: Intent? = null
    private var editorExit: (suspend () -> Boolean)? = null

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        pendingIntent = intent
        lifecycleScope.launch {
            if (editorExit?.invoke() == false) { Toast.makeText(this@MainActivity, "请先完成输入并返回列表，再接收分享", Toast.LENGTH_LONG).show(); return@launch }
            handleIncoming(intent)
        }
    }
    private fun handleIncoming(value: Intent) {
        lifecycleScope.launch {
            try {
                val id = when {
                    value.action in setOf(Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE) -> shares.accept(value)
                    value.getStringExtra("profile") != null && value.getStringExtra("profile") != profile.paths.id -> { Toast.makeText(this@MainActivity, "小组件属于旧实例，请刷新小组件", Toast.LENGTH_LONG).show(); null }
                    value.getBooleanExtra("newNote", false) -> withContext(Dispatchers.IO) { repository.create().id }
                    else -> value.getStringExtra("noteId")
                }
                incomingNote.value = id; pendingIntent = null
            } catch (error: Exception) { Toast.makeText(this@MainActivity, error.message ?: "接收分享失败，请重试", Toast.LENGTH_LONG).show() }
        }
    }
    override fun onStart() {
        super.onStart()
        SyncWork.periodic(this, profile.paths.id)
        SyncWork.enqueue(this, profile.paths.id)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (savedInstanceState == null) handleIncoming(intent)
        lifecycleScope.launch { profile.id.drop(1).collect { viewModelStore.clear(); profile.releaseRetired(); recreate() } }
        setContent {
            val look by appearance.state.collectAsStateWithLifecycle()
            val dark = look.theme == "dark" || look.theme == "system" && isSystemInDarkTheme()
            SnotesTheme(dark) {
                var prototype by rememberSaveable { mutableStateOf(false) }
                var noteId by rememberSaveable(profile.paths.id) { mutableStateOf<String?>(null) }
                var tab by rememberSaveable { mutableStateOf("home") }
                var recovery by rememberSaveable { mutableStateOf("") }
                val incoming by incomingNote.collectAsStateWithLifecycle()
                LaunchedEffect(incoming) { incoming?.let { noteId = it; incomingNote.value = null } }
                LaunchedEffect(noteId) { if (noteId == null) { editorExit = null; pendingIntent?.let(::handleIncoming) } }
                val holder = rememberSaveableStateHolder()
                val notesModel: NotesViewModel = viewModel(key = "notes-${profile.paths.id}")
                when {
                    prototype -> EditorPrototypeScreen(onBack = { prototype = false })
                    noteId != null -> LocalEditorScreen(checkNotNull(noteId), onBack = { noteId = null }, font = look.fontSize, isDark = dark, onExitReady = { editorExit = it })
                    else -> Scaffold(bottomBar = {
                        NavigationBar {
                            listOf("home" to "首页", "search" to "搜索", "trash" to "回收站", "books" to "笔记本", "settings" to "设置").forEach { (key, label) ->
                                NavigationBarItem(selected = tab == key, onClick = { tab = key; recovery = "" }, icon = { Text(when(key) { "home" -> "⌂"; "search" -> "⌕"; "trash" -> "♲"; "books" -> "▤"; else -> "⚙" }) }, label = { Text(label) })
                            }
                        }
                    }) { padding ->
                        Box(Modifier.fillMaxSize().padding(bottom = padding.calculateBottomPadding())) {
                            holder.SaveableStateProvider(tab) {
                                when (tab) {
                                    "settings" -> SettingsScreen(notesModel, appearance, onRecovery = { recovery = it; tab = "home" }, onConnect = { recovery = "connect"; tab = "home" }) { DataTools() }
                                    "books" -> BooksManagerScreen(onOpen = { noteId = it })
                                    else -> NotesScreen(onOpen = { noteId = it }, onPrototype = { prototype = true }, section = tab, recovery = recovery, model = notesModel)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SnotesTheme(dark: Boolean, content: @Composable () -> Unit) {
    val colors = if (dark) {
        darkColorScheme(primary = Color(0xFFAFBFFF), background = Color(0xFF1E1F24))
    } else {
        lightColorScheme(primary = Color(0xFF4668E8), background = Color(0xFFF7F8FC))
    }
    MaterialTheme(colorScheme = colors, content = content)
}

