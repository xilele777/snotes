package io.github.xilele777.snotes.core.editor

import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

interface DraftStore {
    fun stage(snapshot: DraftSnapshot)
    fun commit(snapshot: DraftSnapshot)
    fun clear(snapshot: DraftSnapshot)
}

@Serializable
data class PrototypeNote(val markdown: String, val recovered: List<String> = emptyList())
@Serializable
private data class PrototypeDatabase(val schemaVersion: Int = 1, val notes: Map<String, PrototypeNote>, val receipts: Map<String, Long> = emptyMap())

/** M1 test repository. M2 replaces this with Room; never contains server credentials. */
class PrototypeStore(private val directory: File) : DraftStore {
    private val json = Json
    private val database = File(directory, "samples.json")
    private val drafts = File(directory, "drafts")
    private var state: PrototypeDatabase? = null

    @Synchronized
    fun open(): Map<String, PrototypeNote> {
        require(directory.isDirectory || directory.mkdirs()) { "Cannot create prototype directory" }
        require(drafts.isDirectory || drafts.mkdirs()) { "Cannot create draft directory" }
        // A corrupt existing file is an error, never a reason to silently reseed/overwrite.
        val loaded = if (database.exists()) json.decodeFromString<PrototypeDatabase>(read(database))
            else PrototypeDatabase(notes = PrototypeSamples.notes.mapValues { PrototypeNote(it.value) })
        require(loaded.schemaVersion == 1) { "Unsupported prototype schema" }
        require(loaded.notes.keys == PrototypeSamples.notes.keys) { "Invalid prototype note IDs" }
        require(loaded.notes.values.all { it.markdown.length <= MAX_EDITOR_CHARS }) { "Prototype note exceeds limit" }
        state = loaded
        drafts.listFiles()?.filter { it.extension == "json" }?.sortedBy { it.name }?.forEach { file ->
            val draft = json.decodeFromString<DraftSnapshot>(read(file))
            validate(draft)
            if ((current().receipts[draft.key.sessionId] ?: -1) < draft.revision) commit(draft)
            clear(draft)
        }
        return current().notes
    }

    @Synchronized
    fun note(noteId: String): PrototypeNote = current().notes.getValue(noteId)

    @Synchronized
    override fun stage(snapshot: DraftSnapshot) {
        validate(snapshot)
        atomicWrite(draftFile(snapshot), json.encodeToString(snapshot))
    }

    @Synchronized
    override fun commit(snapshot: DraftSnapshot) {
        validate(snapshot)
        val previous = current()
        if ((previous.receipts[snapshot.key.sessionId] ?: -1) >= snapshot.revision) return
        val note = previous.notes.getValue(snapshot.key.noteId)
        val conflict = note.markdown != snapshot.baseline && note.markdown != snapshot.markdown
        val updated = PrototypeNote(snapshot.markdown, if (conflict) note.recovered + note.markdown else note.recovered)
        val next = previous.copy(notes = previous.notes + (snapshot.key.noteId to updated),
            receipts = previous.receipts + (snapshot.key.sessionId to snapshot.revision))
        atomicWrite(database, json.encodeToString(next))
        state = next
    }

    @Synchronized
    override fun clear(snapshot: DraftSnapshot) {
        val file = draftFile(snapshot)
        if (!file.exists()) return
        val saved = json.decodeFromString<DraftSnapshot>(read(file))
        if (saved.key == snapshot.key && saved.revision <= snapshot.revision) {
            check(file.delete()) { "Cannot clear committed draft" }
        }
    }

    private fun validate(snapshot: DraftSnapshot) {
        require(snapshot.key.profileId == "editor-prototype" && snapshot.key.noteId in PrototypeSamples.notes)
        require(snapshot.key.sessionId.matches(Regex("[A-Za-z0-9-]{1,128}")))
        require(snapshot.revision in 0..Int.MAX_VALUE.toLong())
        require(snapshot.markdown.length <= MAX_EDITOR_CHARS && snapshot.baseline.length <= MAX_EDITOR_CHARS)
    }
    private fun current(): PrototypeDatabase = checkNotNull(state) { "Open store before use" }
    private fun draftFile(snapshot: DraftSnapshot): File {
        val hash = MessageDigest.getInstance("SHA-256").digest(snapshot.key.noteId.toByteArray()).joinToString("") { "%02x".format(it) }
        return File(drafts, "$hash.json")
    }
    private fun read(file: File): String {
        require(file.length() <= 32_000_000) { "Prototype file exceeds limit" }
        return file.readText(Charsets.UTF_8)
    }
    private fun atomicWrite(file: File, text: String) {
        val temporary = File(file.parentFile, "${file.name}.new")
        FileOutputStream(temporary).use { output -> output.write(text.toByteArray(Charsets.UTF_8)); output.fd.sync() }
        // Same-directory atomic rename. Failure leaves the existing content and journal intact.
        Files.move(temporary.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
    }
}

object PrototypeSamples {
    const val ordinary = "# 安卓编辑器验收\n\n这里是离线样例，可以放心修改。\n\n## 格式兼容\n\n==高亮==、**加粗**、`行内代码`。\n\n- 普通列表\n- [ ] 待办事项\n\n| 列一 | 列二 |\n| --- | --- |\n| 中文 | Markdown |\n\n```kotlin\nval title = \"你好，安卓\"\n```\n\n<br />\n\n![本地图片](/assets/editor/sample.svg)\n\n[外部链接](https://example.com)\n"
    val longDocument: String = buildString {
        append("# 长文输入验收\n\n")
        repeat(2000) { append("第${it + 1}段：中文输入、换行、撤销与保存确认；长文在源码模式打开，预览按需生成。\n\n") }
    }
    val notes: Map<String, String> = linkedMapOf("sample-a" to ordinary, "sample-b" to "# 第二篇样例\n\n切换笔记后，撤销不能带回第一篇的内容。\n", "sample-long" to longDocument)
}
