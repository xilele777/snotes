package io.github.xilele777.snotes.core.sync

import io.github.xilele777.snotes.BuildConfig
import io.github.xilele777.snotes.core.data.NotesRepository
import io.github.xilele777.snotes.core.data.SharedImages
import io.github.xilele777.snotes.core.network.*
import io.github.xilele777.snotes.core.database.LocalProfile
import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*

data class SyncStatus(val running: Boolean = false, val connected: Boolean = false, val message: String = "尚未连接服务端")
enum class BackgroundResult { SUCCESS, RETRY }

@Singleton
class SyncCoordinator @Inject constructor(private val repository: NotesRepository, private val connections: ConnectionStore,
    private val profile: LocalProfile, @ApplicationContext private val context: Context) {
    private val sharedImages = SharedImages(repository, profile)
    private val store = SyncStore(repository)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val roundLock = Mutex()
    private val monitor = Any()
    private var active: Deferred<Unit>? = null
    @Volatile private var stopRequested = false
    @Volatile private var switching = false
    private var lastError: ApiError? = null
    private val mutableStatus = MutableStateFlow(SyncStatus())
    val status = mutableStatus.asStateFlow()
    suspend fun refreshConnection() = withContext(Dispatchers.IO) {
        roundLock.withLock {
            try {
                val value = connections.read()
                mutableStatus.value = SyncStatus(connected = value != null, message = when {
                    value == null -> "尚未连接服务端"
                    store.meta("requires_auth") == "1" -> "令牌失效，请修复连接；本机内容已保留"
                    else -> "已连接，可手动同步"
                })
            } catch (_: Exception) { mutableStatus.value = SyncStatus(message = "连接密钥不可用，请修复连接；本机内容已保留") }
        }
    }

    /** Caller cancellation never releases the round lock while another request still owns an ACK. */
    suspend fun synchronize(expectedProfile: String = repository.profileId) {
        val job = synchronized(monitor) {
            if (switching || expectedProfile != repository.profileId) return
            active?.takeIf { !it.isCompleted } ?: run {
                stopRequested = false
                scope.async {
                roundLock.withLock {
                    if (switching || expectedProfile != repository.profileId) return@withLock
                    lastError = null
                    try {
                        val connection = connections.read() ?: return@withLock
                        check(store.meta("instance_origin") == connection.origin) { "实例配置不匹配，请重新接入；本机数据已保留" }
                        mutableStatus.value = SyncStatus(true, true, "正在同步…")
                        val client = client(connection)
                        try {
                            SyncEngine(store, client) { stopRequested }.run()
                            if (!stopRequested) sharedImages.drain(client, checkNotNull(store.meta("accepted_epoch")))
                            if (!stopRequested) try { io.github.xilele777.snotes.core.data.Opens(repository).sync(client, checkNotNull(store.meta("accepted_epoch"))) }
                            catch (error: ApiError) { if (error.status == 401) { store.transaction { store.put("requires_auth", "1") }; throw error }; store.transaction { store.put("opens_error", error.message.orEmpty()) } }
                        } finally { client.close() }
                        val failed = store.transaction { store.dao.tasks().count { it.failed != 0 } }
                        mutableStatus.value = SyncStatus(false, true, if (failed == 0) "本轮同步完成" else "$failed 项同步失败，可重试、另存或导出")
                    } catch (_: CancellationException) {
                        mutableStatus.value = mutableStatus.value.copy(running = false, message = "同步已停止，本机内容已保留")
                    } catch (error: Exception) {
                        if (error is ApiError && error.code == "sync_reset_required") store.markRecovery()
                        if (error is ApiError && error.status == 401) store.transaction { store.put("requires_auth", "1") }
                        lastError = error as? ApiError ?: ApiError(0, "local_error")
                        mutableStatus.value = mutableStatus.value.copy(running = false, message = when (error) {
                            is ApiError -> error.message ?: "同步失败，本机内容已保留"
                            else -> "同步或连接存储失败，本机内容已保留"
                        })
                    }
                }
                }
            }.also { active = it }
        }
        job.await()
    }
    suspend fun background(id: String): BackgroundResult {
        if (id != repository.profileId || switching) return BackgroundResult.SUCCESS
        synchronize(id)
        return withContext(Dispatchers.IO) { roundLock.withLock {
            if (id != repository.profileId || switching || runCatching { connections.read() }.getOrNull() == null || store.meta("requires_auth") == "1") BackgroundResult.SUCCESS
            else if (lastError?.let { it.status == 0 || it.status == 429 || it.status >= 500 } == true ||
                store.dao.tasks().any { it.failed == 0 } || store.dao.metas("shared:").any { entry ->
                    val value = syncJson.parseToJsonElement(entry.value).jsonObject
                    val id = value.getValue("note_id").jsonPrimitive.content
                    value["failed"]?.jsonPrimitive?.booleanOrNull != true && repository.note(id)?.invalid == 0 && !repository.editorActive(id)
                }) BackgroundResult.RETRY else BackgroundResult.SUCCESS
        } }
    }
    /** Stops new dispatch and waits for bounded in-flight requests and their persistence to settle. */
    suspend fun stopAndJoin() {
        stopRequested = true
        synchronized(monitor) { active }?.join()
    }
    suspend fun connect(originText: String, token: String) = withContext(Dispatchers.IO) {
        synchronized(monitor) { switching = true }
        try {
          stopAndJoin()
          roundLock.withLock {
            val origin = instanceOrigin(originText, BuildConfig.DEBUG).toString()
            require(token.isNotEmpty() && token.length <= 8192 && token.none { it <= ' ' }) { "令牌格式无效" }
            val bound = store.meta("instance_origin")
            val connection = Connection(origin, token)
            val client = ApiClient(instanceOrigin(origin, BuildConfig.DEBUG), token)
            try {
                client.call(true) { instance() }
                client.call(true) { checkpoint(CheckpointRequest(0, null)) }
                client.call(true) { booksCheckpoint(CheckpointRequest(0, null)) }
                if (bound != null && bound != origin) {
                    SyncWork.cancel(context, repository.profileId).result.get()
                    repository.switchProfile(profile.newId())
                }
                connections.write(connection)
                store.transaction { store.put("instance_origin", origin); store.dao.deleteMeta("requires_auth") }
                mutableStatus.value = SyncStatus(connected = true, message = "连接已验证，可开始同步")
            } finally { client.close() }
          }
          SyncWork.periodic(context, repository.profileId)
          SyncWork.enqueue(context, repository.profileId)
        } finally { synchronized(monitor) { switching = false } }
    }
    suspend fun switchProfile(id: String) = withContext(Dispatchers.IO) {
        synchronized(monitor) { switching = true }
        try {
            stopAndJoin()
            roundLock.withLock {
                SyncWork.cancel(context, repository.profileId).result.get()
                require(id in profile.candidates())
                repository.switchProfile(id)
                mutableStatus.value = SyncStatus(message = "已切换本机实例")
            }
            SyncWork.periodic(context, id)
        } finally { synchronized(monitor) { switching = false } }
        refreshConnection()
    }
    fun profiles() = profile.candidates()
    suspend fun origin(): String? = withContext(Dispatchers.IO) { store.meta("instance_origin") }
    suspend fun <T> withCurrentClient(id: String, block: suspend (ApiClient, String) -> T): T = withContext(Dispatchers.IO) {
        roundLock.withLock {
            check(!switching && id == repository.profileId) { "实例已切换，请重试" }
            check(store.meta("requires_auth") != "1") { "请先修复令牌" }
            val connection = checkNotNull(connections.read()) { "请先连接服务端" }
            val epoch = checkNotNull(store.meta("accepted_epoch")) { "请先完成同步对账" }
            check(store.meta("reconcile_notes") == null && store.meta("reconcile_books") == null)
            val client = client(connection)
            try { block(client, epoch) } finally { client.close() }
        }
    }
    suspend fun retry(includeFailed: Boolean = true) {
        stopAndJoin()
        withContext(Dispatchers.IO) { roundLock.withLock { store.retry(includeFailed) } }
        synchronize()
    }
    private fun client(connection: Connection) = ApiClient(instanceOrigin(connection.origin, BuildConfig.DEBUG), connection.token,
        readPause = { store.number("rate_limit_until") }, persistPause = { until -> store.transaction { store.put("rate_limit_until", maxOf(store.number("rate_limit_until"), until).toString()) } })
}
