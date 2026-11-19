package io.github.xilele777.snotes.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import io.github.xilele777.snotes.core.network.safeId
import io.github.xilele777.snotes.core.network.safeNumber

@Serializable
data class NoteMeta(
    val id: String,
    @SerialName("group_id") val groupId: String? = null,
    val title: String,
    val summary: String,
    val thumbnail: String? = null,
    val version: Long,
    @SerialName("prop_version") val propVersion: Long,
    val star: Int,
    val top: Int,
    @SerialName("skin_color") val skinColor: String? = null,
    @SerialName("home_hidden") val homeHidden: Int? = null,
    val invalid: Int,
    @SerialName("create_time") val createTime: Long,
    @SerialName("update_time") val updateTime: Long,
) {
    init {
        safeId(id)
        listOf(version, propVersion, createTime, updateTime).forEach(::safeNumber)
        require(star in 0..1 && top in 0..1 && invalid in 0..2 && (homeHidden == null || homeHidden in 0..1))
    }
}

@Serializable
data class LocalNoteState(
    val id: String,
    val version: Long,
    @SerialName("body_version") val bodyVersion: Long,
    @SerialName("prop_version") val propVersion: Long,
    @SerialName("body_pending") val bodyPending: Boolean,
)

data class PullPlan(
    val insert: List<NoteMeta> = emptyList(),
    val updateProp: List<NoteMeta> = emptyList(),
    val deleteLocal: List<NoteMeta> = emptyList(),
    val fetchBody: List<String> = emptyList(),
)

@Serializable
enum class OutboxKind {
    @SerialName("create") CREATE,
    @SerialName("body") BODY,
    @SerialName("prop") PROP,
    @SerialName("trash") TRASH,
    @SerialName("recover") RECOVER,
    @SerialName("purge") PURGE,
}

@Serializable
data class OutboxTask(
    val id: Long? = null,
    @SerialName("note_id") val noteId: String,
    val kind: OutboxKind,
    val payload: JsonElement,
    val retry: Int,
    @SerialName("next_at") val nextAt: Long,
    val seq: Long,
    val failed: Int,
    @SerialName("last_error") val lastError: String? = null,
    @SerialName("failed_at") val failedAt: Long? = null,
)

@Serializable
data class DerivedFields(val title: String, val summary: String, val thumbnail: String? = null)
