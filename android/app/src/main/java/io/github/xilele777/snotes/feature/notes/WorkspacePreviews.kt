package io.github.xilele777.snotes.feature.notes

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.github.xilele777.snotes.core.database.NoteEntity
import io.github.xilele777.snotes.core.ui.*

@Preview(name = "Phone", widthDp = 360, heightDp = 800, showBackground = true)
@Preview(name = "Foldable", widthDp = 673, heightDp = 841, showBackground = true)
@Preview(name = "Tablet", widthDp = 960, heightDp = 720, showBackground = true)
@Preview(name = "Desktop", widthDp = 1280, heightDp = 800, showBackground = true)
annotation class WorkspaceDevices

@WorkspaceDevices
@Composable
fun WorkspaceLightPreview() { WorkspacePreview(false) }

@WorkspaceDevices
@Composable
fun WorkspaceDarkPreview() { WorkspacePreview(true) }

@Composable
private fun WorkspacePreview(dark: Boolean) {
    SnotesTheme(dark) {
        Surface(color = MaterialTheme.snotesColors.bgList) {
            Column(Modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("随手记", style = MaterialTheme.typography.titleLarge)
                SnotesSearchField("", {}, "搜索本机笔记", modifier = Modifier.fillMaxWidth())
                NoteCard(NoteEntity("preview", title = "周末的慢生活", summary = "读一本书，散一会儿步。为生活留出一点空白。", star = 1, top = 1,
                    createTime = 1795104000000, updateTime = 1795104000000), "生活手记", true, {}, {}, {}, {}, {}, {})
                EmptyWorkspace(SnotesSymbol.Edit, "从一个想法开始", description = "记下灵感、整理日常。你的内容会先保存在本机。")
            }
        }
    }
}
