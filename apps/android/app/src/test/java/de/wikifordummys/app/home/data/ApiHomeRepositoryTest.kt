package de.wikifordummys.app.home.data

import de.wikifordummys.app.core.api.ApiResult
import de.wikifordummys.app.core.net.HttpClients
import de.wikifordummys.app.home.model.Me
import de.wikifordummys.app.home.model.Space
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

class ApiHomeRepositoryTest {

    private val server = MockWebServer()
    private lateinit var repo: ApiHomeRepository

    @Before
    fun setUp() {
        server.start()
        repo = ApiHomeRepository(server.url("/").toString(), HttpClients.base().newBuilder().followRedirects(false).build())
    }

    @After
    fun tearDown() = server.close()

    private fun respond(code: Int, body: String) =
        server.enqueue(MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(body).build())

    @Test
    fun `reads spaces as SpacesService returns them`() = runTest {
        respond(
            200,
            """[{"id":"s1","key":"IT","name":"IT-Team","description":"Server","status":"active","homePageId":null,
               "createdBy":{"id":"u1","displayName":"Anna"},"createdAt":"2026-01-01T00:00:00.000Z",
               "updatedAt":"2026-01-02T00:00:00.000Z","role":"admin","canEdit":true}]""",
        )
        assertEquals(
            ApiResult.Success(listOf(Space("s1", "IT", "IT-Team", "Server", "active", null, "admin", true))),
            repo.spaces(),
        )
        val request = server.takeRequest()
        assertEquals("GET", request.method)
        assertEquals("/api/v1/spaces", request.url.encodedPath)
    }

    @Test
    fun `reads me`() = runTest {
        respond(200, """{"id":"u1","email":"anna@example.de","displayName":"Anna","isAdmin":false,"canCreateSpace":true,"totpEnabled":true,"mustChangePassword":false}""")
        assertEquals(ApiResult.Success(Me("u1", "anna@example.de", "Anna")), repo.me())
        assertEquals("/api/v1/me", server.takeRequest().url.encodedPath)
    }

    @Test
    fun `api errors map to results`() = runTest {
        val cases = listOf(
            401 to ApiResult.Unauthorized,
            403 to ApiResult.Forbidden,
            404 to ApiResult.NotFound,
            429 to ApiResult.RateLimited,
            503 to ApiResult.ServerError(503),
            302 to ApiResult.InvalidResponse,
            418 to ApiResult.HttpError(418),
        )
        for ((code, expected) in cases) {
            respond(code, """{"error":{"code":"X","message":"x"}}""")
            assertEquals("$code", expected, repo.spaces())
        }
    }

    @Test
    fun `broken json and oversized error bodies are invalid responses`() = runTest {
        respond(200, "<html>")
        assertEquals(ApiResult.InvalidResponse, repo.spaces())
        server.enqueue(MockResponse.Builder().code(500).chunkedBody("x".repeat(3 * 1024 * 1024), 64 * 1024).build())
        assertEquals(ApiResult.InvalidResponse, repo.spaces())
    }
}
