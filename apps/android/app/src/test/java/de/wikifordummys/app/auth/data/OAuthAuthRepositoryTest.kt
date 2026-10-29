package de.wikifordummys.app.auth.data

import app.cash.turbine.test
import de.wikifordummys.app.auth.model.AppOAuth
import de.wikifordummys.app.auth.model.LoginResult
import de.wikifordummys.app.auth.model.PkceGenerator
import de.wikifordummys.app.auth.model.SessionInfo
import de.wikifordummys.app.auth.model.StoredSession
import de.wikifordummys.app.core.net.HttpClients
import de.wikifordummys.app.testing.EncryptedStores
import java.net.URLEncoder
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class OAuthAuthRepositoryTest {

    private val server = MockWebServer()
    private lateinit var baseUrl: String
    private var now = 1_000_000L
    private val stores = EncryptedStores()

    private fun repository(s: EncryptedStores = stores) = OAuthAuthRepository(
        tokenClient = OAuthTokenClient(HttpClients.base()),
        sessionStore = s.session,
        pendingStore = s.pending,
        clock = { now },
    )

    @Before
    fun setUp() {
        server.start()
        // Die App lässt nur https zu; MockWebServer spricht hier http. Für die Logik ist das gleich.
        baseUrl = server.url("/").toString().removeSuffix("/")
    }

    @After
    fun tearDown() = server.close()

    private fun token(prefix: String, fill: Char) = prefix + fill.toString().repeat(43)
    private val access1 = token("wfd_", 'a')
    private val refresh1 = token("wfr_", 'b')
    private val access2 = token("wfd_", 'c')
    private val refresh2 = token("wfr_", 'd')

    private fun tokens(access: String, refresh: String) = MockResponse.Builder()
        .code(200)
        .addHeader("Content-Type", "application/json")
        .addHeader("Cache-Control", "no-store")
        .body("""{"access_token":"$access","token_type":"Bearer","expires_in":3600,"refresh_token":"$refresh","scope":"read"}""")
        .build()

    private fun oauthError(code: Int, error: String) = MockResponse.Builder()
        .code(code)
        .addHeader("Content-Type", "application/json")
        .body("""{"error":"$error","error_description":"Beschreibung"}""")
        .build()

    private fun enc(v: String) = URLEncoder.encode(v, "UTF-8")

    /** Rücksprung, wie ihn OAuthService.decide baut. */
    private fun callback(state: String, iss: String = baseUrl, code: String? = "the-code", error: String? = null): String {
        val params = buildList {
            add("state=${enc(state)}")
            add("iss=${enc(iss)}")
            error?.let { add("error=${enc(it)}") }
            code?.let { add("code=${enc(it)}") }
        }
        return AppOAuth.REDIRECT_URI + "?" + params.joinToString("&")
    }

    private fun form(request: RecordedRequest): Map<String, String> =
        request.body!!.utf8().split('&').associate {
            java.net.URLDecoder.decode(it.substringBefore('='), "UTF-8") to java.net.URLDecoder.decode(it.substringAfter('='), "UTF-8")
        }

    private suspend fun OAuthAuthRepository.startLogin(): Pair<String, String> {
        val url = beginLogin(baseUrl).toHttpUrl()
        return url.queryParameter("state")!! to url.queryParameter("code_challenge")!!
    }

    private suspend fun loggedIn(repo: OAuthAuthRepository) {
        server.enqueue(tokens(access1, refresh1))
        val (state, _) = repo.startLogin()
        assertEquals(LoginResult.Success, repo.completeLogin(baseUrl, callback(state)))
        server.takeRequest()
    }

    // ---------- Anmeldung ----------

    @Test
    fun `code exchange sends the form the server expects and stores the tokens encrypted`() = runTest {
        val repo = repository()
        server.enqueue(tokens(access1, refresh1))
        val (state, challenge) = repo.startLogin()

        assertEquals(LoginResult.Success, repo.completeLogin(baseUrl, callback(state)))

        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/api/v1/oauth/token", request.url.encodedPath)
        assertTrue(request.headers["Content-Type"]!!.startsWith("application/x-www-form-urlencoded"))
        assertNull(request.headers["Authorization"])
        val form = form(request)
        assertEquals("authorization_code", form["grant_type"])
        assertEquals("the-code", form["code"])
        assertEquals(AppOAuth.REDIRECT_URI, form["redirect_uri"])
        assertEquals(AppOAuth.CLIENT_ID, form["client_id"])
        assertEquals("$baseUrl/api/v1", form["resource"])
        assertEquals(challenge, PkceGenerator.codeChallenge(form.getValue("code_verifier")))

        assertEquals(StoredSession(baseUrl, access1, refresh1), repo.currentSession())
        assertFalse(stores.raw.values.values.any { "wfd_" in it || "wfr_" in it })
        // Nach Neustart aus dem Speicher
        assertEquals(StoredSession(baseUrl, access1, refresh1), repository().currentSession())
        // Verifier und state sind verbraucht
        assertNull(stores.pending.load())
    }

    @Test
    fun `session flow follows login and logout`() = runTest {
        val repo = repository()
        repo.session.test {
            assertNull(awaitItem())
            loggedIn(repo)
            assertEquals(SessionInfo(baseUrl), awaitItem())
            server.enqueue(MockResponse.Builder().code(200).body("{}").build())
            repo.logout()
            assertNull(awaitItem())
        }
    }

    @Test
    fun `callback without running login is dropped`() = runTest {
        assertEquals(LoginResult.NoPendingLogin, repository().completeLogin(baseUrl, callback("any")))
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `wrong or missing state is rejected and the login stays usable`() = runTest {
        val repo = repository()
        val (state, _) = repo.startLogin()

        assertEquals(LoginResult.Rejected, repo.completeLogin(baseUrl, callback(state + "x")))
        assertEquals(LoginResult.Rejected, repo.completeLogin(baseUrl, AppOAuth.REDIRECT_URI + "?code=c&iss=" + enc(baseUrl)))
        assertEquals(LoginResult.Rejected, repo.completeLogin(baseUrl, "https://evil.example/oauth/callback?state=$state"))
        assertEquals(0, server.requestCount)

        server.enqueue(tokens(access1, refresh1))
        assertEquals(LoginResult.Success, repo.completeLogin(baseUrl, callback(state)))
    }

    @Test
    fun `a login is good for exactly one callback`() = runTest {
        val repo = repository()
        server.enqueue(oauthError(400, "invalid_grant"))
        val (state, _) = repo.startLogin()

        assertEquals(LoginResult.InvalidGrant, repo.completeLogin(baseUrl, callback(state)))
        assertEquals(LoginResult.NoPendingLogin, repo.completeLogin(baseUrl, callback(state)))
        assertEquals(1, server.requestCount)
        assertNull(repo.currentSession())
    }

    @Test
    fun `issuer must be the wiki the login started at`() = runTest {
        val repo = repository()
        val (state, _) = repo.startLogin()

        assertEquals(LoginResult.IssuerMismatch, repo.completeLogin(baseUrl, callback(state, iss = "https://evil.example")))
        assertEquals(0, server.requestCount)
        // Verbraucht: auch der richtige Rücksprung gilt danach nicht mehr
        assertEquals(LoginResult.NoPendingLogin, repo.completeLogin(baseUrl, callback(state)))
    }

    @Test
    fun `missing issuer is rejected`() = runTest {
        val repo = repository()
        val (state, _) = repo.startLogin()
        val raw = AppOAuth.REDIRECT_URI + "?state=${enc(state)}&code=c"
        assertEquals(LoginResult.IssuerMismatch, repo.completeLogin(baseUrl, raw))
    }

    @Test
    fun `error parameter ends the login without token request`() = runTest {
        val repo = repository()
        var (state, _) = repo.startLogin()
        assertEquals(LoginResult.AccessDenied, repo.completeLogin(baseUrl, callback(state, code = null, error = "access_denied")))
        state = repo.startLogin().first
        assertEquals(LoginResult.AuthorizationFailed, repo.completeLogin(baseUrl, callback(state, code = null, error = "server_error")))
        state = repo.startLogin().first
        assertEquals(LoginResult.AuthorizationFailed, repo.completeLogin(baseUrl, callback(state, code = null)))
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `running login survives process death`() = runTest {
        val (state, _) = repository().startLogin()
        server.enqueue(tokens(access1, refresh1))

        val afterRestart = repository()
        assertEquals(LoginResult.Success, afterRestart.completeLogin(baseUrl, callback(state)))
    }

    @Test
    fun `expired login and login for another wiki are dropped`() = runTest {
        val repo = repository()
        var (state, _) = repo.startLogin()
        now += OAuthAuthRepository.PENDING_LOGIN_TTL_MILLIS + 1
        assertEquals(LoginResult.NoPendingLogin, repo.completeLogin(baseUrl, callback(state)))

        state = repo.startLogin().first
        assertEquals(LoginResult.NoPendingLogin, repo.completeLogin("https://other.example", callback(state)))
        assertNull(stores.pending.load())
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `token endpoint redirects are not followed`() = runTest {
        val repo = repository()
        server.enqueue(MockResponse.Builder().code(307).addHeader("Location", server.url("/elsewhere")).build())
        val (state, _) = repo.startLogin()

        assertEquals(LoginResult.InvalidResponse, repo.completeLogin(baseUrl, callback(state)))
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `oversized responses are not read, also error responses`() = runTest {
        val repo = repository()
        val huge = "x".repeat((OAuthTokenClient.MAX_RESPONSE_BYTES + 1).toInt())
        server.enqueue(MockResponse.Builder().code(400).chunkedBody("""{"error":"invalid_grant","pad":"$huge"}""", 1024).build())
        var (state, _) = repo.startLogin()
        assertEquals(LoginResult.InvalidResponse, repo.completeLogin(baseUrl, callback(state)))

        server.enqueue(MockResponse.Builder().code(200).body("""{"access_token":"$access1","pad":"$huge"}""").build())
        state = repo.startLogin().first
        assertEquals(LoginResult.InvalidResponse, repo.completeLogin(baseUrl, callback(state)))
        assertNull(repo.currentSession())
    }

    @Test
    fun `tokens of unexpected shape are refused`() = runTest {
        val repo = repository()
        server.enqueue(tokens("abc\r\nX-Evil: 1", refresh1))
        val (state, _) = repo.startLogin()
        assertEquals(LoginResult.InvalidResponse, repo.completeLogin(baseUrl, callback(state)))
    }

    @Test
    fun `rate limit and server errors are reported`() = runTest {
        val repo = repository()
        server.enqueue(MockResponse.Builder().code(429).body("""{"error":{"code":"RATE_LIMITED"}}""").build())
        var (state, _) = repo.startLogin()
        assertEquals(LoginResult.RateLimited, repo.completeLogin(baseUrl, callback(state)))
        server.enqueue(MockResponse.Builder().code(502).body("bad gateway").build())
        state = repo.startLogin().first
        assertEquals(LoginResult.Http(502), repo.completeLogin(baseUrl, callback(state)))
    }

    @Test
    fun `failing storage is reported and nothing is half stored`() = runTest {
        val repo = repository()
        val (state, _) = repo.startLogin()
        server.enqueue(tokens(access1, refresh1))
        stores.raw.failWrites = true
        assertEquals(LoginResult.StorageFailed, repo.completeLogin(baseUrl, callback(state)))
        assertNull(repo.currentSession())
    }

    // ---------- Erneuerung ----------

    @Test
    fun `refresh rotates both tokens and stores them`() = runTest {
        val repo = repository()
        loggedIn(repo)
        server.enqueue(tokens(access2, refresh2))

        assertEquals(access2, repo.refreshAfterUnauthorized(access1))

        val form = form(server.takeRequest())
        assertEquals("refresh_token", form["grant_type"])
        assertEquals(refresh1, form["refresh_token"])
        assertEquals(AppOAuth.CLIENT_ID, form["client_id"])
        assertEquals(StoredSession(baseUrl, access2, refresh2), repository().currentSession())
    }

    @Test
    fun `refresh with an outdated access token reuses the newer one`() = runTest {
        val repo = repository()
        loggedIn(repo)
        server.enqueue(tokens(access2, refresh2))
        assertEquals(access2, repo.refreshAfterUnauthorized(access1))
        // Zweite Anfrage war noch mit access1 unterwegs: kein zweiter Tausch, das alte Refresh-Token nie wieder
        assertEquals(access2, repo.refreshAfterUnauthorized(access1))
        assertEquals(2, server.requestCount)
    }

    @Test
    fun `invalid_grant on refresh clears the session`() = runTest {
        val repo = repository()
        loggedIn(repo)
        server.enqueue(oauthError(400, "invalid_grant"))

        assertNull(repo.refreshAfterUnauthorized(access1))
        assertNull(repo.currentSession())
        assertNull(repository().currentSession())
    }

    @Test
    fun `transient refresh failures keep the session`() = runTest {
        val repo = repository()
        loggedIn(repo)
        server.enqueue(MockResponse.Builder().code(503).body("").build())
        assertNull(repo.refreshAfterUnauthorized(access1))
        server.enqueue(MockResponse.Builder().code(429).body("").build())
        assertNull(repo.refreshAfterUnauthorized(access1))
        assertEquals(StoredSession(baseUrl, access1, refresh1), repo.currentSession())
    }

    // ---------- Abmelden ----------

    @Test
    fun `logout revokes at the server and clears locally`() = runTest {
        val repo = repository()
        loggedIn(repo)
        server.enqueue(MockResponse.Builder().code(200).body("{}").build())

        repo.logout()

        val request = server.takeRequest()
        assertEquals("/api/v1/oauth/revoke", request.url.encodedPath)
        val form = form(request)
        assertEquals(refresh1, form["token"])
        assertEquals(AppOAuth.CLIENT_ID, form["client_id"])
        assertNull(repo.currentSession())
        assertTrue(stores.raw.values.isEmpty())
    }

    @Test
    fun `logout clears locally even when the server fails or is unreachable`() = runTest {
        val repo = repository()
        loggedIn(repo)
        server.enqueue(MockResponse.Builder().code(500).body("").build())
        repo.logout()
        assertNull(repository().currentSession())

        loggedIn(repo)
        server.close()
        repo.logout()
        assertNull(repo.currentSession())
        assertNotNull(stores.raw)
        assertTrue(stores.raw.values.isEmpty())
    }
}
