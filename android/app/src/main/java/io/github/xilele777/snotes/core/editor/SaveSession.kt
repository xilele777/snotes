package io.github.xilele777.snotes.core.editor

import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class SavePhase { SAVING, SAVED, ERROR }
data class SaveEvent(val snapshot: DraftSnapshot, val phase: SavePhase, val reason: String? = null)
data class SaveResult(val saved: Boolean, val revision: Long)

/** One actor owns journal and repository writes, including explicit navigation flushes. */
class SaveSession(private val store: DraftStore, scope: CoroutineScope, dispatcher: CoroutineDispatcher = Dispatchers.IO) {
    private sealed interface Command {
        data object Change : Command
        data class Flush(val snapshot: DraftSnapshot, val result: CompletableDeferred<SaveResult>) : Command
    }
    private val commands = Channel<Command>(Channel.UNLIMITED)
    private val latestChanges = linkedMapOf<SessionKey, DraftSnapshot>()
    private var changeScheduled = false
    private val mutableEvent = MutableStateFlow<SaveEvent?>(null)
    val event = mutableEvent.asStateFlow()
    private val bases = mutableMapOf<SessionKey, String>()
    private val receipts = mutableMapOf<SessionKey, Long>()
    private val worker = scope.launch(dispatcher) {
        var pending: DraftSnapshot? = null
        while (isActive) {
            val command = if (pending != null && !pending.composing) withTimeoutOrNull(800) { commands.receive() } else commands.receive()
            if (command == null) { persist(checkNotNull(pending)); pending = null; continue }
            when (command) {
                Command.Change -> {
                    val changes = synchronized(latestChanges) {
                        latestChanges.values.toList().also { latestChanges.clear(); changeScheduled = false }
                    }
                    for (snapshot in changes) {
                        if (pending != null && pending.key != snapshot.key) persist(pending)
                        pending = rebased(snapshot)
                        stage(pending)
                    }
                }
                is Command.Flush -> {
                    if (pending != null && pending.key != command.snapshot.key) persist(pending)
                    val latest = pending?.takeIf { it.key == command.snapshot.key && it.revision > command.snapshot.revision } ?: command.snapshot
                    val snapshot = rebased(latest)
                    val result = persist(snapshot)
                    pending = null
                    command.result.complete(result)
                }
            }
        }
    }

    fun changed(snapshot: DraftSnapshot) {
        // Coalesce full-text changes per session before IO, never navigation
        // flushes. Queue entries are lightweight markers, not every keystroke.
        synchronized(latestChanges) {
            latestChanges[snapshot.key] = snapshot
            if (!changeScheduled) {
                changeScheduled = true
                if (!commands.trySend(Command.Change).isSuccess) {
                    changeScheduled = false
                    mutableEvent.value = SaveEvent(snapshot, SavePhase.ERROR)
                }
            }
        }
    }
    suspend fun flush(snapshot: DraftSnapshot): SaveResult {
        val result = CompletableDeferred<SaveResult>()
        commands.send(Command.Flush(snapshot, result))
        return result.await()
    }
    private fun rebased(snapshot: DraftSnapshot): DraftSnapshot = snapshot.copy(baseline = bases.getOrPut(snapshot.key) { snapshot.baseline })
    private fun stage(snapshot: DraftSnapshot): Boolean = try {
        mutableEvent.value = SaveEvent(snapshot, SavePhase.SAVING)
        store.stage(snapshot)
        true
    } catch (_: Exception) {
        mutableEvent.value = SaveEvent(snapshot, SavePhase.ERROR)
        false
    }
    private fun persist(snapshot: DraftSnapshot): SaveResult {
        if ((receipts[snapshot.key] ?: -1) >= snapshot.revision) return SaveResult(true, snapshot.revision)
        // Untouched revision zero does not create a save, even if a renderer normalized it.
        if (snapshot.revision == 0L && snapshot.markdown == snapshot.baseline) return SaveResult(true, 0)
        if (!stage(snapshot)) return SaveResult(false, snapshot.revision)
        return try {
            store.commit(snapshot)
            bases[snapshot.key] = snapshot.markdown
            receipts[snapshot.key] = snapshot.revision
            mutableEvent.value = SaveEvent(snapshot, SavePhase.SAVED)
            // Cleanup failure cannot revoke a durable commit; receipts prevent replay on restart.
            runCatching { store.clear(snapshot) }
            SaveResult(true, snapshot.revision)
        } catch (failure: Exception) {
            mutableEvent.value = SaveEvent(snapshot, SavePhase.ERROR,
                if (failure is IllegalArgumentException) failure.message else null)
            SaveResult(false, snapshot.revision)
        }
    }
    // Cancel the suspended receiver first; closing a live channel could resume
    // it with ClosedReceiveChannelException before cancellation reaches it.
    fun close() { worker.cancel(); commands.close() }
}
