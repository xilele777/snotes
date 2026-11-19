package io.github.xilele777.snotes.core.network

import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

/** Contains only an allowlisted code, never response text, request URLs, credentials or Markdown. */
class ApiError(val status: Int, val code: String, val retryAt: Long? = null) : IOException(
    when {
        status == 401 -> "令牌失效，请修复连接；本机内容已保留"
        code == "sync_reset_required" -> "服务端需要重新对账，本机内容已保留"
        code == "unsupported_server" -> "服务端暂不支持此客户端"
        status == 429 -> "服务端限流，请稍后重试"
        status == 413 -> "正文超过服务端限制，请另存或导出"
        code == "invalid_response" -> "服务端响应不符合同步契约"
        code == "rate_limited" -> "正在等待服务端限流结束"
        else -> "同步失败${if (status > 0) "（HTTP $status）" else "，请检查网络"}，本机内容已保留"
    },
)

fun instanceOrigin(value: String, allowLocalHttp: Boolean = false): HttpUrl {
    val uri = java.net.URI(value.trim())
    require(uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null && (uri.rawPath.isNullOrEmpty() || uri.rawPath == "/")) { "请输入不含路径或凭证的服务端 origin" }
    val url = value.trim().toHttpUrlOrNull() ?: throw IllegalArgumentException("服务端地址无效")
    require(url.scheme == "https" || allowLocalHttp && url.scheme == "http" && url.host in setOf("localhost", "127.0.0.1", "10.0.2.2")) { "服务端必须使用 HTTPS" }
    return url.newBuilder().encodedPath("/").build()
}

fun retryAfter(value: String?, now: Long): Long? {
    val seconds = value?.trim()?.toLongOrNull()
    if (seconds != null && seconds >= 0 && seconds <= (Long.MAX_VALUE - now) / 1000) return now + seconds * 1000
    return runCatching {
        val formatter = SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss 'GMT'", Locale.US)
        formatter.timeZone = TimeZone.getTimeZone("GMT"); formatter.isLenient = false
        formatter.parse(value ?: return null)?.time?.takeIf { it >= now }
    }.getOrNull()
}

val syncJson = Json { ignoreUnknownKeys = true; explicitNulls = true; encodeDefaults = true }

/** No logging interceptor; credentials are attached only after the exact origin is checked. */
class ApiClient(origin: HttpUrl, token: String, private val clock: () -> Long = System::currentTimeMillis,
    timeoutMillis: Long = 15_000, private val readPause: () -> Long = { 0 }, private val persistPause: (Long) -> Unit = {}) {
    private val http = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
        .connectTimeout(timeoutMillis, TimeUnit.MILLISECONDS).readTimeout(timeoutMillis, TimeUnit.MILLISECONDS)
        .writeTimeout(timeoutMillis, TimeUnit.MILLISECONDS).callTimeout(timeoutMillis, TimeUnit.MILLISECONDS)
        .addInterceptor { chain ->
            val url = chain.request().url
            if (url.scheme != origin.scheme || url.host != origin.host || url.port != origin.port) throw ApiError(0, "origin_mismatch")
            if (readPause() > clock()) throw ApiError(429, "rate_limited", readPause())
            chain.proceed(chain.request().newBuilder().header("Authorization", "Bearer $token").build())
        }.addInterceptor { chain ->
            val response = chain.proceed(chain.request())
            if (response.code == 429) persistPause(retryAfter(response.header("Retry-After"), clock()) ?: clock() + 1_000)
            // Validate primitive types and safe integers before Kotlin serialization can coerce quoted numbers.
            if (response.isSuccessful && response.body?.contentType()?.subtype?.contains("json") == true) {
                val body = response.body!!
                val raw = body.string()
                try { validateWire(syncJson.parseToJsonElement(raw)) }
                catch (_: Exception) { response.close(); throw ApiError(0, "invalid_response") }
                response.newBuilder().body(raw.toResponseBody(body.contentType())).build()
            } else response
        }.build()
    val api: SyncApi = Retrofit.Builder().baseUrl(origin).client(http)
        .addConverterFactory(syncJson.asConverterFactory("application/json".toMediaType())).build().create(SyncApi::class.java)

    suspend fun <T> call(requiredEndpoint: Boolean = false, request: suspend SyncApi.() -> Response<T>): T {
        try {
            val response = api.request()
            if (!response.isSuccessful) {
                val code = response.errorBody()?.use { body ->
                    if (body.contentLength() > 65_536) null else runCatching {
                        val source = body.source(); source.request(65_537)
                        if (source.buffer.size > 65_536) null else syncJson.parseToJsonElement(source.readUtf8()).jsonObject["error"]?.jsonPrimitive?.content
                    }.getOrNull()
                }
                val allowed = code?.takeIf { it in setOf("sync_reset_required", "not_found", "permanently_deleted", "invalid_body", "too_large") } ?: "http_error"
                throw ApiError(response.code(), if (requiredEndpoint && response.code() == 404) "unsupported_server" else allowed,
                    retryAfter(response.headers()["Retry-After"], clock()))
            }
            return response.body() ?: throw ApiError(response.code(), "invalid_response")
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: ApiError) { throw failure }
        catch (_: SerializationException) { throw ApiError(0, "invalid_response") }
        catch (_: IllegalArgumentException) { throw ApiError(0, "invalid_response") }
        catch (_: IOException) { throw ApiError(0, "network_error") }
    }
    fun close() { http.dispatcher.cancelAll(); http.connectionPool.evictAll() }
}

private val integerFields = setOf("version", "prop_version", "meta_version", "toc_version", "change_seq", "update_time", "create_time", "server_time", "until", "next_after", "ord", "star", "top", "invalid", "deleted", "hide_from_home", "home_hidden", "trash_retention_days")
private val booleanFields = setOf("valid", "conflicted", "replayed")
private val nullableIntegerFields = setOf("next_after", "home_hidden", "trash_retention_days")
private fun validateWire(value: JsonElement) {
    when (value) {
        is JsonArray -> value.forEach(::validateWire)
        is JsonObject -> value.forEach { (key, child) ->
            if (key in integerFields) {
                if (!(child == JsonNull && key in nullableIntegerFields)) {
                    require(child is JsonPrimitive && !child.isString)
                    val number = child.longOrNull ?: error("integer_required")
                    require(number in -MAX_SAFE_INTEGER..MAX_SAFE_INTEGER)
                }
            }
            if (key in booleanFields) require(child is JsonPrimitive && !child.isString && child.booleanOrNull != null)
            // Maps are keyed by user IDs, so their keys are not field names.
            if (key != "note_states") validateWire(child)
        }
        else -> Unit
    }
}
