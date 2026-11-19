package io.github.xilele777.snotes.core.network

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import io.github.xilele777.snotes.core.database.LocalProfile
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString

/** Deliberately not a data class: toString must never include the token. */
class Connection(val origin: String, val token: String) { override fun toString() = "Connection(credentials=redacted)" }
@Serializable private data class StoredConnection(val origin: String, val token: String)

@Singleton
class ConnectionStore(private val fixedProfileId: String, private val fixedDirectory: File) {
    @Inject constructor(profile: LocalProfile) : this(profile.paths.id, profile.paths.directory) { liveProfile = profile }
    private var liveProfile: LocalProfile? = null
    private val profileId get() = liveProfile?.paths?.id ?: fixedProfileId
    private val directory get() = liveProfile?.paths?.directory ?: fixedDirectory
    private val file get() = AtomicFile(File(directory, "connection.enc"))
    private val alias get() = "snotes-token-$profileId"
    private fun key(create: Boolean): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        check(create) { "credential_key_unavailable" }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    @Synchronized fun read(): Connection? {
        if (!file.baseFile.exists() && !File(directory, "connection.enc.bak").exists()) return null
        try {
            val bytes = file.openRead().use { it.readBytes() }
            require(bytes.size in 30..65_536 && bytes[0] == 1.toByte())
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(false), GCMParameterSpec(128, bytes.copyOfRange(1, 13)))
            cipher.updateAAD(profileId.toByteArray(Charsets.UTF_8))
            val value = syncJson.decodeFromString<StoredConnection>(cipher.doFinal(bytes.copyOfRange(13, bytes.size)).toString(Charsets.UTF_8))
            return Connection(value.origin, value.token)
        } catch (_: Exception) { throw IllegalStateException("连接密钥不可用，请重新输入令牌；本机内容已保留") }
    }
    @Synchronized fun write(value: Connection) {
        check(directory.isDirectory || directory.mkdirs()) { "无法创建连接存储目录" }
        require(value.token.isNotEmpty() && value.token.length <= 8192 && value.token.none { it <= ' ' }) { "令牌格式无效" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key(true)); cipher.updateAAD(profileId.toByteArray(Charsets.UTF_8))
        val encrypted = cipher.doFinal(syncJson.encodeToString(StoredConnection(value.origin, value.token)).toByteArray(Charsets.UTF_8))
        val stream = file.startWrite()
        try { stream.write(byteArrayOf(1) + cipher.iv + encrypted); file.finishWrite(stream) }
        catch (failure: Exception) { file.failWrite(stream); throw failure }
    }
}
