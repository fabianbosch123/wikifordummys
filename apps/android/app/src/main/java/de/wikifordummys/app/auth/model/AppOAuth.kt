package de.wikifordummys.app.auth.model

import okhttp3.HttpUrl.Companion.toHttpUrl

/**
 * Fester öffentlicher OAuth-Client der App. Muss mit `APP_OAUTH_CLIENT_ID` und `APP_OAUTH_REDIRECT_URI` in
 * packages/shared/src/index.ts übereinstimmen; das Schema steht außerdem im Manifest (OAuthCallbackActivity).
 */
object AppOAuth {
    const val CLIENT_ID = "7f1c2b9e-4d3a-4e8f-9b6a-a9d0c1e2f3a4"
    const val REDIRECT_URI = "de.wikifordummys.app:/oauth/callback"

    /** Zustimmungsseite der Weboberfläche (apps/web/src/app/oauth/authorize). */
    fun authorizeEndpoint(baseUrl: String) = "$baseUrl/oauth/authorize"

    fun tokenEndpoint(baseUrl: String) = "$baseUrl/api/v1/oauth/token"

    fun revocationEndpoint(baseUrl: String) = "$baseUrl/api/v1/oauth/revoke"

    /** Ressource (RFC 8707), für die die App Tokens bekommt: die REST-API (OAuthService.appResource). */
    fun resource(baseUrl: String) = "$baseUrl/api/v1"

    /** Adresse für den Browser: Autorisierungsanfrage mit PKCE S256. */
    fun authorizationUrl(baseUrl: String, codeChallenge: String, state: String): String =
        authorizeEndpoint(baseUrl).toHttpUrl().newBuilder()
            .addQueryParameter("response_type", "code")
            .addQueryParameter("client_id", CLIENT_ID)
            .addQueryParameter("redirect_uri", REDIRECT_URI)
            .addQueryParameter("code_challenge", codeChallenge)
            .addQueryParameter("code_challenge_method", "S256")
            .addQueryParameter("state", state)
            .addQueryParameter("resource", resource(baseUrl))
            .build()
            .toString()
}
