package io.github.xilele777.snotes.feature.notes

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.paging.PagingData
import androidx.paging.cachedIn
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.xilele777.snotes.core.data.*
import io.github.xilele777.snotes.core.database.NoteEntity
import javax.inject.Inject
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.*
import io.github.xilele777.snotes.core.sync.SyncCoordinator

@OptIn(ExperimentalCoroutinesApi::class, FlowPreview::class)
@HiltViewModel
class NotesViewModel @Inject constructor(private val repository: NotesRepository, private val sync: SyncCoordinator) : ViewModel() {
    val syncStatus = sync.status
    val structureIds = readyStructure()
    private fun readyStructure() = repository.structureIds.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
    val books = repository.database.notes().observeBooks().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
    val tocs = repository.database.notes().observeTocs().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
    suspend fun noteTitle(id: String): Pair<String, Boolean> = withContext(Dispatchers.IO) {
        val note = repository.note(id)
        (note?.title?.ifBlank { "无标题" } ?: "笔记未下载") to (note?.invalid == 0 && repository.body(id) != null)
    }
    fun profiles() = sync.profiles()
    suspend fun origin() = sync.origin()
    suspend fun switchProfile(id: String): Boolean = attempt { sync.switchProfile(id); true } ?: false
    suspend fun connect(origin: String, token: String): Boolean = attempt { sync.connect(origin, token); true } ?: false
    fun synchronize() { viewModelScope.launch { sync.synchronize() } }
    fun retrySync() { viewModelScope.launch { sync.retry() } }
    fun stopSync() { viewModelScope.launch { sync.stopAndJoin() } }
    private val ready = MutableStateFlow(false)
    val initialized = ready.asStateFlow()
    val filter = MutableStateFlow(NoteFilter())
    private val savedFilters = mutableMapOf<String, NoteFilter>()
    private var activeSection = "home"
    fun setSection(section: String) {
        savedFilters[activeSection] = filter.value
        activeSection = section
        filter.value = savedFilters[section] ?: NoteFilter(trash = section == "trash")
    }
    private val mutableMessage = MutableStateFlow<String?>(null)
    val message = mutableMessage.asStateFlow()
    // Keep the export snapshot through Activity recreation without putting a
    // potentially large Markdown document into a saved-state Bundle.
    var exportSnapshot: String? = null
    private val mutableIssues = MutableStateFlow<List<RecoveryIssue>>(emptyList())
    val issues = mutableIssues.asStateFlow()
    val pages = combine(ready, filter.debounce(200)) { opened, value -> opened to value }
        .flatMapLatest { (opened, value) -> if (opened) repository.pages(value) else flowOf(PagingData.empty<NoteEntity>()) }.cachedIn(viewModelScope)
    val groups = ready.flatMapLatest { if (it) repository.groups else flowOf(emptyList()) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
    val pending = ready.flatMapLatest { if (it) repository.pendingCount else flowOf(0) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), 0)
    val syncFailures = ready.flatMapLatest { if (it) repository.syncFailures else flowOf(emptyList()) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
    suspend fun copyFailed(taskId: Long): String? = attempt { repository.saveFailedAsCopy(taskId).id }
    val missingBodies = ready.flatMapLatest { if (it) repository.missingBodyCount else flowOf(0) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), 0)
    init { retryRecovery() }
    fun retryRecovery() {
        viewModelScope.launch {
            try {
                val report = withContext(Dispatchers.IO) { repository.recover() }
                mutableIssues.value = report.issues
                ready.value = true
                sync.refreshConnection()
                if (report.recovered > 0) mutableMessage.value = "已恢复 ${report.recovered} 份草稿"
            } catch (failure: Exception) { mutableMessage.value = failure.message ?: "本机数据库无法打开，原数据已保留" }
        }
    }
    suspend fun create(): String? = attempt { repository.create(groupId = filter.value.groupId).id }
    suspend fun createGroup(name: String): String? = attempt { repository.createGroup(name).id }
    suspend fun star(note: NoteEntity) = attempt { repository.updateProps(note.id, buildJsonObject { put("star", 1 - note.star) }) }
    suspend fun pin(note: NoteEntity) = attempt { repository.updateProps(note.id, buildJsonObject { put("top", 1 - note.top) }) }
    suspend fun assignGroup(noteId: String, groupId: String?) = attempt { repository.updateProps(noteId, buildJsonObject { put("group_id", groupId) }) }
    suspend fun trash(noteId: String, trash: Boolean): Boolean = attempt { repository.setTrash(noteId, trash); true } ?: false
    suspend fun export(noteId: String): String? = attempt { repository.export(noteId) }
    suspend fun copyDraft(issue: RecoveryIssue): String? = attempt { repository.saveDraftAsCopy(checkNotNull(issue.snapshot)).id }
    private suspend fun <T> attempt(block: suspend () -> T): T? = try { withContext(Dispatchers.IO) { block() } }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { mutableMessage.value = failure.message ?: "操作失败，数据已保留"; null }
    fun clearMessage() { mutableMessage.value = null }
}
