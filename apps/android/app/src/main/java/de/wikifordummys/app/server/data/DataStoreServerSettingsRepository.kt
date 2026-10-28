package de.wikifordummys.app.server.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.stringPreferencesKey
import de.wikifordummys.app.server.model.UrlValidation
import de.wikifordummys.app.server.model.WikiUrlValidator
import java.io.IOException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map

/** Preferences-DataStore im App-Verzeichnis; vom Backup ausgeschlossen (siehe res/xml). */
class DataStoreServerSettingsRepository(
    private val dataStore: DataStore<Preferences>,
) : ServerSettingsRepository {

    override val serverUrl: Flow<String?> = dataStore.data
        .catch { e -> if (e is IOException) emit(emptyPreferences()) else throw e }
        .map { prefs ->
            // Nur gültige Adressen herausgeben, falls die Datei beschädigt oder verändert wurde.
            prefs[KEY_SERVER_URL]?.let { stored ->
                (WikiUrlValidator.validate(stored) as? UrlValidation.Valid)?.baseUrl
            }
        }

    override suspend fun saveServerUrl(baseUrl: String) {
        val valid = WikiUrlValidator.validate(baseUrl)
        require(valid is UrlValidation.Valid && valid.baseUrl == baseUrl) { "Adresse ist nicht normalisiert." }
        dataStore.edit { it[KEY_SERVER_URL] = baseUrl }
    }

    private companion object {
        val KEY_SERVER_URL = stringPreferencesKey("server_url")
    }
}
