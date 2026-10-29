package de.wikifordummys.app.home.data

import de.wikifordummys.app.core.api.ApiResult
import de.wikifordummys.app.core.api.apiCall
import de.wikifordummys.app.home.model.Me
import de.wikifordummys.app.home.model.Space
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.http.GET

/** Daten für den Startbildschirm nach der Anmeldung. */
interface HomeRepository {
    suspend fun me(): ApiResult<Me>

    suspend fun spaces(): ApiResult<List<Space>>
}

/** Lesende Routen mit `@AppTokenAllowed()` (apps/api/src/me/me.controller.ts, apps/api/src/spaces/spaces.controller.ts). */
interface WikiReadApi {
    @GET("api/v1/me")
    suspend fun me(): Response<ResponseBody>

    @GET("api/v1/spaces")
    suspend fun spaces(): Response<ResponseBody>
}

/**
 * [authenticatedClient] setzt das Token (BearerTokenInterceptor) und erneuert bei 401 (TokenAuthenticator); er folgt
 * keinen Weiterleitungen und begrenzt Antworten (ResponseSizeLimitInterceptor).
 */
class ApiHomeRepository(
    baseUrl: String,
    authenticatedClient: OkHttpClient,
    private val json: Json = Json { ignoreUnknownKeys = true },
) : HomeRepository {
    private val api: WikiReadApi = Retrofit.Builder()
        .baseUrl(baseUrl.trimEnd('/') + "/")
        .client(authenticatedClient)
        .build()
        .create(WikiReadApi::class.java)

    override suspend fun me(): ApiResult<Me> = apiCall(api::me) { json.decodeFromString<Me>(it) }

    override suspend fun spaces(): ApiResult<List<Space>> =
        apiCall(api::spaces) { json.decodeFromString<List<Space>>(it) }
}
