package io.github.xilele777.snotes.core.data

import io.github.xilele777.snotes.core.database.*
import io.github.xilele777.snotes.core.editor.*
import io.github.xilele777.snotes.core.network.*
import java.io.File
import java.util.UUID
import javax.inject.Inject
import kotlinx.serialization.json.*
import okhttp3.MultipartBody
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody

class SharedImages @Inject constructor(private val repository: NotesRepository, private val profile: LocalProfile) {
    /** Called only inside the coordinator's round lock after both sync domains passed their fences. */
    suspend fun drain(client: ApiClient, epoch: String) {
        val dao = repository.database.notes()
        for (entry in repository.syncTransaction { dao.metas("shared:") }) {
            val value = syncJson.parseToJsonElement(entry.value).jsonObject
            if (value["failed"]?.jsonPrimitive?.booleanOrNull == true) continue
            val id = value.getValue("note_id").jsonPrimitive.content
            val name = value.getValue("file").jsonPrimitive.content
            require(name.matches(Regex("[A-Za-z0-9-]{1,128}")))
            val mime = value.getValue("mime").jsonPrimitive.content
            val file = File(profile.paths.directory, "shared/$name")
            val eligible = repository.syncTransaction { repository.note(id)?.invalid == 0 && !repository.editorActive(id) && !repository.hasUncommittedDraft(id) && dao.task("note", id, "create") == null }
            if (!eligible) continue
            val receiptKey = "shared_uploaded:$name"
            var url = dao.meta(receiptKey)
            if (url == null) {
                val bytes = file.inputStream().use { it.readBounded(MAX_IMAGE_BYTES) }
                val extension = when (mime) { "image/jpeg" -> "jpg"; "image/png" -> "png"; "image/gif" -> "gif"; "image/webp" -> "webp"; else -> error("分享图片类型无效") }
                val result = try { client.call { uploadImage(epoch, MultipartBody.Part.createFormData("file", "shared.$extension", bytes.toRequestBody(mime.toMediaType())), id.toRequestBody("text/plain".toMediaType())) } }
                catch (error: ApiError) {
                    if (error.status in 400..499 && error.status !in setOf(401, 408, 409, 429)) {
                        repository.syncTransaction { dao.putMeta(entry.copy(value = JsonObject(value + mapOf("failed" to JsonPrimitive(true), "error" to JsonPrimitive(error.message))).toString())) }
                        continue
                    }
                    throw error
                }
                require(validImageKey(result.fileKey) && result.url == "/api/images/${result.fileKey}")
                url = result.url
                repository.syncTransaction { dao.putMeta(SyncMetaEntity(receiptKey, result.url)) }
            }
            repository.syncTransaction {
                if (repository.editorActive(id) || repository.hasUncommittedDraft(id) || repository.note(id)?.invalid != 0) return@syncTransaction
                val baseline = checkNotNull(repository.body(id))
                val snapshot = DraftSnapshot(SessionKey(repository.profileId, id, UUID.randomUUID().toString()), 1, baseline, "$baseline\n\n![分享图片]($url)\n")
                repository.commit(snapshot)
                dao.deleteMeta(entry.key); dao.deleteMeta(receiptKey)
            }
            if (dao.meta(entry.key) == null) file.delete()
        }
    }
}
