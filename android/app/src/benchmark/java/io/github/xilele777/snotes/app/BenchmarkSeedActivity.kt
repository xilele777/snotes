package io.github.xilele777.snotes.app

import androidx.activity.ComponentActivity
import android.os.Bundle
import dagger.hilt.android.AndroidEntryPoint
import io.github.xilele777.snotes.core.database.*
import io.github.xilele777.snotes.core.model.derive
import javax.inject.Inject

/** Only exists in the profileable benchmark APK, never the delivered debug/release app. */
@AndroidEntryPoint class BenchmarkSeedActivity : ComponentActivity() {
    @Inject lateinit var profile: LocalProfile
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        Thread {
            val dao = profile.database.notes()
            profile.database.runInTransaction {
                repeat(500) { index ->
                    val id = if (index == 0) "benchmark-short" else "benchmark-$index"
                    val body = "# 本机样例 $index\n\n" + "中文写作样本。".repeat(250)
                    val fields = derive(body)
                    dao.putNote(NoteEntity(id, title = fields.title, summary = fields.summary, createTime = 1, updateTime = 1, dirty = "none"))
                    dao.putBody(BodyEntity(id, body))
                }
            }
            runOnUiThread {
                setContentView(android.widget.TextView(this).apply {
                    text = "基准样本已准备"
                    contentDescription = "基准样本已准备"
                })
            }
        }.start()
    }
}
