package de.wikifordummys.app.auth.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModelProvider.AndroidViewModelFactory.Companion.APPLICATION_KEY
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import de.wikifordummys.app.R
import de.wikifordummys.app.WikiApplication
import de.wikifordummys.app.ui.theme.WikiTheme

private fun loginViewModelFactory(baseUrl: String) = viewModelFactory {
    initializer {
        val container = (this[APPLICATION_KEY] as WikiApplication).container
        LoginViewModel(baseUrl, container.authRepository, container.oauthCallbackInbox)
    }
}

@Composable
fun LoginRoute(
    baseUrl: String,
    onChangeServer: () -> Unit,
    viewModel: LoginViewModel = viewModel(key = "login:$baseUrl", factory = loginViewModelFactory(baseUrl)),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current

    LaunchedEffect(state.browserUrl) {
        state.browserUrl?.let { url ->
            if (AuthBrowser.open(context, url)) viewModel.onBrowserOpened() else viewModel.onBrowserUnavailable()
        }
    }

    LoginScreen(state = state, onLogin = viewModel::onLoginClick, onChangeServer = onChangeServer)
}

@Composable
fun LoginScreen(
    state: LoginUiState,
    onLogin: () -> Unit,
    onChangeServer: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Scaffold(modifier = modifier.fillMaxSize()) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 24.dp)
                .fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                text = stringResource(R.string.login_title),
                style = MaterialTheme.typography.headlineMedium,
                modifier = Modifier.semantics { heading() },
            )
            Text(
                text = stringResource(R.string.login_intro, state.baseUrl),
                style = MaterialTheme.typography.bodyLarge,
            )

            if (state.phase == LoginPhase.WaitingForBrowser) {
                Text(
                    text = stringResource(R.string.login_waiting),
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
            }

            state.error?.let { error ->
                Text(
                    text = errorMessage(error),
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
            }

            Button(
                onClick = onLogin,
                enabled = state.canStart,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp),
            ) {
                val busy = state.phase == LoginPhase.Preparing ||
                    state.phase == LoginPhase.Exchanging ||
                    state.phase == LoginPhase.Done
                if (busy) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(12.dp))
                        Text(stringResource(R.string.login_in_progress))
                    }
                } else if (state.phase == LoginPhase.WaitingForBrowser) {
                    Text(stringResource(R.string.login_reopen))
                } else {
                    Text(stringResource(R.string.login_submit))
                }
            }

            OutlinedButton(
                onClick = onChangeServer,
                enabled = state.phase != LoginPhase.Exchanging && state.phase != LoginPhase.Done,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp),
            ) {
                Text(stringResource(R.string.login_change_server))
            }
        }
    }
}

@Composable
private fun errorMessage(error: LoginError): String = stringResource(
    when (error) {
        LoginError.NoBrowser -> R.string.login_error_no_browser
        LoginError.StorageFailed -> R.string.login_error_storage
        LoginError.AccessDenied -> R.string.login_error_denied
        LoginError.IssuerMismatch -> R.string.login_error_issuer
        LoginError.AuthorizationFailed -> R.string.login_error_failed
        LoginError.InvalidGrant -> R.string.login_error_invalid_grant
        LoginError.RateLimited -> R.string.error_server_rate_limited
        LoginError.Network -> R.string.error_server_unreachable
        LoginError.Tls -> R.string.error_server_tls
        LoginError.Server -> R.string.login_error_server
        LoginError.InvalidResponse -> R.string.login_error_invalid_response
    },
)

@Preview(showBackground = true)
@Composable
private fun LoginScreenPreview() {
    WikiTheme(dynamicColor = false) {
        LoginScreen(
            state = LoginUiState(baseUrl = "https://wiki.example.de", error = LoginError.AccessDenied),
            onLogin = {},
            onChangeServer = {},
        )
    }
}
