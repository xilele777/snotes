package io.github.xilele777.snotes.core.sync

import io.github.xilele777.snotes.core.model.LocalNoteState
import io.github.xilele777.snotes.core.model.NoteMeta
import io.github.xilele777.snotes.core.model.OutboxTask
import io.github.xilele777.snotes.core.model.PullPlan

/** Port of shared/sync-reduce.ts. Planning never applies remote bodies itself. */
fun planPull(remote: List<NoteMeta>, local: Map<String, LocalNoteState>): PullPlan {
    val insert = mutableListOf<NoteMeta>()
    val updateProp = mutableListOf<NoteMeta>()
    val deleteLocal = mutableListOf<NoteMeta>()
    val fetchBody = mutableListOf<String>()
    for (note in remote) {
        if (note.invalid == 2) {
            if (local.containsKey(note.id)) deleteLocal += note
            continue
        }
        val current = local[note.id]
        if (current == null) {
            insert += note
            fetchBody += note.id
            continue
        }
        if (note.propVersion > current.propVersion) updateProp += note
        if (note.version > current.bodyVersion && !current.bodyPending) fetchBody += note.id
    }
    return PullPlan(insert, updateProp, deleteLocal, fetchBody)
}

/** Prop payload accumulation belongs to the Repository, as on the Web client. */
fun mergeTask(existing: OutboxTask?, incoming: OutboxTask): OutboxTask = incoming.copy(
    id = existing?.id,
    retry = 0,
    nextAt = 0,
    failed = 0,
    seq = Math.addExact(existing?.seq ?: 0, 1),
)

fun backoffDelay(retry: Int): Long {
    val exponent = retry.coerceAtLeast(0)
    return if (exponent >= 10) 600_000 else minOf(1_000L shl exponent, 600_000L)
}

fun isRetriableStatus(status: Int): Boolean = status == 408 || status == 429 || status >= 500
