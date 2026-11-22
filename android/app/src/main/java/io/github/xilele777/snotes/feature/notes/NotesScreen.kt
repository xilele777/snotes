package io.github.xilele777.snotes.feature.notes

import android.content.Intent
import androidx.activity.compose.ReportDrawnWhen
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.paging.LoadState
import androidx.paging.compose.collectAsLazyPagingItems
import androidx.paging.compose.itemKey
import io.github.xilele777.snotes.core.database.NoteEntity
import io.github.xilele777.snotes.core.model.matchesAllTerms
import io.github.xilele777.snotes.core.model.searchHitRanges
import io.github.xilele777.snotes.core.ui.*
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.*

private val fmtTime = DateTimeFormatter.ofPattern("HH:mm")
private val fmtMonthDay = DateTimeFormatter.ofPattern("MM-dd")
private val fmtFullDate = DateTimeFormatter.ofPattern("yyyy-MM-dd")

private fun formatNoteDate(timestamp: Long): String {
    if (timestamp <= 0L) return ""
    val zone = ZoneId.systemDefault()
    val dateTime = Instant.ofEpochMilli(timestamp).atZone(zone)
    val today = LocalDate.now(zone)
    val date = dateTime.toLocalDate()
    return when {
        date == today -> fmtTime.format(dateTime)
        date.year == today.year -> fmtMonthDay.format(dateTime)
        else -> fmtFullDate.format(dateTime)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotesScreen(
    onOpen: (String) -> Unit,
    section: String = "home",
    recovery: String = "",
    noteDensity: String = "comfortable",
    showNotePreview: Boolean = true,
    model: NotesViewModel = viewModel(),
    onDrawer: (() -> Unit)? = null,
    onRecoveryHandled: () -> Unit = {},
) {
    val colors = MaterialTheme.snotesColors
    val filter by model.filter.collectAsStateWithLifecycle()
    val initialized by model.initialized.collectAsStateWithLifecycle()
    val recoveryFailed by model.recoveryFailed.collectAsStateWithLifecycle()
    val groups by model.groups.collectAsStateWithLifecycle()
    val structureIds by model.structureIds.collectAsStateWithLifecycle()
    val sync by model.syncStatus.collectAsStateWithLifecycle()
    val syncFailures by model.syncFailures.collectAsStateWithLifecycle()
    val missing by model.missingBodies.collectAsStateWithLifecycle()
    val issues by model.issues.collectAsStateWithLifecycle()
    val message by model.message.collectAsStateWithLifecycle()
    val notes = model.pages.collectAsLazyPagingItems()
    val count by model.count.collectAsStateWithLifecycle()

    val groupById = remember(groups) { groups.associateBy { it.id } }
    val structureIdSet = remember(structureIds) { structureIds.toHashSet() }

    ReportDrawnWhen { notes.loadState.refresh is LoadState.NotLoading && notes.loadState.source.refresh is LoadState.NotLoading }
    val listState = rememberLazyListState()
    LaunchedEffect(section) {
        model.setSection(section)
        listState.scrollToItem(0)
    }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val layoutDirection = LocalLayoutDirection.current
    val snackbar = remember { SnackbarHostState() }
    var creating by remember { mutableStateOf(false) }
    var sortMenu by rememberSaveable { mutableStateOf(false) }
    var assigning by remember { mutableStateOf<NoteEntity?>(null) }
    var deleting by remember { mutableStateOf<NoteEntity?>(null) }
    var purgingNote by remember { mutableStateOf<NoteEntity?>(null) }
    var confirmingCleanTrash by remember { mutableStateOf(false) }
    var recovering by rememberSaveable { mutableStateOf(recovery == "drafts") }
    var connecting by rememberSaveable { mutableStateOf(recovery == "connect" || recovery == "sync") }
    var showingSyncFailures by rememberSaveable { mutableStateOf(recovery == "failures") }

    LaunchedEffect(recovery) {
        if (recovery == "connect" || recovery == "sync") connecting = true
        if (recovery == "drafts") recovering = true
        if (recovery == "failures") showingSyncFailures = true
        if (recovery.isNotEmpty()) onRecoveryHandled()
    }

    val exporter = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/markdown")) { uri ->
        val text = model.exportSnapshot
        model.exportSnapshot = null
        if (uri != null && text == null) scope.launch { snackbar.showSnackbar("导出已中断，请重新选择导出") }
        if (uri != null && text != null) scope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    checkNotNull(context.contentResolver.openOutputStream(uri, "wt")).use { it.write(text.toByteArray(Charsets.UTF_8)) }
                }
            }
            snackbar.showSnackbar(if (result.isSuccess) "Markdown 已导出" else "导出失败，本机正文已保留")
        }
    }
    LaunchedEffect(message) { message?.let { snackbar.showSnackbar(it); model.clearMessage() } }

    val title = when (section) {
        "home" -> "随手记"
        "star" -> "星标笔记"
        "hidden" -> "已隐藏"
        "trash" -> "回收站"
        else -> groupById[section.removePrefix("group:")]?.name ?: "全部笔记"
    }

    val sortLabel = when (filter.sort) {
        "created" -> "最近创建"
        "title" -> "标题顺序"
        else -> "最近更新"
    }

    Scaffold(
        containerColor = colors.bgList,
        contentWindowInsets = WindowInsets.safeDrawing,
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            Column(Modifier.fillMaxWidth().background(colors.bgList)) {
                SnotesTopBar(
                    title = title,
                    count = count,
                    navigationIcon = if (onDrawer != null) SnotesSymbol.Menu else null,
                    navigationDescription = "打开侧栏",
                    onNavigationClick = onDrawer,
                    containerColor = colors.bgList,
                    showBottomDivider = true,
                    actions = {
                        if (section == "trash") {
                            if (count > 0) {
                                Surface(
                                    onClick = { confirmingCleanTrash = true },
                                    shape = RoundedCornerShape(7.dp),
                                    color = Color.Transparent,
                                    border = BorderStroke(1.dp, colors.borderDefault),
                                    modifier = Modifier.height(32.dp),
                                ) {
                                    Box(
                                        modifier = Modifier.padding(horizontal = 11.dp),
                                        contentAlignment = Alignment.Center,
                                    ) {
                                        Text(
                                            "清空",
                                            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Medium),
                                            color = colors.textSecondary,
                                        )
                                    }
                                }
                            }
                        } else {
                            SnotesPrimaryCreateButton(
                                text = if (creating) "创建中" else "新建",
                                contentDescription = "新建笔记",
                                enabled = !creating,
                                onClick = {
                                    if (!creating) {
                                        creating = true
                                        scope.launch { try { model.create()?.let(onOpen) } finally { creating = false } }
                                    }
                                },
                            )
                        }
                    },
                )
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                    Row(
                        modifier = Modifier
                            .widthIn(max = 840.dp)
                            .fillMaxWidth()
                            .padding(horizontal = 14.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        SnotesSearchField(
                            value = filter.query,
                            onValueChange = { model.filter.value = filter.copy(query = it.take(256)) },
                            placeholder = "搜索本机笔记",
                            modifier = Modifier.weight(1f),
                        )
                        if (section != "trash") {
                            Box {
                                SnotesSortTriggerButton(
                                    label = sortLabel,
                                    description = "笔记排序",
                                    active = filter.sort != "updated",
                                    onClick = { sortMenu = true },
                                )
                                if (sortMenu) {
                                    DropdownMenu(
                                        expanded = true,
                                        onDismissRequest = { sortMenu = false },
                                        containerColor = colors.bgSurface,
                                        shape = RoundedCornerShape(10.dp),
                                    ) {
                                        listOf("updated" to "最近更新", "created" to "最近创建", "title" to "标题顺序").forEach { (key, label) ->
                                            DropdownMenuItem(
                                                text = {
                                                    Text(
                                                        label,
                                                        color = if (filter.sort == key) colors.accent else colors.textPrimary,
                                                        fontWeight = if (filter.sort == key) FontWeight.SemiBold else FontWeight.Normal,
                                                    )
                                                },
                                                trailingIcon = {
                                                    if (filter.sort == key) SnotesIcon(SnotesSymbol.Check, size = 15.dp, tint = colors.accent)
                                                },
                                                onClick = { model.filter.value = filter.copy(sort = key); sortMenu = false },
                                            )
                                        }
                                    }
                                }
                            }
                            SnotesToolbarIconButton(
                                symbol = SnotesSymbol.Sync,
                                description = "刷新笔记",
                                enabled = !sync.running,
                                active = sync.running,
                                spinning = sync.running,
                                onClick = {
                                    notes.refresh()
                                    if (sync.connected) model.synchronize()
                                },
                                modifier = Modifier.size(38.dp),
                            )
                        }
                    }
                }
            }
        },
    ) { insets ->
        PullToRefreshBox(
            isRefreshing = sync.running,
            onRefresh = {
                notes.refresh()
                if (sync.connected) model.synchronize()
            },
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.TopCenter,
        ) {
            LazyColumn(
                state = listState,
                modifier = Modifier
                    .widthIn(max = 840.dp)
                    .fillMaxSize()
                    .consumeWindowInsets(insets),
                contentPadding = PaddingValues(
                    start = insets.calculateStartPadding(layoutDirection),
                    end = insets.calculateEndPadding(layoutDirection),
                    top = insets.calculateTopPadding(),
                    bottom = insets.calculateBottomPadding() + 32.dp,
                ),
            ) {
                val hasNotices = filter.query.isNotBlank() || issues.isNotEmpty() ||
                    syncFailures.isNotEmpty() || recoveryFailed || notes.loadState.refresh is LoadState.Error
                if (hasNotices) {
                    item(key = "notices") {
                        Column(
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            if (filter.query.isNotBlank()) {
                                Row(
                                    Modifier.fillMaxWidth().padding(horizontal = 4.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                ) {
                                    Text("找到 $count 条笔记", style = MaterialTheme.typography.bodySmall, color = colors.textTertiary)
                                    Text(
                                        "清除筛选",
                                        style = MaterialTheme.typography.labelMedium,
                                        color = colors.accent,
                                        modifier = Modifier
                                            .clip(RoundedCornerShape(6.dp))
                                            .clickable { model.filter.value = filter.copy(query = "") }
                                            .padding(horizontal = 6.dp, vertical = 2.dp),
                                    )
                                }
                                if (missing > 0) {
                                    Surface(
                                        shape = RoundedCornerShape(10.dp),
                                        color = colors.bgSurface,
                                        border = BorderStroke(0.75.dp, colors.borderLight),
                                    ) {
                                        Text(
                                            "当前范围有 $missing 篇正文未下载，结果可能不完整。",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = colors.textSecondary,
                                            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                                        )
                                    }
                                }
                            }
                            if (issues.isNotEmpty()) {
                                SnotesCard(
                                    onClick = { recovering = true },
                                    containerColor = colors.dangerBg,
                                    borderColor = colors.danger.copy(alpha = 0.25f),
                                    shape = RoundedCornerShape(12.dp),
                                ) {
                                    Row(
                                        Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                                    ) {
                                        SnotesIcon(SnotesSymbol.Alert, size = 18.dp, tint = colors.danger)
                                        Text("${issues.size} 份草稿待恢复", style = MaterialTheme.typography.labelLarge, color = colors.danger, modifier = Modifier.weight(1f))
                                        SnotesIcon(SnotesSymbol.Chevron, size = 16.dp, tint = colors.danger)
                                    }
                                }
                            }
                            if (syncFailures.isNotEmpty()) {
                                SnotesCard(
                                    onClick = { showingSyncFailures = true },
                                    containerColor = colors.dangerBg,
                                    borderColor = colors.danger.copy(alpha = 0.25f),
                                    shape = RoundedCornerShape(12.dp),
                                ) {
                                    Row(
                                        Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                                    ) {
                                        SnotesIcon(SnotesSymbol.Alert, size = 18.dp, tint = colors.danger)
                                        Text("${syncFailures.size} 项同步失败", style = MaterialTheme.typography.labelLarge, color = colors.danger, modifier = Modifier.weight(1f))
                                        SnotesIcon(SnotesSymbol.Chevron, size = 16.dp, tint = colors.danger)
                                    }
                                }
                            }
                            if (recoveryFailed) {
                                TextButton(onClick = model::retryRecovery) { Text("重试读取本机数据") }
                            }
                            if (notes.loadState.refresh is LoadState.Error) {
                                TextButton(onClick = { model.retryRecovery(); notes.retry() }) { Text("本机读取失败，重试") }
                            }
                        }
                    }
                }
                if (notes.itemCount == 0 && initialized && notes.loadState.refresh is LoadState.NotLoading) {
                    item(key = "empty") {
                        EmptyWorkspace(
                            symbol = if (filter.trash) SnotesSymbol.Trash else if (filter.query.isNotBlank()) SnotesSymbol.Search else SnotesSymbol.Notes,
                            title = when {
                                filter.query.isNotBlank() -> "没有匹配的笔记"
                                filter.trash -> "暂无已删除笔记"
                                filter.starred -> "没有星标笔记"
                                filter.hiddenOnly -> "没有已隐藏的笔记"
                                filter.groupId != null -> "该分组暂无笔记"
                                else -> "还没有笔记"
                            },
                        )
                    }
                }
                items(notes.itemCount, key = notes.itemKey { it.id }) { index ->
                    notes[index]?.let { note ->
                        val noteGroup = note.groupId?.let { groupById[it] }
                        val thumbKey = note.thumbnail?.takeIf { it.isNotBlank() }
                        var thumbnailBitmap by remember(thumbKey) {
                            mutableStateOf(thumbKey?.let(model::cachedThumbnail))
                        }
                        LaunchedEffect(thumbKey) {
                            if (thumbKey != null && thumbnailBitmap == null) {
                                thumbnailBitmap = model.loadThumbnail(thumbKey)
                            }
                        }
                        NoteCard(
                            note = note,
                            group = noteGroup?.name,
                            groupColor = noteGroup?.color,
                            thumbnailBitmap = thumbnailBitmap,
                            structureAllowed = note.id in structureIdSet,
                            noteDensity = noteDensity,
                            showPreview = showNotePreview,
                            searchQuery = filter.query,
                            loadSearchExcerpt = model::searchExcerpt,
                            onOpen = { onOpen(note.id) },
                            onStar = { scope.launch { model.star(note) } },
                            onPin = { scope.launch { model.pin(note) } },
                            onSkinColor = { chosen -> scope.launch { model.skinColor(note, chosen) } },
                            onGroup = { assigning = note },
                            onTrash = {
                                if (note.invalid == 1) {
                                    scope.launch { model.trash(note.id, false) }
                                } else {
                                    deleting = note
                                }
                            },
                            onPurge = { purgingNote = note },
                            onExport = {
                                scope.launch {
                                    model.export(note.id)?.let { text ->
                                        model.exportSnapshot = text
                                        exporter.launch("${note.title.ifBlank { "无标题" }.replace(Regex("[\\\\/:*?\"<>|]"), "_")}.md")
                                    }
                                }
                            },
                            hiddenFromHome = note.homeHidden == 1 || (note.homeHidden == null && noteGroup?.homeHidden == 1),
                            onHidden = { value -> scope.launch { model.hidden(note, value) } },
                        )
                    }
                }
                if (notes.loadState.append is LoadState.Error) {
                    item(key = "append-error") { TextButton(onClick = notes::retry) { Text("加载更多失败，重试") } }
                }
            }
        }
    }

    if (connecting) {
        ServerConnectionSheet(
            model = model,
            onDismiss = { connecting = false },
            onOpenFailures = { showingSyncFailures = true },
        )
    }

    if (showingSyncFailures) {
        AlertDialog(
            onDismissRequest = { showingSyncFailures = false },
            containerColor = colors.bgSurface,
            shape = RoundedCornerShape(18.dp),
            title = { Text("同步失败项", style = MaterialTheme.typography.titleLarge) },
            text = {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(syncFailures.size) { index ->
                        val failure = syncFailures[index]
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(failure.title, style = MaterialTheme.typography.titleMedium, color = colors.textPrimary)
                            Text(failure.task.lastError ?: "同步失败，本机内容已保留", style = MaterialTheme.typography.bodySmall, color = colors.textSecondary)
                            if (failure.task.entityType == "note") {
                                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                    TextButton(onClick = { scope.launch { model.copyFailed(failure.task.id)?.let { showingSyncFailures = false; onOpen(it) } } }) { Text("另存为新笔记") }
                                    TextButton(onClick = {
                                        scope.launch {
                                            model.export(failure.task.entityId)?.let { text ->
                                                model.exportSnapshot = text
                                                exporter.launch("恢复笔记.md")
                                            }
                                        }
                                    }) { Text("导出 Markdown") }
                                }
                            }
                            if (index < syncFailures.lastIndex) HorizontalDivider(color = colors.divider)
                        }
                    }
                }
            },
            confirmButton = { Button(onClick = { showingSyncFailures = false; model.retrySync() }, shape = RoundedCornerShape(10.dp)) { Text("重试") } },
            dismissButton = { TextButton(onClick = { showingSyncFailures = false }) { Text("关闭") } },
        )
    }

    if (recovering) {
        AlertDialog(
            onDismissRequest = { recovering = false },
            containerColor = colors.bgSurface,
            shape = RoundedCornerShape(18.dp),
            title = { Text("恢复草稿", style = MaterialTheme.typography.titleLarge) },
            text = {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(issues.size) { index ->
                        val issue = issues[index]
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text("草稿 ${index + 1}", style = MaterialTheme.typography.labelMedium, color = colors.textTertiary)
                            Text(issue.message, style = MaterialTheme.typography.bodyMedium, color = colors.textPrimary)
                            if (issue.snapshot != null) {
                                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                    TextButton(onClick = { scope.launch { model.copyDraft(issue)?.let { recovering = false; model.retryRecovery(); onOpen(it) } } }) { Text("另存为笔记") }
                                    TextButton(onClick = {
                                        context.startActivity(
                                            Intent.createChooser(
                                                Intent(Intent.ACTION_SEND).apply {
                                                    type = "text/plain"
                                                    putExtra(Intent.EXTRA_TEXT, issue.snapshot.markdown)
                                                },
                                                "分享恢复草稿",
                                            ),
                                        )
                                    }) { Text("分享正文") }
                                }
                            }
                            if (index < issues.lastIndex) HorizontalDivider(color = colors.divider)
                        }
                    }
                }
            },
            confirmButton = { Button(onClick = { model.retryRecovery(); recovering = false }, shape = RoundedCornerShape(10.dp)) { Text("重试恢复") } },
            dismissButton = { TextButton(onClick = { recovering = false }) { Text("关闭") } },
        )
    }

    assigning?.let { note ->
        AlertDialog(
            onDismissRequest = { assigning = null },
            containerColor = colors.bgSurface,
            shape = RoundedCornerShape(18.dp),
            title = { Text("移动到分组", style = MaterialTheme.typography.titleLarge) },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    val options = listOf<Pair<String?, String>>(null to "未分组") + groups.map { it.id to it.name }
                    options.forEachIndexed { index, (gid, gname) ->
                        val selected = note.groupId == gid
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(10.dp))
                                .clickable { scope.launch { model.assignGroup(note.id, gid); assigning = null } }
                                .padding(horizontal = 12.dp, vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Text(
                                gname,
                                style = MaterialTheme.typography.bodyLarge,
                                color = if (selected) colors.accent else colors.textPrimary,
                                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                                modifier = Modifier.weight(1f),
                            )
                            if (selected) SnotesIcon(SnotesSymbol.Check, size = 18.dp, tint = colors.accent)
                        }
                        if (index < options.lastIndex) HorizontalDivider(color = colors.divider)
                    }
                }
            },
            confirmButton = { TextButton(onClick = { assigning = null }) { Text("取消") } },
        )
    }

    deleting?.let { note ->
        val label = note.title.ifBlank { if (!note.thumbnail.isNullOrBlank()) "图片笔记" else "无标题" }
        AlertDialog(
            onDismissRequest = { deleting = null },
            containerColor = colors.bgSurface,
            shape = RoundedCornerShape(18.dp),
            title = { Text("移到回收站？", style = MaterialTheme.typography.titleLarge) },
            text = { Text(label, style = MaterialTheme.typography.bodyMedium, color = colors.textSecondary) },
            confirmButton = {
                Button(
                    onClick = {
                        deleting = null
                        scope.launch {
                            if (model.trash(note.id, true) && snackbar.showSnackbar("已移到回收站", "撤销", duration = SnackbarDuration.Short) == SnackbarResult.ActionPerformed) {
                                model.trash(note.id, false)
                            }
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = colors.danger),
                    shape = RoundedCornerShape(10.dp),
                ) { Text("移到回收站") }
            },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text("取消") } },
        )
    }

    purgingNote?.let { note ->
        AlertDialog(
            onDismissRequest = { purgingNote = null },
            containerColor = colors.bgSurface,
            shape = RoundedCornerShape(18.dp),
            title = { Text("彻底删除这条笔记？", style = MaterialTheme.typography.titleLarge) },
            text = { Text("彻底删除后无法恢复。", style = MaterialTheme.typography.bodyMedium, color = colors.textSecondary) },
            confirmButton = {
                Button(
                    onClick = {
                        val id = note.id
                        purgingNote = null
                        scope.launch { model.purge(id) }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = colors.danger),
                    shape = RoundedCornerShape(10.dp),
                ) { Text("彻底删除") }
            },
            dismissButton = { TextButton(onClick = { purgingNote = null }) { Text("取消") } },
        )
    }

    if (confirmingCleanTrash) {
        AlertDialog(
            onDismissRequest = { confirmingCleanTrash = false },
            containerColor = colors.bgSurface,
            shape = RoundedCornerShape(18.dp),
            title = { Text("清空回收站？", style = MaterialTheme.typography.titleLarge) },
            text = { Text("回收站里的所有笔记将永久删除，无法恢复。", style = MaterialTheme.typography.bodyMedium, color = colors.textSecondary) },
            confirmButton = {
                Button(
                    onClick = {
                        confirmingCleanTrash = false
                        scope.launch { model.purgeTrash() }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = colors.danger),
                    shape = RoundedCornerShape(10.dp),
                ) { Text("清空回收站") }
            },
            dismissButton = { TextButton(onClick = { confirmingCleanTrash = false }) { Text("取消") } },
        )
    }
}

