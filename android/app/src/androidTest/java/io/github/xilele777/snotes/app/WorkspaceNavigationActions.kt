package io.github.xilele777.snotes.app

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.ComposeTestRule

fun ComposeTestRule.openWorkspace(label: String) {
    onNodeWithContentDescription("打开侧栏").performClick()
    onNodeWithTag("workspace-drawer").performScrollToNode(hasText(label, substring = false))
    onNode(hasText(label, substring = false) and hasAnyAncestor(hasTestTag("workspace-drawer"))).performClick()
    waitForIdle()
}
