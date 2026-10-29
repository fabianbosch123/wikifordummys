package de.wikifordummys.app.auth.model

import java.security.SecureRandom
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PkceTest {

    /** RFC 7636, Anhang B */
    private val rfcOctets = intArrayOf(
        116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186,
        22, 212, 37, 77, 105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121,
    ).map { it.toByte() }.toByteArray()
    private val rfcVerifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    private val rfcChallenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"

    private class FixedRandom(private val bytes: ByteArray) : SecureRandom() {
        override fun nextBytes(out: ByteArray) {
            bytes.copyInto(out, endIndex = out.size)
        }
    }

    @Test
    fun `verifier has 43 characters from the base64url alphabet`() {
        val generator = PkceGenerator()
        repeat(50) {
            val verifier = generator.newCodeVerifier()
            assertEquals(43, verifier.length)
            assertTrue(verifier, Regex("^[A-Za-z0-9_-]{43}$").matches(verifier))
        }
    }

    @Test
    fun `verifier and state are random`() {
        val generator = PkceGenerator()
        val values = (1..100).map { generator.newCodeVerifier() } + (1..100).map { generator.newState() }
        assertEquals(values.size, values.toSet().size)
    }

    @Test
    fun `verifier encodes 32 random bytes as in RFC 7636`() {
        assertEquals(rfcVerifier, PkceGenerator(FixedRandom(rfcOctets)).newCodeVerifier())
    }

    @Test
    fun `challenge matches RFC 7636 test vector`() {
        assertEquals(rfcChallenge, PkceGenerator.codeChallenge(rfcVerifier))
    }

    @Test
    fun `constant time comparison`() {
        assertTrue(constantTimeEquals("abc", "abc"))
        assertFalse(constantTimeEquals("abc", "abd"))
        assertFalse(constantTimeEquals("abc", "abcd"))
        assertFalse(constantTimeEquals("", "a"))
    }

    @Test
    fun `authorization url carries all parameters the server requires`() {
        val url = AppOAuth.authorizationUrl("https://wiki.example.de", rfcChallenge, "st&ate=x").toHttpUrl()

        assertEquals("https", url.scheme)
        assertEquals("wiki.example.de", url.host)
        assertEquals("/oauth/authorize", url.encodedPath)
        assertEquals("code", url.queryParameter("response_type"))
        assertEquals("7f1c2b9e-4d3a-4e8f-9b6a-a9d0c1e2f3a4", url.queryParameter("client_id"))
        assertEquals("de.wikifordummys.app:/oauth/callback", url.queryParameter("redirect_uri"))
        assertEquals(rfcChallenge, url.queryParameter("code_challenge"))
        assertEquals("S256", url.queryParameter("code_challenge_method"))
        assertEquals("st&ate=x", url.queryParameter("state"))
        assertEquals("https://wiki.example.de/api/v1", url.queryParameter("resource"))
        assertEquals(7, url.querySize)
        assertNotEquals(null, url.queryParameter("state"))
    }
}
