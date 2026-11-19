package io.github.xilele777.snotes.core.sync

import io.github.xilele777.snotes.BuildConfig
import io.github.xilele777.snotes.core.data.NotesRepository
import io.github.xilele777.snotes.core.network.*
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

data class SyncStatus(val running: Boolean = false, val connected: Boolean = false, val message: String = "尚未连接服务端")

@Singleton
class SyncCoordinator @Inject constructor(repository: NotesRepository, private val connections: ConnectionStore) {
    private val store = SyncStore(repository)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val roundLock = Mutex()
    private val monitor = Any()
    private var active: Deferred<Unit>? = null
    @Volatile private var stopRequested = false
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
    suspend fun synchronize() {
        val job = synchronized(monitor) {
            active?.takeIf { !it.isCompleted } ?: run {
                stopRequested = false
                scope.async {
                roundLock.withLock {
                    try {
                        val connection = connections.read() ?: return@withLock
                        check(store.meta("instance_origin") == connection.origin) { "实例配置不匹配，请重新接入；本机数据已保留" }
                        mutableStatus.value = SyncStatus(true, true, "正在同步…")
                        val client = client(connection)
                        try { SyncEngine(store, client) { stopRequested }.run() } finally { client.close() }
                        val failed = store.transaction { store.dao.tasks().count { it.failed != 0 } }
                        mutableStatus.value = SyncStatus(false, true, if (failed == 0) "本轮同步完成" else "$failed 项同步失败，可重试、另存或导出")
                    } catch (_: CancellationException) {
                        mutableStatus.value = mutableStatus.value.copy(running = false, message = "同步已停止，本机内容已保留")
                    } catch (error: Exception) {
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
    /** Stops new dispatch and waits for bounded in-flight requests and their persistence to settle. */
    suspend fun stopAndJoin() {
        stopRequested = true
        synchronized(monitor) { active }?.join()
    }
    suspend fun connect(originText: String, token: String) = withContext(Dispatchers.IO) {
        stopAndJoin()
        roundLock.withLock {
            val origin = instanceOrigin(originText, BuildConfig.DEBUG).toString()
            require(token.isNotEmpty() && token.length <= 8192 && token.none { it <= ' ' }) { "令牌格式无效" }
            val bound = store.meta("instance_origin")
            require(bound == null || bound == origin) { "更换实例需要独立 profile，目前仅支持首次接入或修复当前令牌" }
            val connection = Connection(origin, token)
            val client = client(connection)
            try {
                client.call(true) { instance() }
                client.call(true) { checkpoint(CheckpointRequest(0, null)) }
                client.call(true) { booksCheckpoint(CheckpointRequest(0, null)) }
                connections.write(connection)
                store.transaction { store.put("instance_origin", origin); store.dao.deleteMeta("requires_auth") }
                mutableStatus.value = SyncStatus(connected = true, message = "连接已验证，可开始同步")
            } finally { client.close() }
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
