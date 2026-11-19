package io.github.xilele777.snotes.core.data

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.AtomicFile
import dagger.hilt.android.qualifiers.ApplicationContext
import io.github.xilele777.snotes.core.database.*
import io.github.xilele777.snotes.core.network.*
import java.io.File
import java.util.UUID
import javax.inject.Inject
import kotlinx.coroutines.*
import kotlinx.serialization.json.*

/** Copy temporary URI grants before returning to the sender. Nothing is uploaded by intake. */
class ShareIntake @Inject constructor(@ApplicationContext private val context: Context,
    private val profile: LocalProfile, private val repository: NotesRepository) {
    suspend fun accept(intent: Intent): String = withContext(Dispatchers.IO) {
        require(intent.action in setOf(Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE))
        val expected = repository.profileId
        val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString().orEmpty()
        val title = intent.getStringExtra(Intent.EXTRA_SUBJECT).orEmpty().take(200)
        @Suppress("DEPRECATION") val uris: List<Uri> = if (intent.action == Intent.ACTION_SEND_MULTIPLE)
            intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM).orEmpty() else listOfNotNull(intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM))
        require(uris.size <= 10) { "一次最多接收 10 张图片" }
        val directory = File(profile.paths.directory, "shared").apply { check(isDirectory || mkdirs()) }
        val staged = uris.map { uri ->
            val mime = context.contentResolver.getType(uri)
            require(mime in setOf("image/jpeg", "image/png", "image/gif", "image/webp")) { "分享文件仅支持 JPG、PNG、GIF、WebP 图片" }
            val bytes = checkNotNull(context.contentResolver.openInputStream(uri)).use { it.readBounded(MAX_IMAGE_BYTES) }
            require(bytes.isNotEmpty())
            val file = File(directory, UUID.randomUUID().toString())
            val atomic = AtomicFile(file); val stream = atomic.startWrite()
            try { stream.write(bytes); atomic.finishWrite(stream) } catch (error: Exception) { atomic.failWrite(stream); throw error }
            file to mime!!
        }
        val body = (if (title.isNotBlank()) "# $title\n\n" else "") + text + if (staged.isNotEmpty()) "\n\n图片已存到本机，联网后自动上传。" else ""
        require(body.isNotBlank()) { "分享内容为空" }
        repository.syncTransaction {
            check(expected == repository.profileId) { "实例已切换，请重新分享" }
            val note = repository.create(body)
            staged.forEach { (file, mime) -> repository.database.notes().putMeta(SyncMetaEntity("shared:${file.name}", buildJsonObject {
                put("note_id", note.id); put("file", file.name); put("mime", mime)
            }.toString())) }
            note.id
        }
    }
}

fun java.io.InputStream.readBounded(limit: Int): ByteArray {
    val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(8192)
    while (true) { val count = read(buffer); if (count < 0) break; require(output.size() + count <= limit) { "文件超过允许的大小" }; output.write(buffer, 0, count) }
    return output.toByteArray()
}