private fun highlightSearchHits(text: String, query: String, highlightColor: Color, highlightBg: Color): AnnotatedString {
    val ranges = searchHitRanges(text, query)
    if (ranges.isEmpty()) return AnnotatedString(text)
    return buildAnnotatedString {
        append(text)
        val style = SpanStyle(color = highlightColor, background = highlightBg, fontWeight = FontWeight.SemiBold)
        ranges.forEach { range ->
            addStyle(style, start = range.first, end = range.second)
        }
    }
}

@Composable
internal fun NoteCard(
    note: NoteEntity,
    group: String?,
    structureAllowed: Boolean,
    onOpen: () -> Unit,
    onStar: () -> Unit,
    onPin: () -> Unit,
    onGroup: () -> Unit,
    onTrash: () -> Unit,
    onExport: () -> Unit,
    onPurge: () -> Unit = {},
    onSkinColor: (String?) -> Unit = {},
    thumbnailBitmap: ImageBitmap? = null,
    hiddenFromHome: Boolean = false,
    onHidden: (Int?) -> Unit = {},
    groupColor: String? = null,
    noteDensity: String = "comfortable",
    showPreview: Boolean = true,
    searchQuery: String = "",
    loadSearchExcerpt: (suspend (String, String) -> String?)? = null,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.snotesColors
    var menu by remember { mutableStateOf(false) }
    val date = remember(note.updateTime) { formatNoteDate(note.updateTime) }
    val skinColor = remember(note.skinColor) { parseHexColorOrNull(note.skinColor) }
    val parsedGroupColor = remember(groupColor) { parseHexColorOrNull(groupColor) }
    val hasThumbnail = !note.thumbnail.isNullOrBlank()
    val displayTitle = when {
        note.title.isNotBlank() -> note.title
        hasThumbnail -> "图片笔记"
        else -> "无标题"
    }
    val isUntitled = note.title.isBlank() && !hasThumbnail
    val dividerColor = colors.divider
    val compact = noteDensity == "compact"
    val trimmedQuery = searchQuery.trim()
    val needsBodyExcerpt = remember(note.title, note.summary, trimmedQuery) {
        trimmedQuery.isNotEmpty() && !matchesAllTerms("${note.title}\n${note.summary}", trimmedQuery)
    }
    var bodyExcerpt by remember(note.id, note.bodyVersion, trimmedQuery) { mutableStateOf<String?>(null) }
    LaunchedEffect(note.id, note.bodyVersion, trimmedQuery, needsBodyExcerpt) {
        if (needsBodyExcerpt && loadSearchExcerpt != null) {
            bodyExcerpt = loadSearchExcerpt(note.id, trimmedQuery)
        } else {
            bodyExcerpt = null
        }
    }
    val previewText = bodyExcerpt?.takeIf { it.isNotBlank() } ?: note.summary
    val showSummaryRow = (showPreview || trimmedQuery.isNotEmpty()) && previewText.isNotBlank()
    val titleAnnotated = remember(displayTitle, trimmedQuery, colors.selectedText, colors.accentSoft) {
        if (trimmedQuery.isEmpty() || isUntitled) AnnotatedString(displayTitle)
        else highlightSearchHits(displayTitle, trimmedQuery, colors.selectedText, colors.accentSoft)
    }
    val summaryAnnotated = remember(previewText, trimmedQuery, colors.selectedText, colors.accentSoft) {
        if (trimmedQuery.isEmpty()) AnnotatedString(previewText)
        else highlightSearchHits(previewText, trimmedQuery, colors.selectedText, colors.accentSoft)
    }

    Box(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 6.dp)
            .clip(RoundedCornerShape(7.dp))
            .clickable(onClick = onOpen)
            .semantics { contentDescription = "打开笔记：$displayTitle" }
            .drawBehind {
                if (skinColor != null) {
                    val barWidth = 2.5.dp.toPx()
                    val insetY = 12.dp.toPx()
                    val barHeight = (size.height - insetY * 2).coerceAtLeast(16.dp.toPx())
                    drawRoundRect(
                        color = skinColor,
                        topLeft = Offset(2.dp.toPx(), insetY),
                        size = Size(barWidth, barHeight),
                        cornerRadius = CornerRadius(2.dp.toPx(), 2.dp.toPx()),
                    )
                }
                val lineInset = 12.dp.toPx()
                val stroke = 0.75.dp.toPx()
                drawLine(
                    color = dividerColor,
                    start = Offset(lineInset, size.height - stroke / 2f),
                    end = Offset(size.width - lineInset, size.height - stroke / 2f),
                    strokeWidth = stroke,
                )
            }
            .padding(
                start = 14.dp,
                end = 10.dp,
                top = if (compact) 10.dp else 13.dp,
                bottom = if (compact) 10.dp else 13.dp,
            ),
    ) {
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Column(
                Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(if (compact) 3.dp else 5.dp),
            ) {
                Row(
                    Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        titleAnnotated,
                        style = MaterialTheme.typography.titleMedium.copy(fontSize = 15.sp, lineHeight = 22.sp),
                        color = if (isUntitled) colors.textTertiary else colors.textPrimary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    if (!hasThumbnail) {
                        NoteMoreMenuButton(
                            displayTitle = displayTitle,
                            note = note,
                            menu = menu,
                            onMenuChange = { menu = it },
                            structureAllowed = structureAllowed,
                            hiddenFromHome = hiddenFromHome,
                            onStar = onStar,
                            onPin = onPin,
                            onSkinColor = onSkinColor,
                            onHidden = onHidden,
                            onGroup = onGroup,
                            onExport = onExport,
                            onTrash = onTrash,
                            onPurge = onPurge,
                        )
                    }
                }

                if (showSummaryRow) {
                    Text(
                        summaryAnnotated,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        style = MaterialTheme.typography.bodyMedium.copy(fontSize = 13.sp, lineHeight = 19.sp),
                        color = colors.textSecondary,
                    )
                }

                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(top = 1.dp),
                    horizontalArrangement = Arrangement.spacedBy(7.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        date,
                        style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                        color = colors.textTertiary,
                    )
                    if (note.top == 1) {
                        SnotesIcon(SnotesSymbol.Pin, description = "已置顶", size = 12.dp, tint = colors.textTertiary)
                    }
                    if (note.star == 1) {
                        SnotesIcon(SnotesSymbol.StarFilled, description = "已添加星标", size = 12.dp, tint = colors.star)
                    }
                    if (hiddenFromHome) {
                        SnotesIcon(SnotesSymbol.EyeOff, description = "从随手记隐藏", size = 12.dp, tint = colors.textDisabled)
                    }
                    Spacer(Modifier.weight(1f))
                    if (note.invalid == 1) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Surface(
                                onClick = onTrash,
                                shape = RoundedCornerShape(5.dp),
                                color = colors.accentSoft,
                                border = BorderStroke(0.75.dp, colors.accent.copy(alpha = 0.25f)),
                            ) {
                                Text(
                                    "恢复",
                                    style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Medium),
                                    color = colors.accent,
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                                )
                            }
                            Surface(
                                onClick = onPurge,
                                shape = RoundedCornerShape(5.dp),
                                color = colors.bgSurface,
                                border = BorderStroke(0.75.dp, colors.borderDefault),
                            ) {
                                Text(
                                    "彻底删除",
                                    style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Medium),
                                    color = colors.danger,
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                                )
                            }
                        }
                    } else if (group != null) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            if (parsedGroupColor != null) {
                                Box(
                                    Modifier
                                        .size(5.dp)
                                        .clip(CircleShape)
                                        .background(parsedGroupColor),
                                )
                            }
                            Text(
                                group,
                                style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                                color = colors.textTertiary,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.widthIn(max = 104.dp),
                            )
                        }
                    }
                }
            }

            if (hasThumbnail) {
                Row(
                    verticalAlignment = Alignment.Top,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Box(
                        modifier = Modifier
                            .size(44.dp)
                            .clip(RoundedCornerShape(5.dp))
                            .background(colors.bgSurface)
                            .border(0.75.dp, colors.borderLight, RoundedCornerShape(5.dp)),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (thumbnailBitmap != null) {
                            Image(
                                bitmap = thumbnailBitmap,
                                contentDescription = "笔记图片缩略图",
                                contentScale = ContentScale.Crop,
                                modifier = Modifier.fillMaxSize(),
                            )
                        } else {
                            SnotesIcon(SnotesSymbol.Image, size = 18.dp, tint = colors.textTertiary)
                        }
                    }
                    NoteMoreMenuButton(
                        displayTitle = displayTitle,
                        note = note,
                        menu = menu,
                        onMenuChange = { menu = it },
                        structureAllowed = structureAllowed,
                        hiddenFromHome = hiddenFromHome,
                        onStar = onStar,
                        onPin = onPin,
                        onSkinColor = onSkinColor,
                        onHidden = onHidden,
                        onGroup = onGroup,
                        onExport = onExport,
                        onTrash = onTrash,
                        onPurge = onPurge,
                    )
                }
            }
        }
    }
}

