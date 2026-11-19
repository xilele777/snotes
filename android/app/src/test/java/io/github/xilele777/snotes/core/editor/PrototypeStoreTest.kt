package io.github.xilele777.snotes.core.editor

import java.io.File
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class PrototypeStoreTest {
    @get:Rule val folder = TemporaryFolder()
    private val key = SessionKey("editor-prototype", "sample-a", "session-a")
    private fun draft(value: String = "中文草稿\n") = DraftSnapshot(key, 1, PrototypeSamples.ordinary, value)
    @Test fun uncommittedJournalRecoversAfterRestart() {
        val directory = folder.newFolder()
        val store = PrototypeStore(directory)
        store.open(); store.stage(draft())
        assertEquals(draft().markdown, PrototypeStore(directory).open().getValue("sample-a").markdown)
    }
    @Test fun committedJournalDoesNotReplayOverNewerContent() {
        val directory = folder.newFolder()
        val store = PrototypeStore(directory)
        store.open(); store.stage(draft()); store.commit(draft())
        val newer = draft("后续正文").copy(key = key.copy(sessionId = "session-b"), baseline = draft().markdown)
        store.commit(newer)
        val reopened = PrototypeStore(directory).open().getValue("sample-a")
        assertEquals("后续正文", reopened.markdown)
        assertTrue(reopened.recovered.isEmpty())
    }
    @Test fun baselineConflictKeepsBothBodiesAndEmptyBodyIsValid() {
        val directory = folder.newFolder()
        val store = PrototypeStore(directory)
        store.open(); store.commit(draft("其他修改"))
        val conflict = draft("").copy(key = key.copy(sessionId = "session-b"))
        store.stage(conflict)
        val note = PrototypeStore(directory).open().getValue("sample-a")
        assertEquals("", note.markdown)
        assertEquals(listOf("其他修改"), note.recovered)
    }
    @Test fun corruptDatabaseAndUnknownProfilesDoNotOverwriteOriginalFiles() {
        val directory = folder.newFolder()
        val database = File(directory, "samples.json").apply { writeText("not-json") }
        assertTrue(runCatching { PrototypeStore(directory).open() }.isFailure)
        assertEquals("not-json", database.readText())
        val clean = PrototypeStore(folder.newFolder()); clean.open()
        assertTrue(runCatching { clean.stage(draft().copy(key = key.copy(profileId = "../../other"))) }.isFailure)
    }
    @Test fun longFixtureHasTwoThousandParagraphsAndExceeds76K() {
        assertTrue(PrototypeSamples.longDocument.length > 76_000)
        assertEquals(2000, Regex("第\\d+段").findAll(PrototypeSamples.longDocument).count())
    }
}
