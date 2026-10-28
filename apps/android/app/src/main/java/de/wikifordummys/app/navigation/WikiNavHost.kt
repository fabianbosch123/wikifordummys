package de.wikifordummys.app.navigation

import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import de.wikifordummys.app.home.ui.HomeScreen
import de.wikifordummys.app.server.ui.ServerSetupRoute
import kotlinx.serialization.Serializable

@Serializable
object ServerSetupDestination

@Serializable
data class HomeDestination(val baseUrl: String)

@Composable
fun WikiNavHost(navController: NavHostController = rememberNavController()) {
    NavHost(navController = navController, startDestination = ServerSetupDestination) {
        composable<ServerSetupDestination> {
            ServerSetupRoute(
                onSaved = { baseUrl ->
                    navController.navigate(HomeDestination(baseUrl)) {
                        popUpTo<ServerSetupDestination> { inclusive = true }
                    }
                },
            )
        }
        composable<HomeDestination> { entry ->
            val destination = entry.toRoute<HomeDestination>()
            HomeScreen(
                baseUrl = destination.baseUrl,
                onChangeServer = {
                    navController.navigate(ServerSetupDestination) {
                        popUpTo<HomeDestination> { inclusive = true }
                    }
                },
            )
        }
    }
}
