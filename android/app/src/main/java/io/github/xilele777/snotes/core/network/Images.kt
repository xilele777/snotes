package io.github.xilele777.snotes.core.network

import android.content.Context
import android.net.Uri
import android.util.AtomicFile
import dagger.hilt.android.qualifiers.ApplicationContext
import io.github.xilele777.snotes.BuildConfig
import io.github.xilele777.snotes.core.data.NotesRepository
import io.github.xilele777.snotes.core.data.readBounded
import io.github.xilele777.snotes.core.database.*
import io.github.xilele777.snotes.core.sync.SyncCoordinator
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.*
import okhttp3.MultipartBody
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody

const val MAX_IMAGE_BYTES = 10 * 1024 * 1024
fun validImageKey(key: String) = Regex("[A-Za-z0-9_-]{1,128}/[A-Za-z0-9_-]{1,128}\\.(?:jpg|jpeg|png|gif|webp)").matches(key)
fun imageMime(key: String) = when (key.substringAfterLast('.')) { "jpg", "jpeg" -> "image/jpeg"; "png" -> "image/png"; "gif" -> "image/gif"; "webp" -> "image/webp"; else -> null }
data class ImageBytes(val bytes: ByteArray, val mime: String)

@Singleton class Images @Inject constructor(@ApplicationContext private val context: Context,
    private val profile: LocalProfile, private val repository: NotesRepository,
    private val connections: ConnectionStore, private val sync: SyncCoordinator) {
    suspend fun read(key: String, expected: String): ImageBytes? = withContext(Dispatchers.IO) {
        if (!validImageKey(key)) return@withContext null
        val state = repository.syncTransaction {
            if (repository.profileId != expected) return@syncTransaction null
            Triple(File(profile.paths.images, key), runCatching { connections.read() }.getOrNull(), repository.database.notes().image(key))
        } ?: return@withContext null
        if (state.first.isFile) return@withContext ImageBytes(state.first.readBytes().takeIf { it.size <= MAX_IMAGE_BYTES } ?: return@withContext null, imageMime(key)!!)
        val connection = state.second ?: return@withContext null
        val client = ApiClient(instanceOrigin(connection.origin, BuildConfig.DEBUG), connection.token)
        try {
            val value = client.call { image(key) }.use { body ->
                require(body.contentLength() <= MAX_IMAGE_BYTES)
                val bytes = body.byteStream().readBounded(MAX_IMAGE_BYTES)
                require(bytes.size <= MAX_IMAGE_BYTES)
                ImageBytes(bytes, imageMime(key)!!)
            }
            repository.syncTransaction {
                if (repository.profileId != expected) return@syncTransaction
                writeCache(state.first, value.bytes)
                repository.database.notes().putImage(ImageEntity(key, value.mime, value.bytes.size.toLong(), "cached"))
            }
            value
        } catch (_: Exception) { null } finally { client.close() }
    }
    suspend fun upload(uri: Uri, noteId: String, expected: String): String = withContext(Dispatchers.IO) {
        val mime = context.contentResolver.getType(uri)
        require(mime in setOf("image/jpeg", "image/png", "image/gif", "image/webp")) { "请选择 JPG、PNG、GIF 或 WebP 图片" }
        val bytes = checkNotNull(context.contentResolver.openInputStream(uri)).use { it.readBounded(MAX_IMAGE_BYTES) }
        uploadBytes(bytes, checkNotNull(mime), noteId, expected)
    }
    suspend fun uploadBytes(bytes: ByteArray, mime: String, noteId: String, expected: String): String {
        require(bytes.size in 1..MAX_IMAGE_BYTES)
        sync.synchronize(expected)
        return sync.withCurrentClient(expected) { client, epoch ->
            val part = MultipartBody.Part.createFormData("file", "image.${when(mime) { "image/jpeg" -> "jpg"; "image/png" -> "png"; "image/gif" -> "gif"; "image/webp" -> "webp"; else -> error("不支持的图片格式") }}", bytes.toRequestBody(mime.toMediaType()))
            val value = client.call { uploadImage(epoch, part, noteId.toRequestBody("text/plain".toMediaType())) }
            require(validImageKey(value.fileKey) && value.url == "/api/images/${value.fileKey}" && value.mime == mime && value.size == bytes.size.toLong())
            repository.syncTransaction {
                check(repository.profileId == expected)
                writeCache(File(profile.paths.images, value.fileKey), bytes)
                repository.database.notes().putImage(ImageEntity(value.fileKey, mime, value.size, "cached"))
            }
            value.url
        }
    }
    private fun writeCache(file: File, bytes: ByteArray) {
        check(file.parentFile!!.isDirectory || file.parentFile!!.mkdirs())
        val atomic = AtomicFile(file); val output = atomic.startWrite()
        try { output.write(bytes); atomic.finishWrite(output) } catch (error: Exception) { atomic.failWrite(output); throw error }
    }
}
