package io.github.xilele777.snotes.feature.notes

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import io.github.xilele777.snotes.core.data.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.json.*

@HiltViewModel class DataToolsModel @Inject constructor(private val backups: Backups, private val notes: NotesRepository) : ViewModel() {
    val busy = MutableStateFlow(false); val message = MutableStateFlow(""); val stats = MutableStateFlow("")
    fun export(uri: Uri) = run { backups.export(uri); "完整备份已导出（格式 3）" }
    fun importBackup(uri: Uri) = run { val result = backups.importBackup(uri); notes.requestSync(); "导入 ${result.created} 篇，跳过 ${result.skipped} 篇；${result.conflicts} 个不同版本保留在历史中；新增 ${result.books} 个笔记本" }
    fun stats() { viewModelScope.launch { stats.value = withContext(Dispatchers.IO) { notes.syncTransaction {
        val dao = notes.database.notes(); val all = dao.allNotes(); val count = all.sumOf { Opens(notes).count(it.id) }
        "本机 ${all.count { it.invalid == 0 }} 篇笔记，回收站 ${all.count { it.invalid == 1 }} 篇，${dao.books().size} 个笔记本；累计打开 $count 次；${dao.metas("shared:").size} 张分享图片待处理。打开数使用独立同步，不修改正文时间。"
    } } } }
    fun retryShared() { viewModelScope.launch { withContext(Dispatchers.IO) { notes.syncTransaction {
        val dao = notes.database.notes(); dao.metas("shared:").forEach { entry -> val item = Json.parseToJsonElement(entry.value).jsonObject; dao.putMeta(entry.copy(value = JsonObject(item - "failed" - "error").toString())) }; notes.requestSync()
    } }; message.value = "分享图片已重新排队" } }
    private fun run(block: suspend () -> String) { if (busy.value) return; busy.value = true; viewModelScope.launch {
        try { message.value = block() } catch (error: Exception) { message.value = error.message ?: "操作失败，本机数据已保留" } finally { busy.value = false; stats() }
    } }
}

@Composable fun DataTools(model: DataToolsModel = viewModel()) {
    val busy by model.busy.collectAsStateWithLifecycle(); val message by model.message.collectAsStateWithLifecycle(); val stats by model.stats.collectAsStateWithLifecycle()
    val exporter = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/zip")) { it?.let(model::export) }
    val importer = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { it?.let(model::importBackup) }
    var importing by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { model.stats() }
    Text("数据与统计", style = MaterialTheme.typography.titleMedium); Text(stats)
    Text("完整备份包含正文、图片、回收站和历史。图片缺失或正文未下载会停止导出。相同 ID 不覆盖当前笔记，导入的不同版本保存在历史中。")
    Row { TextButton(onClick = { exporter.launch("snotes-backup-${System.currentTimeMillis()}.zip") }, enabled = !busy) { Text("导出完整备份") }
        TextButton(onClick = { importing = true }, enabled = !busy) { Text("导入格式 3 备份") } }
    TextButton(onClick = model::retryShared, enabled = !busy) { Text("重试分享图片上传") }
    if (busy) { LinearProgressIndicator(); Text("正在处理文件，请等待…") }; if (message.isNotBlank()) Text(message)
    if (importing) AlertDialog(onDismissRequest = { importing = false }, title = { Text("导入完整备份") }, text = { Text("导入会新增本机记录和待同步任务。原有同 ID 内容保留；所需图片会先上传到当前实例。请只选择你信任的 Snotes 格式 3 ZIP。") }, confirmButton = { TextButton(onClick = { importing = false; importer.launch(arrayOf("application/zip", "application/x-zip-compressed")) }) { Text("选择备份") } }, dismissButton = { TextButton(onClick = { importing = false }) { Text("取消") } })
}
