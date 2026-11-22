package io.github.xilele777.snotes.feature.notes

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.xilele777.snotes.BuildConfig
import io.github.xilele777.snotes.R
import io.github.xilele777.snotes.core.data.Appearance
import io.github.xilele777.snotes.core.ui.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    model: NotesViewModel,
    appearance: Appearance,
    onRecovery: (String) -> Unit,
    onConnect: () -> Unit,
    onPrototype: () -> Unit = {},
    onDrawer: (() -> Unit)? = null,
    extras: @Composable ColumnScope.() -> Unit = {},
) {
    val colors = MaterialTheme.snotesColors
    val sync by model.syncStatus.collectAsStateWithLifecycle()
    val pending by model.pending.collectAsStateWithLifecycle()
    val failures by model.syncFailures.collectAsStateWithLifecycle()
    val issues by model.issues.collectAsStateWithLifecycle()
    val connectedOrigin by model.connectedOrigin.collectAsStateWithLifecycle()
    val look by appearance.state.collectAsStateWithLifecycle()
    var profiles by remember { mutableStateOf(emptyList<String>()) }
    var switching by remember { mutableStateOf(false) }
    var page by rememberSaveable { mutableStateOf("appearance") }
    val scope = rememberCoroutineScope()
    val layoutDirection = LocalLayoutDirection.current
    LaunchedEffect(Unit) { profiles = withContext(Dispatchers.IO) { model.profiles() } }

    Scaffold(
        containerColor = colors.bgList,
        contentWindowInsets = WindowInsets.safeDrawing,
        topBar = {
            Column(Modifier.background(colors.bgList)) {
                SnotesTopBar(
                    title = "设置",
                    navigationIcon = if (onDrawer != null) SnotesSymbol.Menu else null,
                    navigationDescription = "打开侧栏",
                    onNavigationClick = onDrawer,
                    containerColor = colors.bgList,
                    showBottomDivider = false,
                )
                Box(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp)
                        .padding(bottom = 10.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    SnotesSegmentedControl(
                        items = listOf("appearance" to "外观", "data" to "数据", "about" to "关于"),
                        selected = page,
                        onSelect = { page = it },
                        modifier = Modifier.widthIn(max = 460.dp).fillMaxWidth(),
                    )
                }
                HorizontalDivider(color = colors.borderLight, thickness = 0.75.dp)
            }
        },
    ) { insets ->
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
            LazyColumn(
                Modifier
                    .widthIn(max = 760.dp)
                    .fillMaxSize()
                    .consumeWindowInsets(insets)
                    .testTag("settings-list"),
                contentPadding = PaddingValues(
                    start = 16.dp + insets.calculateStartPadding(layoutDirection),
                    end = 16.dp + insets.calculateEndPadding(layoutDirection),
                    top = insets.calculateTopPadding() + 8.dp,
                    bottom = insets.calculateBottomPadding() + 32.dp,
                ),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (page == "appearance") {
                    item(key = "section-interface") { SectionLabel("界面与列表") }
                    item(key = "card-interface") {
                        SnotesCard(Modifier.fillMaxWidth()) {
                            Column(Modifier.fillMaxWidth()) {
                                Column(
                                    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp),
                                    verticalArrangement = Arrangement.spacedBy(10.dp),
                                ) {
                                    Text(
                                        "主题",
                                        style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium),
                                        color = colors.textPrimary,
                                    )
                                    SnotesSegmentedControl(
                                        items = listOf("system" to "跟随系统", "light" to "浅色", "dark" to "深色"),
                                        selected = look.theme,
                                        onSelect = { appearance.set(theme = it) },
                                        modifier = Modifier.fillMaxWidth(),
                                    )
                                }
                                HorizontalDivider(Modifier.padding(horizontal = 16.dp), color = colors.divider, thickness = 0.75.dp)
                                Column(
                                    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp),
                                    verticalArrangement = Arrangement.spacedBy(10.dp),
                                ) {
                                    Text(
                                        "笔记列表密度",
                                        style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium),
                                        color = colors.textPrimary,
                                    )
                                    SnotesSegmentedControl(
                                        items = listOf("comfortable" to "舒适", "compact" to "紧凑"),
                                        selected = look.noteDensity,
                                        onSelect = { appearance.set(noteDensity = it) },
                                        modifier = Modifier.fillMaxWidth(),
                                    )
                                }
                                HorizontalDivider(Modifier.padding(horizontal = 16.dp), color = colors.divider, thickness = 0.75.dp)
                                SettingsSwitchRow(
                                    title = "显示笔记摘要",
                                    checked = look.showNotePreview,
                                    onCheckedChange = { appearance.set(showNotePreview = it) },
                                )
                            }
                        }
                    }

                    item(key = "section-reading") { SectionLabel("编辑与阅读") }
                    item(key = "card-reading") {
                        val fontPreset = when {
                            look.fontSize <= 14 -> 14
                            look.fontSize >= 18 -> 18
                            else -> 16
                        }
                        SnotesCard(Modifier.fillMaxWidth()) {
                            Column(Modifier.fillMaxWidth()) {
                                Column(
                                    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp),
                                    verticalArrangement = Arrangement.spacedBy(10.dp),
                                ) {
                                    Text(
                                        "正文字号",
                                        style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium),
                                        color = colors.textPrimary,
                                    )
                                    SnotesSegmentedControl(
                                        items = listOf(14 to "小", 16 to "标准", 18 to "大"),
                                        selected = fontPreset,
                                        onSelect = { appearance.set(font = it) },
                                        modifier = Modifier.fillMaxWidth(),
                                    )
                                }
                                HorizontalDivider(Modifier.padding(horizontal = 16.dp), color = colors.divider, thickness = 0.75.dp)
                                Column(
                                    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp),
                                    verticalArrangement = Arrangement.spacedBy(10.dp),
                                ) {
                                    Text(
                                        "正文行距",
                                        style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium),
                                        color = colors.textPrimary,
                                    )
                                    SnotesSegmentedControl(
                                        items = listOf("compact" to "紧凑", "standard" to "标准", "relaxed" to "宽松"),
                                        selected = look.lineSpacing,
                                        onSelect = { appearance.set(lineSpacing = it) },
                                        modifier = Modifier.fillMaxWidth(),
                                    )
                                }
                            }
                        }
                    }
                }

                if (page == "data") {
                    item(key = "section-sync") { SectionLabel("连接与同步") }
                    item(key = "card-sync") {
                        val statusColor = when {
                            failures.isNotEmpty() -> colors.danger
                            sync.running -> colors.accent
                            sync.connected -> colors.success
                            else -> colors.textDisabled
                        }
                        val statusText = when {
                            sync.running -> "同步中"
                            failures.isNotEmpty() -> "${failures.size} 项失败"
                            sync.connected && pending > 0 -> "$pending 项待同步"
                            sync.connected -> "已连接"
                            else -> "未连接"
                        }
                        val hostDisplay = connectedOrigin?.removePrefix("https://")?.removePrefix("http://")?.trimEnd('/')
                        SnotesCard(Modifier.fillMaxWidth()) {
                            Column(
                                Modifier.fillMaxWidth().padding(16.dp),
                                verticalArrangement = Arrangement.spacedBy(12.dp),
                            ) {
                                Row(
                                    Modifier.fillMaxWidth(),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                                ) {
                                    SnotesIcon(SnotesSymbol.Cloud, size = 20.dp, tint = colors.textSecondary)
                                    Text(
                                        hostDisplay ?: "未连接服务端",
                                        style = MaterialTheme.typography.titleMedium,
                                        color = colors.textPrimary,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier.weight(1f),
                                    )
                                    Surface(
                                        shape = RoundedCornerShape(16.dp),
                                        color = statusColor.copy(alpha = 0.12f),
                                    ) {
                                        Row(
                                            Modifier.padding(horizontal = 9.dp, vertical = 4.dp),
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.spacedBy(5.dp),
                                        ) {
                                            Box(Modifier.size(6.dp).clip(CircleShape).background(statusColor))
                                            Text(
                                                statusText,
                                                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
                                                color = statusColor,
                                            )
                                        }
                                    }
                                }

                                Row(
                                    Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                                ) {
                                    if (sync.connected) {
                                        FilledTonalButton(
                                            onClick = model::synchronize,
                                            enabled = !sync.running && !switching,
                                            shape = RoundedCornerShape(10.dp),
                                            modifier = Modifier.weight(1f).height(40.dp),
                                        ) {
                                            SnotesIcon(SnotesSymbol.Sync, size = 15.dp)
                                            Spacer(Modifier.width(6.dp))
                                            Text(if (sync.running) "同步中…" else "立即同步")
                                        }
                                        OutlinedButton(
                                            onClick = onConnect,
                                            enabled = !switching,
                                            shape = RoundedCornerShape(10.dp),
                                            border = BorderStroke(1.dp, colors.borderDefault),
                                            modifier = Modifier.weight(1f).height(40.dp),
                                        ) { Text("更改连接") }
                                    } else {
                                        Button(
                                            onClick = onConnect,
                                            enabled = !switching,
                                            shape = RoundedCornerShape(10.dp),
                                            modifier = Modifier.fillMaxWidth().height(40.dp),
                                        ) {
                                            SnotesIcon(SnotesSymbol.Cloud, size = 16.dp)
                                            Spacer(Modifier.width(6.dp))
                                            Text("连接服务端")
                                        }
                                    }
                                }
                            }
                        }
                    }

                    item(key = "section-backup") { SectionLabel("数据与备份") }
                    item(key = "card-backup") {
                        SnotesCard(Modifier.fillMaxWidth()) {
                            Column(content = extras)
                        }
                    }

                    if (issues.isNotEmpty() || failures.isNotEmpty()) {
                        item(key = "section-recovery") { SectionLabel("异常恢复") }
                        item(key = "card-recovery") {
                            SnotesCard(Modifier.fillMaxWidth()) {
                                if (issues.isNotEmpty()) {
                                    SettingsRow(
                                        symbol = SnotesSymbol.Restore,
                                        title = "恢复草稿 (${issues.size})",
                                        tint = colors.danger,
                                        onClick = { onRecovery("drafts") },
                                    )
                                }
                                if (issues.isNotEmpty() && failures.isNotEmpty()) {
                                    HorizontalDivider(Modifier.padding(horizontal = 16.dp), color = colors.divider, thickness = 0.75.dp)
                                }
                                if (failures.isNotEmpty()) {
                                    SettingsRow(
                                        symbol = SnotesSymbol.Alert,
                                        title = "同步失败项 (${failures.size})",
                                        tint = colors.danger,
                                        onClick = { onRecovery("failures") },
                                    )
                                }
                            }
                        }
                    }

                    if (profiles.size > 1) {
                        item(key = "section-profiles") { SectionLabel("数据空间") }
                        item(key = "card-profiles") {
                            SnotesCard(Modifier.fillMaxWidth()) {
                                profiles.forEachIndexed { idx, id ->
                                    SettingsRow(
                                        symbol = SnotesSymbol.Folder,
                                        title = if (id == "local-default") "初始本机空间" else "空间 ${id.take(8)}",
                                        enabled = !switching && !sync.running,
                                    ) {
                                        switching = true
                                        scope.launch { try { model.switchProfile(id) } finally { switching = false } }
                                    }
                                    if (idx < profiles.lastIndex) {
                                        HorizontalDivider(Modifier.padding(horizontal = 16.dp), color = colors.divider, thickness = 0.75.dp)
                                    }
                                }
                            }
                        }
                    }
                }

                if (page == "about") {
                    item(key = "card-about") {
                        Spacer(Modifier.height(6.dp))
                        SnotesCard(Modifier.fillMaxWidth()) {
                            Column(
                                Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 32.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(12.dp),
                            ) {
                                Image(
                                    painter = painterResource(R.drawable.ic_notes),
                                    contentDescription = null,
                                    modifier = Modifier.size(56.dp),
                                )
                                SnotesBrandWordmark(
                                    tint = colors.textPrimary,
                                    width = 104.dp,
                                    height = 29.dp,
                                )
                                Surface(shape = RoundedCornerShape(16.dp), color = colors.bgList) {
                                    Text(
                                        "版本 ${BuildConfig.VERSION_NAME}",
                                        style = MaterialTheme.typography.labelMedium,
                                        color = colors.textSecondary,
                                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
                                    )
                                }
                                if (BuildConfig.DEBUG) {
                                    Spacer(Modifier.height(4.dp))
                                    OutlinedButton(
                                        onClick = onPrototype,
                                        shape = RoundedCornerShape(10.dp),
                                    ) { Text("离线编辑器原型") }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
