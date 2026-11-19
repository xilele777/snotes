package io.github.xilele777.snotes.core

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.xilele777.snotes.core.data.*
import io.github.xilele777.snotes.core.database.*
import io.github.xilele777.snotes.core.editor.*
import io.github.xilele777.snotes.core.model.*
import io.github.xilele777.snotes.core.network.*
import io.github.xilele777.snotes.core.sync.*
import java.io.File
import java.util.UUID
import kotlinx.serialization.json.*
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SyncStoreTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private lateinit var database: NotesDatabase
    private lateinit var repository: NotesRepository
    private lateinit var store: SyncStore
    private lateinit var directory: File
    @Before fun setup() {
        directory = File(context.cacheDir, "sync-store-${UUID.randomUUID()}"); check(directory.mkdirs())
        database = Room.inMemoryDatabaseBuilder(context, NotesDatabase::class.java).build()
        repository = NotesRepository(database, "test", File(directory, "drafts")); store = SyncStore(repository)
    }
    @After fun cleanup() { database.close(); check(directory.canonicalPath.startsWith(context.cacheDir.canonicalPath + File.separator)); directory.deleteRecursively() }
    private fun confirmed(body: String = "original"): NoteEntity {
        val note = repository.create(body)
        val task = store.dao.task("note", note.id, "create")!!
        store.ack(store.prepare(task)!!, WriteAck(1, 1, 100))
        return repository.note(note.id)!!
    }
    private fun save(id: String, text: String, revision: Long = 1) {
        val snapshot = DraftSnapshot(SessionKey("test", id, "session"), revision, repository.body(id)!!, text)
        repository.stage(snapshot); repository.commit(snapshot); repository.clear(snapshot)
    }
    private fun remote(note: NoteEntity, bodyVersion: Long = 2, propVersion: Long = 2, star: Int = 1, top: Int = 1, invalid: Int = 0) =
        NoteMeta(note.id, null, "remote", "remote summary", null, bodyVersion, propVersion, star, top, null, null, invalid, 100, 200)
    private fun page(vararg notes: NoteMeta) = PullDto(notes.toList(), emptyList(), 200, null, "checkpoint")

    @Test fun oldBodyAckAdvancesOnlyAcceptedBaselineAndKeepsNewBodyTask() {
        val note = confirmed(); save(note.id, "first")
        val sent = store.prepare(store.dao.task("note", note.id, "body")!!)!!
        save(note.id, "second", 2); store.ack(sent, WriteAck(2, 9, 200))
        assertEquals("second", repository.body(note.id)); assertEquals(2L, repository.note(note.id)!!.version)
        assertEquals(1L, repository.note(note.id)!!.bodyVersion); assertEquals(1L, repository.note(note.id)!!.propVersion)
        assertNotNull(store.dao.task("note", note.id, "body")); assertEquals("body", repository.note(note.id)!!.dirty)
        val next = store.prepare(store.dao.task("note", note.id, "body")!!)!!
        assertEquals(JsonPrimitive(2), next.payload["base_version"])
    }
    @Test fun oldFailureCannotFailNewEdit() {
        val note = confirmed(); save(note.id, "first")
        val sent = store.prepare(store.dao.task("note", note.id, "body")!!)!!
        save(note.id, "second", 2); store.fail(sent, ApiError(413, "too_large"))
        val current = store.dao.task("note", note.id, "body")!!
        assertEquals(0, current.failed); assertEquals(0L, current.nextAt)
    }
    @Test fun bodyAckDoesNotHideRemotePropertiesAndPartialPropAckLeavesProjectionForPull() {
        val note = confirmed(); save(note.id, "local")
        repository.updateProps(note.id, buildJsonObject { put("star", 1) })
        store.ack(store.prepare(store.dao.task("note", note.id, "body")!!)!!, WriteAck(2, 9, 200))
        assertNotNull(store.dao.task("note", note.id, "prop")); assertEquals("prop", repository.note(note.id)!!.dirty)
        assertEquals(1L, repository.note(note.id)!!.propVersion)
        store.ack(store.prepare(store.dao.task("note", note.id, "prop")!!)!!, WriteAck(7, 10, 201))
        assertEquals(2L, repository.note(note.id)!!.version); assertEquals(1L, repository.note(note.id)!!.propVersion)
        store.applyPage(page(remote(note, 2, 10)), false)
        assertEquals(1, repository.note(note.id)!!.top); assertEquals(10L, repository.note(note.id)!!.propVersion)
    }
    @Test fun replayedCreateDownloadsTrueRecordInsteadOfAcknowledgingPayload() {
        val note = repository.create("local create")
        store.ack(store.prepare(store.dao.task("note", note.id, "create")!!)!!, WriteAck(3, 4, 200, replayed = true))
        assertEquals(0L, repository.note(note.id)!!.version); assertEquals(0L, repository.note(note.id)!!.bodyVersion)
        assertEquals(0L, repository.note(note.id)!!.propVersion); assertEquals(listOf(note.id), store.pendingBodies())
        store.applyBodies(listOf(BodyDto(note.id, "other device", 3)), false)
        assertEquals("other device", repository.body(note.id))
    }
    @Test fun conflictCopyAndTaskConsumptionAreAtomicAndRetryDoesNotDuplicateCopy() {
        val note = confirmed(); save(note.id, "mine")
        val sent = store.prepare(store.dao.task("note", note.id, "body")!!)!!
        val ack = WriteAck(3, 1, 200, true, "other device text")
        database.openHelper.writableDatabase.execSQL("CREATE TRIGGER fail_copy BEFORE INSERT ON notes BEGIN SELECT RAISE(ABORT, 'disk failure'); END")
        assertThrows(Exception::class.java) { store.ack(sent, ack) }
        assertNotNull(store.dao.taskById(sent.id)); assertNotNull(store.meta("sent:${sent.id}"))
        database.openHelper.writableDatabase.execSQL("DROP TRIGGER fail_copy")
        store.ack(sent, ack); store.ack(sent, ack)
        val copies = store.dao.allNotes().filter { it.id != note.id }
        assertEquals(1, copies.size); assertTrue(repository.body(copies.single().id)!!.endsWith("other device text"))
        assertNotNull(store.dao.task("note", copies.single().id, "create")); assertNull(store.dao.taskById(sent.id))
    }
    @Test fun emptyConflictDoesNotCreateExtraNoteAndEmptyBodyCanBeAcknowledged() {
        val note = confirmed(); save(note.id, "")
        store.ack(store.prepare(store.dao.task("note", note.id, "body")!!)!!, WriteAck(2, 1, 200, true, ""))
        assertEquals(1, store.dao.allNotes().size); assertEquals("", repository.body(note.id)); assertEquals(2L, repository.note(note.id)!!.bodyVersion)
    }
    @Test fun bodyDownloadedInFlightCannotOverwriteFreshLocalEdit() {
        val note = confirmed(); store.applyPage(page(remote(note)), false)
        save(note.id, "local while downloading")
        store.applyBodies(listOf(BodyDto(note.id, "remote", 2)), false)
        assertEquals("local while downloading", repository.body(note.id)); assertEquals(1L, repository.note(note.id)!!.version)
    }
    @Test fun fileOnlyDraftAndActiveEditorBothFenceDownloadApplication() {
        val note = confirmed(); store.applyPage(page(remote(note)), false)
        database.openHelper.writableDatabase.execSQL("CREATE TRIGGER fail_drafts BEFORE INSERT ON drafts BEGIN SELECT RAISE(ABORT, 'mirror failed'); END")
        repository.stage(DraftSnapshot(SessionKey("test", note.id, "draft"), 1, "original", "file only"))
        assertTrue(store.dao.drafts().isEmpty())
        store.applyBodies(listOf(BodyDto(note.id, "remote", 2)), false)
        assertEquals("original", repository.body(note.id)); assertTrue(store.pendingBodies().contains(note.id))
        val other = confirmed("other"); store.applyPage(page(remote(other)), false)
        repository.pinEditor(other.id); store.applyBodies(listOf(BodyDto(other.id, "remote", 2)), false)
        assertEquals("other", repository.body(other.id)); repository.unpinEditor(other.id)
    }
    @Test fun staleBodyResponseCannotRegressDownloadedVersion() {
        val note = confirmed(); store.applyPage(page(remote(note, 4)), false)
        assertThrows(ApiError::class.java) { store.applyBodies(listOf(BodyDto(note.id, "stale", 3)), false) }
        assertEquals("original", repository.body(note.id)); assertNotNull(store.meta("required_body:${note.id}"))
    }
    @Test fun fullInventoryKeepsUnsyncedCreateAndOnlyInfersMissingFromOriginalSnapshot() {
        val published = confirmed("published text"); val original = setOf(published.id)
        val unsynced = repository.create("new while inventory running")
        store.finishNotes(original, emptySet(), emptySet(), emptySet(), 100, "cp", true)
        assertNull(repository.note(published.id)); assertNotNull(repository.note(unsynced.id))
        assertTrue(store.dao.allNotes().any { repository.body(it.id)!!.endsWith("published text") })
        assertEquals(100L, store.number("notes_since"))
    }
    @Test fun restoredServerResetsPendingBodyBaseAndPreservesConfirmedLocalHistory() {
        val pending = confirmed("pending original"); save(pending.id, "offline")
        store.applyPage(page(remote(pending)), true)
        assertEquals(0L, repository.note(pending.id)!!.version); assertEquals("offline", repository.body(pending.id))
        val clean = confirmed("confirmed local"); store.applyPage(page(remote(clean)), true)
        store.applyBodies(listOf(BodyDto(clean.id, "backup remote", 2)), true)
        assertEquals("confirmed local", store.dao.history(clean.id).single().markdown)
    }
    @Test fun tombstoneKeepsPendingFullTextAndRemovesIdentityTasksAndHistoryTogether() {
        val note = confirmed(); save(note.id, "unsynced full text")
        store.tombstone(note.id)
        assertNull(repository.note(note.id)); assertTrue(store.dao.tasks().none { it.entityId == note.id })
        assertTrue(store.dao.history(note.id).isEmpty())
        assertTrue(store.dao.allNotes().any { repository.body(it.id)!!.endsWith("unsynced full text") })
    }
    @Test fun recoveryMarkersAndSentSnapshotSurviveRoomReopen() {
        database.close(); val path = File(directory, "notes.db")
        fun open() = Room.databaseBuilder(context, NotesDatabase::class.java, path.absolutePath).build()
        database = open(); repository = NotesRepository(database, "test", File(directory, "drafts")); store = SyncStore(repository)
        val note = repository.create("pending")
        val sent = store.prepare(store.dao.task("note", note.id, "create")!!)!!
        store.markRecovery("new-epoch")
        database.close(); database = open(); repository = NotesRepository(database, "test", File(directory, "drafts")); store = SyncStore(repository)
        assertEquals("1", store.meta("reconcile_notes")); assertEquals("1", store.meta("reconcile_books")); assertNull(store.meta("accepted_epoch"))
        assertEquals("new-epoch", store.meta("pending_epoch"))
        assertEquals(sent, syncJson.decodeFromString<SentTask>(store.meta("sent:${sent.id}")!!))
    }
    @Test fun groupCreationUsesPublicWireNames() {
        val group = repository.createGroup("group")
        val sent = store.prepare(store.dao.task("group", group.id, "create")!!)!!
        assertEquals(setOf("group_id", "name", "ord", "color", "hide_from_home"), sent.payload.keys)
        store.ack(sent, WriteAck(updateTime = 200)); assertFalse(store.dao.group(group.id)!!.dirty)
    }
    @Test fun permanentFailureRetainsTextAndExplicitRetryReactivatesTask() {
        val note = confirmed(); save(note.id, "full text")
        val sent = store.prepare(store.dao.task("note", note.id, "body")!!)!!
        store.fail(sent, ApiError(404, "not_found")); assertEquals(1, store.dao.taskById(sent.id)!!.failed)
        store.retry(false); assertEquals(1, store.dao.taskById(sent.id)!!.failed)
        store.retry(true); assertEquals(0, store.dao.taskById(sent.id)!!.failed); assertEquals("full text", repository.export(note.id))
    }
    @Test fun failedTaskCopyIsIdempotentAndOriginalFailedTextRemainsExportable() {
        val note = confirmed(); save(note.id, "recoverable failed text")
        val sent = store.prepare(store.dao.task("note", note.id, "body")!!)!!
        store.fail(sent, ApiError(404, "not_found"))
        val copy = repository.saveFailedAsCopy(sent.id)
        assertEquals(copy.id, repository.saveFailedAsCopy(sent.id).id)
        assertEquals("recoverable failed text", repository.body(copy.id)); assertEquals("recoverable failed text", repository.export(note.id))
        assertEquals(1, store.dao.taskById(sent.id)!!.failed); assertNotNull(store.dao.task("note", copy.id, "create"))
    }
    @Test fun missingBookDoesNotPurgeItsReferencedNotes() {
        val note = confirmed()
        store.dao.putBook(KnowledgeBaseEntity("book", "book")); store.dao.putToc(TocEntity("book", "ref", noteId = note.id, name = ""))
        store.finishBooks(setOf("book"), emptySet(), 9, "books-cp", true)
        assertTrue(store.dao.books().isEmpty()); assertTrue(store.dao.toc("book").isEmpty()); assertNotNull(repository.note(note.id))
    }
    @Test fun malformedAndCyclicDirectoryAreRejectedBeforeRoomWrite() {
        val book = BookDto("book", "book", "", "", 0, 0, 0, 1, 1, 100, 100, 1)
        val nodes = listOf(TocNodeDto("a", "b", "folder", 0, null, "a"), TocNodeDto("b", "a", "folder", 0, null, "b"))
        assertThrows(IllegalArgumentException::class.java) { store.applyBook(BookRemoteDto(book, TocDto("book", 1, nodes, 100), emptyMap())) }
        assertTrue(store.dao.books().isEmpty())
    }
}
