package io.github.xilele777.snotes.app

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.lifecycle.ViewModelProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dagger.hilt.android.EntryPointAccessors
import io.github.xilele777.snotes.core.data.*
import io.github.xilele777.snotes.core.database.NoteEntity
import io.github.xilele777.snotes.feature.editor.LocalEditorViewModel
import io.github.xilele777.snotes.feature.notes.NotesViewModel
import java.util.UUID
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LocalNotesTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private lateinit var model: LocalEditorViewModel
    private val repository get() = EntryPointAccessors.fromApplication(compose.activity.application, TestRepositoryAccess::class.java).repository()
    @Before fun resetFilter() {
        compose.runOnIdle { ViewModelProvider(compose.activity).get("notes-${repository.profileId}", NotesViewModel::class.java).filter.value = NoteFilter() }
    }
    private fun create() {
        compose.onNodeWithText("新建", useUnmergedTree = true).performClick()
        compose.runOnIdle { model = ViewModelProvider(compose.activity)[LocalEditorViewModel::class.java] }
        compose.waitUntil(20_000) { model.state.value.loaded }
    }
    private fun script(code: String): String {
        val results = ArrayBlockingQueue<String>(1)
        instrumentation.runOnMainSync { model.webView!!.evaluateJavascript(code) { results.offer(it) } }
        return checkNotNull(results.poll(5, TimeUnit.SECONDS))
    }
    private fun input(value: String) = script("(() => {const input=document.querySelector('#source');input.value=${Json.encodeToString(value)};input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));return true;})()")
    private fun back() { compose.onNodeWithText("返回").performClick(); compose.waitUntil(10_000) { model.webView == null } }
    private fun titleReady(title: String) { compose.waitUntil(10_000) { compose.onAllNodesWithText(title).fetchSemanticsNodes().isNotEmpty() } }

    @Test fun offlineCreateEditGroupStarSearchTrashAndRestore() {
        val group = "离线分组-${UUID.randomUUID().toString().take(6)}"
        compose.onNodeWithText("分组", substring = false).performClick()
        compose.onNodeWithText("新建分组").performClick()
        compose.onNodeWithText("分组名称").performTextInput(group)
        compose.onNodeWithText("创建分组").performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText("分组名称").fetchSemanticsNodes().isEmpty() }
        create()
        val title = "离线写作-${UUID.randomUUID().toString().take(6)}"
        val markdown = "# $title\n\n\n中文搜索验收与最后一个字🙂\n\n"
        input(markdown); val id = model.state.value.noteId; back(); titleReady(title)
        assertEquals(markdown, repository.export(id)); assertNotNull(repository.note(id)!!.groupId)
        compose.onNodeWithContentDescription("笔记操作：$title").performClick()
        compose.onNodeWithText("添加星标").performClick(); titleReady("★ $title")
        compose.onNodeWithText("搜索", substring = false).performClick()
        compose.onNodeWithText("搜索本机笔记").performTextInput("中文搜索验收")
        titleReady("★ $title")
        compose.onNodeWithContentDescription("笔记操作：$title").performClick()
        compose.onNodeWithText("移到回收站").performClick()
        compose.onNodeWithText("移到回收站", substring = false).performClick()
        compose.onAllNodesWithText("回收站", substring = false).onLast().performClick(); titleReady("★ $title")
        compose.onNodeWithContentDescription("笔记操作：$title").performClick()
        compose.onNodeWithText("恢复笔记").performClick()
        compose.onNodeWithText("首页", substring = false).performClick(); titleReady("★ $title")
        assertEquals(0, repository.note(id)!!.invalid); assertEquals(1, repository.note(id)!!.star)
        assertEquals(markdown, repository.body(id))
        assertNotNull(repository.database.notes().task("note", id, "recover")); assertNull(repository.database.notes().task("note", id, "trash"))
    }
    @Test fun capturedLocalInputSurvivesRecreationAndNavigationFlush() {
        create(); val id = model.state.value.noteId
        val value = "# 本机重建恢复\n\n最后一次输入🙂\n\n"
        input(value); compose.activityRule.scenario.recreate()
        compose.waitUntil(20_000) { model.state.value.loaded && model.webView != null }
        assertEquals(value, Json.decodeFromString<String>(script("document.querySelector('#source').value")))
        back(); assertEquals(value, repository.body(id))
    }
    @Test fun emptyLocalNoteDoesNotSaveMerelyFromOpeningAndPreviewing() {
        create(); val id = model.state.value.noteId
        assertEquals("", Json.decodeFromString<String>(script("document.querySelector('#source').value")))
        script("document.querySelector('[data-mode=preview]').click()")
        compose.waitUntil(5_000) { model.state.value.mode == "preview" }
        back(); assertEquals("", repository.body(id))
        assertNull(repository.database.notes().task("note", id, "body")); assertTrue(repository.database.notes().history(id).isEmpty())
    }
    @Test fun missingBodyShowsUnavailableAndDoesNotCreateEmptyBody() {
        val id = UUID.randomUUID().toString(); val title = "尚未下载-${id.take(6)}"
        val now = System.currentTimeMillis()
        repository.database.notes().putNote(NoteEntity(id, title = title, createTime = now, updateTime = now, dirty = "clean"))
        titleReady(title); compose.onNodeWithText(title).performClick()
        compose.runOnIdle { model = ViewModelProvider(compose.activity)[LocalEditorViewModel::class.java] }
        compose.waitUntil(10_000) { model.state.value.failed }
        compose.onNodeWithText("正文尚未下载，连接服务端后才能编辑").assertIsDisplayed()
        assertNull(model.webView); compose.onNodeWithText("返回").performClick()
        assertNull(repository.body(id))
    }
}
