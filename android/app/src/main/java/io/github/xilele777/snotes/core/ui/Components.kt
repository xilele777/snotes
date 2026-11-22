package io.github.xilele777.snotes.core.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp

object SnotesMotion {
    val EaseOut: Easing = CubicBezierEasing(0.2f, 0.7f, 0.2f, 1f)
    val PageSlide: Easing = CubicBezierEasing(0.22f, 1f, 0.36f, 1f)
    const val FastMs = 120
    const val NormalMs = 180
    const val PageMs = 210
    const val SlowMs = 240
}

/** 6-color palette shared by notes and groups (matches Web src/components/palette.ts). */
val SnotesSkinColors: List<String?> = listOf(null, "#d8b46a", "#cd956a", "#cb8585", "#86a394", "#8398ba")

/**
 * Exact 24x24 stroke icons aligned with Web's `src/components/icons.ts`.
 */
enum class SnotesSymbol(val path: String, val filled: Boolean = false) {
    Menu("M4 6h16 M4 12h16 M4 18h16"),
    Close("M6 6l12 12 M6 18L18 6"),
    Home("m3 10 9-7 9 7 M5 9v12h5v-7h4v7h5V9"),
    EyeOff("M3 3l18 18 M10.6 5.2A9.6 9.6 0 0 1 12 5c6.4 0 10 7 10 7a17.5 17.5 0 0 1-3.1 4 M6.6 6.7A17.3 17.3 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 4.1-.9 M9.9 9.9a3 3 0 0 0 4.2 4.2"),
    Sort("M4 6h16 M4 12h11 M4 18h6"),
    Chart("M4 3v17h17 M8 15v-4 M13 15V6 M18 15v-7"),
    Note("M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z M14 3v6h6 M8 13h8 M8 17h5"),
    Notes("M8 3H5a2 2 0 0 0-2 2v11 M10 7h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z M12 12h5 M12 16h5"),
    Search("M21 21l-4.5-4.5 M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0"),
    Books("M5 3h14a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z M7 3v18 M11 7h5 M11 11h3"),
    Settings("M19.11 9.05L21.88 10.44L21.88 13.56L19.11 14.95L20.09 17.88L17.88 20.09L14.95 19.11L13.56 21.88L10.44 21.88L9.05 19.11L6.12 20.09L3.91 17.88L4.89 14.95L2.12 13.56L2.12 10.44L4.89 9.05L3.91 6.12L6.12 3.91L9.05 4.89L10.44 2.12L13.56 2.12L14.95 4.89L17.88 3.91L20.09 6.12Z M15.2 12a3.2 3.2 0 1 1-6.4 0a3.2 3.2 0 0 1 6.4 0"),
    Plus("M12 5v14 M5 12h14"),
    More("M5 12h.01 M12 12h.01 M19 12h.01"),
    Back("m14 6-6 6 6 6"),
    Chevron("m9 5 7 7-7 7"),
    Down("M6 9L12 15L18 9"),
    Sync("M20 7v5h-5 M4 17v-5h5 M6.1 6.1A8 8 0 0 1 20 12 M4 12a8 8 0 0 0 13.9 5.9"),
    Check("m5 12 4 4L19 6"),
    Cloud("M17.5 19a4.5 4.5 0 1 0 0-9 6 6 0 0 0-11.7 1.5A4 4 0 0 0 6 19h11.5Z"),
    Star("m12 3 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.6l6.2-.9Z"),
    StarFilled("m12 3 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.6l6.2-.9Z", filled = true),
    Pin("m16 3 5 5-4 2-3 5-2 1-4-4 1-2 5-3Z m8 16-5 5"),
    Folder("M3 7V5a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"),
    Trash("M3 6h18 M9 6V4h6v2 M5 6l1 14h12l1-14 M10 10v6 M14 10v6"),
    Restore("M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 7v5l3 2"),
    Image("M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z M3 16l5-5 4 4 3-3 6 6 M15.5 9.5h.01"),
    Share("M12 15V4 m7 8-5-5-5 5 M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"),
    Edit("M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3Z m13.5-13.5 3 3"),
    Eye("M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"),
    Alert("M12 3.5L21.2 19.5H2.8Z M12 9.5V13.8 M12 16.8H12.01"),
    Download("M12 3v12 m-5-4 5 5 5-5 M4 20h16"),
    Upload("M12 16V4 m-5 5 5-5 5 5 M4 20h16"),
    Flame("M12 2.5C15.5 6.2 18 9.2 18 13.2A6 6 0 1 1 6 13.2C6 10.5 7.4 8.5 8.8 7C8.8 9.2 10 10.2 11.2 10.2C10.5 7.8 11.2 5 12 2.5Z"),
    Server("M4 5A1 1 0 0 1 5 4H19A1 1 0 0 1 20 5V9A1 1 0 0 1 19 10H5A1 1 0 0 1 4 9Z M4 15A1 1 0 0 1 5 14H19A1 1 0 0 1 20 15V19A1 1 0 0 1 19 20H5A1 1 0 0 1 4 19Z M7.5 7H7.51 M7.5 17H7.51"),
    Key("M15.5 7.5A4 4 0 1 1 7.5 7.5A4 4 0 1 1 15.5 7.5 M14.3 10.3L20.5 16.5 M18 14L19.8 12.2 M16 16L17.8 14.2"),
    ListPanel("M4 4h16v16H4Z M11 4v16 M6.5 8h2 M6.5 12h2 M6.5 16h2"),
    ArrowUp("M12 19V5 m-7 7 7-7 7 7"),
    ArrowDown("M12 5v14 m7-7-7 7-7-7"),
    Copy("M9 9h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"),
    Info("M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 11v5 M12 7h.01"),
}

