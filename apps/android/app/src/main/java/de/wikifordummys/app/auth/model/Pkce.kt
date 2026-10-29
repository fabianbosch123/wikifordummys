package de.wikifordummys.app.auth.model

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/** PKCE nach RFC 7636 (nur S256) und zufälliger `state`. */
class PkceGenerator(private val random: SecureRandom = SecureRandom()) {

    /** 32 zufällige Bytes, base64url ohne Auffüllung: 43 Zeichen aus `[A-Za-z0-9_-]`. */
    fun newCodeVerifier(): String = randomToken()

    fun newState(): String = randomToken()

    private fun randomToken(): String {
        val bytes = ByteArray(RANDOM_BYTES)
        random.nextBytes(bytes)
        return base64Url(bytes)
    }

    companion object {
        const val RANDOM_BYTES = 32

        /** `BASE64URL(SHA256(ASCII(code_verifier)))` */
        fun codeChallenge(verifier: String): String =
            base64Url(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))

        private fun base64Url(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }
}

/** Vergleich in konstanter Zeit (abhängig nur von der Länge), für `state`. */
fun constantTimeEquals(a: String, b: String): Boolean =
    MessageDigest.isEqual(a.toByteArray(Charsets.UTF_8), b.toByteArray(Charsets.UTF_8))
