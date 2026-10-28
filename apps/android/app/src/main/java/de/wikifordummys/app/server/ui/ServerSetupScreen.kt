package de.wikifordummys.app.server.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModelProvider.AndroidViewModelFactory.Companion.APPLICATION_KEY
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import de.wikifordummys.app.R
import de.wikifordummys.app.WikiApplication
import de.wikifordummys.app.server.model.UrlError
import de.wikifordummys.app.ui.theme.WikiTheme

private val ServerSetupViewModelFactory = viewModelFactory {
    initializer {
        val container = (this[APPLICATION_KEY] as WikiApplication).container
        ServerSetupViewModel(container.serverSettings, container.serverChecker)
    }
}

@Composable
fun ServerSetupRoute(
    onSaved: (baseUrl: String) -> Unit,
    viewModel: ServerSetupViewModel = viewModel(factory = ServerSetupViewModelFactory),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    LaunchedEffect(state.savedBaseUrl) {
        state.savedBaseUrl?.let { url ->
            viewModel.onNavigated()
            onSaved(url)
        }
    }

    ServerSetupScreen(
        state = state,
        onInputChange = viewModel::onInputChange,
        onSubmit = viewModel::onSubmit,
    )
}

@Composable
fun ServerSetupScreen(
    state: ServerSetupUiState,
    onInputChange: (String) -> Unit,
    onSubmit: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Scaffold(modifier = modifier.fillMaxSize()) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 24.dp)
                .fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                text = stringResource(R.string.server_setup_title),
                style = MaterialTheme.typography.headlineMedium,
                modifier = Modifier.semantics { heading() },
            )
            Text(
                text = stringResource(R.string.server_setup_intro),
                style = MaterialTheme.typography.bodyLarge,
            )

            val errorText = state.error?.let { errorMessage(it) }
            OutlinedTextField(
                value = state.input,
                onValueChange = onInputChange,
                modifier = Modifier.fillMaxWidth(),
                enabled = state.canSubmit,
                label = { Text(stringResource(R.string.server_setup_field_label)) },
                placeholder = { Text(stringResource(R.string.server_setup_field_placeholder)) },
                singleLine = true,
                isError = errorText != null,
                supportingText = errorText?.let { message ->
                    {
                        Text(
                            text = message,
                            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                        )
                    }
                },
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.None,
                    autoCorrectEnabled = false,
                    keyboardType = KeyboardType.Uri,
                    imeAction = ImeAction.Go,
                ),
                keyboardActions = KeyboardActions(onGo = { onSubmit() }),
            )

            Button(
                onClick = onSubmit,
                enabled = state.canSubmit,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp),
            ) {
                if (state.isChecking) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            strokeWidth = 2.dp,
                        )
                        Spacer(Modifier.width(12.dp))
                        Text(stringResource(R.string.server_setup_checking))
                    }
                } else {
                    Text(stringResource(R.string.server_setup_submit))
                }
            }
        }
    }
}

@Composable
private fun errorMessage(error: ServerSetupError): String = when (error) {
    is ServerSetupError.Input -> stringResource(
        when (error.reason) {
            UrlError.Empty -> R.string.error_url_empty
            UrlError.TooLong -> R.string.error_url_too_long
            UrlError.Malformed -> R.string.error_url_malformed
            UrlError.NotHttps -> R.string.error_url_not_https
            UrlError.Credentials -> R.string.error_url_credentials
            UrlError.HasPath -> R.string.error_url_path
        },
    )
    ServerSetupError.Unreachable -> stringResource(R.string.error_server_unreachable)
    ServerSetupError.Tls -> stringResource(R.string.error_server_tls)
    ServerSetupError.NotAWiki -> stringResource(R.string.error_server_not_wiki)
    ServerSetupError.Unhealthy -> stringResource(R.string.error_server_unhealthy)
    ServerSetupError.RateLimited -> stringResource(R.string.error_server_rate_limited)
    is ServerSetupError.Http -> stringResource(R.string.error_server_http, error.code)
    ServerSetupError.SaveFailed -> stringResource(R.string.error_save_failed)
}

@Preview(showBackground = true)
@Composable
private fun ServerSetupScreenPreview() {
    WikiTheme(dynamicColor = false) {
        ServerSetupScreen(
            state = ServerSetupUiState(
                input = "http://wiki.example.de",
                isLoading = false,
                error = ServerSetupError.Input(UrlError.NotHttps),
            ),
            onInputChange = {},
            onSubmit = {},
        )
    }
}
