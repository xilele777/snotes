package io.github.xilele777.snotes.feature.editor

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.ReportDrawnWhen
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.net.toUri
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.github.xilele777.snotes.core.editor.EditorWebView
import io.github.xilele777.snotes.core.editor.EditorWebViewPool
import io.github.xilele777.snotes.core.model.visibleCharacterCount
import io.github.xilele777.snotes.core.ui.*
import kotlinx.coroutines.launch

private val headingPrefix = Regex("^#{1,6}\\s*")

private fun fastEditorTitle(markdown: String, hasThumbnail: Boolean, initialized: Boolean): String {
    if (!initialized) return "笔记"
    var start = 0
    val len = markdown.length
    while (start < len) {
        var end = markdown.indexOf('\n', start)
        if (end < 0) end = len
        val line = markdown.substring(start, end).trim()
        if (line.isNotEmpty()) {
            if (!line.startsWith("![")) {
                val cleaned = line.replaceFirst(headingPrefix, "").trim()
                if (cleaned.isNotEmpty()) return cleaned.take(80)
            }
            break
        }
        start = end + 1
    }
    return if (hasThumbnail || markdown.contains("![")) "图片笔记" else "新的笔记"
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LocalEditorScreen(
    noteId: String,
    onBack: () -> Unit,
    font: Int = 16,
    lineSpacing: String = "standard",
    isDark: Boolean = isSystemInDarkTheme(),
    onExitReady: ((suspend () -> Boolean)?) -> Unit = {},
    model: LocalEditorViewModel = viewModel(),
) {
    val colors = MaterialTheme.snotesColors
    val state by model.state.collectAsStateWithLifecycle()
    ReportDrawnWhen { state.loaded || state.failed }
    val openCount by model.openCount.collectAsStateWithLifecycle()
    val history by model.history.collectAsStateWithLifecycle()
    var showingHistory by rememberSaveable(noteId) { mutableStateOf(false) }
    var showingWordCount by rememberSaveable(noteId) { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    LaunchedEffect(noteId) { model.open(noteId) }
    DisposableEffect(noteId, model) {
        model.pinEditor(noteId)
        onDispose { model.unpinEditor(noteId) }
    }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val dark = isDark
    val surfaceArgb = colors.bgSurface.toArgb()
    val textSize = (font * LocalConfiguration.current.fontScale).toInt().coerceIn(12, 48)
    LaunchedEffect(dark, textSize, lineSpacing) { model.appearance(dark, textSize, lineSpacing) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) scope.launch { model.upload(uri) }
    }
    var leaving by remember { mutableStateOf(false) }
    fun exit() {
        if (leaving || state.busy) return
        leaving = true
        scope.launch { try { if (model.leaveAfterFailure()) onBack() } finally { leaving = false } }
    }
    DisposableEffect(model) { onExitReady { model.beforeIncoming() }; onDispose { onExitReady(null) } }
    BackHandler { exit() }
    DisposableEffect(owner, model) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_PAUSE) model.background() }
        owner.lifecycle.addObserver(observer)
        model.openLink = { url -> runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri())) } }
        onDispose { owner.lifecycle.removeObserver(observer); model.openLink = null }
    }
    val webAlpha by animateFloatAsState(
        targetValue = if (state.loaded) 1f else 0f,
        animationSpec = tween(70, easing = SnotesMotion.EaseOut),
        label = "editor-fade",
    )

    val topTitle = remember(state.markdown, state.hasThumbnail, state.initialized) {
        fastEditorTitle(state.markdown, state.hasThumbnail, state.initialized)
    }

    Scaffold(
        containerColor = colors.bgSurface,
        contentWindowInsets = WindowInsets.safeDrawing,
        topBar = {
            SnotesTopBar(
                title = topTitle,
                subtitle = if (!state.failed && state.busy && state.label.isNotBlank()) state.label else null,
                navigationIcon = SnotesSymbol.Back,
                navigationDescription = "返回",
                navigationEnabled = (state.loaded || state.failed) && !leaving && !state.busy,
                onNavigationClick = ::exit,
                containerColor = colors.bgSurface,
                showBottomDivider = true,
                actions = {
                    if (!state.readOnly) {
                        IconButton(
                            onClick = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                            enabled = state.loaded && !state.busy && state.mode != "preview",
                            modifier = Modifier.size(38.dp),
                        ) {
                            SnotesIcon(SnotesSymbol.Image, size = 19.dp, description = "插入图片", tint = colors.textSecondary)
                        }
                    }
                    Box {
                        IconButton(onClick = { menu = true }, modifier = Modifier.size(38.dp)) {
                            SnotesIcon(SnotesSymbol.More, size = 19.dp, description = "更多笔记操作", tint = colors.textSecondary)
                        }
                        if (menu) {
                            DropdownMenu(
                                expanded = true,
                                onDismissRequest = { menu = false },
                                containerColor = colors.bgSurface,
                                shape = RoundedCornerShape(10.dp),
                            ) {
                                if (!state.readOnly) {
                                    DropdownMenuItem(
                                        text = { Text(if (state.mode == "preview") "退出阅读模式" else "阅读模式") },
                                        leadingIcon = { SnotesIcon(if (state.mode == "preview") SnotesSymbol.Edit else SnotesSymbol.Eye, size = 17.dp) },
                                        enabled = state.loaded && !state.busy,
                                        onClick = {
                                            menu = false
                                            model.toggleReading()
                                        },
                                    )
                                    HorizontalDivider(color = colors.divider)
                                }
                                DropdownMenuItem(
                                    text = { Text("字数统计") },
                                    leadingIcon = { SnotesIcon(SnotesSymbol.Info, size = 17.dp) },
                                    enabled = state.initialized,
                                    onClick = {
                                        menu = false
                                        scope.launch {
                                            if (state.loaded) model.flushAndSave()
                                            showingWordCount = true
                                        }
                                    },
                                )
                                DropdownMenuItem(
                                    text = { Text("正文历史") },
                                    leadingIcon = { SnotesIcon(SnotesSymbol.Restore, size = 17.dp) },
                                    enabled = state.loaded,
                                    onClick = { menu = false; scope.launch { model.loadHistory(); showingHistory = true } },
                                )
                                HorizontalDivider(color = colors.divider)
                                DropdownMenuItem(
                                    text = { Text("复制 Markdown") },
                                    leadingIcon = { SnotesIcon(SnotesSymbol.Copy, size = 17.dp) },
                                    enabled = state.initialized,
                                    onClick = {
                                        menu = false
                                        scope.launch {
                                            if (state.loaded) model.flushAndSave()
                                            val clipboard = context.getSystemService(ClipboardManager::class.java)
                                            clipboard?.setPrimaryClip(ClipData.newPlainText("Markdown", model.state.value.markdown))
                                            Toast.makeText(context, "已复制 Markdown", Toast.LENGTH_SHORT).show()
                                        }
                                    },
                                )
                                DropdownMenuItem(
                                    text = { Text("分享") },
                                    leadingIcon = { SnotesIcon(SnotesSymbol.Share, size = 17.dp) },
                                    enabled = state.initialized,
                                    onClick = {
                                        menu = false
                                        scope.launch {
                                            if (!model.flushAndSave() && !model.state.value.failed) return@launch
                                            context.startActivity(
                                                Intent.createChooser(
                                                    Intent(Intent.ACTION_SEND).apply {
                                                        type = "text/plain"
                                                        putExtra(Intent.EXTRA_TEXT, model.state.value.markdown)
                                                    },
                                                    "分享当前正文",
                                                ),
                                            )
                                        }
                                    },
                                )
                            }
                        }
                    }
                },
            )
        },
    ) { insets ->
        Column(
            Modifier
                .fillMaxSize()
                .background(colors.bgSurface)
                .padding(insets)
                .consumeWindowInsets(insets)
                .semantics { contentDescription = if (state.loaded) "编辑器已就绪" else "编辑器正在加载" },
        ) {
            if (state.failed) {
                SnotesCard(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                    containerColor = colors.dangerBg,
                    borderColor = colors.danger.copy(alpha = 0.25f),
                ) {
                    Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            SnotesIcon(SnotesSymbol.Alert, size = 18.dp, tint = colors.danger)
                            Text(state.label, style = MaterialTheme.typography.bodyMedium, color = colors.danger, modifier = Modifier.weight(1f))
                        }
                        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (!state.initialized) TextButton(onClick = { model.open(noteId) }) { Text("重试读取") }
                            if (state.initialized) {
                                TextButton(onClick = {
                                    scope.launch {
                                        model.saveCapturedAsCopy()?.let {
                                            Toast.makeText(context, "草稿已另存，可返回列表查看", Toast.LENGTH_LONG).show()
                                        }
                                    }
                                }) { Text("当前草稿另存为笔记") }
                            }
                            if (state.loaded) TextButton(onClick = { scope.launch { model.flushAndSave() } }) { Text("重试保存") }
                            if (!state.loaded && state.initialized) TextButton(onClick = model::retryEditor) { Text("重试编辑器") }
                        }
                    }
                }
            }
            if (state.initialized && state.noteId == noteId) {
                Box(Modifier.fillMaxWidth().weight(1f).background(colors.bgSurface)) {
                    key(state.hostGeneration) {
                        AndroidView(
                            factory = { ctx ->
                                EditorWebViewPool.acquire(ctx, model::receive, model::webFailed).apply {
                                    setBackgroundColor(surfaceArgb)
                                    model.attach(this, dark, textSize, lineSpacing)
                                }
                            },
                            update = { view -> view.setBackgroundColor(surfaceArgb) },
                            modifier = Modifier.fillMaxSize().alpha(webAlpha),
                            onRelease = { view ->
                                model.detach(view)
                                EditorWebViewPool.release(view)
                            },
                        )
                    }
                }
            }
        }
    }

    if (showingWordCount) {
        val visibleChars = remember(state.markdown) { visibleCharacterCount(state.markdown) }
        val lineCount = remember(state.markdown) { if (state.markdown.isEmpty()) 0 else state.markdown.lines().size }
        AlertDialog(
            onDismissRequest = { showingWordCount = false },
            containerColor = colors.bgSurface,
            shape = RoundedCornerShape(18.dp),
            title = { Text("字数统计", style = MaterialTheme.typography.titleLarge) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("字数", style = MaterialTheme.typography.bodyMedium, color = colors.textSecondary)
                        Text("$visibleChars", style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold), color = colors.textPrimary)
                    }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("总字符", style = MaterialTheme.typography.bodyMedium, color = colors.textSecondary)
                        Text("${state.markdown.length}", style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold), color = colors.textPrimary)
                    }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("行数", style = MaterialTheme.typography.bodyMedium, color = colors.textSecondary)
                        Text("$lineCount", style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold), color = colors.textPrimary)
                    }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("累计打开", style = MaterialTheme.typography.bodyMedium, color = colors.textSecondary)
                        Text("$openCount 次", style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold), color = colors.textPrimary)
                    }
                }
            },
            confirmButton = { TextButton(onClick = { showingWordCount = false }) { Text("关闭") } },
        )
    }

    if (showingHistory) {
        AlertDialog(
            onDismissRequest = { showingHistory = false },
            containerColor = colors.bgSurface,
            shape = RoundedCornerShape(18.dp),
            title = { Text("正文历史", style = MaterialTheme.typography.titleLarge) },
            text = {
                LazyColumn(Modifier.heightIn(max = 380.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    item {
                        Text(
                            "本机打开 $openCount 次",
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.textTertiary,
                        )
                    }
                    items(history.size) { index ->
                        val item = history[index]
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                                Text(
                                    java.text.DateFormat.getDateTimeInstance().format(java.util.Date(item.time)),
                                    style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
                                    color = colors.textPrimary,
                                )
                                if (!state.readOnly) {
                                    TextButton(
                                        onClick = { scope.launch { model.restoreHistory(item.markdown); showingHistory = false } },
                                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp),
                                    ) { Text("恢复此正文") }
                                }
                            }
                            Surface(shape = RoundedCornerShape(10.dp), color = colors.bgList) {
                                Text(
                                    item.markdown.take(300),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = colors.textSecondary,
                                    maxLines = 4,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.fillMaxWidth().padding(10.dp),
                                )
                            }
                            if (index < history.lastIndex) HorizontalDivider(color = colors.divider)
                        }
                    }
                    if (history.isEmpty()) {
                        item { Text("暂无正文历史", style = MaterialTheme.typography.bodyMedium, color = colors.textTertiary) }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { showingHistory = false }) { Text("关闭") } },
        )
    }
}
