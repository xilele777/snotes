package io.github.xilele777.snotes.core.data

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

data class AppearanceValue(val theme: String = "system", val fontSize: Int = 16)
@Singleton class Appearance @Inject constructor(@ApplicationContext context: Context) {
    private val prefs = context.getSharedPreferences("appearance", Context.MODE_PRIVATE)
    private val mutable = MutableStateFlow(AppearanceValue(prefs.getString("theme", "system")!!, prefs.getInt("font", 16).coerceIn(12, 28)))
    val state = mutable.asStateFlow()
    fun set(theme: String = state.value.theme, font: Int = state.value.fontSize) {
        require(theme in setOf("system", "light", "dark"))
        prefs.edit().putString("theme", theme).putInt("font", font.coerceIn(12, 28)).apply()
        mutable.value = AppearanceValue(theme, font.coerceIn(12, 28))
    }
}