private val vectors = SnotesSymbol.entries.associateWith { symbol ->
    ImageVector.Builder(symbol.name, 24.dp, 24.dp, 24f, 24f).apply {
        addPath(
            pathData = PathParser().parsePathString(symbol.path).toNodes(),
            fill = if (symbol.filled) SolidColor(Color.Black) else null,
            stroke = SolidColor(Color.Black),
            strokeLineWidth = 1.8f,
            strokeLineCap = StrokeCap.Round,
            strokeLineJoin = StrokeJoin.Round,
        )
    }.build()
}

/**
 * Exact SVG vector wordmark from Web's `src/components/BrandWordmark.vue` (viewBox 0 0 116 32).
 */
private val brandWordmarkVector: ImageVector by lazy {
    val pathData = listOf(
        "M16 12.5c-2-1.7-4.3-2-6.6-1.6C6.7 11.3 5 12.8 5 15c0 5.3 12 2.4 12 7.7 0 2.3-2.2 3.9-5.7 3.9-2.6 0-5-.8-6.8-2.3",
        "M25 26V11m0 6.8c0-4.2 2.5-6.8 6.3-6.8 3.7 0 5.7 2.4 5.7 6.4V26",
        "M52 11h2c4 0 6 2.2 6 6v4c0 3.8-2 6-6 6h-2c-4 0-6-2.2-6-6v-4c0-3.8 2-6 6-6Z",
        "M68 6v15.3c0 3.7 1.9 5.2 5 5.2l2-.3M64 11h10",
        "M81 18.2h12c0-4.6-2.1-7.5-5.8-7.5-3.9 0-6.3 3.1-6.3 7.9 0 5 2.5 7.9 6.8 7.9 2.1 0 4-.7 5.5-2",
        "M110 12.5c-2-1.7-4.3-2-6.6-1.6C100.7 11.3 99 12.8 99 15c0 5.3 12 2.4 12 7.7 0 2.3-2.2 3.9-5.7 3.9-2.6 0-5-.8-6.8-2.3",
    ).joinToString(" ")
    ImageVector.Builder("SnotesBrandWordmark", 116.dp, 32.dp, 116f, 32f).apply {
        addPath(
            pathData = PathParser().parsePathString(pathData).toNodes(),
            fill = null,
            stroke = SolidColor(Color.Black),
            strokeLineWidth = 3.4f,
            strokeLineCap = StrokeCap.Round,
            strokeLineJoin = StrokeJoin.Round,
        )
    }.build()
}

