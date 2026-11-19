package io.github.xilele777.snotes.core.editor

import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/** Independent fallback when SQLite cannot write. Never deletes malformed journals. */
class DraftJournal(private val directory: File) {
    fun files(): List<File> = if (directory.exists()) checkNotNull(directory.listFiles()).filter { it.extension == "json" }.sortedBy { it.name } else emptyList()
    fun read(file: File): DraftSnapshot {
        require(file.length() <= 32_000_000) { "草稿日志过大" }
        return Json.decodeFromString(file.readText(Charsets.UTF_8))
    }
    fun write(snapshot: DraftSnapshot) {
        check(directory.isDirectory || directory.mkdirs()) { "无法创建草稿目录" }
        val target = file(snapshot.key)
        if (target.exists() && read(target).revision > snapshot.revision) return
        val temporary = File(directory, "${target.name}.new")
        FileOutputStream(temporary).use { output ->
            output.write(Json.encodeToString(snapshot).toByteArray(Charsets.UTF_8)); output.fd.sync()
        }
        Files.move(temporary.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
    }
    fun clear(snapshot: DraftSnapshot) {
        val target = file(snapshot.key)
        if (target.exists() && read(target).revision <= snapshot.revision) check(target.delete()) { "无法清理已提交草稿" }
    }
    private fun file(key: SessionKey): File {
        val hash = MessageDigest.getInstance("SHA-256").digest("${key.noteId}\u0000${key.sessionId}".toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
        return File(directory, "$hash.json")
    }
}
