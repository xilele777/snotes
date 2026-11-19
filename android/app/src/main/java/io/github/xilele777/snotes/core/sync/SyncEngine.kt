package io.github.xilele777.snotes.core.sync

import io.github.xilele777.snotes.core.network.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import java.util.concurrent.atomic.AtomicReference

/** A single round. Coordinator owns its lifetime; reads and uploads never hold a database transaction. */
class SyncEngine(private val store: SyncStore, private val client: ApiClient, private val stopped: () -> Boolean = { false }) {
    private fun checkRunning() { if (stopped()) throw CancellationException("sync_stopped") }
    suspend fun run() {
        try { runRound() }
        catch (error: ApiError) {
            if (error.status == 401) store.transaction { store.put("requires_auth", "1") }
            if (error.code == "sync_reset_required") store.markRecovery()
            throw error
        }
    }
    private suspend fun runRound() {
        checkRunning()
        if (store.meta("requires_auth") == "1") throw ApiError(401, "http_error")
        val epoch = preflight()
        checkRunning()
        push(epoch)
        checkRunning()
        pullNotes(false)
        checkRunning()
        pullBooks(false)
    }
    private suspend fun preflight(): String {
        val epoch = client.call(true) { instance() }.epoch
        if (store.meta("accepted_epoch") != epoch && store.meta("pending_epoch") != epoch) store.markRecovery(epoch)
        val notesValid = client.call(true) { checkpoint(CheckpointRequest(store.number("notes_since"), store.meta("notes_checkpoint"))) }.valid
        val booksValid = client.call(true) { booksCheckpoint(CheckpointRequest(store.number("books_since"), store.meta("books_checkpoint"))) }.valid
        store.transaction {
            if (!notesValid || store.meta("notes_initialized") != "1") store.put("reconcile_notes", "1")
            if (!booksValid || store.meta("books_initialized") != "1") store.put("reconcile_books", "1")
            if (store.meta("reconcile_notes") == "1" || store.meta("reconcile_books") == "1") {
                store.put("pending_epoch", epoch); store.dao.deleteMeta("accepted_epoch")
            }
        }
        if (store.meta("reconcile_notes") == "1") pullNotes(true)
        if (store.meta("reconcile_books") == "1") pullBooks(true)
        checkRunning()
        if (client.call(true) { instance() }.epoch != epoch) {
            store.markRecovery(); throw ApiError(409, "sync_reset_required")
        }
        // A restore can happen while the other domain is being inventoried without changing its watermark.
        val finalNotes = client.call(true) { checkpoint(CheckpointRequest(store.number("notes_since"), store.meta("notes_checkpoint"))) }.valid
        val finalBooks = client.call(true) { booksCheckpoint(CheckpointRequest(store.number("books_since"), store.meta("books_checkpoint"))) }.valid
        if (!finalNotes || !finalBooks) { store.markRecovery(); throw ApiError(409, "sync_reset_required") }
        store.transaction {
            check(store.meta("reconcile_notes") != "1" && store.meta("reconcile_books") != "1")
            store.put("accepted_epoch", epoch); store.dao.deleteMeta("pending_epoch")
        }
        return epoch
    }
    private suspend fun pullNotes(reconcile: Boolean) {
        val since = if (reconcile) 0 else store.number("notes_since")
        val checkpoint = if (reconcile) null else store.meta("notes_checkpoint")
        val originals = if (reconcile) store.transaction { store.dao.allNotes().map { it.id }.toSet() to store.dao.allGroups().map { it.id }.toSet() } else emptySet<String>() to emptySet()
        val seenNotes = mutableSetOf<String>(); val seenGroups = mutableSetOf<String>()
        val cursors = mutableSetOf<String>(); var cursor: String? = null
        var first: PullDto? = null
        do {
            checkRunning()
            val page = client.call(true) { pull(PullRequest(since, checkpoint, cursor)) }
            if (first == null) first = page
            if (!reconcile && page.serverTime < since) { store.markRecovery(); throw ApiError(409, "sync_reset_required") }
            seenNotes += page.notes.map { it.id }; seenGroups += page.groups.map { it.id }
            store.applyPage(page, reconcile)
            cursor = page.nextCursor
            if (cursor != null && !cursors.add(cursor)) throw ApiError(0, "invalid_response")
        } while (cursor != null)
        // Durable download obligations survive a crash after metadata application or a missing body response.
        val batches = store.pendingBodies().distinct().chunked(50)
        concurrent(batches) { ids ->
            checkRunning()
            val response = client.call { bodies(BodiesRequest(ids)) }
            val byId = response.bodies.associateBy { it.noteId }
            if (byId.size != response.bodies.size || byId.keys != ids.toSet()) throw ApiError(0, "missing_bodies")
            store.applyBodies(response.bodies, reconcile)
        }
        if (store.pendingBodies().isNotEmpty()) throw ApiError(0, "draft_pending")
        val boundary = checkNotNull(first)
        if (reconcile && !client.call(true) { checkpoint(CheckpointRequest(boundary.serverTime, boundary.checkpoint, true)) }.valid) {
            store.markRecovery(); throw ApiError(409, "sync_reset_required")
        }
        store.finishNotes(originals.first, originals.second, seenNotes, seenGroups, boundary.serverTime, boundary.checkpoint, reconcile)
    }
    private suspend fun pullBooks(reconcile: Boolean) {
        val original = if (reconcile) store.transaction { store.dao.books().map { it.id }.toSet() } else emptySet()
        val since = if (reconcile) 0 else store.number("books_since")
        val checkpoint = if (reconcile) null else store.meta("books_checkpoint")
        var until: Long? = null; var first: BooksDto? = null
        var after = since; var afterId: String? = null
        val seen = mutableSetOf<String>(); val cursors = mutableSetOf<String>()
        do {
            checkRunning()
            val page = client.call(true) { books(BooksRequest(since, checkpoint, after, until, reconcile, afterId)) }
            if (first == null) { first = page; until = page.until }
            if (page.until != until || page.until < since) { store.markRecovery(); throw ApiError(409, "sync_reset_required") }
            concurrent(page.books) { book ->
                checkRunning()
                val remote = client.call(true) { toc(book.id) }
                if (remote.book.id != book.id) throw ApiError(0, "invalid_response")
                // /toc is not a snapshot. A changed catalog requires another round, never missing-record inference.
                if (reconcile && (remote.book.metaVersion != book.metaVersion || remote.book.tocVersion != book.tocVersion || remote.book.changeSeq != book.changeSeq))
                    throw ApiError(409, "sync_reset_required")
                store.applyBook(remote)
            }
            seen += page.books.map { it.id }
            if (reconcile) {
                afterId = page.nextId
                if (afterId != null && !cursors.add(afterId)) throw ApiError(0, "invalid_response")
            } else {
                val next = page.nextAfter
                if (next != null && (next <= after || next > page.until)) throw ApiError(0, "invalid_response")
                after = next ?: after
            }
        } while (if (reconcile) afterId != null else page.nextAfter != null)
        val boundary = checkNotNull(first)
        if (reconcile && !client.call(true) { booksCheckpoint(CheckpointRequest(boundary.until, boundary.checkpoint, true)) }.valid) {
            store.markRecovery(); throw ApiError(409, "sync_reset_required")
        }
        store.finishBooks(original, seen, boundary.until, boundary.checkpoint, reconcile)
    }
    private suspend fun push(epoch: String) {
        val tasks = store.transaction { store.dao.tasks() }
        // Groups precede note chains that can reference them. A failed group dependency blocks its note.
        pushChains(tasks.filter { it.entityType == "group" }, epoch)
        checkRunning()
        pushChains(tasks.filter { it.entityType == "note" }, epoch)
    }
    private suspend fun pushChains(tasks: List<io.github.xilele777.snotes.core.database.TaskEntity>, epoch: String) {
        val failure = AtomicReference<Throwable?>(null)
        val chains = tasks.groupBy { it.entityType to it.entityId }.values.toList()
        concurrent(chains) { chain ->
            for (queued in chain) {
                if (failure.get() != null || stopped()) break
                val blocked = store.transaction {
                    val current = store.dao.taskById(queued.id)
                    if (current == null) false else current.failed != 0 || current.nextAt > System.currentTimeMillis() ||
                        store.dao.tasks().any { it.entityType == queued.entityType && it.entityId == queued.entityId && it.id < queued.id } ||
                        (queued.entityType == "note" && store.dao.note(queued.entityId)?.groupId?.let { group -> store.dao.tasks().any { it.entityType == "group" && it.entityId == group } } == true)
                }
                if (blocked) break
                val sent = store.prepare(queued) ?: break
                val content = sent.payload["content"]?.jsonPrimitive?.content
                if (content != null && !io.github.xilele777.snotes.core.model.noteFits(content)) {
                    store.fail(sent, ApiError(413, "too_large")); break
                }
                try {
                    val ack = client.call {
                        when {
                            sent.entityType == "group" && sent.kind == "create" -> createGroup(epoch, sent.payload)
                            sent.entityType == "group" && sent.kind == "prop" -> patchGroup(sent.entityId, epoch, sent.payload)
                            sent.entityType == "group" -> deleteGroup(sent.entityId, epoch)
                            sent.kind == "create" -> create(epoch, sent.payload)
                            sent.kind == "body" || sent.kind == "prop" -> patch(sent.entityId, epoch, sent.payload)
                            sent.kind == "trash" -> trash(sent.entityId, epoch, sent.payload)
                            sent.kind == "recover" -> recover(sent.entityId, epoch, sent.payload)
                            else -> throw ApiError(400, "unsupported_operation")
                        }
                    }
                    store.ack(sent, ack)
                } catch (error: ApiError) {
                    when {
                        error.status == 401 -> failure.compareAndSet(null, error)
                        error.status == 409 && error.code == "sync_reset_required" -> {
                            store.markRecovery(); failure.set(error)
                        }
                        error.status == 410 && sent.entityType == "note" -> store.tombstone(sent.entityId)
                        else -> {
                            store.fail(sent, error)
                            if (error.status == 404 && sent.kind != "body") store.markRecovery()
                            if (error.status == 0 || isRetriableStatus(error.status) || error.status == 404 && sent.kind != "body") failure.compareAndSet(null, error)
                        }
                    }
                    break
                } catch (error: Throwable) { failure.compareAndSet(null, error); throw error }
            }
        }
        failure.get()?.let { throw it }
    }
}

/** All workers settle before returning, including when one request or its ACK transaction fails. */
private suspend fun <T> concurrent(items: List<T>, block: suspend (T) -> Unit) = coroutineScope {
    var next = 0
    val monitor = Any()
    val failure = AtomicReference<Throwable?>(null)
    val workers = List(minOf(3, items.size)) {
        async {
            while (failure.get() == null) {
                val index = synchronized(monitor) { next++ }
                if (index >= items.size) break
                try { block(items[index]) } catch (error: Throwable) { failure.compareAndSet(null, error) }
            }
        }
    }
    workers.awaitAll()
    failure.get()?.let { throw it }
}