@Composable
private fun NoteMoreMenuButton(
    displayTitle: String,
    note: NoteEntity,
    menu: Boolean,
    onMenuChange: (Boolean) -> Unit,
    structureAllowed: Boolean,
    hiddenFromHome: Boolean,
    onStar: () -> Unit,
    onPin: () -> Unit,
    onSkinColor: (String?) -> Unit,
    onHidden: (Int?) -> Unit,
    onGroup: () -> Unit,
    onExport: () -> Unit,
    onTrash: () -> Unit,
    onPurge: () -> Unit,
) {
    val colors = MaterialTheme.snotesColors
    Box {
        IconButton(
            onClick = { onMenuChange(true) },
            modifier = Modifier
                .size(28.dp)
                .semantics { contentDescription = "笔记操作：$displayTitle" },
        ) {
            SnotesIcon(SnotesSymbol.More, size = 16.dp, tint = colors.textTertiary)
        }
        if (menu) {
            DropdownMenu(
                expanded = true,
                onDismissRequest = { onMenuChange(false) },
                containerColor = colors.bgSurface,
                shape = RoundedCornerShape(10.dp),
            ) {
                if (note.invalid == 0) {
                    DropdownMenuItem(text = { Text(if (note.star == 1) "取消星标" else "添加星标") }, onClick = { onMenuChange(false); onStar() })
                    DropdownMenuItem(text = { Text(if (note.top == 1) "取消置顶" else "置顶") }, onClick = { onMenuChange(false); onPin() })
                    SnotesColorSwatchRow(
                        selectedColor = note.skinColor,
                        onSelect = { chosen -> onMenuChange(false); onSkinColor(chosen) },
                    )
                    HorizontalDivider(color = colors.divider)
                    DropdownMenuItem(text = { Text(if (hiddenFromHome) "在随手记中显示" else "从随手记隐藏") }, onClick = { onMenuChange(false); onHidden(if (hiddenFromHome) 0 else 1) })
                    if (note.homeHidden != null) {
                        DropdownMenuItem(text = { Text("跟随分组显示规则") }, onClick = { onMenuChange(false); onHidden(null) })
                    }
                    if (structureAllowed) {
                        DropdownMenuItem(text = { Text("移动到分组") }, onClick = { onMenuChange(false); onGroup() })
                    }
                    DropdownMenuItem(text = { Text("导出 Markdown") }, onClick = { onMenuChange(false); onExport() })
                    if (structureAllowed) {
                        HorizontalDivider(color = colors.divider)
                        DropdownMenuItem(
                            text = { Text("移到回收站", color = colors.danger) },
                            onClick = { onMenuChange(false); onTrash() },
                        )
                    }
                } else {
                    DropdownMenuItem(
                        text = { Text("恢复笔记", color = colors.accent) },
                        onClick = { onMenuChange(false); onTrash() },
                    )
                    DropdownMenuItem(text = { Text("导出 Markdown") }, onClick = { onMenuChange(false); onExport() })
                    HorizontalDivider(color = colors.divider)
                    DropdownMenuItem(
                        text = { Text("彻底删除", color = colors.danger) },
                        onClick = { onMenuChange(false); onPurge() },
                    )
                }
            }
        }
    }
}