@Composable
fun SnotesBrandWordmark(
    modifier: Modifier = Modifier,
    tint: Color = MaterialTheme.snotesColors.textPrimary,
    width: Dp = 82.dp,
    height: Dp = 23.dp,
) {
    Icon(
        imageVector = brandWordmarkVector,
        contentDescription = "snotes",
        tint = tint,
        modifier = modifier.size(width = width, height = height),
    )
}

@Composable
fun SnotesIcon(
    symbol: SnotesSymbol,
    modifier: Modifier = Modifier,
    description: String? = null,
    tint: Color = LocalContentColor.current,
    size: Dp = 20.dp,
) {
    Icon(checkNotNull(vectors[symbol]), description, modifier.size(size), tint)
}

@Composable
fun SnotesColorSwatchRow(
    selectedColor: String?,
    onSelect: (String?) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.snotesColors
    Row(
        modifier = modifier.padding(horizontal = 12.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SnotesSkinColors.forEach { hex ->
            val isSelected = selectedColor?.lowercase() == hex?.lowercase()
            val parsed = parseHexColorOrNull(hex)
            Box(
                modifier = Modifier
                    .size(24.dp)
                    .clip(CircleShape)
                    .then(
                        if (parsed != null) Modifier.background(parsed)
                        else Modifier.background(colors.bgList),
                    )
                    .border(
                        width = if (isSelected) 2.dp else 1.dp,
                        color = if (isSelected) colors.accent else colors.borderDefault,
                        shape = CircleShape,
                    )
                    .clickable { onSelect(hex) }
                    .semantics { contentDescription = if (hex == null) "清除颜色" else "标记颜色 $hex" },
                contentAlignment = Alignment.Center,
            ) {
                if (parsed == null) {
                    Canvas(Modifier.size(14.dp)) {
                        drawLine(
                            color = colors.textTertiary,
                            start = Offset(2.dp.toPx(), size.height - 2.dp.toPx()),
                            end = Offset(size.width - 2.dp.toPx(), 2.dp.toPx()),
                            strokeWidth = 1.4.dp.toPx(),
                            cap = StrokeCap.Round,
                        )
                    }
                } else if (isSelected) {
                    SnotesIcon(SnotesSymbol.Check, size = 13.dp, tint = Color.White)
                }
            }
        }
    }
}

@Composable
fun SnotesTopBar(
    title: String,
    modifier: Modifier = Modifier,
    count: Int? = null,
    subtitle: String? = null,
    navigationIcon: SnotesSymbol? = null,
    navigationDescription: String = "",
    navigationEnabled: Boolean = true,
    onNavigationClick: (() -> Unit)? = null,
    containerColor: Color = MaterialTheme.snotesColors.bgList,
    showBottomDivider: Boolean = true,
    actions: @Composable RowScope.() -> Unit = {},
) {
    val colors = MaterialTheme.snotesColors
    Column(modifier = modifier.fillMaxWidth().background(containerColor)) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.statusBars)
                .heightIn(min = 54.dp)
                .padding(
                    start = if (navigationIcon != null && onNavigationClick != null) 6.dp else 16.dp,
                    end = 12.dp,
                ),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (navigationIcon != null && onNavigationClick != null) {
                IconButton(
                    onClick = onNavigationClick,
                    enabled = navigationEnabled,
                    modifier = Modifier.size(40.dp),
                ) {
                    SnotesIcon(
                        symbol = navigationIcon,
                        size = 20.dp,
                        description = navigationDescription,
                        tint = if (navigationEnabled) colors.textSecondary else colors.textDisabled,
                    )
                }
                Spacer(Modifier.width(4.dp))
            }
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(1.dp),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text(
                        text = title,
                        style = MaterialTheme.typography.titleLarge,
                        color = colors.textPrimary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    if (count != null && count > 0) {
                        Text(
                            text = "$count",
                            style = MaterialTheme.typography.labelMedium,
                            color = colors.textTertiary,
                        )
                    }
                }
                if (!subtitle.isNullOrBlank()) {
                    Text(
                        text = subtitle,
                        style = MaterialTheme.typography.labelSmall,
                        color = colors.textTertiary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            Spacer(Modifier.width(8.dp))
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                content = actions,
            )
        }
        if (showBottomDivider) {
            HorizontalDivider(color = colors.borderLight, thickness = 0.75.dp)
        }
    }
}

