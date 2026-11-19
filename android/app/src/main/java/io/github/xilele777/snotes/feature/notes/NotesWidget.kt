package io.github.xilele777.snotes.feature.notes

import android.content.Context
import android.content.Intent
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.background
import androidx.glance.appwidget.*
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.layout.*
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent
import io.github.xilele777.snotes.app.MainActivity
import io.github.xilele777.snotes.core.data.NotesRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@EntryPoint @InstallIn(SingletonComponent::class)
interface WidgetAccess { fun repository(): NotesRepository }
class NotesWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val repository = EntryPointAccessors.fromApplication(context.applicationContext, WidgetAccess::class.java).repository()
        val (profile, notes) = withContext(Dispatchers.IO) { repository.syncTransaction { repository.profileId to repository.database.notes().recent() } }
        provideContent {
            GlanceTheme {
            Column(GlanceModifier.fillMaxSize().background(GlanceTheme.colors.widgetBackground).padding(12.dp).appWidgetBackground()) {
                Text("Snotes · 本机最近笔记", style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 16.sp))
                androidx.glance.Button("新建笔记", actionStartActivity(Intent(context, MainActivity::class.java).putExtra("newNote", true).putExtra("profile", profile)))
                notes.forEach { note -> androidx.glance.Button(note.title.ifBlank { "无标题" }, actionStartActivity(Intent(context, MainActivity::class.java).putExtra("noteId", note.id).putExtra("profile", profile))) }
            }
            }
        }
    }
}
class NotesWidgetReceiver : GlanceAppWidgetReceiver() { override val glanceAppWidget = NotesWidget() }
