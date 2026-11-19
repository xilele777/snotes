package io.github.xilele777.snotes.core.editor

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.*
import kotlinx.coroutines.async
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SaveSessionTest {
    private val key = SessionKey("editor-prototype", "sample-a", "session-a")
    private fun draft(revision: Long = 1, value: String = "最后一字", composing: Boolean = false) = DraftSnapshot(key, revision, "原文", value, composing)
    private class MemoryStore : DraftStore {
        val staged = mutableListOf<DraftSnapshot>()
        val committed = mutableListOf<DraftSnapshot>()
        var failStage = false
        var failCommit = false
        var failClear = false
        override fun stage(snapshot: DraftSnapshot) { if (failStage) error("disk full"); staged += snapshot }
        override fun commit(snapshot: DraftSnapshot) { if (failCommit) error("transaction failed"); committed += snapshot }
        override fun clear(snapshot: DraftSnapshot) { if (failClear) error("cleanup failed") }
    }
    @Test fun journalPrecedesDebouncedCommitAndFinalFlushIsImmediate() = runTest {
        val store = MemoryStore()
        val saves = SaveSession(store, backgroundScope, StandardTestDispatcher(testScheduler))
        saves.changed(draft())
        runCurrent()
        assertEquals(1, store.staged.size)
        assertTrue(store.committed.isEmpty())
        advanceTimeBy(799); runCurrent()
        assertTrue(store.committed.isEmpty())
        val result = async { saves.flush(draft(2, "最后两个字")) }
        runCurrent()
        assertTrue(result.await().saved)
        assertEquals("最后两个字", store.committed.single().markdown)
        assertEquals(SavePhase.SAVED, saves.event.value?.phase)
    }
    @Test fun compositionOnlyWritesJournalUntilCommitOrFlush() = runTest {
        val store = MemoryStore()
        val saves = SaveSession(store, backgroundScope, StandardTestDispatcher(testScheduler))
        saves.changed(draft(composing = true)); runCurrent()
        advanceTimeBy(2000); runCurrent()
        assertTrue(store.committed.isEmpty())
        saves.changed(draft(composing = false)); runCurrent()
        advanceTimeBy(801); runCurrent()
        assertEquals(1, store.committed.size)
    }
    @Test fun initializationDoesNotSaveEvenWhenExplicitlyFlushed() = runTest {
        val store = MemoryStore()
        val saves = SaveSession(store, backgroundScope, StandardTestDispatcher(testScheduler))
        val result = async { saves.flush(draft(0, "原文")) }; runCurrent()
        assertTrue(result.await().saved)
        assertTrue(store.staged.isEmpty())
        assertTrue(store.committed.isEmpty())
    }
    @Test fun failedStorageNeverAcknowledgesAndRetryRetainsBody() = runTest {
        val store = MemoryStore()
        val saves = SaveSession(store, backgroundScope, StandardTestDispatcher(testScheduler))
        for (stage in listOf(true, false)) {
            store.failStage = stage; store.failCommit = !stage
            val result = async { saves.flush(draft()) }; runCurrent()
            assertFalse(result.await().saved)
            assertEquals(SavePhase.ERROR, saves.event.value?.phase)
        }
        store.failStage = false; store.failCommit = false
        val retry = async { saves.flush(draft()) }; runCurrent()
        assertTrue(retry.await().saved)
        assertEquals("最后一字", store.committed.single().markdown)
    }
    @Test fun cleanupFailureCannotRevokeDurableAckAndOwnBaselineAdvances() = runTest {
        val store = MemoryStore().apply { failClear = true }
        val saves = SaveSession(store, backgroundScope, StandardTestDispatcher(testScheduler))
        val first = async { saves.flush(draft()) }; runCurrent(); assertTrue(first.await().saved)
        val second = async { saves.flush(draft(2, "更新")) }; runCurrent(); assertTrue(second.await().saved)
        assertEquals("最后一字", store.committed[1].baseline)
        val replay = async { saves.flush(draft()) }; runCurrent(); assertTrue(replay.await().saved)
        assertEquals(2, store.committed.size)
    }
    @Test fun longDocumentInputBurstCoalescesWithoutDroppingFinalRevision() = runTest {
        val store = MemoryStore()
        val saves = SaveSession(store, backgroundScope, StandardTestDispatcher(testScheduler))
        val longBody = "中文段落".repeat(16_000)
        repeat(500) { saves.changed(draft(it.toLong() + 1, longBody + it)) }
        runCurrent()
        assertEquals(1, store.staged.size)
        advanceTimeBy(801); runCurrent()
        assertEquals(500, store.committed.single().revision)
        assertEquals(longBody + 499, store.committed.single().markdown)
    }
}
