package de.wikifordummys.app.auth.data

import de.wikifordummys.app.auth.model.PendingLogin
import de.wikifordummys.app.auth.model.StoredSession
import de.wikifordummys.app.core.storage.EncryptedValueStore
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json

/** Speicher für die angemeldete Sitzung (Access- und Refresh-Token). */
interface SessionStore {
    suspend fun load(): StoredSession?

    suspend fun save(session: StoredSession)

    suspend fun clear()
}

/** Speicher für die laufende Anmeldung (PKCE-Verifier und `state`), damit sie einen Prozesstod überlebt. */
interface PendingLoginStore {
    suspend fun load(): PendingLogin?

    suspend fun save(pending: PendingLogin)

    suspend fun clear()
}

private val StoreJson = Json { ignoreUnknownKeys = true }

/** Beide Speicher legen JSON nur verschlüsselt ab (AES-GCM, Schlüssel aus dem Android Keystore). */
class EncryptedSessionStore(private val values: EncryptedValueStore) : SessionStore {
    override suspend fun load(): StoredSession? = values.get(KEY)?.let { decodeOrNull<StoredSession>(it) }

    override suspend fun save(session: StoredSession) = values.put(KEY, StoreJson.encodeToString(session))

    override suspend fun clear() = values.remove(KEY)

    private companion object {
        const val KEY = "session"
    }
}

class EncryptedPendingLoginStore(private val values: EncryptedValueStore) : PendingLoginStore {
    override suspend fun load(): PendingLogin? = values.get(KEY)?.let { decodeOrNull<PendingLogin>(it) }

    override suspend fun save(pending: PendingLogin) = values.put(KEY, StoreJson.encodeToString(pending))

    override suspend fun clear() = values.remove(KEY)

    private companion object {
        const val KEY = "pending_login"
    }
}

private inline fun <reified T> decodeOrNull(text: String): T? = try {
    StoreJson.decodeFromString<T>(text)
} catch (e: SerializationException) {
    null
} catch (e: IllegalArgumentException) {
    null
}
