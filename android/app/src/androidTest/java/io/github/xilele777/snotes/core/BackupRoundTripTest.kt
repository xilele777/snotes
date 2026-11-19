package io.github.xilele777.snotes.core

import android.content.Context
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.xilele777.snotes.core.data.*
import io.github.xilele777.snotes.core.database.*
import io.github.xilele777.snotes.core.editor.*
import io.github.xilele777.snotes.core.network.*
import io.github.xilele777.snotes.core.sync.*
import java.io.File
import java.util.UUID
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Test
import org.junit.Assert.*
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class) class BackupRoundTripTest {
    @Test fun formatThreeRoundTripPreservesEmptyTrashHistoryAndIdempotentConflicts() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>(); val profile = LocalProfile(context)
        val original = profile.paths.id; val first = UUID.randomUUID().toString(); val second = UUID.randomUUID().toString()
        profile.switchTo(first)
        val repository = NotesRepository(profile); val books = BookRepository(repository); val connections = ConnectionStore(profile)
        val coordinator = SyncCoordinator(repository, connections, profile, context)
        val backups = Backups(context, repository, profile, Images(context, profile, repository, connections, coordinator), books)
        val file = File(context.cacheDir, "round-trip-${UUID.randomUUID()}.zip")
        try {
            val group = repository.createGroup("归档组"); val active = repository.create("old text", group.id)
            repository.updateProps(active.id, buildJsonObject { put("star", 1); put("top", 1) })
            repository.commit(DraftSnapshot(SessionKey(first, active.id, "session"), 1, "old text", "new text"))
            val trash = repository.create(""); repository.setTrash(trash.id, true)
            val book = books.create("本机笔记本", nodes = listOf(TocNodeDto("ref", null, "note", 0, active.id, null)))
            backups.export(Uri.fromFile(file))
            val archive = file.inputStream().use(::readArchive)
            assertEquals(3, archive.index.format); assertEquals(1, archive.index.histories.size)
            repository.switchProfile(second)
            val result = backups.importBackup(Uri.fromFile(file)); assertEquals(2, result.created); assertEquals(1, result.books)
            assertEquals("new text", repository.body(active.id)); assertEquals("", repository.body(trash.id)); assertEquals(1, repository.note(trash.id)!!.invalid)
            assertEquals(1, repository.note(active.id)!!.star); assertEquals(active.id, books.desired(book)!!.toc.nodes.single().noteId)
            assertTrue(repository.database.notes().history(active.id).any { it.markdown == "old text" })
            assertEquals(0, backups.importBackup(Uri.fromFile(file)).created)
            repository.commit(DraftSnapshot(SessionKey(second, active.id, "new-session"), 1, "new text", "keep this current edit"))
            assertEquals(1, backups.importBackup(Uri.fromFile(file)).conflicts); assertEquals("keep this current edit", repository.body(active.id))
            assertTrue(repository.database.notes().history(active.id).any { it.markdown == "new text" })
        } finally { SyncWork.cancel(context, first).result.get(); SyncWork.cancel(context, second).result.get(); profile.switchTo(original); profile.releaseRetired(); file.delete() }
    }
}
