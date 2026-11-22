package io.github.xilele777.snotes.feature.editor

import android.net.Uri
import android.webkit.WebResourceResponse
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.xilele777.snotes.core.data.NotesRepository
import io.github.xilele777.snotes.core.editor.*
import io.github.xilele777.snotes.core.network.Images
import io.github.xilele777.snotes.core.sync.SyncCoordinator
import java.io.ByteArrayInputStream
import java.lang.ref.WeakReference
import java.net.URI
import java.util.UUID
import javax.inject.Inject
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.JsonPrimitive

data class LocalEditorState(
    val initialized: Boolean = false,
    val loaded: Boolean = false,
    val busy: Boolean = false,
    val noteId: String = "",
    val markdown: String = "",
    val hasThumbnail: Boolean = false,
    val revision: Long = 0,
    val committedRevision: Long = 0,
    val label: String = "",
    val mode: String = "ir",
    val failed: Boolean = false,
    val readOnly: Boolean = false,
    val hostGeneration: Int = 0,
)

@HiltViewModel
class LocalEditorViewModel @Inject constructor(
    private val store: NotesRepository,
    private val images: Images,
    private val sync: SyncCoordinator,
) : ViewModel() {
    fun pinEditor(id: String) = store.pinEditor(id)
    fun unpinEditor(id: String) = store.unpinEditor(id)

    private val saves = SaveSession(store, viewModelScope)
    private val mutableState = MutableStateFlow(LocalEditorState())
    val state = mutableState.asStateFlow()
    val openCount = MutableStateFlow(0L)
    val history = MutableStateFlow(emptyList<io.github.xilele777.snotes.core.database.HistoryEntity>())

    suspend fun loadHistory() {
        history.value = withContext(Dispatchers.IO) { store.database.notes().history(state.value.noteId) }
    }

    suspend fun restoreHistory(markdown: String) {
        if (state.value.readOnly || !flushAndSave()) return
        key?.let { webView?.send(EditorProtocol.nativeMessage("replaceMarkdown", it, mapOf("markdown" to JsonPrimitive(markdown)))) }
    }

    private var webReference = WeakReference<EditorWebView>(null)
    val webView: EditorWebView? get() = webReference.get()
    private var key: SessionKey? = null
    private var baseline = ""
    private var composing = false
    private var dark = false
    private var fontSize = 16
    private var lineSpacing = "standard"
    private var connected = false
    private var initiallyDirty = false
    private var readyReceived = false
    private var flush: Pair<String, CompletableDeferred<EditorMessage.Flushed>>? = null
    var openLink: ((String) -> Unit)? = null

    private fun idleLabel(modifiedInSession: Boolean): String = when {
        !connected -> "已保存到本机"
        modifiedInSession || initiallyDirty -> "已保存到本机 · 待同步"
        else -> "已同步"
    }

    init {
        viewModelScope.launch {
            saves.event.collect { event ->
                if (event == null || event.snapshot.key != key) return@collect
                val value = mutableState.value
                when (event.phase) {
                    SavePhase.SAVED -> {
                        val committed = maxOf(value.committedRevision, event.snapshot.revision)
                        if (committed > 0) initiallyDirty = true
                        mutableState.value = value.copy(
                            committedRevision = committed,
                            failed = false,
                            label = if (committed >= value.revision) idleLabel(committed > 0) else "正在保存…",
                        )
                        webView?.send(EditorProtocol.nativeMessage("saved", event.snapshot.key, mapOf("revision" to JsonPrimitive(committed))))
                    }
                    SavePhase.SAVING -> if (event.snapshot.revision >= value.committedRevision) {
                        mutableState.value = value.copy(label = "正在保存…")
                    }
                    SavePhase.ERROR -> {
                        mutableState.value = value.copy(failed = true, label = "保存失败 · ${event.reason ?: "可重试或分享正文"}")
                        webView?.send(EditorProtocol.nativeMessage("saveError", event.snapshot.key))
                    }
                }
            }
        }
    }

    fun attach(view: EditorWebView, isDark: Boolean, textSize: Int, spacing: String = "standard") {
        webReference = WeakReference(view)
        val profileId = store.profileId
        view.imageResource = { imageKey ->
            runBlocking {
                val value = images.read(imageKey, profileId)
                if (value != null) WebResourceResponse(value.mime, null, ByteArrayInputStream(value.bytes))
                else WebResourceResponse(
                    "image/svg+xml",
                    "UTF-8",
                    ByteArrayInputStream("<svg xmlns='http://www.w3.org/2000/svg' width='300' height='70'><rect width='300' height='70' fill='#eee'/><text x='12' y='40' fill='#555' font-size='16'>图片未缓存，请联网后重新预览</text></svg>".toByteArray()),
                )
            }
        }
        dark = isDark
        fontSize = textSize.coerceIn(12, 48)
        lineSpacing = spacing
        val pending = if (key != null && state.value.revision > state.value.committedRevision) snapshot() else null
        mutableState.value = state.value.copy(loaded = false)
        readyReceived = false
        viewModelScope.launch {
            val saved = pending == null || saves.flush(pending).saved
            if (webView !== view) return@launch
            key = SessionKey(store.profileId, state.value.noteId, UUID.randomUUID().toString())
            baseline = if (saved) state.value.markdown else checkNotNull(pending).baseline
            composing = false
            mutableState.value = state.value.copy(
                revision = 0,
                committedRevision = 0,
                label = if (saved) idleLabel(pending != null) else "保存失败 · 当前草稿已保留",
                failed = !saved,
            )
            view.start()
        }
    }

    fun detach(view: EditorWebView) {
        view.imageResource = null
        if (webView === view) {
            webReference.clear()
            flush?.second?.cancel()
            flush = null
        }
    }

    fun appearance(isDark: Boolean, size: Int, spacing: String = lineSpacing) {
        dark = isDark
        fontSize = size.coerceIn(12, 48)
        lineSpacing = spacing
        key?.let {
            webView?.send(
                EditorProtocol.nativeMessage(
                    "appearance",
                    it,
                    mapOf(
                        "dark" to JsonPrimitive(dark),
                        "fontSize" to JsonPrimitive(fontSize),
                        "lineSpacing" to JsonPrimitive(lineSpacing),
                    ),
                ),
            )
        }
    }

    fun toggleReading() {
        key?.let {
            webView?.send(
                EditorProtocol.nativeMessage(
                    "mode",
                    it,
                    mapOf("mode" to JsonPrimitive(if (state.value.mode == "preview") "ir" else "preview")),
                ),
            )
        }
    }

    /**
     * Flushes the live editor buffer to local SQLite and immediately pushes this note to the server.
     */
    suspend fun syncNow(): Pair<Boolean, String> {
        val currentId = state.value.noteId
        if (!state.value.initialized || currentId.isBlank() || state.value.busy) {
            return false to "正在处理，请稍候"
        }
        if (state.value.loaded && !state.value.readOnly) {
            if (!flushAndSave(lock = false, resumeAfter = true)) {
                return false to (state.value.label.ifBlank { "无法确认最后一次输入，请完成输入后重试" })
            }
        }
        val expected = key
        mutableState.value = state.value.copy(busy = true, label = "正在同步…")
        return try {
            val result = sync.synchronizeNote(currentId, store.profileId)
            if (result.isSuccess) {
                initiallyDirty = false
                if (key == expected) {
                    mutableState.value = state.value.copy(busy = false, failed = false, label = "已同步")
                }
                true to (result.getOrNull() ?: "当前笔记已同步")
            } else {
                val msg = result.exceptionOrNull()?.message ?: "同步失败，本机内容已保留"
                if (key == expected) {
                    mutableState.value = state.value.copy(busy = false, label = idleLabel(true))
                }
                false to msg
            }
        } finally {
            if (key == expected && state.value.busy) {
                mutableState.value = state.value.copy(busy = false, label = idleLabel(!initiallyDirty))
            }
        }
    }

    suspend fun upload(uri: Uri): Boolean {
        val expected = key ?: return false
        if (!state.value.loaded || state.value.busy || composing || state.value.mode == "preview") return false
        mutableState.value = state.value.copy(busy = true, label = "正在上传图片…")
        return try {
            val url = images.upload(uri, expected.noteId, expected.profileId)
            if (key != expected) return false
            webView?.send(EditorProtocol.nativeMessage("insertImage", expected, mapOf("url" to JsonPrimitive(url))))
            true
        } catch (failure: Exception) {
            error(failure.message ?: "图片上传失败，正文已保留")
            false
        } finally {
            if (key == expected) mutableState.value = state.value.copy(busy = false)
        }
    }

    private fun sendLoad() {
        val session = key ?: return
        webView?.send(
            EditorProtocol.nativeMessage(
                "load",
                session,
                mapOf(
                    "markdown" to JsonPrimitive(state.value.markdown),
                    "readOnly" to JsonPrimitive(state.value.readOnly),
                    "dark" to JsonPrimitive(dark),
                    "fontSize" to JsonPrimitive(fontSize),
                    "lineSpacing" to JsonPrimitive(lineSpacing),
                ),
            ),
        )
    }

    fun receive(message: EditorMessage) {
        if (message == EditorMessage.Ready) {
            if (!readyReceived) {
                readyReceived = true
                sendLoad()
            }
            return
        }
        val expected = key ?: return
        when (message) {
            is EditorMessage.Loaded -> if (message.key == expected) mutableState.value = state.value.copy(loaded = true)
            is EditorMessage.Change -> if (accept(message.key, message.revision, message.markdown)) {
                composing = message.composing
                mutableState.value = state.value.copy(
                    markdown = message.markdown,
                    revision = message.revision,
                    label = if (message.composing) "正在输入…" else "正在保存…",
                    failed = false,
                )
                if (message.revision > 0) saves.changed(snapshot())
            }
            is EditorMessage.Flushed -> if (message.key == expected && message.requestId == flush?.first && accept(message.key, message.revision, message.markdown)) {
                mutableState.value = state.value.copy(markdown = message.markdown, revision = message.revision)
                composing = message.composing
                flush?.second?.complete(message)
            }
            is EditorMessage.FlushError -> if (message.key == expected && message.requestId == flush?.first) {
                flush?.second?.completeExceptionally(IllegalStateException("Editor mode transition"))
            }
            is EditorMessage.Mode -> if (message.key == expected) mutableState.value = state.value.copy(mode = message.mode)
            is EditorMessage.OpenLink -> if (message.key == expected && safeExternalLink(message.url)) openLink?.invoke(message.url)
            else -> Unit
        }
    }

    private fun accept(candidate: SessionKey, revision: Long, markdown: String): Boolean =
        candidate == key && (revision > state.value.revision || revision == state.value.revision && markdown == state.value.markdown)

    private fun snapshot() = DraftSnapshot(checkNotNull(key), state.value.revision, baseline, state.value.markdown, composing)

    private fun safeExternalLink(url: String): Boolean = runCatching {
        val uri = URI(url)
        uri.scheme in setOf("https", "http") && !uri.host.isNullOrBlank() && uri.rawUserInfo == null && uri.host != "appassets.androidplatform.net"
    }.getOrDefault(false)

    suspend fun flushAndSave(lock: Boolean = false, resumeAfter: Boolean = true): Boolean {
        val expected = key ?: return false
        if (!state.value.loaded || flush != null) return false
        if (state.value.readOnly) return true
        val requestId = UUID.randomUUID().toString()
        val response = CompletableDeferred<EditorMessage.Flushed>()
        flush = requestId to response
        var confirmed = false
        return try {
            webView?.send(EditorProtocol.nativeMessage("flush", expected, mapOf("requestId" to JsonPrimitive(requestId), "lock" to JsonPrimitive(lock))))
            val result = withTimeout(4_000) { response.await() }
            if (key != expected) return false
            if (lock && result.composing) throw IllegalStateException("Composition still active")
            val saved = saves.flush(snapshot()).saved
            if (!saved) error("保存失败 · 可重试或分享正文")
            confirmed = saved
            saved
        } catch (cancelled: CancellationException) {
            if (cancelled !is TimeoutCancellationException) throw cancelled
            error("编辑器未及时响应，内容仍保留。请重试。")
            false
        } catch (_: Exception) {
            error("无法确认最后一次输入，请完成输入后重试。")
            false
        } finally {
            if (flush?.first == requestId) flush = null
            if (lock && key == expected && (resumeAfter || !confirmed)) webView?.send(EditorProtocol.nativeMessage("resume", expected))
        }
    }

    fun open(noteId: String) {
        if (state.value.noteId == noteId && state.value.initialized) return
        key = null
        mutableState.value = LocalEditorState(noteId = noteId)
        viewModelScope.launch {
            try {
                val (markdown, readOnly, isConnected, isDirty, hasThumb) = withContext(Dispatchers.IO) {
                    if (store.hasUncommittedDraft(noteId)) {
                        store.recover()
                    }
                    val note = checkNotNull(store.note(noteId)) { "笔记不存在" }
                    check(note.invalid in 0..1) { "笔记已永久删除" }
                    val body = checkNotNull(store.body(noteId)) { "正文尚未下载，连接服务端后才能编辑" }
                    val hasOrigin = store.database.notes().meta("instance_origin") != null
                    val dirtyFlag = note.dirty !in setOf("none", "clean")
                    OpenResult(body, note.invalid == 1, hasOrigin, dirtyFlag, !note.thumbnail.isNullOrBlank())
                }
                baseline = markdown
                connected = isConnected
                initiallyDirty = isDirty
                mutableState.value = state.value.copy(
                    initialized = true,
                    readOnly = readOnly,
                    markdown = markdown,
                    hasThumbnail = hasThumb,
                    label = if (readOnly) "回收站 · 只读预览" else idleLabel(false),
                )
                withContext(Dispatchers.IO) {
                    io.github.xilele777.snotes.core.data.Opens(store).record(noteId)
                    openCount.value = io.github.xilele777.snotes.core.data.Opens(store).count(noteId)
                }
            } catch (failure: Exception) {
                error(failure.message ?: "无法读取本地笔记，数据已保留")
            }
        }
    }

    private data class OpenResult(
        val markdown: String,
        val readOnly: Boolean,
        val connected: Boolean,
        val dirty: Boolean,
        val hasThumbnail: Boolean,
    )

    suspend fun saveCapturedAsCopy(): String? = try {
        withContext(Dispatchers.IO) { store.saveDraftAsCopy(snapshot()).id }
    } catch (failure: Exception) {
        error(failure.message ?: "另存失败，草稿已保留")
        null
    }

    fun background() {
        if (state.value.loaded && !state.value.busy && flush == null) viewModelScope.launch { flushAndSave() }
    }

    fun retryEditor() {
        if (!state.value.initialized) return
        webView?.let(EditorWebViewPool::evict)
        mutableState.value = state.value.copy(hostGeneration = state.value.hostGeneration + 1, loaded = false)
    }

    suspend fun leaveAfterFailure(): Boolean {
        if (state.value.loaded) return flushAndSave(lock = true, resumeAfter = false)
        if (!state.value.initialized || key == null) return true
        return saves.flush(snapshot()).saved
    }

    suspend fun beforeIncoming(): Boolean = if (state.value.loaded) flushAndSave(lock = true, resumeAfter = true) else leaveAfterFailure()

    fun webFailed() {
        webView?.let(EditorWebViewPool::evict)
        mutableState.value = state.value.copy(loaded = false)
        error("本地编辑器不可用；已捕获的内容保留。请重试或更新 System WebView。")
    }

    private fun error(label: String) {
        mutableState.value = state.value.copy(failed = true, label = label)
    }

    override fun onCleared() {
        saves.close()
        super.onCleared()
    }
}
