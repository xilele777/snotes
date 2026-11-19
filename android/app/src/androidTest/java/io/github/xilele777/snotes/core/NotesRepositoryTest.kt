package io.github.xilele777.snotes.core

import android.content.Context
import androidx.paging.PagingSource
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.xilele777.snotes.core.data.*
import io.github.xilele777.snotes.core.database.*
import io.github.xilele777.snotes.core.editor.*
import java.io.File
import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NotesRepositoryTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private lateinit var database: NotesDatabase
    private lateinit var repository: NotesRepository
    private lateinit var directory: File
    private var now = 1_000_000L
    @Before fun setup() {
        directory = File(context.cacheDir, "room-test-${UUID.randomUUID()}")
        check(directory.mkdirs())
        database = Room.inMemoryDatabaseBuilder(context, NotesDatabase::class.java).build()
        repository = NotesRepository(database, "test", File(directory, "drafts")) { now }
    }
    @After fun cleanup() {
        database.close()
        check(directory.canonicalPath.startsWith(context.cacheDir.canonicalPath + File.separator))
        directory.deleteRecursively()
    }
    private fun snapshot(id: String, body: String, baseline: String = "旧正文", revision: Long = 1, session: String = "session") =
        DraftSnapshot(SessionKey("test", id, session), revision, baseline, body)
    private fun save(draft: DraftSnapshot) { repository.stage(draft); repository.commit(draft); repository.clear(draft) }
    private fun failOutbox() = database.openHelper.writableDatabase.execSQL("CREATE TRIGGER fail_outbox BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT, 'injected disk failure'); END")
    private fun removeFailure() = database.openHelper.writableDatabase.execSQL("DROP TRIGGER fail_outbox")

    @Test fun bodyDerivedHistoryTaskAndReceiptCommitTogetherWithoutInventingRemoteVersions() {
        val note = repository.create("旧正文")
        save(snapshot(note.id, "# 中文标题\n\n摘要🙂"))
        val updated = repository.note(note.id)!!
        assertEquals("中文标题", updated.title); assertEquals("摘要🙂", updated.summary)
        assertEquals(0L, updated.version); assertEquals(0L, updated.bodyVersion); assertEquals(0L, updated.propVersion)
        assertEquals("旧正文", database.notes().history(note.id).single().markdown)
        val task = database.notes().task("note", note.id, "body")!!
        assertEquals(repository.body(note.id), Json.parseToJsonElement(task.payload).jsonObject["content"]!!.jsonPrimitive.content)
        assertEquals(1L, database.notes().receipt(note.id, "session"))
        assertTrue(database.notes().drafts().isEmpty())
    }
    @Test fun propTasksAccumulateOnlyChangedFieldsAndResetRetry() {
        val note = repository.create()
        repository.updateProps(note.id, buildJsonObject { put("star", 1) })
        val first = database.notes().task("note", note.id, "prop")!!
        database.notes().putTask(first.copy(retry = 4, failed = 1, nextAt = 900, lastError = "old error"))
        repository.updateProps(note.id, buildJsonObject { put("top", 1); put("home_hidden", JsonNull) })
        val next = database.notes().task("note", note.id, "prop")!!
        assertEquals(first.id, next.id); assertEquals(first.seq + 1, next.seq)
        assertEquals(0, next.retry); assertEquals(0, next.failed); assertEquals(0L, next.nextAt); assertNull(next.lastError)
        val payload = Json.parseToJsonElement(next.payload).jsonObject
        assertEquals(setOf("star", "top", "home_hidden", "base_prop_version"), payload.keys)
        assertEquals(JsonPrimitive(1), payload["star"]); assertEquals(JsonNull, payload["home_hidden"])
    }
    @Test fun deleteRecoverDeleteKeepsLastIntentAtEndOfEntityChain() {
        val note = repository.create()
        repository.setTrash(note.id, true)
        val firstId = database.notes().task("note", note.id, "trash")!!.id
        repository.setTrash(note.id, false)
        assertNull(database.notes().task("note", note.id, "trash"))
        repository.setTrash(note.id, true)
        assertNull(database.notes().task("note", note.id, "recover"))
        assertTrue(database.notes().task("note", note.id, "trash")!!.id > firstId)
        assertEquals(1, repository.note(note.id)!!.invalid)
        repository.setTrash(note.id, false)
        assertEquals(0, repository.note(note.id)!!.invalid)
    }
    @Test fun emptyBodyIsPresentAndMissingBodyCannotBeOverwritten() {
        val empty = repository.create()
        assertEquals("", repository.export(empty.id))
        val missing = NoteEntity("missing", createTime = now, updateTime = now)
        database.notes().putNote(missing)
        assertNull(repository.body(missing.id))
        assertThrows(IllegalStateException::class.java) { save(snapshot(missing.id, "误覆盖", "")) }
        assertNull(repository.body(missing.id)); assertNull(database.notes().receipt(missing.id, "session"))
    }
    @Test fun failedOutboxInsertionRollsBackBodyMetadataHistoryAndReceiptButKeepsDraft() {
        val note = repository.create("旧正文")
        val draft = snapshot(note.id, "# 新标题\n\n新内容")
        repository.stage(draft); failOutbox()
        assertThrows(Exception::class.java) { repository.commit(draft) }
        assertEquals("旧正文", repository.body(note.id)); assertEquals("旧正文", repository.note(note.id)!!.title)
        assertTrue(database.notes().history(note.id).isEmpty()); assertNull(database.notes().receipt(note.id, "session"))
        assertEquals(draft.markdown, database.notes().drafts().single().markdown)
        assertEquals(draft, DraftJournal(File(directory, "drafts")).read(DraftJournal(File(directory, "drafts")).files().single()))
        removeFailure(); assertEquals(1, repository.recover().recovered); assertEquals(draft.markdown, repository.body(note.id))
    }
    @Test fun saveSessionReportsFailureAndRecoveryCanReadJournal() = runBlocking {
        val note = repository.create("旧正文"); failOutbox()
        val session = SaveSession(repository, this)
        try {
            val result = session.flush(snapshot(note.id, "新正文"))
            assertFalse(result.saved); assertEquals(SavePhase.ERROR, session.event.value!!.phase)
            assertEquals("新正文", repository.recover().issues.single().snapshot!!.markdown)
        } finally { session.close() }
    }
    @Test fun conflictingBaselinePreservesCurrentFullMarkdownInSeparateNote() {
        val note = repository.create("旧正文")
        save(snapshot(note.id, "# 库中较新正文\n\n\n完整内容🙂", session = "other"))
        save(snapshot(note.id, "当前输入", session = "mine"))
        assertEquals("当前输入", repository.body(note.id))
        val copies = database.notes().tasks().filter { it.kind == "create" && it.entityId != note.id }
        assertEquals(1, copies.size)
        val copy = repository.body(copies.single().entityId)!!
        assertTrue(copy.endsWith("# 库中较新正文\n\n\n完整内容🙂")); assertTrue(repository.note(copies.single().entityId)!!.title.endsWith("（冲突副本）"))
    }
    @Test fun committedButUnclearedJournalDoesNotReplayAfterDatabaseReopen() {
        database.close()
        val path = File(directory, "notes.db")
        fun open() = Room.databaseBuilder(context, NotesDatabase::class.java, path.absolutePath).build()
        database = open(); repository = NotesRepository(database, "test", File(directory, "drafts"))
        val note = repository.create("旧正文")
        val old = snapshot(note.id, "已提交的旧稿")
        repository.stage(old); repository.commit(old) // Deliberately skip clear, then commit newer content.
        save(snapshot(note.id, "新正文", old.markdown, 1, "new-session"))
        database.close(); database = open(); repository = NotesRepository(database, "test", File(directory, "drafts"))
        val report = repository.recover()
        assertEquals(0, report.recovered); assertTrue(report.issues.isEmpty()); assertEquals("新正文", repository.body(note.id))
        assertTrue(DraftJournal(File(directory, "drafts")).files().isEmpty())
    }
    @Test fun fileFallbackSurvivesFailedRoomDraftMirror() {
        val note = repository.create("旧正文")
        database.openHelper.writableDatabase.execSQL("CREATE TRIGGER fail_drafts BEFORE INSERT ON drafts BEGIN SELECT RAISE(ABORT, 'mirror failed'); END")
        failOutbox()
        repository.stage(snapshot(note.id, "文件里可恢复"))
        assertTrue(database.notes().drafts().isEmpty()); assertEquals(1, repository.recover().issues.size)
        database.openHelper.writableDatabase.execSQL("DROP TRIGGER fail_drafts"); removeFailure()
        assertEquals(1, repository.recover().recovered); assertEquals("文件里可恢复", repository.body(note.id))
    }
    @Test fun malformedJournalIsKeptAndDoesNotBlockOtherDrafts() {
        val note = repository.create("旧正文"); repository.stage(snapshot(note.id, "恢复正文"))
        val corrupt = File(directory, "drafts/corrupt.json"); corrupt.writeText("{broken")
        val report = repository.recover()
        assertEquals(1, report.recovered); assertEquals(1, report.issues.size); assertNull(report.issues.single().snapshot)
        assertEquals("{broken", corrupt.readText())
    }
    @Test fun draftCopyIsDurableBeforeOldJournalIsCleared() {
        val note = repository.create("旧正文"); val draft = snapshot(note.id, "另存正文")
        repository.stage(draft)
        val copy = repository.saveDraftAsCopy(draft)
        assertEquals("旧正文", repository.body(note.id)); assertEquals("另存正文", repository.body(copy.id))
        assertEquals(0, repository.recover().recovered)
        assertEquals(copy.id, repository.saveDraftAsCopy(draft).id)
    }
    @Test fun copyingOlderDraftNeverMovesReceiptBackwards() {
        val note = repository.create("旧正文")
        save(snapshot(note.id, "最新正文", revision = 3))
        val old = snapshot(note.id, "更早的草稿", revision = 1)
        repository.stage(old); repository.saveDraftAsCopy(old)
        assertEquals(3L, database.notes().receipt(note.id, "session"))
        assertEquals("最新正文", repository.body(note.id)); assertEquals(0, repository.recover().recovered)
    }
    @Test fun draftRecoveryNeverResurrectsTrashedOriginal() {
        val note = repository.create("旧正文"); repository.stage(snapshot(note.id, "删除时的草稿"))
        repository.setTrash(note.id, true)
        assertEquals(1, repository.recover().recovered)
        assertEquals(1, repository.note(note.id)!!.invalid); assertEquals("旧正文", repository.body(note.id))
        val newId = database.notes().tasks().last { it.kind == "create" }.entityId
        assertNotEquals(note.id, newId); assertEquals("删除时的草稿", repository.body(newId))
    }
    @Test fun chineseSubstringSearchTreatsSqlWildcardAndQuotesLiterally() = runBlocking {
        val target = repository.create("# 标题\n\n正文后半的中文子串 %_' OR 1=1")
        repository.create("无关笔记")
        suspend fun search(query: String): List<NoteEntity> {
            val page = database.notes().page(query, 0, false, null).load(PagingSource.LoadParams.Refresh(null, 30, false))
            return (page as PagingSource.LoadResult.Page).data
        }
        assertEquals(listOf(target.id), search("中文子串").map { it.id })
        assertEquals(listOf(target.id), search("%_' OR 1=1").map { it.id })
        assertTrue(search("不存在").isEmpty())
    }
    @Test fun profilePathsAndDatabaseContentsAreIsolated() {
        val one = ProfilePaths(context, "test-${UUID.randomUUID()}"); val two = ProfilePaths(context, "test-${UUID.randomUUID()}")
        assertNotEquals(one.database, two.database); assertNotEquals(one.drafts, two.drafts); assertNotEquals(one.images, two.images)
        assertThrows(IllegalArgumentException::class.java) { ProfilePaths(context, "../escape") }
        val second = Room.inMemoryDatabaseBuilder(context, NotesDatabase::class.java).build()
        try {
            val note = repository.create("一个实例")
            val other = NotesRepository(second, "other", File(directory, "other/drafts"))
            assertNull(other.note(note.id))
            assertThrows(IllegalArgumentException::class.java) { other.stage(snapshot(note.id, "跨实例")) }
        } finally { second.close() }
    }
    @Test fun historyRetainsTwentyRecentVersions() {
        val note = repository.create("旧正文")
        var previous = "旧正文"
        repeat(25) { index ->
            now += 300_001
            val next = "版本 $index"
            save(snapshot(note.id, next, previous, index.toLong() + 1)); previous = next
        }
        assertEquals(20, database.notes().history(note.id).size)
        assertEquals("版本 23", database.notes().history(note.id).first().markdown)
    }
}
