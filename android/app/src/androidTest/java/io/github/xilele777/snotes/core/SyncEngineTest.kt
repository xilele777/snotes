package io.github.xilele777.snotes.core

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.xilele777.snotes.core.data.NotesRepository
import io.github.xilele777.snotes.core.database.*
import io.github.xilele777.snotes.core.editor.*
import io.github.xilele777.snotes.core.network.*
import io.github.xilele777.snotes.core.sync.*
import java.io.File
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import okhttp3.mockwebserver.*
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SyncEngineTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private lateinit var database: NotesDatabase
    private lateinit var repository: NotesRepository
    private lateinit var store: SyncStore
    private lateinit var directory: File
    private lateinit var server: MockWebServer
    private lateinit var remote: SyncTestBackend
    private lateinit var client: ApiClient
    @Before fun setup() {
        directory = File(context.cacheDir, "sync-engine-${UUID.randomUUID()}"); check(directory.mkdirs())
        database = Room.inMemoryDatabaseBuilder(context, NotesDatabase::class.java).build()
        repository = NotesRepository(database, "test", File(directory, "drafts")); store = SyncStore(repository)
        remote = SyncTestBackend(); server = MockWebServer(); server.dispatcher = remote; server.start()
        client = ApiClient(server.url("/"), "test-token", timeoutMillis = 3000)
    }
    @After fun cleanup() { client.close(); server.shutdown(); database.close(); check(directory.canonicalPath.startsWith(context.cacheDir.canonicalPath + File.separator)); directory.deleteRecursively() }
    private suspend fun sync() = SyncEngine(store, client).run()
    private fun save(id: String, text: String) {
        val snapshot = DraftSnapshot(SessionKey("test", id, UUID.randomUUID().toString()), 1, repository.body(id)!!, text)
        repository.stage(snapshot); repository.commit(snapshot); repository.clear(snapshot)
    }
    private fun failure(block: suspend () -> Unit) = runBlocking { try { block(); error("expected error") } catch (error: ApiError) { error } }

    @Test fun offlineCreateEditGroupAndPropsRespectBothPreflightsAndCausalOrder() = runBlocking {
        val group = repository.createGroup("中文分组")
        val note = repository.create("first", group.id); save(note.id, "second")
        repository.updateProps(note.id, buildJsonObject { put("star", 1) })
        repository.updateProps(note.id, buildJsonObject { put("top", 1) })
        sync()
        assertEquals("second", remote.content(note.id)); assertEquals(1, remote.record(note.id)["star"]!!.jsonPrimitive.int)
        assertEquals(1, repository.note(note.id)!!.top); assertEquals("none", repository.note(note.id)!!.dirty)
        assertTrue(store.dao.tasks().isEmpty())
        val paths = remote.paths.toList()
        assertTrue(paths.indexOf("/api/groups") < paths.indexOf("/api/notes"))
        assertTrue(paths.indexOf("/api/knowledge-bases/sync/checkpoint") < paths.indexOf("/api/notes"))
        assertTrue(paths.indexOf("/api/knowledge-bases/sync/pull") < paths.indexOf("/api/notes"))
        assertEquals("epoch-1", store.meta("accepted_epoch"))
        assertTrue(remote.mutationEpochs.all { it == "epoch-1" })
    }
    @Test fun missingBodyStopsCursorAndRecoveryCompletionBeforeAnyUpload() = runBlocking {
        remote.add("remote-note", "remote text"); remote.omitBodies = true
        repository.create("offline")
        assertEquals("missing_bodies", failure { sync() }.code)
        assertEquals(0L, store.number("notes_since")); assertEquals("1", store.meta("reconcile_notes")); assertNull(store.meta("accepted_epoch"))
        assertFalse(remote.paths.contains("/api/notes")); assertNull(repository.body("remote-note"))
        remote.omitBodies = false; sync()
        assertEquals("remote text", repository.body("remote-note")); assertTrue(store.dao.tasks().isEmpty())
    }
    @Test fun invalidInventoryWatermarkCannotInferMissingOrUpload() = runBlocking {
        val note = repository.create("confirmed local"); store.ack(store.prepare(store.dao.task("note", note.id, "create")!!)!!, WriteAck(1, 1, 100))
        repository.create("offline new")
        remote.rejectCurrentNotes = true
        assertEquals(409, failure { sync() }.status)
        assertEquals("confirmed local", repository.body(note.id)); assertFalse(remote.paths.contains("/api/notes"))
        assertEquals("1", store.meta("reconcile_books"))
    }
    @Test fun failureInBookPreflightCannotAdmitEpochOrPushOldQueue() = runBlocking {
        repository.create("offline")
        remote.hook = { request -> if (request.path == "/api/knowledge-bases/sync/checkpoint") reply("{}", 500) else null }
        assertEquals(500, failure { sync() }.status)
        assertNull(store.meta("accepted_epoch")); assertEquals(1, store.dao.tasks().size)
        assertFalse(remote.paths.contains("/api/notes"))
    }
    @Test fun resetDuringUploadPreservesTasksAndRestoresBothDurableMarkers() = runBlocking {
        val note = repository.create("offline")
        remote.hook = { request -> if (request.path == "/api/notes") reply("""{"error":"sync_reset_required"}""", 409) else null }
        assertEquals(409, failure { sync() }.status)
        assertNotNull(store.dao.task("note", note.id, "create")); assertEquals("1", store.meta("reconcile_notes")); assertEquals("1", store.meta("reconcile_books"))
        assertNull(store.meta("accepted_epoch"))
    }
    @Test fun authFailureStopsDispatchAndPreservesOfflineWork() = runBlocking {
        repeat(8) { repository.create("offline $it") }
        remote.hook = { request -> if (request.path == "/api/notes") reply("{}", 401) else null }
        assertEquals(401, failure { sync() }.status)
        assertEquals(8, store.dao.tasks().size); assertTrue(remote.paths.count { it == "/api/notes" } <= 3)
        assertTrue(store.dao.tasks().all { it.failed == 0 && it.retry == 0 })
        assertEquals("1", store.meta("requires_auth"))
        val count = remote.paths.size; assertEquals(401, failure { sync() }.status); assertEquals(count, remote.paths.size)
    }
    @Test fun lostCreateResponseRetriesSameIdAndDownloadsOtherDeviceChanges() = runBlocking {
        val note = repository.create("original")
        var dropped = false
        remote.hook = { request ->
            if (request.path == "/api/notes" && !dropped) {
                dropped = true; remote.add(note.id, "remote after accepted creation", 3)
                MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST)
            } else null
        }
        assertEquals(0, failure { sync() }.status)
        assertNotNull(store.meta("sent:${store.dao.task("note", note.id, "create")!!.id}"))
        store.retry(true); sync()
        assertEquals("remote after accepted creation", repository.body(note.id)); assertTrue(store.dao.tasks().isEmpty())
        assertEquals(1, remote.count())
    }
    @Test fun responseAcceptedBeforeAckFailureCanReplayWithoutLosingLocalSource() = runBlocking {
        val note = repository.create("original")
        database.openHelper.writableDatabase.execSQL("CREATE TRIGGER fail_consume BEFORE DELETE ON outbox BEGIN SELECT RAISE(ABORT, 'ack failure'); END")
        try { sync(); fail("expected ACK failure") } catch (_: Exception) { }
        assertEquals("original", remote.content(note.id)); assertNotNull(store.dao.task("note", note.id, "create"))
        database.openHelper.writableDatabase.execSQL("DROP TRIGGER fail_consume")
        sync(); assertEquals("original", repository.body(note.id)); assertTrue(store.dao.tasks().isEmpty())
    }
    @Test fun body404And413RemainFailedAndExportable() = runBlocking {
        val note = repository.create("original"); sync(); save(note.id, "local after server refusal")
        remote.hook = { request -> if (request.path == "/api/notes/${note.id}") reply("{}", 404) else null }
        sync(); val task = store.dao.task("note", note.id, "body")!!
        assertEquals(1, task.failed); assertEquals("local after server refusal", repository.export(note.id))
        store.retry(true)
        remote.hook = { request -> if (request.path == "/api/notes/${note.id}") reply("{}", 413) else null }
        sync(); assertEquals(1, store.dao.taskById(task.id)!!.failed)
        assertEquals("local after server refusal", repository.body(note.id))
    }
    @Test fun explicit410CreatesRecoveryCopyBeforeCleaningOldIdentity() = runBlocking {
        val note = repository.create("original"); sync(); save(note.id, "pending full text")
        remote.hook = { request -> if (request.path == "/api/notes/${note.id}") {
            remote.remove(note.id); reply("""{"error":"permanently_deleted"}""", 410)
        } else null }
        sync(); assertNull(repository.note(note.id))
        assertTrue(store.dao.allNotes().any { repository.body(it.id)!!.endsWith("pending full text") })
    }
    @Test fun twoDeviceBodyConflictProducesPendingRecoverableCopy() = runBlocking {
        val note = repository.create("original"); sync()
        remote.add(note.id, "web edit", 2); save(note.id, "android edit")
        sync(); assertEquals("android edit", remote.content(note.id))
        val copy = store.dao.allNotes().single { it.id != note.id }
        assertTrue(repository.body(copy.id)!!.endsWith("web edit")); assertNotNull(store.dao.task("note", copy.id, "create"))
    }
    @Test fun callerCancellationKeepsSingleRoundAliveAndStopWaitsForInFlightAck() = runBlocking {
        val note = repository.create("offline")
        val entered = CountDownLatch(1); val release = CountDownLatch(1)
        remote.hook = { request -> if (request.path == "/api/notes") { entered.countDown(); check(release.await(3, TimeUnit.SECONDS)); null } else null }
        val connectionStore = ConnectionStore("test", directory)
        connectionStore.write(Connection(server.url("/").toString(), "test-token")); store.put("instance_origin", server.url("/").toString())
        val coordinator = SyncCoordinator(repository, connectionStore, io.github.xilele777.snotes.core.database.LocalProfile(context), context)
        val first = launch { coordinator.synchronize() }
        assertTrue(withContext(Dispatchers.IO) { entered.await(3, TimeUnit.SECONDS) })
        val second = async { coordinator.synchronize() }
        first.cancelAndJoin()
        val stop = async { coordinator.stopAndJoin() }
        delay(50); assertFalse(stop.isCompleted); assertFalse(second.isCompleted)
        release.countDown(); stop.await(); second.await()
        assertEquals(1, remote.paths.count { it == "/api/notes" }); assertNull(store.dao.task("note", note.id, "create"))
        assertFalse(coordinator.status.value.running)
    }
    @Test fun editDuringBodyRequestSurvivesOldAckAndNextRoundUsesNewBaseline() = runBlocking {
        val note = repository.create("original"); sync(); save(note.id, "first local edit")
        val entered = CountDownLatch(1); val release = CountDownLatch(1)
        remote.hook = { request -> if (request.path == "/api/notes/${note.id}") { entered.countDown(); check(release.await(3, TimeUnit.SECONDS)); null } else null }
        val round = async(Dispatchers.IO) { sync() }
        assertTrue(withContext(Dispatchers.IO) { entered.await(3, TimeUnit.SECONDS) })
        save(note.id, "second local edit"); release.countDown(); round.await()
        assertEquals("second local edit", repository.body(note.id)); assertNotNull(store.dao.task("note", note.id, "body"))
        remote.hook = null; sync(); assertEquals("second local edit", remote.content(note.id)); assertTrue(store.dao.tasks().isEmpty())
        assertEquals(1, store.dao.allNotes().size)
    }
    @Test fun ordinaryPaginationKeepsOriginalSinceAndOpaqueCursor() = runBlocking {
        remote.add("remote-a", "A"); remote.add("remote-b", "B")
        val pulls = mutableListOf<JsonObject>()
        remote.hook = { request ->
            if (request.path == "/api/sync/pull") {
                val body = syncJson.parseToJsonElement(request.body.clone().readUtf8()).jsonObject
                pulls += body
                val first = body["cursor"] == JsonNull
                reply(buildJsonObject {
                    put("notes", buildJsonArray { add(remote.record(if (first) "remote-a" else "remote-b")) })
                    put("groups", buildJsonArray {}); put("server_time", 102); put("checkpoint", "page-cp")
                    put("next_cursor", if (first) JsonPrimitive("opaque-next-page") else JsonNull)
                }.toString())
            } else null
        }
        sync()
        assertEquals("A", repository.body("remote-a")); assertEquals("B", repository.body("remote-b"))
        assertEquals(listOf(0L, 0L, 102L, 102L), pulls.map { it.getValue("since").jsonPrimitive.long })
        assertEquals(JsonPrimitive("opaque-next-page"), pulls[1]["cursor"]); assertEquals(102L, store.number("notes_since"))
    }
    @Test fun notebookInventoryUsesNextIdEvenWhenNextAfterHasDifferentEndCondition() = runBlocking {
        val requests = mutableListOf<JsonObject>()
        fun book(id: String) = BookDto(id, id, "", "", 0, 0, 0, 1, 0, 100, 100, 1)
        remote.hook = { request -> when {
            request.path == "/api/knowledge-bases/sync/pull" -> {
                val body = syncJson.parseToJsonElement(request.body.clone().readUtf8()).jsonObject; requests += body
                val inventory = body.getValue("inventory").jsonPrimitive.boolean
                val first = "after_id" !in body
                val books = if (inventory) listOf(book(if (first) "book-a" else "book-b")) else emptyList()
                reply(syncJson.encodeToString(BooksDto.serializer(), BooksDto(books, 2, if (inventory && !first) 99 else null, if (inventory && first) "book-a" else null, "book-cp")))
            }
            request.path?.startsWith("/api/knowledge-bases/book-") == true -> {
                val id = request.path!!.removePrefix("/api/knowledge-bases/").removeSuffix("/toc")
                reply(syncJson.encodeToString(BookRemoteDto.serializer(), BookRemoteDto(book(id), TocDto(id, 0, emptyList(), 100), emptyMap())))
            }
            else -> null
        } }
        sync(); assertEquals(setOf("book-a", "book-b"), store.dao.books().map { it.id }.toSet())
        assertEquals(JsonPrimitive("book-a"), requests[1]["after_id"]); assertEquals(2L, store.number("books_since"))
    }
    @Test fun independentUploadsCompleteOutOfOrderWithAtMostThreeChains() = runBlocking {
        repeat(8) { repository.create("offline $it") }
        val active = java.util.concurrent.atomic.AtomicInteger(); val maximum = java.util.concurrent.atomic.AtomicInteger()
        remote.hook = { request -> if (request.path == "/api/notes") {
            val count = active.incrementAndGet(); maximum.updateAndGet { maxOf(it, count) }
            Thread.sleep(if (count == 1) 80 else 20); active.decrementAndGet(); null
        } else null }
        sync(); assertTrue(maximum.get() in 2..3); assertEquals(8, remote.count()); assertTrue(store.dao.tasks().isEmpty())
    }
    @Test fun restoreAfterNotesInventoryDuringBookReadIsCaughtBeforeUpload() = runBlocking {
        repository.create("offline")
        remote.hook = { request ->
            if (request.path == "/api/knowledge-bases/sync/pull") { remote.rejectAllNotesCheckpoints = true; null } else null
        }
        assertEquals(409, failure { sync() }.status)
        assertFalse(remote.paths.contains("/api/notes")); assertNull(store.meta("accepted_epoch"))
        assertEquals("1", store.meta("reconcile_notes")); assertEquals("1", store.meta("reconcile_books"))
    }
    @Test fun rateLimitPausesProfileAndKeepsEveryTask() = runBlocking {
        client.close(); var pause = 0L
        client = ApiClient(server.url("/"), "test-token", readPause = { pause }, persistPause = { pause = it })
        repeat(8) { repository.create("offline $it") }
        remote.hook = { request -> if (request.path == "/api/notes") reply("{}", 429).setHeader("Retry-After", "60") else null }
        assertEquals(429, failure { sync() }.status); assertEquals(8, store.dao.tasks().size)
        assertTrue(pause > System.currentTimeMillis()); assertTrue(remote.paths.count { it == "/api/notes" } <= 3)
    }
}

