package io.github.xilele777.snotes.feature.editor

import android.content.Intent
import androidx.core.net.toUri
import androidx.activity.compose.BackHandler
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
fun EditorPrototypeScreen(onBack: () -> Unit, model: EditorPrototypeViewModel = viewModel()) {
    val state by model.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val dark = isSystemInDarkTheme()
    val textSize = (16 * LocalConfiguration.current.fontScale).toInt().coerceIn(12, 48)
    var leaving by remember { mutableStateOf(false) }
    fun exit() {
        if (leaving || state.busy) return
        leaving = true
        scope.launch { try { if (model.leaveAfterFailure()) onBack() } finally { leaving = false } }
    }
    BackHandler { exit() }
    DisposableEffect(owner, model) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_PAUSE) model.background() }
        owner.lifecycle.addObserver(observer)
        model.openLink = { url -> runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri())) } }
        onDispose { owner.lifecycle.removeObserver(observer); model.openLink = null }
    }
    Scaffold(contentWindowInsets = WindowInsets.safeDrawing) { insets ->
        Column(Modifier.fillMaxSize().padding(insets).consumeWindowInsets(insets)) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                TextButton(onClick = { exit() }, enabled = (state.loaded || state.failed) && !leaving && !state.busy) { Text("返回") }
                Text("编辑器原型", modifier = Modifier.padding(top = 14.dp), style = MaterialTheme.typography.titleMedium)
                TextButton(onClick = {
                    scope.launch {
                        model.flushAndSave()
                        context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"; putExtra(Intent.EXTRA_TEXT, model.state.value.markdown)
                        }, "分享当前正文"))
                    }
                }, enabled = state.initialized) { Text("分享") }
            }
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp)) {
                listOf("sample-a" to "样例 A", "sample-b" to "样例 B", "sample-long" to "长文").forEach { (id, title) ->
                    TextButton(onClick = { model.switchNote(id) }, enabled = state.loaded && !state.busy && !leaving) {
                        Text(if (id == state.noteId) "● $title" else title)
                    }
                }
            }
            Text(state.label, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                color = if (state.failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall)
            if (state.failed && state.loaded) TextButton(onClick = { scope.launch { model.flushAndSave() } }) { Text("重试保存") }
            if (state.failed && !state.loaded && state.initialized) TextButton(onClick = model::retryEditor) { Text("重试编辑器") }
            if (state.initialized) {
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
}
