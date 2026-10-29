package de.wikifordummys.app.auth.data

import de.wikifordummys.app.auth.model.OAuthCallback
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Übergabe des Rücksprungs von der OAuthCallbackActivity an den Login-Ablauf. Hält höchstens einen Rücksprung; wer
 * ihn verarbeitet, nimmt ihn mit [consume] heraus. Geprüft wird er erst in [AuthRepository.completeLogin].
 */
class OAuthCallbackInbox {
    private val _pending = MutableStateFlow<String?>(null)
    val pending: StateFlow<String?> = _pending.asStateFlow()

    fun deliver(rawUri: String) {
        if (rawUri.length <= OAuthCallback.MAX_LENGTH) _pending.value = rawUri
    }

    /** `true`, wenn [rawUri] noch da war und jetzt dem Aufrufer gehört. */
    fun consume(rawUri: String): Boolean = _pending.compareAndSet(rawUri, null)
}
