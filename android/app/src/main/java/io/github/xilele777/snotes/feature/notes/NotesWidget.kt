package io.github.xilele777.snotes.feature.notes

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent
import io.github.xilele777.snotes.R
import io.github.xilele777.snotes.app.MainActivity
import io.github.xilele777.snotes.core.data.NotesRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@EntryPoint
@InstallIn(SingletonComponent::class)
interface WidgetAccess {
    fun repository(): NotesRepository
}

private val noteViewIds = intArrayOf(
    R.id.widget_note_1,
    R.id.widget_note_2,
    R.id.widget_note_3,
    R.id.widget_note_4,
    R.id.widget_note_5,
)

class NotesWidget {
    suspend fun updateAll(context: Context) {
        val manager = AppWidgetManager.getInstance(context)
        val ids = manager.getAppWidgetIds(ComponentName(context, NotesWidgetReceiver::class.java))
        if (ids.isEmpty()) return
        val repository = EntryPointAccessors.fromApplication(context.applicationContext, WidgetAccess::class.java).repository()
        val (profile, notes) = withContext(Dispatchers.IO) {
            repository.profileId to repository.database.notes().recent()
        }
        val views = buildWidgetViews(context, profile, notes.map { it.id to it.title.ifBlank { "无标题" } })
        ids.forEach { id -> manager.updateAppWidget(id, views) }
    }
}

private fun buildWidgetViews(
    context: Context,
    profile: String,
    notes: List<Pair<String, String>>,
): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.widget_notes)
    views.setTextViewText(R.id.widget_title, "Snotes · 本机最近笔记")
    val newIntent = Intent(context, MainActivity::class.java)
        .putExtra("newNote", true)
        .putExtra("profile", profile)
    val newPending = PendingIntent.getActivity(
        context,
        0,
        newIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    views.setOnClickPendingIntent(R.id.widget_new_note, newPending)

    noteViewIds.forEachIndexed { idx, viewId ->
        val item = notes.getOrNull(idx)
        if (item != null) {
            views.setViewVisibility(viewId, View.VISIBLE)
            views.setTextViewText(viewId, item.second)
            val noteIntent = Intent(context, MainActivity::class.java)
                .putExtra("noteId", item.first)
                .putExtra("profile", profile)
            val notePending = PendingIntent.getActivity(
                context,
                idx + 1,
                noteIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            views.setOnClickPendingIntent(viewId, notePending)
        } else {
            views.setViewVisibility(viewId, View.GONE)
        }
    }
    return views
}

class NotesWidgetReceiver : AppWidgetProvider() {
    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        if (appWidgetIds.isEmpty()) return
        val repository = EntryPointAccessors.fromApplication(context.applicationContext, WidgetAccess::class.java).repository()
        val profile = repository.profileId
        val notes = runCatching { repository.database.notes().recent() }.getOrDefault(emptyList())
        val views = buildWidgetViews(context, profile, notes.map { it.id to it.title.ifBlank { "无标题" } })
        appWidgetIds.forEach { id -> appWidgetManager.updateAppWidget(id, views) }
    }
}
