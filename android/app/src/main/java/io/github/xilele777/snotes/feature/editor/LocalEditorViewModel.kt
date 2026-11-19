package io.github.xilele777.snotes.feature.editor

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.github.xilele777.snotes.core.editor.*
import io.github.xilele777.snotes.core.data.NotesRepository
import java.net.URI
import java.util.UUID
import java.lang.ref.WeakReference
import javax.inject.Inject
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.JsonPrimitive

data class LocalEditorState(
    val initialized: Boolean = false, val loaded: Boolean = false, val busy: Boolean = false,
    val noteId: String = "", val markdown: String = "", val revision: Long = 0,
    val committedRevision: Long = 0, val label: String = "正在读取本地笔记…", val mode: String = "source",
    val failed: Boolean = false,
    val hostGeneration: Int = 0,
)

@HiltViewModel
class LocalEditorViewModel @Inject constructor(private val store: NotesRepository) : ViewModel() {
    fun pinEditor(id: String) = store.pinEditor(id)
    fun unpinEditor(id: String) = store.unpinEditor(id)
    private val saves = SaveSession(store, viewModelScope)
    private val mutableState = MutableStateFlow(LocalEditorState())
    val state = mutableState.asStateFlow()
    private var webReference = WeakReference<EditorWebView>(null)
    val webView: EditorWebView? get() = webReference.get()
    private var key: SessionKey? = null
    private var baseline = ""
    private var composing = false
    private var dark = false
    private var fontSize = 16
    private var readyReceived = false
    private var flush: Pair<String, CompletableDeferred<EditorMessage.Flushed>>? = null
    var openLink: ((String) -> Unit)? = null

    init {
        viewModelScope.launch {
            saves.event.collect { event ->
                if (event == null || event.snapshot.key != key) return@collect
                val value = mutableState.value
                when (event.phase) {
                    SavePhase.SAVED -> {
                        val committed = maxOf(value.committedRevision, event.snapshot.revision)
                        mutableState.value = value.copy(committedRevision = committed, failed = false,
                            label = if (committed >= value.revision) "已保存到本机 · 尚未同步" else "正在保存到本机…")
                        webView?.send(EditorProtocol.nativeMessage("saved", event.snapshot.key, mapOf("revision" to JsonPrimitive(committed))))
                    }
                    SavePhase.SAVING -> if (event.snapshot.revision >= value.committedRevision) mutableState.value = value.copy(label = "正在保存到本机…")
                    SavePhase.ERROR -> {
                        mutableState.value = value.copy(failed = true, label = "保存失败 · ${event.reason ?: "可重试或分享正文"}")
                        webView?.send(EditorProtocol.nativeMessage("saveError", event.snapshot.key))
                    }
                }
            }
        }
    }

