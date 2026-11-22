package io.github.xilele777.snotes.feature.notes

import androidx.compose.ui.graphics.ImageBitmap
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.paging.cachedIn
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.xilele777.snotes.core.data.*
import io.github.xilele777.snotes.core.database.NoteEntity
import io.github.xilele777.snotes.core.model.extractSearchExcerpt
import io.github.xilele777.snotes.core.network.Images
import io.github.xilele777.snotes.core.sync.SyncCoordinator
import javax.inject.Inject
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.*

@OptIn(ExperimentalCoroutinesApi::class, FlowPreview::class)
@HiltViewModel
class NotesViewModel @Inject constructor(
    private val repository: NotesRepository,
    private val sync: SyncCoordinator,
    private val images: Images,
    private val savedState: SavedStateHandle,
) : ViewModel() {
    val syncStatus = sync.status
    val structureIds = repository.structureIds.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val totalActiveNotes = repository.activeNotesCount.stateIn(viewModelScope, SharingStarted.Eagerly, 0)
    val activeBooksCount = repository.activeBooksCount.stateIn(viewModelScope, SharingStarted.Eagerly, 0)

    fun cachedThumbnail(key: String): ImageBitmap? = images.cachedThumbnail(key, repository.profileId)
    suspend fun loadThumbnail(key: String): ImageBitmap? = images.thumbnail(key, repository.profileId)

    suspend fun noteTitle(id: String): Pair<String, Boolean> = withContext(Dispatchers.IO) {
        val note = repository.note(id)
        val fallback = if (!note?.thumbnail.isNullOrBlank()) "图片笔记" else "无标题"
        (note?.title?.ifBlank { fallback } ?: "笔记未下载") to (note?.invalid == 0 && repository.body(id) != null)
    }

    fun profiles() = sync.profiles()
    suspend fun origin() = sync.origin()

    private val mutableOrigin = MutableStateFlow<String?>(null)
    val connectedOrigin = mutableOrigin.asStateFlow()

    suspend fun switchProfile(id: String): Boolean = attempt {
        sync.switchProfile(id)
        mutableOrigin.value = sync.origin()
        true
    } ?: false

    suspend fun connect(origin: String, token: String): Boolean = attempt {
        sync.connect(origin, token)
        mutableOrigin.value = sync.origin()
        true
    } ?: false

    fun synchronize() { viewModelScope.launch { sync.synchronize() } }
    fun retrySync() { viewModelScope.launch { sync.retry() } }
    fun stopSync() { viewModelScope.launch { sync.stopAndJoin() } }

    private val ready = MutableStateFlow(false)
    val initialized = ready.asStateFlow()

    private val mutableRecoveryFailed = MutableStateFlow(false)
    val recoveryFailed = mutableRecoveryFailed.asStateFlow()

    private var activeSection = savedState.get<String>("section") ?: "home"
    private fun restoredFilter(section: String): NoteFilter = NoteFilter(
        query = savedState.get<String>("query:$section").orEmpty(),
        trash = section == "trash",
        starred = section == "star",
        groupId = section.takeIf { it.startsWith("group:") }?.substringAfter(':'),
        homeOnly = section == "home",
        hiddenOnly = section == "hidden",
        sort = savedState.get<String>("sort:$section") ?: "updated",
    )

    val filter = MutableStateFlow(restoredFilter(activeSection))

    private val effectiveFilter = filter
        .debounce { value -> if (value.query.isBlank()) 0L else 120L }
        .distinctUntilChanged()

    private fun saveFilter() {
        savedState["query:$activeSection"] = filter.value.query
        savedState["sort:$activeSection"] = filter.value.sort
    }

    fun setSection(section: String) {
        if (section == activeSection) return
        saveFilter()
        activeSection = section
        savedState["section"] = section
        filter.value = restoredFilter(section)
    }

    private val mutableMessage = MutableStateFlow<String?>(null)
    val message = mutableMessage.asStateFlow()

    var exportSnapshot: String? = null

    private val mutableIssues = MutableStateFlow<List<RecoveryIssue>>(emptyList())
    val issues = mutableIssues.asStateFlow()

    val pages = effectiveFilter
        .flatMapLatest { value -> repository.pages(value) }
        .cachedIn(viewModelScope)

    val groups = repository.groups
        .stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    val pending = repository.pendingCount
        .stateIn(viewModelScope, SharingStarted.Eagerly, 0)

    val syncFailures = repository.syncFailures
        .stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    suspend fun copyFailed(taskId: Long): String? = attempt { repository.saveFailedAsCopy(taskId).id }

    val count = effectiveFilter
        .flatMapLatest { value -> repository.count(value) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, 0)

    val missingBodies = effectiveFilter
        .flatMapLatest { value ->
            if (value.query.isBlank()) flowOf(0) else repository.missingBodies(value)
        }
        .stateIn(viewModelScope, SharingStarted.Eagerly, 0)

    suspend fun searchExcerpt(noteId: String, query: String): String? = withContext(Dispatchers.IO) {
        if (query.isBlank()) return@withContext null
        repository.body(noteId)?.let { extractSearchExcerpt(it, query) }
    }

    init {
        viewModelScope.launch { filter.collect { saveFilter() } }
        retryRecovery()
        // Seamless debounced auto-sync whenever local edits are pending and server is connected
        viewModelScope.launch {
            combine(pending, syncStatus) { pendingCount, status ->
                pendingCount > 0 && status.connected && !status.running
            }
                .distinctUntilChanged()
                .collectLatest { shouldPush ->
                    if (shouldPush) {
                        delay(1_500L)
                        if (ready.value && syncStatus.value.connected && !syncStatus.value.running) {
                            sync.synchronize()
                        }
                    }
                }
        }
        // Seamless periodic background sync while app is active
        viewModelScope.launch {
            while (isActive) {
                delay(45_000L)
                if (ready.value && syncStatus.value.connected && !syncStatus.value.running) {
                    sync.synchronize()
                }
            }
        }
    }

    fun retryRecovery() {
        viewModelScope.launch {
            try {
                mutableRecoveryFailed.value = false
                val report = withContext(Dispatchers.IO) { repository.recover() }
                mutableIssues.value = report.issues
                ready.value = true
                sync.refreshConnection()
                mutableOrigin.value = sync.origin()
                if (report.recovered > 0) mutableMessage.value = "已恢复 ${report.recovered} 份草稿"
            } catch (failure: Exception) {
                mutableRecoveryFailed.value = true
                mutableMessage.value = failure.message ?: "本机数据库无法打开，原数据已保留"
            }
        }
    }

    suspend fun create(): String? = attempt { repository.create(groupId = filter.value.groupId).id }
    suspend fun createGroup(name: String): String? = attempt { repository.createGroup(name).id }
    suspend fun renameGroup(groupId: String, name: String): Boolean = attempt { repository.renameGroup(groupId, name); true } ?: false
    suspend fun colorGroup(groupId: String, color: String?) = attempt { repository.setGroupColor(groupId, color) }
    suspend fun hideGroupFromHome(groupId: String, hidden: Boolean) = attempt { repository.setGroupHomeHidden(groupId, hidden) }
    suspend fun moveGroup(groupId: String, delta: Int) = attempt { repository.moveGroup(groupId, delta) }
    suspend fun deleteGroup(groupId: String): Boolean = attempt { repository.deleteGroup(groupId); true } ?: false
    suspend fun star(note: NoteEntity) = attempt { repository.updateProps(note.id, buildJsonObject { put("star", 1 - note.star) }) }
    suspend fun pin(note: NoteEntity) = attempt { repository.updateProps(note.id, buildJsonObject { put("top", 1 - note.top) }) }
    suspend fun skinColor(note: NoteEntity, color: String?) = attempt {
        repository.updateProps(note.id, buildJsonObject { put("skin_color", color?.let(::JsonPrimitive) ?: JsonNull) })
    }
    suspend fun hidden(note: NoteEntity, hidden: Int?) = attempt { repository.updateProps(note.id, buildJsonObject { put("home_hidden", hidden) }) }
    suspend fun assignGroup(noteId: String, groupId: String?) = attempt { repository.updateProps(noteId, buildJsonObject { put("group_id", groupId) }) }
    suspend fun trash(noteId: String, trash: Boolean): Boolean = attempt { repository.setTrash(noteId, trash); true } ?: false
    suspend fun purge(noteId: String): Boolean = attempt { repository.purgeNote(noteId); true } ?: false
    suspend fun purgeTrash(): Boolean = attempt { repository.purgeTrash(); true } ?: false
    suspend fun export(noteId: String): String? = attempt { repository.export(noteId) }
    suspend fun copyDraft(issue: RecoveryIssue): String? = attempt { repository.saveDraftAsCopy(checkNotNull(issue.snapshot)).id }

    private suspend fun <T> attempt(block: suspend () -> T): T? = try {
        withContext(Dispatchers.IO) { block() }
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (failure: Exception) {
        mutableMessage.value = failure.message ?: "操作失败，数据已保留"
        null
    }

    fun clearMessage() { mutableMessage.value = null }
}
