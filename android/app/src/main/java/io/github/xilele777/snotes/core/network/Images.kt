package io.github.xilele777.snotes.core.network

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.AtomicFile
import android.util.LruCache
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import dagger.hilt.android.qualifiers.ApplicationContext
import io.github.xilele777.snotes.BuildConfig
import io.github.xilele777.snotes.core.data.NotesRepository
import io.github.xilele777.snotes.core.data.readBounded
import io.github.xilele777.snotes.core.database.*
import io.github.xilele777.snotes.core.sync.SyncCoordinator
import java.io.ByteArrayOutputStream
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.max
import kotlin.math.roundToInt
import kotlinx.coroutines.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody

const val MAX_IMAGE_BYTES = 10 * 1024 * 1024
const val MAX_IMAGE_CACHE_BYTES = 128L * 1024 * 1024
private const val COMPRESS_MAX_EDGE = 1600
private const val COMPRESS_JPEG_QUALITY = 82
private const val COMPRESS_SKIP_BYTES = 512 * 1024

fun validImageKey(key: String) = Regex("[A-Za-z0-9_-]{1,128}/[A-Za-z0-9_-]{1,128}\\.(?:jpg|jpeg|png|gif|webp)").matches(key)
fun imageMime(key: String) = when (key.substringAfterLast('.')) {
    "jpg", "jpeg" -> "image/jpeg"
    "png" -> "image/png"
    "gif" -> "image/gif"
    "webp" -> "image/webp"
    else -> null
}

data class ImageBytes(val bytes: ByteArray, val mime: String)

/**
 * Downscale to longest edge <= 1600px and compress (matching Web `src/editor/compress.ts`).
 * GIFs are kept intact to preserve animation; PNGs preserve alpha; others encode to JPEG @ 82%.
 */
internal fun compressImageBytes(bytes: ByteArray, mime: String): ImageBytes {
    if (mime == "image/gif") return ImageBytes(bytes, mime)
    return runCatching {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        val width = bounds.outWidth
        val height = bounds.outHeight
        if (width <= 0 || height <= 0) return ImageBytes(bytes, mime)
        val maxDim = max(width, height)
        if (maxDim <= COMPRESS_MAX_EDGE && bytes.size < COMPRESS_SKIP_BYTES) {
            return ImageBytes(bytes, mime)
        }
        var sampleSize = 1
        while (maxDim / (sampleSize * 2) >= COMPRESS_MAX_EDGE) {
            sampleSize *= 2
        }
        val decodeOpts = BitmapFactory.Options().apply {
            inSampleSize = sampleSize
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, decodeOpts) ?: return ImageBytes(bytes, mime)
        val decodedMax = max(decoded.width, decoded.height)
        val scale = (COMPRESS_MAX_EDGE.toFloat() / decodedMax.toFloat()).coerceAtMost(1f)
        val scaled = if (scale < 1f) {
            val targetW = (decoded.width * scale).roundToInt().coerceAtLeast(1)
            val targetH = (decoded.height * scale).roundToInt().coerceAtLeast(1)
            Bitmap.createScaledBitmap(decoded, targetW, targetH, true).also {
                if (it !== decoded) decoded.recycle()
            }
        } else {
            decoded
        }
        val out = ByteArrayOutputStream(bytes.size.coerceAtMost(256 * 1024))
        val outputMime: String
        val format: Bitmap.CompressFormat
        val quality: Int
        if (mime == "image/png") {
            outputMime = "image/png"
            format = Bitmap.CompressFormat.PNG
            quality = 100
        } else {
            outputMime = "image/jpeg"
            format = Bitmap.CompressFormat.JPEG
            quality = COMPRESS_JPEG_QUALITY
        }
        val ok = scaled.compress(format, quality, out)
        scaled.recycle()
        val compressed = out.toByteArray()
        if (ok && compressed.isNotEmpty() && compressed.size < bytes.size) {
            ImageBytes(compressed, outputMime)
        } else {
            ImageBytes(bytes, mime)
        }
    }.getOrDefault(ImageBytes(bytes, mime))
}

