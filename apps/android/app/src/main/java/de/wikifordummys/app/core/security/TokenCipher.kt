package de.wikifordummys.app.core.security

import java.security.GeneralSecurityException
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Verschlüsselt kleine Geheimnisse (Tokens, PKCE-Verifier). [associatedData] bindet den Geheimtext an seinen Zweck. */
interface TokenCipher {
    @Throws(GeneralSecurityException::class)
    fun encrypt(plaintext: ByteArray, associatedData: ByteArray): ByteArray

    @Throws(GeneralSecurityException::class)
    fun decrypt(ciphertext: ByteArray, associatedData: ByteArray): ByteArray
}

/**
 * AES-256-GCM. Den Schlüssel liefert [keyProvider]; in der App ist das ein Schlüssel aus dem Android Keystore, der das
 * Gerät nie verlässt ([AndroidKeystoreKeyProvider]), im Test ein Software-Schlüssel. Den IV erzeugt der Provider bei
 * jeder Verschlüsselung neu (der Keystore lässt keinen eigenen IV zu).
 *
 * Format: Version (1 Byte) | IV (12 Byte) | Geheimtext mit Tag (128 Bit).
 */
class AesGcmTokenCipher(private val keyProvider: () -> SecretKey) : TokenCipher {

    override fun encrypt(plaintext: ByteArray, associatedData: ByteArray): ByteArray {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, keyProvider())
        cipher.updateAAD(associatedData)
        val sealed = cipher.doFinal(plaintext)
        val iv = cipher.iv
        if (iv == null || iv.size != IV_BYTES) throw GeneralSecurityException("Unerwartete IV-Länge")
        return byteArrayOf(VERSION) + iv + sealed
    }

    override fun decrypt(ciphertext: ByteArray, associatedData: ByteArray): ByteArray {
        if (ciphertext.size < 1 + IV_BYTES + TAG_BITS / 8 || ciphertext[0] != VERSION) {
            throw GeneralSecurityException("Unbekanntes Format")
        }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(
            Cipher.DECRYPT_MODE,
            keyProvider(),
            GCMParameterSpec(TAG_BITS, ciphertext, 1, IV_BYTES),
        )
        cipher.updateAAD(associatedData)
        return cipher.doFinal(ciphertext, 1 + IV_BYTES, ciphertext.size - 1 - IV_BYTES)
    }

    private companion object {
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val VERSION: Byte = 1
        const val IV_BYTES = 12
        const val TAG_BITS = 128
    }
}
