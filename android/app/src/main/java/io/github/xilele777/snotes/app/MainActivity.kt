package io.github.xilele777.snotes.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.graphics.Color
import dagger.hilt.android.AndroidEntryPoint
import io.github.xilele777.snotes.BuildConfig
import javax.inject.Inject
import io.github.xilele777.snotes.feature.editor.EditorPrototypeScreen
import io.github.xilele777.snotes.feature.editor.LocalEditorScreen
import io.github.xilele777.snotes.feature.notes.NotesScreen

class AppIdentity @Inject constructor() {
    val versionName: String get() = BuildConfig.VERSION_NAME
}

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    @Inject lateinit var identity: AppIdentity

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            SnotesTheme {
                var prototype by rememberSaveable { mutableStateOf(false) }
                var noteId by rememberSaveable { mutableStateOf<String?>(null) }
                when {
                    prototype -> EditorPrototypeScreen(onBack = { prototype = false })
                    noteId != null -> LocalEditorScreen(checkNotNull(noteId), onBack = { noteId = null })
                    else -> NotesScreen(onOpen = { noteId = it }, onPrototype = { prototype = true })
                }
            }
        }
    }
}

@Composable
private fun SnotesTheme(content: @Composable () -> Unit) {
    val colors = if (isSystemInDarkTheme()) {
        darkColorScheme(primary = Color(0xFFAFBFFF), background = Color(0xFF1E1F24))
    } else {
        lightColorScheme(primary = Color(0xFF4668E8), background = Color(0xFFF7F8FC))
    }
    MaterialTheme(colorScheme = colors, content = content)
}

