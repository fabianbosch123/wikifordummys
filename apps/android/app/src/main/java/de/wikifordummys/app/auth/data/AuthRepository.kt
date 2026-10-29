package de.wikifordummys.app.auth.data

import de.wikifordummys.app.auth.model.AppOAuth
import de.wikifordummys.app.auth.model.LoginResult
import de.wikifordummys.app.auth.model.OAuthCallback
import de.wikifordummys.app.auth.model.PendingLogin
import de.wikifordummys.app.auth.model.PkceGenerator
import de.wikifordummys.app.auth.model.SessionInfo
import de.wikifordummys.app.auth.model.StoredSession
import de.wikifordummys.app.auth.model.constantTimeEquals
import java.io.IOException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/** Anmeldung, Sitzung und Abmeldung, wie sie die Oberfläche sieht. */
interface AuthRepository {
    /** Aktuelle Sitzung oder `null`; ändert sich bei Anmeldung, Abmeldung und abgelaufener Zustimmung. */
    val session: Flow<SessionInfo?>

    /**
     * Startet eine Anmeldung: neuer Verifier und `state`, verschlüsselt gespeichert (ersetzt eine frühere laufende
     * Anmeldung). Ergebnis ist die Adresse für den Browser.
     * @throws IOException wenn nichts gespeichert werden konnte.
     */
    suspend fun beginLogin(baseUrl: String): String

    /**
     * Prüft einen Rücksprung aus dem Browser und tauscht den Code gegen Tokens. Die laufende Anmeldung muss zu
     * [baseUrl] gehören (dem Wiki, für das der Anmeldebildschirm gerade offen ist).
     */
    suspend fun completeLogin(baseUrl: String, rawCallback: String): LoginResult

    /** Widerruft die Zustimmung am Server und löscht die Tokens lokal, auch wenn der Widerruf scheitert. */
    suspend fun logout()
}

/** Für den Netzwerk-Stack: Tokens lesen und nach einer Antwort 401 erneuern. */
interface TokenProvider {
    suspend fun currentSession(): StoredSession?

    /**
     * Wird nach 401 für eine Anfrage mit [usedAccessToken] aufgerufen. Liefert das Access-Token für den einen
     * Wiederholungsversuch oder `null` (nicht angemeldet, Erneuerung gescheitert).
     */
    suspend fun refreshAfterUnauthorized(usedAccessToken: String): String?
}

/**
 * OAuth 2.1 mit PKCE gegen das eigene Wiki (apps/api/src/oauth). Hält die Sitzung zusätzlich im Speicher, damit nicht
 * jede Anfrage entschlüsseln muss. Erneuerung und Abmeldung laufen unter einem gemeinsamen [Mutex]: Parallele 401
 * lösen genau eine Erneuerung aus, und ein Refresh-Token wird nie zweimal vorgelegt (das beendet am Server die ganze
 * Zustimmung).
 */
