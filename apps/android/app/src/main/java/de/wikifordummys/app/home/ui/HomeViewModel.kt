package de.wikifordummys.app.home.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import de.wikifordummys.app.auth.data.AuthRepository
import de.wikifordummys.app.core.api.ApiResult
import de.wikifordummys.app.home.data.HomeRepository
import de.wikifordummys.app.home.model.Space
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class HomeError {
    /** 401 auch nach Erneuerung (z. B. kein Netz für die Erneuerung). Ist die Zustimmung weg, navigiert die App selbst. */
    Unauthorized,
    Forbidden,
    RateLimited,
    Network,
    Tls,
    Server,
    InvalidResponse,
}

sealed interface SpacesState {
    data object Loading : SpacesState
    data object Empty : SpacesState
    data class Loaded(val spaces: List<Space>) : SpacesState
    data class Error(val error: HomeError) : SpacesState
}

data class HomeUiState(
    val displayName: String? = null,
    val spaces: SpacesState = SpacesState.Loading,
    val isLoggingOut: Boolean = false,
)

class HomeViewModel(
    private val repository: HomeRepository,
    private val auth: AuthRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(HomeUiState())
    val uiState: StateFlow<HomeUiState> = _uiState.asStateFlow()

    init {
        load()
    }

    fun onRetry() {
        if (_uiState.value.spaces is SpacesState.Loading) return
        load()
    }

    /** Nach dem Abmelden ist die Sitzung leer; die Navigation wechselt dann zur Anmeldung. */
    fun onLogout() {
        if (_uiState.value.isLoggingOut) return
        _uiState.update { it.copy(isLoggingOut = true) }
        viewModelScope.launch { auth.logout() }
    }

    private fun load() {
        _uiState.update { it.copy(spaces = SpacesState.Loading) }
        viewModelScope.launch {
            val me = async { repository.me() }
            val spaces = async { repository.spaces() }
            val name = (me.await() as? ApiResult.Success)?.value?.displayName
            val spacesState = when (val result = spaces.await()) {
                is ApiResult.Success ->
                    if (result.value.isEmpty()) SpacesState.Empty else SpacesState.Loaded(result.value)
                else -> SpacesState.Error(result.toHomeError())
            }
            _uiState.update { it.copy(displayName = name ?: it.displayName, spaces = spacesState) }
        }
    }

    private fun ApiResult<*>.toHomeError(): HomeError = when (this) {
        ApiResult.Unauthorized -> HomeError.Unauthorized
        ApiResult.Forbidden, ApiResult.NotFound -> HomeError.Forbidden
        ApiResult.RateLimited -> HomeError.RateLimited
        ApiResult.Network -> HomeError.Network
        ApiResult.Tls -> HomeError.Tls
        is ApiResult.ServerError, is ApiResult.HttpError -> HomeError.Server
        ApiResult.InvalidResponse, is ApiResult.Success -> HomeError.InvalidResponse
    }
}
