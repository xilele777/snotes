package io.github.xilele777.snotes.feature.notes

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.xilele777.snotes.core.data.*
import io.github.xilele777.snotes.core.model.NoteStatsSnapshot
import io.github.xilele777.snotes.core.model.computeNoteStats
import io.github.xilele777.snotes.core.ui.*
import javax.inject.Inject
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.json.*

@HiltViewModel
class DataToolsModel @Inject constructor(
    private val backups: Backups,
    private val notes: NotesRepository,
) : ViewModel() {
    val busy = MutableStateFlow(false)
    val message = MutableStateFlow("")
    val pendingSharedImages = MutableStateFlow(0)
    val snapshot = MutableStateFlow<NoteStatsSnapshot?>(null)

    fun export(uri: Uri) = run { backups.export(uri); "已导出备份" }

    fun importBackup(uri: Uri) = run {
        val result = backups.importBackup(uri)
        notes.requestSync()
        "已导入 ${result.created} 篇笔记，跳过 ${result.skipped} 篇"
    }

    fun refreshPendingImages() {
        viewModelScope.launch {
            pendingSharedImages.value = withContext(Dispatchers.IO) {
                runCatching { notes.database.notes().pendingSharedImagesCount() }.getOrDefault(0)
            }
        }
    }

    fun stats() {
        viewModelScope.launch {
            val (computed, sharedCount) = withContext(Dispatchers.IO) {
                val dao = notes.database.notes()
                val allNotes = dao.allNotes()
                val bodies = dao.allBodies().associate { it.noteId to it.markdown }
                val groups = dao.allGroups()
                val openMetas = dao.metas("open_").associate { it.key to (it.value.toLongOrNull()?.coerceAtLeast(0L) ?: 0L) }
                val opensByNote = allNotes.associate { note ->
                    val base = openMetas["open_base:${note.id}"] ?: 0L
                    val pending = openMetas["open_pending:${note.id}"] ?: 0L
                    note.id to (base + pending)
                }
                val activeBooks = dao.books().count { it.invalid == 0 }
                val pendingImages = dao.pendingSharedImagesCount()
                withContext(Dispatchers.Default) {
                    computeNoteStats(allNotes, bodies, groups, opensByNote, activeBooks) to pendingImages
                }
            }
            snapshot.value = computed
            pendingSharedImages.value = sharedCount
        }
    }

    fun retryShared() {
        viewModelScope.launch {
            withContext(Dispatchers.IO) {
                notes.syncTransaction {
                    val dao = notes.database.notes()
                    dao.metas("shared:").forEach { entry ->
                        val item = Json.parseToJsonElement(entry.value).jsonObject
                        dao.putMeta(entry.copy(value = JsonObject(item - "failed" - "error").toString()))
                    }
                    notes.requestSync()
                }
            }
            message.value = "分享图片已重新排队"
            refreshPendingImages()
        }
    }

    private fun run(block: suspend () -> String) {
        if (busy.value) return
        busy.value = true
        viewModelScope.launch {
            try { message.value = block() }
            catch (error: Exception) { message.value = error.message ?: "操作失败，本机数据已保留" }
            finally { busy.value = false; refreshPendingImages() }
        }
    }
}

@Composable
fun DataTools(model: DataToolsModel = viewModel()) {
    val colors = MaterialTheme.snotesColors
    val busy by model.busy.collectAsStateWithLifecycle()
    val message by model.message.collectAsStateWithLifecycle()
    val sharedCount by model.pendingSharedImages.collectAsStateWithLifecycle()
    val exporter = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/zip")) { it?.let(model::export) }
    val importer = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { it?.let(model::importBackup) }
    var importing by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(Unit) { model.refreshPendingImages() }

    SettingsRow(
        symbol = SnotesSymbol.Download,
        title = "导出完整备份",
        enabled = !busy,
    ) {
        exporter.launch("snotes-backup-${System.currentTimeMillis()}.zip")
    }
    HorizontalDivider(Modifier.padding(horizontal = 16.dp), color = colors.divider, thickness = 0.75.dp)
    SettingsRow(
        symbol = SnotesSymbol.Upload,
        title = "导入备份文件",
        enabled = !busy,
    ) {
        importing = true
    }
    if (sharedCount > 0) {
        HorizontalDivider(Modifier.padding(horizontal = 16.dp), color = colors.divider, thickness = 0.75.dp)
        SettingsRow(
            symbol = SnotesSymbol.Image,
            title = "重试分享图片上传 ($sharedCount)",
            enabled = !busy,
            onClick = model::retryShared,
        )
    }
    if (busy) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            LinearProgressIndicator(Modifier.fillMaxWidth())
            Text("正在处理…", style = MaterialTheme.typography.bodySmall, color = colors.textTertiary)
        }
    }
    if (message.isNotBlank()) {
        Text(
            message,
            style = MaterialTheme.typography.bodySmall,
            color = colors.accent,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
        )
    }
    if (importing) {
        AlertDialog(
            onDismissRequest = { importing = false },
            containerColor = colors.bgSurface,
            shape = RoundedCornerShape(18.dp),
            title = { Text("导入备份", style = MaterialTheme.typography.titleLarge) },
            text = {
                Text(
                    "选择之前导出的 ZIP 备份文件，合并内容并保留已有正文。",
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.textSecondary,
                )
            },
            confirmButton = {
                Button(
                    onClick = { importing = false; importer.launch(arrayOf("application/zip", "application/x-zip-compressed")) },
                    shape = RoundedCornerShape(10.dp),
                ) { Text("选择文件") }
            },
            dismissButton = { TextButton(onClick = { importing = false }) { Text("取消") } },
        )
    }
}
