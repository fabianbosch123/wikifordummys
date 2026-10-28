package de.wikifordummys.app.server.data

import de.wikifordummys.app.server.model.ServerCheckResult
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

class HealthServerCheckerTest {

    private val server = MockWebServer()
    private val checker = HealthServerChecker(OkHttpClient())

    @Before
    fun setUp() = server.start()

    @After
    fun tearDown() = server.close()

    // Die App selbst lässt nur https zu (WikiUrlValidator, Network Security Config); MockWebServer spricht hier http.
    private fun baseUrl() = server.url("/").toString().removeSuffix("/")

    private fun enqueue(code: Int, body: String = "", contentType: String = "application/json; charset=utf-8") {
        server.enqueue(
            MockResponse.Builder()
                .code(code)
                .addHeader("Content-Type", contentType)
                .body(body)
                .build(),
        )
    }

    @Test
    fun `healthy wiki is ok and the documented path is called without credentials`() = runTest {
        enqueue(200, """{"status":"ok","checks":{"database":"ok","redis":"ok","disk":"ok"}}""")

        assertEquals(ServerCheckResult.Ok, checker.check(baseUrl()))

        val request = server.takeRequest()
        assertEquals("GET", request.method)
        assertEquals("/api/v1/health", request.url.encodedPath)
        assertNull(request.headers["Authorization"])
        assertNull(request.headers["Cookie"])
    }

    @Test
    fun `trailing slash in base url is tolerated`() = runTest {
        enqueue(200, """{"status":"ok","checks":{}}""")

        assertEquals(ServerCheckResult.Ok, checker.check(baseUrl() + "/"))
        assertEquals("/api/v1/health", server.takeRequest().url.encodedPath)
    }

    @Test
    fun `unknown fields are ignored`() = runTest {
        enqueue(200, """{"status":"ok","checks":{"disk":"knapp"},"version":"9"}""")

        assertEquals(ServerCheckResult.Ok, checker.check(baseUrl()))
    }

    @Test
    fun `503 means the wiki is unhealthy`() = runTest {
        enqueue(503, """{"error":{"code":"HTTP_503","message":"Http Exception"}}""")

        assertEquals(ServerCheckResult.Unhealthy, checker.check(baseUrl()))
    }

    @Test
    fun `404 means no wiki`() = runTest {
        enqueue(404, """{"error":{"code":"NOT_FOUND","message":"x"}}""")

        assertEquals(ServerCheckResult.NotAWiki, checker.check(baseUrl()))
    }

    @Test
    fun `html page with 200 means no wiki`() = runTest {
        enqueue(200, "<html><body>Hallo</body></html>", contentType = "text/html")

        assertEquals(ServerCheckResult.NotAWiki, checker.check(baseUrl()))
    }

    @Test
    fun `body larger than the limit means no wiki`() = runTest {
        enqueue(200, """{"status":"ok","pad":"""" + "x".repeat(1024 * 1024) + "\"}")

        assertEquals(ServerCheckResult.NotAWiki, checker.check(baseUrl()))
    }

    @Test
    fun `chunked body larger than the limit means no wiki`() = runTest {
        server.enqueue(
            MockResponse.Builder()
                .code(200)
                .addHeader("Content-Type", "application/json")
                .chunkedBody("""{"status":"ok","pad":"""" + "x".repeat(1024 * 1024) + "\"}", 8192)
                .build(),
        )

        assertEquals(ServerCheckResult.NotAWiki, checker.check(baseUrl()))
    }

    @Test
    fun `body right at the limit is still accepted`() = runTest {
        val json = """{"status":"ok"}"""
        val padded = json + " ".repeat((HealthServerChecker.MAX_BODY_BYTES - json.length).toInt())
        enqueue(200, padded)

        assertEquals(ServerCheckResult.Ok, checker.check(baseUrl()))
    }

    @Test
    fun `json without ok status means no wiki`() = runTest {
        enqueue(200, """{"status":"irgendwas"}""")

        assertEquals(ServerCheckResult.NotAWiki, checker.check(baseUrl()))
    }

    @Test
    fun `redirects are not followed`() = runTest {
        server.enqueue(
            MockResponse.Builder()
                .code(301)
                .addHeader("Location", "http://other.example/api/v1/health")
                .build(),
        )

        assertEquals(ServerCheckResult.NotAWiki, checker.check(baseUrl()))
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `429 is reported as rate limited`() = runTest {
        enqueue(429, """{"error":{"code":"RATE_LIMITED","message":"x"}}""")

        assertEquals(ServerCheckResult.RateLimited, checker.check(baseUrl()))
    }

    @Test
    fun `other errors carry the status code`() = runTest {
        enqueue(502, "Bad Gateway", contentType = "text/plain")

        assertEquals(ServerCheckResult.HttpError(502), checker.check(baseUrl()))
    }

    @Test
    fun `closed port is unreachable`() = runTest {
        val url = baseUrl()
        server.close()

        assertEquals(ServerCheckResult.Unreachable, checker.check(url))
    }
}
