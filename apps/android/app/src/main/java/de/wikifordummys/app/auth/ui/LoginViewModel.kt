package de.wikifordummys.app.auth.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import de.wikifordummys.app.auth.data.AuthRepository
import de.wikifordummys.app.auth.data.OAuthCallbackInbox
import de.wikifordummys.app.auth.model.LoginResult
import java.io.IOException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class LoginPhase {
    Idle,

    /** Verifier und state werden erzeugt und gespeichert. */
    Preparing,

    /** Browser ist offen; die App wartet auf den Rücksprung. */
    WaitingForBrowser,

    /** Rücksprung ist da, der Code wird gegen Tokens getauscht. */
    Exchanging,

    /** Angemeldet; die Navigation wechselt zum Startbildschirm. */
    Done,
}

enum class LoginError {
    NoBrowser,
    StorageFailed,
    AccessDenied,
    IssuerMismatch,
    AuthorizationFailed,
    InvalidGrant,
    RateLimited,
    Network,
    Tls,
    Server,
    InvalidResponse,
}

data class LoginUiState(
    val baseUrl: String,
    val phase: LoginPhase = LoginPhase.Idle,
    val error: LoginError? = null,
    /** Diese Adresse soll die Oberfläche im Browser öffnen; danach [LoginViewModel.onBrowserOpened]. */
    val browserUrl: String? = null,
) {
    val canStart: Boolean get() = phase == LoginPhase.Idle || phase == LoginPhase.WaitingForBrowser
}

class LoginViewModel(
    private val baseUrl: String,
    private val auth: AuthRepository,
    private val inbox: OAuthCallbackInbox,
) : ViewModel() {

    private val _uiState = MutableStateFlow(LoginUiState(baseUrl = baseUrl))
    val uiState: StateFlow<LoginUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            inbox.pending.filterNotNull().collect { raw ->
                if (inbox.consume(raw)) handleCallback(raw)
            }
        }
    }

    /** Startet (oder wiederholt) die Anmeldung im Browser. */
    fun onLoginClick() {
        if (!_uiState.value.canStart) return
        _uiState.update { it.copy(phase = LoginPhase.Preparing, error = null) }
        viewModelScope.launch {
            val url = try {
                auth.beginLogin(baseUrl)
            } catch (e: IOException) {
                _uiState.update { it.copy(phase = LoginPhase.Idle, error = LoginError.StorageFailed) }
                return@launch
            }
            _uiState.update { it.copy(phase = LoginPhase.WaitingForBrowser, browserUrl = url) }
        }
    }

    fun onBrowserOpened() {
        _uiState.update { it.copy(browserUrl = null) }
    }

    fun onBrowserUnavailable() {
        _uiState.update { it.copy(browserUrl = null, phase = LoginPhase.Idle, error = LoginError.NoBrowser) }
    }

    private suspend fun handleCallback(raw: String) {
        val before = _uiState.value
        if (before.phase == LoginPhase.Exchanging || before.phase == LoginPhase.Done) return
        _uiState.update { it.copy(phase = LoginPhase.Exchanging, error = null) }
        val error = when (val result = auth.completeLogin(baseUrl, raw)) {
            LoginResult.Success -> {
                _uiState.update { it.copy(phase = LoginPhase.Done) }
                return
            }
            // Gehört zu keiner (laufenden) Anmeldung: still verwerfen, Zustand wie vorher.
            LoginResult.NoPendingLogin, LoginResult.Rejected -> {
                _uiState.update { it.copy(phase = before.phase, error = before.error) }
                return
            }
            LoginResult.AccessDenied -> LoginError.AccessDenied
            LoginResult.IssuerMismatch -> LoginError.IssuerMismatch
            LoginResult.AuthorizationFailed -> LoginError.AuthorizationFailed
            LoginResult.InvalidGrant -> LoginError.InvalidGrant
            LoginResult.RateLimited -> LoginError.RateLimited
            LoginResult.Network -> LoginError.Network
            LoginResult.Tls -> LoginError.Tls
            is LoginResult.Http -> LoginError.Server
            LoginResult.InvalidResponse -> LoginError.InvalidResponse
            LoginResult.StorageFailed -> LoginError.StorageFailed
        }
        _uiState.update { it.copy(phase = LoginPhase.Idle, error = error) }
    }
}
