package de.wikifordummys.app.core.security

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/**
 * AES-256-Schlüssel im Android Keystore. Er wird beim ersten Gebrauch erzeugt, ist nicht exportierbar und verlangt
 * zufällige IVs. Ohne Benutzer-Authentisierung, weil die App Tokens auch im Hintergrund erneuert. Geht der Schlüssel
 * verloren (z. B. nach Zurücksetzen der Sperre auf manchen Geräten), lassen sich die Daten nicht mehr entschlüsseln
 * und der Benutzer meldet sich neu an.
 */
class AndroidKeystoreKeyProvider(private val alias: String = DEFAULT_ALIAS) : () -> SecretKey {
    @Volatile
    private var cached: SecretKey? = null

    @Synchronized
    override fun invoke(): SecretKey {
        cached?.let { return it }
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        val key = (keyStore.getKey(alias, null) as? SecretKey) ?: generate()
        cached = key
        return key
    }

    private fun generate(): SecretKey {
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build(),
        )
        return generator.generateKey()
    }

    private companion object {
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val DEFAULT_ALIAS = "wikifordummys_auth_v1"
    }
}
