package de.wikifordummys.app.auth.model

import java.net.URLDecoder

/** Parameter eines Rücksprungs auf [AppOAuth.REDIRECT_URI]. */
data class OAuthCallback(
    val state: String?,
    val issuer: String?,
    val code: String?,
    val error: String?,
) {
    override fun toString(): String = "OAuthCallback(issuer=$issuer, error=$error, hasCode=${code != null})"

    companion object {
        const val MAX_LENGTH = 8 * 1024
        private val KNOWN = setOf("state", "iss", "code", "error", "error_description", "error_uri")

        /**
         * Liest einen Rücksprung. Nur genau `de.wikifordummys.app:/oauth/callback?…` ohne Anker; jeder bekannte
         * Parameter höchstens einmal (sonst ließe sich z. B. ein zweites `iss` unterschieben). `null` heißt: verwerfen.
         */
        fun parse(raw: String): OAuthCallback? {
            if (raw.length > MAX_LENGTH || '#' in raw) return null
            val prefix = AppOAuth.REDIRECT_URI + "?"
            if (!raw.startsWith(prefix)) return null
            val params = HashMap<String, String>()
            for (part in raw.substring(prefix.length).split('&')) {
                if (part.isEmpty()) continue
                val name = decode(part.substringBefore('=')) ?: return null
                val value = decode(part.substringAfter('=', "")) ?: return null
                if (name in KNOWN && params.put(name, value) != null) return null
            }
            return OAuthCallback(
                state = params["state"],
                issuer = params["iss"],
                code = params["code"]?.takeIf { it.isNotEmpty() },
                error = params["error"]?.takeIf { it.isNotEmpty() },
            )
        }

        private fun decode(value: String): String? = try {
            URLDecoder.decode(value, Charsets.UTF_8.name())
        } catch (e: IllegalArgumentException) {
            null
        }
    }
}
