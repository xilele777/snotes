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
import kotlinx.coroutines.flow.first
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
    @Test fun homeHiddenAndScopedSearchMatchWebRules() = runBlocking {
        val group = repository.createGroup("默认隐藏")
        database.notes().putGroup(group.copy(homeHidden = 1))
        val ordinary = repository.create("# 普通\n\n共同搜索词")
        val inherited = repository.create("# 跟随分组\n\n共同搜索词", group.id)
        val shown = repository.create("# 单篇显示\n\n共同搜索词", group.id)
        repository.updateProps(shown.id, buildJsonObject { put("home_hidden", 0) })
        val hidden = repository.create("# 单篇隐藏\n\n共同搜索词")
        repository.updateProps(hidden.id, buildJsonObject { put("home_hidden", 1) })
        val owned = repository.create("# 笔记本内容\n\n共同搜索词")
        val books = BookRepository(repository); val book = books.create("目录")
        books.editToc(book, listOf(io.github.xilele777.snotes.core.network.TocNodeDto(UUID.randomUUID().toString(), null, "note", 0, owned.id, null)))
        repository.updateProps(owned.id, buildJsonObject { put("star", 1) })
        suspend fun ids(home: Boolean = false, hiddenOnly: Boolean = false, star: Boolean = false, groupId: String? = null): Set<String> {
            val page = database.notes().page("共同搜索词", 0, star, groupId, home, hiddenOnly).load(PagingSource.LoadParams.Refresh(null, 30, false))
            return (page as PagingSource.LoadResult.Page).data.map { it.id }.toSet()
        }
        assertEquals(setOf(ordinary.id, shown.id), ids(home = true))
        assertEquals(setOf(inherited.id, hidden.id), ids(hiddenOnly = true))
        assertEquals(setOf(ordinary.id, inherited.id, shown.id, hidden.id, owned.id), ids())
        assertEquals(setOf(owned.id), ids(star = true))
        assertEquals(setOf(inherited.id, shown.id), ids(groupId = group.id))
        books.editMeta(book, "目录", "", invalid = 1)
        assertTrue(ids(home = true).contains(owned.id))
        repository.updateProps(shown.id, buildJsonObject { put("home_hidden", JsonNull) })
        assertFalse(ids(home = true).contains(shown.id))
    }
    @Test fun listSortingKeepsPinsFirstAndMissingBodyCoverageStaysInScope() = runBlocking {
        val first = repository.create("# B标题"); now += 100
        val second = repository.create("# A标题"); now += 100
        repository.updateProps(first.id, buildJsonObject { put("star", 1) })
        suspend fun ordered(sort: String): List<String> {
            val result = database.notes().page("", 0, false, null, sort = sort).load(PagingSource.LoadParams.Refresh(null, 30, false))
            return (result as PagingSource.LoadResult.Page).data.map { it.id }
        }
        assertEquals(listOf(first.id, second.id), ordered("updated"))
        assertEquals(listOf(second.id, first.id), ordered("created"))
        assertEquals(listOf(second.id, first.id), ordered("title"))
        repository.updateProps(first.id, buildJsonObject { put("top", 1) })
        assertEquals(listOf(first.id, second.id), ordered("title"))
        database.notes().putNote(NoteEntity(UUID.randomUUID().toString(), createTime = now, updateTime = now))
        assertEquals(1, database.notes().filteredMissingBodies(0, false, null, false, false).first())
        assertEquals(0, database.notes().filteredMissingBodies(0, true, null, false, false).first())
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
    @Test fun purgeNoteAndPurgeTrashRemoveLocalRowsAndRecordPurgedState() {
        val one = repository.create("待删 1")
        val two = repository.create("待删 2")
        val kept = repository.create("保留")
        repository.setTrash(one.id, true)
        repository.setTrash(two.id, true)
        repository.purgeNote(one.id)
        assertNull(repository.note(one.id))
        assertNull(repository.body(one.id))
        assertEquals("purged", database.notes().noteState(one.id)?.state)
        assertEquals(1, repository.purgeTrash())
        assertNull(repository.note(two.id))
        assertEquals("purged", database.notes().noteState(two.id)?.state)
        assertNotNull(repository.note(kept.id))
    }
    @Test fun groupRenameColorMoveAndDeleteResetNoteGroupToNull() {
        val first = repository.createGroup("一组")
        val second = repository.createGroup("二组")
        val note = repository.create("组内笔记", first.id)
        repository.renameGroup(first.id, "新一组")
        repository.setGroupColor(first.id, "#d8b46a")
        repository.setGroupHomeHidden(first.id, true)
        assertEquals("新一组", database.notes().group(first.id)!!.name)
        assertEquals("#d8b46a", database.notes().group(first.id)!!.color)
        assertEquals(1, database.notes().group(first.id)!!.homeHidden)
        repository.moveGroup(second.id, -1)
        assertTrue(database.notes().group(second.id)!!.sort < database.notes().group(first.id)!!.sort)
        repository.deleteGroup(first.id)
        assertEquals(1, database.notes().group(first.id)!!.invalid)
        assertNull(repository.note(note.id)!!.groupId)
    }
}
