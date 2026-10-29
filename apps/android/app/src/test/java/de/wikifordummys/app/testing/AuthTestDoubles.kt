package de.wikifordummys.app.testing

import de.wikifordummys.app.auth.data.EncryptedPendingLoginStore
import de.wikifordummys.app.auth.data.EncryptedSessionStore
import de.wikifordummys.app.core.security.AesGcmTokenCipher
import de.wikifordummys.app.core.storage.EncryptedValueStore
import de.wikifordummys.app.core.storage.KeyValueStore
import java.util.concurrent.ConcurrentHashMap
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import kotlinx.coroutines.Dispatchers

/** Speicher im Arbeitsspeicher; steht für die DataStore-Datei, überlebt also einen „Prozesstod“ im Test. */
class InMemoryKeyValueStore : KeyValueStore {
    val values = ConcurrentHashMap<String, String>()
    var failWrites = false

    override suspend fun get(key: String): String? = values[key]

    override suspend fun put(key: String, value: String) {
        if (failWrites) throw java.io.IOException("disk full")
        values[key] = value
    }

    override suspend fun remove(key: String) {
        values.remove(key)
    }
}

/** Software-Schlüssel statt Android Keystore. */
fun softwareKey(): SecretKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

/** Verschlüsselte Speicher wie in der App, nur mit Software-Schlüssel und Speicher im Arbeitsspeicher. */
class EncryptedStores(
    val raw: InMemoryKeyValueStore = InMemoryKeyValueStore(),
    key: SecretKey = softwareKey(),
) {
    val values = EncryptedValueStore(raw, AesGcmTokenCipher { key }, Dispatchers.Unconfined)
    val session = EncryptedSessionStore(values)
    val pending = EncryptedPendingLoginStore(values)
}
