package io.github.xilele777.snotes.core.data

import io.github.xilele777.snotes.core.database.SyncMetaEntity
import io.github.xilele777.snotes.core.network.*
import java.util.UUID
import javax.inject.Inject
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName
import kotlinx.serialization.encodeToString

@Serializable data class OpenItem(@SerialName("note_id") val id: String, val count: Long, @SerialName("last_open_time") val lastTime: Long)
@Serializable data class OpenRequest(@SerialName("device_id") val device: String, val since: Long, val items: List<OpenItem>, val want: List<String>)
@Serializable data class OpenAggregate(@SerialName("note_id") val id: String, @SerialName("others_count") val count: Long, @SerialName("others_last_open_time") val time: Long)
@Serializable data class OpenResponse(val opens: List<OpenAggregate>, @SerialName("server_time") val time: Long)
class Opens @Inject constructor(private val repository: NotesRepository) {
    private val dao get() = repository.database.notes()
    fun record(id: String) = repository.syncTransaction {
        if (repository.note(id)?.invalid != 0) return@syncTransaction
        val previous = dao.meta("open_local:$id")?.let { syncJson.decodeFromString<OpenItem>(it) }
        val now = System.currentTimeMillis()
        if (previous != null && now - previous.lastTime < 60_000) return@syncTransaction
        val value = syncJson.encodeToString(OpenItem(id, (previous?.count ?: 0) + 1, now))
        dao.putMeta(SyncMetaEntity("open_local:$id", value)); dao.putMeta(SyncMetaEntity("open_dirty:$id", value))
        repository.requestSync()
    }
    fun count(id: String): Long = (dao.meta("open_local:$id")?.let { syncJson.decodeFromString<OpenItem>(it).count } ?: 0) +
        (dao.meta("open_others:$id")?.let { syncJson.decodeFromString<OpenAggregate>(it).count } ?: 0)
    suspend fun sync(client: ApiClient, epoch: String) {
        val request = repository.syncTransaction {
            val device = dao.meta("opens_device") ?: UUID.randomUUID().toString().also { dao.putMeta(SyncMetaEntity("opens_device", it)) }
            val items = dao.metas("open_dirty:").take(500).map { syncJson.decodeFromString<OpenItem>(it.value) }.filter { repository.note(it.id) != null }
            val want = dao.metas("open_unknown:").take(90).map { it.key.removePrefix("open_unknown:") }.filter { repository.note(it) != null }
            OpenRequest(device, dao.meta("opens_since")?.toLongOrNull() ?: 0, items, want)
        }
        val response = client.call { opens(epoch, request) }
        safeNumber(response.time)
        response.opens.forEach { safeId(it.id); safeNumber(it.count); safeNumber(it.time) }
        repository.syncTransaction {
            response.opens.forEach { if (repository.note(it.id) != null) dao.putMeta(SyncMetaEntity("open_others:${it.id}", syncJson.encodeToString(it))); dao.deleteMeta("open_unknown:${it.id}") }
            request.items.forEach { if (dao.meta("open_dirty:${it.id}") == syncJson.encodeToString(it)) dao.deleteMeta("open_dirty:${it.id}") }
            dao.putMeta(SyncMetaEntity("opens_since", response.time.toString()))
        }
    }
}
