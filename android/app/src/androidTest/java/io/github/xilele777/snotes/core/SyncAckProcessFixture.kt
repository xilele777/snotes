package io.github.xilele777.snotes.core

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import io.github.xilele777.snotes.core.data.NotesRepository
import io.github.xilele777.snotes.core.database.NotesDatabase
import io.github.xilele777.snotes.core.network.*
import io.github.xilele777.snotes.core.sync.*
import java.io.File
import java.io.FileOutputStream
import kotlinx.coroutines.*
import org.junit.Test
import org.junit.Assert.*

/** Driven across two processes by verify-sync-ack-recovery.ps1. Not an ordinary test suite. */
class SyncAckProcessFixture {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val target = InstrumentationRegistry.getArguments().getString("m3Backend").also { require(it == "node" || it == "worker") }
    private val directory = File(context.cacheDir, "m3-ack-$target")
    private fun client() = ApiClient(instanceOrigin("http://10.0.2.2:${if (target == "node") 18787 else 18788}", true), "android-m3-test-token")
    private fun database() = Room.databaseBuilder(context, NotesDatabase::class.java, File(directory, "notes.db").absolutePath).build()

    @Test fun prepare(): Unit = runBlocking {
        check(directory.isDirectory || directory.mkdirs()); File(directory, "ready").delete()
        val db = database(); val repo = NotesRepository(db, "ack-test", File(directory, "drafts")); val store = SyncStore(repo)
        val client = client()
        try {
            SyncEngine(store, client).run()
            val note = repo.create("accepted before process ACK")
            store.put("fixture_note", note.id)
            val sent = store.prepare(store.dao.task("note", note.id, "create")!!)!!
            val ack = client.call { create(store.meta("accepted_epoch")!!, sent.payload) }
            assertEquals(1L, ack.version)
            assertEquals(0L, repo.note(note.id)!!.version)
            // Mark readiness only AFTER the real server response and BEFORE the ACK transaction.
            FileOutputStream(File(directory, "ready")).use { it.write(note.id.toByteArray(Charsets.UTF_8)); it.fd.sync() }
            withTimeout(60_000) { awaitCancellation() }
        } finally { client.close(); db.close() }
    }
    @Test fun verify() = runBlocking {
        val db = database(); val repo = NotesRepository(db, "ack-test", File(directory, "drafts")); val store = SyncStore(repo)
        val client = client()
        try {
            val id = checkNotNull(store.meta("fixture_note"))
            val task = checkNotNull(store.dao.task("note", id, "create"))
            assertNotNull(store.meta("sent:${task.id}")); assertEquals(0L, repo.note(id)!!.version)
            assertEquals("accepted before process ACK", client.call { bodies(BodiesRequest(listOf(id))) }.bodies.single().content)
            SyncEngine(store, client).run()
            assertEquals("accepted before process ACK", repo.body(id)); assertEquals(1L, repo.note(id)!!.bodyVersion)
            assertNull(store.dao.task("note", id, "create")); assertTrue(store.dao.tasks().isEmpty())
        } finally {
            client.close(); db.close()
            check(directory.canonicalPath.startsWith(context.cacheDir.canonicalPath + File.separator)); directory.deleteRecursively()
        }
    }
}
