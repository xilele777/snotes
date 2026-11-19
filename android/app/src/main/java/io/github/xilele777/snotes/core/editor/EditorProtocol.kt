package io.github.xilele777.snotes.core.editor

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

const val EDITOR_ORIGIN = "https://appassets.androidplatform.net"
const val EDITOR_URL = "$EDITOR_ORIGIN/assets/editor/index.html"
const val MAX_EDITOR_CHARS = 2_000_000

@Serializable
data class SessionKey(val profileId: String, val noteId: String, val sessionId: String)

@Serializable
data class DraftSnapshot(val key: SessionKey, val revision: Long, val baseline: String, val markdown: String, val composing: Boolean = false)

sealed interface EditorMessage {
    data object Ready : EditorMessage
    data class Loaded(val key: SessionKey) : EditorMessage
    data class Change(val key: SessionKey, val revision: Long, val markdown: String, val composing: Boolean) : EditorMessage
    data class Flushed(val key: SessionKey, val requestId: String, val revision: Long, val markdown: String, val composing: Boolean) : EditorMessage
    data class FlushError(val key: SessionKey, val requestId: String) : EditorMessage
    data class Mode(val key: SessionKey, val mode: String) : EditorMessage
    data class OpenLink(val key: SessionKey, val url: String) : EditorMessage
}

object EditorProtocol {
    private val json = Json
    private fun JsonObject.string(name: String, max: Int = 128): String? =
        (get(name) as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { it.length <= max }
    private fun JsonObject.revision(): Long? = (get("revision") as? JsonPrimitive)
        ?.takeUnless { it.isString }?.longOrNull?.takeIf { it in 0..Int.MAX_VALUE.toLong() }
    private fun JsonObject.composing(): Boolean? = (get("composing") as? JsonPrimitive)?.takeUnless { it.isString }?.booleanOrNull

    fun decode(data: String, trustedOrigin: Boolean, isMainFrame: Boolean): EditorMessage? {
        if (!trustedOrigin || !isMainFrame || data.length > MAX_EDITOR_CHARS * 6 + 4096) return null
        return runCatching {
            val objectValue = json.parseToJsonElement(data) as? JsonObject ?: return null
            if (objectValue["bridgeVersion"] != JsonPrimitive(1)) return null
            val type = objectValue.string("type") ?: return null
            if (type == "ready") {
                val modes = objectValue["modes"] as? JsonArray ?: return null
                return if (JsonPrimitive("source") in modes && modes.size <= 3) EditorMessage.Ready else null
            }
            val key = SessionKey(
                objectValue.string("profileId")?.takeIf { it.isNotBlank() } ?: return null,
                objectValue.string("noteId")?.takeIf { it.isNotBlank() } ?: return null,
                objectValue.string("sessionId")?.takeIf { it.isNotBlank() } ?: return null,
            )
            when (type) {
                "loaded" -> if (objectValue.revision() == 0L) EditorMessage.Loaded(key) else null
                "change" -> EditorMessage.Change(key, objectValue.revision() ?: return null,
                    objectValue.string("markdown", MAX_EDITOR_CHARS) ?: return null, objectValue.composing() ?: return null)
                "flushed" -> EditorMessage.Flushed(key, objectValue.string("requestId") ?: return null,
                    objectValue.revision() ?: return null, objectValue.string("markdown", MAX_EDITOR_CHARS) ?: return null,
                    objectValue.composing() ?: return null)
                "flushError" -> EditorMessage.FlushError(key, objectValue.string("requestId") ?: return null)
                "mode" -> objectValue.string("mode")?.takeIf { it in setOf("source", "preview", "ir") }?.let { EditorMessage.Mode(key, it) }
                "openLink" -> objectValue.string("url", 4096)?.let { EditorMessage.OpenLink(key, it) }
                else -> null
            }
        }.getOrNull()
    }

    fun nativeMessage(type: String, key: SessionKey, fields: Map<String, JsonElement> = emptyMap()): String = buildJsonObject {
        put("bridgeVersion", 1); put("type", type)
        put("profileId", key.profileId); put("noteId", key.noteId); put("sessionId", key.sessionId)
        fields.forEach { (name, value) -> put(name, value) }
    }.toString()
}
