package de.wikifordummys.app

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.preferencesDataStore
import de.wikifordummys.app.server.data.DataStoreServerSettingsRepository
import de.wikifordummys.app.server.data.HealthServerChecker
import de.wikifordummys.app.server.data.ServerSettingsRepository
import de.wikifordummys.app.server.model.ServerChecker
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient

private val Context.settingsDataStore: DataStore<Preferences> by preferencesDataStore(name = "settings")

/** Manuelle Abhängigkeitsinjektion; Hilt lohnt sich erst mit mehr Funktionen. */
class AppContainer(context: Context) {
    private val appContext = context.applicationContext

    /** Gemeinsamer Client; bewusst ohne Logging-Interceptor, damit später keine Tokens in Logs landen. */
    val okHttpClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .callTimeout(20, TimeUnit.SECONDS)
            .build()
    }

    val serverSettings: ServerSettingsRepository by lazy {
        DataStoreServerSettingsRepository(appContext.settingsDataStore)
    }

    val serverChecker: ServerChecker by lazy { HealthServerChecker(okHttpClient) }
}
