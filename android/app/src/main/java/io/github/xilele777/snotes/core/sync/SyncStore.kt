package io.github.xilele777.snotes.core.sync

import io.github.xilele777.snotes.core.data.NotesRepository
import io.github.xilele777.snotes.core.database.*
import io.github.xilele777.snotes.core.model.NoteMeta
import io.github.xilele777.snotes.core.network.*
import java.security.MessageDigest
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*

@Serializable data class SentTask(val id: Long, val seq: Long, val entityType: String, val entityId: String,
    val kind: String, val payload: JsonObject)

/** Network code never owns a Room transaction. Every application/ACK shares the editor's stage lock. */
class SyncStore(val repository: NotesRepository, private val clock: () -> Long = System::currentTimeMillis) {
    val dao get() = repository.database.notes()
    fun <T> transaction(block: () -> T): T = repository.syncTransaction(block)
    fun meta(key: String) = dao.meta(key)
    fun number(key: String) = meta(key)?.toLongOrNull() ?: 0L
    fun put(key: String, value: String) = dao.putMeta(SyncMetaEntity(key, value))
    fun markRecovery(epoch: String? = null) = transaction {
        put("reconcile_notes", "1"); put("reconcile_books", "1")
        epoch?.let { put("pending_epoch", it) }
        dao.deleteMeta("accepted_epoch")
    }
    fun bodyPending(id: String) = dao.task("note", id, "create") != null || dao.task("note", id, "body") != null
    private fun propPending(id: String) = dao.tasks().any { it.entityType == "note" && it.entityId == id && it.kind != "body" }
    fun protectedBody(id: String) = bodyPending(id) || repository.editorActive(id) || repository.hasUncommittedDraft(id)
    private fun dirty(id: String): String {
        val body = bodyPending(id); val prop = propPending(id)
        return if (body && prop) "both" else if (body) "body" else if (prop) "prop" else "none"
    }
    fun applyPage(page: PullDto, reconcile: Boolean): Set<String> = transaction {
        page.groups.forEach { group ->
            if (dao.tasks().none { it.entityType == "group" && it.entityId == group.id })
                dao.putGroup(GroupEntity(group.id, group.name, group.ord, group.color, group.hideFromHome, group.invalid, false))
        }
        val required = mutableSetOf<String>()
        page.notes.forEach { remote ->
            if (remote.invalid == 2) { tombstoneIn(remote.id, false); return@forEach }
            val local = dao.note(remote.id)
            if (local == null) put("open_unknown:${remote.id}", "1")
            val pendingBody = protectedBody(remote.id)
            val pendingProp = propPending(remote.id)
            val base = local ?: remote.entity()
            var merged = base
            if (local == null || reconcile || remote.propVersion > base.propVersion) {
                if (!pendingProp) merged = merged.copy(groupId = remote.groupId, star = remote.star, top = remote.top,
                    skinColor = remote.skinColor, homeHidden = remote.homeHidden, invalid = remote.invalid, propVersion = remote.propVersion)
                else if (reconcile) merged = merged.copy(propVersion = 0)
            }
            if (!pendingBody) merged = merged.copy(title = remote.title, summary = remote.summary, thumbnail = remote.thumbnail)
            if (reconcile && bodyPending(remote.id)) merged = merged.copy(version = 0)
            merged = merged.copy(dirty = dirty(remote.id), updateTime = if (!pendingBody && !pendingProp) remote.updateTime else merged.updateTime)
            dao.putNote(merged)
            if (!pendingBody && (reconcile || dao.body(remote.id) == null || remote.version > merged.bodyVersion)) {
                put("required_body:${remote.id}", remote.version.toString()); required += remote.id
            }
        }
        required
    }
    fun pendingBodies() = dao.metas("required_body:").map { it.key.removePrefix("required_body:") }
    fun applyBodies(bodies: List<BodyDto>, reconcile: Boolean) = transaction {
        bodies.forEach { body ->
            val local = dao.note(body.noteId)
            if (local == null) { dao.deleteMeta("required_body:${body.noteId}"); return@forEach }
            if (protectedBody(body.noteId)) {
                if (reconcile && bodyPending(body.noteId)) dao.putNote(local.copy(version = 0))
                if (bodyPending(body.noteId)) dao.deleteMeta("required_body:${body.noteId}")
                return@forEach
            }
            // Requests can finish in any order. Refuse an older response or a body older than its page metadata.
            val expected = number("required_body:${body.noteId}")
            if ((!reconcile && body.version < local.bodyVersion) || body.version < expected) throw ApiError(0, "invalid_response")
            val previous = dao.body(body.noteId)?.markdown
            if (reconcile && previous != null && previous != body.content && previous.isNotBlank())
                dao.putHistory(HistoryEntity(noteId = body.noteId, markdown = previous, time = clock(), source = "server-recovery"))
            val fields = io.github.xilele777.snotes.core.model.derive(body.content)
            dao.putBody(BodyEntity(body.noteId, body.content))
            dao.putNote(local.copy(version = body.version, bodyVersion = body.version,
                title = fields.title, summary = fields.summary, thumbnail = fields.thumbnail))
            dao.deleteMeta("required_body:${body.noteId}")
        }
    }
    fun finishNotes(originalNotes: Set<String>, originalGroups: Set<String>, seenNotes: Set<String>, seenGroups: Set<String>,
        watermark: Long, checkpoint: String, reconcile: Boolean) = transaction {
        if (reconcile) {
            (originalNotes - seenNotes).forEach { id ->
                if (dao.task("note", id, "create") == null) tombstoneIn(id, true)
            }
            (originalGroups - seenGroups).forEach { id ->
                if (dao.tasks().none { it.entityType == "group" && it.entityId == id }) dao.deleteGroup(id)
            }
        }
        put("notes_since", watermark.toString()); put("notes_checkpoint", checkpoint)
        put("notes_initialized", "1"); dao.deleteMeta("reconcile_notes")
    }
    fun tombstone(id: String, missing: Boolean = false) = transaction { tombstoneIn(id, missing) }
    private fun tombstoneIn(id: String, missing: Boolean) {
        val body = dao.body(id)?.markdown
        if (body != null && (missing || protectedBody(id))) repository.syncCopyIn(body, "recovery:$id:${digest(body)}")
        dao.deleteNote(id); dao.deleteTasks("note", id); dao.deleteMeta("required_body:$id")
        dao.putNoteState(NoteStateEntity(id, "purged"))
        // Drafts and editor receipts remain as a separate recovery channel.
    }

