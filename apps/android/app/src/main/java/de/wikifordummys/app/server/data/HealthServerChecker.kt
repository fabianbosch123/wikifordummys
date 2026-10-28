package de.wikifordummys.app.server.data

import de.wikifordummys.app.server.model.ServerCheckResult
import de.wikifordummys.app.server.model.ServerChecker
import java.io.IOException
import javax.net.ssl.SSLException
import kotlinx.serialization.SerializationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.http.GET
import retrofit2.http.Streaming

/** Antwort von `GET /api/v1/health` (apps/api/src/health/health.controller.ts). */
@Serializable
data class HealthResponse(
    val status: String,
    val checks: Map<String, String> = emptyMap(),
)

interface WikiHealthApi {
    /** Ungepuffert, damit der Body nur begrenzt gelesen wird. */
    @Streaming
    @GET("api/v1/health")
    suspend fun health(): Response<ResponseBody>
}

internal val WikiJson = Json { ignoreUnknownKeys = true }

/**
 * Ruft den öffentlichen Health-Endpunkt des Wikis auf, um eine eingegebene Adresse zu prüfen. Es werden keine
 * Zugangsdaten gesendet. Weiterleitungen folgt der Client nicht: Die Adresse soll direkt auf das Wiki zeigen, und eine
 * Weiterleitung auf eine fremde Domain oder auf HTTP wird so gar nicht erst aufgerufen. Die Antwort wird höchstens bis
 * [MAX_BODY_BYTES] gelesen; was größer ist, ist nicht die Health-Antwort des Wikis.
 */
class HealthServerChecker(
    baseClient: OkHttpClient,
    private val json: Json = WikiJson,
) : ServerChecker {

    private val client: OkHttpClient = baseClient.newBuilder()
        .followRedirects(false)
        .followSslRedirects(false)
        .build()

    override suspend fun check(baseUrl: String): ServerCheckResult {
        val api = try {
            Retrofit.Builder()
                .baseUrl(baseUrl.trimEnd('/') + "/")
                .client(client)
                .build()
                .create(WikiHealthApi::class.java)
        } catch (e: IllegalArgumentException) {
            return ServerCheckResult.NotAWiki
        }

        return try {
            val response = api.health()
            val code = response.code()
            when {
                response.isSuccessful -> response.body()?.use(::parseHealth) ?: ServerCheckResult.NotAWiki
                code == 503 -> ServerCheckResult.Unhealthy
                code == 429 -> ServerCheckResult.RateLimited
                code == 404 || code in 300..399 -> ServerCheckResult.NotAWiki
                else -> ServerCheckResult.HttpError(code)
            }.also { response.errorBody()?.close() }
        } catch (e: SSLException) {
            ServerCheckResult.TlsError
        } catch (e: IOException) {
            ServerCheckResult.Unreachable
        }
    }

    private fun parseHealth(body: ResponseBody): ServerCheckResult {
        if (body.contentLength() > MAX_BODY_BYTES) return ServerCheckResult.NotAWiki
        val source = body.source()
        // request() liest höchstens bis zur Grenze + 1 Byte in den Puffer, nie den ganzen Body.
        if (source.request(MAX_BODY_BYTES + 1)) return ServerCheckResult.NotAWiki
        val text = source.buffer.readUtf8()
        val health = try {
            json.decodeFromString<HealthResponse>(text)
        } catch (e: SerializationException) {
            return ServerCheckResult.NotAWiki
        } catch (e: IllegalArgumentException) {
            return ServerCheckResult.NotAWiki
        }
        return if (health.status == "ok") ServerCheckResult.Ok else ServerCheckResult.NotAWiki
    }

    companion object {
        const val MAX_BODY_BYTES = 16L * 1024
    }
}
