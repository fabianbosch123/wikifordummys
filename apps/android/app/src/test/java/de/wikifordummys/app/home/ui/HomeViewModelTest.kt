package de.wikifordummys.app.home.ui

import de.wikifordummys.app.auth.model.SessionInfo
import de.wikifordummys.app.core.api.ApiResult
import de.wikifordummys.app.home.data.HomeRepository
import de.wikifordummys.app.home.model.Me
import de.wikifordummys.app.home.model.Space
import de.wikifordummys.app.testing.FakeAuthRepository
import de.wikifordummys.app.testing.MainDispatcherRule
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class HomeViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val space = Space(id = "1", key = "IT", name = "IT-Team", status = "active", role = "viewer")

    private class FakeHome : HomeRepository {
        var me: ApiResult<Me> = ApiResult.Success(Me("u1", "anna@example.de", "Anna"))
        var spaces: ApiResult<List<Space>> = ApiResult.Success(emptyList())
        var gate: CompletableDeferred<Unit>? = null
        var spaceCalls = 0
        override suspend fun me() = me
        override suspend fun spaces(): ApiResult<List<Space>> {
            spaceCalls++
            gate?.await()
            return spaces
        }
    }

    private val home = FakeHome()
    private val auth = FakeAuthRepository(SessionInfo("https://wiki.example.de"))

    @Test
    fun `shows loading, then spaces and display name`() = runTest {
        home.spaces = ApiResult.Success(listOf(space))
        home.gate = CompletableDeferred()
        val vm = HomeViewModel(home, auth)
        assertEquals(SpacesState.Loading, vm.uiState.value.spaces)

        home.gate!!.complete(Unit)
        assertEquals(SpacesState.Loaded(listOf(space)), vm.uiState.value.spaces)
        assertEquals("Anna", vm.uiState.value.displayName)
    }

    @Test
    fun `empty list is its own state`() = runTest {
        assertEquals(SpacesState.Empty, HomeViewModel(home, auth).uiState.value.spaces)
    }

    @Test
    fun `errors are mapped and retry loads again`() = runTest {
        home.spaces = ApiResult.Network
        home.me = ApiResult.Network
        val vm = HomeViewModel(home, auth)
        assertEquals(SpacesState.Error(HomeError.Network), vm.uiState.value.spaces)
        assertNull(vm.uiState.value.displayName)

        home.spaces = ApiResult.Success(listOf(space))
        vm.onRetry()
        assertEquals(SpacesState.Loaded(listOf(space)), vm.uiState.value.spaces)
        assertEquals(2, home.spaceCalls)
    }

    @Test
    fun `status codes map to errors`() = runTest {
        val cases = mapOf(
            ApiResult.Unauthorized to HomeError.Unauthorized,
            ApiResult.Forbidden to HomeError.Forbidden,
            ApiResult.RateLimited to HomeError.RateLimited,
            ApiResult.ServerError(503) to HomeError.Server,
            ApiResult.Tls to HomeError.Tls,
            ApiResult.InvalidResponse to HomeError.InvalidResponse,
        )
        for ((result, error) in cases) {
            home.spaces = result
            assertEquals(SpacesState.Error(error), HomeViewModel(home, auth).uiState.value.spaces)
        }
    }

    @Test
    fun `logout runs once and ends the session`() = runTest {
        val vm = HomeViewModel(home, auth)
        auth.gate = CompletableDeferred()
        vm.onLogout()
        vm.onLogout()
        assertTrue(vm.uiState.value.isLoggingOut)
        auth.gate!!.complete(Unit)
        assertEquals(1, auth.logouts)
        assertNull(auth.session.value)
    }
}
