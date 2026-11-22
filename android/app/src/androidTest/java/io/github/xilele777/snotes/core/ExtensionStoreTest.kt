package io.github.xilele777.snotes.core

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.xilele777.snotes.core.data.*
import io.github.xilele777.snotes.core.database.*
import io.github.xilele777.snotes.core.editor.*
import io.github.xilele777.snotes.core.network.*
import io.github.xilele777.snotes.core.sync.*
import java.io.File
import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import okhttp3.mockwebserver.*
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class) class ExtensionStoreTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private lateinit var database: NotesDatabase; private lateinit var notes: NotesRepository; private lateinit var books: BookRepository
    @Before fun setup() { database = Room.inMemoryDatabaseBuilder(context, NotesDatabase::class.java).build(); notes = NotesRepository(database, "extension", File(context.cacheDir, "extension-${UUID.randomUUID()}")); books = BookRepository(notes) }
    @After fun cleanup() { database.close() }
    private fun remote(id: String, name: String = "remote", version: Long = 1, nodes: List<TocNodeDto> = emptyList()) = BookRemoteDto(BookDto(id, name, "", "", 0, 0, 0, version, version, 10, 10, 1), TocDto(id, version, nodes, 10), nodes.mapNotNull { it.noteId }.associateWith { "available" })
    private fun task(id: String, kind: String) = database.notes().task("book", id, kind)!!

    @Test fun sentMetadataSurvivesRestartAndNewEditsDoNotChangeOperation() {
        val id = books.create("first"); val sent = books.prepare(task(id, "create"))!!
        books.editMeta(id, "second", "new description")
        val restarted = BookRepository(notes); val replay = restarted.prepare(task(id, "create"))!!
        assertEquals(sent, replay)
        restarted.acknowledge(replay, BookAckDto(1, 0, 20))
        assertEquals("second", restarted.desired(id)!!.book.name)
        val successor = restarted.prepare(task(id, "meta"))!!
        assertEquals("second", successor.payload.getValue("name").jsonPrimitive.content)
        assertEquals(1, successor.payload.getValue("base_meta_version").jsonPrimitive.int)
        assertNotEquals(sent.payload["operation_id"], successor.payload["operation_id"])
    }
    @Test fun tocAckPreservesSuccessorAndMetadataTrack() {
        books.acceptRemote(remote("book")); books.editToc("book", listOf(TocNodeDto("folder", null, "folder", 0, null, "A")))
        val sent = books.prepare(task("book", "toc"))!!
        books.editToc("book", listOf(TocNodeDto("folder", null, "folder", 0, null, "B")))
        books.acknowledge(sent, BookAckDto(99, 2, 30))
        assertEquals(1L, books.remote("book")!!.book.metaVersion)
        assertEquals("A", books.remote("book")!!.toc.nodes.single().title)
        assertEquals("B", books.desired("book")!!.toc.nodes.single().title)
        assertEquals(2L, books.prepare(task("book", "toc"))!!.payload.getValue("base_toc_version").jsonPrimitive.long)
    }
    @Test fun pullCannotAcknowledgePendingMetadataAndConflictResolutionIsExplicit() {
        books.acceptRemote(remote("book")); books.editMeta("book", "local", "")
        val sent = books.prepare(task("book", "meta"))!!
        books.acceptRemote(remote("book", "other", 2))
        assertEquals("local", books.desired("book")!!.book.name)
        assertEquals(1L, books.prepare(task("book", "meta"))!!.payload.getValue("base_meta_version").jsonPrimitive.long)
        books.fail(sent, ApiError(409, "http_error"), remote("book", "other", 2)); assertEquals(1, task("book", "meta").failed)
        books.resolve("book", true)
        assertEquals(2L, books.prepare(task("book", "meta"))!!.payload.getValue("base_meta_version").jsonPrimitive.long)
        assertTrue(database.notes().metas("book_history:book:").isNotEmpty())
    }
    @Test fun referenceOwnershipCyclesAndUnsavedPermanentDeleteAreRejected() {
        val note = notes.create("content"); val node = TocNodeDto("ref", null, "note", 0, note.id, null)
        books.create("One", "one", listOf(node)); books.create("Two", "two")
        assertThrows(IllegalStateException::class.java) { books.editToc("two", listOf(node.copy(id = "other"))) }
        assertFalse(notes.canChangeStructure(note.id))
        assertThrows(IllegalArgumentException::class.java) { books.editToc("two", listOf(TocNodeDto("loop", "loop", "folder", 0, null, "Cycle"))) }
        assertThrows(IllegalStateException::class.java) { books.deletePermanently("one", "One") }
    }
    @Test fun archiveImportTransactionRollsBackEarlierNotesOnLaterFailure() {
        val id = UUID.randomUUID().toString()
        assertThrows(IllegalArgumentException::class.java) { notes.syncTransaction {
            notes.importNote(id, "good", null, 10, buildJsonObject { put("star", 1) }, false)
            notes.importNote(UUID.randomUUID().toString(), "x".repeat(1_048_577), null, 10, buildJsonObject {}, false)
        } }
        assertNull(notes.note(id)); assertTrue(database.notes().tasks().isEmpty())
    }
    @Test fun creatingBookNotesUsesExplicitParentAndRollsBackIfDirectoryWriteFails() {
        val id = books.create("创建语境")
        books.editToc(id, listOf(TocNodeDto("chapter", null, "folder", 0, null, "章节")))
        val rootNote = books.createNote(id)
        val chapterNote = books.createNote(id, "chapter")
        val nodes = books.desired(id)!!.toc.nodes
        assertNull(nodes.single { it.noteId == rootNote }.parentId)
        assertEquals("chapter", nodes.single { it.noteId == chapterNote }.parentId)
        assertFalse(notes.canChangeStructure(chapterNote))
        val beforeNotes = database.notes().allNotes(); val beforeTasks = database.notes().tasks()
        database.openHelper.writableDatabase.execSQL("CREATE TRIGGER fail_directory BEFORE INSERT ON tocs BEGIN SELECT RAISE(ABORT, 'injected directory failure'); END")
        assertThrows(Exception::class.java) { books.createNote(id, "chapter") }
        assertEquals(beforeNotes, database.notes().allNotes())
        assertEquals(beforeTasks, database.notes().tasks())
        assertEquals(nodes, books.desired(id)!!.toc.nodes)
    }
    @Test fun opensUsesIndependentExactValueAckAndWantQuery() = runBlocking {
        val note = notes.create("untouched"); val before = notes.note(note.id)!!; val opens = Opens(notes); opens.record(note.id)
        MockWebServer().use { server ->
            server.dispatcher = object : Dispatcher() { override fun dispatch(request: RecordedRequest): MockResponse {
                val body = syncJson.parseToJsonElement(request.body.readUtf8()).jsonObject
                assertEquals(JsonPrimitive(note.id), body.getValue("want").jsonArray.single())
                notes.syncTransaction { database.notes().putMeta(SyncMetaEntity("open_dirty:${note.id}", syncJson.encodeToString(OpenItem(note.id, 2, 200)))) }
                return MockResponse().setHeader("Content-Type", "application/json").setBody(syncJson.encodeToString(OpenResponse(listOf(OpenAggregate(note.id, 5, 100)), 100)))
            } }
            server.start(); val client = ApiClient(server.url("/"), "test")
            try { opens.sync(client, "test-epoch") } finally { client.close() }
        }
        assertEquals(before, notes.note(note.id)); assertNotNull(database.notes().meta("open_dirty:${note.id}")); assertNull(database.notes().meta("open_unknown:${note.id}")); assertEquals(6L, opens.count(note.id))
    }
    @Test fun profilesKeepOldTasksAndRejectOldSessionAndActiveEditorSwitch() {
        val profile = LocalProfile(context); val original = profile.paths.id; val first = UUID.randomUUID().toString(); val second = UUID.randomUUID().toString()
        profile.switchTo(first); val repository = NotesRepository(profile)
        try {
            val note = repository.create("old private data"); repository.pinEditor(note.id)
            assertThrows(IllegalStateException::class.java) { repository.switchProfile(second) }; repository.unpinEditor(note.id)
            repository.switchProfile(second); assertNull(repository.note(note.id)); assertTrue(repository.database.notes().tasks().isEmpty())
            assertThrows(IllegalArgumentException::class.java) { repository.stage(DraftSnapshot(SessionKey(first, note.id, "session"), 1, "old private data", "late write")) }
            repository.switchProfile(first); assertEquals("old private data", repository.body(note.id)); assertNotNull(repository.database.notes().task("note", note.id, "create"))
        } finally { SyncWork.cancel(context, first).result.get(); SyncWork.cancel(context, second).result.get(); profile.switchTo(original); profile.releaseRetired() }
    }
}
