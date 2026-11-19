package io.github.xilele777.snotes.feature.notes

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.xilele777.snotes.BuildConfig
import io.github.xilele777.snotes.core.data.Appearance
import kotlinx.coroutines.launch

@Composable fun BooksScreen(model: NotesViewModel, onOpen: (String) -> Unit) {
    val books by model.books.collectAsStateWithLifecycle()
    val tocs by model.tocs.collectAsStateWithLifecycle()
    var selected by remember { mutableStateOf<String?>(null) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item { Text("笔记本", style = MaterialTheme.typography.headlineMedium); Text("目录保存在本机；正文未下载或在回收站的引用无法编辑。") }
        items(books.filter { it.invalid == 0 }, key = { it.id }) { book ->
            Card(Modifier.fillMaxWidth()) {
                TextButton(onClick = { selected = if (selected == book.id) null else book.id }) { Text(book.name) }
                if (selected == book.id) {
                    val nodes = tocs.filter { it.knowledgeBaseId == book.id }
                    fun visit(parent: String?, depth: Int): List<Pair<io.github.xilele777.snotes.core.database.TocEntity, Int>> =
                        if (depth >= 8) emptyList() else nodes.filter { it.parentId == parent }.sortedWith(compareBy({ it.sort }, { it.id })).flatMap { listOf(it to depth) + visit(it.id, depth + 1) }
                    for ((node, depth) in visit(null, 0)) {
                        var label by remember(node.noteId, node.name, book.tocVersion) { mutableStateOf(node.name) }
                        var available by remember(node.noteId, book.tocVersion) { mutableStateOf(false) }
                        LaunchedEffect(node.noteId, book.tocVersion) { node.noteId?.let { val result = model.noteTitle(it); label = result.first; available = result.second } }
                        Text((if (node.noteId == null) "▸ " else "• ") + label + if (node.noteId != null && !available) "（不可用）" else "",
                            Modifier.fillMaxWidth().clickable(enabled = available) { onOpen(node.noteId!!) }.padding(start = (16 + depth * 12).dp, top = 10.dp, bottom = 10.dp))
                    }
                    if (nodes.isEmpty()) Text("目录为空", Modifier.padding(16.dp))
                }
            }
        }
        if (books.none { it.invalid == 0 }) item { Text("还没有笔记本，连接并同步后目录会出现在这里。") }
    }
}

@Composable fun SettingsScreen(model: NotesViewModel, appearance: Appearance, onRecovery: (String) -> Unit, onConnect: () -> Unit, extras: @Composable ColumnScope.() -> Unit = {}) {
    val sync by model.syncStatus.collectAsStateWithLifecycle()
    val pending by model.pending.collectAsStateWithLifecycle()
    val failures by model.syncFailures.collectAsStateWithLifecycle()
    val issues by model.issues.collectAsStateWithLifecycle()
    val look by appearance.state.collectAsStateWithLifecycle()
    var origin by remember { mutableStateOf<String?>(null) }
    var profiles by remember { mutableStateOf(emptyList<String>()) }
    var switching by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { origin = model.origin(); profiles = model.profiles() }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Text("设置", style = MaterialTheme.typography.headlineMedium); Text("Snotes ${BuildConfig.VERSION_NAME} · 内部验收版") }
        item { Column {
            Text(origin ?: "本机离线空间"); Text(sync.message); Text("$pending 项待同步")
            Row { TextButton(onClick = onConnect, enabled = !switching) { Text("接入 / 修复令牌") }; TextButton(onClick = model::synchronize, enabled = !sync.running) { Text("立即同步") } }
            Row { TextButton(onClick = model::retrySync, enabled = !sync.running) { Text("重试失败") }; TextButton(onClick = model::stopSync, enabled = sync.running) { Text("停止同步") } }
            Text("后台由 Android 按网络、电量与省电策略调度，强制停止后需重新打开应用。", style = MaterialTheme.typography.bodySmall)
        } }
        item { Column {
            Text("阅读外观", style = MaterialTheme.typography.titleMedium)
            Row { listOf("system" to "跟随系统", "light" to "浅色", "dark" to "深色").forEach { (key, label) -> TextButton(onClick = { appearance.set(theme = key) }) { Text((if (look.theme == key) "● " else "") + label) } } }
            Text("正文字号 ${look.fontSize}"); Slider(look.fontSize.toFloat(), { appearance.set(font = it.toInt()) }, valueRange = 12f..28f, steps = 15)
        } }
        item { Column {
            TextButton(onClick = { onRecovery("drafts") }) { Text("恢复草稿（${issues.size}）") }
            TextButton(onClick = { onRecovery("failures") }) { Text("失败改动 / 冲突副本（${failures.size}）") }
        } }
        item { Column {
            Text("保留的本机实例", style = MaterialTheme.typography.titleMedium)
            Text("切换保留各自数据和任务，不会把旧数据上传到新实例。")
            profiles.forEach { id -> TextButton(onClick = { switching = true; scope.launch { try { model.switchProfile(id) } finally { switching = false } } }, enabled = !switching && !sync.running) { Text(if (id == "local-default") "初始本机空间" else id.take(8)) } }
        } }
        item { Column(content = extras) }
    }
}
