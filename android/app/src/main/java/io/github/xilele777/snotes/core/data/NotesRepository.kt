package io.github.xilele777.snotes.core.data

import androidx.paging.Pager
import androidx.paging.PagingConfig
import io.github.xilele777.snotes.core.database.*
import io.github.xilele777.snotes.core.editor.*
import io.github.xilele777.snotes.core.model.*
import java.io.File
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.serialization.json.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.map

data class NoteFilter(val query: String = "", val trash: Boolean = false, val starred: Boolean = false, val groupId: String? = null,
    val homeOnly: Boolean = false, val hiddenOnly: Boolean = false, val sort: String = "updated")
data class RecoveryIssue(val name: String, val snapshot: DraftSnapshot?, val message: String)
data class RecoveryReport(val recovered: Int, val issues: List<RecoveryIssue>)
data class SyncFailure(val task: TaskEntity, val title: String)

@Singleton
class NotesRepository(private val fixedDatabase: NotesDatabase, private val fixedProfileId: String, private val fixedDraftDirectory: File,
    private val clock: () -> Long = System::currentTimeMillis) : DraftStore {
    @Inject constructor(profile: LocalProfile) : this(profile.database, profile.paths.id, profile.paths.drafts) { liveProfile = profile }
    private var liveProfile: LocalProfile? = null
    val database get() = liveProfile?.database ?: fixedDatabase
    val profileId get() = liveProfile?.paths?.id ?: fixedProfileId
    private val draftDirectory get() = liveProfile?.paths?.drafts ?: fixedDraftDirectory
    private val dao get() = database.notes()
    private val journal get() = DraftJournal(draftDirectory)
    @Synchronized fun switchProfile(id: String) {
        check(activeEditors.isEmpty()) { "请先返回列表并保存正文，再更换实例" }
        check(recover().issues.isEmpty()) { "还有未恢复草稿，请先另存或导出" }
        checkNotNull(liveProfile).switchTo(id)
    }
    fun canChangeStructure(id: String): Boolean = (dao.meta("instance_origin") == null ||
        dao.task("note", id, "create") != null || dao.meta("books_initialized") == "1" && dao.meta("reconcile_books") == null) &&
        dao.books().none { book -> dao.toc(book.id).any { it.noteId == id } }
    val structureIds get() = dao.structureIds()
    fun requestSync() { liveProfile?.requestSync() }
    private val activeEditors = mutableSetOf<String>()
    @Synchronized fun pinEditor(id: String) { activeEditors.add(id) }
    @Synchronized fun unpinEditor(id: String) { activeEditors.remove(id); requestSync() }
    @Synchronized fun editorActive(id: String) = id in activeEditors
    val groups get() = dao.groups()
    val pendingCount get() = dao.pendingCount()
    val missingBodyCount get() = dao.missingBodyCount()
    val activeNotesCount get() = dao.activeNotesCount()
    val activeBooksCount get() = dao.activeBooksCount()
    fun count(filter: NoteFilter) = dao.filteredCount(filter.query, if (filter.trash) 1 else 0, filter.starred, filter.groupId, filter.homeOnly, filter.hiddenOnly)
    fun missingBodies(filter: NoteFilter) = dao.filteredMissingBodies(if (filter.trash) 1 else 0, filter.starred, filter.groupId, filter.homeOnly, filter.hiddenOnly)
    val syncFailures get() = dao.failedTasks().map { tasks -> withContext(Dispatchers.IO) {
        tasks.map { SyncFailure(it, (when (it.entityType) { "note" -> dao.note(it.entityId)?.title; "book" -> dao.books().firstOrNull { book -> book.id == it.entityId }?.name; else -> dao.group(it.entityId)?.name }).orEmpty().ifBlank { "无标题" }) }
    } }
    @Synchronized fun saveFailedAsCopy(taskId: Long): NoteEntity = database.runInTransaction<NoteEntity> {
        val task = checkNotNull(dao.taskById(taskId)) { "同步任务已处理" }
        require(task.failed == 1 && task.entityType == "note") { "该任务不能另存为笔记" }
        val key = "failed-copy:${task.id}:${task.seq}"
        dao.meta(key)?.let { dao.note(it)?.let { copy -> return@runInTransaction copy } }
        val markdown = checkNotNull(body(task.entityId)) { "正文尚未下载" }
        require(noteFits(markdown)) { "正文超过 1 MiB，请先导出或拆分" }
        val copy = createIn(markdown, null)
        dao.putMeta(SyncMetaEntity(key, copy.id))
        copy
    }
    fun pages(filter: NoteFilter) = Pager(PagingConfig(pageSize = 24, initialLoadSize = 24, prefetchDistance = 8, enablePlaceholders = false)) {
        dao.page(filter.query, if (filter.trash) 1 else 0, filter.starred, filter.groupId, filter.homeOnly, filter.hiddenOnly, filter.sort)
    }.flow
    fun note(id: String) = dao.note(id)
    fun body(id: String): String? = dao.body(id)?.markdown

    /** Shares the save/stage monitor as well as Room's transaction lock. File-only drafts also fence remote writes. */
    @Synchronized fun <T> syncTransaction(block: () -> T): T = database.runInTransaction<T> { block() }
    @Synchronized fun hasUncommittedDraft(id: String): Boolean {
        if (dao.drafts().any { it.noteId == id && it.revision > (dao.receipt(it.noteId, it.sessionId) ?: -1) }) return true
        return journal.files().any { file ->
            runCatching { val draft = journal.read(file)
                draft.key.noteId == id && draft.revision > (dao.receipt(id, draft.key.sessionId) ?: -1)
            }.getOrDefault(true)
        }
    }
    /** Sync copies can exceed the upload limit after the prefix is added; the full source remains readable. */
    fun syncCopyIn(markdown: String, source: String): NoteEntity? {
        check(database.inTransaction())
        if (markdown.isBlank()) return null
        dao.meta(source)?.let { return dao.note(it) }
        val copy = createIn("# ${derive(markdown).title.ifEmpty { "无标题" }.take(58)}（恢复副本）\n\n$markdown", null)
        dao.putMeta(SyncMetaEntity(source, copy.id))
        return copy
    }

    @Synchronized fun create(markdown: String = "", groupId: String? = null): NoteEntity {
        require(noteFits(markdown)) { "正文超过 1 MiB，请先导出或拆分" }
        return database.runInTransaction<NoteEntity> {
            require(groupId == null || dao.group(groupId)?.invalid == 0) { "分组不存在" }
            createIn(markdown, groupId)
        }
    }
    private fun createIn(markdown: String, groupId: String?, id: String = UUID.randomUUID().toString(), createTime: Long? = null): NoteEntity {
        val fields = derive(markdown)
        val now = createTime ?: clock()
        val note = NoteEntity(id, groupId, fields.title, fields.summary, fields.thumbnail,
            createTime = now, updateTime = now)
        dao.putNote(note); dao.putBody(BodyEntity(note.id, markdown))
        dao.putMeta(SyncMetaEntity("open_unknown:${note.id}", "1"))
        enqueue(note.id, "create", buildJsonObject {
            put("id", note.id); put("create_time", now); put("content", markdown)
            put("title", fields.title); put("summary", fields.summary); put("thumbnail", fields.thumbnail)
            put("group_id", groupId); put("star", 0); put("top", 0); put("skin_color", JsonNull); put("home_hidden", JsonNull)
        })
        return note
    }
    fun importNote(id: String, markdown: String, groupId: String?, createTime: Long, props: JsonObject, trash: Boolean) {
        check(database.inTransaction()); io.github.xilele777.snotes.core.network.safeId(id)
        require(noteFits(markdown)); require(dao.note(id) == null)
        createIn(markdown, groupId, id, createTime)
        updateProps(id, props)
        if (trash) setTrash(id, true)
    }
    @Synchronized fun createGroup(name: String): GroupEntity = database.runInTransaction<GroupEntity> {
        require(name.trim().isNotEmpty() && name.trim().length <= 100) { "分组名称应为 1–100 个字符" }
        val maxSort = dao.allGroups().filter { it.invalid == 0 }.maxOfOrNull { it.sort } ?: -1
        val group = GroupEntity(UUID.randomUUID().toString(), name.trim(), sort = maxSort + 1)
        dao.putGroup(group)
        enqueue(group.id, "create", buildJsonObject { put("id", group.id); put("name", group.name); put("sort", group.sort); put("color", JsonNull); put("home_hidden", 0) }, "group")
        group
    }
    @Synchronized fun renameGroup(id: String, name: String) = database.runInTransaction {
        val trimmed = name.trim()
        require(trimmed.isNotEmpty() && trimmed.length <= 100) { "分组名称应为 1–100 个字符" }
        val group = checkNotNull(dao.group(id)) { "分组不存在" }
        check(group.invalid == 0) { "分组已删除" }
        val updated = group.copy(name = trimmed, dirty = true)
        dao.putGroup(updated)
        enqueueGroupPatch(updated, buildJsonObject { put("name", trimmed) })
    }
    @Synchronized fun setGroupColor(id: String, color: String?) = database.runInTransaction {
        val group = checkNotNull(dao.group(id)) { "分组不存在" }
        check(group.invalid == 0) { "分组已删除" }
        val updated = group.copy(color = color, dirty = true)
        dao.putGroup(updated)
        enqueueGroupPatch(updated, buildJsonObject { put("color", color?.let(::JsonPrimitive) ?: JsonNull) })
    }
    @Synchronized fun setGroupHomeHidden(id: String, hidden: Boolean) = database.runInTransaction {
        val group = checkNotNull(dao.group(id)) { "分组不存在" }
        check(group.invalid == 0) { "分组已删除" }
        val flag = if (hidden) 1 else 0
        val updated = group.copy(homeHidden = flag, dirty = true)
        dao.putGroup(updated)
        enqueueGroupPatch(updated, buildJsonObject { put("hide_from_home", flag) })
    }
    @Synchronized fun moveGroup(id: String, delta: Int) = database.runInTransaction {
        val active = dao.allGroups().filter { it.invalid == 0 }.sortedWith(compareBy({ it.sort }, { it.name }, { it.id }))
        val index = active.indexOfFirst { it.id == id }
        val targetIndex = index + delta
        if (index < 0 || targetIndex !in active.indices) return@runInTransaction
        val reordered = active.toMutableList().apply {
            val item = removeAt(index)
            add(targetIndex, item)
        }
        reordered.forEachIndexed { ord, item ->
            if (item.sort != ord) {
                val updated = item.copy(sort = ord, dirty = true)
                dao.putGroup(updated)
                enqueueGroupPatch(updated, buildJsonObject { put("ord", ord) })
            }
        }
    }
    @Synchronized fun deleteGroup(id: String) = database.runInTransaction {
        val group = checkNotNull(dao.group(id)) { "分组不存在" }
        val hadPendingCreate = dao.task("group", id, "create") != null && dao.meta("sent:${dao.task("group", id, "create")!!.id}") == null
        dao.putGroup(group.copy(invalid = 1, dirty = !hadPendingCreate))
        dao.allNotes().filter { it.groupId == id }.forEach { note ->
            dao.putNote(note.copy(groupId = null, updateTime = clock()))
        }
        dao.deleteTasks("group", id)
        if (!hadPendingCreate) {
            enqueue(id, "delete", buildJsonObject {}, "group")
        }
    }
    private fun enqueueGroupPatch(group: GroupEntity, patch: JsonObject) {
        val pendingCreate = dao.task("group", group.id, "create")
        if (pendingCreate != null && dao.meta("sent:${pendingCreate.id}") == null) {
            enqueue(group.id, "create", buildJsonObject {
                put("id", group.id); put("name", group.name); put("sort", group.sort)
                put("color", group.color?.let(::JsonPrimitive) ?: JsonNull); put("home_hidden", group.homeHidden)
            }, "group")
        } else {
            val previous = dao.task("group", group.id, "prop")?.payload?.let { Json.parseToJsonElement(it).jsonObject }.orEmpty()
            enqueue(group.id, "prop", JsonObject(previous + patch), "group")
        }
    }
    fun importGroup(name: String, ord: Int, color: String?, hidden: Int): String {
        check(database.inTransaction())
        val existing = dao.allGroups().firstOrNull { it.invalid == 0 && it.name == name }
        if (existing != null) return existing.id
        val created = createGroup(name)
        dao.putGroup(created.copy(sort = ord, color = color, homeHidden = hidden))
        enqueue(created.id, "create", buildJsonObject { put("id", created.id); put("name", name); put("sort", ord); put("color", color); put("home_hidden", hidden) }, "group")
        return created.id
    }
    /** Only supplied fields enter the prop task. Null is a deliberate reset. */
    @Synchronized fun updateProps(id: String, props: JsonObject) {
        require(props.keys.all { it in setOf("star", "top", "group_id", "skin_color", "home_hidden") })
        if (props.isEmpty()) return
        database.runInTransaction {
            val note = checkNotNull(dao.note(id)) { "笔记不存在" }
            if ("group_id" in props) check(canChangeStructure(id)) { "笔记目录归属未知或被笔记本引用，不能移动" }
            fun bit(name: String, fallback: Int): Int = if (name in props) {
                val value = (props[name] as? JsonPrimitive)?.takeUnless { it.isString }?.intOrNull
                require(value == 0 || value == 1); checkNotNull(value)
            } else fallback
            fun nullableString(name: String, fallback: String?): String? = if (name in props) {
                val value = props[name]; require(value == JsonNull || value is JsonPrimitive && value.isString)
                if (value == JsonNull) null else value!!.jsonPrimitive.content
            } else fallback
            val group = nullableString("group_id", note.groupId)
            require(group == null || dao.group(group)?.invalid == 0) { "分组不存在" }
            val hidden = if ("home_hidden" in props) if (props["home_hidden"] == JsonNull) null else bit("home_hidden", 0) else note.homeHidden
            dao.putNote(note.copy(star = bit("star", note.star), top = bit("top", note.top), groupId = group,
                skinColor = nullableString("skin_color", note.skinColor), homeHidden = hidden,
                updateTime = clock(), dirty = bump(note.dirty, "prop")))
            val previous = dao.task("note", id, "prop")?.payload?.let { Json.parseToJsonElement(it).jsonObject }.orEmpty()
            enqueue(id, "prop", JsonObject(previous + props + ("base_prop_version" to JsonPrimitive(note.propVersion))))
        }
    }
    @Synchronized fun setTrash(id: String, trash: Boolean) = database.runInTransaction {
        val note = checkNotNull(dao.note(id)) { "笔记不存在" }
        if (trash) {
            check(canChangeStructure(id)) { "笔记目录归属未知或被笔记本引用，请在笔记本管理中处理" }
        }
        trashIn(note, trash)
    }
    @Synchronized fun setBookNoteTrash(id: String, bookId: String, trash: Boolean) = database.runInTransaction {
        check(dao.books().any { it.id == bookId } && dao.toc(bookId).any { it.noteId == id }) { "目录引用已变化，请刷新" }
        val note = checkNotNull(dao.note(id)) { "引用笔记已永久删除或尚未下载" }
        trashIn(note, trash)
    }
    private fun trashIn(note: NoteEntity, trash: Boolean) {
        val id = note.id
        dao.putNote(note.copy(invalid = if (trash) 1 else 0, updateTime = clock(), dirty = bump(note.dirty, "prop")))
        dao.putNoteState(NoteStateEntity(id, if (trash) "trash" else "available"))
        dao.deleteTask("note", id, if (trash) "recover" else "trash")
        enqueue(id, if (trash) "trash" else "recover", buildJsonObject {})
    }
    @Synchronized fun purgeNote(id: String) {
        database.runInTransaction {
            val note = dao.note(id) ?: return@runInTransaction
            require(note.invalid == 1) { "只能彻底删除回收站中的笔记" }
            purgeIn(note)
        }
        compactWal()
    }
    @Synchronized fun purgeTrash(): Int {
        val count = database.runInTransaction<Int> {
            val trashed = dao.allNotes().filter { it.invalid == 1 }
            trashed.forEach(::purgeIn)
            trashed.size
        }
        if (count > 0) compactWal()
        return count
    }
    private fun compactWal() {
        runCatching {
            if (!database.inTransaction()) {
                database.openHelper.writableDatabase.query("PRAGMA wal_checkpoint(TRUNCATE)").close()
            }
        }
    }
    private fun purgeIn(note: NoteEntity) {
        val id = note.id
        val pendingCreate = dao.task("note", id, "create")
        val neverSentToServer = pendingCreate != null && dao.meta("sent:${pendingCreate.id}") == null && note.version == 0L
        dao.deleteNote(id)
        dao.deleteTasks("note", id)
        dao.deleteMeta("required_body:$id")
        dao.putNoteState(NoteStateEntity(id, "purged"))
        if (!neverSentToServer) {
            enqueue(id, "purge", buildJsonObject { put("scope", "note") })
        }
    }
    private fun enqueue(id: String, kind: String, payload: JsonObject, type: String = "note") {
        val previous = dao.task(type, id, kind)
        dao.putTask(TaskEntity(id = previous?.id ?: 0, entityType = type, entityId = id, kind = kind,
            payload = payload.toString(), seq = (previous?.seq ?: 0) + 1))
        liveProfile?.requestSync()
    }
    private fun bump(current: String, add: String) = if (current == "both" || current !in setOf("clean", "none", add)) "both" else add

    @Synchronized override fun stage(snapshot: DraftSnapshot) {
        validate(snapshot)
        // The file is durable before Room is touched. A failed mirror does not lose the recovery channel.
        journal.write(snapshot)
        runCatching { dao.putDraft(snapshot.entity()) }
    }
    @Synchronized override fun commit(snapshot: DraftSnapshot) {
        validate(snapshot)
        database.runInTransaction {
            if ((dao.receipt(snapshot.key.noteId, snapshot.key.sessionId) ?: -1) >= snapshot.revision) return@runInTransaction
            require(noteFits(snapshot.markdown)) { "正文超过 1 MiB，请导出或拆分" }
            val note = dao.note(snapshot.key.noteId)
            if (note == null || note.invalid != 0) {
                // A draft cannot silently resurrect a deleted note.
                createIn(snapshot.markdown, note?.groupId)
            } else {
                val previous = dao.body(note.id)?.markdown
                check(previous != null) { "正文尚未下载，不能当成空正文覆盖" }
                if (previous != snapshot.markdown) {
                    if (previous != snapshot.baseline) {
                        val title = derive(previous).title.ifEmpty { "无标题" }.take(58)
                        createIn("# ${title}（冲突副本）\n\n$previous", note.groupId)
                    }
                    val now = clock()
                    val last = dao.history(note.id).maxByOrNull { it.time }
                    if (previous.isNotBlank() && previous != last?.markdown && (last == null || now - last.time >= 300_000 ||
                        kotlin.math.abs(visibleCharacterCount(previous) - visibleCharacterCount(last.markdown)) >= 100)) {
                        dao.putHistory(HistoryEntity(noteId = note.id, markdown = previous, time = note.updateTime))
                        dao.pruneHistory(note.id, note.updateTime - 30L * 86_400_000)
                    }
                    val fields = derive(snapshot.markdown)
                    dao.putBody(BodyEntity(note.id, snapshot.markdown))
                    dao.putNote(note.copy(title = fields.title, summary = fields.summary, thumbnail = fields.thumbnail,
                        updateTime = clock(), dirty = bump(note.dirty, "body")))
                    enqueue(note.id, "body", buildJsonObject {
                        put("content", snapshot.markdown); put("title", fields.title); put("summary", fields.summary)
                        put("thumbnail", fields.thumbnail); put("base_version", note.version)
                    })
                }
            }
            dao.putReceipt(ReceiptEntity(snapshot.key.noteId, snapshot.key.sessionId, snapshot.revision))
        }
    }
    @Synchronized override fun clear(snapshot: DraftSnapshot) {
        dao.clearDraft(snapshot.key.noteId, snapshot.key.sessionId, snapshot.revision)
        journal.clear(snapshot)
    }
    @Synchronized fun recover(): RecoveryReport {
        listOf(draftDirectory, File(draftDirectory.parentFile, "images")).forEach { check(it.isDirectory || it.mkdirs()) { "无法创建本机数据目录" } }
        val issues = mutableListOf<RecoveryIssue>()
        val snapshots = linkedMapOf<SessionKey, DraftSnapshot>()
        dao.drafts().forEach { draft ->
            val snapshot = draft.snapshot(profileId); snapshots[snapshot.key] = snapshot
        }
        journal.files().forEach { file ->
            try {
                val snapshot = journal.read(file); validate(snapshot)
                if (snapshot.revision >= (snapshots[snapshot.key]?.revision ?: -1)) snapshots[snapshot.key] = snapshot
            } catch (_: Exception) { issues += RecoveryIssue(file.name, null, "草稿文件无法读取，原文件已保留") }
        }
        var recovered = 0
        snapshots.values.forEach { snapshot ->
            try {
                if ((dao.receipt(snapshot.key.noteId, snapshot.key.sessionId) ?: -1) < snapshot.revision) {
                    commit(snapshot); recovered++
                }
                clear(snapshot)
            } catch (error: Exception) { issues += RecoveryIssue(snapshot.key.noteId, snapshot, error.message ?: "草稿恢复失败") }
        }
        compactWal()
        return RecoveryReport(recovered, issues)
    }
    /** The original draft remains unless both its copy AND receipt have committed. */
    @Synchronized fun saveDraftAsCopy(snapshot: DraftSnapshot): NoteEntity {
        validate(snapshot)
        val copy = database.runInTransaction<NoteEntity> {
            require(noteFits(snapshot.markdown)) { "正文超过 1 MiB，请先导出" }
            val copyKey = "draft-copy:${snapshot.key.noteId}:${snapshot.key.sessionId}:${snapshot.revision}"
            dao.meta(copyKey)?.let { id -> dao.note(id)?.let { return@runInTransaction it } }
            val result = createIn(snapshot.markdown, null)
            dao.putMeta(SyncMetaEntity(copyKey, result.id))
            dao.putReceipt(ReceiptEntity(snapshot.key.noteId, snapshot.key.sessionId,
                maxOf(snapshot.revision, dao.receipt(snapshot.key.noteId, snapshot.key.sessionId) ?: -1)))
            result
        }
        runCatching { clear(snapshot) }
        return copy
    }
    fun export(id: String): String = checkNotNull(body(id)) { "正文尚未下载，不能导出" }
    private fun validate(snapshot: DraftSnapshot) {
        require(snapshot.key.profileId == profileId)
        require(snapshot.key.noteId.matches(Regex("[A-Za-z0-9-]{1,128}")) && snapshot.key.sessionId.matches(Regex("[A-Za-z0-9-]{1,128}")))
        require(snapshot.revision in 0..Int.MAX_VALUE.toLong())
        require(snapshot.markdown.length <= MAX_EDITOR_CHARS && snapshot.baseline.length <= MAX_EDITOR_CHARS)
    }
    private fun DraftSnapshot.entity() = DraftEntity(key.noteId, key.sessionId, revision, baseline, markdown, composing)
    private fun DraftEntity.snapshot(profileId: String) = DraftSnapshot(SessionKey(profileId, noteId, sessionId), revision, baseline, markdown, composing)
}
