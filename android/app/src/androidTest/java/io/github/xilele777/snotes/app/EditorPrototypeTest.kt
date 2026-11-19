package io.github.xilele777.snotes.app

import android.view.inputmethod.EditorInfo
import android.view.MotionEvent
import android.os.SystemClock
import android.view.inputmethod.InputMethodManager
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.lifecycle.ViewModelProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import io.github.xilele777.snotes.core.editor.*
import io.github.xilele777.snotes.feature.editor.EditorPrototypeViewModel
import java.io.File
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.float
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class EditorPrototypeTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private lateinit var model: EditorPrototypeViewModel

    @Before fun enterFreshPrototype() {
        val directory = File(compose.activity.filesDir, "editor-prototype")
        check(directory.canonicalFile.parentFile == compose.activity.filesDir.canonicalFile)
        directory.deleteRecursively()
        compose.onNodeWithText("打开离线编辑器原型").performClick()
        compose.runOnIdle { model = ViewModelProvider(compose.activity)[EditorPrototypeViewModel::class.java] }
        compose.waitUntil(20_000) { model.state.value.loaded }
    }
    private fun script(code: String): String {
        val result = ArrayBlockingQueue<String>(1)
        instrumentation.runOnMainSync { checkNotNull(model.webView).evaluateJavascript(code) { result.offer(it) } }
        return checkNotNull(result.poll(5, TimeUnit.SECONDS)) { "WebView JavaScript timed out" }
    }
    private fun input(value: String) {
        script("(() => { const input = document.querySelector('#source'); input.value = ${Json.encodeToString(value)}; input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' })); return true; })()")
    }
    private fun body(): String = Json.decodeFromString(script("document.querySelector('#source').value"))
    private fun switchTo(noteId: String) {
        compose.runOnIdle { model.switchNote(noteId) }
        compose.waitUntil(10_000) { model.state.value.noteId == noteId && model.state.value.loaded && !model.state.value.busy }
    }
    @Test fun nativeViewportGivesSourceTheRemainingHeight() {
        val viewport = Json.parseToJsonElement(script("(() => ({ height:innerHeight, source:document.querySelector('#source').getBoundingClientRect().height, ratio:devicePixelRatio }))()")).jsonObject
        var nativeHeight = 0
        instrumentation.runOnMainSync { nativeHeight = model.webView!!.height }
        assertEquals(nativeHeight / viewport.getValue("ratio").jsonPrimitive.float, viewport.getValue("height").jsonPrimitive.float, 3f)
        assertTrue("Source height: $viewport", viewport.getValue("source").jsonPrimitive.float > 200f)
    }
    @Test fun immediateNoteSwitchFlushesFinalChineseTextAndDoesNotShareUndo() {
        input("# 中文\n\n刚输入的最后一个字🙂")
        switchTo("sample-b")
        script("document.querySelector('[data-action=undo]').click()")
        assertEquals(PrototypeSamples.notes.getValue("sample-b"), body())
        switchTo("sample-a")
        assertEquals("# 中文\n\n刚输入的最后一个字🙂", body())
        val saved = PrototypeStore(File(compose.activity.filesDir, "editor-prototype")).open()
        assertEquals(body(), saved.getValue("sample-a").markdown)
    }
    @Test fun acknowledgedRevisionSurvivesActivityRecreation() {
        val value = "# 旋转恢复\n\n中文、emoji🙂和空行\n\n"
        input(value)
        compose.waitUntil(10_000) { model.state.value.revision > 0 && model.state.value.committedRevision == model.state.value.revision }
        compose.activityRule.scenario.recreate()
        compose.waitUntil(20_000) { model.state.value.loaded && model.webView != null }
        assertEquals(value, body())
        assertEquals(value, PrototypeStore(File(compose.activity.filesDir, "editor-prototype")).open().getValue("sample-a").markdown)
    }
    @Test fun capturedInputSurvivesImmediateActivityRecreation() {
        val value = "# 尚未确认的输入\n\n旋转前的最后一个字"
        input(value)
        compose.activityRule.scenario.recreate()
        compose.waitUntil(20_000) { model.state.value.loaded && model.webView != null }
        assertEquals(value, body())
        assertEquals(value, PrototypeStore(File(compose.activity.filesDir, "editor-prototype")).open().getValue("sample-a").markdown)
    }
    @Test fun previewAndIrConversionNeverWriteUneditedMarkdown() {
        val original = body()
        script("document.querySelector('[data-mode=preview]').click()")
        compose.waitUntil(10_000) { model.state.value.mode == "preview" }
        assertEquals("高亮", Json.decodeFromString<String>(script("document.querySelector('#preview mark').textContent")))
        script("document.querySelector('#preview img').scrollIntoView()")
        compose.waitUntil(5_000) { script("(() => { const image = document.querySelector('#preview img'); return image.complete && image.naturalWidth > 0; })()") == "true" }
        script("document.querySelector('[data-mode=source]').click()")
        compose.waitUntil(10_000) { model.state.value.mode == "source" }
        assertEquals(original, body())
        script("document.querySelector('[data-mode=ir]').click()")
        compose.waitUntil(10_000) { model.state.value.mode == "ir" }
        script("document.querySelector('[data-mode=source]').click()")
        compose.waitUntil(10_000) { model.state.value.mode == "source" }
        assertEquals(original, body())
        assertEquals(0, model.state.value.revision)
        assertFalse(File(compose.activity.filesDir, "editor-prototype/samples.json").exists())
    }
    @Test fun longDocumentUsesSourceAndSavesLastLine() {
        switchTo("sample-long")
        val value = body()
        assertTrue(value.length > 76_000)
        assertEquals("true", script("document.querySelector('[data-mode=ir]').disabled"))
        assertEquals("0", script("document.querySelectorAll('#rich [contenteditable]').length"))
        input(value + "\n长文最后一行")
        switchTo("sample-b")
        switchTo("sample-long")
        assertEquals(value + "\n长文最后一行", body())
    }
    @Test fun nativeInputConnectionCommitsChineseCompositionWithoutDuplication() {
        input("")
        // Returning from a previous editor or the searchable home can leave an
        // IME window active. Remove it before measuring the pointer target.
        instrumentation.runOnMainSync {
            val view = checkNotNull(model.webView)
            view.requestFocus()
            view.context.getSystemService(InputMethodManager::class.java).hideSoftInputFromWindow(view.windowToken, 0)
        }
        compose.waitUntil(5_000) { compose.activity.hasWindowFocus() && ViewCompat.getRootWindowInsets(model.webView!!)?.isVisible(WindowInsetsCompat.Type.ime()) != true }
        val point = Json.parseToJsonElement(script("(() => { const r = document.querySelector('#source').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+40}; })()")).jsonObject
        val location = IntArray(2)
        var density = 1f
        instrumentation.runOnMainSync { model.webView!!.requestFocus(); model.webView!!.getLocationOnScreen(location); density = model.webView!!.resources.displayMetrics.density }
        val x = location[0] + point.getValue("x").jsonPrimitive.float * density
        val y = location[1] + point.getValue("y").jsonPrimitive.float * density
        val time = SystemClock.uptimeMillis()
        for (action in listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP)) {
            val event = MotionEvent.obtain(time, SystemClock.uptimeMillis(), action, x, y, 0)
            instrumentation.sendPointerSync(event); event.recycle()
        }
        script("document.querySelector('#source').focus()")
        compose.waitUntil(5_000) { script("document.activeElement.id") == "\"source\"" }
        instrumentation.runOnMainSync {
            val view = checkNotNull(model.webView)
            view.context.getSystemService(InputMethodManager::class.java).hideSoftInputFromWindow(view.windowToken, 0)
        }
        compose.waitUntil(5_000) { ViewCompat.getRootWindowInsets(model.webView!!)?.isVisible(WindowInsetsCompat.Type.ime()) != true }
        // Chromium may provide its InputConnection on a dedicated handler rather
        // than the Activity main thread, just as InputMethodManager requests it.
        val inputHandler = checkNotNull(model.webView).handler
        val connectionResult = ArrayBlockingQueue<android.view.inputmethod.InputConnection>(1)
        inputHandler.post { model.webView?.onCreateInputConnection(EditorInfo())?.let { connectionResult.offer(it) } }
        val connection = checkNotNull(connectionResult.poll(5, TimeUnit.SECONDS)) { "Native input connection was not ready" }
        val connectionHandler = connection.handler ?: inputHandler
        fun sendInput(action: () -> Unit) {
            val completed = ArrayBlockingQueue<Result<Unit>>(1)
            connectionHandler.post { completed.offer(runCatching(action)) }
            checkNotNull(completed.poll(5, TimeUnit.SECONDS)).getOrThrow()
        }
        try {
            // Keep these IME edits in one batch so Gboard cannot concurrently
            // commit the test's intermediate "ni" from updateSelection callbacks.
            sendInput {
                connection.beginBatchEdit()
                try {
                    assertTrue(connection.setComposingText("ni", 1))
                    assertTrue(connection.setComposingText("你好", 1))
                    assertTrue(connection.commitText("你好", 1))
                    connection.finishComposingText()
                } finally { connection.endBatchEdit() }
            }
            compose.waitUntil(5_000) { model.state.value.markdown == "你好" }
        } catch (error: Throwable) { throw AssertionError("Native composition failed: DOM=${body()}, state=${model.state.value.markdown}", error) }
        switchTo("sample-b")
        switchTo("sample-a")
        assertEquals("你好", body())
    }
}
