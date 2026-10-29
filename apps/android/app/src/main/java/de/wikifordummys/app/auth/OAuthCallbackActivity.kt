package de.wikifordummys.app.auth

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import de.wikifordummys.app.MainActivity
import de.wikifordummys.app.WikiApplication

/**
 * Nimmt den Rücksprung `de.wikifordummys.app:/oauth/callback?…` aus dem Browser an, reicht ihn ungeprüft an den
 * Login-Ablauf weiter (geprüft wird dort: state, iss, error, laufende Anmeldung) und holt die App nach vorn. Hat keine
 * Oberfläche und bleibt nicht im Verlauf. Exportiert, weil der Browser sie aufrufen muss; die Daten gehen nicht an
 * MainActivity, sondern nur an die OAuthCallbackInbox.
 */
class OAuthCallbackActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        forward(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        forward(intent)
    }

    private fun forward(intent: Intent?) {
        val data = intent?.takeIf { it.action == Intent.ACTION_VIEW }?.dataString
        if (data != null) (application as WikiApplication).container.oauthCallbackInbox.deliver(data)
        startActivity(
            Intent(this, MainActivity::class.java).addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP,
            ),
        )
        finish()
    }
}
