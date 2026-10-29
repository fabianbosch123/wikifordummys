package de.wikifordummys.app

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.preferencesDataStore
import de.wikifordummys.app.auth.data.AuthRepository
import de.wikifordummys.app.auth.data.BearerTokenInterceptor
import de.wikifordummys.app.auth.data.EncryptedPendingLoginStore
import de.wikifordummys.app.auth.data.EncryptedSessionStore
import de.wikifordummys.app.auth.data.OAuthAuthRepository
import de.wikifordummys.app.auth.data.OAuthCallbackInbox
import de.wikifordummys.app.auth.data.OAuthTokenClient
import de.wikifordummys.app.auth.data.TokenAuthenticator
import de.wikifordummys.app.core.net.HttpClients
import de.wikifordummys.app.core.net.HttpClients.ensureSizeLimit
import de.wikifordummys.app.core.security.AesGcmTokenCipher
import de.wikifordummys.app.core.security.AndroidKeystoreKeyProvider
import de.wikifordummys.app.core.storage.DataStoreKeyValueStore
import de.wikifordummys.app.core.storage.EncryptedValueStore
import de.wikifordummys.app.server.data.DataStoreServerSettingsRepository
import de.wikifordummys.app.server.data.HealthServerChecker
import de.wikifordummys.app.server.data.ServerSettingsRepository
import de.wikifordummys.app.server.model.ServerChecker
import okhttp3.OkHttpClient

private val Context.settingsDataStore: DataStore<Preferences> by preferencesDataStore(name = "settings")

/** Nur verschlüsselte Werte (EncryptedValueStore); eigene Datei, getrennt von den Einstellungen. */
private val Context.authDataStore: DataStore<Preferences> by preferencesDataStore(name = "auth")

/** Manuelle Abhängigkeitsinjektion; Hilt lohnt sich erst mit mehr Funktionen. */
class AppContainer(context: Context) {
    private val appContext = context.applicationContext

    /** Gemeinsamer Client ohne Zugangsdaten, ohne Logging, mit Größengrenze für jede Antwort (HttpClients.base). */
    val okHttpClient: OkHttpClient by lazy { HttpClients.base() }

    val serverSettings: ServerSettingsRepository by lazy {
        DataStoreServerSettingsRepository(appContext.settingsDataStore)
    }

    val serverChecker: ServerChecker by lazy { HealthServerChecker(okHttpClient) }

    val oauthCallbackInbox = OAuthCallbackInbox()

    private val authRepositoryImpl: OAuthAuthRepository by lazy {
        val values = EncryptedValueStore(
            raw = DataStoreKeyValueStore(appContext.authDataStore),
            cipher = AesGcmTokenCipher(AndroidKeystoreKeyProvider()),
        )
        OAuthAuthRepository(
            tokenClient = OAuthTokenClient(okHttpClient),
            sessionStore = EncryptedSessionStore(values),
            pendingStore = EncryptedPendingLoginStore(values),
        )
    }

    val authRepository: AuthRepository get() = authRepositoryImpl

    /** Für die REST-API: Bearer nur an das angemeldete Wiki, Erneuerung bei 401, keine Weiterleitungen. */
    val authenticatedClient: OkHttpClient by lazy {
        okHttpClient.newBuilder()
            .followRedirects(false)
            .followSslRedirects(false)
            .ensureSizeLimit()
            .addInterceptor(BearerTokenInterceptor(authRepositoryImpl))
            .authenticator(TokenAuthenticator(authRepositoryImpl))
            .build()
    }
}
