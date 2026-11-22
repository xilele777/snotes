package io.github.xilele777.snotes.feature.notes

import androidx.activity.compose.BackHandler
import androidx.compose.animation.*
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.github.xilele777.snotes.core.database.*
import io.github.xilele777.snotes.core.model.matchesAllTerms
import io.github.xilele777.snotes.core.network.*
import io.github.xilele777.snotes.core.ui.*
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.UUID
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

private val fmtBookDate = DateTimeFormatter.ofPattern("yyyy/M/d")

private fun formatBookUpdateDate(timestamp: Long): String {
    if (timestamp <= 0L) return ""
    return fmtBookDate.format(Instant.ofEpochMilli(timestamp).atZone(ZoneId.systemDefault()))
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BooksManagerScreen(
    onOpen: (String) -> Unit,
    model: BooksManagerModel = viewModel(),
    onDrawer: (() -> Unit)? = null,
    syncRunning: Boolean = false,
    onRefresh: () -> Unit = {},
) {
    val colors = MaterialTheme.snotesColors
    val catalog by model.catalog.collectAsStateWithLifecycle()
    val entries = catalog.entries
    val nodes = catalog.nodes
    val metadata = catalog.metadata
    val noteTitles = catalog.noteTitles
    val failures by model.failures.collectAsStateWithLifecycle()
    val history by model.history.collectAsStateWithLifecycle()
    val message by model.message.collectAsStateWithLifecycle()

    var selected by rememberSaveable { mutableStateOf<String?>(null) }
    var value by remember { mutableStateOf<BookRemoteDto?>(null) }
    var editingBookId by rememberSaveable { mutableStateOf<String?>(null) }
    var name by rememberSaveable { mutableStateOf<String?>(null) }
    var description by rememberSaveable { mutableStateOf("") }
    var creating by rememberSaveable { mutableStateOf(false) }
    var folder by rememberSaveable { mutableStateOf<String?>(null) }
    var renamingFolderId by rememberSaveable { mutableStateOf<String?>(null) }
    var picking by rememberSaveable { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    var folderParent by rememberSaveable { mutableStateOf<String?>(null) }
    var pickingParent by rememberSaveable { mutableStateOf<String?>(null) }
    var candidates by remember { mutableStateOf(emptyList<NoteEntity>()) }
    var moving by remember { mutableStateOf<TocNodeDto?>(null) }
    var deletingBook by remember { mutableStateOf<Pair<String, String>?>(null) }
    var typedName by rememberSaveable { mutableStateOf("") }
    var dissolvingBook by remember { mutableStateOf<Pair<String, String>?>(null) }
    var bookMenu by remember { mutableStateOf(false) }
    var createMenu by remember { mutableStateOf(false) }
    var showingHistory by rememberSaveable { mutableStateOf(false) }
    var bookQuery by rememberSaveable { mutableStateOf("") }
    var tocQuery by rememberSaveable { mutableStateOf("") }
    var sort by rememberSaveable { mutableStateOf("updated") }
    var sortMenu by rememberSaveable { mutableStateOf(false) }
    var collapsed by rememberSaveable { mutableStateOf(emptyList<String>()) }
    var creatingNote by remember { mutableStateOf(false) }

    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(message) {
        if (message.isNotBlank()) {
            snackbar.showSnackbar(message)
            model.message.value = ""
        }
    }
    BackHandler(selected != null) { selected = null; tocQuery = "" }
    LaunchedEffect(selected, entries, nodes) {
        if (selected != null && catalog.details[selected] == null) {
            value = model.details(selected!!)
        } else if (selected == null) {
            value = null
        }
    }
    LaunchedEffect(picking, query) { if (picking) candidates = model.candidates(query) }
    val current = selected?.let { catalog.details[it] ?: value }
    val layoutDirection = LocalLayoutDirection.current

    val refCountByBook = remember(nodes) {
        nodes.filter { it.noteId != null }.groupingBy { it.knowledgeBaseId }.eachCount()
    }
    val activeBookCount = remember(entries) { entries.count { it.invalid == 0 } }
    val sortLabel = if (sort == "title") "名称顺序" else "最近更新"

    Scaffold(
        containerColor = if (selected == null) colors.bgList else colors.bgSurface,
        contentWindowInsets = WindowInsets.safeDrawing,
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            val topBg = if (selected == null) colors.bgList else colors.bgSurface
            Column(Modifier.fillMaxWidth().background(topBg)) {
                SnotesTopBar(
                    title = if (selected == null) "笔记本" else current?.book?.name ?: "笔记本",
                    count = if (selected == null) activeBookCount else null,
                    navigationIcon = when {
                        selected != null -> SnotesSymbol.Back
                        onDrawer != null -> SnotesSymbol.Menu
                        else -> null
                    },
                    navigationDescription = if (selected != null) "返回笔记本" else "打开侧栏",
                    onNavigationClick = if (selected != null || onDrawer != null) {
                        { if (selected != null) { selected = null; tocQuery = "" } else onDrawer?.invoke() }
                    } else null,
                    containerColor = topBg,
                    showBottomDivider = true,
                    actions = {
                        if (selected == null) {
                            SnotesPrimaryCreateButton(
                                text = "新建",
                                contentDescription = "新建笔记本",
                                onClick = { creating = true; editingBookId = null; name = ""; description = "" },
                            )
                        } else if (current != null) {
                            if (current.book.invalid == 0) {
                                SnotesPrimaryCreateButton(
                                    text = "新建笔记",
                                    contentDescription = "新建笔记",
                                    enabled = !creatingNote,
                                    onClick = {
                                        creatingNote = true
                                        scope.launch { try { model.createNote(current.book.id)?.let(onOpen) } finally { creatingNote = false } }
                                    },
                                )
                            }
                            Box {
                                IconButton(onClick = { bookMenu = true }, modifier = Modifier.size(38.dp)) {
                                    SnotesIcon(SnotesSymbol.More, size = 19.dp, description = "笔记本操作", tint = colors.textSecondary)
                                }
                                if (bookMenu) {
                                    DropdownMenu(
                                        expanded = true,
                                        onDismissRequest = { bookMenu = false },
                                        containerColor = colors.bgSurface,
                                        shape = RoundedCornerShape(10.dp),
                                    ) {
                                        DropdownMenuItem(
                                            text = { Text("编辑笔记本") },
                                            leadingIcon = { SnotesIcon(SnotesSymbol.Edit, size = 16.dp) },
                                            onClick = {
                                                bookMenu = false
                                                creating = false
                                                editingBookId = current.book.id
                                                name = current.book.name
                                                description = current.book.description
                                            },
                                        )
                                        DropdownMenuItem(
                                            text = { Text("目录历史") },
                                            leadingIcon = { SnotesIcon(SnotesSymbol.Restore, size = 16.dp) },
                                            onClick = { bookMenu = false; showingHistory = !showingHistory },
                                        )
                                        HorizontalDivider(color = colors.divider)
                                        DropdownMenuItem(
                                            text = { Text("解散并保留笔记") },
                                            onClick = {
                                                bookMenu = false
                                                dissolvingBook = current.book.id to current.book.name
                                            },
                                        )
                                        DropdownMenuItem(
                                            text = { Text("永久删除笔记本及内容", color = colors.danger) },
                                            leadingIcon = { SnotesIcon(SnotesSymbol.Trash, size = 16.dp, tint = colors.danger) },
                                            onClick = {
                                                bookMenu = false
                                                typedName = ""
                                                deletingBook = current.book.id to current.book.name
                                            },
                                        )
                                    }
                                }
                            }
                        }
                    },
                )
                if (selected == null) {
                    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                        Row(
                            modifier = Modifier
                                .widthIn(max = 880.dp)
                                .fillMaxWidth()
                                .padding(horizontal = 14.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            SnotesSearchField(
                                value = bookQuery,
                                onValueChange = { bookQuery = it.take(256) },
                                placeholder = "搜索笔记本名称或简介",
                                modifier = Modifier.weight(1f),
                            )
                            Box {
                                SnotesSortTriggerButton(
                                    label = sortLabel,
                                    description = "笔记本排序",
                                    active = sort != "updated",
                                    onClick = { sortMenu = true },
                                )
                                if (sortMenu) {
                                    DropdownMenu(
                                        expanded = true,
                                        onDismissRequest = { sortMenu = false },
                                        containerColor = colors.bgSurface,
                                        shape = RoundedCornerShape(10.dp),
                                    ) {
                                        listOf("updated" to "最近更新", "title" to "名称顺序").forEach { (key, label) ->
                                            DropdownMenuItem(
                                                text = {
                                                    Text(
                                                        label,
                                                        color = if (sort == key) colors.accent else colors.textPrimary,
                                                        fontWeight = if (sort == key) FontWeight.SemiBold else FontWeight.Normal,
                                                    )
                                                },
                                                trailingIcon = {
                                                    if (sort == key) SnotesIcon(SnotesSymbol.Check, size = 15.dp, tint = colors.accent)
                                                },
                                                onClick = { sort = key; sortMenu = false },
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
    ) { insets ->
        AnimatedContent(
            targetState = selected,
            transitionSpec = {
                if (targetState != null && initialState == null) {
                    ContentTransform(
                        targetContentEnter = slideInHorizontally(tween(SnotesMotion.NormalMs, easing = SnotesMotion.PageSlide)) { it / 3 } + fadeIn(tween(SnotesMotion.FastMs)),
                        initialContentExit = fadeOut(tween(SnotesMotion.FastMs)),
                    )
                } else if (targetState == null && initialState != null) {
                    ContentTransform(
                        targetContentEnter = fadeIn(tween(SnotesMotion.FastMs)),
                        initialContentExit = slideOutHorizontally(tween(SnotesMotion.NormalMs, easing = SnotesMotion.PageSlide)) { it / 3 } + fadeOut(tween(SnotesMotion.FastMs)),
                    )
                } else {
                    fadeIn(tween(SnotesMotion.FastMs)) togetherWith fadeOut(tween(SnotesMotion.FastMs))
                }
            },
            label = "book-view-transition",
        ) { activeBookId ->
            if (activeBookId == null) {
                val visible = remember(entries, bookQuery, sort, metadata) {
                    entries.filter {
                        it.invalid == 0 &&
                            (bookQuery.isBlank() || matchesAllTerms("${it.name}\n${it.description}", bookQuery))
                    }.sortedWith(
                        if (sort == "title") compareBy({ it.name.lowercase() }, { it.id })
                        else compareByDescending<KnowledgeBaseEntity> { metadata[it.id]?.updateTime ?: 0L }.thenBy { it.id },
                    )
                }
                PullToRefreshBox(
                    isRefreshing = syncRunning,
                    onRefresh = onRefresh,
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.TopCenter,
                ) {
                    LazyVerticalGrid(
                        columns = GridCells.Adaptive(minSize = 260.dp),
                        modifier = Modifier
                            .widthIn(max = 880.dp)
                            .fillMaxSize()
                            .consumeWindowInsets(insets),
                        contentPadding = PaddingValues(
                            start = 14.dp + insets.calculateStartPadding(layoutDirection),
                            end = 14.dp + insets.calculateEndPadding(layoutDirection),
                            top = insets.calculateTopPadding() + 4.dp,
                            bottom = insets.calculateBottomPadding() + 32.dp,
                        ),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                    if (visible.isEmpty() && catalog.loaded) {
                        item(span = { GridItemSpan(maxLineSpan) }) {
                            EmptyWorkspace(
                                symbol = SnotesSymbol.Books,
                                title = if (bookQuery.isNotBlank()) "没有找到匹配的笔记本" else "还没有笔记本",
                            )
                        }
                    }
                    items(visible, key = { it.id }) { book ->
                        val refCount = refCountByBook[book.id] ?: 0
                        val meta = metadata[book.id]
                        val iconText = meta?.icon?.takeIf { it.isNotBlank() && it != "📚" }
                        val updatedTime = meta?.updateTime ?: 0L
                        BookOverviewCard(
                            book = book,
                            iconText = iconText,
                            refCount = refCount,
                            updatedTime = updatedTime,
                            onClick = { selected = book.id; tocQuery = ""; showingHistory = false },
                            onEdit = {
                                creating = false
                                editingBookId = book.id
                                name = book.name
                                description = book.description
                            },
                            onDissolve = { dissolvingBook = book.id to book.name },
                            onDelete = { typedName = ""; deletingBook = book.id to book.name },
                        )
                    }
                    }
                }
            } else {
                val activeDetail = catalog.details[activeBookId] ?: current
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
                    if (activeDetail != null && activeDetail.book.id == activeBookId) {
                        val current = activeDetail
                        val noteTotal = current.toc.nodes.count { it.kind == "note" }
                        val folderTotal = current.toc.nodes.count { it.kind == "folder" }
                        val allFolders = remember(current.toc.nodes) {
                            current.toc.nodes.filter { it.kind == "folder" }.map { it.id }
                        }
                        var matchedBookNotes by remember(current.book.id, tocQuery) { mutableStateOf(emptySet<String>()) }
                        LaunchedEffect(current.book.id, tocQuery, current.book.changeSeq, nodes) {
                            matchedBookNotes = if (tocQuery.isBlank()) {
                                emptySet()
                            } else {
                                model.matchingBookNoteIds(current.book.id, tocQuery)
                            }
                        }

                        fun flatten(parent: String?, depth: Int, path: List<String>): List<Triple<TocNodeDto, Int, List<String>>> =
                            if (depth >= 8) emptyList()
                            else current.toc.nodes
                                .filter { it.parentId == parent }
                                .sortedWith(compareBy({ it.ord }, { it.id }))
                                .flatMap { node ->
                                    val nodeTitle = if (node.kind == "folder") node.title.orEmpty().ifBlank { "未命名章节" }
                                    else noteTitles[node.noteId]?.first ?: "无标题"
                                    val children = if (tocQuery.isBlank() && node.id in collapsed) {
                                        emptyList()
                                    } else {
                                        flatten(node.id, depth + 1, path + nodeTitle)
                                    }
                                    listOf(Triple(node, depth, path)) + children
                                }

                        val allTreeRows = remember(current.toc.nodes, collapsed, tocQuery, noteTitles, matchedBookNotes) {
                            val rows = flatten(null, 0, emptyList())
                            if (tocQuery.isBlank()) rows
                            else {
                                rows.filter { (node, _, _) ->
                                    val label = if (node.kind == "folder") node.title.orEmpty()
                                    else noteTitles[node.noteId]?.first.orEmpty()
                                    matchesAllTerms(label, tocQuery) || (node.noteId != null && node.noteId in matchedBookNotes)
                                }
                            }
                        }

                        LazyColumn(
                            Modifier
                                .widthIn(max = 840.dp)
                                .fillMaxSize()
                                .consumeWindowInsets(insets),
                            contentPadding = PaddingValues(
                                start = insets.calculateStartPadding(layoutDirection),
                                end = insets.calculateEndPadding(layoutDirection),
                                top = insets.calculateTopPadding(),
                                bottom = insets.calculateBottomPadding() + 28.dp,
                            ),
                        ) {
                            // 1. Compact Notebook Overview & Quick Actions Bar
                            item(key = "kb-home-hero") {
                                Column(
                                    Modifier
                                        .fillMaxWidth()
                                        .background(colors.bgSurface)
                                        .padding(horizontal = 16.dp, vertical = 14.dp),
                                    verticalArrangement = Arrangement.spacedBy(10.dp),
                                ) {
                                    if (current.book.description.isNotBlank()) {
                                        Text(
                                            current.book.description,
                                            style = MaterialTheme.typography.bodyMedium,
                                            color = colors.textSecondary,
                                        )
                                    }
                                    Row(
                                        Modifier.fillMaxWidth(),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    ) {
                                        Surface(
                                            onClick = { renamingFolderId = null; folderParent = null; folder = "" },
                                            shape = RoundedCornerShape(7.dp),
                                            color = colors.bgList,
                                            border = BorderStroke(1.dp, colors.borderDefault),
                                            modifier = Modifier.height(34.dp),
                                        ) {
                                            Row(
                                                Modifier.padding(horizontal = 11.dp),
                                                verticalAlignment = Alignment.CenterVertically,
                                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                            ) {
                                                SnotesIcon(SnotesSymbol.Folder, size = 14.dp, tint = colors.accent)
                                                Text("添加章节", style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Medium), color = colors.textPrimary)
                                            }
                                        }
                                        Surface(
                                            onClick = { pickingParent = null; query = ""; picking = true },
                                            shape = RoundedCornerShape(7.dp),
                                            color = colors.bgList,
                                            border = BorderStroke(1.dp, colors.borderDefault),
                                            modifier = Modifier.height(34.dp),
                                        ) {
                                            Row(
                                                Modifier.padding(horizontal = 11.dp),
                                                verticalAlignment = Alignment.CenterVertically,
                                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                            ) {
                                                SnotesIcon(SnotesSymbol.Notes, size = 14.dp, tint = colors.accent)
                                                Text("加入笔记", style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Medium), color = colors.textPrimary)
                                            }
                                        }
                                        Spacer(Modifier.weight(1f))
                                        Text(
                                            if (folderTotal > 0) "$noteTotal 文档 · $folderTotal 章节" else "$noteTotal 文档",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = colors.textTertiary,
                                        )
                                    }
                                }
                                HorizontalDivider(color = colors.borderLight, thickness = 0.75.dp)
                            }

                        val relevant = failures.filter { it.task.entityType == "book" && it.task.entityId == current.book.id }
                        if (relevant.isNotEmpty()) {
                            item(key = "book-failures") {
                                SnotesCard(
                                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                                    containerColor = colors.dangerBg,
                                    borderColor = colors.danger.copy(alpha = 0.25f),
                                ) {
                                    Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                        relevant.forEach { Text(it.task.lastError.orEmpty(), style = MaterialTheme.typography.bodySmall, color = colors.danger) }
                                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                            TextButton(onClick = { model.act { resolve(current.book.id, true) } }) { Text("保留本机并重试") }
                                            TextButton(onClick = { model.act { resolve(current.book.id, false) } }) { Text("采用远端") }
                                        }
                                    }
                                }
                            }
                        }

                        // 2. Search within this Notebook & Directory Header (matches Web `.kb-search-create` + `.kb-directory-heading`)
                        item(key = "kb-directory-header") {
                            Column(
                                Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 16.dp, vertical = 12.dp),
                                verticalArrangement = Arrangement.spacedBy(10.dp),
                            ) {
                                SnotesSearchField(
                                    value = tocQuery,
                                    onValueChange = { tocQuery = it.take(200) },
                                    placeholder = "搜索本笔记本中的笔记",
                                    modifier = Modifier.fillMaxWidth(),
                                )
                                Row(
                                    Modifier.fillMaxWidth().padding(horizontal = 4.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                                ) {
                                    SnotesIcon(SnotesSymbol.ListPanel, size = 17.dp, tint = colors.textSecondary)
                                    Text(
                                        "目录",
                                        style = MaterialTheme.typography.titleMedium,
                                        color = colors.textPrimary,
                                        modifier = Modifier.weight(1f),
                                    )
                                    if (allFolders.isNotEmpty()) {
                                        val allCollapsed = collapsed.containsAll(allFolders)
                                        TextButton(
                                            onClick = { collapsed = if (allCollapsed) emptyList() else allFolders },
                                            contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp),
                                        ) {
                                            Text(
                                                if (allCollapsed) "展开全部" else "收起全部",
                                                style = MaterialTheme.typography.labelMedium,
                                                color = colors.textSecondary,
                                            )
                                        }
                                    }
                                    Box {
                                        IconButton(onClick = { createMenu = true }, modifier = Modifier.size(34.dp)) {
                                            SnotesIcon(SnotesSymbol.Plus, size = 17.dp, description = "更多新建方式", tint = colors.textSecondary)
                                        }
                                        if (createMenu) {
                                            DropdownMenu(
                                                expanded = true,
                                                onDismissRequest = { createMenu = false },
                                                containerColor = colors.bgSurface,
                                                shape = RoundedCornerShape(10.dp),
                                            ) {
                                                DropdownMenuItem(
                                                    text = { Text("新建笔记") },
                                                    leadingIcon = { SnotesIcon(SnotesSymbol.Plus, size = 16.dp) },
                                                    enabled = !creatingNote && current.book.invalid == 0,
                                                    onClick = {
                                                        createMenu = false
                                                        creatingNote = true
                                                        scope.launch { try { model.createNote(current.book.id)?.let(onOpen) } finally { creatingNote = false } }
                                                    },
                                                )
                                                DropdownMenuItem(
                                                    text = { Text("加入笔记") },
                                                    leadingIcon = { SnotesIcon(SnotesSymbol.Notes, size = 16.dp) },
                                                    onClick = { createMenu = false; pickingParent = null; query = ""; picking = true },
                                                )
                                                DropdownMenuItem(
                                                    text = { Text("新建章节") },
                                                    leadingIcon = { SnotesIcon(SnotesSymbol.Folder, size = 16.dp) },
                                                    onClick = { createMenu = false; renamingFolderId = null; folderParent = null; folder = "" },
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        // 3. Directory Tree Rows (matches Web `.knowledge-base-tree` / `.kb-tree-row`)
                        if (current.toc.nodes.isEmpty()) {
                            item(key = "toc-empty") {
                                Text(
                                    "目录还是空的，加入笔记或新建章节。",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = colors.textTertiary,
                                    modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 28.dp),
                                )
                            }
                        } else if (allTreeRows.isEmpty()) {
                            item(key = "toc-search-empty") {
                                Text(
                                    "没有匹配的目录或笔记",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = colors.textTertiary,
                                    modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 24.dp),
                                )
                            }
                        } else {
                            items(allTreeRows, key = { (node, _, _) -> "toc:${node.id}" }) { (node, depth, path) ->
                                val isFolder = node.kind == "folder"
                                val cachedInfo = node.noteId?.let { noteTitles[it] }
                                var label by remember(node, current.book.changeSeq, cachedInfo) {
                                    mutableStateOf(
                                        if (isFolder) node.title.orEmpty().ifBlank { "未命名章节" }
                                        else cachedInfo?.first ?: "无标题",
                                    )
                                }
                                var available by remember(node, cachedInfo) {
                                    mutableStateOf(cachedInfo?.second ?: false)
                                }
                                LaunchedEffect(node, current.book.changeSeq) {
                                    if (node.noteId != null && cachedInfo == null) {
                                        val result = model.label(node.noteId)
                                        label = result.first
                                        available = result.second
                                    }
                                }
                                var nodeMenu by remember { mutableStateOf(false) }
                                val isCollapsed = node.id in collapsed
                                val chevronAngle by animateFloatAsState(
                                    targetValue = if (isCollapsed) 0f else 90f,
                                    animationSpec = tween(SnotesMotion.FastMs, easing = SnotesMotion.EaseOut),
                                    label = "toc-chevron",
                                )
                                val siblings = remember(current.toc.nodes, node.parentId) {
                                    current.toc.nodes.filter { it.parentId == node.parentId }.sortedWith(compareBy({ it.ord }, { it.id }))
                                }
                                val siblingIndex = siblings.indexOfFirst { it.id == node.id }

                                Row(
                                    Modifier
                                        .fillMaxWidth()
                                        .padding(horizontal = 12.dp, vertical = 1.dp)
                                        .clip(RoundedCornerShape(8.dp))
                                        .defaultMinSize(minHeight = 46.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Row(
                                        Modifier
                                            .weight(1f)
                                            .clickable(enabled = available || isFolder) {
                                                if (isFolder) collapsed = if (isCollapsed) collapsed - node.id else collapsed + node.id
                                                else onOpen(node.noteId!!)
                                            }
                                            .padding(start = (10 + depth.coerceAtMost(5) * 16).dp, end = 6.dp, top = 10.dp, bottom = 10.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(9.dp),
                                    ) {
                                        if (isFolder) {
                                            SnotesIcon(
                                                SnotesSymbol.Chevron,
                                                size = 14.dp,
                                                tint = colors.textTertiary,
                                                modifier = Modifier.rotate(chevronAngle),
                                            )
                                            SnotesIcon(
                                                SnotesSymbol.Folder,
                                                size = 17.dp,
                                                tint = colors.textSecondary,
                                            )
                                        } else {
                                            SnotesIcon(
                                                SnotesSymbol.Note,
                                                size = 17.dp,
                                                tint = if (available) colors.accent else colors.textDisabled,
                                            )
                                        }
                                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                                            Text(
                                                label,
                                                style = MaterialTheme.typography.bodyMedium.copy(
                                                    fontSize = 14.5.sp,
                                                    fontWeight = if (isFolder) FontWeight.SemiBold else FontWeight.Normal,
                                                ),
                                                color = if (!isFolder && !available) colors.textTertiary else colors.textPrimary,
                                                maxLines = 1,
                                                overflow = TextOverflow.Ellipsis,
                                            )
                                            if (tocQuery.isNotBlank() && path.isNotEmpty()) {
                                                Text(
                                                    path.joinToString(" / "),
                                                    style = MaterialTheme.typography.labelSmall,
                                                    color = colors.textTertiary,
                                                    maxLines = 1,
                                                    overflow = TextOverflow.Ellipsis,
                                                )
                                            }
                                        }
                                    }
                                    Box(Modifier.padding(end = 2.dp)) {
                                        IconButton(onClick = { nodeMenu = true }, modifier = Modifier.size(36.dp)) {
                                            SnotesIcon(SnotesSymbol.More, size = 16.dp, description = "目录操作：$label", tint = colors.textTertiary)
                                        }
                                        if (nodeMenu) {
                                            DropdownMenu(
                                                expanded = true,
                                                onDismissRequest = { nodeMenu = false },
                                                containerColor = colors.bgSurface,
                                                shape = RoundedCornerShape(10.dp),
                                            ) {
                                                if (isFolder && current.book.invalid == 0) {
                                                    DropdownMenuItem(
                                                        text = { Text("在此新建笔记") },
                                                        leadingIcon = { SnotesIcon(SnotesSymbol.Plus, size = 16.dp) },
                                                        enabled = !creatingNote,
                                                        onClick = {
                                                            nodeMenu = false
                                                            creatingNote = true
                                                            collapsed = collapsed - node.id
                                                            scope.launch { try { model.createNote(current.book.id, node.id)?.let(onOpen) } finally { creatingNote = false } }
                                                        },
                                                    )
                                                    DropdownMenuItem(
                                                        text = { Text("在此加入笔记") },
                                                        leadingIcon = { SnotesIcon(SnotesSymbol.Notes, size = 16.dp) },
                                                        onClick = { nodeMenu = false; pickingParent = node.id; query = ""; picking = true },
                                                    )
                                                    DropdownMenuItem(
                                                        text = { Text("新建子章节") },
                                                        leadingIcon = { SnotesIcon(SnotesSymbol.Folder, size = 16.dp) },
                                                        onClick = { nodeMenu = false; renamingFolderId = null; folderParent = node.id; folder = "" },
                                                    )
                                                    HorizontalDivider(color = colors.divider)
                                                    DropdownMenuItem(
                                                        text = { Text("重命名") },
                                                        leadingIcon = { SnotesIcon(SnotesSymbol.Edit, size = 16.dp) },
                                                        onClick = {
                                                            nodeMenu = false
                                                            renamingFolderId = node.id
                                                            folder = node.title.orEmpty()
                                                        },
                                                    )
                                                }
                                                DropdownMenuItem(
                                                    text = { Text("上移") },
                                                    leadingIcon = { SnotesIcon(SnotesSymbol.ArrowUp, size = 16.dp) },
                                                    enabled = siblingIndex > 0,
                                                    onClick = {
                                                        nodeMenu = false
                                                        val prevSibling = siblings.getOrNull(siblingIndex - 1) ?: return@DropdownMenuItem
                                                        model.act {
                                                            editToc(
                                                                current.book.id,
                                                                current.toc.nodes.map {
                                                                    when (it.id) {
                                                                        node.id -> it.copy(ord = prevSibling.ord)
                                                                        prevSibling.id -> it.copy(ord = node.ord)
                                                                        else -> it
                                                                    }
                                                                },
                                                            )
                                                        }
                                                    },
                                                )
                                                DropdownMenuItem(
                                                    text = { Text("下移") },
                                                    leadingIcon = { SnotesIcon(SnotesSymbol.ArrowDown, size = 16.dp) },
                                                    enabled = siblingIndex >= 0 && siblingIndex < siblings.lastIndex,
                                                    onClick = {
                                                        nodeMenu = false
                                                        val nextSibling = siblings.getOrNull(siblingIndex + 1) ?: return@DropdownMenuItem
                                                        model.act {
                                                            editToc(
                                                                current.book.id,
                                                                current.toc.nodes.map {
                                                                    when (it.id) {
                                                                        node.id -> it.copy(ord = nextSibling.ord)
                                                                        nextSibling.id -> it.copy(ord = node.ord)
                                                                        else -> it
                                                                    }
                                                                },
                                                            )
                                                        }
                                                    },
                                                )
                                                DropdownMenuItem(
                                                    text = { Text("移动") },
                                                    onClick = { nodeMenu = false; moving = node },
                                                )
                                                if (node.noteId != null) {
                                                    DropdownMenuItem(
                                                        text = { Text("移出笔记本，转为独立笔记") },
                                                        onClick = {
                                                            nodeMenu = false
                                                            model.act {
                                                                editToc(current.book.id, current.toc.nodes.filter { it.id != node.id })
                                                            }
                                                        },
                                                    )
                                                }
                                                HorizontalDivider(color = colors.divider)
                                                if (node.noteId != null) {
                                                    DropdownMenuItem(
                                                        text = {
                                                            Text(
                                                                if (available) "移到回收站" else "恢复引用笔记",
                                                                color = if (available) colors.danger else colors.accent,
                                                            )
                                                        },
                                                        onClick = { nodeMenu = false; model.noteTrash(node.noteId, current.book.id, available) },
                                                    )
                                                } else {
                                                    DropdownMenuItem(
                                                        text = { Text("删除章节", color = colors.danger) },
                                                        onClick = {
                                                            nodeMenu = false
                                                            model.act {
                                                                val ids = mutableSetOf(node.id)
                                                                var changed = true
                                                                while (changed) {
                                                                    changed = false
                                                                    current.toc.nodes.forEach { if (it.parentId in ids && ids.add(it.id)) changed = true }
                                                                }
                                                                editToc(current.book.id, current.toc.nodes.filter { it.id !in ids })
                                                            }
                                                        },
                                                    )
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        // 4. Directory Footer (matches Web `.kb-directory-footer`)
                        item(key = "kb-directory-footer") {
                            Column(Modifier.fillMaxWidth().padding(top = 12.dp)) {
                                HorizontalDivider(color = colors.divider, thickness = 0.75.dp)
                                Text(
                                    "$noteTotal 篇笔记",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = colors.textTertiary,
                                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
                                )
                            }
                        }

                        if (showingHistory) {
                            val bookHistory = history.filter { it.key.startsWith("book_history:${current.book.id}:") }.takeLast(20).reversed()
                            item(key = "history-label") { SectionLabel("目录历史", Modifier.padding(horizontal = 16.dp)) }
                            if (bookHistory.isEmpty()) {
                                item(key = "history-empty") {
                                    Text(
                                        "暂无目录历史",
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = colors.textTertiary,
                                        modifier = Modifier.padding(horizontal = 22.dp, vertical = 12.dp),
                                    )
                                }
                            } else {
                                item(key = "history-list") {
                                    SnotesCard(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
                                        bookHistory.forEachIndexed { idx, entry ->
                                            val historical = syncJson.parseToJsonElement(entry.value).jsonObject
                                            Row(
                                                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                                                verticalAlignment = Alignment.CenterVertically,
                                            ) {
                                                Text(
                                                    "历史快照 · ${historical["time"]?.jsonPrimitive?.content}",
                                                    style = MaterialTheme.typography.bodyMedium,
                                                    color = colors.textPrimary,
                                                    modifier = Modifier.weight(1f),
                                                )
                                                TextButton(onClick = {
                                                    model.act {
                                                        val histNodes = syncJson.decodeFromJsonElement<List<TocNodeDto>>(historical.getValue("nodes"))
                                                        val meta = historical["meta"]?.jsonObject
                                                        if (meta != null) {
                                                            editMeta(
                                                                current.book.id,
                                                                meta.getValue("name").jsonPrimitive.content,
                                                                meta.getValue("description").jsonPrimitive.content,
                                                                meta.getValue("invalid").jsonPrimitive.int,
                                                                meta.getValue("icon").jsonPrimitive.content,
                                                                meta.getValue("ord").jsonPrimitive.int,
                                                            )
                                                        }
                                                        editToc(current.book.id, histNodes, true)
                                                    }
                                                }) { Text("恢复") }
                                            }
                                            if (idx < bookHistory.lastIndex) HorizontalDivider(Modifier.padding(horizontal = 16.dp), color = colors.divider)
                                        }
                                    }
                                }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (name != null) {
        AlertDialog(
            onDismissRequest = { name = null; editingBookId = null },
            containerColor = colors.bgSurface,
            shape = RoundedCornerShape(18.dp),
            title = { Text(if (creating) "新建笔记本" else "编辑笔记本", style = MaterialTheme.typography.titleLarge) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedTextField(
                        name.orEmpty(),
                        { name = it.take(100) },
                        label = { Text("名称") },
                        singleLine = true,
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        description,
                        { description = it.take(2000) },
                        label = { Text("简介") },
                        minLines = 2,
                        maxLines = 4,
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        val chosenName = name.orEmpty()
                        val desc = description
                        val targetId = editingBookId ?: current?.book?.id
                        model.act {
                            if (creating) {
                                val id = create(chosenName)
                                editMeta(id, chosenName, desc)
                            } else if (targetId != null) {
                                val existing = desired(targetId)
                                editMeta(targetId, chosenName, desc, existing?.book?.invalid ?: 0)
                            }
                        }
                        name = null
                        editingBookId = null
                    },
                    enabled = name?.isNotBlank() == true,
                    shape = RoundedCornerShape(10.dp),
                ) { Text("保存") }
            },
            dismissButton = { TextButton(onClick = { name = null; editingBookId = null }) { Text("取消") } },
        )
    }

    if (folder != null && current != null) {
        val isRename = renamingFolderId != null
        AlertDialog(
            onDismissRequest = { folder = null; renamingFolderId = null },
            containerColor = colors.bgSurface,
            shape = RoundedCornerShape(18.dp),
            title = { Text(if (isRename) "重命名章节" else "添加章节", style = MaterialTheme.typography.titleLarge) },
            text = {
                OutlinedTextField(
                    folder.orEmpty(),
                    { folder = it.take(100) },
                    label = { Text("章节名称") },
                    singleLine = true,
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.fillMaxWidth(),
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        val title = folder.orEmpty().trim()
                        val targetNodeId = renamingFolderId
                        val parent = folderParent
                        model.act {
                            if (targetNodeId != null) {
                                editToc(
                                    current.book.id,
                                    current.toc.nodes.map {
                                        if (it.id == targetNodeId) it.copy(title = title) else it
                                    },
                                )
                            } else {
                                editToc(
                                    current.book.id,
                                    current.toc.nodes + TocNodeDto(
                                        UUID.randomUUID().toString(),
                                        parent,
                                        "folder",
                                        current.toc.nodes.count { it.parentId == parent },
                                        null,
                                        title,
                                    ),
                                )
                            }
                        }
                        folder = null
                        renamingFolderId = null
                    },
                    enabled = folder?.isNotBlank() == true,
                    shape = RoundedCornerShape(10.dp),
                ) { Text(if (isRename) "保存" else "添加") }
            },
            dismissButton = { TextButton(onClick = { folder = null; renamingFolderId = null }) { Text("取消") } },
        )
    }

    if (picking && current != null) {
        AlertDialog(
            onDismissRequest = { picking = false },
            containerColor = colors.bgSurface,
            shape = RoundedCornerShape(18.dp),
            title = { Text("加入已有笔记", style = MaterialTheme.typography.titleLarge) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedTextField(
                        query,
                        { query = it.take(100) },
                        label = { Text("搜索已有笔记") },
                        singleLine = true,
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    LazyColumn(Modifier.heightIn(max = 280.dp)) {
                        if (candidates.isEmpty()) {
                            item {
                                Text(
                                    "没有可加入的独立笔记",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = colors.textTertiary,
                                    modifier = Modifier.padding(vertical = 16.dp),
                                )
                            }
                        }
                        items(candidates, key = { it.id }) { note ->
                            val display = note.title.ifBlank { if (!note.thumbnail.isNullOrBlank()) "图片笔记" else "无标题" }
                            Row(
                                Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(8.dp))
                                    .clickable {
                                        val parent = pickingParent
                                        model.act {
                                            editToc(
                                                current.book.id,
                                                current.toc.nodes + TocNodeDto(
                                                    UUID.randomUUID().toString(),
                                                    parent,
                                                    "note",
                                                    current.toc.nodes.count { it.parentId == parent },
                                                    note.id,
                                                    null,
                                                ),
                                            )
                                        }
                                        picking = false
                                    }
                                    .padding(horizontal = 10.dp, vertical = 11.dp),
                            ) {
                                Text(display, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                            HorizontalDivider(color = colors.divider)
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { picking = false }) { Text("关闭") } },
        )
    }

    if (moving != null && current != null) {
        AlertDialog(
            onDismissRequest = { moving = null },
            containerColor = colors.bgSurface,
            shape = RoundedCornerShape(18.dp),
            title = { Text("移动节点", style = MaterialTheme.typography.titleLarge) },
            text = {
                LazyColumn(Modifier.heightIn(max = 320.dp)) {
                    items(listOf<TocNodeDto?>(null) + current.toc.nodes.filter { it.kind == "folder" && it.id != moving?.id }) { parent ->
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(8.dp))
                                .clickable {
                                    val node = moving!!
                                    model.act {
                                        editToc(
                                            current.book.id,
                                            current.toc.nodes.map {
                                                if (it.id == node.id) it.copy(parentId = parent?.id, ord = current.toc.nodes.count { item -> item.parentId == parent?.id }) else it
                                            },
                                        )
                                    }
                                    moving = null
                                }
                                .padding(horizontal = 10.dp, vertical = 12.dp),
                        ) {
                            Text(parent?.title ?: "根目录", style = MaterialTheme.typography.bodyLarge)
                        }
                        HorizontalDivider(color = colors.divider)
                    }
                }
            },
            confirmButton = { TextButton(onClick = { moving = null }) { Text("取消") } },
        )
    }

    dissolvingBook?.let { (bookId, bookName) ->
        AlertDialog(
            onDismissRequest = { dissolvingBook = null },
            containerColor = colors.bgSurface,
            shape = RoundedCornerShape(18.dp),
            title = { Text("解散笔记本「$bookName」？", style = MaterialTheme.typography.titleLarge) },
            text = {
                Text(
                    "保留全部笔记及正文，只移除这本笔记本。未删除的内容仍可在“全部笔记”中找到。",
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.textSecondary,
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        model.act {
                            val target = desired(bookId)
                            if (target != null) {
                                editToc(bookId, emptyList())
                                editMeta(bookId, target.book.name, target.book.description, 1)
                            }
                        }
                        if (selected == bookId) selected = null
                        dissolvingBook = null
                    },
                    shape = RoundedCornerShape(10.dp),
                ) { Text("解散并保留笔记") }
            },
            dismissButton = { TextButton(onClick = { dissolvingBook = null }) { Text("取消") } },
        )
    }

    deletingBook?.let { (bookId, bookName) ->
        AlertDialog(
            onDismissRequest = { deletingBook = null },
            containerColor = colors.bgSurface,
            shape = RoundedCornerShape(18.dp),
            title = { Text("永久删除笔记本", style = MaterialTheme.typography.titleLarge) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        "将永久删除笔记本及其中的笔记，无法恢复。请输入完整名称：$bookName",
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.textSecondary,
                    )
                    OutlinedTextField(
                        typedName,
                        { typedName = it },
                        label = { Text("完整名称") },
                        singleLine = true,
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        model.act { deletePermanently(bookId, typedName) }
                        if (selected == bookId) selected = null
                        deletingBook = null
                    },
                    enabled = typedName == bookName,
                    colors = ButtonDefaults.buttonColors(containerColor = colors.danger),
                    shape = RoundedCornerShape(10.dp),
                ) { Text("永久删除") }
            },
            dismissButton = { TextButton(onClick = { deletingBook = null }) { Text("取消") } },
        )
    }
}

/**
 * Web-aligned Notebook Card (`.kb-card` in `src/components/knowledge-base.css`).
 */
@Composable
private fun BookOverviewCard(
    book: KnowledgeBaseEntity,
    iconText: String?,
    refCount: Int,
    updatedTime: Long,
    onClick: () -> Unit,
    onEdit: () -> Unit,
    onDissolve: () -> Unit,
    onDelete: () -> Unit,
) {
    val colors = MaterialTheme.snotesColors
    var menu by remember { mutableStateOf(false) }
    val updatedDate = remember(updatedTime) { formatBookUpdateDate(updatedTime) }

    SnotesCard(
        onClick = onClick,
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 18.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Box(
                    Modifier
                        .size(42.dp)
                        .clip(RoundedCornerShape(11.dp))
                        .background(colors.accentSoft)
                        .border(1.dp, colors.accent.copy(alpha = 0.12f), RoundedCornerShape(11.dp)),
                    contentAlignment = Alignment.Center,
                ) {
                    if (iconText != null) {
                        Text(iconText, fontSize = 20.sp)
                    } else {
                        SnotesIcon(SnotesSymbol.Books, size = 21.dp, tint = colors.accent)
                    }
                }
                Text(
                    book.name,
                    style = MaterialTheme.typography.titleMedium.copy(fontSize = 17.sp, fontWeight = FontWeight.SemiBold),
                    color = colors.textPrimary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Box {
                    IconButton(
                        onClick = { menu = true },
                        modifier = Modifier
                            .size(32.dp)
                            .semantics { contentDescription = "笔记本「${book.name}」操作" },
                    ) {
                        SnotesIcon(SnotesSymbol.More, size = 17.dp, tint = colors.textTertiary)
                    }
                    if (menu) {
                        DropdownMenu(
                            expanded = true,
                            onDismissRequest = { menu = false },
                            containerColor = colors.bgSurface,
                            shape = RoundedCornerShape(10.dp),
                        ) {
                            DropdownMenuItem(
                                text = { Text("编辑笔记本") },
                                leadingIcon = { SnotesIcon(SnotesSymbol.Edit, size = 16.dp) },
                                onClick = { menu = false; onEdit() },
                            )
                            HorizontalDivider(color = colors.divider)
                            DropdownMenuItem(
                                text = { Text("解散并保留笔记") },
                                onClick = { menu = false; onDissolve() },
                            )
                            DropdownMenuItem(
                                text = { Text("永久删除笔记本及内容", color = colors.danger) },
                                leadingIcon = { SnotesIcon(SnotesSymbol.Trash, size = 16.dp, tint = colors.danger) },
                                onClick = { menu = false; onDelete() },
                            )
                        }
                    }
                }
            }

            if (book.description.isNotBlank()) {
                Text(
                    book.description,
                    style = MaterialTheme.typography.bodyMedium.copy(fontSize = 13.5.sp),
                    color = colors.textSecondary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    "$refCount 篇笔记",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textTertiary,
                )
                if (updatedDate.isNotBlank()) {
                    Text("·", style = MaterialTheme.typography.bodySmall, color = colors.textTertiary)
                    Text(
                        "$updatedDate 更新",
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.textTertiary,
                    )
                }
            }
        }
    }
}
