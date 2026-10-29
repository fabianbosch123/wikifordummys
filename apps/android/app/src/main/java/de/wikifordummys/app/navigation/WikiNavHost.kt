package de.wikifordummys.app.navigation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.ViewModelProvider.AndroidViewModelFactory.Companion.APPLICATION_KEY
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import de.wikifordummys.app.WikiApplication
import de.wikifordummys.app.auth.ui.LoginRoute
import de.wikifordummys.app.home.ui.HomeRoute
import de.wikifordummys.app.server.ui.ServerSetupRoute
import kotlinx.serialization.Serializable

@Serializable
object ServerSetupDestination

@Serializable
data class LoginDestination(val baseUrl: String)

@Serializable
data class HomeDestination(val baseUrl: String)

private val AppStartViewModelFactory = viewModelFactory {
    initializer {
        val container = (this[APPLICATION_KEY] as WikiApplication).container
        AppStartViewModel(container.serverSettings, container.authRepository)
    }
}

private fun destinationFor(state: StartState): Any = when (state) {
    is StartState.LoggedIn -> HomeDestination(state.baseUrl)
    is StartState.NeedsLogin -> LoginDestination(state.baseUrl)
    StartState.NeedsServer, StartState.Loading -> ServerSetupDestination
}

/**
 * Start nach gespeicherter Adresse und Sitzung. Danach folgt die Navigation den Änderungen der Sitzung: Anmeldung
 * fertig → Startbildschirm; abgemeldet oder Zustimmung abgelaufen (invalid_grant) → Anmeldung.
 */
@Composable
fun WikiNavHost(
    navController: NavHostController = rememberNavController(),
    startViewModel: AppStartViewModel = viewModel(factory = AppStartViewModelFactory),
) {
    val startState by startViewModel.state.collectAsStateWithLifecycle()
    if (startState == StartState.Loading) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        return
    }
    val startDestination = remember { destinationFor(startState) }

    NavHost(navController = navController, startDestination = startDestination) {
        composable<ServerSetupDestination> {
            ServerSetupRoute(
                onSaved = { baseUrl ->
                    navController.navigate(LoginDestination(baseUrl)) {
                        popUpTo(navController.graph.id) { inclusive = true }
                    }
                },
            )
        }
        composable<LoginDestination> { entry ->
            LoginRoute(
                baseUrl = entry.toRoute<LoginDestination>().baseUrl,
                onChangeServer = {
                    navController.navigate(ServerSetupDestination) {
                        popUpTo(navController.graph.id) { inclusive = true }
                    }
                },
            )
        }
        composable<HomeDestination> { entry ->
            HomeRoute(baseUrl = entry.toRoute<HomeDestination>().baseUrl)
        }
    }

    LaunchedEffect(startState) {
        val current = navController.currentBackStackEntry?.destination
        val target: Any? = when (val state = startState) {
            is StartState.LoggedIn ->
                HomeDestination(state.baseUrl).takeIf { current?.hasRoute<HomeDestination>() != true }
            is StartState.NeedsLogin ->
                LoginDestination(state.baseUrl).takeIf { current?.hasRoute<HomeDestination>() == true }
            StartState.NeedsServer ->
                ServerSetupDestination.takeIf { current?.hasRoute<ServerSetupDestination>() != true }
            StartState.Loading -> null
        }
        target?.let {
            navController.navigate(it) { popUpTo(navController.graph.id) { inclusive = true } }
        }
    }
}
