package io.github.xilele777.snotes.core.data

import io.github.xilele777.snotes.core.model.noteFits
import io.github.xilele777.snotes.core.network.*
import io.github.xilele777.snotes.core.sync.validateToc
import java.io.InputStream
import java.util.zip.ZipInputStream
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName
import kotlinx.serialization.json.*

const val MAX_ARCHIVE_BYTES = 128 * 1024 * 1024
@Serializable data class BackupGroup(@SerialName("group_id") val id: String, val name: String, val ord: Int, val color: String?,
    @SerialName("hide_from_home") val hidden: Int = 0, @SerialName("update_time") val time: Long)
@Serializable data class BackupNote(val id: String, @SerialName("group_id") val groupId: String?, val title: String, val star: Int, val top: Int,
    @SerialName("skin_color") val color: String?, @SerialName("home_hidden") val hidden: Int? = null,
    @SerialName("create_time") val createTime: Long, @SerialName("update_time") val updateTime: Long, val file: String, val invalid: Int = 0)
@Serializable data class BackupBook(val id: String, val name: String, val description: String, val icon: String, val ord: Int, val invalid: Int,
    @SerialName("create_time") val createTime: Long, val nodes: List<TocNodeDto>, @SerialName("note_states") val states: Map<String, String>)
@Serializable data class BackupHistory(@SerialName("note_id") val noteId: String, val time: Long, val file: String)
@Serializable data class BackupIndex(val app: String = "snotes", val format: Int = 3, @SerialName("exported_at") val time: Long,
    val groups: List<BackupGroup>, val notes: List<BackupNote>, @SerialName("knowledge_bases") val books: List<BackupBook>,
    @SerialName("knowledge_base_histories") val bookHistories: List<kotlinx.serialization.json.JsonObject>, @SerialName("note_histories") val histories: List<BackupHistory> = emptyList())
data class ValidArchive(val index: BackupIndex, val entries: Map<String, ByteArray>)
fun safeArchivePath(path: String) = path.length in 1..512 && !path.startsWith('/') && !path.contains('\\') && !path.contains(':') &&
    path.split('/').all { it.isNotEmpty() && it !in setOf(".", "..") && it.none { ch -> ch.code < 32 } }

/** No extraction to disk; cap actual inflated bytes, not untrusted ZIP size metadata. */
fun readArchive(input: InputStream): ValidArchive {
    val entries = linkedMapOf<String, ByteArray>(); var total = 0
    ZipInputStream(input).use { zip ->
        while (true) {
            val entry = zip.nextEntry ?: break
            if (entry.isDirectory) { require(safeArchivePath(entry.name.trimEnd('/'))); zip.closeEntry(); continue }
            require(safeArchivePath(entry.name) && entry.name !in entries && entries.size < 30_000) { "备份存在危险或重复路径" }
            val bytes = zip.readBounded(minOf(MAX_ARCHIVE_BYTES - total, if (entry.name == "index.json") 8 * 1024 * 1024 else MAX_ARCHIVE_BYTES))
            total += bytes.size; require(total <= MAX_ARCHIVE_BYTES); entries[entry.name] = bytes; zip.closeEntry()
        }
    }
    val raw = syncJson.parseToJsonElement(checkNotNull(entries["index.json"]) { "请选择格式 3 完整备份 ZIP" }.toString(Charsets.UTF_8))
    validateWire(raw)
    val index = syncJson.decodeFromJsonElement<BackupIndex>(raw)
    require(index.app == "snotes" && index.format == 3) { "当前支持 Snotes 格式 3 完整备份" }
    require(index.notes.size <= 20_000 && index.groups.size <= 20_000 && index.books.size <= 2000)
    fun color(value: String?) { require(value == null || Regex("#[0-9a-fA-F]{6}").matches(value)) }
    val groups = mutableSetOf<String>()
    index.groups.forEach { safeId(it.id); require(groups.add(it.id) && it.name.isNotBlank() && it.name.length <= 100 && it.hidden in 0..1); safeNumber(it.time); color(it.color) }
    val notes = mutableSetOf<String>(); val files = mutableSetOf<String>()
    index.notes.forEach {
        safeId(it.id); require(notes.add(it.id) && files.add(it.file) && safeArchivePath(it.file) && it.file.endsWith(".md", true) && it.file in entries)
        require(it.groupId == null || it.groupId in groups); require(it.star in 0..1 && it.top in 0..1 && it.invalid in 0..1 && (it.hidden == null || it.hidden in 0..1)); color(it.color)
        safeNumber(it.createTime); safeNumber(it.updateTime); require(noteFits(entries.getValue(it.file).toString(Charsets.UTF_8)))
    }
    val books = mutableSetOf<String>()
    index.books.forEach {
        safeId(it.id); require(books.add(it.id)); safeNumber(it.createTime)
        validateToc(BookRemoteDto(BookDto(it.id, it.name, it.description, it.icon, it.ord, it.invalid, 0, 0, 0, it.createTime, it.createTime, 0), TocDto(it.id, 0, it.nodes, it.createTime), it.states))
        require(it.states.keys.all { id -> id.matches(Regex("[A-Za-z0-9_-]{1,100}")) } && it.states.values.all { state -> state in setOf("available", "trash", "purged") })
    }
    index.histories.forEach { require(it.noteId in notes && safeArchivePath(it.file) && it.file in entries && noteFits(entries.getValue(it.file).toString(Charsets.UTF_8))); safeNumber(it.time) }
    index.bookHistories.forEach { history ->
        val bookId = history["book_id"]?.toString()?.trim('"'); require(bookId in books)
        val nodes = syncJson.decodeFromJsonElement<List<TocNodeDto>>(checkNotNull(history["nodes"]))
        val book = index.books.first { it.id == bookId }
        validateToc(BookRemoteDto(BookDto(book.id, book.name, book.description, book.icon, book.ord, book.invalid, 0, 0, 0, book.createTime, book.createTime, 0), TocDto(book.id, 0, nodes, book.createTime), nodes.mapNotNull { it.noteId }.associateWith { book.states[it] ?: "purged" }))
    }
    return ValidArchive(index, entries)
}
