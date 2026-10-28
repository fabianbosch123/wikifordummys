package de.wikifordummys.app.server.model

import org.junit.Assert.assertEquals
import org.junit.Test

class WikiUrlValidatorTest {

    private fun valid(input: String) = WikiUrlValidator.validate(input)
    private fun error(input: String) = (WikiUrlValidator.validate(input) as? UrlValidation.Invalid)?.error

    @Test
    fun `accepts https origin and normalizes it`() {
        assertEquals(UrlValidation.Valid("https://wiki.example.de"), valid("https://wiki.example.de"))
        assertEquals(UrlValidation.Valid("https://wiki.example.de"), valid("https://wiki.example.de/"))
        assertEquals(UrlValidation.Valid("https://wiki.example.de"), valid("  HTTPS://Wiki.Example.DE/  "))
    }

    @Test
    fun `assumes https when scheme is missing`() {
        assertEquals(UrlValidation.Valid("https://wiki.example.de"), valid("wiki.example.de"))
        assertEquals(UrlValidation.Valid("https://wiki.example.de:8443"), valid("wiki.example.de:8443"))
    }

    @Test
    fun `keeps custom port and drops default port`() {
        assertEquals(UrlValidation.Valid("https://wiki.example.de:8443"), valid("https://wiki.example.de:8443"))
        assertEquals(UrlValidation.Valid("https://wiki.example.de"), valid("https://wiki.example.de:443"))
    }

    @Test
    fun `converts international domain names to punycode`() {
        assertEquals(UrlValidation.Valid("https://xn--bcher-kva.example"), valid("https://bücher.example"))
    }

    @Test
    fun `rejects empty input`() {
        assertEquals(UrlError.Empty, error(""))
        assertEquals(UrlError.Empty, error("   "))
    }

    @Test
    fun `rejects overly long input`() {
        assertEquals(UrlError.TooLong, error("https://" + "a".repeat(WikiUrlValidator.MAX_LENGTH)))
    }

    @Test
    fun `rejects http and other schemes`() {
        assertEquals(UrlError.NotHttps, error("http://wiki.example.de"))
        assertEquals(UrlError.NotHttps, error("HTTP://wiki.example.de"))
        assertEquals(UrlError.NotHttps, error("ftp://wiki.example.de"))
        assertEquals(UrlError.NotHttps, error("file:///etc/passwd"))
    }

    @Test
    fun `rejects input that is not a url`() {
        assertEquals(UrlError.Malformed, error("wiki example de"))
        assertEquals(UrlError.Malformed, error("https://"))
        assertEquals(UrlError.Malformed, error("https://wiki.example.de:99999"))
        assertEquals(UrlError.Malformed, error("javascript:alert(1)"))
        assertEquals(UrlError.Malformed, error("https://wiki.example.de\u0000"))
    }

    @Test
    fun `rejects credentials in url`() {
        assertEquals(UrlError.Credentials, error("https://user:secret@wiki.example.de"))
        assertEquals(UrlError.Credentials, error("https://user@wiki.example.de"))
    }

    @Test
    fun `rejects path query and fragment`() {
        assertEquals(UrlError.HasPath, error("https://wiki.example.de/spaces/abc"))
        assertEquals(UrlError.HasPath, error("https://wiki.example.de/api/v1"))
        assertEquals(UrlError.HasPath, error("https://wiki.example.de/?a=b"))
        assertEquals(UrlError.HasPath, error("https://wiki.example.de/?"))
        assertEquals(UrlError.HasPath, error("https://wiki.example.de#top"))
    }

    @Test
    fun `does not let a backslash smuggle in another host`() {
        val result = WikiUrlValidator.validate("https://evil.example\\@wiki.example.de")
        assertEquals(UrlValidation.Invalid(UrlError.HasPath), result)
    }
}
