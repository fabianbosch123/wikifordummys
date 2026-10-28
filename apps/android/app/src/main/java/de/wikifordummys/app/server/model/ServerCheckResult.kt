package de.wikifordummys.app.server.model

/** Ergebnis von `GET /api/v1/health` an einer Wiki-Adresse. */
sealed interface ServerCheckResult {
    /** 200 mit `{"status":"ok", ...}`: hier läuft ein wikifordummys. */
    data object Ok : ServerCheckResult

    /** 503: Das Wiki antwortet, aber Datenbank oder Redis sind gestört. */
    data object Unhealthy : ServerCheckResult

    /** 404, Weiterleitung oder eine Antwort, die nicht wie die Health-Antwort des Wikis aussieht. */
    data object NotAWiki : ServerCheckResult

    /** 429 */
    data object RateLimited : ServerCheckResult

    /** TLS-Handshake fehlgeschlagen, meist ein Zertifikat, dem das Gerät nicht vertraut. */
    data object TlsError : ServerCheckResult

    /** Keine Verbindung (DNS, Zeitüberschreitung, kein Netz). */
    data object Unreachable : ServerCheckResult

    /** Sonstiger HTTP-Fehler. */
    data class HttpError(val code: Int) : ServerCheckResult
}

/** Prüft, ob unter einer (bereits validierten) Basis-Adresse ein wikifordummys erreichbar ist. */
fun interface ServerChecker {
    suspend fun check(baseUrl: String): ServerCheckResult
}
