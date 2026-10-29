package de.wikifordummys.app.core.api

import de.wikifordummys.app.core.net.ResponseTooLargeException
import java.io.IOException
import javax.net.ssl.SSLException
import kotlinx.serialization.SerializationException
import okhttp3.ResponseBody
import retrofit2.Response

/** Ergebnis eines Aufrufs der REST-API (Fehlerformat `{"error":{"code","message"}}`, apps/api/src/common/errors.ts). */
sealed interface ApiResult<out T> {
    data class Success<T>(val value: T) : ApiResult<T>

    /** 401 auch nach einer Erneuerung: neu anmelden. */
    data object Unauthorized : ApiResult<Nothing>

    /** 403: Für die App nicht freigegeben oder keine Berechtigung. */
    data object Forbidden : ApiResult<Nothing>

    data object NotFound : ApiResult<Nothing>

    data object RateLimited : ApiResult<Nothing>

    data class ServerError(val code: Int) : ApiResult<Nothing>

    data class HttpError(val code: Int) : ApiResult<Nothing>

    data object Network : ApiResult<Nothing>

    data object Tls : ApiResult<Nothing>

    /** Weiterleitung, zu große oder unlesbare Antwort. */
    data object InvalidResponse : ApiResult<Nothing>
}

/** Führt einen Retrofit-Aufruf aus und ordnet Statuscodes und Fehler zu. Liest den Body nur bei Erfolg. */
suspend fun <T> apiCall(call: suspend () -> Response<ResponseBody>, decode: (String) -> T): ApiResult<T> {
    val response = try {
        call()
    } catch (e: ResponseTooLargeException) {
        return ApiResult.InvalidResponse
    } catch (e: SSLException) {
        return ApiResult.Tls
    } catch (e: IOException) {
        return ApiResult.Network
    }
    response.errorBody()?.close()
    val code = response.code()
    return when {
        response.isSuccessful -> {
            val body = response.body() ?: return ApiResult.InvalidResponse
            try {
                ApiResult.Success(decode(body.use { it.string() }))
            } catch (e: ResponseTooLargeException) {
                ApiResult.InvalidResponse
            } catch (e: SSLException) {
                ApiResult.Tls
            } catch (e: IOException) {
                ApiResult.Network
            } catch (e: SerializationException) {
                ApiResult.InvalidResponse
            } catch (e: IllegalArgumentException) {
                ApiResult.InvalidResponse
            }
        }
        code == 401 -> ApiResult.Unauthorized
        code == 403 -> ApiResult.Forbidden
        code == 404 -> ApiResult.NotFound
        code == 429 -> ApiResult.RateLimited
        code in 500..599 -> ApiResult.ServerError(code)
        code in 300..399 -> ApiResult.InvalidResponse
        else -> ApiResult.HttpError(code)
    }
}