/**
 * Web `.header-create` primary button (`+ 新建`) placed in the top header.
 */
@Composable
fun SnotesPrimaryCreateButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    text: String = "新建",
    contentDescription: String = "新建笔记",
    enabled: Boolean = true,
) {
    val colors = MaterialTheme.snotesColors
    val onAccent = if (colors.isDark) Color(0xFF14213D) else Color.White
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(7.dp),
        color = if (enabled) colors.accent else colors.bgHover,
        contentColor = if (enabled) onAccent else colors.textDisabled,
        modifier = modifier
            .height(34.dp)
            .semantics { this.contentDescription = contentDescription },
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 11.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            SnotesIcon(
                SnotesSymbol.Plus,
                size = 14.dp,
                tint = if (enabled) onAccent else colors.textDisabled,
            )
            Text(
                text = text,
                style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.SemiBold),
                color = if (enabled) onAccent else colors.textDisabled,
                maxLines = 1,
            )
        }
    }
}

/**
 * Web `.sort-trigger` button placed inline next to the search box.
 */
@Composable
fun SnotesSortTriggerButton(
    label: String,
    description: String,
    active: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.snotesColors
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(7.dp),
        color = if (active) colors.accentSoft else colors.bgSurface,
        border = BorderStroke(1.dp, if (active) colors.accent else colors.borderDefault),
        modifier = modifier
            .height(38.dp)
            .semantics { contentDescription = description },
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelMedium.copy(
                    fontWeight = if (active) FontWeight.SemiBold else FontWeight.Medium,
                ),
                color = if (active) colors.selectedText else colors.textSecondary,
                maxLines = 1,
            )
            SnotesIcon(
                SnotesSymbol.Down,
                size = 12.dp,
                tint = if (active) colors.selectedText else colors.textTertiary,
            )
        }
    }
}

@Composable
fun SnotesCard(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    containerColor: Color = MaterialTheme.snotesColors.bgSurface,
    borderColor: Color = MaterialTheme.snotesColors.borderLight,
    shape: RoundedCornerShape = RoundedCornerShape(12.dp),
    shadowElevation: Dp = 0.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    val border = if (borderColor == Color.Transparent) null else BorderStroke(0.75.dp, borderColor)
    if (onClick != null) {
        Surface(
            onClick = onClick,
            modifier = modifier,
            shape = shape,
            color = containerColor,
            border = border,
            tonalElevation = 0.dp,
            shadowElevation = shadowElevation,
            content = { Column(content = content) },
        )
    } else {
        Surface(
            modifier = modifier,
            shape = shape,
            color = containerColor,
            border = border,
            tonalElevation = 0.dp,
            shadowElevation = shadowElevation,
            content = { Column(content = content) },
        )
    }
}

