package de.wikifordummys.app.core.storage

import de.wikifordummys.app.core.security.TokenCipher
import java.io.IOException
import java.security.GeneralSecurityException
import java.security.ProviderException
import java.util.Base64
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Legt Werte nur verschlüsselt in einem [KeyValueStore] ab. Der Name des Eintrags geht als zusätzliche Daten in
 * AES-GCM ein: Ein Geheimtext lässt sich nicht unbemerkt in einen anderen Eintrag kopieren. Lässt sich ein Eintrag
 * nicht entschlüsseln (Schlüssel weg, Datei verändert), wird er gelöscht und gilt als nicht vorhanden.
 */
class EncryptedValueStore(
    private val raw: KeyValueStore,
    private val cipher: TokenCipher,
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
) {
    suspend fun get(key: String): String? = withContext(ioDispatcher) {
        val stored = raw.get(key) ?: return@withContext null
        try {
            val plain = cipher.decrypt(Base64.getDecoder().decode(stored), associatedData(key))
            String(plain, Charsets.UTF_8)
        } catch (e: GeneralSecurityException) {
            raw.remove(key)
            null
        } catch (e: ProviderException) {
            raw.remove(key)
            null
        } catch (e: IllegalArgumentException) {
            raw.remove(key)
            null
        }
    }

    /** @throws IOException wenn Verschlüsseln oder Schreiben scheitert. */
    suspend fun put(key: String, value: String) = withContext(ioDispatcher) {
        val sealed = try {
            cipher.encrypt(value.toByteArray(Charsets.UTF_8), associatedData(key))
        } catch (e: GeneralSecurityException) {
            throw IOException("Verschlüsseln fehlgeschlagen", e)
        } catch (e: ProviderException) {
            throw IOException("Verschlüsseln fehlgeschlagen", e)
        }
        raw.put(key, Base64.getEncoder().encodeToString(sealed))
    }

    suspend fun remove(key: String) = withContext(ioDispatcher) { raw.remove(key) }

    private fun associatedData(key: String) = "wikifordummys:$key".toByteArray(Charsets.UTF_8)
}
