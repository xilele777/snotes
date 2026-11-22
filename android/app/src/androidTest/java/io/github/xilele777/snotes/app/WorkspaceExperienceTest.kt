package io.github.xilele777.snotes.app

import android.graphics.Bitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.lifecycle.ViewModelProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dagger.hilt.android.EntryPointAccessors
import io.github.xilele777.snotes.feature.editor.LocalEditorViewModel
import java.io.File
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class WorkspaceExperienceTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    private fun screenshot(name: String) {
        compose.waitForIdle()
        val image = compose.onRoot().captureToImage().asAndroidBitmap()
        val output = InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")
        val directory = if (output.isNullOrBlank()) File(compose.activity.getExternalFilesDir(null), "workspace-screenshots") else File(output, "workspace-screenshots")
        check(directory.mkdirs() || directory.isDirectory)
        File(directory, "$name.png").outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
        image.recycle()
    }

    @Test fun searchSurvivesRecreationAndUtilityPagesReturnToWorkspace() {
        val repository = EntryPointAccessors.fromApplication(compose.activity.application, TestRepositoryAccess::class.java).repository()
        val note = repository.create("# 周末的慢生活\n\n读一本书，散一会儿步。为生活留出一点空白。")
        repository.updateProps(note.id, buildJsonObject { put("star", 1); put("top", 1) })
        val imageOnlyNote = repository.create("![图片](/api/images/${java.util.UUID.randomUUID()}/sample.jpg)")
        assertEquals("", imageOnlyNote.title)
        assertNotNull(imageOnlyNote.thumbnail)

        compose.waitUntil(10_000) { compose.onAllNodesWithText("周末的慢生活").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("图片笔记").assertIsDisplayed()
        screenshot("notes")

        compose.onNodeWithContentDescription("打开侧栏").performClick()
        screenshot("drawer")
        compose.runOnIdle { compose.activity.onBackPressedDispatcher.onBackPressed() }

        compose.onNodeWithText("搜索本机笔记").performTextInput("旋转后保留的查询")
        compose.activityRule.scenario.recreate()
        compose.onNodeWithText("旋转后保留的查询", substring = false).assertExists()
        screenshot("search")

        compose.openWorkspace("设置")
        compose.onNodeWithText("外观", substring = false).assertIsDisplayed()
        compose.onNodeWithTag("settings-list").performScrollToNode(hasText("主题", substring = false))
        compose.onNodeWithText("深色", substring = false).performClick()
        screenshot("settings-dark")
        compose.onNodeWithText("浅色", substring = false).performClick()
        compose.onNodeWithText("跟随系统", substring = false).performClick()
        compose.onNodeWithText("数据", substring = false).performClick()
        compose.onNodeWithText("连接与同步").assertExists()
        screenshot("settings-data")
        compose.runOnIdle { compose.activity.onBackPressedDispatcher.onBackPressed() }
        compose.onNodeWithText("旋转后保留的查询", substring = false).assertExists()

        compose.openWorkspace("统计")
        compose.onNodeWithText("累计打开", substring = false).assertExists()
        screenshot("stats")
        compose.onNodeWithContentDescription("打开侧栏").performClick()
        compose.runOnIdle { compose.activity.onBackPressedDispatcher.onBackPressed() }
        compose.onNodeWithText("累计打开", substring = false).assertExists()
        compose.runOnIdle { compose.activity.onBackPressedDispatcher.onBackPressed() }
        compose.onNodeWithText("旋转后保留的查询", substring = false).assertExists()

        repository.setTrash(imageOnlyNote.id, true)
        compose.openWorkspace("回收站")
        compose.waitUntil(10_000) { compose.onAllNodesWithText("图片笔记").fetchSemanticsNodes().isNotEmpty() }
        screenshot("trash")
        compose.onNodeWithText("彻底删除").performClick()
        compose.onAllNodesWithText("彻底删除", substring = false).onLast().performClick()
        compose.waitUntil(10_000) { repository.note(imageOnlyNote.id) == null }

        compose.runOnIdle { compose.activity.onBackPressedDispatcher.onBackPressed() }
        compose.onNodeWithText("旋转后保留的查询", substring = false).assertExists()
    }

    @Test fun bookCreationAndChapterNoteReturnToSameDirectory() {
        compose.openWorkspace("笔记本")
        screenshot("books")
        compose.onNodeWithContentDescription("新建笔记本").assertIsDisplayed().performClick()
        val title = "跨端验收-${java.util.UUID.randomUUID().toString().take(6)}"
        compose.onNodeWithText("名称", substring = false).performTextInput(title)
        compose.onNodeWithText("保存", substring = false).performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText(title).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText(title).performClick()
        compose.onNodeWithText("添加章节").performClick()
        compose.onNodeWithText("章节名称").performTextInput("第一章")
        compose.onNodeWithText("添加", substring = false).performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithContentDescription("目录操作：第一章").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithContentDescription("目录操作：第一章").performClick()
        compose.onNodeWithText("在此新建笔记").performClick()
        lateinit var editor: LocalEditorViewModel
        compose.runOnIdle { editor = ViewModelProvider(compose.activity)[LocalEditorViewModel::class.java] }
        compose.waitUntil(20_000) { editor.state.value.loaded }
        screenshot("editor")
        compose.onNodeWithContentDescription("返回").performClick()
        compose.waitUntil(10_000) { editor.webView == null }
        compose.onAllNodesWithText(title).onFirst().assertExists()
        compose.onNodeWithText("第一章").assertExists()
        compose.onNodeWithText("无标题").assertExists()
        screenshot("book-directory")
    }

    @Test fun rotatingToWideWindowPreservesQueryAndShowsPersistentSidebar() {
        compose.onNodeWithText("搜索本机笔记").performTextInput("窗口变化后的查询")
        try {
            compose.runOnIdle { compose.activity.requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE }
            compose.waitUntil(15_000) { compose.onAllNodesWithContentDescription("打开侧栏").fetchSemanticsNodes().isEmpty() }
            compose.onNodeWithTag("workspace-drawer").assertIsDisplayed()
            compose.onNodeWithText("窗口变化后的查询", substring = false).assertExists()
            screenshot("wide-workspace")
            compose.runOnIdle { compose.activity.requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT }
            compose.waitUntil(15_000) { compose.onAllNodesWithContentDescription("打开侧栏").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("窗口变化后的查询", substring = false).assertExists()
        } finally {
            compose.runOnIdle { compose.activity.requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED }
        }
    }
}
