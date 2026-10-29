package de.wikifordummys.app.core.storage

import de.wikifordummys.app.testing.EncryptedStores
import de.wikifordummys.app.testing.InMemoryKeyValueStore
import de.wikifordummys.app.testing.softwareKey
import java.io.IOException
import java.util.Base64
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EncryptedValueStoreTest {

    private val secret = "wfd_geheimes-token-123"

    @Test
    fun `round trip without plaintext on disk`() = runTest {
        val stores = EncryptedStores()
        stores.values.put("session", secret)

        assertEquals(secret, stores.values.get("session"))
        val raw = stores.raw.values.getValue("session")
        assertFalse(raw.contains("wfd_"))
        assertFalse(String(Base64.getDecoder().decode(raw), Charsets.ISO_8859_1).contains("wfd_"))
    }

    @Test
    fun `same value encrypts differently each time`() = runTest {
        val stores = EncryptedStores()
        stores.values.put("a", secret)
        val first = stores.raw.values.getValue("a")
        stores.values.put("a", secret)
        assertNotEquals(first, stores.raw.values.getValue("a"))
    }

    @Test
    fun `ciphertext copied to another entry is not accepted`() = runTest {
        val stores = EncryptedStores()
        stores.values.put("pending_login", secret)
        stores.raw.values["session"] = stores.raw.values.getValue("pending_login")

        assertNull(stores.values.get("session"))
        assertFalse(stores.raw.values.containsKey("session"))
    }

    @Test
    fun `tampered or foreign-key data is dropped`() = runTest {
        val raw = InMemoryKeyValueStore()
        val stores = EncryptedStores(raw)
        stores.values.put("session", secret)
        val bytes = Base64.getDecoder().decode(raw.values.getValue("session"))
        bytes[bytes.size - 1] = (bytes[bytes.size - 1].toInt() xor 1).toByte()
        raw.values["session"] = Base64.getEncoder().encodeToString(bytes)
        assertNull(stores.values.get("session"))

        stores.values.put("session", secret)
        // Schlüssel verloren (z. B. Keystore zurückgesetzt): nicht lesbar, Eintrag weg
        assertNull(EncryptedStores(raw, softwareKey()).values.get("session"))
        assertTrue(raw.values.isEmpty())
    }

    @Test(expected = IOException::class)
    fun `write failures surface as IOException`() = runTest {
        val stores = EncryptedStores()
        stores.raw.failWrites = true
        stores.values.put("session", secret)
    }
}