@Composable
fun SnotesSearchField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    clearDescription: String = "清除搜索",
) {
    val colors = MaterialTheme.snotesColors
    var focused by remember { mutableStateOf(false) }
    val borderColor by animateColorAsState(
        targetValue = if (focused) colors.accent else colors.borderDefault,
        animationSpec = tween(SnotesMotion.FastMs, easing = SnotesMotion.EaseOut),
        label = "search-border",
    )
    Surface(
        modifier = modifier.height(38.dp),
        shape = RoundedCornerShape(7.dp),
        color = colors.bgSurface,
        border = BorderStroke(1.dp, borderColor),
    ) {
        Row(
            modifier = Modifier
                .fillMaxSize()
                .padding(start = 10.dp, end = if (value.isNotEmpty()) 2.dp else 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            SnotesIcon(
                SnotesSymbol.Search,
                size = 15.dp,
                tint = if (focused) colors.accent else colors.textTertiary,
            )
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                singleLine = true,
                textStyle = MaterialTheme.typography.bodyMedium.copy(color = colors.textPrimary),
                cursorBrush = SolidColor(colors.accent),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = {}),
                modifier = Modifier
                    .weight(1f)
                    .onFocusChanged { focused = it.isFocused }
                    .semantics(mergeDescendants = true) {},
                decorationBox = { innerTextField ->
                    Box(contentAlignment = Alignment.CenterStart) {
                        if (value.isEmpty()) {
                            Text(
                                placeholder,
                                style = MaterialTheme.typography.bodyMedium,
                                color = colors.textTertiary,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        innerTextField()
                    }
                },
            )
            if (value.isNotEmpty()) {
                IconButton(onClick = { onValueChange("") }, modifier = Modifier.size(30.dp)) {
                    SnotesIcon(SnotesSymbol.Close, size = 14.dp, description = clearDescription, tint = colors.textTertiary)
                }
            }
        }
    }
}

@Composable
fun <T> SnotesSegmentedControl(
    items: List<Pair<T, String>>,
    selected: T,
    onSelect: (T) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.snotesColors
    val selectedIndex = items.indexOfFirst { it.first == selected }.coerceAtLeast(0)
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(10.dp),
        color = if (colors.isDark) colors.bgApp else Color(0xFFECEDF1),
    ) {
        BoxWithConstraints(
            modifier = Modifier
                .fillMaxWidth()
                .padding(3.dp),
        ) {
            val segmentWidth = if (items.isNotEmpty()) maxWidth / items.size else maxWidth
            val indicatorOffset by animateDpAsState(
                targetValue = segmentWidth * selectedIndex,
                animationSpec = spring(stiffness = Spring.StiffnessMediumLow, dampingRatio = Spring.DampingRatioNoBouncy),
                label = "segment-indicator",
            )
            Surface(
                modifier = Modifier
                    .offset { IntOffset(indicatorOffset.roundToPx(), 0) }
                    .width(segmentWidth)
                    .height(34.dp),
                shape = RoundedCornerShape(8.dp),
                color = colors.bgSurface,
                shadowElevation = if (colors.isDark) 0.dp else 1.dp,
            ) {}
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                items.forEach { (key, label) ->
                    val isSelected = key == selected
                    val textColor by animateColorAsState(
                        targetValue = if (isSelected) colors.textPrimary else colors.textSecondary,
                        animationSpec = tween(SnotesMotion.FastMs),
                        label = "segment-text",
                    )
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .height(34.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .clickable(
                                role = Role.Tab,
                                interactionSource = remember { MutableInteractionSource() },
                                indication = null,
                            ) { onSelect(key) },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            label,
                            style = MaterialTheme.typography.labelLarge.copy(
                                fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Medium,
                            ),
                            color = textColor,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.padding(horizontal = 8.dp),
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun SnotesToolbarIconButton(
    symbol: SnotesSymbol,
    description: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    active: Boolean = false,
    spinning: Boolean = false,
) {
    val colors = MaterialTheme.snotesColors
    val rotation = if (spinning) {
        val transition = rememberInfiniteTransition(label = "icon-spin")
        transition.animateFloat(
            initialValue = 0f,
            targetValue = 360f,
            animationSpec = infiniteRepeatable(tween(900, easing = LinearEasing)),
            label = "spin-angle",
        ).value
    } else 0f
    IconButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.size(40.dp),
    ) {
        Box(
            modifier = Modifier
                .size(36.dp)
                .clip(CircleShape)
                .background(if (active) colors.accentSoft else Color.Transparent),
            contentAlignment = Alignment.Center,
        ) {
            SnotesIcon(
                symbol,
                size = 18.dp,
                description = description,
                modifier = if (spinning) Modifier.rotate(rotation) else Modifier,
                tint = when {
                    !enabled && !spinning -> colors.textDisabled
                    active || spinning -> colors.accent
                    else -> colors.textSecondary
                },
            )
        }
    }
}

@Composable
fun EmptyWorkspace(
    symbol: SnotesSymbol,
    title: String,
    modifier: Modifier = Modifier,
    description: String = "",
    action: (@Composable () -> Unit)? = null,
) {
    val colors = MaterialTheme.snotesColors
    Column(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 32.dp, vertical = 56.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(
            modifier = Modifier
                .size(52.dp)
                .clip(CircleShape)
                .background(colors.bgHover),
            contentAlignment = Alignment.Center,
        ) {
            SnotesIcon(symbol, size = 22.dp, tint = colors.textTertiary)
        }
        Spacer(Modifier.height(2.dp))
        Text(title, style = MaterialTheme.typography.titleMedium, color = colors.textPrimary, textAlign = TextAlign.Center)
        if (description.isNotBlank()) {
            Text(
                description,
                style = MaterialTheme.typography.bodyMedium,
                color = colors.textTertiary,
                textAlign = TextAlign.Center,
                modifier = Modifier.widthIn(max = 280.dp),
            )
        }
        action?.let {
            Spacer(Modifier.height(4.dp))
            it()
        }
    }
}

@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        modifier.padding(start = 6.dp, top = 14.dp, bottom = 6.dp),
        style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
        color = MaterialTheme.snotesColors.textTertiary,
    )
}

@Composable
fun SettingsRow(
    symbol: SnotesSymbol,
    title: String,
    subtitle: String? = null,
    trailingText: String? = null,
    tint: Color? = null,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val colors = MaterialTheme.snotesColors
    val iconTint = when {
        !enabled -> colors.textDisabled
        tint != null -> tint
        else -> colors.textSecondary
    }
    Surface(onClick = onClick, enabled = enabled, color = Color.Transparent) {
        Row(
            Modifier
                .fillMaxWidth()
                .defaultMinSize(minHeight = 52.dp)
                .padding(horizontal = 16.dp, vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            SnotesIcon(symbol, size = 19.dp, tint = iconTint)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    title,
                    style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium),
                    color = if (enabled) colors.textPrimary else colors.textDisabled,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                subtitle?.takeIf { it.isNotBlank() }?.let {
                    Text(
                        it,
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.textTertiary,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            trailingText?.let {
                Text(
                    it,
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textTertiary,
                    maxLines = 1,
                )
            }
            SnotesIcon(SnotesSymbol.Chevron, size = 16.dp, tint = colors.textDisabled)
        }
    }
}

@Composable
fun SettingsSwitchRow(
    title: String,
    subtitle: String? = null,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    val colors = MaterialTheme.snotesColors
    Row(
        Modifier
            .fillMaxWidth()
            .clickable { onCheckedChange(!checked) }
            .defaultMinSize(minHeight = 52.dp)
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                title,
                style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium),
                color = colors.textPrimary,
            )
            subtitle?.takeIf { it.isNotBlank() }?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = colors.textTertiary)
            }
        }
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = Color.White,
                checkedTrackColor = colors.accent,
                uncheckedThumbColor = Color.White,
                uncheckedTrackColor = colors.borderDefault,
                uncheckedBorderColor = Color.Transparent,
            ),
        )
    }
}

fun parseHexColorOrNull(raw: String?): Color? {
    val value = raw?.trim()?.removePrefix("#") ?: return null
    if (value.length != 6 && value.length != 8) return null
    val parsed = value.toLongOrNull(16) ?: return null
    val argb = if (value.length == 6) (0xFF000000L or parsed) else parsed
    return Color(argb)
}
