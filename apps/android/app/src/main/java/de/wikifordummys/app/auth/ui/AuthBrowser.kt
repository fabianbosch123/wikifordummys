package de.wikifordummys.app.auth.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabsClient
import androidx.browser.customtabs.CustomTabsIntent

/**
 * Öffnet die Zustimmungsseite des Wikis im Browser des Systems: als Custom Tab, wenn ein Browser das kann, sonst über
 * ACTION_VIEW. Nie in einer WebView, damit die App das Passwort nicht zu sehen bekommt (RFC 8252).
 */
object AuthBrowser {
    /** `false`, wenn kein Browser die Adresse öffnen kann. */
    fun open(context: Context, url: String): Boolean {
        val uri = Uri.parse(url)
        return try {
            val customTabsPackage = CustomTabsClient.getPackageName(context, null)
            if (customTabsPackage != null) {
                val customTab = CustomTabsIntent.Builder()
                    .setShowTitle(true)
                    .setShareState(CustomTabsIntent.SHARE_STATE_OFF)
                    .build()
                customTab.intent.setPackage(customTabsPackage)
                customTab.launchUrl(context, uri)
            } else {
                context.startActivity(
                    Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE),
                )
            }
            true
        } catch (e: ActivityNotFoundException) {
            false
        }
    }
}
