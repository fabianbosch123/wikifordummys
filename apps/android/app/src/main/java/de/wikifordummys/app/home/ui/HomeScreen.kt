package de.wikifordummys.app.home.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModelProvider.AndroidViewModelFactory.Companion.APPLICATION_KEY
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import de.wikifordummys.app.R
import de.wikifordummys.app.WikiApplication
import de.wikifordummys.app.home.data.ApiHomeRepository
import de.wikifordummys.app.home.model.Space
import de.wikifordummys.app.ui.theme.WikiTheme

private fun homeViewModelFactory(baseUrl: String) = viewModelFactory {
    initializer {
        val container = (this[APPLICATION_KEY] as WikiApplication).container
        HomeViewModel(ApiHomeRepository(baseUrl, container.authenticatedClient), container.authRepository)
    }
}

@Composable
fun HomeRoute(
    baseUrl: String,
    viewModel: HomeViewModel = viewModel(key = "home:$baseUrl", factory = homeViewModelFactory(baseUrl)),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    HomeScreen(state = state, onRetry = viewModel::onRetry, onLogout = viewModel::onLogout)
}

@Composable
fun HomeScreen(
    state: HomeUiState,
    onRetry: () -> Unit,
    onLogout: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Scaffold(modifier = modifier.fillMaxSize()) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .padding(horizontal = 16.dp, vertical = 16.dp)
                .fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Text(
                    text = state.displayName?.let { stringResource(R.string.home_signed_in_as, it) }
                        ?: stringResource(R.string.home_signed_in),
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                TextButton(
                    onClick = onLogout,
                    enabled = !state.isLoggingOut,
                    modifier = Modifier.heightIn(min = 48.dp),
                ) {
                    Text(stringResource(R.string.home_logout))
                }
            }
            Text(
                text = stringResource(R.string.home_spaces_title),
                style = MaterialTheme.typography.headlineMedium,
                modifier = Modifier.semantics { heading() },
            )
            when (val spaces = state.spaces) {
                SpacesState.Loading -> Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
                SpacesState.Empty -> Text(
                    text = stringResource(R.string.home_spaces_empty),
                    style = MaterialTheme.typography.bodyLarge,
                )
                is SpacesState.Error -> Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        text = errorMessage(spaces.error),
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodyLarge,
                        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                    )
                    Button(onClick = onRetry, modifier = Modifier.heightIn(min = 48.dp)) {
                        Text(stringResource(R.string.home_retry))
                    }
                }
                is SpacesState.Loaded -> LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    items(spaces.spaces, key = { it.id }) { space -> SpaceCard(space) }
                }
            }
        }
    }
}

@Composable
private fun SpaceCard(space: Space) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(text = space.name, style = MaterialTheme.typography.titleMedium)
            Text(
                text = if (space.status == "archived") {
                    stringResource(R.string.home_space_key_archived, space.key)
                } else {
                    space.key
                },
                style = MaterialTheme.typography.labelMedium,
            )
            if (space.description.isNotBlank()) {
                Text(
                    text = space.description,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun errorMessage(error: HomeError): String = stringResource(
    when (error) {
        HomeError.Unauthorized -> R.string.home_error_unauthorized
        HomeError.Forbidden -> R.string.home_error_forbidden
        HomeError.RateLimited -> R.string.error_server_rate_limited
        HomeError.Network -> R.string.error_server_unreachable
        HomeError.Tls -> R.string.error_server_tls
        HomeError.Server -> R.string.home_error_server
        HomeError.InvalidResponse -> R.string.home_error_invalid_response
    },
)

@Preview(showBackground = true)
@Composable
private fun HomeScreenPreview() {
    WikiTheme(dynamicColor = false) {
        HomeScreen(
            state = HomeUiState(
                displayName = "Anna",
                spaces = SpacesState.Loaded(
                    listOf(
                        Space(id = "1", key = "IT", name = "IT-Team", description = "Server und Netz", status = "active", role = "admin"),
                    ),
                ),
            ),
            onRetry = {},
            onLogout = {},
        )
    }
}
