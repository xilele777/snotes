package io.github.xilele777.snotes.feature.notes

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import io.github.xilele777.snotes.core.data.*
import io.github.xilele777.snotes.core.database.*
import io.github.xilele777.snotes.core.network.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import java.util.UUID

@HiltViewModel class BooksManagerModel @Inject constructor(private val notes: NotesRepository, private val books: BookRepository) : ViewModel() {
    val entries = notes.database.notes().observeBooks().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())
    val nodes = notes.database.notes().observeTocs().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())
    val failures = notes.syncFailures.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())
    val history = notes.database.notes().observeMetas("book_history:").stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())
    val message = MutableStateFlow("")
    suspend fun details(id: String) = withContext(Dispatchers.IO) { books.desired(id) }
    suspend fun candidates(query: String) = withContext(Dispatchers.IO) { notes.database.notes().selectNotes(query) }
    suspend fun label(id: String) = withContext(Dispatchers.IO) { val note = notes.note(id); (note?.title?.ifBlank { "无标题" } ?: "引用笔记缺失") to (note?.invalid == 0 && notes.body(id) != null) }
    fun noteTrash(id: String, book: String, trash: Boolean) { viewModelScope.launch { try { withContext(Dispatchers.IO) { notes.setBookNoteTrash(id, book, trash) }; message.value = "引用笔记状态已保存，等待同步" } catch (error: Exception) { message.value = error.message ?: "操作失败" } } }
    fun act(block: BookRepository.() -> Unit) { viewModelScope.launch { try { withContext(Dispatchers.IO) { books.block(); notes.requestSync() }; message.value = "已保存到本机，等待同步" } catch (error: Exception) { message.value = error.message ?: "操作失败，原内容已保留" } } }
}

