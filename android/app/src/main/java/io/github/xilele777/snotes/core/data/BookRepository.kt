package io.github.xilele777.snotes.core.data

import io.github.xilele777.snotes.core.database.*
import io.github.xilele777.snotes.core.network.*
import io.github.xilele777.snotes.core.sync.validateToc
import java.util.UUID
import javax.inject.Inject
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*

@Serializable data class BookSent(val taskId: Long, val seq: Long, val bookId: String, val kind: String,
    val payload: JsonObject, val baseline: BookRemoteDto?)

/** Remote baseline, local desired state and immutable sent operation are separate durable values. */
class BookRepository @Inject constructor(private val repository: NotesRepository) {
    private val dao get() = repository.database.notes()
    private fun <T> tx(block: () -> T) = repository.syncTransaction(block)
    fun remote(id: String) = dao.meta("book:$id")?.let { syncJson.decodeFromString<BookRemoteDto>(it) }
    fun desired(id: String) = dao.meta("book_desired:$id")?.let { syncJson.decodeFromString<BookRemoteDto>(it) } ?: remote(id)
    private fun saveDesired(value: BookRemoteDto) { dao.putMeta(SyncMetaEntity("book_desired:${value.book.id}", syncJson.encodeToString(value))); project(value) }
    private fun states(nodes: List<TocNodeDto>, prior: Map<String, String> = emptyMap()) = nodes.mapNotNull { it.noteId }.associateWith { id ->
        repository.note(id)?.let { if (it.invalid == 0) "available" else "trash" } ?: prior[id] ?: "purged"
    }
    private fun project(value: BookRemoteDto) {
        dao.putBook(KnowledgeBaseEntity(value.book.id, value.book.name, value.book.description, value.book.tocVersion, value.book.invalid))
        dao.clearToc(value.book.id)
        if (value.book.deleted == 0) value.toc.nodes.forEach { dao.putToc(TocEntity(value.book.id, it.id, it.parentId, it.noteId, it.title.orEmpty(), it.ord)) }
    }
    private fun metaPayload(value: BookRemoteDto, create: Boolean) = buildJsonObject {
        if (create) put("id", value.book.id) else put("base_meta_version", remote(value.book.id)?.book?.metaVersion ?: 0)
        put("operation_id", UUID.randomUUID().toString()); put("name", value.book.name); put("description", value.book.description)
        put("icon", value.book.icon); put("ord", value.book.ord); put("invalid", value.book.invalid)
    }
    private fun tocPayload(value: BookRemoteDto, preserveMissing: Boolean = false) = buildJsonObject {
        put("operation_id", UUID.randomUUID().toString()); put("base_toc_version", remote(value.book.id)?.toc?.version ?: 0)
        put("nodes", syncJson.encodeToJsonElement(value.toc.nodes)); put("preserve_missing_references", preserveMissing)
        if (value.book.invalid == 1) put("archived_meta_version", remote(value.book.id)?.book?.metaVersion ?: 0)
    }
    private fun queue(id: String, kind: String, payload: JsonObject) {
        val prior = dao.task("book", id, kind)
        dao.putTask(TaskEntity(id = prior?.id ?: 0, entityType = "book", entityId = id, kind = kind,
            payload = payload.toString(), seq = (prior?.seq ?: 0) + 1))
        repository.requestSync()
    }
    fun create(name: String, id: String = UUID.randomUUID().toString(), nodes: List<TocNodeDto> = emptyList(), preserveMissing: Boolean = false): String = tx {
        safeId(id); require(desired(id) == null) { "笔记本已存在" }
        val now = System.currentTimeMillis()
        val value = BookRemoteDto(BookDto(id, name.trim(), "", "", 0, 0, 0, 0, 0, now, now, 0), TocDto(id, 0, nodes, now), states(nodes))
        validateToc(value); saveDesired(value); queue(id, "create", metaPayload(value, true))
        if (nodes.isNotEmpty()) queue(id, "toc", tocPayload(value, preserveMissing))
        id
    }
    fun editMeta(id: String, name: String, description: String, invalid: Int = 0, icon: String? = null, ord: Int? = null) = tx {
        val previous = checkNotNull(desired(id)); check(previous.book.deleted == 0)
        val value = previous.copy(book = previous.book.copy(name = name.trim(), description = description, invalid = invalid, icon = icon ?: previous.book.icon, ord = ord ?: previous.book.ord))
        val create = dao.task("book", id, "create") != null
        saveDesired(value); queue(id, if (create) "create" else "meta", metaPayload(value, create))
    }
    fun editToc(id: String, nodes: List<TocNodeDto>, preserveMissing: Boolean = false) = tx {
        val previous = checkNotNull(desired(id)); check(previous.book.deleted == 0)
        val value = previous.copy(toc = previous.toc.copy(nodes = nodes), noteStates = states(nodes, previous.noteStates))
        validateToc(value)
        val oldRefs = previous.toc.nodes.mapNotNull { it.noteId }.toSet()
        if (!preserveMissing) nodes.mapNotNull { it.noteId }.filter { it !in oldRefs }.forEach { note ->
            check(repository.note(note)?.invalid == 0) { "只能引用可用的笔记" }
            check(dao.books().filter { it.id != id && it.invalid == 0 }.none { dao.toc(it.id).any { node -> node.noteId == note } }) { "笔记已属于其他笔记本，请先解除引用并同步" }
        }
        snapshot(previous, "edit"); saveDesired(value); queue(id, "toc", tocPayload(value, preserveMissing))
    }
    fun deletePermanently(id: String, typedName: String) = tx {
        val value = checkNotNull(desired(id)); check(typedName == value.book.name) { "请输入完整笔记本名称" }
        check(dao.tasks().none { it.entityType == "book" && it.entityId == id }) { "请先完成笔记本同步" }
        val refs = value.toc.nodes.mapNotNull { it.noteId }
        check(refs.none { repository.editorActive(it) || repository.hasUncommittedDraft(it) || dao.tasks().any { task -> task.entityType == "note" && task.entityId == it } }) { "引用笔记仍有草稿或未同步改动，请先处理" }
        queue(id, "delete", buildJsonObject { put("name", typedName); put("base_meta_version", value.book.metaVersion); put("base_toc_version", value.toc.version) })
    }
    fun snapshot(value: BookRemoteDto, source: String) {
        val key = "book_history:${value.book.id}:${UUID.randomUUID()}"
        dao.putMeta(SyncMetaEntity(key, buildJsonObject { put("id", key.substringAfterLast(':')); put("book_id", value.book.id); put("time", System.currentTimeMillis()); put("source", if (source == "edit") "confirmed" else source)
            put("meta", buildJsonObject { put("name", value.book.name); put("description", value.book.description); put("icon", value.book.icon); put("ord", value.book.ord); put("invalid", value.book.invalid) })
            put("nodes", syncJson.encodeToJsonElement(value.toc.nodes)) }.toString()))
    }
    fun acceptRemote(value: BookRemoteDto) = tx {
        validateToc(value)
        val previous = remote(value.book.id)
        if (previous != null && (value.book.metaVersion < previous.book.metaVersion || value.toc.version < previous.toc.version) && dao.meta("reconcile_books") != "1") return@tx
        dao.putMeta(SyncMetaEntity("book:${value.book.id}", syncJson.encodeToString(value)))
        val pending = dao.tasks().any { it.entityType == "book" && it.entityId == value.book.id }
        if (value.book.deleted == 1) {
            desired(value.book.id)?.takeIf { it.book.deleted == 0 }?.let { snapshot(it, "conflict") }
            dao.deleteTasks("book", value.book.id); dao.deleteMeta("book_desired:${value.book.id}"); project(value)
        } else if (!pending) { dao.deleteMeta("book_desired:${value.book.id}"); project(value) }
        else desired(value.book.id)?.let(::project)
    }
    fun prepare(task: TaskEntity): BookSent? = tx {
        val current = dao.taskById(task.id) ?: return@tx null
        if (current.failed != 0 || current.nextAt > System.currentTimeMillis()) return@tx null
        dao.meta("book_sent:${task.id}")?.let { return@tx syncJson.decodeFromString<BookSent>(it) }
        val payload = syncJson.parseToJsonElement(current.payload).jsonObject
        val sent = BookSent(current.id, current.seq, current.entityId, current.kind, payload, remote(current.entityId))
        dao.putMeta(SyncMetaEntity("book_sent:${current.id}", syncJson.encodeToString(sent)))
        sent
    }
    fun acknowledge(sent: BookSent, ack: BookAckDto) = tx {
        val desired = desired(sent.bookId) ?: return@tx
        val baseline = remote(sent.bookId) ?: desired
        val meta = if (sent.kind in setOf("meta", "create")) baseline.book.copy(name = sent.payload.getValue("name").jsonPrimitive.content,
            description = sent.payload.getValue("description").jsonPrimitive.content, icon = sent.payload.getValue("icon").jsonPrimitive.content,
            ord = sent.payload.getValue("ord").jsonPrimitive.int, invalid = sent.payload.getValue("invalid").jsonPrimitive.int, metaVersion = ack.metaVersion, updateTime = ack.updateTime) else baseline.book.copy(tocVersion = ack.tocVersion, updateTime = ack.updateTime)
        val toc = if (sent.kind == "toc") baseline.toc.copy(version = ack.tocVersion, nodes = syncJson.decodeFromJsonElement(sent.payload.getValue("nodes")), updateTime = ack.updateTime) else baseline.toc
        dao.putMeta(SyncMetaEntity("book:${sent.bookId}", syncJson.encodeToString(baseline.copy(book = meta, toc = toc, noteStates = states(toc.nodes, desired.noteStates)))))
        val current = dao.taskById(sent.taskId)
        if (current?.seq == sent.seq) dao.consumeTask(sent.taskId, sent.seq)
        else if (current != null) {
            val kind = if (sent.kind == "create") "meta" else current.kind
            val payload = if (kind == "toc") tocPayload(desired, current.payload.contains("\"preserve_missing_references\":true")) else metaPayload(desired, false)
            dao.putTask(current.copy(kind = kind, payload = payload.toString(), failed = 0, nextAt = 0))
        }
        // A queued TOC depending on a just-created book gets the exact ACK baseline, never an arbitrary pull revision.
        dao.task("book", sent.bookId, "toc")?.takeIf { dao.meta("book_sent:${it.id}") == null && sent.kind == "create" }?.let { task ->
            val payload = JsonObject(syncJson.parseToJsonElement(task.payload).jsonObject + ("base_toc_version" to JsonPrimitive(ack.tocVersion)))
            dao.putTask(task.copy(payload = payload.toString()))
        }
        if (sent.kind in setOf("meta", "create")) dao.task("book", sent.bookId, "toc")?.takeIf { dao.meta("book_sent:${it.id}") == null }?.let { task ->
            if (desired.book.invalid == 1) dao.putTask(task.copy(payload = JsonObject(syncJson.parseToJsonElement(task.payload).jsonObject + ("archived_meta_version" to JsonPrimitive(ack.metaVersion))).toString()))
        }
        dao.deleteMeta("book_sent:${sent.taskId}")
        if (dao.tasks().none { it.entityType == "book" && it.entityId == sent.bookId }) { dao.deleteMeta("book_desired:${sent.bookId}"); project(checkNotNull(remote(sent.bookId))) }
    }
    fun fail(sent: BookSent, error: ApiError, current: BookRemoteDto? = null) = tx {
        if (current != null) { desired(sent.bookId)?.let { snapshot(it, "conflict") }; acceptRemote(current) }
        dao.taskById(sent.taskId)?.let { task -> dao.putTask(task.copy(failed = if (error.status in 400..499 && error.status !in setOf(408, 429)) 1 else 0,
            retry = task.retry + 1, nextAt = error.retryAt ?: System.currentTimeMillis() + 30_000, lastError = if (error.status == 409) "笔记本目录或信息冲突，请选择保留本机或远端" else error.message)) }
    }
    fun resolve(id: String, keepLocal: Boolean) = tx {
        val value = checkNotNull(desired(id)); snapshot(value, "conflict")
        dao.tasks().filter { it.entityType == "book" && it.entityId == id }.forEach { dao.deleteMeta("book_sent:${it.id}") }
        dao.deleteTasks("book", id)
        if (keepLocal) {
            check(remote(id)?.book?.deleted != 1) { "服务端已永久删除，请导出恢复副本" }
            queue(id, "meta", metaPayload(value, false)); queue(id, "toc", tocPayload(value, true))
        } else { dao.deleteMeta("book_desired:$id"); remote(id)?.let(::project) }
    }
}