    fun prepare(queued: TaskEntity): SentTask? = transaction {
        val current = dao.taskById(queued.id) ?: return@transaction null
        if (current.seq != queued.seq || current.failed != 0 || current.nextAt > clock()) return@transaction null
        val note = dao.note(current.entityId)
        val raw = syncJson.parseToJsonElement(current.payload).jsonObject
        var payload = raw
        if (current.entityType == "note") {
            if (note == null && current.kind != "purge") return@transaction null
            payload = JsonObject(raw + when (current.kind) {
                "body" -> mapOf("base_version" to JsonPrimitive(checkNotNull(note).version))
                "prop" -> mapOf("base_prop_version" to JsonPrimitive(checkNotNull(note).propVersion))
                else -> emptyMap()
            })
        } else if (current.kind == "create") {
            // M2's local group payload names differ from the public wire contract.
            payload = buildJsonObject {
                put("group_id", current.entityId); put("name", raw.getValue("name"))
                put("ord", raw["sort"] ?: JsonPrimitive(0)); put("color", raw["color"] ?: JsonNull)
                put("hide_from_home", raw["home_hidden"] ?: JsonPrimitive(0))
            }
        }
        val sent = SentTask(current.id, current.seq, current.entityType, current.entityId, current.kind, payload)
        put("sent:${current.id}", syncJson.encodeToString(sent))
        sent
    }
    fun ack(sent: SentTask, ack: WriteAck) = transaction {
        if (sent.entityType == "note" && sent.kind in setOf("body", "create")) {
            require(ack.version != null && ack.propVersion != null) { "invalid_response" }
            if (ack.conflicted && ack.previousContent != null) repository.syncCopyIn(ack.previousContent,
                "conflict:${sent.entityId}:${digest(ack.previousContent)}")
        }
        val task = dao.taskById(sent.id)
        val unchanged = task?.seq == sent.seq
        if (unchanged) dao.consumeTask(sent.id, sent.seq)
        if (sent.entityType == "note") {
            val note = dao.note(sent.entityId)
            if (note != null) {
                val created = sent.kind == "create" && !ack.replayed
                val acceptedBody = sent.kind == "body" || created
                var updated = note.copy(dirty = dirty(note.id))
                if (acceptedBody && ack.version != null) updated = updated.copy(version = maxOf(note.version, ack.version),
                    bodyVersion = if (!bodyPending(note.id)) ack.version else note.bodyVersion)
                if (created && ack.propVersion != null) updated = updated.copy(propVersion = maxOf(note.propVersion, ack.propVersion))
                if (updated.dirty == "none" && unchanged) updated = updated.copy(updateTime = ack.updateTime)
                // replayed create did not accept this payload; pull the true remote body without inventing a baseline.
                if (sent.kind == "create" && ack.replayed && !bodyPending(note.id)) put("required_body:${note.id}", (ack.version ?: 0).toString())
                dao.putNote(updated)
            }
        } else if (unchanged) dao.group(sent.entityId)?.let { dao.putGroup(it.copy(dirty = false)) }
        dao.deleteMeta("sent:${sent.id}")
    }
    fun fail(sent: SentTask, error: ApiError) = transaction {
        val current = dao.taskById(sent.id)
        if (current?.seq == sent.seq) {
            val permanent = error.status in 400..499 && !isRetriableStatus(error.status)
            dao.putTask(current.copy(failed = if (permanent) 1 else 0, retry = if (permanent) current.retry else current.retry + 1,
                nextAt = if (permanent) 0 else maxOf(error.retryAt ?: 0, clock() + backoffDelay(current.retry)),
                lastError = error.message, failedAt = clock()))
        }
        // The immutable sent snapshot remains when the outcome is uncertain.
    }
    fun retry(includeFailed: Boolean) = transaction {
        dao.tasks().filter { includeFailed || it.failed == 0 }.forEach { dao.putTask(it.copy(failed = 0, nextAt = 0)) }
    }
    fun applyBook(remote: BookRemoteDto) = transaction {
        validateToc(remote)
        val book = remote.book
        io.github.xilele777.snotes.core.data.BookRepository(repository).acceptRemote(remote)
        remote.noteStates.forEach { (id, state) ->
            dao.putNoteState(NoteStateEntity(id, state))
            if (state == "purged") tombstoneIn(id, false)
        }
        remote.deletedNoteIds.forEach { tombstoneIn(it, false) }
    }
    fun finishBooks(original: Set<String>, seen: Set<String>, until: Long, checkpoint: String, reconcile: Boolean) = transaction {
        if (reconcile) (original - seen).forEach { id ->
            if (dao.tasks().any { it.entityType == "book" && it.entityId == id }) return@forEach
            // A missing book alone is not evidence that its referenced notes were purged.
            dao.clearToc(id); dao.deleteBook(id); dao.deleteMeta("book:$id")
        }
        put("books_since", until.toString()); put("books_checkpoint", checkpoint); put("books_initialized", "1")
        dao.deleteMeta("reconcile_books")
    }
}

