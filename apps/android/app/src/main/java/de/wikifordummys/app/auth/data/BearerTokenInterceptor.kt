package de.wikifordummys.app.auth.data

import de.wikifordummys.app.core.net.hasSameOriginAs
import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.Response

/**
 * Setzt `Authorization: Bearer` nur für Anfragen an das Wiki, zu dem die gespeicherte Sitzung gehört (gleiches
 * Schema, gleicher Host, gleicher Port). An jede andere Adresse geht kein Token, auch kein vom Aufrufer gesetztes.
 */
class BearerTokenInterceptor(private val tokens: TokenProvider) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request().newBuilder().removeHeader(AUTHORIZATION).build()
        // Läuft auf einem OkHttp-Thread; die Sitzung liegt in der Regel schon im Speicher.
        val session = runBlocking { tokens.currentSession() }
        if (session == null || !request.url.hasSameOriginAs(session.baseUrl)) return chain.proceed(request)
        return chain.proceed(request.newBuilder().header(AUTHORIZATION, "Bearer ${session.accessToken}").build())
    }

    companion object {
        const val AUTHORIZATION = "Authorization"
    }
}
