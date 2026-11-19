package io.github.xilele777.snotes.core

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.xilele777.snotes.core.network.Connection
import io.github.xilele777.snotes.core.network.ConnectionStore
import java.io.File
import java.security.KeyStore
import java.util.UUID
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ConnectionStoreTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private lateinit var directory: File
    private lateinit var profile: String
    @Before fun setup() { profile = "token-test-${UUID.randomUUID()}"; directory = File(context.cacheDir, profile); check(directory.mkdirs()) }
    @After fun cleanup() {
        KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry("snotes-token-$profile") }
        check(directory.canonicalPath.startsWith(context.cacheDir.canonicalPath + File.separator)); directory.deleteRecursively()
    }
    @Test fun tokenIsEncryptedAndBoundToProfileAndCanBeRotated() {
        val store = ConnectionStore(profile, directory)
        assertNull(store.read()); store.write(Connection("https://notes.example/", "owner-token-secret"))
        assertFalse(File(directory, "connection.enc").readBytes().toString(Charsets.ISO_8859_1).contains("owner-token-secret"))
        assertEquals("owner-token-secret", ConnectionStore(profile, directory).read()!!.token)
        store.write(Connection("https://notes.example/", "rotated-token")); assertEquals("rotated-token", store.read()!!.token)
        assertThrows(IllegalStateException::class.java) { ConnectionStore("another-profile", directory).read() }
        assertTrue(File(directory, "connection.enc").exists())
    }
    @Test fun lostKeyRetainsCiphertextAndRequiresTokenRepair() {
        val store = ConnectionStore(profile, directory)
        store.write(Connection("https://notes.example/", "owner-token-secret"))
        KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry("snotes-token-$profile") }
        val error = assertThrows(IllegalStateException::class.java) { store.read() }
        assertFalse(error.toString().contains("owner-token-secret")); assertTrue(File(directory, "connection.enc").exists())
        store.write(Connection("https://notes.example/", "repaired-token")); assertEquals("repaired-token", store.read()!!.token)
    }
}
