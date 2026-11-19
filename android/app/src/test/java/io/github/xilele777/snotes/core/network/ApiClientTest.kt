package io.github.xilele777.snotes.core.network

import java.util.concurrent.TimeUnit
import kotlinx.coroutines.*
import okhttp3.mockwebserver.*
import org.junit.*
import org.junit.Assert.*

class ApiClientTest {
    private lateinit var server: MockWebServer
    private lateinit var client: ApiClient
    @Before fun setup() { server = MockWebServer(); server.start(); client = ApiClient(server.url("/"), "secret-token", timeoutMillis = 500) }
    @After fun cleanup() { client.close(); server.shutdown() }
    private fun json(body: String, code: Int = 200) = MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)
    private suspend fun failure(block: suspend () -> Any?): ApiError = try { block(); error("expected failure") } catch (error: ApiError) { error }

    @Test fun onlyOriginWithoutCredentialsPathOrQueryCanBeConfigured() {
        assertEquals("https://notes.example/", instanceOrigin("https://notes.example").toString())
        assertEquals("http://10.0.2.2:8787/", instanceOrigin("http://10.0.2.2:8787", true).toString())
        listOf("http://notes.example", "https://user:pass@notes.example", "https://notes.example/api", "https://notes.example?token=secret", "https://notes.example#secret", "file:///tmp", "http://127.0.0.2").forEach {
            assertThrows(IllegalArgumentException::class.java) { instanceOrigin(it, true) }
        }
        assertThrows(IllegalArgumentException::class.java) { instanceOrigin("http://localhost", false) }
    }
    @Test fun authenticatedInstanceIgnoresExtensionsAndUsesBearer() = runBlocking {
        server.enqueue(json("""{"epoch":"epoch-1","extra":"future"}"""))
        assertEquals("epoch-1", client.call(true) { instance() }.epoch)
        val request = server.takeRequest()
        assertEquals("Bearer secret-token", request.getHeader("Authorization")); assertEquals("/api/sync/instance", request.path)
        assertNull(request.getHeader("X-Snotes-Epoch"))
    }
    @Test fun redirectsNeverLeakBearerToAnotherOrigin() = runBlocking {
        val other = MockWebServer(); other.start()
        try {
            server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", other.url("/steal")))
            assertEquals(302, failure { client.call(true) { instance() } }.status)
            assertNull(other.takeRequest(100, TimeUnit.MILLISECONDS))
        } finally { other.shutdown() }
    }
    @Test fun errorTextAndExceptionsNeverExposeCredentialsOrRemoteContent() = runBlocking {
        server.enqueue(json("""{"error":"secret-token content from note"}""", 401))
        val error = failure { client.call(true) { instance() } }
        assertEquals(401, error.status); assertFalse(error.toString().contains("secret-token")); assertFalse(error.toString().contains("from note"))
        assertFalse(Connection("https://example.com", "secret-token").toString().contains("secret-token"))
    }
    @Test fun missingMandatoryEndpointIsExplicitlyUnsupported() = runBlocking {
        server.enqueue(json("""{"error":"not_found"}""", 404))
        assertEquals("unsupported_server", failure { client.call(true) { instance() } }.code)
    }
    @Test fun resetRequiredCodeSurvivesErrorMapping() = runBlocking {
        server.enqueue(json("""{"error":"sync_reset_required"}""", 409))
        assertEquals("sync_reset_required", failure { client.call { checkpoint(CheckpointRequest(10, "old")) } }.code)
    }
    @Test fun unsafeOrQuotedNumbersAndMissingOrNullContentAreRejected() = runBlocking {
        listOf("""{"bodies":[{"note_id":"a","content":"","version":9007199254740992}]}""",
            """{"bodies":[{"note_id":"a","content":"","version":"1"}]}""",
            """{"bodies":[{"note_id":"a","content":null,"version":1}]}""",
            """{"bodies":[{"note_id":"a","version":1}]}""").forEach {
            server.enqueue(json(it)); assertEquals("invalid_response", failure { client.call { bodies(BodiesRequest(listOf("a"))) } }.code)
        }
    }
    @Test fun emptyMarkdownIsValid() = runBlocking {
        server.enqueue(json("""{"bodies":[{"note_id":"a","content":"","version":0}]}"""))
        assertEquals("", client.call { bodies(BodiesRequest(listOf("a"))) }.bodies.single().content)
    }
    @Test fun timeoutDoesNotAutomaticallyReplayWrites() = runBlocking {
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
        assertEquals("network_error", failure { client.call { create("epoch", kotlinx.serialization.json.buildJsonObject {}) } }.code)
        assertEquals(1, server.requestCount)
    }
    @Test fun callerCancellationIsNotConvertedToNetworkFailure() = runBlocking {
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
        val request = async { client.call { instance() } }
        withContext(Dispatchers.IO) { server.takeRequest() }
        request.cancelAndJoin(); assertTrue(request.isCancelled)
    }
    @Test fun retryAfterIsPersistedAndProfileGateStopsNextRequest() = runBlocking {
        client.close(); var pause = 0L
        client = ApiClient(server.url("/"), "secret-token", clock = { 1000 }, readPause = { pause }, persistPause = { pause = it })
        server.enqueue(json("{}", 429).setHeader("Retry-After", "20"))
        assertEquals(429, failure { client.call { instance() } }.status)
        assertEquals(21_000L, pause)
        assertEquals("rate_limited", failure { client.call { instance() } }.code)
        assertEquals(1, server.requestCount)
    }
    @Test fun retryAfterSupportsHttpDateAndIgnoresInvalidValues() {
        assertEquals(2000L, retryAfter("1", 1000)); assertNull(retryAfter("-1", 1000)); assertNull(retryAfter("9223372036854775807", 1000))
        assertEquals(1_000L, retryAfter("Thu, 01 Jan 1970 00:00:01 GMT", 0))
        assertNull(retryAfter("bad", 0)); assertNull(retryAfter("Thu, 01 Jan 1970 00:00:00 GMT", 1000))
    }
    @Test fun inventoryOmitsNullCursorAndRetainsExplicitCheckpoint() = runBlocking {
        server.enqueue(json("""{"books":[],"until":0,"next_after":null,"next_id":null,"checkpoint":"receipt"}"""))
        client.call { books(BooksRequest(0, null, inventory = true)) }
        val body = server.takeRequest().body.readUtf8()
        assertFalse(body.contains("after_id")); assertFalse(body.contains("until")); assertTrue(body.contains("\"checkpoint\":null"))
    }
}
