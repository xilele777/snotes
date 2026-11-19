package io.github.xilele777.snotes.feature.notes

import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.paging.LoadState
import androidx.paging.compose.collectAsLazyPagingItems
import androidx.paging.compose.itemKey
import io.github.xilele777.snotes.BuildConfig
import io.github.xilele777.snotes.R
import io.github.xilele777.snotes.core.database.NoteEntity
import kotlinx.coroutines.*

@Composable
fun NotesScreen(onOpen: (String) -> Unit, onPrototype: () -> Unit, model: NotesViewModel = viewModel()) {
    val filter by model.filter.collectAsStateWithLifecycle()
    val initialized by model.initialized.collectAsStateWithLifecycle()
    val groups by model.groups.collectAsStateWithLifecycle()
    val pending by model.pending.collectAsStateWithLifecycle()
    val sync by model.syncStatus.collectAsStateWithLifecycle()
    val syncFailures by model.syncFailures.collectAsStateWithLifecycle()
    val missing by model.missingBodies.collectAsStateWithLifecycle()
    val issues by model.issues.collectAsStateWithLifecycle()
    val message by model.message.collectAsStateWithLifecycle()
    val notes = model.pages.collectAsLazyPagingItems()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val snackbar = remember { SnackbarHostState() }
    var creating by remember { mutableStateOf(false) }
    var groupMenu by remember { mutableStateOf(false) }
    var groupName by remember { mutableStateOf<String?>(null) }
    var assigning by remember { mutableStateOf<NoteEntity?>(null) }
    var deleting by remember { mutableStateOf<NoteEntity?>(null) }
    var recovering by remember { mutableStateOf(false) }
    var connecting by remember { mutableStateOf(false) }
    var serverOrigin by remember { mutableStateOf("") }
    var serverToken by remember { mutableStateOf("") }
    var checkingConnection by remember { mutableStateOf(false) }
    var showingSyncFailures by remember { mutableStateOf(false) }
    val exporter = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/markdown")) { uri ->
        val text = model.exportSnapshot; model.exportSnapshot = null
        if (uri != null && text == null) scope.launch { snackbar.showSnackbar("导出已中断，请重新选择导出") }
        if (uri != null && text != null) scope.launch {
            val result = withContext(Dispatchers.IO) { runCatching {
                checkNotNull(context.contentResolver.openOutputStream(uri, "wt")).use { it.write(text.toByteArray(Charsets.UTF_8)) }
            } }
            snackbar.showSnackbar(if (result.isSuccess) "Markdown 已导出" else "导出失败，本机正文已保留")
        }
    }
    LaunchedEffect(message) { message?.let { snackbar.showSnackbar(it); model.clearMessage() } }
    Scaffold(snackbarHost = { SnackbarHost(snackbar) }, floatingActionButton = {
        FloatingActionButton(onClick = {
            if (initialized && !creating) { creating = true; scope.launch { try { model.create()?.let(onOpen) } finally { creating = false } } }
        }) { Text(if (!initialized) "读取中" else if (creating) "创建中" else "新建") }
    }) { insets ->
        Column(Modifier.fillMaxSize().padding(insets)) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(stringResource(R.string.app_name), style = MaterialTheme.typography.headlineMedium)
                Text(stringResource(R.string.version_label, BuildConfig.VERSION_NAME), style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(top = 12.dp))
            }
            Text("本机笔记 · $pending 项待同步 · ${sync.message}", style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 16.dp))
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp)) {
                TextButton(onClick = { connecting = true }, enabled = initialized && !sync.running) { Text("服务端连接") }
                TextButton(onClick = model::synchronize, enabled = initialized && !sync.running) { Text("立即同步") }
                if (sync.connected) TextButton(onClick = model::retrySync, enabled = !sync.running) { Text("重试失败") }
                if (sync.running) TextButton(onClick = model::stopSync) { Text("停止同步") }
            }
            OutlinedTextField(value = filter.query, onValueChange = { model.filter.value = filter.copy(query = it.take(256)) },
                label = { Text("搜索本机笔记") }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp))
            Text("搜索标题、摘要与本机正文；$missing 篇正文尚未下载", style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(horizontal = 16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp)) {
                TextButton(onClick = { model.filter.value = filter.copy(trash = false, starred = false) }) { Text(if (!filter.trash && !filter.starred) "● 全部" else "全部") }
                TextButton(onClick = { model.filter.value = filter.copy(trash = false, starred = true) }) { Text(if (filter.starred) "● 星标" else "星标") }
                TextButton(onClick = { model.filter.value = filter.copy(trash = true, starred = false) }) { Text(if (filter.trash) "● 回收站" else "回收站") }
                Box {
                    TextButton(onClick = { groupMenu = true }) { Text(groups.firstOrNull { it.id == filter.groupId }?.name ?: "分组") }
                    DropdownMenu(expanded = groupMenu, onDismissRequest = { groupMenu = false }) {
                        DropdownMenuItem(text = { Text("所有分组") }, onClick = { model.filter.value = filter.copy(groupId = null); groupMenu = false })
                        groups.forEach { group -> DropdownMenuItem(text = { Text(group.name) }, onClick = { model.filter.value = filter.copy(groupId = group.id); groupMenu = false }) }
                        DropdownMenuItem(text = { Text("新建分组") }, onClick = { groupMenu = false; groupName = "" })
                    }
                }
            }
            if (issues.isNotEmpty()) {
                TextButton(onClick = { recovering = true }) { Text("${issues.size} 份草稿需要处理", color = MaterialTheme.colorScheme.error) }
            }
            if (syncFailures.isNotEmpty()) TextButton(onClick = { showingSyncFailures = true }) { Text("${syncFailures.size} 项同步失败，查看与恢复", color = MaterialTheme.colorScheme.error) }
            if (!initialized) TextButton(onClick = model::retryRecovery) { Text("重试读取本机数据") }
            if (notes.loadState.refresh is LoadState.Error) TextButton(onClick = { model.retryRecovery(); notes.retry() }) { Text("本机读取失败，重试") }
            LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 96.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (notes.itemCount == 0 && notes.loadState.refresh !is LoadState.Loading) item {
                    Text(if (!initialized) "正在读取本机笔记…" else if (filter.query.isNotBlank()) "没有本机匹配结果" else if (filter.trash) "回收站为空" else "还没有笔记，点击新建开始写作", modifier = Modifier.padding(vertical = 32.dp))
                }
                items(notes.itemCount, key = notes.itemKey { it.id }) { index ->
                    notes[index]?.let { note ->
                        NoteCard(note, groups.firstOrNull { it.id == note.groupId }?.name, onOpen = { if (!filter.trash) onOpen(note.id) },
                            onStar = { scope.launch { model.star(note) } }, onGroup = { assigning = note },
                            onTrash = { if (filter.trash) scope.launch { model.trash(note.id, false) } else deleting = note },
                            onExport = { scope.launch { model.export(note.id)?.let { text ->
                                model.exportSnapshot = text; exporter.launch("${note.title.ifBlank { "无标题" }.replace(Regex("[\\\\/:*?\"<>|]"), "_")}.md")
                            } } })
                    }
                }
                if (notes.loadState.append is LoadState.Error) item { TextButton(onClick = notes::retry) { Text("加载更多失败，重试") } }
            }
            if (BuildConfig.DEBUG) TextButton(onClick = onPrototype, modifier = Modifier.padding(horizontal = 8.dp)) { Text("打开离线编辑器原型") }
        }
    }
    if (showingSyncFailures) AlertDialog(onDismissRequest = { showingSyncFailures = false }, title = { Text("同步失败的改动") },
        text = { LazyColumn { items(syncFailures.size) { index ->
            val failure = syncFailures[index]
            Column {
                Text(failure.title); Text(failure.task.lastError ?: "服务端未接受改动，本机内容已保留")
                if (failure.task.entityType == "note") Row {
                    TextButton(onClick = { scope.launch { model.copyFailed(failure.task.id)?.let { showingSyncFailures = false; onOpen(it) } } }) { Text("另存为新笔记") }
                    TextButton(onClick = { scope.launch { model.export(failure.task.entityId)?.let { text ->
                        model.exportSnapshot = text; exporter.launch("恢复笔记.md")
                    } } }) { Text("导出 Markdown") }
                }
                HorizontalDivider()
            }
        } } }, confirmButton = { TextButton(onClick = { showingSyncFailures = false; model.retrySync() }) { Text("重试失败改动") } },
        dismissButton = { TextButton(onClick = { showingSyncFailures = false }) { Text("关闭") } })
    if (connecting) AlertDialog(onDismissRequest = { if (!checkingConnection) { connecting = false; serverToken = "" } },
        title = { Text("连接服务端") }, text = { Column {
            Text("首次接入后，立即同步会上传本机笔记。更换实例将在后续版本提供独立数据入口。")
            OutlinedTextField(serverOrigin, { serverOrigin = it.take(2048) }, label = { Text("服务端 origin（https://…）") }, singleLine = true, enabled = !checkingConnection)
            OutlinedTextField(serverToken, { serverToken = it.take(8192) }, label = { Text("Owner 令牌") }, singleLine = true,
                visualTransformation = PasswordVisualTransformation(), enabled = !checkingConnection)
        } }, confirmButton = { TextButton(onClick = {
            checkingConnection = true
            scope.launch { try { if (model.connect(serverOrigin, serverToken)) { connecting = false; serverToken = "" } }
                finally { checkingConnection = false } }
        }, enabled = !checkingConnection && serverOrigin.isNotBlank() && serverToken.isNotBlank()) { Text(if (checkingConnection) "验证中…" else "验证连接") } },
        dismissButton = { TextButton(onClick = { connecting = false; serverToken = "" }, enabled = !checkingConnection) { Text("取消") } })
    if (recovering) AlertDialog(onDismissRequest = { recovering = false }, title = { Text("恢复草稿") },
        text = { LazyColumn {
            items(issues.size) { index ->
                val issue = issues[index]
                Column {
                    Text("草稿 ${index + 1}", style = MaterialTheme.typography.labelSmall)
                    Text(issue.message)
                    Row {
                        if (issue.snapshot != null) {
                            TextButton(onClick = { scope.launch { model.copyDraft(issue)?.let { recovering = false; model.retryRecovery(); onOpen(it) } } }) { Text("另存为笔记") }
                            TextButton(onClick = { context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                                type = "text/plain"; putExtra(Intent.EXTRA_TEXT, issue.snapshot.markdown)
                            }, "分享恢复草稿")) }) { Text("分享正文") }
                        }
                    }
                    HorizontalDivider()
                }
            }
        } }, confirmButton = { TextButton(onClick = { model.retryRecovery(); recovering = false }) { Text("重试恢复") } },
        dismissButton = { TextButton(onClick = { recovering = false }) { Text("关闭") } })
    if (groupName != null) AlertDialog(onDismissRequest = { groupName = null }, title = { Text("新建分组") },
        text = { OutlinedTextField(groupName.orEmpty(), { groupName = it.take(64) }, label = { Text("分组名称") }, singleLine = true) },
        confirmButton = { TextButton(onClick = { val name = groupName.orEmpty(); scope.launch { model.createGroup(name)?.let { model.filter.value = filter.copy(groupId = it); groupName = null } } }, enabled = groupName?.isNotBlank() == true) { Text("创建分组") } },
        dismissButton = { TextButton(onClick = { groupName = null }) { Text("取消") } })
    assigning?.let { note -> AlertDialog(onDismissRequest = { assigning = null }, title = { Text("移动到分组") },
        text = { Column { TextButton(onClick = { scope.launch { model.assignGroup(note.id, null); assigning = null } }) { Text("未分组") }
            groups.forEach { group -> TextButton(onClick = { scope.launch { model.assignGroup(note.id, group.id); assigning = null } }) { Text(group.name) } } } },
        confirmButton = { TextButton(onClick = { assigning = null }) { Text("取消") } }) }
    deleting?.let { note -> AlertDialog(onDismissRequest = { deleting = null }, title = { Text("移到回收站？") },
        text = { Text(note.title.ifBlank { "无标题" }) },
        confirmButton = { TextButton(onClick = { deleting = null; scope.launch {
            if (model.trash(note.id, true) && snackbar.showSnackbar("已移到回收站", "撤销", duration = SnackbarDuration.Short) == SnackbarResult.ActionPerformed) model.trash(note.id, false)
        } }) { Text("移到回收站") } }, dismissButton = { TextButton(onClick = { deleting = null }) { Text("取消") } }) }
}

