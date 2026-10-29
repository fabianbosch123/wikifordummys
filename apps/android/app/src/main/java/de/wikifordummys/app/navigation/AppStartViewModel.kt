package de.wikifordummys.app.navigation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import de.wikifordummys.app.auth.data.AuthRepository
import de.wikifordummys.app.auth.model.SessionInfo
import de.wikifordummys.app.server.data.ServerSettingsRepository
import java.io.IOException
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn

/** Wohin die App gehört: nach gespeicherter Adresse und gespeicherter Sitzung. */
sealed interface StartState {
    data object Loading : StartState
    data object NeedsServer : StartState
    data class NeedsLogin(val baseUrl: String) : StartState
    data class LoggedIn(val baseUrl: String) : StartState

    companion object {
        /** Eine Sitzung zählt nur für das Wiki, dessen Adresse gerade gespeichert ist. */
        fun of(serverUrl: String?, session: SessionInfo?): StartState = when {
            serverUrl == null -> NeedsServer
            session != null && session.baseUrl == serverUrl -> LoggedIn(serverUrl)
            else -> NeedsLogin(serverUrl)
        }
    }
}

class AppStartViewModel(
    settings: ServerSettingsRepository,
    auth: AuthRepository,
) : ViewModel() {
    val state: StateFlow<StartState> = combine(settings.serverUrl, auth.session, StartState::of)
        .catch { e -> if (e is IOException) emit(StartState.NeedsServer) else throw e }
        .stateIn(viewModelScope, SharingStarted.Eagerly, StartState.Loading)
}
