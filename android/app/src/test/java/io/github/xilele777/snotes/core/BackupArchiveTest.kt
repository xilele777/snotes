package io.github.xilele777.snotes.core

import io.github.xilele777.snotes.core.data.*
import io.github.xilele777.snotes.core.network.syncJson
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.zip.*
import kotlinx.serialization.encodeToString
import org.junit.Test
import org.junit.Assert.*

class BackupArchiveTest {
    private fun zip(entries: Map<String, ByteArray>): ByteArray { val output = ByteArrayOutputStream(); ZipOutputStream(output).use { zip -> entries.forEach { (name, bytes) -> zip.putNextEntry(ZipEntry(name)); zip.write(bytes); zip.closeEntry() } }; return output.toByteArray() }
    private fun valid(body: String = ""): Map<String, ByteArray> { val index = BackupIndex(time = 10, groups = emptyList(), notes = listOf(BackupNote("note", null, "", 0, 0, null, null, 1, 2, "notes/note.md")), books = emptyList(), bookHistories = emptyList()); return mapOf("index.json" to syncJson.encodeToString(index).toByteArray(), "notes/note.md" to body.toByteArray()) }
    @Test fun emptyBodyAndTrashHistoryRemainDistinctFromMissingFiles() { assertEquals(0, readArchive(ByteArrayInputStream(zip(valid()))).entries.getValue("notes/note.md").size); assertThrows(IllegalArgumentException::class.java) { readArchive(ByteArrayInputStream(zip(valid() - "notes/note.md"))) } }
    @Test fun rejectsTraversalAbsoluteAndWindowsPaths() { listOf("../leak.md", "/leak.md", "C:/leak.md", "a\\leak.md", "a/../leak.md").forEach { name -> assertThrows(IllegalArgumentException::class.java) { readArchive(ByteArrayInputStream(zip(valid() + (name to byteArrayOf(1))))) } } }
    @Test fun rejectsOversizedNoteBeforeAnyImport() { assertThrows(IllegalArgumentException::class.java) { readArchive(ByteArrayInputStream(zip(valid("x".repeat(1_048_577))))) } }
    @Test fun rejectsUnsupportedFormatAndWrongIdentity() { listOf("\"format\":3" to "\"format\":4", "\"app\":\"snotes\"" to "\"app\":\"other\"").forEach { (from, to) -> val entries = valid().toMutableMap(); entries["index.json"] = entries.getValue("index.json").toString(Charsets.UTF_8).replace(from, to).toByteArray(); assertThrows(IllegalArgumentException::class.java) { readArchive(ByteArrayInputStream(zip(entries))) } } }
}
