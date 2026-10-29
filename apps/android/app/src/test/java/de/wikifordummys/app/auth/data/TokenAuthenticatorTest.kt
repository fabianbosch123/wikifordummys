package de.wikifordummys.app.auth.data

import de.wikifordummys.app.auth.model.StoredSession
import de.wikifordummys.app.core.net.HttpClients
import de.wikifordummys.app.testing.EncryptedStores
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.runBlocking
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

/** Bearer-Interceptor und Authenticator zusammen, wie im AppContainer. */
class TokenAuthenticatorTest {

    private val wiki = MockWebServer()
    private val foreign = MockWebServer()
    private lateinit var baseUrl: String
    private val stores = EncryptedStores()
    private lateinit var repo: OAuthAuthRepository
    private lateinit var client: OkHttpClient

    private fun token(prefix: String, n: Int) = prefix + n.toString().padStart(43, '0')

    /** Gültiges Access-Token am „Server“; jede Erneuerung erzeugt ein neues Paar. */
    @Volatile private var validAccess = token("wfd_", 1)
    @Volatile private var validRefresh = token("wfr_", 1)
    private val refreshCount = AtomicInteger()
    private val apiCount = AtomicInteger()
    @Volatile private var alwaysUnauthorized = false
    @Volatile private var refreshGate: CountDownLatch? = null

    @Before
    fun setUp() {
        wiki.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = when (request.url.encodedPath) {
                "/api/v1/oauth/token" -> refresh(request)
                else -> api(request)
            }
        }
        wiki.start()
        foreign.start()
        baseUrl = wiki.url("/").toString().removeSuffix("/")
        repo = OAuthAuthRepository(OAuthTokenClient(HttpClients.base()), stores.session, stores.pending)
        client = HttpClients.base().newBuilder()
            .followRedirects(false)
            .addInterceptor(BearerTokenInterceptor(repo))
            .authenticator(TokenAuthenticator(repo))
            .build()
    }

    @After
    fun tearDown() {
        wiki.close()
        foreign.close()
    }

    private fun refresh(request: RecordedRequest): MockResponse {
        refreshGate?.await(5, TimeUnit.SECONDS)
        val body = request.body!!.utf8()
        synchronized(this) {
            if (!body.contains("refresh_token=$validRefresh")) {
                return MockResponse.Builder().code(400).body("""{"error":"invalid_grant","error_description":"x"}""").build()
            }
            val n = refreshCount.incrementAndGet() + 1
            validAccess = token("wfd_", n)
            validRefresh = token("wfr_", n)
            return MockResponse.Builder().code(200)
                .body("""{"access_token":"$validAccess","token_type":"Bearer","expires_in":3600,"refresh_token":"$validRefresh","scope":"read"}""")
                .build()
        }
    }

    private fun api(request: RecordedRequest): MockResponse {
        apiCount.incrementAndGet()
        val ok = !alwaysUnauthorized && request.headers["Authorization"] == "Bearer $validAccess"
        return if (ok) {
            MockResponse.Builder().code(200).body("[]").build()
        } else {
            MockResponse.Builder().code(401).body("""{"error":{"code":"INVALID_TOKEN","message":"x"}}""").build()
        }
    }

    private fun login(access: String = validAccess, refresh: String = validRefresh) = runBlocking {
        stores.session.save(StoredSession(baseUrl, access, refresh))
    }

    /** Server hat das Access-Token schon ersetzt (abgelaufen); die App hält noch das alte. */
    private fun expireAccessToken() {
        validAccess = token("wfd_", 999)
    }

    private fun get(url: String = "$baseUrl/api/v1/spaces") =
        client.newCall(Request.Builder().url(url).build()).execute().use { it.code }

    @Test
    fun `valid token is sent and nothing is refreshed`() {
        login()
        assertEquals(200, get())
        assertEquals(0, refreshCount.get())
        assertEquals("Bearer ${validAccess}", wiki.takeRequest().headers["Authorization"])
    }

    @Test
    fun `401 refreshes once and repeats the request once`() {
        login()
        expireAccessToken()

        assertEquals(200, get())
        assertEquals(1, refreshCount.get())
        assertEquals(2, apiCount.get())
        assertEquals(validAccess, runBlocking { repo.currentSession() }!!.accessToken)
    }

    @Test
    fun `second 401 after refresh goes to the caller without another refresh`() {
        login()
        alwaysUnauthorized = true

        assertEquals(401, get())
        assertEquals(1, refreshCount.get())
        assertEquals(2, apiCount.get())
    }

    @Test
    fun `parallel 401 share one refresh`() {
        login()
        expireAccessToken()
        refreshGate = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(8)
        try {
            val results = (1..8).map { pool.submit(Callable { get() }) }
            // Alle laufen auf 401, bevor die eine Erneuerung antwortet
            Thread.sleep(300)
            refreshGate!!.countDown()
            assertEquals(List(8) { 200 }, results.map { it.get(10, TimeUnit.SECONDS) })
        } finally {
            pool.shutdownNow()
        }
        assertEquals(1, refreshCount.get())
    }

    @Test
    fun `invalid_grant clears the session and returns 401`() {
        login(refresh = token("wfr_", 77))
        expireAccessToken()

        assertEquals(401, get())
        assertNull(runBlocking { repo.currentSession() })
    }

    @Test
    fun `token never goes to another origin, not even when the caller sets it`() {
        login()
        foreign.enqueue(MockResponse.Builder().code(200).body("ok").build())
        val request = Request.Builder().url(foreign.url("/api/v1/spaces"))
            .header("Authorization", "Bearer wfd_selbst-gesetzt").build()
        client.newCall(request).execute().close()
        assertNull(foreign.takeRequest().headers["Authorization"])
    }

    @Test
    fun `401 from another origin does not refresh`() {
        login()
        foreign.enqueue(MockResponse.Builder().code(401).body("").build())
        client.newCall(Request.Builder().url(foreign.url("/x")).build()).execute().close()
        assertEquals(0, refreshCount.get())
    }

    @Test
    fun `without session no token and no refresh`() {
        assertEquals(401, get())
        assertNull(wiki.takeRequest().headers["Authorization"])
        assertEquals(0, refreshCount.get())
    }
}
