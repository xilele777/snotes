package io.github.xilele777.snotes.core

import io.github.xilele777.snotes.core.model.DerivedFields
import io.github.xilele777.snotes.core.model.LocalNoteState
import io.github.xilele777.snotes.core.model.NoteMeta
import io.github.xilele777.snotes.core.model.OutboxTask
import io.github.xilele777.snotes.core.model.derive
import io.github.xilele777.snotes.core.model.escapeRawHtml
import io.github.xilele777.snotes.core.model.migrateLegacyBr
import io.github.xilele777.snotes.core.model.noteFits
import io.github.xilele777.snotes.core.model.utf8ByteLength
import io.github.xilele777.snotes.core.sync.backoffDelay
import io.github.xilele777.snotes.core.sync.isRetriableStatus
import io.github.xilele777.snotes.core.sync.mergeTask
import io.github.xilele777.snotes.core.sync.planPull
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized

@RunWith(Parameterized::class)
class SharedContractTest(private val category: String, private val name: String, private val fixture: JsonObject) {
    @Test
    fun webAndAndroidUseTheSameContract() {
        when (category) {
            "derive" -> assertEquals(json.decodeFromJsonElement(DerivedFields.serializer(), fixture.getValue("expected")), derive(fixture.text("markdown")))
            "sanitize" -> {
                val migrated = migrateLegacyBr(fixture.text("markdown"))
                assertEquals(fixture.text("legacy"), migrated)
                assertEquals(fixture.text("escaped"), escapeRawHtml(migrated))
            }
            "pull" -> {
                val remote = fixture.getValue("remote").jsonArray.map { json.decodeFromJsonElement(NoteMeta.serializer(), withDefaults("note", it)) }
                val local = fixture.getValue("local").jsonArray.map { json.decodeFromJsonElement(LocalNoteState.serializer(), withDefaults("local", it)) }
                val plan = planPull(remote, local.associateBy { it.id })
                val actual = JsonObject(mapOf(
                    "insert" to ids(plan.insert.map { it.id }),
                    "updateProp" to ids(plan.updateProp.map { it.id }),
                    "deleteLocal" to ids(plan.deleteLocal.map { it.id }),
                    "fetchBody" to ids(plan.fetchBody),
                ))
                assertEquals(fixture.getValue("expected"), actual)
            }
            "outbox" -> {
                val existing = fixture.getValue("existing").takeUnless { it == JsonNull }?.let {
                    json.decodeFromJsonElement(OutboxTask.serializer(), withDefaults("task", it))
                }
                val incoming = json.decodeFromJsonElement(OutboxTask.serializer(), withDefaults("task", fixture.getValue("incoming")))
                val actual = json.parseToJsonElement(json.encodeToString(mergeTask(existing, incoming)))
                assertEquals(fixture.getValue("expected"), actual)
            }
            "limits" -> {
                val body = fixture.text("unit").repeat(fixture.getValue("repeat").jsonPrimitive.int) + fixture.text("suffix")
                assertEquals(fixture.getValue("bytes").jsonPrimitive.long, utf8ByteLength(body))
                assertEquals(fixture.getValue("fits").jsonPrimitive.boolean, noteFits(body))
            }
            "backoff" -> assertEquals(fixture.getValue("delay").jsonPrimitive.long, backoffDelay(fixture.getValue("retry").jsonPrimitive.int))
            "status" -> assertEquals(fixture.getValue("retriable").jsonPrimitive.boolean, isRetriableStatus(fixture.getValue("status").jsonPrimitive.int))
            else -> error("Unknown contract category: $category / $name")
        }
    }

    private fun withDefaults(type: String, value: JsonElement): JsonObject = JsonObject(defaults.getValue(type).jsonObject + value.jsonObject)
    private fun JsonObject.text(key: String): String = getValue(key).jsonPrimitive.content
    private fun ids(values: List<String>) = JsonArray(values.map(::JsonPrimitive))

    companion object {
        private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = false }
        private val root = checkNotNull(SharedContractTest::class.java.getResourceAsStream("/contracts.json")) {
            "Shared fixture resources are missing"
        }.bufferedReader(Charsets.UTF_8).use { json.parseToJsonElement(it.readText()).jsonObject }
        private val defaults = root.getValue("defaults").jsonObject

        @JvmStatic
        @Parameterized.Parameters(name = "{0}: {1}")
        fun cases(): List<Array<Any>> {
            check(root.getValue("schemaVersion").jsonPrimitive.int == 1)
            return listOf("derive", "sanitize", "pull", "outbox", "limits", "backoff", "status").flatMap { category ->
                root.getValue(category).jsonArray.mapIndexed { index, item ->
                    val fixture = item.jsonObject
                    arrayOf(category, fixture["name"]?.jsonPrimitive?.content ?: index.toString(), fixture)
                }
            }
        }
    }
}
