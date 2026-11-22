package io.github.xilele777.snotes.app

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.*
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.viewmodel.compose.viewModel
import dagger.hilt.android.AndroidEntryPoint
import io.github.xilele777.snotes.BuildConfig
import io.github.xilele777.snotes.core.data.Appearance
import io.github.xilele777.snotes.core.data.NotesRepository
import io.github.xilele777.snotes.core.data.ShareIntake
import io.github.xilele777.snotes.core.database.LocalProfile
import io.github.xilele777.snotes.core.editor.EditorWebViewPool
import io.github.xilele777.snotes.core.sync.SyncWork
import io.github.xilele777.snotes.core.ui.*
import io.github.xilele777.snotes.feature.editor.EditorPrototypeScreen
import io.github.xilele777.snotes.feature.editor.LocalEditorScreen
import io.github.xilele777.snotes.feature.notes.*
import java.io.File
import javax.inject.Inject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class AppIdentity @Inject constructor() {
    val versionName: String get() = BuildConfig.VERSION_NAME
}

private sealed interface RootRoute {
    data object Workspace : RootRoute
    data class Editor(val noteId: String) : RootRoute
    data object Prototype : RootRoute
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
            if (editorExit?.invoke() == false) {
                Toast.makeText(this@MainActivity, "请先完成输入并返回列表，再接收分享", Toast.LENGTH_LONG).show()
                return@launch
            }
            handleIncoming(intent)
        }
    }

    private fun handleIncoming(value: Intent) {
        lifecycleScope.launch {
            try {
                val id = when {
                    value.action in setOf(Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE) -> shares.accept(value)
                    value.getStringExtra("profile") != null && value.getStringExtra("profile") != profile.paths.id -> {
                        Toast.makeText(this@MainActivity, "小组件属于旧实例，请刷新小组件", Toast.LENGTH_LONG).show()
                        null
                    }
                    value.getBooleanExtra("newNote", false) -> withContext(Dispatchers.IO) { repository.create().id }
                    else -> value.getStringExtra("noteId")
                }
                incomingNote.value = id
                pendingIntent = null
            } catch (error: Exception) {
                Toast.makeText(this@MainActivity, error.message ?: "接收分享失败，请重试", Toast.LENGTH_LONG).show()
            }
        }
    }

    override fun onStart() {
        super.onStart()
        SyncWork.periodic(this, profile.paths.id)
        SyncWork.enqueue(this, profile.paths.id)
    }

    override fun onDestroy() {
        EditorWebViewPool.clear(this)
        super.onDestroy()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (savedInstanceState == null) {
            handleIncoming(intent)
            lifecycleScope.launch(Dispatchers.IO) {
                // Prune ephemeral Chromium HTTP/shader disk caches since the offline editor loads only packaged assets.
                listOf("WebView", "org.chromium.android_webview").forEach { dir ->
                    runCatching { File(cacheDir, dir).deleteRecursively() }
                }
            }
        }
        lifecycleScope.launch { profile.id.drop(1).collect { EditorWebViewPool.clear(this@MainActivity); viewModelStore.clear(); profile.releaseRetired(); recreate() } }
        setContent {
            val look by appearance.state.collectAsStateWithLifecycle()
            val dark = look.theme == "dark" || (look.theme == "system" && isSystemInDarkTheme())
            SideEffect {
                enableEdgeToEdge(
                    statusBarStyle = SystemBarStyle.auto(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT) { dark },
                    navigationBarStyle = SystemBarStyle.auto(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT) { dark },
                )
                if (android.os.Build.VERSION.SDK_INT >= 29) window.isNavigationBarContrastEnforced = false
            }
            SnotesTheme(dark) {
                val colors = MaterialTheme.snotesColors
                var prototype by rememberSaveable { mutableStateOf(false) }
                var noteId by rememberSaveable(profile.paths.id) { mutableStateOf(incomingNote.value) }
                var tab by rememberSaveable { mutableStateOf("home") }
                var workspaceReturn by rememberSaveable { mutableStateOf("home") }
                var recovery by rememberSaveable { mutableStateOf("") }
                var showingConnectionSheet by rememberSaveable { mutableStateOf(false) }
                val incoming by incomingNote.collectAsStateWithLifecycle()
                LaunchedEffect(incoming) { incoming?.let { noteId = it; incomingNote.value = null } }
                LaunchedEffect(noteId) { if (noteId == null) { editorExit = null; pendingIntent?.let(::handleIncoming) } }
                val holder = rememberSaveableStateHolder()

                val notesModel: NotesViewModel = viewModel(key = "notes-${profile.paths.id}")
                val initialized by notesModel.initialized.collectAsStateWithLifecycle()
                LaunchedEffect(initialized) {
                    if (initialized) {
                        delay(220)
                        EditorWebViewPool.prewarm(this@MainActivity)
                    }
                }

                val utilityPages = setOf("settings", "stats", "trash")
                fun navigate(destination: String) {
                    if (destination in utilityPages && tab !in utilityPages) workspaceReturn = tab
                    tab = destination
                    recovery = ""
                    if (destination !in setOf("settings", "stats", "books")) notesModel.setSection(destination)
                }
                fun returnToWorkspace() { navigate(workspaceReturn) }

                val route: RootRoute = when {
                    prototype -> RootRoute.Prototype
                    noteId != null -> RootRoute.Editor(checkNotNull(noteId))
                    else -> RootRoute.Workspace
                }

                AnimatedContent(
                    targetState = route,
                    modifier = Modifier.fillMaxSize().background(colors.bgList),
                    transitionSpec = {
                        val enteringEditor = targetState is RootRoute.Editor && initialState is RootRoute.Workspace
                        val leavingEditor = targetState is RootRoute.Workspace && initialState is RootRoute.Editor
                        when {
                            enteringEditor -> ContentTransform(
                                targetContentEnter = slideInHorizontally(tween(SnotesMotion.PageMs, easing = SnotesMotion.PageSlide)) { it },
                                initialContentExit = slideOutHorizontally(tween(SnotesMotion.PageMs, easing = SnotesMotion.PageSlide)) { -it / 4 },
                                targetContentZIndex = 1f,
                            )
                            leavingEditor -> ContentTransform(
                                targetContentEnter = slideInHorizontally(tween(SnotesMotion.PageMs, easing = SnotesMotion.PageSlide)) { -it / 4 },
                                initialContentExit = slideOutHorizontally(tween(SnotesMotion.PageMs, easing = SnotesMotion.PageSlide)) { it },
                                targetContentZIndex = 0f,
                            )
                            else -> fadeIn(tween(SnotesMotion.FastMs)) togetherWith fadeOut(tween(SnotesMotion.FastMs))
                        }
                    },
                    label = "root-route",
                ) { activeRoute ->
                    when (activeRoute) {
                        RootRoute.Prototype -> EditorPrototypeScreen(onBack = { prototype = false })
                        is RootRoute.Editor -> LocalEditorScreen(
                            noteId = activeRoute.noteId,
                            onBack = { noteId = null },
                            font = look.fontSize,
                            lineSpacing = look.lineSpacing,
                            isDark = dark,
                            onExitReady = { editorExit = it },
                        )
                        RootRoute.Workspace -> {
                            WorkspaceNavigation(
                                section = tab,
                                model = notesModel,
                                onNavigate = ::navigate,
                                onConnect = { showingConnectionSheet = true },
                                onFailures = { navigate("all"); recovery = "failures" },
                            ) { openDrawer, drawerOpen ->
                                BackHandler(tab in utilityPages && !drawerOpen) { returnToWorkspace() }
                                // Keep a single NotesScreen mounted across all note sections (home/all/star/hidden/trash/group:*)
                                // so switching note filters never destroys the list or double-collects PagingData.
                                val surface = when (tab) {
                                    "settings", "stats", "books" -> tab
                                    else -> "notes"
                                }
                                AnimatedContent(
                                    targetState = surface,
                                    transitionSpec = {
                                        fadeIn(tween(SnotesMotion.FastMs, easing = SnotesMotion.EaseOut)) togetherWith
                                            fadeOut(tween(90, easing = SnotesMotion.EaseOut))
                                    },
                                    label = "workspace-surface",
                                ) { activeSurface ->
                                    holder.SaveableStateProvider(activeSurface) {
                                        when (activeSurface) {
                                            "settings" -> {
                                                val dataToolsModel: DataToolsModel = viewModel(key = "tools-${profile.paths.id}")
                                                SettingsScreen(
                                                    model = notesModel,
                                                    appearance = appearance,
                                                    onRecovery = { action -> navigate("all"); recovery = action },
                                                    onConnect = { showingConnectionSheet = true },
                                                    onPrototype = { prototype = true },
                                                    onDrawer = openDrawer,
                                                ) { DataTools(model = dataToolsModel) }
                                            }
                                            "stats" -> {
                                                val dataToolsModel: DataToolsModel = viewModel(key = "tools-${profile.paths.id}")
                                                StatsScreen(
                                                    onDrawer = openDrawer,
                                                    onOpenNote = { noteId = it },
                                                    model = dataToolsModel,
                                                )
                                            }
                                            "books" -> {
                                                val booksModel: BooksManagerModel = viewModel(key = "books-${profile.paths.id}")
                                                val syncState by notesModel.syncStatus.collectAsStateWithLifecycle()
                                                BooksManagerScreen(
                                                    onOpen = { noteId = it },
                                                    model = booksModel,
                                                    onDrawer = openDrawer,
                                                    syncRunning = syncState.running,
                                                    onRefresh = {
                                                        if (syncState.connected) notesModel.synchronize()
                                                    },
                                                )
                                            }
                                            else -> NotesScreen(
                                                onOpen = { noteId = it },
                                                section = tab,
                                                recovery = recovery,
                                                noteDensity = look.noteDensity,
                                                showNotePreview = look.showNotePreview,
                                                model = notesModel,
                                                onDrawer = openDrawer,
                                                onRecoveryHandled = { recovery = "" },
                                            )
                                        }
                                    }
                                }
                            }
                            if (showingConnectionSheet) {
                                ServerConnectionSheet(
                                    model = notesModel,
                                    onDismiss = { showingConnectionSheet = false },
                                    onOpenFailures = { navigate("all"); recovery = "failures" },
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
