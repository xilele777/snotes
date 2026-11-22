package io.github.xilele777.snotes.feature.notes

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.xilele777.snotes.core.data.*
import io.github.xilele777.snotes.core.database.*
import io.github.xilele777.snotes.core.network.*
import javax.inject.Inject
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

data class BooksCatalogSnapshot(
    val entries: List<KnowledgeBaseEntity> = emptyList(),
    val nodes: List<TocEntity> = emptyList(),
    val metadata: Map<String, BookDto> = emptyMap(),
    val details: Map<String, BookRemoteDto> = emptyMap(),
    val noteTitles: Map<String, Pair<String, Boolean>> = emptyMap(),
    val loaded: Boolean = false,
)

@HiltViewModel
class BooksManagerModel @Inject constructor(
    private val notes: NotesRepository,
    private val books: BookRepository,
) : ViewModel() {
    val catalog: StateFlow<BooksCatalogSnapshot> = combine(
        notes.database.notes().observeBooks(),
        notes.database.notes().observeTocs(),
        notes.database.notes().observeMetas("book:").distinctUntilChanged(),
    ) { entries, tocs, _ ->
        withContext(Dispatchers.IO) {
            val detailsMap = entries.mapNotNull { entry ->
                books.desired(entry.id)?.let { entry.id to it }
            }.toMap()
            val metaMap = detailsMap.mapValues { (_, dto) -> dto.book }
            val allNoteIds = tocs.mapNotNull { it.noteId }.distinct()
            val summaryById = if (allNoteIds.isEmpty()) {
                emptyMap()
            } else {
                allNoteIds.chunked(450).flatMap { chunk ->
                    notes.database.notes().noteSummaries(chunk)
                }.associateBy { it.id }
            }
            val titles = allNoteIds.associateWith { id ->
                val note = summaryById[id]
                val fallback = if (!note?.thumbnail.isNullOrBlank()) "图片笔记" else "无标题"
                val label = when {
                    note == null -> "笔记尚未同步到本机"
                    note.invalid == 1 -> "${note.title.ifBlank { fallback }}（在回收站）"
                    else -> note.title.ifBlank { fallback }
                }
                label to (note?.invalid == 0 && note.hasBody)
            }
            BooksCatalogSnapshot(
                entries = entries,
                nodes = tocs,
                metadata = metaMap,
                details = detailsMap,
                noteTitles = titles,
                loaded = true,
            )
        }
    }.stateIn(viewModelScope, SharingStarted.Eagerly, BooksCatalogSnapshot())

    val failures = notes.syncFailures.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val history = notes.database.notes().observeMetas("book_history:").stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val message = MutableStateFlow("")

    suspend fun details(id: String) = withContext(Dispatchers.IO) { books.desired(id) }
    suspend fun candidates(query: String) = withContext(Dispatchers.IO) {
        val ownedIds = notes.database.notes().books().filter { it.invalid == 0 }
            .flatMap { book -> notes.database.notes().toc(book.id).mapNotNull { it.noteId } }
            .toSet()
        notes.database.notes().selectNotes(query).filter { it.id !in ownedIds }
    }
    suspend fun matchingBookNoteIds(bookId: String, query: String): Set<String> = withContext(Dispatchers.IO) {
        if (query.isBlank()) emptySet()
        else notes.database.notes().matchingBookNoteIds(bookId, query).toSet()
    }
    suspend fun label(id: String) = withContext(Dispatchers.IO) {
        val note = notes.note(id)
        val fallback = if (!note?.thumbnail.isNullOrBlank()) "图片笔记" else "无标题"
        (note?.title?.ifBlank { fallback } ?: "引用笔记缺失") to (note?.invalid == 0 && notes.body(id) != null)
    }
    suspend fun createNote(id: String, parent: String? = null): String? = try {
        withContext(Dispatchers.IO) { books.createNote(id, parent) }
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (error: Exception) {
        message.value = error.message ?: "创建失败，原内容已保留"
        null
    }
    fun noteTrash(id: String, book: String, trash: Boolean) {
        viewModelScope.launch {
            try {
                withContext(Dispatchers.IO) { notes.setBookNoteTrash(id, book, trash) }
                message.value = if (trash) "笔记已移入回收站" else "已恢复笔记"
            } catch (error: Exception) {
                message.value = error.message ?: "操作失败"
            }
        }
    }
    fun act(block: BookRepository.() -> Unit) {
        viewModelScope.launch {
            try {
                withContext(Dispatchers.IO) { books.block(); notes.requestSync() }
            } catch (error: Exception) {
                message.value = error.message ?: "操作失败，原内容已保留"
            }
        }
    }
}
