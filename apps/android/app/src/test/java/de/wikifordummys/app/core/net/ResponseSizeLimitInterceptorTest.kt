package de.wikifordummys.app.core.net

import de.wikifordummys.app.core.net.HttpClients.ensureSizeLimit
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test

class ResponseSizeLimitInterceptorTest {

    private val server = MockWebServer()
    private val client = OkHttpClient.Builder().addInterceptor(ResponseSizeLimitInterceptor(100)).build()

    @Before
    fun setUp() = server.start()

    @After
    fun tearDown() = server.close()

    private fun get(limit: Long? = null): String {
        val request = Request.Builder().url(server.url("/x")).apply {
            if (limit != null) tag(ResponseSizeLimit::class.java, ResponseSizeLimit(limit))
        }.build()
        return client.newCall(request).execute().use { it.body.string() }
    }

    @Test
    fun `body at the limit is read`() {
        server.enqueue(MockResponse.Builder().body("a".repeat(100)).build())
        assertEquals(100, get().length)
    }

    @Test
    fun `too large content length is rejected before reading`() {
        server.enqueue(MockResponse.Builder().body("a".repeat(101)).build())
        assertThrows(ResponseTooLargeException::class.java) { get() }
    }

    @Test
    fun `chunked body without length stops at the limit`() {
        server.enqueue(MockResponse.Builder().chunkedBody("a".repeat(5000), 10).build())
        assertThrows(ResponseTooLargeException::class.java) { get() }
    }

    @Test
    fun `error responses are limited as well`() {
        server.enqueue(MockResponse.Builder().code(500).chunkedBody("e".repeat(5000), 10).build())
        assertThrows(ResponseTooLargeException::class.java) { get() }
    }

    @Test
    fun `tag lowers the limit for one request`() {
        server.enqueue(MockResponse.Builder().body("a".repeat(50)).build())
        assertThrows(ResponseTooLargeException::class.java) { get(limit = 10) }
    }

    @Test
    fun `derived clients keep exactly one limit`() {
        val base = HttpClients.base()
        assertEquals(1, base.newBuilder().ensureSizeLimit().build().interceptors.count { it is ResponseSizeLimitInterceptor })
        assertEquals(1, OkHttpClient.Builder().ensureSizeLimit().build().interceptors.count { it is ResponseSizeLimitInterceptor })
    }
}