class OAuthAuthRepository(
    private val tokenClient: OAuthTokenClient,
    private val sessionStore: SessionStore,
    private val pendingStore: PendingLoginStore,
    private val pkce: PkceGenerator = PkceGenerator(),
    private val clock: () -> Long = System::currentTimeMillis,
) : AuthRepository, TokenProvider {

    private sealed interface Cache {
        data object Unloaded : Cache
        data class Loaded(val session: StoredSession?) : Cache
    }

    private val cache = MutableStateFlow<Cache>(Cache.Unloaded)
    private val loadMutex = Mutex()
    private val tokenMutex = Mutex()
    private val loginMutex = Mutex()

    override val session: Flow<SessionInfo?> = flow {
        loadedSession()
        emitAll(cache.filterIsInstance<Cache.Loaded>().map { loaded -> loaded.session?.let { SessionInfo(it.baseUrl) } })
    }.distinctUntilChanged()

    override suspend fun currentSession(): StoredSession? = loadedSession()

    private suspend fun loadedSession(): StoredSession? {
        (cache.value as? Cache.Loaded)?.let { return it.session }
        return loadMutex.withLock {
            (cache.value as? Cache.Loaded)?.let { return@withLock it.session }
            val stored = try {
                sessionStore.load()
            } catch (e: IOException) {
                null
            }
            cache.value = Cache.Loaded(stored)
            stored
        }
    }

    override suspend fun beginLogin(baseUrl: String): String {
        val pending = PendingLogin(
            baseUrl = baseUrl,
            state = pkce.newState(),
            codeVerifier = pkce.newCodeVerifier(),
            createdAtMillis = clock(),
        )
        loginMutex.withLock { pendingStore.save(pending) }
        return AppOAuth.authorizationUrl(baseUrl, PkceGenerator.codeChallenge(pending.codeVerifier), pending.state)
    }

    override suspend fun completeLogin(baseUrl: String, rawCallback: String): LoginResult = loginMutex.withLock {
        val pending = try {
            pendingStore.load()
        } catch (e: IOException) {
            null
        } ?: return@withLock LoginResult.NoPendingLogin

        // Abgelaufen oder für ein anderes Wiki begonnen (Adresse inzwischen geändert): verwerfen.
        val age = clock() - pending.createdAtMillis
        if (age !in 0..PENDING_LOGIN_TTL_MILLIS || pending.baseUrl != baseUrl) {
            clearPending()
            return@withLock LoginResult.NoPendingLogin
        }

        // Ohne passendes state gehört der Rücksprung nicht zu dieser Anmeldung; sie bleibt dann bestehen.
        val callback = OAuthCallback.parse(rawCallback) ?: return@withLock LoginResult.Rejected
        val state = callback.state ?: return@withLock LoginResult.Rejected
        if (!constantTimeEquals(state, pending.state)) return@withLock LoginResult.Rejected

        // Ab hier ist der Versuch verbraucht: Verifier und state gelten nur für diesen einen Rücksprung.
        clearPending()

        if (callback.issuer == null || callback.issuer != pending.baseUrl) return@withLock LoginResult.IssuerMismatch
        if (callback.error != null) {
            return@withLock if (callback.error == "access_denied") LoginResult.AccessDenied else LoginResult.AuthorizationFailed
        }
        val code = callback.code ?: return@withLock LoginResult.AuthorizationFailed

        when (val result = tokenClient.exchangeCode(pending.baseUrl, code, pending.codeVerifier)) {
            is TokenResult.Success -> {
                val session = StoredSession(pending.baseUrl, result.tokens.accessToken, result.tokens.refreshToken)
                tokenMutex.withLock {
                    try {
                        sessionStore.save(session)
                    } catch (e: IOException) {
                        return@withLock LoginResult.StorageFailed
                    }
                    cache.value = Cache.Loaded(session)
                    LoginResult.Success
                }
            }
            is TokenResult.OAuthError ->
                if (result.error == "invalid_grant") LoginResult.InvalidGrant else LoginResult.AuthorizationFailed
            TokenResult.RateLimited -> LoginResult.RateLimited
            TokenResult.Network -> LoginResult.Network
            TokenResult.Tls -> LoginResult.Tls
            is TokenResult.Http -> LoginResult.Http(result.code)
            TokenResult.InvalidResponse -> LoginResult.InvalidResponse
        }
    }

    override suspend fun refreshAfterUnauthorized(usedAccessToken: String): String? = tokenMutex.withLock {
        val current = loadedSession() ?: return@withLock null
        // Eine parallele Anfrage hat schon erneuert: deren Token verwenden, nicht noch einmal erneuern.
        if (current.accessToken != usedAccessToken) return@withLock current.accessToken

        when (val result = tokenClient.refresh(current.baseUrl, current.refreshToken)) {
            is TokenResult.Success -> {
                val next = current.copy(
                    accessToken = result.tokens.accessToken,
                    refreshToken = result.tokens.refreshToken,
                )
                // Erst den Speicher, dann gilt das neue Paar. Scheitert das Schreiben, gilt es trotzdem für diesen
                // Prozess; nach einem Neustart führt das alte Refresh-Token dann zur neuen Anmeldung.
                try {
                    sessionStore.save(next)
                } catch (e: IOException) {
                    // bewusst ohne Log: keine Tokens, keine Details
                }
                cache.value = Cache.Loaded(next)
                next.accessToken
            }
            is TokenResult.OAuthError -> {
                if (result.error in TERMINAL_REFRESH_ERRORS) clearSession()
                null
            }
            // Netz, Ratenbegrenzung, Serverfehler: Tokens behalten, später erneut versuchen.
            else -> null
        }
    }

    override suspend fun logout() {
        tokenMutex.withLock {
            try {
                loadedSession()?.let { tokenClient.revoke(it.baseUrl, it.refreshToken) }
            } finally {
                withContext(NonCancellable) {
                    clearSession()
                    clearPending()
                }
            }
        }
    }

    /** Muss unter [tokenMutex] laufen. */
    private suspend fun clearSession() {
        cache.value = Cache.Loaded(null)
        try {
            sessionStore.clear()
        } catch (e: IOException) {
            // Im Speicher ist die Sitzung schon weg; beim nächsten Start würde der Server das Token ablehnen.
        }
    }

    private suspend fun clearPending() {
        try {
            pendingStore.clear()
        } catch (e: IOException) {
            // nichts weiter zu tun
        }
    }

    companion object {
        /** Zeit für Anmeldung im Wiki, 2FA und Zustimmung im Browser. */
        const val PENDING_LOGIN_TTL_MILLIS = 30L * 60 * 1000

        /** Erneuerung ist endgültig gescheitert: Tokens löschen, neu anmelden. */
        private val TERMINAL_REFRESH_ERRORS = setOf("invalid_grant", "invalid_client", "unauthorized_client")
    }
}
