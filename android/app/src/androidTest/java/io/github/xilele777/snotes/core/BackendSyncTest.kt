package io.github.xilele777.snotes.core

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import io.github.xilele777.snotes.core.data.NotesRepository
import io.github.xilele777.snotes.core.database.NotesDatabase
import io.github.xilele777.snotes.core.editor.*
import io.github.xilele777.snotes.core.network.*
import io.github.xilele777.snotes.core.sync.*
import java.io.File
import java.util.UUID
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith

/** Opt-in only. Fixed loopback ports and a test token cannot target a production account. */
@RunWith(AndroidJUnit4::class)
class BackendSyncTest {
    @Test fun notebookMutationAndReplayContract() = runBlocking {
        val target = InstrumentationRegistry.getArguments().getString("m3Backend")
        Assume.assumeTrue(target == "node" || target == "worker")
        val context = ApplicationProvider.getApplicationContext<Context>()
        val database = Room.inMemoryDatabaseBuilder(context, NotesDatabase::class.java).build()
        val repository = NotesRepository(database, "book-backend", File(context.cacheDir, "book-backend-${UUID.randomUUID()}"))
        val store = SyncStore(repository); val books = io.github.xilele777.snotes.core.data.BookRepository(repository)
        val client = ApiClient(instanceOrigin("http://10.0.2.2:${if (target == "node") 18787 else 18788}", true), "android-m3-test-token")
        suspend fun sync() = SyncEngine(store, client).run()
        try {
            sync()
            val note = repository.create("Android notebook owned body")
            val book = books.create("First notebook", nodes = listOf(TocNodeDto(UUID.randomUUID().toString(), null, "note", 0, note.id, null)))
            sync(); assertEquals(note.id, client.call { toc(book) }.toc.nodes.single().noteId)
            assertTrue(store.dao.tasks().isEmpty())
            val base = books.remote(book)!!
            client.call { patchBook(book, store.meta("accepted_epoch")!!, buildJsonObject {
                put("operation_id", UUID.randomUUID().toString()); put("base_meta_version", base.book.metaVersion); put("name", "Web changed")
                put("description", ""); put("icon", ""); put("ord", 0); put("invalid", 0)
            }) }
            books.editMeta(book, "Android changed", "local draft"); sync()
            assertEquals(1, store.dao.task("book", book, "meta")!!.failed); assertEquals("Android changed", books.desired(book)!!.book.name)
            books.resolve(book, true); sync(); assertEquals("Android changed", client.call { toc(book) }.book.name)
            repository.setBookNoteTrash(note.id, book, true); sync(); assertEquals(1, repository.note(note.id)!!.invalid)
            repository.setBookNoteTrash(note.id, book, false); sync(); assertEquals(0, repository.note(note.id)!!.invalid)
            val replayBook = books.create("Before lost ACK")
            val sent = books.prepare(store.dao.task("book", replayBook, "create")!!)!!
            client.call { createBook(store.meta("accepted_epoch")!!, sent.payload) } // Accepted; deliberately omit local ACK.
            books.editMeta(replayBook, "After lost ACK", "successor")
            sync(); sync(); assertEquals("After lost ACK", client.call { toc(replayBook) }.book.name)
            books.deletePermanently(book, "Android changed"); sync()
            assertEquals(1, client.call { toc(book) }.book.deleted); assertNull(repository.note(note.id))
        } finally { client.close(); database.close() }
    }
    @Test fun realBackendContract() = runBlocking {
        val target = InstrumentationRegistry.getArguments().getString("m3Backend")
        Assume.assumeTrue(target == "node" || target == "worker")
        val origin = instanceOrigin("http://10.0.2.2:${if (target == "node") 18787 else 18788}", true)
        val token = "android-m3-test-token"
        val client = ApiClient(origin, token)
        val raw = OkHttpClient.Builder().followRedirects(false).build()
        val context = ApplicationProvider.getApplicationContext<Context>()
        val directory = File(context.cacheDir, "backend-sync-${UUID.randomUUID()}"); check(directory.mkdirs())
        val db = Room.inMemoryDatabaseBuilder(context, NotesDatabase::class.java).build()
        val repository = NotesRepository(db, "backend-test", File(directory, "drafts"))
        val store = SyncStore(repository)
        fun id() = UUID.randomUUID().toString()
        fun request(path: String, payload: JsonObject? = null, method: String = "POST", epoch: String? = store.meta("accepted_epoch")): JsonObject {
            val builder = Request.Builder().url(origin.resolve(path)!!).header("Authorization", "Bearer $token")
            epoch?.let { builder.header("X-Snotes-Epoch", it) }
            val body = payload?.toString()?.toRequestBody("application/json".toMediaType())
            val response = raw.newCall(builder.method(method, if (method == "GET") null else body ?: "{}".toRequestBody("application/json".toMediaType())).build()).execute()
            return response.use { assertEquals("$method $path", 200, it.code); syncJson.parseToJsonElement(it.body!!.string()).jsonObject }
        }
        fun save(noteId: String, markdown: String) {
            val snapshot = DraftSnapshot(SessionKey("backend-test", noteId, id()), 1, repository.body(noteId)!!, markdown)
            repository.stage(snapshot); repository.commit(snapshot); repository.clear(snapshot)
        }
        suspend fun sync() = SyncEngine(store, client).run()
        try {
            assertEquals(if (target == "node") "server" else "cloudflare", request("/api/runtime", method = "GET")["runtime"]!!.jsonPrimitive.content)
            val group = repository.createGroup("Android isolated group")
            val note = repository.create("initial", group.id); save(note.id, "offline final text")
            repository.updateProps(note.id, buildJsonObject { put("star", 1); put("top", 1) })
            sync()
            assertEquals("offline final text", client.call { bodies(BodiesRequest(listOf(note.id))) }.bodies.single().content)
            assertTrue(store.dao.tasks().isEmpty()); assertEquals(1, repository.note(note.id)!!.star)
            assertEquals(group.id, repository.note(note.id)!!.groupId)

            val baseline = repository.note(note.id)!!.version
            client.call { patch(note.id, store.meta("accepted_epoch")!!, buildJsonObject {
                put("content", "web concurrent text"); put("title", "web concurrent text"); put("summary", ""); put("thumbnail", JsonNull); put("base_version", baseline)
            }) }
            save(note.id, "android concurrent text"); sync()
            val copyTask = store.dao.tasks().single { it.kind == "create" }
            assertTrue(repository.body(copyTask.entityId)!!.endsWith("web concurrent text"))
            sync(); assertTrue(store.dao.tasks().isEmpty())
            assertEquals("android concurrent text", client.call { bodies(BodiesRequest(listOf(note.id))) }.bodies.single().content)

            repository.setTrash(note.id, true); sync(); assertEquals(1, repository.note(note.id)!!.invalid)
            repository.setTrash(note.id, false); sync(); assertEquals(0, repository.note(note.id)!!.invalid)

            // Multipart upload is a test setup action; Android's image read uses the actual Bearer client.
            val png = android.util.Base64.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6HJgAAAAASUVORK5CYII=", android.util.Base64.DEFAULT)
            val form = MultipartBody.Builder().setType(MultipartBody.FORM).addFormDataPart("note_id", note.id)
                .addFormDataPart("file", "pixel.png", png.toRequestBody("image/png".toMediaType())).build()
            val upload = raw.newCall(Request.Builder().url(origin.resolve("/api/images/upload")!!).header("Authorization", "Bearer $token")
                .header("X-Snotes-Epoch", store.meta("accepted_epoch")!!).post(form).build()).execute().use {
                assertEquals(200, it.code); syncJson.parseToJsonElement(it.body!!.string()).jsonObject
            }
            val fileKey = upload.getValue("file_key").jsonPrimitive.content
            assertArrayEquals(png, client.call { image(fileKey) }.use { it.bytes() })
            raw.newCall(Request.Builder().url(origin.resolve("/api/images/$fileKey")!!).build()).execute().use { assertEquals(401, it.code) }

            val reference = repository.create("missing published text"); sync()
            val bookId = id()
            val created = request("/api/knowledge-bases", buildJsonObject {
                put("id", bookId); put("operation_id", id()); put("name", "Test notebook"); put("description", ""); put("icon", ""); put("ord", 0); put("invalid", 0)
            })
            request("/api/knowledge-bases/$bookId/toc", buildJsonObject {
                put("operation_id", id()); put("base_toc_version", created.getValue("toc_version")); put("nodes", buildJsonArray {
                    add(buildJsonObject { put("id", id()); put("parent_id", JsonNull); put("kind", "note"); put("ord", 0); put("note_id", reference.id); put("title", JsonNull) })
                })
            }, "PUT")
            sync(); assertEquals(reference.id, store.dao.toc(bookId).single().noteId)
            assertEquals("available", syncJson.decodeFromString<BookRemoteDto>(store.meta("book:$bookId")!!).noteStates[reference.id])
            val oldEpoch = store.meta("accepted_epoch")

            // Change data at the old watermark without changing epoch: only checkpoint revision reveals the restore.
            save(note.id, "offline after same watermark restore")
            request("/__android-test/restore", buildJsonObject {
                put("id", note.id); put("missing_id", reference.id); put("book_id", bookId); put("change_epoch", false)
            })
            sync()
            assertEquals(oldEpoch, store.meta("accepted_epoch")); assertEquals("offline after same watermark restore", repository.body(note.id))
            assertNull(repository.note(reference.id)); assertTrue(store.dao.allNotes().any { repository.body(it.id)?.endsWith("missing published text") == true })
            assertTrue(store.dao.toc(bookId).isEmpty())

            // Repeat with an epoch change and a different missing identity; preflight must accept the new fence only after both inventories.
            sync()
            val missing = repository.create("missing after epoch change"); sync()
            save(note.id, "offline after epoch restore")
            request("/__android-test/restore", buildJsonObject {
                put("id", note.id); put("missing_id", missing.id); put("book_id", bookId); put("change_epoch", true)
            })
            sync(); assertNotEquals(oldEpoch, store.meta("accepted_epoch")); assertNull(store.meta("reconcile_notes")); assertNull(store.meta("reconcile_books"))
            assertEquals("offline after epoch restore", client.call { bodies(BodiesRequest(listOf(note.id))) }.bodies.single().content)
            assertNull(repository.note(missing.id)); assertTrue(store.dao.allNotes().any { repository.body(it.id)?.endsWith("missing after epoch change") == true })
        } finally {
            client.close(); raw.connectionPool.evictAll(); raw.dispatcher.executorService.shutdown()
            db.close(); check(directory.canonicalPath.startsWith(context.cacheDir.canonicalPath + File.separator)); directory.deleteRecursively()
        }
    }
}
