package io.github.xilele777.snotes.core.editor

import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.*
import org.junit.Test

class EditorProtocolTest {
    private val key = SessionKey("editor-prototype", "sample-a", "session-a")
    private fun message(revision: Long = 1, markdown: String = "中文\n最后一字") = EditorProtocol.nativeMessage("change", key, mapOf(
        "revision" to JsonPrimitive(revision), "markdown" to JsonPrimitive(markdown), "composing" to JsonPrimitive(false),
    ))
    @Test fun rejectsUntrustedOriginsSubframesVersionsAndMalformedData() {
        val data = message()
        assertNull(EditorProtocol.decode(data, false, true))
        assertNull(EditorProtocol.decode(data, true, false))
        assertNull(EditorProtocol.decode(data.replace("\"bridgeVersion\":1", "\"bridgeVersion\":2"), true, true))
        assertNull(EditorProtocol.decode("{", true, true))
        assertNull(EditorProtocol.decode("[]", true, true))
    }
    @Test fun preservesStructuredMarkdownWithoutExecutingIt() {
        val markdown = "`\"; window.pwned = 1; //`\n中文\n<br />\n"
        assertEquals(EditorMessage.Change(key, 1, markdown, false), EditorProtocol.decode(message(markdown = markdown), true, true))
    }
    @Test fun rejectsInvalidRevisionAndOversizedBody() {
        assertNull(EditorProtocol.decode(message(-1), true, true))
        assertNull(EditorProtocol.decode(message(Int.MAX_VALUE.toLong() + 1), true, true))
        assertNull(EditorProtocol.decode(message(markdown = "a".repeat(MAX_EDITOR_CHARS + 1)), true, true))
        assertNull(EditorProtocol.decode(message().replace("\"revision\":1", "\"revision\":\"1\""), true, true))
    }
}
