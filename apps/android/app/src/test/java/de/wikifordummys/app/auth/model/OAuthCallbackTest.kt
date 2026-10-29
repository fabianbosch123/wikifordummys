package de.wikifordummys.app.auth.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class OAuthCallbackTest {

    @Test
    fun `parses a callback as the consent page builds it`() {
        // apps/api: new URL(redirect_uri) mit searchParams state, iss, code (URLSearchParams kodiert : und / )
        val callback = OAuthCallback.parse(
            "de.wikifordummys.app:/oauth/callback?state=s%2B1&iss=https%3A%2F%2Fwiki.example.de&code=abc_-1",
        )!!
        assertEquals("s+1", callback.state)
        assertEquals("https://wiki.example.de", callback.issuer)
        assertEquals("abc_-1", callback.code)
        assertNull(callback.error)
    }

    @Test
    fun `parses error`() {
        val callback = OAuthCallback.parse(
            "de.wikifordummys.app:/oauth/callback?state=s&iss=https%3A%2F%2Fwiki.example.de&error=access_denied",
        )!!
        assertEquals("access_denied", callback.error)
        assertNull(callback.code)
    }

    @Test
    fun `rejects other schemes, paths, fragments and duplicates`() {
        val rejected = listOf(
            "https://evil.example/oauth/callback?state=s&code=c",
            "de.wikifordummys.app:/other?state=s&code=c",
            "de.wikifordummys.app://oauth/callback?state=s&code=c",
            "de.wikifordummys.app:/oauth/callbackx?state=s&code=c",
            "de.wikifordummys.app:/oauth/callback#state=s&code=c",
            "de.wikifordummys.app:/oauth/callback?state=s&code=c#x",
            "de.wikifordummys.app:/oauth/callback?state=s&iss=a&iss=b&code=c",
            "de.wikifordummys.app:/oauth/callback?state=s&state=t&code=c",
            "de.wikifordummys.app:/oauth/callback?state=%zz&code=c",
            "de.wikifordummys.app:/oauth/callback?state=" + "x".repeat(OAuthCallback.MAX_LENGTH),
        )
        for (raw in rejected) assertNull(raw.take(80), OAuthCallback.parse(raw))
    }

    @Test
    fun `unknown parameters are ignored, even repeated`() {
        val callback = OAuthCallback.parse("de.wikifordummys.app:/oauth/callback?x=1&x=2&state=s&code=c")!!
        assertEquals("s", callback.state)
        assertEquals("c", callback.code)
    }
}