private fun NoteMeta.entity() = NoteEntity(id, groupId, title, summary, thumbnail, version = 0, propVersion = propVersion,
    star = star, top = top, skinColor = skinColor, homeHidden = homeHidden, invalid = invalid,
    createTime = createTime, updateTime = updateTime, dirty = "none")
private fun digest(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

fun validateToc(remote: BookRemoteDto) {
    val toc = remote.toc; safeId(toc.bookId); safeNumber(toc.version); safeNumber(toc.updateTime)
    require(toc.bookId == remote.book.id && toc.version == remote.book.tocVersion && toc.nodes.size <= 1000)
    require(syncJson.encodeToString(toc.nodes).toByteArray(Charsets.UTF_8).size <= 1_048_576)
    val ids = mutableSetOf<String>(); val notes = mutableSetOf<String>()
    toc.nodes.forEach { node ->
        safeId(node.id); require(ids.add(node.id) && node.ord in 0..1000)
        node.parentId?.let(::safeId)
        when (node.kind) {
            "folder" -> require(node.noteId == null && !node.title.isNullOrBlank() && node.title.length <= 100)
            "note" -> { safeId(checkNotNull(node.noteId)); require(notes.add(node.noteId) && node.title == null) }
            else -> error("invalid_toc_kind")
        }
    }
    val byId = toc.nodes.associateBy { it.id }
    toc.nodes.forEach { node ->
        val ancestors = mutableSetOf(node.id); var parent = node.parentId; var depth = 1
        while (parent != null) {
            val folder = checkNotNull(byId[parent]); require(folder.kind == "folder" && ancestors.add(parent) && ++depth <= 8)
            parent = folder.parentId
        }
    }
    remote.noteStates.forEach { (id, state) -> safeId(id); require(state in setOf("available", "trash", "purged")) }
    require(notes.all { it in remote.noteStates })
    remote.deletedNoteIds.forEach(::safeId)
}
