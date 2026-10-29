package de.wikifordummys.app.auth.data

import de.wikifordummys.app.core.net.hasSameOriginAs
import kotlinx.coroutines.runBlocking
import okhttp3.Authenticator
import okhttp3.Request
import okhttp3.Response
import okhttp3.Route

/**
 * Antwort 401 vom Wiki: Access-Token genau einmal erneuern und die Anfrage einmal wiederholen. Kommt danach wieder 401,
 * geht die Antwort an den Aufrufer. Parallele 401 teilen sich eine Erneuerung ([TokenProvider.refreshAfterUnauthorized]).
 */
class TokenAuthenticator(private val tokens: TokenProvider) : Authenticator {
    override fun authenticate(route: Route?, response: Response): Request? {
        // Nur 401 vom Server (nicht 407 vom Proxy), und nur, wenn das nicht schon der Wiederholungsversuch war.
        if (response.code != 401 || response.priorResponse != null) return null
        val request = response.request
        val header = request.header(BearerTokenInterceptor.AUTHORIZATION) ?: return null
        if (!header.startsWith(BEARER)) return null
        val used = header.substring(BEARER.length)

        val fresh = runBlocking {
            val session = tokens.currentSession()
            if (session == null || !request.url.hasSameOriginAs(session.baseUrl)) {
                null
            } else {
                tokens.refreshAfterUnauthorized(used)
            }
        } ?: return null
        return request.newBuilder().header(BearerTokenInterceptor.AUTHORIZATION, BEARER + fresh).build()
    }

    private companion object {
        const val BEARER = "Bearer "
    }
}
