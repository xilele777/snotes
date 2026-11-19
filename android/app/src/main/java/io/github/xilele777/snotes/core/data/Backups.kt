package io.github.xilele777.snotes.core.data

import android.content.Context
import android.net.Uri
import dagger.hilt.android.qualifiers.ApplicationContext
import io.github.xilele777.snotes.core.database.*
import io.github.xilele777.snotes.core.network.*
import io.github.xilele777.snotes.core.model.noteFits
import java.io.File
import java.security.MessageDigest
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import javax.inject.Inject
import kotlinx.coroutines.*
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*

private val imageRef = Regex("(?<![^\\s(\"'<>])/api/images/([^\\s)\"'<>\\]]+)")
private val relativeImage = Regex("(?<![^\\s(\"'<>])(?:\\.\\./)?images/([^\\s)\"'<>\\]]+)")
data class ImportSummary(val created: Int, val skipped: Int, val conflicts: Int, val books: Int)
class Backups @Inject constructor(@ApplicationContext private val context: Context, private val repository: NotesRepository,
    private val profile: LocalProfile, private val images: Images, private val books: BookRepository) {
    suspend fun export(uri: Uri) = withContext(Dispatchers.IO) {
        val expected = repository.profileId
        val dao = repository.database.notes()
        val snapshot = repository.syncTransaction {
            check(repository.recover().issues.isEmpty()) { "请先恢复或导出未保存草稿" }
            val notes = dao.allNotes().filter { it.invalid in 0..1 }
            val bodies = notes.associate { it.id to checkNotNull(repository.body(it.id)) { "部分正文尚未下载，请先同步" } }
            val history = notes.flatMap { dao.history(it.id) }
            val allBooks = dao.books().mapNotNull { books.desired(it.id) }.filter { it.book.deleted == 0 }
            ExportSnapshot(notes, bodies, dao.allGroups().filter { it.invalid == 0 }, history, allBooks, dao.metas("book_history:").map { syncJson.parseToJsonElement(it.value).jsonObject }, dao.metas("shared:"))
        }
        val entries = linkedMapOf<String, ByteArray>(); val imagePaths = mutableMapOf<String, String>()
        val extraShared = mutableMapOf<String, String>()
        for (entry in snapshot.shared) {
            val item = syncJson.parseToJsonElement(entry.value).jsonObject; val name = item.getValue("file").jsonPrimitive.content
            require(name.matches(Regex("[A-Za-z0-9-]{1,128}")))
            val bytes = File(profile.paths.directory, "shared/$name").inputStream().use { it.readBounded(MAX_IMAGE_BYTES) }
            val extension = when (item.getValue("mime").jsonPrimitive.content) { "image/jpeg" -> "jpg"; "image/png" -> "png"; "image/gif" -> "gif"; "image/webp" -> "webp"; else -> error("图片格式无效") }
            val path = "images/${digest(bytes)}.$extension"; entries[path] = bytes
            val id = item.getValue("note_id").jsonPrimitive.content
            extraShared[id] = extraShared[id].orEmpty() + "\n\n![分享图片](../$path)\n"
        }
        val keys = (snapshot.bodies.values + snapshot.history.map { it.markdown }).flatMap { imageRef.findAll(it).map { match -> match.groupValues[1] }.toList() }.distinct()
        for (key in keys) {
            val value = checkNotNull(images.read(key, expected)) { "图片尚未缓存且下载失败，未生成不完整备份" }
            val path = "images/${digest(value.bytes)}.${key.substringAfterLast('.')}"; entries[path] = value.bytes; imagePaths[key] = path
        }
        fun replace(body: String) = imageRef.replace(body) { "../${checkNotNull(imagePaths[it.groupValues[1]])}" }
        val noteIndex = snapshot.notes.map { note ->
            val path = "notes/${note.id}.md"; entries[path] = (replace(snapshot.bodies.getValue(note.id)) + extraShared[note.id].orEmpty()).toByteArray(Charsets.UTF_8)
            BackupNote(note.id, note.groupId?.takeIf { id -> snapshot.groups.any { it.id == id } }, note.title, note.star, note.top, note.skinColor, note.homeHidden, note.createTime, note.updateTime, path, note.invalid)
        }
        val historyIndex = snapshot.history.mapIndexed { index, history -> val path = "history/$index.txt"; entries[path] = replace(history.markdown).toByteArray(Charsets.UTF_8); BackupHistory(history.noteId, history.time, path) }
        val bookIndex = snapshot.books.map { value -> BackupBook(value.book.id, value.book.name, value.book.description, value.book.icon, value.book.ord, value.book.invalid, value.book.createTime, value.toc.nodes,
            value.toc.nodes.mapNotNull { it.noteId }.associateWith { id -> snapshot.notes.firstOrNull { it.id == id }?.let { if (it.invalid == 0) "available" else "trash" } ?: value.noteStates[id] ?: "purged" }) }
        val index = BackupIndex(time = System.currentTimeMillis(), groups = snapshot.groups.map { BackupGroup(it.id, it.name, it.sort, it.color, it.homeHidden, 0) }, notes = noteIndex, books = bookIndex, bookHistories = snapshot.bookHistory.filter { it["book_id"]?.jsonPrimitive?.content in bookIndex.map { it.id } }, histories = historyIndex)
        entries["index.json"] = syncJson.encodeToString(index).toByteArray(Charsets.UTF_8)
        require(entries.values.sumOf { it.size.toLong() } <= MAX_ARCHIVE_BYTES)
        check(repository.profileId == expected) { "实例已切换，导出已取消" }
        val temp = File.createTempFile("backup-", ".zip", context.cacheDir)
        try {
            ZipOutputStream(temp.outputStream()).use { zip -> entries.forEach { (path, bytes) -> zip.putNextEntry(ZipEntry(path)); zip.write(bytes); zip.closeEntry() } }
            checkNotNull(context.contentResolver.openOutputStream(uri, "wt")).use { out -> temp.inputStream().use { it.copyTo(out) } }
        } finally { temp.delete() }
    }
    suspend fun importBackup(uri: Uri): ImportSummary = withContext(Dispatchers.IO) {
        val expected = repository.profileId
        val archive = checkNotNull(context.contentResolver.openInputStream(uri)).use(::readArchive)
        val dao = repository.database.notes()
        val replacements = mutableMapOf<String, String>()
        suspend fun replace(body: String, noteId: String): String {
            for (match in relativeImage.findAll(body)) {
                val path = "images/${match.groupValues[1]}"; require(safeArchivePath(path))
                val bytes = checkNotNull(archive.entries[path]) { "备份缺少图片，未写入笔记" }; val mime = checkNotNull(imageMime(path)) { "图片格式不支持" }
                val key = "import_image:$noteId:${digest(bytes)}:$mime"
                if (key !in replacements) {
                    val prior = repository.syncTransaction { check(repository.profileId == expected); dao.meta(key) }
                    val url = prior ?: images.uploadBytes(bytes, mime, noteId, expected).also { repository.syncTransaction { check(repository.profileId == expected); dao.putMeta(SyncMetaEntity(key, it)) } }
                    replacements[key] = url
                }
            }
            return relativeImage.replace(body) { match ->
                val path = "images/${match.groupValues[1]}"; replacements.getValue("import_image:$noteId:${digest(archive.entries.getValue(path))}:${imageMime(path)}")
            }.also { require(noteFits(it)) { "图片地址替换后正文过大" } }
        }
        // Validate every required image before the first network call.
        val texts = archive.index.notes.map { it.id to archive.entries.getValue(it.file).toString(Charsets.UTF_8) } + archive.index.histories.map { it.noteId to archive.entries.getValue(it.file).toString(Charsets.UTF_8) }
        texts.forEach { (_, body) -> relativeImage.findAll(body).forEach { val path = "images/${it.groupValues[1]}"; require(safeArchivePath(path) && path in archive.entries && imageMime(path) != null && archive.entries.getValue(path).size in 1..MAX_IMAGE_BYTES) { "图片缺失、超限或格式不支持" } } }
        val notes = archive.index.notes.map { it to replace(archive.entries.getValue(it.file).toString(Charsets.UTF_8), it.id) }
        val histories = archive.index.histories.map { it to replace(archive.entries.getValue(it.file).toString(Charsets.UTF_8), it.noteId) }
        repository.syncTransaction {
            check(repository.profileId == expected) { "实例已切换，未写入备份" }
            var created = 0; var skipped = 0; var conflicts = 0; var createdBooks = 0
            val groupIds = mutableMapOf<String, String>()
            archive.index.groups.forEach { group ->
                val id = repository.importGroup(group.name, group.ord, group.color, group.hidden)
                groupIds[group.id] = id
            }
            notes.forEach { (meta, body) ->
                val existing = repository.note(meta.id)
                if (existing != null) {
                    skipped++
                    if (repository.body(meta.id) != body) { if (dao.history(meta.id).none { it.markdown == body }) dao.putHistory(HistoryEntity(noteId = meta.id, markdown = body, time = meta.updateTime, source = "import")); conflicts++ }
                } else {
                    repository.importNote(meta.id, body, meta.groupId?.let { groupIds[it] }, meta.createTime,
                        buildJsonObject { put("star", meta.star); put("top", meta.top); put("skin_color", meta.color); put("home_hidden", meta.hidden) }, meta.invalid == 1); created++
                }
            }
            histories.forEach { (meta, body) -> if (dao.history(meta.noteId).none { it.time == meta.time && it.markdown == body }) dao.putHistory(HistoryEntity(noteId = meta.noteId, markdown = body, time = meta.time, source = "import")) }
            archive.index.books.forEach { book ->
                val desired = books.desired(book.id)
                if (desired?.book?.deleted == 1) return@forEach
                if (desired == null) {
                    books.create(book.name, book.id, book.nodes, true)
                    books.editMeta(book.id, book.name, book.description, book.invalid, book.icon, book.ord); createdBooks++
                } else if (desired.toc.nodes != book.nodes || desired.book.name != book.name || desired.book.description != book.description) {
                    books.snapshot(desired.copy(book = desired.book.copy(name = book.name, description = book.description, icon = book.icon, ord = book.ord, invalid = book.invalid), toc = desired.toc.copy(nodes = book.nodes)), "conflict"); conflicts++
                }
                book.states.forEach { (id, state) -> dao.putNoteState(NoteStateEntity(id, state)) }
            }
            archive.index.bookHistories.forEach { history -> val id = history["id"]?.jsonPrimitive?.content ?: digest(history.toString().toByteArray()); val book = history.getValue("book_id").jsonPrimitive.content; dao.putMeta(SyncMetaEntity("book_history:$book:$id", history.toString())) }
            ImportSummary(created, skipped, conflicts, createdBooks)
        }
    }
    private data class ExportSnapshot(val notes: List<NoteEntity>, val bodies: Map<String, String>, val groups: List<GroupEntity>, val history: List<HistoryEntity>, val books: List<BookRemoteDto>, val bookHistory: List<JsonObject>, val shared: List<SyncMetaEntity>)
}
fun digest(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