@Composable fun BooksManagerScreen(onOpen: (String) -> Unit, model: BooksManagerModel = viewModel()) {
    val entries by model.entries.collectAsStateWithLifecycle(); val nodes by model.nodes.collectAsStateWithLifecycle()
    val failures by model.failures.collectAsStateWithLifecycle(); val history by model.history.collectAsStateWithLifecycle()
    val message by model.message.collectAsStateWithLifecycle()
    var selected by remember { mutableStateOf<String?>(null) }; var value by remember { mutableStateOf<BookRemoteDto?>(null) }
    var name by remember { mutableStateOf<String?>(null) }; var description by remember { mutableStateOf("") }; var creating by remember { mutableStateOf(false) }
    var folder by remember { mutableStateOf<String?>(null) }; var picking by remember { mutableStateOf(false) }; var query by remember { mutableStateOf("") }
    var candidates by remember { mutableStateOf(emptyList<NoteEntity>()) }; var moving by remember { mutableStateOf<TocNodeDto?>(null) }
    var deleting by remember { mutableStateOf(false) }; var typedName by remember { mutableStateOf("") }; var dissolve by remember { mutableStateOf(false) }
    LaunchedEffect(selected, entries, nodes) { value = selected?.let { model.details(it) } }
    LaunchedEffect(picking, query) { if (picking) candidates = model.candidates(query) }
    val current = value
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item { Text("笔记本", style = MaterialTheme.typography.headlineMedium); Text("目录操作先存本机；冲突需选择保留哪一端。永久删除会删除引用笔记。")
            TextButton(onClick = { creating = true; name = ""; description = "" }) { Text("新建笔记本") }; if (message.isNotBlank()) Text(message) }
        items(entries, key = { it.id }) { book ->
            TextButton(onClick = { selected = if (selected == book.id) null else book.id }) { Text(book.name + if (book.invalid == 1) "（已归档）" else "") }
        }
        if (current != null) {
            item { Text(current.book.name, style = MaterialTheme.typography.titleLarge); Text(current.book.description)
                Row { TextButton(onClick = { creating = false; name = current.book.name; description = current.book.description }) { Text("修改信息") }
                    TextButton(onClick = { model.act { editMeta(current.book.id, current.book.name, current.book.description, 1 - current.book.invalid) } }) { Text(if (current.book.invalid == 1) "恢复笔记本" else "归档") } }
                Row { TextButton(onClick = { folder = "" }) { Text("添加章节") }; TextButton(onClick = { picking = true }) { Text("引用笔记") } }
            }
            val relevant = failures.filter { it.task.entityType == "book" && it.task.entityId == current.book.id }
            if (relevant.isNotEmpty()) item { Column {
                relevant.forEach { Text(it.task.lastError.orEmpty(), color = MaterialTheme.colorScheme.error) }
                Row { TextButton(onClick = { model.act { resolve(current.book.id, true) } }) { Text("保留本机并重试") }; TextButton(onClick = { model.act { resolve(current.book.id, false) } }) { Text("采用远端") } }
            } }
            fun flatten(parent: String?, depth: Int): List<Pair<TocNodeDto, Int>> = if (depth >= 8) emptyList() else current.toc.nodes.filter { it.parentId == parent }.sortedWith(compareBy({ it.ord }, { it.id })).flatMap { listOf(it to depth) + flatten(it.id, depth + 1) }
            items(flatten(null, 0), key = { it.first.id }) { (node, depth) ->
                var label by remember(node, current.book.changeSeq) { mutableStateOf(node.title.orEmpty()) }; var available by remember(node) { mutableStateOf(false) }
                LaunchedEffect(node, current.book.changeSeq) { node.noteId?.let { val result = model.label(it); label = result.first; available = result.second } }
                Card(Modifier.fillMaxWidth().padding(start = (depth * 12).dp)) { Column(Modifier.padding(8.dp)) {
                    Text((if (node.kind == "folder") "▸ " else "• ") + label + if (node.noteId != null && !available) "（不可用）" else "")
                    Row {
                        if (available) TextButton(onClick = { onOpen(node.noteId!!) }) { Text("打开") }
                        if (node.noteId != null) TextButton(onClick = { model.noteTrash(node.noteId, current.book.id, available) }) { Text(if (available) "移到回收站" else "恢复引用笔记") }
                        TextButton(onClick = { moving = node }) { Text("移动") }
                        TextButton(onClick = { model.act {
                            val ids = mutableSetOf(node.id); var changed = true
                            while (changed) { changed = false; current.toc.nodes.forEach { if (it.parentId in ids && ids.add(it.id)) changed = true } }
                            editToc(current.book.id, current.toc.nodes.filter { it.id !in ids })
                        } }) { Text(if (node.kind == "folder") "移除章节引用" else "解除引用") }
                    }
                } }
            }
            item { Row { TextButton(onClick = { dissolve = true }) { Text("解散笔记本") }; TextButton(onClick = { typedName = ""; deleting = true }) { Text("永久删除", color = MaterialTheme.colorScheme.error) } } }
            items(history.filter { it.key.startsWith("book_history:${current.book.id}:") }.takeLast(20).reversed()) { entry ->
                val historical = syncJson.parseToJsonElement(entry.value).jsonObject
                TextButton(onClick = { model.act {
                    val nodes = syncJson.decodeFromJsonElement<List<TocNodeDto>>(historical.getValue("nodes"))
                    val meta = historical["meta"]?.jsonObject
                    if (meta != null) editMeta(current.book.id, meta.getValue("name").jsonPrimitive.content, meta.getValue("description").jsonPrimitive.content, meta.getValue("invalid").jsonPrimitive.int, meta.getValue("icon").jsonPrimitive.content, meta.getValue("ord").jsonPrimitive.int)
                    editToc(current.book.id, nodes, true)
                } }) { Text("恢复目录历史 · ${historical["time"]?.jsonPrimitive?.content}") }
            }
        }
    }
    if (name != null) AlertDialog(onDismissRequest = { name = null }, title = { Text(if (creating) "新建笔记本" else "修改笔记本") }, text = { Column {
        OutlinedTextField(name.orEmpty(), { name = it.take(100) }, label = { Text("名称") }); OutlinedTextField(description, { description = it.take(2000) }, label = { Text("简介") })
    } }, confirmButton = { TextButton(onClick = { val chosenName = name.orEmpty(); val desc = description; model.act { if (creating) { val id = create(chosenName); editMeta(id, chosenName, desc) } else current?.let { editMeta(it.book.id, chosenName, desc, it.book.invalid) } }; name = null }, enabled = name?.isNotBlank() == true) { Text("保存") } }, dismissButton = { TextButton(onClick = { name = null }) { Text("取消") } })
    if (folder != null && current != null) AlertDialog(onDismissRequest = { folder = null }, title = { Text("添加章节") }, text = { OutlinedTextField(folder.orEmpty(), { folder = it.take(100) }, label = { Text("章节名称") }) }, confirmButton = { TextButton(onClick = { val title = folder.orEmpty(); model.act { editToc(current.book.id, current.toc.nodes + TocNodeDto(UUID.randomUUID().toString(), null, "folder", current.toc.nodes.count { it.parentId == null }, null, title)) }; folder = null }, enabled = folder?.isNotBlank() == true) { Text("添加") } }, dismissButton = { TextButton(onClick = { folder = null }) { Text("取消") } })
    if (picking && current != null) AlertDialog(onDismissRequest = { picking = false }, title = { Text("引用本机笔记") }, text = { Column { OutlinedTextField(query, { query = it.take(100) }, label = { Text("搜索标题（最多 50 条）") }); LazyColumn { items(candidates, key = { it.id }) { note -> TextButton(onClick = { model.act { editToc(current.book.id, current.toc.nodes + TocNodeDto(UUID.randomUUID().toString(), null, "note", current.toc.nodes.count { it.parentId == null }, note.id, null)) }; picking = false }) { Text(note.title.ifBlank { "无标题" }) } } } } }, confirmButton = { TextButton(onClick = { picking = false }) { Text("关闭") } })
    if (moving != null && current != null) AlertDialog(onDismissRequest = { moving = null }, title = { Text("移动节点") }, text = { LazyColumn {
        items(listOf<TocNodeDto?>(null) + current.toc.nodes.filter { it.kind == "folder" && it.id != moving?.id }) { parent -> TextButton(onClick = { val node = moving!!; model.act { editToc(current.book.id, current.toc.nodes.map { if (it.id == node.id) it.copy(parentId = parent?.id, ord = current.toc.nodes.count { item -> item.parentId == parent?.id }) else it }) }; moving = null }) { Text(parent?.title ?: "目录根部") } }
        item { Row { TextButton(onClick = { val node = moving!!; model.act { editToc(current.book.id, current.toc.nodes.map { if (it.id == node.id) it.copy(ord = (it.ord - 1).coerceAtLeast(0)) else if (it.parentId == node.parentId && it.ord == node.ord - 1) it.copy(ord = node.ord) else it }) }; moving = null }) { Text("上移") }; TextButton(onClick = { val node = moving!!; model.act { editToc(current.book.id, current.toc.nodes.map { if (it.id == node.id) it.copy(ord = (it.ord + 1).coerceAtMost(1000)) else if (it.parentId == node.parentId && it.ord == node.ord + 1) it.copy(ord = node.ord) else it }) }; moving = null }) { Text("下移") } } }
    } }, confirmButton = { TextButton(onClick = { moving = null }) { Text("取消") } })
    if (dissolve && current != null) AlertDialog(onDismissRequest = { dissolve = false }, title = { Text("解散笔记本？") }, text = { Text("清空目录并归档笔记本，引用笔记仍保留，目录历史可恢复。") }, confirmButton = { TextButton(onClick = { model.act { editToc(current.book.id, emptyList()); editMeta(current.book.id, current.book.name, current.book.description, 1) }; dissolve = false }) { Text("解散") } }, dismissButton = { TextButton(onClick = { dissolve = false }) { Text("取消") } })
    if (deleting && current != null) AlertDialog(onDismissRequest = { deleting = false }, title = { Text("永久删除笔记本") }, text = { Column { Text("将永久删除目录和引用笔记，无法撤销。请输入完整名称：${current.book.name}"); OutlinedTextField(typedName, { typedName = it }, label = { Text("完整名称") }) } }, confirmButton = { TextButton(onClick = { model.act { deletePermanently(current.book.id, typedName) }; deleting = false }, enabled = typedName == current.book.name) { Text("永久删除") } }, dismissButton = { TextButton(onClick = { deleting = false }) { Text("取消") } })
}
