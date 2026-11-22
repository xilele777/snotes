package io.github.xilele777.snotes.core.ui

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Immutable
data class SnotesColors(
    val bgApp: Color,
    val bgList: Color,
    val bgRail: Color,
    val bgSurface: Color,
    val bgHover: Color,
    val divider: Color,
    val borderLight: Color,
    val borderDefault: Color,
    val textPrimary: Color,
    val textSecondary: Color,
    val textTertiary: Color,
    val textDisabled: Color,
    val accent: Color,
    val accentSoft: Color,
    val selectedText: Color,
    val success: Color,
    val successBg: Color,
    val warning: Color,
    val warningBg: Color,
    val danger: Color,
    val dangerBg: Color,
    val star: Color,
    val isDark: Boolean,
)

// Exact Web tokens from src/styles.css & src/ui-tokens.css.
private val LightSnotesColors = SnotesColors(
    bgApp = Color(0xFFF7F7F8),
    bgList = Color(0xFFFAFAFA),
    bgRail = Color(0xFFF3F3F5),
    bgSurface = Color(0xFFFFFFFF),
    bgHover = Color(0xFFEDEDF0),
    divider = Color(0xFFE8E9EC),
    borderLight = Color(0xFFE9EAEE),
    borderDefault = Color(0xFFDFE1E6),
    textPrimary = Color(0xFF25262B),
    textSecondary = Color(0xFF50545E),
    textTertiary = Color(0xFF666B76),
    textDisabled = Color(0xFFADB0B8),
    accent = Color(0xFF4668E8),
    accentSoft = Color(0xFFEDF1FF),
    selectedText = Color(0xFF2D4FC7),
    success = Color(0xFF2E8B57),
    successBg = Color(0xFFECF8F1),
    warning = Color(0xFFD9820B),
    warningBg = Color(0xFFFFF6E6),
    danger = Color(0xFFCA5353),
    dangerBg = Color(0xFFFFF3F3),
    star = Color(0xFF4668E8),
    isDark = false,
)

private val DarkSnotesColors = SnotesColors(
    bgApp = Color(0xFF1E1F24),
    bgList = Color(0xFF212228),
    bgRail = Color(0xFF1B1C20),
    bgSurface = Color(0xFF27282F),
    bgHover = Color(0xFF303139),
    divider = Color(0xFF30323A),
    borderLight = Color(0xFF363842),
    borderDefault = Color(0xFF42444E),
    textPrimary = Color(0xFFEDF2FA),
    textSecondary = Color(0xFFB9C4D4),
    textTertiary = Color(0xFF95A4B9),
    textDisabled = Color(0xFF5E616A),
    accent = Color(0xFF7F97F0),
    accentSoft = Color(0xFF2A3352),
    selectedText = Color(0xFFC4D2FF),
    success = Color(0xFF82B09A),
    successBg = Color(0xFF1D3328),
    warning = Color(0xFFF0AE48),
    warningBg = Color(0xFF362B1A),
    danger = Color(0xFFE37C7C),
    dangerBg = Color(0xFF3A2727),
    star = Color(0xFF7F97F0),
    isDark = true,
)

private val LocalSnotesColors = staticCompositionLocalOf { LightSnotesColors }

val MaterialTheme.snotesColors: SnotesColors
    @Composable
    @ReadOnlyComposable
    get() = LocalSnotesColors.current

private val LightColors = lightColorScheme(
    primary = Color(0xFF4668E8), onPrimary = Color.White,
    primaryContainer = Color(0xFFEDF1FF), onPrimaryContainer = Color(0xFF2D4FC7),
    secondary = Color(0xFF50545E), onSecondary = Color.White,
    secondaryContainer = Color(0xFFEDEDF0), onSecondaryContainer = Color(0xFF25262B),
    tertiary = Color(0xFF2E8B57), onTertiary = Color.White,
    background = Color(0xFFFAFAFA), onBackground = Color(0xFF25262B),
    surface = Color.White, onSurface = Color(0xFF25262B),
    surfaceVariant = Color(0xFFF7F7F8), onSurfaceVariant = Color(0xFF50545E),
    surfaceContainerLowest = Color.White, surfaceContainerLow = Color(0xFFFAFAFA),
    surfaceContainer = Color(0xFFF3F3F5), surfaceContainerHigh = Color(0xFFEDEDF0),
    surfaceContainerHighest = Color(0xFFE5E7EB),
    outline = Color(0xFF666B76), outlineVariant = Color(0xFFE8E9EC),
    error = Color(0xFFCA5353), onError = Color.White,
    errorContainer = Color(0xFFFFF3F3), onErrorContainer = Color(0xFFB94D43),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF7F97F0), onPrimary = Color(0xFF14213D),
    primaryContainer = Color(0xFF2A3352), onPrimaryContainer = Color(0xFFC4D2FF),
    secondary = Color(0xFFB9C4D4), onSecondary = Color(0xFF212228),
    secondaryContainer = Color(0xFF303139), onSecondaryContainer = Color(0xFFEDF2FA),
    tertiary = Color(0xFF82B09A), onTertiary = Color(0xFF10281B),
    background = Color(0xFF212228), onBackground = Color(0xFFEDF2FA),
    surface = Color(0xFF27282F), onSurface = Color(0xFFEDF2FA),
    surfaceVariant = Color(0xFF1E1F24), onSurfaceVariant = Color(0xFFB9C4D4),
    surfaceContainerLowest = Color(0xFF1B1C20), surfaceContainerLow = Color(0xFF212228),
    surfaceContainer = Color(0xFF27282F), surfaceContainerHigh = Color(0xFF303139),
    surfaceContainerHighest = Color(0xFF393B45),
    outline = Color(0xFF95A4B9), outlineVariant = Color(0xFF30323A),
    error = Color(0xFFE37C7C), onError = Color(0xFF1E1F24),
    errorContainer = Color(0xFF3A2727), onErrorContainer = Color(0xFFE37C7C),
)

@Composable
fun SnotesTheme(dark: Boolean = false, content: @Composable () -> Unit) {
    val tokens = if (dark) DarkSnotesColors else LightSnotesColors
    CompositionLocalProvider(LocalSnotesColors provides tokens) {
        MaterialTheme(
            colorScheme = if (dark) DarkColors else LightColors,
            shapes = Shapes(
                extraSmall = RoundedCornerShape(5.dp),
                small = RoundedCornerShape(7.dp),
                medium = RoundedCornerShape(10.dp),
                large = RoundedCornerShape(12.dp),
                extraLarge = RoundedCornerShape(16.dp),
            ),
            typography = Typography(
                headlineLarge = TextStyle(fontSize = 26.sp, lineHeight = 34.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.5).sp),
                headlineMedium = TextStyle(fontSize = 20.sp, lineHeight = 28.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.35).sp),
                titleLarge = TextStyle(fontSize = 17.5.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.25).sp),
                titleMedium = TextStyle(fontSize = 15.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.1).sp),
                bodyLarge = TextStyle(fontSize = 14.5.sp, lineHeight = 22.sp),
                bodyMedium = TextStyle(fontSize = 13.5.sp, lineHeight = 20.sp),
                bodySmall = TextStyle(fontSize = 12.sp, lineHeight = 17.sp),
                labelLarge = TextStyle(fontSize = 13.5.sp, lineHeight = 19.sp, fontWeight = FontWeight.Medium),
                labelMedium = TextStyle(fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium),
                labelSmall = TextStyle(fontSize = 11.sp, lineHeight = 15.sp, fontWeight = FontWeight.Medium),
            ),
            content = content,
        )
    }
}