    fun attach(view: EditorWebView, isDark: Boolean, textSize: Int) {
        webReference = WeakReference(view)
        dark = isDark
        fontSize = textSize.coerceIn(12, 48)
        val pending = if (key != null && state.value.revision > state.value.committedRevision) snapshot() else null
        mutableState.value = state.value.copy(loaded = false)
        readyReceived = false
        viewModelScope.launch {
            // Finish a captured revision before a recreated host starts a new
            // revision sequence; failure retains its original conflict baseline.
            val saved = pending == null || saves.flush(pending).saved
            if (webView !== view) return@launch
            key = SessionKey(store.profileId, state.value.noteId, UUID.randomUUID().toString())
            baseline = if (saved) state.value.markdown else checkNotNull(pending).baseline
            composing = false
            mutableState.value = state.value.copy(revision = 0, committedRevision = 0,
                label = if (saved) "已保存到本机 · 尚未同步" else "保存失败 · 当前草稿已保留", failed = !saved)
            view.start()
        }
    }
    fun detach(view: EditorWebView) {
        if (webView === view) { webReference.clear(); flush?.second?.cancel(); flush = null }
    }
    private fun sendLoad() {
        val session = key ?: return
        webView?.send(EditorProtocol.nativeMessage("load", session, mapOf(
            "markdown" to JsonPrimitive(state.value.markdown), "readOnly" to JsonPrimitive(false),
            "dark" to JsonPrimitive(dark), "fontSize" to JsonPrimitive(fontSize),
        )))
    }
    fun receive(message: EditorMessage) {
        if (message == EditorMessage.Ready) { if (!readyReceived) { readyReceived = true; sendLoad() }; return }
        val expected = key ?: return
        when (message) {
            is EditorMessage.Loaded -> if (message.key == expected) mutableState.value = state.value.copy(loaded = true)
            is EditorMessage.Change -> if (accept(message.key, message.revision, message.markdown)) {
                composing = message.composing
                mutableState.value = state.value.copy(markdown = message.markdown, revision = message.revision,
                    label = if (message.composing) "正在输入 · 草稿写入中" else "正在保存到本机…", failed = false)
                if (message.revision > 0) saves.changed(snapshot())
            }
            is EditorMessage.Flushed -> if (message.key == expected && message.requestId == flush?.first && accept(message.key, message.revision, message.markdown)) {
                mutableState.value = state.value.copy(markdown = message.markdown, revision = message.revision)
                composing = message.composing
                flush?.second?.complete(message)
            }
            is EditorMessage.FlushError -> if (message.key == expected && message.requestId == flush?.first) flush?.second?.completeExceptionally(IllegalStateException("Editor mode transition"))
            is EditorMessage.Mode -> if (message.key == expected) mutableState.value = state.value.copy(mode = message.mode)
            is EditorMessage.OpenLink -> if (message.key == expected && safeExternalLink(message.url)) openLink?.invoke(message.url)
            else -> Unit
        }
    }
    private fun accept(candidate: SessionKey, revision: Long, markdown: String): Boolean = candidate == key &&
        (revision > state.value.revision || revision == state.value.revision && markdown == state.value.markdown)
    private fun snapshot() = DraftSnapshot(checkNotNull(key), state.value.revision, baseline, state.value.markdown, composing)
    private fun safeExternalLink(url: String): Boolean = runCatching {
        val uri = URI(url)
        uri.scheme in setOf("https", "http") && !uri.host.isNullOrBlank() && uri.rawUserInfo == null && uri.host != "appassets.androidplatform.net"
    }.getOrDefault(false)

    suspend fun flushAndSave(lock: Boolean = false, resumeAfter: Boolean = true): Boolean {
        val expected = key ?: return false
        if (!state.value.loaded || flush != null) return false
        val requestId = UUID.randomUUID().toString()
        val response = CompletableDeferred<EditorMessage.Flushed>()
        flush = requestId to response
        var confirmed = false
        return try {
            webView?.send(EditorProtocol.nativeMessage("flush", expected, mapOf("requestId" to JsonPrimitive(requestId), "lock" to JsonPrimitive(lock))))
            val result = withTimeout(4_000) { response.await() }
            if (key != expected) return false
            if (lock && result.composing) throw IllegalStateException("Composition still active")
            // IO completes before a navigation is allowed; no network request is involved.
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
                val markdown = withContext(Dispatchers.IO) {
                    store.recover()
                    val note = checkNotNull(store.note(noteId)) { "笔记不存在" }
                    check(note.invalid == 0) { "请先从回收站恢复笔记" }
                    checkNotNull(store.body(noteId)) { "正文尚未下载，连接服务端后才能编辑" }
                }
                baseline = markdown
                mutableState.value = state.value.copy(initialized = true, markdown = markdown, label = "已保存到本机 · 尚未同步")
            } catch (failure: Exception) { error(failure.message ?: "无法读取本地笔记，数据已保留") }
        }
    }
    suspend fun saveCapturedAsCopy(): String? = try {
        withContext(Dispatchers.IO) { store.saveDraftAsCopy(snapshot()).id }
    } catch (failure: Exception) { error(failure.message ?: "另存失败，草稿已保留"); null }
    fun background() {
        if (state.value.loaded && !state.value.busy && flush == null) viewModelScope.launch { flushAndSave() }
    }
    fun retryEditor() {
        if (!state.value.initialized) return
        mutableState.value = state.value.copy(hostGeneration = state.value.hostGeneration + 1, loaded = false)
    }
    suspend fun leaveAfterFailure(): Boolean {
        if (state.value.loaded) return flushAndSave(lock = true, resumeAfter = false)
        if (!state.value.initialized || key == null) return true
        return saves.flush(snapshot()).saved
    }
    fun webFailed() {
        mutableState.value = state.value.copy(loaded = false)
        error("本地编辑器不可用；已捕获的内容保留。请重试或更新 System WebView。")
    }
    private fun error(label: String) { mutableState.value = state.value.copy(failed = true, label = label) }
    override fun onCleared() { saves.close(); super.onCleared() }
}
