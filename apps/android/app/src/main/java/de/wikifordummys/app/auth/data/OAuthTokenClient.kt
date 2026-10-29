package de.wikifordummys.app.auth.data

import de.wikifordummys.app.auth.model.AppOAuth
import de.wikifordummys.app.auth.model.TokenSet
import de.wikifordummys.app.core.net.HttpClients.ensureSizeLimit
import de.wikifordummys.app.core.net.ResponseSizeLimit
import de.wikifordummys.app.core.net.ResponseTooLargeException
import de.wikifordummys.app.core.net.executeOn
import java.io.IOException
import javax.net.ssl.SSLException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response

/** Ergebnis am Token-Endpunkt. */
sealed interface TokenResult {
    data class Success(val tokens: TokenSet) : TokenResult

    /** Antwort im Format von RFC 6749 (`{error, error_description}`); [error] ist der Fehlercode, z. B. `invalid_grant`. */
    data class OAuthError(val error: String) : TokenResult

    data object RateLimited : TokenResult

    data class Http(val code: Int) : TokenResult

    data object Network : TokenResult

    data object Tls : TokenResult

    /** Weiterleitung, zu groß, kein JSON oder Tokens in unerwarteter Form. */
    data object InvalidResponse : TokenResult
}

@Serializable
private data class TokenResponseDto(
    @SerialName("access_token") val accessToken: String,
    @SerialName("token_type") val tokenType: String,
    @SerialName("expires_in") val expiresIn: Long,
    @SerialName("refresh_token") val refreshToken: String,
)

@Serializable
private data class OAuthErrorDto(val error: String)

/**
 * Spricht mit `POST /api/v1/oauth/token` und `POST /api/v1/oauth/revoke` (apps/api/src/oauth/oauth.controller.ts):
 * Formular (`application/x-www-form-urlencoded`), öffentlicher Client ohne Geheimnis, `resource=<wiki>/api/v1`.
 *
 * Folgt keinen Weiterleitungen (Code, Verifier und Refresh-Token gehen nur an das Wiki selbst). Jede Antwort, auch
 * eine Fehlerantwort, liest der gemeinsame [de.wikifordummys.app.core.net.ResponseSizeLimitInterceptor] höchstens bis
 * [MAX_RESPONSE_BYTES] (Grenze als Tag an der Anfrage). Der Client hat keinen Bearer-Interceptor und keinen
 * Authenticator. Nichts hiervon wird geloggt.
 */
class OAuthTokenClient(
    baseClient: OkHttpClient,
    private val json: Json = Json { ignoreUnknownKeys = true },
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
) {
    private val client: OkHttpClient = baseClient.newBuilder()
        .followRedirects(false)
        .followSslRedirects(false)
        .ensureSizeLimit()
        .build()

    suspend fun exchangeCode(baseUrl: String, code: String, codeVerifier: String): TokenResult =
        requestTokens(
            baseUrl,
            FormBody.Builder()
                .add("grant_type", "authorization_code")
                .add("code", code)
                .add("redirect_uri", AppOAuth.REDIRECT_URI)
                .add("client_id", AppOAuth.CLIENT_ID)
                .add("code_verifier", codeVerifier)
                .add("resource", AppOAuth.resource(baseUrl))
                .build(),
        )

    /** Das Refresh-Token wird dabei ausgetauscht; das alte gilt danach nicht mehr. */
    suspend fun refresh(baseUrl: String, refreshToken: String): TokenResult =
        requestTokens(
            baseUrl,
            FormBody.Builder()
                .add("grant_type", "refresh_token")
                .add("refresh_token", refreshToken)
                .add("client_id", AppOAuth.CLIENT_ID)
                .add("resource", AppOAuth.resource(baseUrl))
                .build(),
        )

    /** RFC 7009. Widerruft am Server die ganze Zustimmung. `true`, wenn der Server bestätigt hat. */
    suspend fun revoke(baseUrl: String, refreshToken: String): Boolean {
        val request = post(
            AppOAuth.revocationEndpoint(baseUrl),
            FormBody.Builder()
                .add("token", refreshToken)
                .add("token_type_hint", "refresh_token")
                .add("client_id", AppOAuth.CLIENT_ID)
                .build(),
        ) ?: return false
        return try {
            client.newCall(request).executeOn(ioDispatcher) { it.isSuccessful }
        } catch (e: IOException) {
            false
        }
    }

    private suspend fun requestTokens(baseUrl: String, form: FormBody): TokenResult {
        val request = post(AppOAuth.tokenEndpoint(baseUrl), form) ?: return TokenResult.InvalidResponse
        return try {
            client.newCall(request).executeOn(ioDispatcher, ::parse)
        } catch (e: ResponseTooLargeException) {
            TokenResult.InvalidResponse
        } catch (e: SSLException) {
            TokenResult.Tls
        } catch (e: IOException) {
            TokenResult.Network
        }
    }

    private fun post(url: String, form: FormBody): Request? = try {
        Request.Builder()
            .url(url)
            .header("Accept", "application/json")
            .tag(ResponseSizeLimit::class.java, ResponseSizeLimit(MAX_RESPONSE_BYTES))
            .post(form)
            .build()
    } catch (e: IllegalArgumentException) {
        null
    }

    private fun parse(response: Response): TokenResult {
        val code = response.code
        return when {
            code == 200 -> parseTokens(response.body.string())
            code == 400 || code == 401 -> parseError(response.body.string())
            code == 429 -> TokenResult.RateLimited
            code in 300..399 -> TokenResult.InvalidResponse
            else -> TokenResult.Http(code)
        }
    }

    private fun parseTokens(text: String): TokenResult {
        val dto = try {
            json.decodeFromString<TokenResponseDto>(text)
        } catch (e: SerializationException) {
            return TokenResult.InvalidResponse
        } catch (e: IllegalArgumentException) {
            return TokenResult.InvalidResponse
        }
        // Tokens landen in einem HTTP-Header: nur die erwartete Form annehmen.
        if (!dto.tokenType.equals("Bearer", ignoreCase = true) ||
            !ACCESS_TOKEN.matches(dto.accessToken) ||
            !REFRESH_TOKEN.matches(dto.refreshToken) ||
            dto.expiresIn <= 0
        ) {
            return TokenResult.InvalidResponse
        }
        return TokenResult.Success(TokenSet(dto.accessToken, dto.refreshToken, dto.expiresIn))
    }

    private fun parseError(text: String): TokenResult {
        val error = try {
            json.decodeFromString<OAuthErrorDto>(text).error
        } catch (e: SerializationException) {
            return TokenResult.InvalidResponse
        } catch (e: IllegalArgumentException) {
            return TokenResult.InvalidResponse
        }
        return if (ERROR_CODE.matches(error)) TokenResult.OAuthError(error) else TokenResult.InvalidResponse
    }

    companion object {
        const val MAX_RESPONSE_BYTES = 16L * 1024

        /** apps/api: TOKEN_PREFIX + 32 Zufallsbytes base64url; etwas Spielraum für spätere Längen. */
        private val ACCESS_TOKEN = Regex("^wfd_[A-Za-z0-9_-]{32,256}$")
        private val REFRESH_TOKEN = Regex("^wfr_[A-Za-z0-9_-]{32,256}$")
        private val ERROR_CODE = Regex("^[a-z_]{1,64}$")
    }
}
