package io.github.xilele777.snotes.app

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.xilele777.snotes.BuildConfig
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LaunchTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun nativeActivityStartsWithHiltAndRootPackageVersion() {
        compose.onNodeWithContentDescription("打开侧栏").assertIsDisplayed()
        compose.openWorkspace("设置")
        compose.onNodeWithText("关于").performClick()
        compose.onNodeWithTag("settings-list").performScrollToNode(hasText("版本 ${BuildConfig.VERSION_NAME}"))
        compose.onNodeWithText("版本 ${BuildConfig.VERSION_NAME}").assertIsDisplayed()
    }
}
