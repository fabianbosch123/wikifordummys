package de.wikifordummys.app.server.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import de.wikifordummys.app.server.data.ServerSettingsRepository
import de.wikifordummys.app.server.model.ServerCheckResult
import de.wikifordummys.app.server.model.ServerChecker
import de.wikifordummys.app.server.model.UrlError
import de.wikifordummys.app.server.model.UrlValidation
import de.wikifordummys.app.server.model.WikiUrlValidator
import java.io.IOException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ServerSetupUiState(
    val input: String = "",
    /** Die gespeicherte Adresse wird noch geladen. */
    val isLoading: Boolean = true,
    /** Die Adresse wird gerade am Server geprüft. */
    val isChecking: Boolean = false,
    val error: ServerSetupError? = null,
    /** Gesetzt, sobald eine geprüfte Adresse gespeichert ist; die Oberfläche navigiert dann weiter. */
    val savedBaseUrl: String? = null,
) {
    val canSubmit: Boolean get() = !isLoading && !isChecking
}

sealed interface ServerSetupError {
    data class Input(val reason: UrlError) : ServerSetupError
    data object Unreachable : ServerSetupError
    data object Tls : ServerSetupError
    data object NotAWiki : ServerSetupError
    data object Unhealthy : ServerSetupError
    data object RateLimited : ServerSetupError
    data class Http(val code: Int) : ServerSetupError
    data object SaveFailed : ServerSetupError
}

class ServerSetupViewModel(
    private val settings: ServerSettingsRepository,
    private val checker: ServerChecker,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ServerSetupUiState())
    val uiState: StateFlow<ServerSetupUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            val stored = try {
                settings.serverUrl.first()
            } catch (e: IOException) {
                null
            }
            _uiState.update { state ->
                state.copy(input = state.input.ifEmpty { stored.orEmpty() }, isLoading = false)
            }
        }
    }

    fun onInputChange(value: String) {
        _uiState.update { it.copy(input = value, error = null) }
    }

    fun onSubmit() {
        val state = _uiState.value
        if (!state.canSubmit) return
        when (val validation = WikiUrlValidator.validate(state.input)) {
            is UrlValidation.Invalid ->
                _uiState.update { it.copy(error = ServerSetupError.Input(validation.error)) }
            is UrlValidation.Valid -> {
                _uiState.update { it.copy(input = validation.baseUrl, isChecking = true, error = null) }
                viewModelScope.launch { checkAndSave(validation.baseUrl) }
            }
        }
    }

    /** Die Oberfläche hat nach dem Speichern navigiert. */
    fun onNavigated() {
        _uiState.update { it.copy(savedBaseUrl = null) }
    }

    private suspend fun checkAndSave(baseUrl: String) {
        val error = when (val result = checker.check(baseUrl)) {
            ServerCheckResult.Ok -> null
            ServerCheckResult.Unhealthy -> ServerSetupError.Unhealthy
            ServerCheckResult.NotAWiki -> ServerSetupError.NotAWiki
            ServerCheckResult.RateLimited -> ServerSetupError.RateLimited
            ServerCheckResult.TlsError -> ServerSetupError.Tls
            ServerCheckResult.Unreachable -> ServerSetupError.Unreachable
            is ServerCheckResult.HttpError -> ServerSetupError.Http(result.code)
        }
        if (error != null) {
            _uiState.update { it.copy(isChecking = false, error = error) }
            return
        }
        try {
            settings.saveServerUrl(baseUrl)
        } catch (e: IOException) {
            _uiState.update { it.copy(isChecking = false, error = ServerSetupError.SaveFailed) }
            return
        }
        _uiState.update { it.copy(isChecking = false, savedBaseUrl = baseUrl) }
    }
}
