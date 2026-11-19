package io.github.xilele777.snotes.feature.editor

import android.content.Intent
import android.widget.Toast
import androidx.core.net.toUri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.github.xilele777.snotes.core.editor.EditorWebView
import kotlinx.coroutines.launch

@Composable
fun LocalEditorScreen(noteId: String, onBack: () -> Unit, font: Int = 16, isDark: Boolean = isSystemInDarkTheme(), onExitReady: ((suspend () -> Boolean)?) -> Unit = {}, model: LocalEditorViewModel = viewModel()) {
    val state by model.state.collectAsStateWithLifecycle()
    val openCount by model.openCount.collectAsStateWithLifecycle()
    val history by model.history.collectAsStateWithLifecycle()
    var showingHistory by remember { mutableStateOf(false) }
    LaunchedEffect(noteId) { model.open(noteId) }
    DisposableEffect(noteId, model) {
        model.pinEditor(noteId)
        onDispose { model.unpinEditor(noteId) }
    }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val dark = isDark
    val textSize = (font * LocalConfiguration.current.fontScale).toInt().coerceIn(12, 48)
    LaunchedEffect(dark, textSize) { model.appearance(dark, textSize) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> if (uri != null) scope.launch { model.upload(uri) } }
    var leaving by remember { mutableStateOf(false) }
    fun exit() {
        if (leaving || state.busy) return
        leaving = true
        scope.launch { try { if (model.leaveAfterFailure()) onBack() } finally { leaving = false } }
    }
    DisposableEffect(model) { onExitReady { model.leaveAfterFailure() }; onDispose { onExitReady(null) } }
    BackHandler { exit() }
    DisposableEffect(owner, model) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_PAUSE) model.background() }
        owner.lifecycle.addObserver(observer)
        model.openLink = { url -> runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri())) } }
        onDispose { owner.lifecycle.removeObserver(observer); model.openLink = null }
    }
    Scaffold(modifier = Modifier.imePadding()) { insets ->
        Column(Modifier.fillMaxSize().padding(insets)) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                TextButton(onClick = { exit() }, enabled = (state.loaded || state.failed) && !leaving && !state.busy) { Text("返回") }
                Text("笔记 · 打开 $openCount 次", modifier = Modifier.padding(top = 14.dp), style = MaterialTheme.typography.titleMedium)
                TextButton(onClick = {
                    scope.launch {
                        if (!model.flushAndSave() && !model.state.value.failed) return@launch
                        context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"; putExtra(Intent.EXTRA_TEXT, model.state.value.markdown)
                        }, "分享当前正文"))
                    }
                }, enabled = state.initialized) { Text("分享") }
            }
            Text(state.label, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                color = if (state.failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall)
            Row {
                TextButton(onClick = model::toggleReading, enabled = state.loaded && !state.busy) { Text(if (state.mode == "preview") "编辑" else "阅读") }
                if (!state.readOnly) TextButton(onClick = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, enabled = state.loaded && !state.busy && state.mode != "preview") { Text("插入图片") }
                TextButton(onClick = { scope.launch { model.loadHistory(); showingHistory = true } }, enabled = state.loaded) { Text("历史") }
            }
            if (state.failed && !state.initialized) TextButton(onClick = { model.open(noteId) }) { Text("重试读取") }
            if (state.failed && state.initialized) TextButton(onClick = { scope.launch {
                model.saveCapturedAsCopy()?.let { Toast.makeText(context, "草稿已另存，可返回列表查看", Toast.LENGTH_LONG).show() }
            } }) { Text("当前草稿另存为笔记") }
            if (state.failed && state.loaded) TextButton(onClick = { scope.launch { model.flushAndSave() } }) { Text("重试保存") }
            if (state.failed && !state.loaded && state.initialized) TextButton(onClick = model::retryEditor) { Text("重试编辑器") }
            if (state.initialized && state.noteId == noteId) {
                key(state.hostGeneration) {
                    AndroidView(
                        factory = { ctx -> EditorWebView(ctx, model::receive, model::webFailed).also { model.attach(it, dark, textSize) } },
                        modifier = Modifier.fillMaxWidth().weight(1f),
                        onRelease = { model.detach(it); it.dispose() },
                    )
                }
            } else if (!state.failed) CircularProgressIndicator(Modifier.padding(24.dp))
        }
    }
    if (showingHistory) AlertDialog(onDismissRequest = { showingHistory = false }, title = { Text("正文历史") }, text = {
        androidx.compose.foundation.lazy.LazyColumn { items(history.size) { index -> val item = history[index]; Column {
            Text(java.text.DateFormat.getDateTimeInstance().format(java.util.Date(item.time))); Text(item.markdown.take(300))
            if (!state.readOnly) TextButton(onClick = { scope.launch { model.restoreHistory(item.markdown); showingHistory = false } }) { Text("恢复此正文") }
        } }; if (history.isEmpty()) item { Text("暂无正文历史") } }
    }, confirmButton = { TextButton(onClick = { showingHistory = false }) { Text("关闭") } })
}
