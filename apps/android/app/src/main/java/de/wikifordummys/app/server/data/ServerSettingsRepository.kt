package de.wikifordummys.app.server.data

import kotlinx.coroutines.flow.Flow

/** Speichert die Basis-Adresse des Wikis. Die Adresse ist kein Geheimnis; Tokens gehören nicht hierher. */
interface ServerSettingsRepository {
    /** Gespeicherte Basis-Adresse oder `null`. */
    val serverUrl: Flow<String?>

    /** Speichert eine bereits normalisierte Adresse aus [de.wikifordummys.app.server.model.WikiUrlValidator]. */
    suspend fun saveServerUrl(baseUrl: String)
}