@Composable
private fun NoteCard(note: NoteEntity, group: String?, onOpen: () -> Unit, onStar: () -> Unit, onGroup: () -> Unit, onTrash: () -> Unit, onExport: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    Card(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth()) {
            Column(Modifier.weight(1f).clickable(onClick = onOpen).padding(16.dp)) {
                Text((if (note.star == 1) "★ " else "") + note.title.ifBlank { "无标题" }, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (note.summary.isNotBlank()) Text(note.summary, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
                Text("${group ?: "未分组"} · 已保存到本机", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Box {
                TextButton(onClick = { menu = true }, modifier = Modifier.semantics { contentDescription = "笔记操作：${note.title.ifBlank { "无标题" }}" }) { Text("操作") }
                DropdownMenu(menu, onDismissRequest = { menu = false }) {
                    if (note.invalid == 0) {
                        DropdownMenuItem(text = { Text(if (note.star == 1) "取消星标" else "添加星标") }, onClick = { menu = false; onStar() })
                        DropdownMenuItem(text = { Text("移动到分组") }, onClick = { menu = false; onGroup() })
                    }
                    DropdownMenuItem(text = { Text("导出 Markdown") }, onClick = { menu = false; onExport() })
                    DropdownMenuItem(text = { Text(if (note.invalid == 1) "恢复笔记" else "移到回收站") }, onClick = { menu = false; onTrash() })
                }
            }
        }
    }
}
