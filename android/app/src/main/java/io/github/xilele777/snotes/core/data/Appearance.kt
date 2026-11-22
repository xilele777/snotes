package io.github.xilele777.snotes.core.data

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

data class AppearanceValue(
    val theme: String = "system",
    val fontSize: Int = 16,
    val noteDensity: String = "comfortable",
    val showNotePreview: Boolean = true,
    val lineSpacing: String = "standard",
)

@Singleton
class Appearance @Inject constructor(@ApplicationContext context: Context) {
    private val prefs = context.getSharedPreferences("appearance", Context.MODE_PRIVATE)
    private val mutable = MutableStateFlow(
        AppearanceValue(
            theme = prefs.getString("theme", "system").takeIf { it in setOf("system", "light", "dark") } ?: "system",
            fontSize = prefs.getInt("font", 16).coerceIn(12, 28),
            noteDensity = prefs.getString("note_density", "comfortable").takeIf { it in setOf("comfortable", "compact") } ?: "comfortable",
            showNotePreview = prefs.getBoolean("show_note_preview", true),
            lineSpacing = prefs.getString("line_spacing", "standard").takeIf { it in setOf("compact", "standard", "relaxed") } ?: "standard",
        ),
    )
    val state = mutable.asStateFlow()

    fun set(
        theme: String = state.value.theme,
        font: Int = state.value.fontSize,
        noteDensity: String = state.value.noteDensity,
        showNotePreview: Boolean = state.value.showNotePreview,
        lineSpacing: String = state.value.lineSpacing,
    ) {
        require(theme in setOf("system", "light", "dark"))
        require(noteDensity in setOf("comfortable", "compact"))
        require(lineSpacing in setOf("compact", "standard", "relaxed"))
        val clampedFont = font.coerceIn(12, 28)
        prefs.edit()
            .putString("theme", theme)
            .putInt("font", clampedFont)
            .putString("note_density", noteDensity)
            .putBoolean("show_note_preview", showNotePreview)
            .putString("line_spacing", lineSpacing)
            .apply()
        mutable.value = AppearanceValue(theme, clampedFont, noteDensity, showNotePreview, lineSpacing)
    }
}
