package io.github.xilele777.snotes.feature.notes

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.xilele777.snotes.R
import io.github.xilele777.snotes.core.database.GroupEntity
import io.github.xilele777.snotes.core.ui.*
import kotlinx.coroutines.launch

/**
 * Web-aligned navigation drawer: modal drawer on phones, persistent side rail on wider windows.
 * Uses a bottom-pinning vertical arrangement so utility tools and the single-line sync status stay
 * anchored at the bottom while preserving LazyColumn scrolling and `performScrollToNode`.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WorkspaceNavigation(
    section: String,
    model: NotesViewModel,
    onNavigate: (String) -> Unit,
    onConnect: () -> Unit,
    onFailures: () -> Unit,
    content: @Composable (openDrawer: (() -> Unit)?, drawerOpen: Boolean) -> Unit,
) {
    val colors = MaterialTheme.snotesColors
    val groups by model.groups.collectAsStateWithLifecycle()
    val sync by model.syncStatus.collectAsStateWithLifecycle()
    val failures by model.syncFailures.collectAsStateWithLifecycle()
    val totalNotes by model.totalActiveNotes.collectAsStateWithLifecycle()
    val booksCount by model.activeBooksCount.collectAsStateWithLifecycle()
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current

    var groupsCollapsed by rememberSaveable { mutableStateOf(false) }
    var editingGroupId by rememberSaveable { mutableStateOf<String?>(null) }
    var groupDialogText by rememberSaveable { mutableStateOf<String?>(null) }
    var savingGroup by remember { mutableStateOf(false) }
    var deletingGroup by remember { mutableStateOf<GroupEntity?>(null) }

    val navigate: (String) -> Unit = { destination ->
        focus.clearFocus()
        keyboard?.hide()
        onNavigate(destination)
        scope.launch { drawer.close() }
    }

    val bottomPinnedArrangement = remember {
        object : Arrangement.Vertical {
            override fun Density.arrange(totalSize: Int, sizes: IntArray, outPositions: IntArray) {
                var currentOffset = 0
                sizes.forEachIndexed { index, size ->
                    if (index == sizes.lastIndex) {
                        outPositions[index] = maxOf(currentOffset, totalSize - size)
                    } else {
                        outPositions[index] = currentOffset
                        currentOffset += size
                    }
                }
            }
        }
    }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val wide = maxWidth >= 720.dp
        BackHandler(!wide && drawer.isOpen) { scope.launch { drawer.close() } }

        val menu: @Composable ColumnScope.() -> Unit = {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .testTag("workspace-drawer"),
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 10.dp),
                verticalArrangement = bottomPinnedArrangement,
            ) {
                item(key = "header-and-notes") {
                    Column(Modifier.fillMaxWidth()) {
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .heightIn(min = 54.dp)
                                .padding(start = 8.dp, end = 4.dp, bottom = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Row(
                                Modifier
                                    .clip(RoundedCornerShape(8.dp))
                                    .clickable { navigate("home") }
                                    .padding(horizontal = 4.dp, vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Image(
                                    painter = painterResource(R.drawable.ic_notes),
                                    contentDescription = null,
                                    modifier = Modifier.size(28.dp),
                                )
                                SnotesBrandWordmark(
                                    tint = colors.textPrimary,
                                    width = 84.dp,
                                    height = 24.dp,
                                )
                            }
                            Spacer(Modifier.weight(1f))
                            if (!wide) {
                                IconButton(onClick = { scope.launch { drawer.close() } }) {
                                    SnotesIcon(SnotesSymbol.Close, size = 20.dp, description = "关闭侧栏", tint = colors.textSecondary)
                                }
                            }
                        }

                        DrawerSectionLabel("笔记")
                        DrawerNavRow(
                            label = "随手记",
                            icon = SnotesSymbol.Home,
                            selected = section == "home",
                            onClick = { navigate("home") },
                        )
                        Spacer(Modifier.height(2.dp))
                        DrawerNavRow(
                            label = "全部笔记",
                            icon = SnotesSymbol.Notes,
                            selected = section == "all",
                            count = totalNotes.takeIf { it > 0 },
                            onClick = { navigate("all") },
                        )
                        Spacer(Modifier.height(2.dp))
                        DrawerNavRow(
                            label = "星标笔记",
                            icon = SnotesSymbol.Star,
                            selected = section == "star",
                            onClick = { navigate("star") },
                        )
                        Spacer(Modifier.height(2.dp))
                        DrawerNavRow(
                            label = "已隐藏",
                            icon = SnotesSymbol.EyeOff,
                            selected = section == "hidden",
                            onClick = { navigate("hidden") },
                        )

                        Spacer(Modifier.height(6.dp))
                        DrawerSectionLabel("整理")
                        DrawerNavRow(
                            label = "笔记本",
                            icon = SnotesSymbol.Books,
                            selected = section == "books",
                            count = booksCount.takeIf { it > 0 },
                            onClick = { navigate("books") },
                        )

                        val chevronAngle by animateFloatAsState(
                            targetValue = if (groupsCollapsed) 0f else 90f,
                            animationSpec = tween(SnotesMotion.FastMs, easing = SnotesMotion.EaseOut),
                            label = "groups-chevron",
                        )
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .padding(top = 12.dp, bottom = 2.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Row(
                                Modifier
                                    .weight(1f)
                                    .clip(RoundedCornerShape(6.dp))
                                    .clickable { groupsCollapsed = !groupsCollapsed }
                                    .padding(horizontal = 12.dp, vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(5.dp),
                            ) {
                                Text(
                                    "分组",
                                    style = MaterialTheme.typography.labelMedium.copy(
                                        fontSize = 13.sp,
                                        fontWeight = FontWeight.SemiBold,
                                    ),
                                    color = colors.textSecondary,
                                )
                                Text(
                                    "${groups.size}",
                                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                                    color = colors.textTertiary,
                                )
                                SnotesIcon(
                                    SnotesSymbol.Chevron,
                                    size = 12.dp,
                                    tint = colors.textTertiary,
                                    modifier = Modifier.rotate(chevronAngle),
                                )
                            }
                            IconButton(
                                onClick = {
                                    editingGroupId = null
                                    groupDialogText = ""
                                },
                                modifier = Modifier.size(34.dp),
                            ) {
                                SnotesIcon(SnotesSymbol.Plus, size = 15.dp, description = "新建分组", tint = colors.textSecondary)
                            }
                        }
                    }
                }

                if (!groupsCollapsed) {
                    itemsIndexed(groups, key = { _, g -> "group:${g.id}" }) { index, group ->
                        val groupTint = remember(group.color) { parseHexColorOrNull(group.color) }
                        val isSelected = section == "group:${group.id}"
                        var groupMenu by remember { mutableStateOf(false) }

                        Row(
                            Modifier
                                .fillMaxWidth()
                                .padding(vertical = 1.dp)
                                .heightIn(min = 40.dp)
                                .clip(RoundedCornerShape(6.dp))
                                .background(if (isSelected) colors.accentSoft else Color.Transparent)
                                .clickable { navigate("group:${group.id}") }
                                .padding(start = 12.dp, end = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            SnotesIcon(
                                SnotesSymbol.Folder,
                                size = 17.dp,
                                tint = if (isSelected) colors.selectedText else (groupTint ?: colors.textTertiary),
                            )
                            Spacer(Modifier.width(10.dp))
                            Text(
                                group.name,
                                style = MaterialTheme.typography.bodyMedium.copy(
                                    fontSize = 14.sp,
                                    fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Medium,
                                ),
                                color = if (isSelected) colors.selectedText else colors.textPrimary,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f),
                            )
                            Box {
                                IconButton(
                                    onClick = { groupMenu = true },
                                    modifier = Modifier
                                        .size(32.dp)
                                        .semantics { contentDescription = "分组「${group.name}」操作" },
                                ) {
                                    SnotesIcon(SnotesSymbol.More, size = 15.dp, tint = colors.textTertiary)
                                }
                                if (groupMenu) {
                                    DropdownMenu(
                                        expanded = true,
                                        onDismissRequest = { groupMenu = false },
                                        containerColor = colors.bgSurface,
                                        shape = RoundedCornerShape(10.dp),
                                    ) {
                                        DropdownMenuItem(
                                            text = { Text("重命名") },
                                            leadingIcon = { SnotesIcon(SnotesSymbol.Edit, size = 16.dp) },
                                            onClick = {
                                                groupMenu = false
                                                editingGroupId = group.id
                                                groupDialogText = group.name
                                            },
                                        )
                                        SnotesColorSwatchRow(
                                            selectedColor = group.color,
                                            onSelect = { chosen ->
                                                groupMenu = false
                                                scope.launch { model.colorGroup(group.id, chosen) }
                                            },
                                        )
                                        HorizontalDivider(color = colors.divider)
                                        DropdownMenuItem(
                                            text = { Text("不在随手记中显示") },
                                            leadingIcon = {
                                                SnotesIcon(
                                                    if (group.homeHidden == 1) SnotesSymbol.EyeOff else SnotesSymbol.Eye,
                                                    size = 16.dp,
                                                )
                                            },
                                            trailingIcon = {
                                                if (group.homeHidden == 1) {
                                                    SnotesIcon(SnotesSymbol.Check, size = 15.dp, tint = colors.accent)
                                                }
                                            },
                                            onClick = {
                                                groupMenu = false
                                                scope.launch { model.hideGroupFromHome(group.id, group.homeHidden != 1) }
                                            },
                                        )
                                        HorizontalDivider(color = colors.divider)
                                        DropdownMenuItem(
                                            text = { Text("上移") },
                                            leadingIcon = { SnotesIcon(SnotesSymbol.ArrowUp, size = 16.dp) },
                                            enabled = index > 0,
                                            onClick = {
                                                groupMenu = false
                                                scope.launch { model.moveGroup(group.id, -1) }
                                            },
                                        )
                                        DropdownMenuItem(
                                            text = { Text("下移") },
                                            leadingIcon = { SnotesIcon(SnotesSymbol.ArrowDown, size = 16.dp) },
                                            enabled = index < groups.lastIndex,
                                            onClick = {
                                                groupMenu = false
                                                scope.launch { model.moveGroup(group.id, 1) }
                                            },
                                        )
                                        HorizontalDivider(color = colors.divider)
                                        DropdownMenuItem(
                                            text = { Text("删除分组", color = colors.danger) },
                                            leadingIcon = { SnotesIcon(SnotesSymbol.Trash, size = 16.dp, tint = colors.danger) },
                                            onClick = {
                                                groupMenu = false
                                                deletingGroup = group
                                            },
                                        )
                                    }
                                }
                            }
                        }
                    }
                }

                item(key = "footer-tools-and-sync") {
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .padding(top = 12.dp),
                    ) {
                        HorizontalDivider(
                            Modifier.padding(horizontal = 4.dp, vertical = 8.dp),
                            color = colors.borderLight,
                            thickness = 0.75.dp,
                        )
                        DrawerNavRow(
                            label = "回收站",
                            icon = SnotesSymbol.Trash,
                            selected = section == "trash",
                            onClick = { navigate("trash") },
                        )
                        Spacer(Modifier.height(2.dp))
                        DrawerNavRow(
                            label = "统计",
                            icon = SnotesSymbol.Chart,
                            selected = section == "stats",
                            onClick = { navigate("stats") },
                        )
                        Spacer(Modifier.height(2.dp))
                        DrawerNavRow(
                            label = "设置",
                            icon = SnotesSymbol.Settings,
                            selected = section == "settings",
                            onClick = { navigate("settings") },
                        )
                        Spacer(Modifier.height(8.dp))
                        SyncDrawerFooterRow(
                            running = sync.running,
                            connected = sync.connected,
                            failureCount = failures.size,
                            onClick = {
                                scope.launch { drawer.close() }
                                onConnect()
                            },
                        )
                    }
                }
            }
        }

        if (wide) {
            PermanentNavigationDrawer(
                drawerContent = {
                    Row(Modifier.width(240.dp).fillMaxHeight()) {
                        PermanentDrawerSheet(
                            Modifier.weight(1f),
                            drawerShape = RectangleShape,
                            drawerContainerColor = colors.bgRail,
                            content = menu,
                        )
                        VerticalDivider(color = colors.borderDefault, thickness = 0.75.dp)
                    }
                },
            ) { content(null, false) }
        } else {
            ModalNavigationDrawer(
                drawerState = drawer,
                gesturesEnabled = true,
                drawerContent = {
                    ModalDrawerSheet(
                        drawerState = drawer,
                        drawerShape = RectangleShape,
                        modifier = Modifier.width(minOf(276.dp, maxWidth - 48.dp)),
                        drawerContainerColor = colors.bgRail,
                        content = menu,
                    )
                },
            ) {
                content(
                    {
                        focus.clearFocus()
                        keyboard?.hide()
                        scope.launch { drawer.open() }
                    },
                    drawer.isOpen,
                )
            }
        }
    }

    if (groupDialogText != null) {
        val isRename = editingGroupId != null
        AlertDialog(
            onDismissRequest = { if (!savingGroup) { groupDialogText = null; editingGroupId = null } },
            containerColor = colors.bgSurface,
            shape = RoundedCornerShape(18.dp),
            title = { Text(if (isRename) "重命名分组" else "新建分组", style = MaterialTheme.typography.titleLarge) },
            text = {
                OutlinedTextField(
                    value = groupDialogText.orEmpty(),
                    onValueChange = { groupDialogText = it.take(100) },
                    label = { Text("分组名称") },
                    singleLine = true,
                    enabled = !savingGroup,
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.fillMaxWidth(),
                )
            },
            confirmButton = {
                Button(
                    enabled = !savingGroup && groupDialogText?.isNotBlank() == true,
                    shape = RoundedCornerShape(10.dp),
                    onClick = {
                        val name = groupDialogText.orEmpty()
                        val targetId = editingGroupId
                        savingGroup = true
                        scope.launch {
                            try {
                                if (targetId != null) {
                                    if (model.renameGroup(targetId, name)) {
                                        groupDialogText = null
                                        editingGroupId = null
                                    }
                                } else {
                                    model.createGroup(name)?.let {
                                        groupDialogText = null
                                        editingGroupId = null
                                        navigate("group:$it")
                                    }
                                }
                            } finally {
                                savingGroup = false
                            }
                        }
                    },
                ) { Text(if (isRename) "保存" else "创建分组") }
            },
            dismissButton = {
                TextButton(
                    enabled = !savingGroup,
                    onClick = { groupDialogText = null; editingGroupId = null },
                ) { Text("取消") }
            },
        )
    }

    deletingGroup?.let { group ->
        AlertDialog(
            onDismissRequest = { deletingGroup = null },
            containerColor = colors.bgSurface,
            shape = RoundedCornerShape(18.dp),
            title = { Text("删除分组「${group.name}」？", style = MaterialTheme.typography.titleLarge) },
            text = { Text("组内笔记会回到未分组，不会被删除。", style = MaterialTheme.typography.bodyMedium, color = colors.textSecondary) },
            confirmButton = {
                Button(
                    onClick = {
                        val id = group.id
                        deletingGroup = null
                        scope.launch {
                            if (model.deleteGroup(id) && section == "group:$id") {
                                onNavigate("all")
                            }
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = colors.danger),
                    shape = RoundedCornerShape(10.dp),
                ) { Text("删除") }
            },
            dismissButton = {
                TextButton(onClick = { deletingGroup = null }) { Text("取消") }
            },
        )
    }
}

@Composable
private fun DrawerSectionLabel(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp, fontWeight = FontWeight.Medium),
        color = MaterialTheme.snotesColors.textTertiary,
        modifier = Modifier.padding(start = 12.dp, top = 10.dp, bottom = 4.dp),
    )
}

@Composable
private fun DrawerNavRow(
    label: String,
    icon: SnotesSymbol,
    selected: Boolean,
    count: Int? = null,
    onClick: () -> Unit,
) {
    val colors = MaterialTheme.snotesColors
    val contentColor = if (selected) colors.selectedText else colors.textPrimary
    val iconColor = if (selected) colors.selectedText else colors.textSecondary
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 40.dp)
            .clip(RoundedCornerShape(6.dp))
            .background(if (selected) colors.accentSoft else Color.Transparent)
            .clickable(role = Role.Tab, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SnotesIcon(icon, size = 18.dp, tint = iconColor)
        Spacer(Modifier.width(10.dp))
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium.copy(
                fontSize = 14.sp,
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
            ),
            color = contentColor,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        if (count != null && count > 0) {
            Text(
                text = "$count",
                style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                color = if (selected) colors.selectedText.copy(alpha = 0.8f) else colors.textTertiary,
            )
        }
    }
}

/**
 * Single-line borderless sync status row matching Web's `.sync-idle` in `GroupSidebar.vue`.
 */
@Composable
private fun SyncDrawerFooterRow(
    running: Boolean,
    connected: Boolean,
    failureCount: Int,
    onClick: () -> Unit,
) {
    val colors = MaterialTheme.snotesColors
    val hasFailed = failureCount > 0
    val label = when {
        running -> "正在同步"
        hasFailed -> "同步待重试"
        connected -> "自动同步"
        else -> "未连接"
    }
    val tint = when {
        running -> colors.accent
        hasFailed -> colors.danger
        connected -> colors.textSecondary
        else -> colors.textTertiary
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 38.dp)
            .clip(RoundedCornerShape(6.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (running) {
            CircularProgressIndicator(
                modifier = Modifier.size(16.dp),
                strokeWidth = 2.dp,
                color = colors.accent,
                trackColor = colors.accent.copy(alpha = 0.22f),
            )
        } else {
            SnotesIcon(SnotesSymbol.Cloud, size = 16.dp, tint = tint)
        }
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
            color = tint,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (hasFailed) {
            Surface(
                shape = CircleShape,
                color = colors.dangerBg,
            ) {
                Text(
                    text = "$failureCount",
                    style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
                    color = colors.danger,
                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 1.dp),
                )
            }
        }
    }
}
