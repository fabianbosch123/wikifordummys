package de.wikifordummys.app.auth.model

import kotlinx.serialization.Serializable

/**
 * Angemeldete Sitzung: Tokens gehören immer zu genau einem Wiki ([baseUrl]). Wird nur verschlüsselt gespeichert.
 * `toString` verrät die Tokens nicht, falls ein Objekt doch einmal in einem Log landet.
 */
@Serializable
data class StoredSession(
    val baseUrl: String,
    val accessToken: String,
    val refreshToken: String,
) {
    override fun toString(): String = "StoredSession(baseUrl=$baseUrl, tokens=***)"
}

/** Was die Oberfläche von der Sitzung wissen darf: nur das Wiki, keine Tokens. */
data class SessionInfo(val baseUrl: String)

/** Laufende Anmeldung zwischen Browser und Rücksprung; gilt für genau einen Rücksprung mit passendem `state`. */
@Serializable
data class PendingLogin(
    val baseUrl: String,
    val state: String,
    val codeVerifier: String,
    val createdAtMillis: Long,
) {
    override fun toString(): String = "PendingLogin(baseUrl=$baseUrl, createdAtMillis=$createdAtMillis, secrets=***)"
}

/** Tokens aus einer erfolgreichen Antwort des Token-Endpunkts. */
data class TokenSet(val accessToken: String, val refreshToken: String, val expiresInSeconds: Long) {
    override fun toString(): String = "TokenSet(expiresInSeconds=$expiresInSeconds, tokens=***)"
}

/** Ergebnis eines Rücksprungs aus dem Browser. */
sealed interface LoginResult {
    data object Success : LoginResult

    /** Kein laufender Login (nie gestartet, schon verbraucht oder abgelaufen): Rücksprung verworfen. */
    data object NoPendingLogin : LoginResult

    /** Rücksprung gehört nicht zu dieser Anmeldung (falsches oder fehlendes `state`, unlesbar): verworfen. */
    data object Rejected : LoginResult

    /** `iss` fehlt oder ist nicht das Wiki, bei dem die Anmeldung begann (Mix-up-Schutz, RFC 9207). */
    data object IssuerMismatch : LoginResult

    /** Benutzer hat abgelehnt (`error=access_denied`). */
    data object AccessDenied : LoginResult

    /** Anderer `error` im Rücksprung oder kein `code`. */
    data object AuthorizationFailed : LoginResult

    /** Code ungültig, abgelaufen, schon benutzt oder PKCE passt nicht. */
    data object InvalidGrant : LoginResult

    data object RateLimited : LoginResult

    data object Network : LoginResult

    data object Tls : LoginResult

    data class Http(val code: Int) : LoginResult

    data object InvalidResponse : LoginResult

    /** Tokens oder laufender Login ließen sich nicht (verschlüsselt) speichern. */
    data object StorageFailed : LoginResult
}
