package io.github.xilele777.snotes.core.database

import android.content.Context
import androidx.room.Room
import androidx.room.RoomDatabase
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

class ProfilePaths(context: Context, val id: String) {
    init { require(id.matches(Regex("[A-Za-z0-9-]{1,128}"))) }
    val directory = File(context.filesDir, "profiles/$id")
    val database = File(directory, "notes.db")
    val drafts = File(directory, "drafts")
    val images = File(directory, "images")
    fun prepare() { listOf(directory, drafts, images).forEach { check(it.isDirectory || it.mkdirs()) } }
}

/** One process-wide active profile. M3 binds its first origin; instance switching requires a new profile in M4. */
@Singleton
class LocalProfile @Inject constructor(@ApplicationContext context: Context) {
    val paths = ProfilePaths(context, "local-default")
    val database: NotesDatabase = Room.databaseBuilder(context, NotesDatabase::class.java, paths.database.absolutePath)
        .setJournalMode(RoomDatabase.JournalMode.WRITE_AHEAD_LOGGING).build()
}
