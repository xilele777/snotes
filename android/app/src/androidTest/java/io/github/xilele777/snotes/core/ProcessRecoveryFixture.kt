package io.github.xilele777.snotes.core

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import dagger.hilt.android.EntryPointAccessors
import io.github.xilele777.snotes.app.TestRepositoryAccess
import io.github.xilele777.snotes.core.editor.*
import java.io.File
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** External ADB harness runs prepare, force-stops the process, then runs verify.
 * Excluded from the ordinary suite; these methods intentionally span processes. */
@RunWith(AndroidJUnit4::class)
class ProcessRecoveryFixture {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val repository get() = EntryPointAccessors.fromApplication(context, TestRepositoryAccess::class.java).repository()
    private val marker get() = File(context.cacheDir, "m2-process-fixture.txt")
    @Test fun prepare() {
        repository.recover()
        val note = repository.create("进程恢复基线")
        val first = DraftSnapshot(SessionKey(repository.profileId, note.id, "process-old"), 1, "进程恢复基线", "已提交但未清理的旧稿")
        repository.stage(first); repository.commit(first) // leave both journal and Room draft
        val second = first.copy(key = first.key.copy(sessionId = "process-new"), baseline = first.markdown, markdown = "# 进程重启验收\n\n最新已提交正文🙂\n\n")
        repository.stage(second); repository.commit(second); repository.clear(second)
        val staged = repository.create("尚未提交基线")
        repository.stage(DraftSnapshot(SessionKey(repository.profileId, staged.id, "process-staged"), 7, "尚未提交基线", "# 草稿恢复验收\n\n仅草稿落盘的中文🙂"))
        marker.writeText("${note.id}\n${staged.id}", Charsets.UTF_8)
        assertEquals(1L, repository.database.notes().receipt(note.id, "process-old"))
        assertNull(repository.database.notes().receipt(staged.id, "process-staged"))
    }
    @Test fun verify() {
        val ids = marker.readLines(Charsets.UTF_8)
        val report = repository.recover()
        assertEquals(1, report.recovered); assertTrue(report.issues.isEmpty())
        assertEquals("# 进程重启验收\n\n最新已提交正文🙂\n\n", repository.body(ids[0]))
        assertEquals("# 草稿恢复验收\n\n仅草稿落盘的中文🙂", repository.body(ids[1]))
        assertEquals(7L, repository.database.notes().receipt(ids[1], "process-staged"))
        assertTrue(repository.database.notes().drafts().isEmpty())
        assertEquals(0, repository.recover().recovered)
        assertEquals(2, repository.database.notes().tasks().count { it.kind == "body" && it.entityId in ids })
    }
}
