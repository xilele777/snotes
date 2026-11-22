package io.github.xilele777.snotes.feature.notes

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.github.xilele777.snotes.core.model.*
import io.github.xilele777.snotes.core.ui.*
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.ceil
import kotlin.math.max

private fun formatNum(value: Long): String = NumberFormat.getNumberInstance(Locale.CHINA).format(value)
private fun formatNum(value: Int): String = formatNum(value.toLong())

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StatsScreen(
    onDrawer: (() -> Unit)?,
    onOpenNote: (String) -> Unit = {},
    model: DataToolsModel = viewModel(),
) {
    val colors = MaterialTheme.snotesColors
    val snapshot by model.snapshot.collectAsStateWithLifecycle()
    val layoutDirection = LocalLayoutDirection.current
    var periodDays by rememberSaveable { mutableIntStateOf(30) }
    var selectedBucketIndex by remember(periodDays) { mutableStateOf<Int?>(null) }
    var selectedHeatCell by remember { mutableStateOf<HeatCell?>(null) }

    LaunchedEffect(Unit) { model.stats() }

    Scaffold(
        containerColor = colors.bgList,
        contentWindowInsets = WindowInsets.safeDrawing,
        topBar = {
            SnotesTopBar(
                title = "统计",
                navigationIcon = if (onDrawer != null) SnotesSymbol.Menu else null,
                navigationDescription = "打开侧栏",
                onNavigationClick = onDrawer,
                containerColor = colors.bgList,
                showBottomDivider = true,
            )
        },
    ) { insets ->
        val stats = snapshot
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
            if (stats == null) {
                Box(
                    Modifier
                        .fillMaxSize()
                        .padding(insets),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("正在统计…", style = MaterialTheme.typography.bodyMedium, color = colors.textTertiary)
                }
            } else {
                val buckets = remember(stats.activeNotes, periodDays) { buildActivity(stats.activeNotes, periodDays) }
                val periodCreated = remember(buckets) { buckets.sumOf { it.created } }
                val periodUpdated = remember(buckets) { buckets.sumOf { it.updated } }
                val rangeLabel = when (periodDays) {
                    7 -> "近 7 天"
                    30 -> "近 30 天"
                    90 -> "近 90 天"
                    else -> "近一年"
                }

                LazyColumn(
                    Modifier
                        .widthIn(max = 820.dp)
                        .fillMaxSize()
                        .consumeWindowInsets(insets),
                    contentPadding = PaddingValues(
                        start = 16.dp + insets.calculateStartPadding(layoutDirection),
                        end = 16.dp + insets.calculateEndPadding(layoutDirection),
                        top = insets.calculateTopPadding() + 14.dp,
                        bottom = insets.calculateBottomPadding() + 32.dp,
                    ),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    item(key = "kpi-grid") {
                        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                StatKpiCard(
                                    label = "笔记总数",
                                    value = formatNum(stats.active),
                                    unit = "篇",
                                    sub = "星标 ${formatNum(stats.starred)} · 置顶 ${formatNum(stats.topped)}",
                                    highlight = true,
                                    modifier = Modifier.weight(1f),
                                )
                                StatKpiCard(
                                    label = "已下载正文总字数",
                                    value = formatNum(stats.totalWords),
                                    unit = "",
                                    sub = "平均 ${formatNum(stats.avgWords)} 字 / 篇",
                                    modifier = Modifier.weight(1f),
                                )
                            }
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                StatKpiCard(
                                    label = "${rangeLabel}创建",
                                    value = formatNum(periodCreated),
                                    unit = "篇",
                                    modifier = Modifier.weight(1f),
                                )
                                StatKpiCard(
                                    label = "${rangeLabel}更新",
                                    value = formatNum(periodUpdated),
                                    unit = "篇",
                                    modifier = Modifier.weight(1f),
                                )
                            }
                        }
                    }

                    item(key = "secondary-strip") {
                        SnotesCard(Modifier.fillMaxWidth()) {
                            Row(
                                Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 14.dp, horizontal = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                CompactStatColumn("连续更新", "${stats.streakCurrent} 天", Modifier.weight(1f))
                                VerticalDivider(Modifier.height(26.dp), color = colors.divider)
                                CompactStatColumn("累计打开", formatNum(stats.totalOpens), Modifier.weight(1f))
                                VerticalDivider(Modifier.height(26.dp), color = colors.divider)
                                CompactStatColumn("笔记本", formatNum(stats.books), Modifier.weight(1f))
                                VerticalDivider(Modifier.height(26.dp), color = colors.divider)
                                CompactStatColumn("回收站", formatNum(stats.trashed), Modifier.weight(1f))
                            }
                        }
                    }

                    item(key = "activity-chart") {
                        SnotesCard(Modifier.fillMaxWidth()) {
                            Column(
                                Modifier.fillMaxWidth().padding(16.dp),
                                verticalArrangement = Arrangement.spacedBy(12.dp),
                            ) {
                                Row(
                                    Modifier.fillMaxWidth(),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                ) {
                                    Text("创建与最后更新分布", style = MaterialTheme.typography.titleMedium, color = colors.textPrimary)
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                                    ) {
                                        LegendDot(colors.accent, "创建")
                                        LegendDot(colors.success, "更新")
                                    }
                                }
                                SnotesSegmentedControl(
                                    items = listOf(7 to "近 7 天", 30 to "近 30 天", 90 to "近 90 天", 365 to "近一年"),
                                    selected = periodDays,
                                    onSelect = { periodDays = it },
                                    modifier = Modifier.fillMaxWidth(),
                                )
                                ActivityBarChart(
                                    buckets = buckets,
                                    selectedIndex = selectedBucketIndex,
                                    onSelect = { selectedBucketIndex = it },
                                )
                                AnimatedContent(
                                    targetState = selectedBucketIndex?.let { buckets.getOrNull(it) },
                                    transitionSpec = { fadeIn(tween(120)) togetherWith fadeOut(tween(120)) },
                                    label = "chart-tip",
                                ) { picked ->
                                    if (picked != null) {
                                        val rangeText = if (picked.start == picked.end) formatYmd(picked.start)
                                        else "${formatYmd(picked.start)} 至 ${formatYmd(picked.end)}"
                                        Surface(shape = RoundedCornerShape(10.dp), color = colors.bgList) {
                                            Row(
                                                Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                                                horizontalArrangement = Arrangement.SpaceBetween,
                                                verticalAlignment = Alignment.CenterVertically,
                                            ) {
                                                Text(rangeText, style = MaterialTheme.typography.labelMedium, color = colors.textPrimary)
                                                Text(
                                                    "创建 ${picked.created} 篇 · 更新 ${picked.updated} 篇",
                                                    style = MaterialTheme.typography.labelMedium,
                                                    color = colors.accent,
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    item(key = "heatmap") {
                        SnotesCard(Modifier.fillMaxWidth()) {
                            Column(
                                Modifier.fillMaxWidth().padding(16.dp),
                                verticalArrangement = Arrangement.spacedBy(12.dp),
                            ) {
                                Text("最后更新时间分布", style = MaterialTheme.typography.titleMedium, color = colors.textPrimary)
                                HeatmapGrid(
                                    weeks = stats.heatmapWeeks,
                                    heatMax = stats.heatMax,
                                    selected = selectedHeatCell,
                                    onSelect = { selectedHeatCell = it },
                                )
                                Row(
                                    Modifier.fillMaxWidth(),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                ) {
                                    Text(
                                        selectedHeatCell?.let { cell ->
                                            if (cell.count > 0) "${formatYmd(cell.date)}：更新 ${cell.count} 条"
                                            else "${formatYmd(cell.date)}：无更新"
                                        }.orEmpty(),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = colors.textPrimary,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier.weight(1f),
                                    )
                                    Spacer(Modifier.width(8.dp))
                                    HeatmapLegend()
                                }
                            }
                        }
                    }

                    item(key = "length-distribution") {
                        val maxLen = max(1, stats.lengthBuckets.maxOfOrNull { it.count } ?: 1)
                        SnotesCard(Modifier.fillMaxWidth()) {
                            Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                Text("字数分布", style = MaterialTheme.typography.titleMedium, color = colors.textPrimary)
                                stats.lengthBuckets.forEach { bucket ->
                                    ProportionBarRow(
                                        label = bucket.label,
                                        count = bucket.count,
                                        fraction = bucket.count.toFloat() / maxLen,
                                        barColor = colors.accent,
                                    )
                                }
                            }
                        }
                    }

                    if (stats.byGroup.isNotEmpty()) {
                        item(key = "group-distribution") {
                            val topGroups = stats.byGroup.take(8)
                            val maxGroup = max(1, topGroups.maxOfOrNull { it.count } ?: 1)
                            SnotesCard(Modifier.fillMaxWidth()) {
                                Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                    Text("分组分布", style = MaterialTheme.typography.titleMedium, color = colors.textPrimary)
                                    topGroups.forEach { item ->
                                        ProportionBarRow(
                                            label = item.name,
                                            count = item.count,
                                            fraction = item.count.toFloat() / maxGroup,
                                            barColor = parseHexColorOrNull(item.color) ?: colors.accent,
                                        )
                                    }
                                }
                            }
                        }
                    }

                    if (stats.mostOpened.isNotEmpty()) {
                        item(key = "most-opened") {
                            SnotesCard(Modifier.fillMaxWidth()) {
                                Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Text("最常打开", style = MaterialTheme.typography.titleMedium, color = colors.textPrimary)
                                    stats.mostOpened.forEachIndexed { idx, item ->
                                        Row(
                                            Modifier
                                                .fillMaxWidth()
                                                .clip(RoundedCornerShape(8.dp))
                                                .clickable { onOpenNote(item.id) }
                                                .padding(vertical = 8.dp, horizontal = 4.dp),
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                                        ) {
                                            Text(
                                                "${idx + 1}",
                                                style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold),
                                                color = if (idx == 0) colors.accent else colors.textTertiary,
                                                modifier = Modifier.width(18.dp),
                                            )
                                            Text(
                                                item.title,
                                                style = MaterialTheme.typography.bodyMedium,
                                                color = colors.textPrimary,
                                                maxLines = 1,
                                                overflow = TextOverflow.Ellipsis,
                                                modifier = Modifier.weight(1f),
                                            )
                                            Text(
                                                "${formatNum(item.opens)} 次",
                                                style = MaterialTheme.typography.bodySmall,
                                                color = colors.textTertiary,
                                            )
                                        }
                                        if (idx < stats.mostOpened.lastIndex) {
                                            HorizontalDivider(color = colors.divider, thickness = 0.75.dp)
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

@Composable
private fun StatKpiCard(
    label: String,
    value: String,
    unit: String,
    sub: String? = null,
    highlight: Boolean = false,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.snotesColors
    SnotesCard(
        modifier = modifier,
        containerColor = colors.bgSurface,
    ) {
        Column(
            Modifier.fillMaxWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(label, style = MaterialTheme.typography.bodySmall, color = colors.textTertiary)
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(
                    value,
                    style = MaterialTheme.typography.headlineMedium,
                    color = if (highlight) colors.accent else colors.textPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (unit.isNotBlank()) {
                    Text(
                        unit,
                        style = MaterialTheme.typography.labelMedium,
                        color = colors.textTertiary,
                        modifier = Modifier.padding(bottom = 4.dp),
                    )
                }
            }
            if (!sub.isNullOrBlank()) {
                Text(
                    sub,
                    style = MaterialTheme.typography.labelSmall,
                    color = colors.textSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun CompactStatColumn(label: String, value: String, modifier: Modifier = Modifier) {
    val colors = MaterialTheme.snotesColors
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Text(
            value,
            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
            color = colors.textPrimary,
            maxLines = 1,
        )
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = colors.textTertiary,
            maxLines = 1,
        )
    }
}

@Composable
private fun LegendDot(color: Color, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(color))
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.snotesColors.textSecondary)
    }
}

@Composable
private fun ActivityBarChart(
    buckets: List<ActivityBucket>,
    selectedIndex: Int?,
    onSelect: (Int?) -> Unit,
) {
    val colors = MaterialTheme.snotesColors
    val maxVal = remember(buckets) { max(2, buckets.maxOfOrNull { max(it.created, it.updated) } ?: 2) }
    val ceiling = remember(maxVal) { ceil(maxVal / 2.0).toInt() * 2 }

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.fillMaxWidth().height(156.dp), verticalAlignment = Alignment.Bottom) {
            Column(
                Modifier.fillMaxHeight().width(24.dp).padding(bottom = 2.dp),
                verticalArrangement = Arrangement.SpaceBetween,
                horizontalAlignment = Alignment.End,
            ) {
                Text("$ceiling", style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp), color = colors.textTertiary)
                Text("${ceiling / 2}", style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp), color = colors.textTertiary)
                Text("0", style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp), color = colors.textTertiary)
            }
            Spacer(Modifier.width(8.dp))
            Canvas(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .pointerInput(buckets) {
                        detectTapGestures { offset ->
                            if (buckets.isEmpty()) return@detectTapGestures
                            val slotWidth = size.width.toFloat() / buckets.size
                            val idx = (offset.x / slotWidth).toInt().coerceIn(0, buckets.lastIndex)
                            onSelect(if (selectedIndex == idx) null else idx)
                        }
                    },
            ) {
                val h = size.height
                val w = size.width
                val gridColor = colors.divider
                listOf(0f, h / 2f, h).forEach { y ->
                    drawLine(gridColor, Offset(0f, y), Offset(w, y), strokeWidth = 1.dp.toPx())
                }
                if (buckets.isEmpty()) return@Canvas
                val slotWidth = w / buckets.size
                val barW = (slotWidth * 0.34f).coerceIn(2.dp.toPx(), 12.dp.toPx())
                val gap = 1.5.dp.toPx()
                val radius = CornerRadius(2.5.dp.toPx(), 2.5.dp.toPx())

                buckets.forEachIndexed { idx, bucket ->
                    val cx = slotWidth * (idx + 0.5f)
                    if (selectedIndex == idx) {
                        drawRoundRect(
                            color = colors.accentSoft.copy(alpha = 0.7f),
                            topLeft = Offset(slotWidth * idx, 0f),
                            size = Size(slotWidth, h),
                            cornerRadius = CornerRadius(6.dp.toPx(), 6.dp.toPx()),
                        )
                    }
                    if (bucket.created > 0) {
                        val barH = (bucket.created.toFloat() / ceiling) * (h - 6.dp.toPx())
                        drawRoundRect(
                            color = colors.accent,
                            topLeft = Offset(cx - barW - gap / 2f, h - barH),
                            size = Size(barW, barH),
                            cornerRadius = radius,
                        )
                    }
                    if (bucket.updated > 0) {
                        val barH = (bucket.updated.toFloat() / ceiling) * (h - 6.dp.toPx())
                        drawRoundRect(
                            color = colors.success,
                            topLeft = Offset(cx + gap / 2f, h - barH),
                            size = Size(barW, barH),
                            cornerRadius = radius,
                        )
                    }
                }
            }
        }
        if (buckets.isNotEmpty()) {
            val first = buckets.first().start
            val mid = buckets[buckets.size / 2].start
            val last = buckets.last().end
            Row(
                Modifier.fillMaxWidth().padding(start = 32.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text("${first.monthValue}/${first.dayOfMonth}", style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp), color = colors.textTertiary)
                if (buckets.size > 2) {
                    Text("${mid.monthValue}/${mid.dayOfMonth}", style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp), color = colors.textTertiary)
                }
                Text("${last.monthValue}/${last.dayOfMonth}", style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp), color = colors.textTertiary)
            }
        }
    }
}

@Composable
private fun heatColorFor(level: Int): Color {
    val colors = MaterialTheme.snotesColors
    return when (level) {
        0 -> if (colors.isDark) Color(0xFF282B36) else Color(0xFFECEEF3)
        1 -> colors.accent.copy(alpha = if (colors.isDark) 0.30f else 0.22f)
        2 -> colors.accent.copy(alpha = if (colors.isDark) 0.52f else 0.45f)
        3 -> colors.accent.copy(alpha = if (colors.isDark) 0.76f else 0.72f)
        else -> colors.accent
    }
}

private fun heatLevel(count: Int, max: Int): Int {
    if (count <= 0) return 0
    return ceil((count.toDouble() / max.coerceAtLeast(1)) * 4.0).toInt().coerceIn(1, 4)
}

@Composable
private fun HeatmapGrid(
    weeks: List<HeatWeek>,
    heatMax: Int,
    selected: HeatCell?,
    onSelect: (HeatCell?) -> Unit,
) {
    val colors = MaterialTheme.snotesColors
    val scroll = rememberScrollState()
    LaunchedEffect(weeks) { scroll.scrollTo(scroll.maxValue) }
    val cellSize = 12.dp
    val cellGap = 3.dp

    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        Column(
            Modifier.padding(top = 18.dp, end = 6.dp),
            verticalArrangement = Arrangement.spacedBy(cellGap),
        ) {
            listOf("一", "", "三", "", "五", "", "日").forEach { label ->
                Box(Modifier.height(cellSize), contentAlignment = Alignment.CenterEnd) {
                    if (label.isNotEmpty()) {
                        Text(label, style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.5.sp), color = colors.textTertiary)
                    }
                }
            }
        }
        Column(Modifier.weight(1f).horizontalScroll(scroll)) {
            Row(horizontalArrangement = Arrangement.spacedBy(cellGap)) {
                weeks.forEachIndexed { idx, week ->
                    val month = week.weekStart.monthValue
                    val showMonth = idx == 0 || month != weeks[idx - 1].weekStart.monthValue
                    Box(Modifier.width(cellSize).height(15.dp), contentAlignment = Alignment.CenterStart) {
                        if (showMonth) {
                            Text(
                                "${month}月",
                                style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.5.sp),
                                color = colors.textTertiary,
                                softWrap = false,
                                maxLines = 1,
                                overflow = TextOverflow.Visible,
                            )
                        }
                    }
                }
            }
            Spacer(Modifier.height(3.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(cellGap)) {
                weeks.forEach { week ->
                    Column(verticalArrangement = Arrangement.spacedBy(cellGap)) {
                        week.days.forEach { cell ->
                            val isSelected = selected?.date == cell.date
                            Box(
                                Modifier
                                    .size(cellSize)
                                    .clip(RoundedCornerShape(3.dp))
                                    .background(heatColorFor(heatLevel(cell.count, heatMax)))
                                    .clickable { onSelect(if (isSelected) null else cell) },
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun HeatmapLegend() {
    val colors = MaterialTheme.snotesColors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        Text("少", style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp), color = colors.textTertiary)
        (0..4).forEach { level ->
            Box(Modifier.size(10.dp).clip(RoundedCornerShape(2.5.dp)).background(heatColorFor(level)))
        }
        Text("多", style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp), color = colors.textTertiary)
    }
}

@Composable
private fun ProportionBarRow(
    label: String,
    count: Int,
    fraction: Float,
    barColor: Color,
) {
    val colors = MaterialTheme.snotesColors
    val clamped = fraction.coerceIn(0f, 1f)
    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(label, style = MaterialTheme.typography.bodyMedium, color = colors.textPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            Text("${formatNum(count)} 篇", style = MaterialTheme.typography.bodySmall, color = colors.textTertiary)
        }
        Box(
            Modifier
                .fillMaxWidth()
                .height(6.dp)
                .clip(CircleShape)
                .background(colors.bgHover),
        ) {
            if (count > 0) {
                Box(
                    Modifier
                        .fillMaxWidth(clamped.coerceAtLeast(0.03f))
                        .fillMaxHeight()
                        .clip(CircleShape)
                        .background(barColor),
                )
            }
        }
    }
}
