package io.github.xilele777.snotes.core.database

import android.content.Context
import androidx.room.Room
import androidx.room.RoomDatabase
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton
import java.util.UUID
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

class ProfilePaths(context: Context, val id: String) {
    init { require(id.matches(Regex("[A-Za-z0-9-]{1,128}"))) }
    val directory = File(context.filesDir, "profiles/$id")
    val database = File(directory, "notes.db")
    val drafts = File(directory, "drafts")
    val images = File(directory, "images")
    fun prepare() { listOf(directory, drafts, images).forEach { check(it.isDirectory || it.mkdirs()) } }
}

/** Profile switching is fenced by SyncCoordinator and the repository save monitor. */
@Singleton
class LocalProfile @Inject constructor(@ApplicationContext private val context: Context) {
    private val preferences = context.getSharedPreferences("profiles", Context.MODE_PRIVATE)
    private val mutableId = MutableStateFlow(preferences.getString("active", "local-default")!!)
    val id = mutableId.asStateFlow()
    @Volatile var paths = ProfilePaths(context, mutableId.value); private set
    @Volatile var database: NotesDatabase = open(paths); private set
    private fun open(paths: ProfilePaths): NotesDatabase {
        paths.prepare()
        return Room.databaseBuilder(context, NotesDatabase::class.java, paths.database.absolutePath)
            .setJournalMode(RoomDatabase.JournalMode.WRITE_AHEAD_LOGGING).build()
    }
    fun candidates(): List<String> = File(context.filesDir, "profiles").listFiles().orEmpty()
        .filter { it.isDirectory && it.name.matches(Regex("[A-Za-z0-9-]{1,128}")) }.map { it.name }.sorted()
    fun pathsFor(id: String) = ProfilePaths(context, id)
    fun newId() = UUID.randomUUID().toString()
    fun requestSync() = io.github.xilele777.snotes.core.sync.SyncWork.enqueue(context, paths.id)
    private val retired = mutableListOf<NotesDatabase>()
    fun releaseRetired() { retired.forEach { it.close() }; retired.clear() }
    fun switchTo(id: String) {
        if (id == paths.id) return
        val nextPaths = pathsFor(id)
        val next = open(nextPaths)
        try { next.openHelper.writableDatabase; check(preferences.edit().putString("active", id).commit()) }
        catch (error: Exception) { next.close(); throw error }
        val previous = database
        paths = nextPaths; database = next
        retired.add(previous) // Existing Flow/Paging subscriptions finish when the Activity models are cleared.
        mutableId.value = id
    }
}