private fun reply(body: String, code: Int = 200) = MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

private class SyncTestBackend : Dispatcher() {
    val paths = java.util.Collections.synchronizedList(mutableListOf<String>())
    val mutationEpochs = java.util.Collections.synchronizedList(mutableListOf<String?>())
    @Volatile var hook: ((RecordedRequest) -> MockResponse?)? = null
    @Volatile var omitBodies = false
    @Volatile var rejectCurrentNotes = false
    @Volatile var rejectAllNotesCheckpoints = false
    private val notes = linkedMapOf<String, JsonObject>()
    private val contents = linkedMapOf<String, String>()
    private val groups = linkedMapOf<String, JsonObject>()
    private var watermark = 100L
    @Synchronized fun add(id: String, content: String, version: Long = 1) {
        notes[id] = buildJsonObject {
            put("id", id); put("title", content); put("summary", ""); put("group_id", JsonNull); put("thumbnail", JsonNull)
            put("skin_color", JsonNull); put("home_hidden", JsonNull); put("star", 0); put("top", 0); put("invalid", 0)
            put("version", version); put("prop_version", 1); put("create_time", 100); put("update_time", ++watermark)
        }; contents[id] = content
    }
    @Synchronized fun content(id: String) = contents[id]
    @Synchronized fun record(id: String) = notes.getValue(id)
    @Synchronized fun count() = notes.size
    @Synchronized fun remove(id: String) { notes.remove(id); contents.remove(id) }
    override fun dispatch(request: RecordedRequest): MockResponse {
        val path = request.path!!; paths += path
        hook?.invoke(request)?.let { return it }
        return synchronized(this) {
            val body = if (request.body.size > 0) syncJson.parseToJsonElement(request.body.readUtf8()).jsonObject else buildJsonObject {}
            when {
                path == "/api/sync/instance" -> reply("""{"epoch":"epoch-1"}""")
                path.endsWith("/sync/checkpoint") -> reply("""{"valid":${!(path == "/api/sync/checkpoint" && (rejectAllNotesCheckpoints || rejectCurrentNotes && body["require_current"]?.jsonPrimitive?.boolean == true))}}""")
                path == "/api/sync/pull" -> reply(buildJsonObject {
                    put("notes", JsonArray(notes.values.toList())); put("groups", JsonArray(groups.values.toList()))
                    put("server_time", watermark); put("next_cursor", JsonNull); put("checkpoint", "notes-cp")
                }.toString())
                path == "/api/knowledge-bases/sync/pull" -> reply("""{"books":[],"until":1,"next_after":null,"next_id":null,"checkpoint":"books-cp"}""")
                path == "/api/sync/bodies" -> reply(buildJsonObject { put("bodies", JsonArray(if (omitBodies) emptyList() else body.getValue("ids").jsonArray.mapNotNull { raw ->
                    val id = raw.jsonPrimitive.content; notes[id]?.let { note -> buildJsonObject { put("note_id", id); put("content", contents.getValue(id)); put("version", note.getValue("version")) } }
                })) }.toString())
                path == "/api/groups" -> {
                    mutationEpochs += request.getHeader("X-Snotes-Epoch")
                    groups[body.getValue("group_id").jsonPrimitive.content] = JsonObject(body + mapOf("invalid" to JsonPrimitive(0), "update_time" to JsonPrimitive(++watermark)))
                    reply("""{"update_time":$watermark}""")
                }
                path == "/api/notes" -> {
                    mutationEpochs += request.getHeader("X-Snotes-Epoch")
                    val id = body.getValue("id").jsonPrimitive.content; val replay = id in notes
                    if (!replay) {
                        add(id, body.getValue("content").jsonPrimitive.content)
                        notes[id] = JsonObject(notes.getValue(id) + body.filterKeys { it in setOf("group_id", "star", "top", "home_hidden", "skin_color", "title", "summary", "thumbnail") })
                    }
                    ack(id, replay)
                }
                path.startsWith("/api/notes/") && request.method == "PATCH" -> {
                    mutationEpochs += request.getHeader("X-Snotes-Epoch")
                    val id = path.removePrefix("/api/notes/"); val current = notes[id] ?: return@synchronized reply("{}", 404)
                    val hasBody = "content" in body; val conflicted = hasBody && body["base_version"] != current["version"]
                    val previous = contents[id]
                    if (hasBody) contents[id] = body.getValue("content").jsonPrimitive.content
                    notes[id] = JsonObject(current + body.filterKeys { it in setOf("star", "top", "group_id", "title", "summary", "thumbnail", "skin_color", "home_hidden") } + mapOf(
                        "version" to JsonPrimitive(current.getValue("version").jsonPrimitive.long + if (hasBody) 1 else 0),
                        "prop_version" to JsonPrimitive(current.getValue("prop_version").jsonPrimitive.long + if (hasBody) 0 else 1), "update_time" to JsonPrimitive(++watermark)))
                    val ack = ackJson(id, false)
                    reply(JsonObject(ack + mapOf("conflicted" to JsonPrimitive(conflicted)) + if (conflicted) mapOf("previous_content" to JsonPrimitive(previous)) else emptyMap()).toString())
                }
                else -> reply("{}", 404)
            }
        }
    }
    private fun ack(id: String, replay: Boolean): MockResponse = reply(ackJson(id, replay).toString())
    private fun ackJson(id: String, replay: Boolean): JsonObject = buildJsonObject {
        val note = notes.getValue(id); put("version", note.getValue("version")); put("prop_version", note.getValue("prop_version"))
        put("update_time", note.getValue("update_time")); put("replayed", replay)
    }
}
