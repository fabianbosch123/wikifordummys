package de.wikifordummys.app.server.model

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** Ergebnis der Prüfung einer eingegebenen Wiki-Adresse. */
sealed interface UrlValidation {
    /** [baseUrl] ist die normalisierte Adresse ohne abschließenden Schrägstrich, z. B. `https://wiki.example.de`. */
    data class Valid(val baseUrl: String) : UrlValidation

    data class Invalid(val error: UrlError) : UrlValidation
}

enum class UrlError {
    Empty,
    TooLong,
    Malformed,
    NotHttps,
    Credentials,
    HasPath,
}

/**
 * Prüft die Basis-Adresse eines Wikis. Erlaubt sind nur `https`-Adressen aus Host und optional Port, ohne
 * Zugangsdaten, Pfad, Parameter und Anker (das Wiki läuft hinter Caddy immer im Wurzelverzeichnis der Domain).
 * Fehlt das Schema, wird `https://` angenommen.
 */
object WikiUrlValidator {
    const val MAX_LENGTH = 2000

    private val schemePrefix = Regex("^[A-Za-z][A-Za-z0-9+.-]*://")

    fun validate(input: String): UrlValidation {
        val trimmed = input.trim()
        if (trimmed.isEmpty()) return UrlValidation.Invalid(UrlError.Empty)
        if (trimmed.length > MAX_LENGTH) return UrlValidation.Invalid(UrlError.TooLong)
        if (trimmed.any { it.isWhitespace() || it.isISOControl() }) {
            return UrlValidation.Invalid(UrlError.Malformed)
        }

        val withScheme = if (schemePrefix.containsMatchIn(trimmed)) trimmed else "https://$trimmed"
        val scheme = withScheme.substringBefore("://").lowercase()
        if (scheme != "https") return UrlValidation.Invalid(UrlError.NotHttps)

        val url = withScheme.toHttpUrlOrNull() ?: return UrlValidation.Invalid(UrlError.Malformed)
        if (!url.isHttps || url.host.isEmpty()) return UrlValidation.Invalid(UrlError.Malformed)
        if (url.username.isNotEmpty() || url.password.isNotEmpty()) {
            return UrlValidation.Invalid(UrlError.Credentials)
        }
        if (url.encodedPath != "/" || url.query != null || url.fragment != null) {
            return UrlValidation.Invalid(UrlError.HasPath)
        }

        // HttpUrl normalisiert Groß-/Kleinschreibung, IDN (Punycode) und lässt den Standardport 443 weg.
        return UrlValidation.Valid(url.toString().removeSuffix("/"))
    }
}