@Singleton
class Images @Inject constructor(
    @ApplicationContext private val context: Context,
    private val profile: LocalProfile,
    private val repository: NotesRepository,
    private val connections: ConnectionStore,
    private val sync: SyncCoordinator,
) {
    private val thumbnailCache = LruCache<String, ImageBitmap>(64)

    fun cachedThumbnail(key: String, expected: String): ImageBitmap? =
        thumbnailCache.get("$expected:$key")

    suspend fun thumbnail(key: String, expected: String): ImageBitmap? = withContext(Dispatchers.IO) {
        val cacheKey = "$expected:$key"
        thumbnailCache.get(cacheKey)?.let { return@withContext it }
        val raw = read(key, expected) ?: return@withContext null
        runCatching {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(raw.bytes, 0, raw.bytes.size, bounds)
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return@runCatching null
            var sample = 1
            val maxEdge = max(bounds.outWidth, bounds.outHeight)
            while (maxEdge / (sample * 2) >= 160) sample *= 2
            val opts = BitmapFactory.Options().apply { inSampleSize = sample }
            val bitmap = BitmapFactory.decodeByteArray(raw.bytes, 0, raw.bytes.size, opts) ?: return@runCatching null
            bitmap.asImageBitmap().also { thumbnailCache.put(cacheKey, it) }
        }.getOrNull()
    }

    suspend fun read(key: String, expected: String): ImageBytes? = withContext(Dispatchers.IO) {
        if (!validImageKey(key) || repository.profileId != expected) return@withContext null
        val mime = imageMime(key) ?: return@withContext null
        val localFile = File(profile.paths.images, key)
        if (localFile.isFile) {
            val bytes = runCatching { localFile.readBytes() }.getOrNull()?.takeIf { it.size <= MAX_IMAGE_BYTES }
            if (bytes != null && repository.profileId == expected) {
                return@withContext ImageBytes(bytes, mime)
            }
        }
        val state = repository.syncTransaction {
            if (repository.profileId != expected) return@syncTransaction null
            Triple(File(profile.paths.images, key), runCatching { connections.read() }.getOrNull(), repository.database.notes().image(key))
        } ?: return@withContext null
        if (state.first.isFile) {
            val bytes = state.first.readBytes().takeIf { it.size <= MAX_IMAGE_BYTES } ?: return@withContext null
            return@withContext ImageBytes(bytes, mime)
        }
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
                val cached = runCatching { writeCache(state.first, value.bytes) }.isSuccess
                repository.database.notes().putImage(ImageEntity(key, value.mime, value.bytes.size.toLong(), if (cached) "cached" else "remote"))
            }
            value
        } catch (_: Exception) {
            null
        } finally {
            client.close()
        }
    }

    suspend fun upload(uri: Uri, noteId: String, expected: String): String = withContext(Dispatchers.IO) {
        val rawMime = context.contentResolver.getType(uri)
        require(rawMime in setOf("image/jpeg", "image/png", "image/gif", "image/webp")) { "请选择 JPG、PNG、GIF 或 WebP 图片" }
        val rawBytes = checkNotNull(context.contentResolver.openInputStream(uri)).use { it.readBounded(MAX_IMAGE_BYTES) }
        val prepared = compressImageBytes(rawBytes, checkNotNull(rawMime))
        uploadBytes(prepared.bytes, prepared.mime, noteId, expected)
    }

    suspend fun uploadBytes(bytes: ByteArray, mime: String, noteId: String, expected: String): String {
        require(bytes.size in 1..MAX_IMAGE_BYTES)
        val needsPreflight = repository.syncTransaction {
            val dao = repository.database.notes()
            dao.meta("accepted_epoch") == null || dao.meta("reconcile_notes") != null || dao.meta("reconcile_books") != null
        }
        if (needsPreflight) {
            sync.synchronize(expected)
        }
        return try {
            performUpload(bytes, mime, noteId, expected)
        } catch (error: ApiError) {
            if (error.status == 409 && error.code == "sync_reset_required") {
                sync.synchronize(expected)
                performUpload(bytes, mime, noteId, expected)
            } else {
                throw error
            }
        }
    }

    private suspend fun performUpload(bytes: ByteArray, mime: String, noteId: String, expected: String): String =
        sync.withCurrentClient(expected) { client, epoch ->
            val ext = when (mime) {
                "image/jpeg" -> "jpg"
                "image/png" -> "png"
                "image/gif" -> "gif"
                "image/webp" -> "webp"
                else -> error("不支持的图片格式")
            }
            val part = MultipartBody.Part.createFormData("file", "image.$ext", bytes.toRequestBody(mime.toMediaType()))
            val value = client.call { uploadImage(epoch, part, noteId.toRequestBody("text/plain".toMediaType())) }
            require(validImageKey(value.fileKey) && value.url == "/api/images/${value.fileKey}" && value.mime == mime && value.size == bytes.size.toLong())
            repository.syncTransaction {
                check(repository.profileId == expected)
                val cached = runCatching { writeCache(File(profile.paths.images, value.fileKey), bytes) }.isSuccess
                repository.database.notes().putImage(ImageEntity(value.fileKey, mime, value.size, if (cached) "cached" else "remote"))
            }
            value.url
        }

    private fun writeCache(file: File, bytes: ByteArray) {
        val existing = profile.paths.images.walkTopDown().filter { it.isFile }.sumOf { it.length() }
        check(existing - (if (file.exists()) file.length() else 0) + bytes.size <= MAX_IMAGE_CACHE_BYTES) { "图片缓存已满，正文仍可保存" }
        check(file.parentFile!!.isDirectory || file.parentFile!!.mkdirs())
        val atomic = AtomicFile(file)
        val output = atomic.startWrite()
        try {
            output.write(bytes)
            atomic.finishWrite(output)
        } catch (error: Exception) {
            atomic.failWrite(output)
            throw error
        }
    }
}
